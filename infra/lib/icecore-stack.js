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
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_KEY_PEM = path.join(HERE, '..', 'cloudfront-public-key.pem');

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

    // Single-table. Cognito owns accounts; this owns everything about them.
    //   PK = USER#<sub>   SK = PROFILE | ENROL#<course> | PROG#<course>#<unit>
    // byCourse inverts the key so "who is on course X" is one query — needed by the
    // admin screen even though there is no reporting view.
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
        emailSubject: 'Your ICE course account',
        emailBody: 'Hello {username}, your ICE practice platform account is ready. ' +
          'Your temporary password is {####}. You will be asked to change it when you first sign in.',
      },
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
    const fn = (id, dir, environment) => new lambdaNode.NodejsFunction(this, id, {
      entry: path.join(HERE, '..', 'lambda', dir, 'index.mjs'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
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

    // Onboarding only - invite a user and put them on a course.
    const admin = fn('Admin', 'admin', { USER_POOL_ID: users.userPoolId });
    table.grantReadWriteData(admin);
    admin.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminGetUser'],
      resources: [users.userPoolArn],
    }));

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
    // The admin group check happens inside the function - a JWT authorizer can't see groups.
    api.addRoutes({
      path: '/api/admin/enrolments',
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AdminIntegration', admin),
    });

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
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
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
        : 'NOT CONFIGURED - if this pool has no admin, redeploy with -c adminEmail=you@icemalta.com',
    });
    new CfnOutput(this, 'UserPoolClientId', { value: client.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'PublisherRoleArn', { value: publisher.roleArn });
  }
}
