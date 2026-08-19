/* POST /api/session
 *
 * The caller has already proved who they are — the HTTP API's Cognito authorizer rejects
 * anything without a valid token. This hands back CloudFront signed cookies so that
 * subsequent /content/* and /slides/* requests succeed, plus the list of courses the
 * student is enrolled on.
 *
 * The cookies are signed for the host the request arrived on, so the function never needs
 * to know the distribution's domain name and the two can be deployed independently.
 */
import { getSignedCookies } from '@aws-sdk/cloudfront-signer';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

async function enrolments(sub) {
  const r = await ddb.send(new QueryCommand({
    TableName: process.env.TABLE,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
    ExpressionAttributeValues: { ':pk': `USER#${sub}`, ':sk': 'ENROL#' },
  }));
  return (r.Items || []).map(i => i.sk.slice('ENROL#'.length));
}

// API Gateway hands multi-valued claims through as an array or as a bracketed string,
// depending on the token; treat both the same.
const isAdmin = claims => {
  const groups = claims['cognito:groups'];
  return Array.isArray(groups) ? groups.includes('admins') : String(groups ?? '').includes('admins');
};

export async function handler(event) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const sub = claims?.sub;
  if (!sub) return { statusCode: 401, body: JSON.stringify({ error: 'not signed in' }) };

  const host = event.headers?.host;
  if (!host) return { statusCode: 400, body: JSON.stringify({ error: 'no host header' }) };

  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  const signed = getSignedCookies({
    url: `https://${host}/*`,
    keyPairId: process.env.KEY_PAIR_ID,
    privateKey: await signingKey(),
    dateLessThan: expires.toISOString(),
  });

  const attrs = `Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    cookies: Object.entries(signed).map(([k, v]) => `${k}=${v}; ${attrs}`),
    body: JSON.stringify({
      courses: await enrolments(sub),
      admin: isAdmin(claims),
      expires: expires.toISOString(),
    }),
  };
}
