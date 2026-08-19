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
  return json(200, { hint, remaining: Math.max(0, DAILY_LIMIT - used) });
}
