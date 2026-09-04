#!/usr/bin/env node
/* CDK entry point. One stack, one environment — see backlog.md: there is no dev/prod split. */
import { App } from 'aws-cdk-lib';
import { IcecoreStack } from '../lib/icecore-stack.js';

const app = new App();

// Account and region come from the profile the CDK CLI was invoked with - the Justfile
// exports AWS_PROFILE=ice, which resolves to eu-south-1. Never hardcode a fallback here:
// the secrets are created with the same profile, and a stack that lands in a different
// region than its secrets fails at runtime rather than at deploy.
const { CDK_DEFAULT_ACCOUNT: account, CDK_DEFAULT_REGION: region } = process.env;
if (!account || !region)
  throw new Error('No AWS account or region resolved. Run through `just`, or set AWS_PROFILE=ice.');

new IcecoreStack(app, 'Icecore', {
  env: { account, region },
  /* ASCII ONLY, AND THE HYPHEN IS THE POINT. This was an em-dash, and a stack
   * description goes to CloudFormation and comes back through `cdk diff`'s own
   * renderer, which mangles it - so every diff reported the description as CHANGED,
   * for ever, against a template that had not moved. CDK hides it behind "Omitted 1
   * changes because they are likely mangled non-ASCII characters", which is worse than
   * showing it: a diff that always says one stack differs cannot be read as "nothing to
   * deploy", and the one line it hides is the one nobody can check. */
  description: 'ICE practice platform - static site, private content, auth',
});
