/* The whole platform, in one stack.
 *
 * Everything a student touches arrives through a single CloudFront distribution, which
 * matters for two reasons: the API is same-origin (so no CORS, and the session endpoint
 * can set cookies that content requests will actually send), and the content bucket is
 * never public.
 *
 *   /            app shell           public       — the login screen has to load
 *   /api/*       HTTP API            public       — protected by the Cognito JWT authorizer
 *   /content/*   course content      signed       — CloudFront trusted key group
 *   /slides/*    Slidev decks        signed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Stack, Duration, RemovalPolicy, CfnOutput,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_cloudfront as cf,
  aws_cloudfront_origins as origins,
  aws_certificatemanager as acm,
  aws_cognito as cognito,
  aws_dynamodb as ddb,
  aws_secretsmanager as sm,
  aws_lambda_nodejs as lambdaNode,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_iam as iam,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
} from 'aws-cdk-lib';
import { HttpApi, HttpMethod, WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration }
  from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_KEY_PEM = path.join(HERE, '..', 'cloudfront-public-key.pem');

/* THE INVITATION.
 *
 * `{username}` IS PRESENT BUT NEVER SHOWN, and that combination is deliberate.
 *
 * Cognito offers exactly two placeholders, `{username}` and `{####}`, and it REJECTS an
 * admin-create-user template that omits the first: "Email message body should have
 * {username}". Removing it fails the deploy outright - which is how this was found.
 *
 * But the pool signs in by email alias (`UsernameAttributes: ['email']`), so Cognito
 * generates an internal UUID as the real username and `{username}` renders as
 * `362e22b0-a041-705a-0ab4-feb0bd46157b`. The old copy opened with "Hello {username}", so
 * every student was greeted by a 36-character identifier - and worse, told implicitly that
 * it was their username, when the thing that actually signs them in is their email address.
 *
 * There is no `{email}` placeholder to substitute. So the token sits in an HTML comment to
 * satisfy the validator, and the copy says plainly what to type instead. Do not "tidy" it
 * out: the deploy will fail. Do not surface it either: it would be a confidently wrong
 * instruction.
 *
 * HTML, but deliberately plain: inline styles only, no images and no external stylesheet.
 * Mail clients strip <style> blocks, remote images make a first-contact email look like
 * marketing, and both cost deliverability on the one message that must not land in junk.
 * A text/plain alternative is not on offer - Cognito sends a single body - so the markup
 * has to degrade readably on its own.
 *
 * It says what the account is FOR. The old version said "your account is ready" and left a
 * student to guess what they had been given. It cannot name their course: enrolment is a
 * DynamoDB row written after the invitation goes out, and Cognito knows nothing about it.
 *
 * The seven days is not decoration - it is the pool's TemporaryPasswordValidityDays, and an
 * expired invitation has to be reissued by an admin. Someone who does not know that reads a
 * dead password as a broken site.
 */
const inviteBody = siteUrl => {
  const link = siteUrl
    ? `<p style="margin:0 0 20px"><a href="${siteUrl}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Sign in to icecore</a></p>`
    : '';
  const plainLink = siteUrl
    ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px">Or paste this into your browser: <a href="${siteUrl}" style="color:#0369a1">${siteUrl}</a></p>`
    : '';
  /* Remote, at its natural size halved, with `alt` carrying the name. Most clients block
   * remote images until the reader allows them, so the alt text is not a nicety - it is what
   * the majority of recipients see first, and "icecore" reading as plain text is a fine
   * fallback where a broken-image icon is not. Width and height are set explicitly so the
   * layout does not jump when it does load. */
  const logo = siteUrl
    ? `<p style="margin:0 0 18px"><img src="${siteUrl}/brand/icecore-logo.png" width="160" height="92" alt="icecore" style="display:block;border:0;outline:none;text-decoration:none;width:160px;height:auto"></p>`
    : '';
  return `<!-- {username} - required by Cognito, renders as an internal UUID, never shown -->
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a;max-width:520px;margin:0 auto;padding:8px">
  ${logo}
  <h1 style="font-size:20px;margin:0 0 16px">You have been invited to icecore</h1>
  <p style="margin:0 0 16px">icecore is where you will do the practical side of your course. It holds the slides from your sessions and a few hundred hands-on exercises to work through alongside them - you write real SQL and Python in the browser, run it against real data, and get told straight away whether it is right.</p>
  <p style="margin:0 0 16px">Nothing to install, and your progress is saved as you go, so you can stop mid-topic and pick it up on another machine.</p>
  <h2 style="font-size:15px;margin:24px 0 8px">Signing in for the first time</h2>
  <p style="margin:0 0 6px">Use <strong>the email address this was sent to</strong> as your username, with this temporary password:</p>
  <p style="margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:19px;font-weight:700;letter-spacing:.06em;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;display:inline-block">{####}</p>
  ${link}${plainLink}
  <p style="margin:16px 0 0;color:#64748b;font-size:13px">You will be asked to choose your own password as soon as you sign in. This temporary one stops working after seven days - if that happens, ask whoever invited you to send a new one.</p>
</div>`;
};

