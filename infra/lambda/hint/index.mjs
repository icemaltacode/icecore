/* POST /api/hint — a nudge, not an answer.
 *
 * Everything the model needs comes from the client, because the client already has it:
 * reference solutions ship to the browser by design, so there is no private copy of the
 * content here and nothing to keep in sync. This function's whole job is to hold the API
 * key, hold the prompt, and stop one student burning the budget.
 *
 * Not streamed: response streaming needs a Lambda Function URL, and everything here is
 * deliberately behind one CloudFront distribution via API Gateway. A hint is a paragraph.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const secrets = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 40);
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
// gpt-5.6-luna is a reasoning model, and reasoning tokens are charged against the output
// cap: a tight cap can be swallowed whole before any prose is produced, leaving an empty
// message. Hence a generous ceiling and the lightest reasoning that still gives a useful
// nudge - a two-sentence hint is not where thinking hard pays.
const EFFORT = process.env.REASONING_EFFORT || 'low';

const json = (statusCode, body) => ({
  statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

let apiKey;
async function key() {
  if (!apiKey) {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.OPENAI_SECRET }));
    apiKey = r.SecretString.trim();
  }
  return apiKey;
}

/* ---- what a hint costs, and which exercise cost it ----------------------------------
 *
 * Two writes, neither of which the student waits on and neither of which may fail their
 * hint: the answer has already been paid for by the time these run, so losing the
 * accounting is a worse outcome to cause than to suffer.
 *
 * THE LEDGER LIVES IN THE STUDENT'S OWN PARTITION. `forget()` in the admin function deletes
 * everything under `USER#<sub>`, so this is deleted with the person. A row keyed on the day
 * instead would survive deleting somebody and still name their sub - a ledger that outlives
 * the person it is about is a data-protection problem, not a feature.
 *
 * IT IS A SEPARATE ROW FROM THE RATE COUNTER, which carries a three-day TTL. That one is a
 * limit and wants to be forgotten; this one is history and must not be. Widening the TTL to
 * serve both would give the limit a memory it has no use for.
 *
 * TOKENS AND THE MODEL, NOT MONEY. A cost computed here bakes in a rate nobody can check
 * afterwards. The admin screen prices it at read time from one constant - which does mean
 * changing that constant re-prices history, and for an internal cost view that is the
 * honest trade.
 *
 * The per-exercise counter is the other one, and it is deliberately NOT about a student:
 * hint pressure per exercise is the difficulty signal this platform otherwise has no way to
 * see, since a `PROG#` row is only ever written when somebody succeeds. Being aggregate, it
 * is also the one row here that is not deleted with a person - which is correct, and is
 * written down so nobody later "fixes" it.
 *
 * Both `course` and `exercise` are already in the request body - hint.js has always sent
 * them and this function has always ignored them. */
async function record(sub, body, usage) {
  const day = new Date().toISOString().slice(0, 10);
  const course = String(body.course || 'unknown').slice(0, 80);
  const exercise = String(body.exercise ?? 'unknown').slice(0, 80);
  await Promise.all([
    ddb.send(new UpdateCommand({
      TableName: process.env.TABLE,
      Key: { pk: `USER#${sub}`, sk: `SPEND#hint#${day}#${course}` },
      UpdateExpression:
        'ADD #n :one, #in :in, #out :out SET #model = :model, #course = :course, #day = :day',
      ExpressionAttributeNames: {
        '#n': 'n', '#in': 'in', '#out': 'out', '#model': 'model', '#course': 'course', '#day': 'day',
      },
      ExpressionAttributeValues: {
        ':one': 1,
        ':in': Number(usage?.prompt_tokens) || 0,
        ':out': Number(usage?.completion_tokens) || 0,
        ':model': MODEL,
        ':course': course,
        ':day': day,
      },
    })),
    ddb.send(new UpdateCommand({
      TableName: process.env.TABLE,
      Key: { pk: `HINTS#${course}`, sk: exercise },
      UpdateExpression: 'ADD #n :one',
      ExpressionAttributeNames: { '#n': 'n' },
      ExpressionAttributeValues: { ':one': 1 },
    })),
  ]);
}

/** One atomic counter per student per day, swept by the table's TTL. */
async function spend(sub) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await ddb.send(new UpdateCommand({
    TableName: process.env.TABLE,
    Key: { pk: `USER#${sub}`, sk: `RATE#hint#${day}` },
    UpdateExpression: 'ADD #n :one SET #ttl = if_not_exists(#ttl, :ttl)',
    ExpressionAttributeNames: { '#n': 'n', '#ttl': 'ttl' },
    ExpressionAttributeValues: {
      ':one': 1,
      ':ttl': Math.floor(Date.now() / 1000) + 3 * 86400,
    },
    ReturnValues: 'UPDATED_NEW',
  }));
  return r.Attributes.n;
}

const SYSTEM = `You are a patient SQL tutor for a beginners' course. A student is stuck on
an exercise and has asked for help.

Give ONE short nudge - two or three sentences, no more. Point at what to reconsider and
why, in plain language.

You will be shown the reference solution. Never reproduce it, never quote a clause from it,
and never write a complete query. If the student is one small step away, name the concept
they are missing rather than the code. If their query has an error, explain what the
database is complaining about in ordinary words.

Do not praise, do not preamble, do not offer to help further. Just the nudge.`;

const clip = (s, n) => String(s ?? '').slice(0, n);

export async function handler(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub) return json(401, { error: 'not signed in' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad request body' }); }
  if (!body.submission?.trim()) return json(400, { error: 'Write something first, then ask.' });

  const used = await spend(sub);
  if (used > DAILY_LIMIT)
    return json(429, { error: `That's ${DAILY_LIMIT} hints today - the limit resets tomorrow.` });

  const user = [
    `Exercise: ${clip(body.title, 200)}`,
    `Brief: ${clip(body.prompt, 2000)}`,
    `This step asks: ${clip(body.instructions, 1000)}`,
    `Reference solution (never reveal): ${clip(body.solution, 2000)}`,
    `The student wrote: ${clip(body.submission, 2000)}`,
    body.feedback ? `The grader said: ${clip(body.feedback, 500)}` : null,
  ].filter(Boolean).join('\n\n');

  let r;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${await key()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: EFFORT,
        max_completion_tokens: 2000,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      }),
    });
  } catch (e) {
    console.error('openai unreachable', e);
    return json(502, { error: 'The hint service is unreachable. Try again in a moment.' });
  }

  if (!r.ok) {
    console.error('openai error', r.status, await r.text().catch(() => ''));
    return json(502, { error: 'The hint service had a problem. Try again in a moment.' });
  }

  const data = await r.json();
  const hint = data.choices?.[0]?.message?.content?.trim();
  if (!hint) return json(502, { error: 'No hint came back. Try again in a moment.' });
  // Logged and swallowed: the hint is already paid for and already good, and there is
  // nothing a student could do about a failed write to a table they cannot see.
  await record(sub, body, data.usage).catch(e => console.error('spend not recorded', e));
  return json(200, { hint, remaining: Math.max(0, DAILY_LIMIT - used) });
}
