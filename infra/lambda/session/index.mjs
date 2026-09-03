/* POST /api/session
 *
 * The caller has already proved who they are — the HTTP API's Cognito authorizer rejects
 * anything without a valid token. This hands back CloudFront signed cookies so that
 * subsequent /content/* and /slides/* requests succeed, plus the list of courses the
 * student may open - which is derived from the cohorts they are in, not stored. See
 * `enrolments` below and ADMIN.md.
 *
 * The cookies are signed for the origin the caller names, because nothing on this side of
 * the wire knows it. The distribution's domain can't be an environment variable here — the
 * distribution depends on the API which depends on this function, so referencing it back
 * would be a cycle — and the Host header is no help either: /api/* uses the
 * AllViewerExceptHostHeader origin request policy, which is what lets API Gateway work
 * behind CloudFront at all, and which replaces the viewer's Host with the API's own domain.
 *
 * Trusting the caller for this is safe. A signature is only honoured by a distribution that
 * trusts our key group, which is ours alone, so cookies minted for any other host are
 * worthless — naming one gains an attacker nothing they could not already have.
 */
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, BatchGetCommand }
  from '@aws-sdk/lib-dynamodb';

const SESSION_HOURS = 12;

const secrets = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

let privateKey;   // cached across invocations - it never changes
async function signingKey() {
  if (!privateKey) {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.SIGNING_SECRET }));
    privateKey = r.SecretString;
  }
  return privateKey;
}

/**
 * WHAT THIS PERSON MAY OPEN: the union of the courses of every intake they are in.
 *
 * It was one query for `ENROL#` rows, and the rows are gone - a course reaches somebody
 * through their cohort now, so this is the membership query followed by a read of the
 * cohorts it names. Two round trips on the way into the app rather than one; the second is
 * a `BatchGetItem` over a handful of keys in a single partition, which is about as cheap as
 * a second call gets, and it buys the property that a cohort's roster and a cohort's
 * courses can never disagree because there is only one of each.
 *
 * ARCHIVING AN INTAKE DOES NOT CLOSE ITS COURSES. A class that finished in June still owns
 * what it was taught, and the same rule is written down in the admin function - see
 * `coursesFrom` there. The two are separate readers of one model rather than one calling the
 * other: this function is on the sign-in path and has no business importing an admin API.
 */
async function enrolments(sub) {
  const r = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'COHORT#' },
    ProjectionExpression: 'sk',
  }));
  const ids = (r.Items || []).map(i => i.sk.slice('COHORT#'.length));
  if (!ids.length) return [];

  const courses = new Set();
  // BatchGetItem takes a hundred keys; a person in more intakes than that is not a thing,
  // but chunking costs two lines and a silent truncation costs somebody their courses.
  for (let i = 0; i < ids.length; i += 100) {
    const keys = ids.slice(i, i + 100).map(id => ({ pk: 'COHORTS', sk: `COHORT#${id}` }));
    const b = await ddb.send(new BatchGetCommand({
      RequestItems: { [process.env.TABLE]: { Keys: keys, ProjectionExpression: 'courses' } },
    }));
    for (const row of b.Responses?.[process.env.TABLE] || []) {
      for (const c of row.courses || []) courses.add(c);
    }
  }
  return [...courses];
}

/* The caller's avatar key, or null.
 *
 * IT RIDES WITH THE SESSION because the top bar needs it on the FIRST paint of every page,
 * and everything else about an account is fetched when the account screen opens. A boot-time
 * round trip for a picture would be a round trip on the way into a course; this call already
 * happens, and the extra read runs beside the enrolment query rather than after it.
 *
 * Its own row rather than a prefix, so it is one GetItem - and `AVATAR` sorts before
 * `COHORT#`, which keeps it outside the range the admin listing reads as one query. */
async function avatar(sub) {
  const r = await ddb.send(new GetCommand({
    TableName: process.env.TABLE, Key: { pk: `USER#${sub}`, sk: 'AVATAR' },
  }));
  return r.Item?.key || null;
}

// API Gateway hands multi-valued claims through as an array or as a bracketed string,
// depending on the token; treat both the same.
const isAdmin = claims => {
  const groups = claims['cognito:groups'];
  return Array.isArray(groups) ? groups.includes('admins') : String(groups ?? '').includes('admins');
};

/** The site the caller is on: what they tell us, falling back to Origin, then Referer. */
function viewerOrigin(event) {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { /* an absent body is fine */ }
  const h = event.headers || {};
  for (const candidate of [body.origin, h.origin, h.referer]) {
    try {
      const u = new URL(candidate);
      if (u.protocol === 'https:') return u.origin;
    } catch { /* try the next one */ }
  }
  return null;
}

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (!sub) return { statusCode: 401, body: JSON.stringify({ error: 'not signed in' }) };

  const origin = viewerOrigin(event);
  if (!origin) return { statusCode: 400, body: JSON.stringify({ error: 'could not determine the site origin' }) };

  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);

  // A custom policy, not `dateLessThan`. Passing dateLessThan produces a *canned* policy,
  // and CloudFront rebuilds a canned policy from CloudFront-Expires and the URL actually
  // being requested — so the signature only matches when the signed resource was that exact
  // URL. A wildcard cannot survive that round trip and every request 403s. Only a custom
  // policy carries the resource pattern with it, in the CloudFront-Policy cookie.
  const signed = getSignedCookies({
    keyPairId: process.env.KEY_PAIR_ID,
    privateKey: await signingKey(),
    policy: JSON.stringify({
      Statement: [{
        Resource: `${origin}/*`,
        Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor(expires.getTime() / 1000) } },
      }],
    }),
  });

  // Logged because a mismatch here is invisible from outside: the cookies get set and look
  // perfectly fine, and every content request simply returns 403.
  console.log(`signed ${origin}/* for ${sub} until ${expires.toISOString()}` +
    ` (admin=${isAdmin(claims)}, groups=${JSON.stringify(claims['cognito:groups'] ?? null)})`);

  const attrs = `Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    cookies: Object.entries(signed).map(([k, v]) => `${k}=${v}; ${attrs}`),
    body: JSON.stringify({
      // Together rather than in sequence: two independent reads of one partition.
      ...Object.fromEntries(await Promise.all([
        enrolments(sub).then(v => ['courses', v]),
        avatar(sub).then(v => ['avatar', v]),
      ])),
      admin: isAdmin(claims),
      expires: expires.toISOString(),
    }),
  };
}