export class IcecoreStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    if (!fs.existsSync(PUBLIC_KEY_PEM))
      throw new Error(`Missing ${PUBLIC_KEY_PEM}. Run \`just keys\` first — it generates the ` +
        'CloudFront signing pair, puts the private half in Secrets Manager and writes the ' +
        'public half here (safe to commit).');

    // ---- storage ---------------------------------------------------------
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    /* THE LOGO THE INVITATION LINKS TO, deployed with the stack that defines the email.
     *
     * A mail client cannot render an inline data: URI - Gmail and Outlook both drop them -
     * and Cognito sends a single body with no attachment, so a remote image is the only
     * route there is. That makes the image a dependency of the email, and the email lives
     * here; shipping it with `just deploy` instead would mean a stack deployed into a fresh
     * environment sends invitations with a broken image until someone remembers to publish
     * the player.
     *
     * `brand/` is served by the DEFAULT behaviour, which has no trusted key group - so it is
     * publicly readable, which it has to be: the recipient is not signed in and fetches it
     * straight from the mail client.
     *
     * prune: false, and not by accident. BucketDeployment defaults to deleting everything in
     * the destination prefix that is not in the source - the same shape of foot-gun as an
     * `s3 sync --delete`, and this bucket holds three courses and 79 decks. Scoped to its own
     * prefix it would be survivable; set explicitly it cannot become a problem if the prefix
     * is ever widened. */
    new s3deploy.BucketDeployment(this, 'Brand', {
      sources: [s3deploy.Source.asset(path.join(HERE, '..', 'assets'))],
      destinationBucket: site,
      destinationKeyPrefix: 'brand',
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=604800')],
    });

    // Single-table. Cognito owns accounts; this owns everything about them.
    //   PK = USER#<sub>   SK = PROFILE | COHORT#<id> | ENROL#<course> | PROG#<course>#<exercise>
    //                          | LAST#<course> | RATE#hint#<day> | SPEND#hint#<day>#<course>
    //   PK = COHORTS       SK = COHORT#<id>              every cohort, one partition
    //   PK = HINTS#<course> SK = <exercise>              hint pressure, nobody's in particular
    //
    // COHORT# AND ENROL# ARE READ AS ONE RANGE by the admin listing - `sk BETWEEN 'COHORT#'
    // AND 'ENROL$'` - so a prefix added here beginning with D or E would arrive there as an
    // enrolment nobody wrote. See `belongings` in infra/lambda/admin.
    // byCourse inverts the key so "who is on course X" is one query. NOTHING READS IT YET -
    // the users page lists the pool and asks for each person's own enrolments, because the
    // catalogue of courses lives in the content bucket and this side of the wire does not
    // know it. It is here for the admin panel's later pages, which are per course and so ask
    // exactly the question it is shaped for. Not dead weight to be tidied away: the cost of
    // adding it back later is a full index build on a live table.
    const table = new ddb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'sk', type: ddb.AttributeType.STRING },
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',   // only the hint rate-limit counters set it
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'byCourse',
      partitionKey: { name: 'sk', type: ddb.AttributeType.STRING },
      sortKey: { name: 'pk', type: ddb.AttributeType.STRING },
    });

    // ---- who can sign in -------------------------------------------------
    // Invite-only: students are created by an admin, never by self sign-up.
    const inviteFrom = this.node.tryGetContext('inviteFromEmail');
    /* The invitation has to tell someone where to go, and the domain is already committed
     * context for the distribution. Falls back to the platform's name alone rather than to
     * a CloudFront URL nobody could type. */
    const siteUrl = this.node.tryGetContext('siteDomain')
      ? `https://${[this.node.tryGetContext('siteDomain')].flat()[0]}`
      : null;
    const users = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: { minLength: 12, requireLowercase: true, requireDigits: true, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Your icecore account is ready',
        emailBody: inviteBody(siteUrl),
      },
      /* SEND THROUGH SES WHEN THERE IS AN ADDRESS TO SEND AS.
       *
       * Cognito's own sender is rate-limited to 50 messages a day per account and arrives
       * from an amazonaws.com address nobody recognises, which is most of why an invitation
       * reads as junk. SES sends as the course's own domain with DKIM, and the identity is
       * already verified.
       *
       * Optional, and absent it falls back to exactly what it did before: a fresh region or
       * a second environment must not require a verified domain to come up at all. The
       * address is committed context for the same reason the alert email and the site
       * domain are - passed as a flag, forgetting it on the next deploy silently reverts
       * every invitation to the Cognito sender.
       *
       * `sesVerifiedDomain` is what lets CDK grant Cognito ses:SendRawEmail scoped to that
       * identity rather than to everything the account can send as. */
      ...(inviteFrom ? {
        email: cognito.UserPoolEmail.withSES({
          fromEmail: inviteFrom,
          fromName: 'icecore',
          sesRegion: this.region,
          sesVerifiedDomain: String(inviteFrom).split('@')[1],
        }),
      } : {}),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, 'Admins', {
      userPoolId: users.userPoolId,
      groupName: 'admins',
      description: 'May invite users and assign them to courses',
    });

    /* SOMETHING HAS TO PUT A HUMAN IN THAT GROUP.
     *
     * The group above is the only thing that can invite users and assign them to courses,
     * and until now nothing in this repo ever added anyone to it. The one admin that exists
     * does so because someone ran a console command by hand, outside version control. If
     * this pool is ever replaced - a new region, a new account, a RETAIN that did not
     * retain - the stack deploys green and there is no admin, no way to invite one, and no
     * code path to make one. Locked out of your own enrolment tool by a successful deploy.
     *
     * So: `cdk deploy -c adminEmail=someone@icemalta.com` creates that user and puts them
     * in `admins`. Two calls rather than one because AwsCustomResource is one SDK call per
     * event, and the second waits on the first.
     *
     * Idempotent on purpose. Creating a user who exists is ignored rather than fatal, so
     * naming an existing admin promotes them instead of failing the deploy; adding someone
     * to a group twice is a no-op in Cognito. Neither has a delete handler - tearing the
     * stack down must not delete a person - which matches the pool's own RETAIN.
     */
    const adminEmail = this.node.tryGetContext('adminEmail');
    if (adminEmail) {
      const sdkPolicy = AwsCustomResourcePolicy.fromSdkCalls({ resources: [users.userPoolArn] });

      const created = new AwsCustomResource(this, 'BootstrapAdminUser', {
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'adminCreateUser',
          parameters: {
            UserPoolId: users.userPoolId,
            Username: adminEmail,
            // Verified up front: an admin who cannot receive a password reset is barely
            // less locked out than no admin at all.
            //
            // `name` is in here because the pool declares it REQUIRED, and Cognito enforces
            // that on adminCreateUser - without it the call is rejected as not conforming to
            // the schema, which `ignoreErrorCodesMatching` above does not catch because it is
            // an InvalidParameterException and not a UsernameExistsException. The one code
            // path whose entire job is to stop a lockout would have failed the first time
            // anyone used it. The invite Lambda has always sent it; this copy was written
            // separately and did not, which is the drift a second copy always eventually has.
            //
            // A pool's schema cannot be altered after creation, so `name` stays required for
            // the life of this pool and every future writer has to supply one.
            UserAttributes: [
              { Name: 'email', Value: adminEmail },
              { Name: 'email_verified', Value: 'true' },
              { Name: 'name', Value: String(adminEmail).split('@')[0] },
            ],
            DesiredDeliveryMediums: ['EMAIL'],
          },
          physicalResourceId: PhysicalResourceId.of(`admin-user-${adminEmail}`),
          ignoreErrorCodesMatching: 'UsernameExistsException',
        },
        policy: sdkPolicy,
        installLatestAwsSdk: false,
      });

      const promoted = new AwsCustomResource(this, 'BootstrapAdminGroup', {
        onCreate: {
          service: 'CognitoIdentityServiceProvider',
          action: 'adminAddUserToGroup',
          parameters: { UserPoolId: users.userPoolId, Username: adminEmail, GroupName: 'admins' },
          physicalResourceId: PhysicalResourceId.of(`admin-group-${adminEmail}`),
        },
        policy: sdkPolicy,
        installLatestAwsSdk: false,
      });
      promoted.node.addDependency(created);
    }

    /* NO `readAttributes` ON PURPOSE. Left unset, Cognito grants the client read on every
     * standard attribute, which is what puts `name` and `email` in the id token for the top
     * bar to draw. Set it to add a custom attribute later and the standard ones are no
     * longer implied - they have to be listed too, or the name silently disappears from the
     * corner of every page and looks like a styling bug. */
    const client = users.addClient('Web', {
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(12),
      idTokenValidity: Duration.hours(12),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ---- the signing pair for private content ----------------------------
    const publicKey = new cf.PublicKey(this, 'SigningKey', {
      encodedKey: fs.readFileSync(PUBLIC_KEY_PEM, 'utf8'),
    });
    const keyGroup = new cf.KeyGroup(this, 'SigningKeys', { items: [publicKey] });

    const signingSecret = sm.Secret.fromSecretNameV2(this, 'SigningSecret', 'icecore/cloudfront-signing-key');
    const openaiSecret = sm.Secret.fromSecretNameV2(this, 'OpenAiSecret', 'icecore/openai-api-key');

    // ---- session endpoint ------------------------------------------------
    // Trades a valid Cognito token for CloudFront signed cookies. It signs for the host
    // it was called on, which is how the distribution and the API avoid a circular
    // dependency on each other's domain name.
    // Bundle the SDK rather than trusting the runtime to carry every package we use —
    // @aws-sdk/cloudfront-signer in particular is not part of the Lambda runtime image.
    const fn = (id, dir, environment, opts = {}) => new lambdaNode.NodejsFunction(this, id, {
      entry: path.join(HERE, '..', 'lambda', dir, 'index.mjs'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      ...opts,
      bundling: { externalModules: [] },
      logGroup: new logs.LogGroup(this, `${id}Logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { TABLE: table.tableName, ...environment },
    });

    const session = fn('Session', 'session', {
      KEY_PAIR_ID: publicKey.publicKeyId,
      SIGNING_SECRET: signingSecret.secretName,
    });
    table.grantReadData(session);
    signingSecret.grantRead(session);

    // Students read and write only their own rows; the key is built from their token.
    const progress = fn('Progress', 'progress');
    table.grantReadWriteData(progress);

    /* Saved whiteboards. Writes only into `COHORT#<id>` partitions, and only for a cohort
     * the caller is delivering to right now - which it checks by reading the live session
     * row, so the gate is a fact rather than a role. Separate from the live function because
     * that one is a socket and this is durable state, and separate from the admin function
     * because a student has to be able to read a board of their own class's. */
    const boards = fn('Boards', 'boards');
    table.grantReadWriteData(boards);

    // Holds the API key and the tutoring prompt; the exercise itself comes from the client,
    // which already has the reference solution.
    const hint = fn('Hint', 'hint', {
      OPENAI_SECRET: openaiSecret.secretName,
      OPENAI_MODEL: this.node.tryGetContext('openaiModel') || 'gpt-5.6-luna',
      REASONING_EFFORT: this.node.tryGetContext('reasoningEffort') || 'low',
      DAILY_LIMIT: String(this.node.tryGetContext('hintsPerDay') || 40),
    });
    hint.addEnvironment('TABLE', table.tableName);
    table.grantReadWriteData(hint);
    openaiSecret.grantRead(hint);

    /* User management: invite, edit, enrol, promote, suspend, delete.
     *
     * Longer than the ten seconds every other function gets. Listing the pool is one
     * Cognito call per sixty users and one DynamoDB query per user - fast, but linear in a
     * number nobody controls, and this is an interactive admin screen rather than something
     * on a student's critical path. A timeout here reads as "the user list is broken". */
    const admin = fn('Admin', 'admin', { USER_POOL_ID: users.userPoolId },
      { timeout: Duration.seconds(30) });
    table.grantReadWriteData(admin);
    admin.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:ListUsers',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminDeleteUser',
      ],
      resources: [users.userPoolArn],
    }));

    /* A person's own account: what we hold about them, and their own name.
     *
     * Its own function rather than a branch in the admin one, and the reason is the blast
     * radius rather than the code. The admin function may act on ANY sub and is reachable
     * only by admins; this one may act on exactly the caller's and is reachable by
     * everybody. Folded together, the thing standing between a student and every other
     * student's rows would be an `if` - and the day somebody adds a `?sub=` here for a
     * good reason, it is gone. Separate functions make that mistake impossible to make by
     * accident rather than merely against the rules.
     *
     * The same DAILY_LIMIT the hint function enforces, because this reports it. One
     * context key read in two places is a number that cannot disagree with itself; passing
     * it only to the enforcer and typing 40 into the screen is how it eventually does. */
    const account = fn('Account', 'account', {
      USER_POOL_ID: users.userPoolId,
      DAILY_LIMIT: String(this.node.tryGetContext('hintsPerDay') || 40),
      /* WHO THE DATA CONTROLLER IS, for the Article 15 statement. Committed context for the
       * reason the alarm email and the bootstrap admin are: passed as a flag it has to be
       * remembered on every deploy, and a privacy statement naming the wrong organisation is
       * worse than one that is late. Absent, the function falls back to an obvious
       * placeholder rather than inventing a legal entity. */
      ORG_NAME: this.node.tryGetContext('orgName') || '',
      PRIVACY_CONTACT: this.node.tryGetContext('privacyContact') || '',
      SITE_BUCKET: site.bucketName,
    });
    table.grantReadWriteData(account);
    /* Avatars, and NOTHING ELSE IN THE BUCKET. `grantReadWrite(account)` would hand this
     * function the whole site - three courses, 79 decks and the player itself - to store a
     * 15KB picture. Scoped to the one prefix it owns, and to the two verbs it uses: a
     * replacement is a put of the new key and a delete of the old. */
    account.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject'],
      resources: [site.arnForObjects('avatars/*')],
    }));
    account.addToRolePolicy(new iam.PolicyStatement({
      // Two, and no more. It reads one user to resolve a sub to a username, and writes the
      // one attribute a person may change about themselves.
      actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminUpdateUserAttributes'],
      resources: [users.userPoolArn],
    }));

    /* The live channel - ONE MODULE, TWO FUNCTIONS, and the split is forced rather than
     * chosen. See the `managementFor` comment in infra/lambda/live/index.mjs: posting to a
     * socket needs the socket API's endpoint, a socket event carries it, an HTTP event does
     * not, and handing it to the function the socket API points at is a CloudFormation
     * cycle. So the HTTP half is a second function that nothing in the socket API
     * references, and it can be told outright.
     *
     * Fifteen seconds rather than ten: a fan-out is one query plus a post per connection,
     * and the slow case is a room where several sockets have gone stale at once and each
     * post has to fail before its row can be deleted.
     */
    const live = fn('Live', 'live', {}, { timeout: Duration.seconds(15) });
    table.grantReadWriteData(live);
    const liveApi = fn('LiveApi', 'live', {}, { timeout: Duration.seconds(15) });
    table.grantReadWriteData(liveApi);

    const api = new HttpApi(this, 'Api', {
      apiName: 'icecore',
      defaultAuthorizer: new HttpJwtAuthorizer('Cognito', users.userPoolProviderUrl, {
        jwtAudience: [client.userPoolClientId],
      }),
    });
    api.addRoutes({
      path: '/api/session',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SessionIntegration', session),
    });
    api.addRoutes({
      path: '/api/hint',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('HintIntegration', hint),
    });
    api.addRoutes({
      path: '/api/progress',
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: new HttpLambdaIntegration('ProgressIntegration', progress),
    });
    api.addRoutes({
      path: '/api/boards',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('BoardsIntegration', boards),
    });
    // The admin group check happens inside the function - a JWT authorizer can't see groups.
    api.addRoutes({
      path: '/api/admin/users',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AdminIntegration', admin),
    });
    /* The same function, told apart by its path. No GET: the cohort catalogue rides back
     * with the user listing, because the screen that draws cohorts is the screen that draws
     * people and two round trips for one table is one too many. */
    api.addRoutes({
      path: '/api/account',
      methods: [HttpMethod.GET, HttpMethod.PUT],
      integration: new HttpLambdaIntegration('AccountIntegration', account),
    });
    /* Its own route rather than a `?reset=` on the one above, because it is a DELETE and
     * the resource being deleted is a course's progress rather than the account. One
     * function still serves both - it tells them apart by path, exactly as the admin
     * function tells users from cohorts. */
    api.addRoutes({
      path: '/api/account/avatar',
      methods: [HttpMethod.POST, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AccountAvatarIntegration', account),
    });
    api.addRoutes({
      path: '/api/account/export',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('AccountExportIntegration', account),
    });
    api.addRoutes({
      path: '/api/account/progress',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AccountProgressIntegration', account),
    });
    /* Progress written for somebody else, during remote control. Its own path rather than a
       shape of `/users`, because it is the only thing this function does that changes what a
       STUDENT has done rather than who they are - and the function checks that the caller is
       currently driving them, so being an admin is not on its own enough to reach it. */
    api.addRoutes({
      path: '/api/admin/progress',
      methods: [HttpMethod.PUT],
      integration: new HttpLambdaIntegration('AdminIntegration', admin),
    });
    api.addRoutes({
      path: '/api/admin/cohorts',
      methods: [HttpMethod.POST, HttpMethod.PUT, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AdminIntegration', admin),
    });
    // Minting the ticket is an ordinary authorized call; the socket below has no authorizer
    // of its own and does not need one, because the ticket IS the credential.
    api.addRoutes({
      path: '/api/live/ticket',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('LiveTicketIntegration', liveApi),
    });
    /* Starting, ending, and asking who is live. GET is not admin-only - a student's client
     * has to know a session exists before it can offer to join one - and the group check
     * for the other two is inside the function, because a JWT authorizer cannot see groups.
     */
    api.addRoutes({
      path: '/api/live/session',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('LiveSessionIntegration', liveApi),
    });

    /* ---- the socket -------------------------------------------------------
     *
     * NO AUTHORIZER, and that is the design rather than an omission. There is no
     * `WebSocketJwtAuthorizer` - a WebSocket API takes a Lambda or IAM authorizer and
     * nothing else - and a browser cannot set headers on a handshake, so a token would have
     * to ride in the query string where tokens end up in logs. The client spends a
     * single-use ticket instead, `$connect` consumes it with a conditional delete, and a
     * non-2xx from that route refuses the handshake. An authorizer would be a second
     * function in front of this one doing the same delete.
     *
     * IT IS NOT BEHIND THE DISTRIBUTION, unlike /api/*. A WebSocket API's URL is
     * `wss://<host>/<stage>` with nothing below it, so a CloudFront behaviour at /ws would
     * forward `/<stage>/ws` and be refused - routing it through would need a CloudFront
     * Function rewriting the path on every connection. Same-origin buys nothing here
     * either: a WebSocket handshake has no CORS and carries no signed cookie. So the client
     * learns this URL from auth.json, exactly as it learns the user pool.
     */
    const socket = new WebSocketApi(this, 'Socket', {
      apiName: 'icecore-live',
      /* Everything lands on $default, which is what the client expects: its messages carry
       * a `type`, and API Gateway selects routes on `$request.body.action` by default. Add
       * a named route later and it will never be reached until the client sends `action`
       * too - a message that silently falls through to the default handler instead. */
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('LiveConnect', live) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('LiveDisconnect', live) },
      defaultRouteOptions: { integration: new WebSocketLambdaIntegration('LiveDefault', live) },
    });
    const socketStage = new WebSocketStage(this, 'SocketStage', {
      webSocketApi: socket,
      stageName: 'live',
      autoDeploy: true,
    });
    // execute-api:ManageConnections, scoped to this stage - the grant exists so that the
    // policy is not written by hand against an ARN nobody would notice going wrong.
    socketStage.grantManagementApiAccess(live);
    /* The HTTP half posts to sockets too - ending a session tells the room - and is handed
     * the endpoint here, AFTER the stage exists. This is the direction that has no cycle in
     * it: nothing in the socket API references `liveApi`. */
    socketStage.grantManagementApiAccess(liveApi);
    liveApi.addEnvironment('WS_ENDPOINT', socketStage.callbackUrl);


    // ---- the one front door ----------------------------------------------
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(site);
    const privateBehaviour = {
      origin: s3Origin,
      trustedKeyGroups: [keyGroup],
      viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    /* THE CUSTOM DOMAIN LIVES IN COMMITTED CONTEXT, for the reason the alert email does.
     *
     * The alias and its certificate were first added by hand in the console, which means the
     * template did not describe them - and CloudFormation reconciles a resource back to its
     * template, so the very next `cdk deploy` would have silently removed both and dropped
     * the distribution back onto the default certificate. A green deploy that takes the site
     * off its own domain.
     *
     * Passing them as `-c` flags would only move the problem: supply them once and the alias
     * exists, forget them on the next deploy and CloudFormation removes it again. Committed
     * context cannot be forgotten. Absent both, the stack still deploys on the CloudFront
     * domain exactly as it did before - a fresh region or a second environment needs no
     * domain to come up.
     *
     * The certificate must be in us-east-1 whatever region the stack is in; CloudFront
     * accepts no other. It is referenced by ARN rather than created here because it is a
     * wildcard shared with the other icecampus.com sites - creating one per stack would mean
     * a validation record per stack for a name that is already covered. */
    const siteDomain = this.node.tryGetContext('siteDomain');
    const siteCertArn = this.node.tryGetContext('siteCertificateArn');
    if (Boolean(siteDomain) !== Boolean(siteCertArn))
      throw new Error('siteDomain and siteCertificateArn must be set together in cdk.json'
        + ' - an alias without a certificate is a distribution CloudFront will not accept,'
        + ' and a certificate without an alias does nothing.');

    const distribution = new cf.Distribution(this, 'Cdn', {
      ...(siteDomain ? {
        domainNames: [siteDomain].flat(),
        certificate: acm.Certificate.fromCertificateArn(this, 'SiteCert', siteCertArn),
      } : {}),
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/content/*': privateBehaviour,
        '/slides/*': privateBehaviour,
        /* BEHIND THE KEY GROUP, unlike `brand/`. That one is public because the recipient of
         * an invitation is not signed in and fetches it straight from a mail client; nobody
         * who is not signed in has any business fetching a student's face. The session
         * cookie's policy is already `<origin>/*`, so it covers this prefix with no change
         * to the session function. */
        '/avatars/*': privateBehaviour,
        '/api/*': {
          origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`),
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cf.AllowedMethods.ALLOW_ALL,
          cachePolicy: cf.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cf.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // No SPA error-page rewrite on purpose: the player routes on ?course=, not on paths,
      // and a blanket 403 -> index.html would turn "you may not have this" into a page of
      // HTML that the content loader would try to parse as JSON.
    });

    // ---- how a course repo publishes ----------------------------------------
    // OIDC rather than an access key: nothing long-lived to leak out of a repo secret, and
    // the trust policy names exactly which repositories may assume it. Content publishing
    // is separate from `cdk deploy` on purpose - fixing a typo in an exercise must not be
    // able to touch infrastructure, so this role can write objects and nothing else.
    const github = new iam.OpenIdConnectProvider(this, 'GitHub', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });
    const publisher = new iam.Role(this, 'Publisher', {
      roleName: 'icecore-publisher',
      description: 'Assumed by course repos to publish content and slides',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        // Two patterns, and both are needed. GitHub is moving to *immutable* subject
        // claims, which carry numeric ids: the sub becomes
        //   repo:icemaltacode@132367313/icecore-x@1338407739:ref:refs/heads/main
        // rather than repo:icemaltacode/icecore-x:ref:refs/heads/main. The `@<id>` lands
        // before the slash, so a pattern anchored on `icemaltacode/` stops matching and
        // STS reports it as a flat "not authorized" - it will not tell an unauthenticated
        // caller that a trust policy failed to match, so the error looks identical to a
        // missing role. StringLike takes a list and passes if any entry matches, so this
        // covers both shapes and survives the rollout in either direction.
        StringLike: {
          'token.actions.githubusercontent.com:sub':
            [this.node.tryGetContext('publisherRepos')].flat().filter(Boolean).length
              ? [this.node.tryGetContext('publisherRepos')].flat()
              : ['repo:icemaltacode/icecore*:*', 'repo:icemaltacode@*/icecore*:*'],
        },
      }),
    });
    site.grantReadWrite(publisher);
    publisher.addToPolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`],
    }));

    /* ---- the few alarms worth having ----------------------------------------
     *
     * Deliberately sparse. An alarm nobody reads is worse than none, because it teaches
     * people to ignore the ones that matter.
     *
     * The address lives in `cdk.json` rather than in a `-c alertEmail=` flag, and that is
     * the point rather than convenience. The subscription is a CDK resource: pass the flag
     * once and the topic gets a subscriber, forget it on the NEXT deploy and CloudFormation
     * removes that subscriber again - silently, from a deploy that goes green, leaving five
     * alarms firing into nothing. Committed context cannot be forgotten.
     *
     * A flag still overrides it, for a second environment or a temporary redirect.
     *
     * AWS sends a confirmation email and the subscription does nothing until someone
     * clicks it. `just alerts` says whether that has happened. */
    const alertEmail = this.node.tryGetContext('alertEmail');
    const alarms = new sns.Topic(this, 'Alerts', { displayName: 'icecore alerts' });
    if (alertEmail) alarms.addSubscription(new subs.EmailSubscription(alertEmail));
    const notify = alarm => alarm.addAlarmAction(new cwActions.SnsAction(alarms));

    // A function that throws is a bug: these all answer their own error cases with a
    // status code, so Errors > 0 means something unhandled.
    for (const [name, f] of Object.entries({ session, progress, admin, hint })) {
      notify(f.metricErrors({ period: Duration.minutes(5) }).createAlarm(this, `${name}Errors`, {
        alarmDescription: `${name} Lambda threw`,
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }));
    }

    // Students seeing 5xx from the CDN itself - origin trouble, not a bad request.
    notify(distribution.metric5xxErrorRate({ period: Duration.minutes(5) })
      .createAlarm(this, 'Cdn5xx', {
        alarmDescription: 'CloudFront is returning server errors',
        threshold: 2,          // percent
        evaluationPeriods: 2,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      }));

    new CfnOutput(this, 'SiteBucket', { value: site.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    /* The alias when there is one. The CloudFront domain still works, but printing it after
     * a deploy sends whoever ran it to the address students do not use - and, once the
     * distribution has an alias, to the one that is not on the certificate's common name. */
    new CfnOutput(this, 'SiteUrl', { value: siteUrl || `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'UserPoolId', { value: users.userPoolId });
    /* Said out loud at every deploy, because the failure it guards against is a stack that
     * comes up green with nobody able to sign anyone in. */
    new CfnOutput(this, 'AlertEmail', {
      value: alertEmail
        ? `${alertEmail} (unconfirmed subscriptions receive nothing - check just alerts)`
        : 'NOT CONFIGURED - the alarms fire into an SNS topic with no subscriber',
    });
    new CfnOutput(this, 'AdminBootstrap', {
      value: adminEmail
        ? `${adminEmail} created and added to admins`
        : 'NOT CONFIGURED - adminEmail is missing from infra/cdk.json. Put it back and redeploy;'
          + ' a pool with nobody in `admins` is a lockout nothing in this repo can undo.',
    });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    // Read by `just deploy` into auth.json: the app cannot reach the socket without it,
    // and a hand-typed wss:// URL is one typo from a feature that silently never connects.
    new CfnOutput(this, 'LiveSocketUrl', { value: socketStage.url });
    new CfnOutput(this, 'PublisherRoleArn', { value: publisher.roleArn });
  }
}
