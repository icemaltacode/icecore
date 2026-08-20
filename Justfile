# icecore — task runner.
#
# There is one environment. No dev/staging/prod split: `just deploy` publishes live.
# AWS goes through the `ice` profile for every recipe.

export AWS_PROFILE := "ice"

# The course repo to build against. Override per invocation:
#   just course=../icecore-some-other-course dev
course := "../icecore-datacamp-data-analyst"

icecore := "node " + justfile_directory() + "/bin/icecore.mjs"

_default:
    @just --list --unsorted

# --- local -----------------------------------------------------------------

# Run the player against the course content, with hot reload.
dev:
    {{icecore}} dev {{course}}/content

# Same server, but signed in - a fake session, no Cognito, no AWS. This is the one that
# shows the student's actual view: `just dev` runs *open*, and open hides the tutor button,
# the course filter, sign-out and the admin panel. Roles: student (default), admin, signin.
# In `signin` any password gets you in, except `temp`, which raises the first-login
# choose-a-password screen.
preview role="student":
    {{icecore}} dev {{course}}/content --as {{role}}

# Every reference solution must grade itself correct, and a wrong query must fail.
verify:
    {{icecore}} verify {{course}}/content

# Publish content as static files into dist/content/.
build:
    {{icecore}} build {{course}}/content

# Decks are only picked up if already built — run `just decks` first, or use `just deploy`.
# Build the full deployable site — app + content — into dist/.
bundle:
    {{icecore}} bundle {{course}}/content

# Run the course's Slidev deck in a dev server.
slides:
    cd {{course}} && npm run slides

# `bundle` and `build` only discover decks something else has already written, so anything
# that publishes comes through here first or ships a course with no slides and says nothing.
# Build the course's per-unit slide decks into its content/slides/.
decks:
    #!/usr/bin/env bash
    set -euo pipefail
    if ! node -e "process.exit(require('{{justfile_directory()}}/{{course}}/package.json').scripts?.['slides:build'] ? 0 : 1)"; then
      echo "warning: {{course}} has no slides:build script - publishing without decks" >&2
      exit 0
    fi
    npm --prefix {{course}} run slides:build

clean:
    rm -rf dist {{course}}/.icecore

# --- infrastructure --------------------------------------------------------

# Generate the CloudFront signing pair — run once, before the first infra-deploy.
keys:
    #!/usr/bin/env bash
    set -euo pipefail
    cd infra
    if [[ -f cloudfront-public-key.pem ]]; then
      echo "cloudfront-public-key.pem already exists — delete it first if you really mean to rotate." >&2
      exit 1
    fi
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    openssl genrsa -out "$tmp/private.pem" 2048
    openssl rsa -pubout -in "$tmp/private.pem" -out cloudfront-public-key.pem
    aws secretsmanager create-secret \
      --name icecore/cloudfront-signing-key \
      --description "CloudFront private key for signing content cookies" \
      --secret-string "file://$tmp/private.pem" >/dev/null
    echo "wrote infra/cloudfront-public-key.pem and stored the private key in Secrets Manager."

# One-off per account+region, before the first infra-deploy.
infra-bootstrap:
    cd infra && npx cdk bootstrap

# Show what a deploy would change.
infra-diff:
    cd infra && npx cdk diff

# Create or update the stack.
infra-deploy:
    cd infra && npx cdk deploy --require-approval any-change

infra-synth:
    cd infra && npx cdk synth

# Store the OpenAI API key in Secrets Manager, read from stdin (see the recipe body).
openai-key:
    #!/usr/bin/env bash
    set -euo pipefail
    key=$(cat)
    [[ -n "$key" ]] || { echo "nothing on stdin" >&2; exit 1; }
    if aws secretsmanager describe-secret --secret-id icecore/openai-api-key >/dev/null 2>&1; then
      aws secretsmanager put-secret-value --secret-id icecore/openai-api-key --secret-string "$key" >/dev/null
      echo "updated icecore/openai-api-key"
    else
      aws secretsmanager create-secret --name icecore/openai-api-key \
        --description "OpenAI key used by the hint Lambda" --secret-string "$key" >/dev/null
      echo "created icecore/openai-api-key"
    fi

# --- publishing ------------------------------------------------------------

# This is the only thing that publishes the *app* — index.html, its bundle and auth.json
# all come from here. The GitHub Actions workflow in a course repo publishes content and
# decks only, and assumes the app is already in place; on an empty bucket it leaves
# CloudFront answering Access Denied with nothing to explain why. So run this once before
# CI is any use, and again whenever the player itself changes.
# Build everything and push it live. This IS production, and the only way the app ships.
deploy: verify decks bundle _auth-json
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _targets)"
    aws s3 sync dist/ "s3://$bucket/" --delete
    aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*' >/dev/null
    echo "live: https://$(aws cloudfront get-distribution --id "$dist" --query 'Distribution.DomainName' --output text)"

# Push content and slides only — no app rebuild. The usual path for fixing an exercise.
deploy-content: decks build
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _targets)"
    aws s3 sync dist/content/ "s3://$bucket/content/" --delete
    # Decks are built by the course repo and published alongside the content, so a content
    # push has to carry them too, or a corrected slide never reaches anyone.
    [ -d dist/slides ] && aws s3 sync dist/slides/ "s3://$bucket/slides/" --delete || true
    aws cloudfront create-invalidation --distribution-id "$dist" --paths '/content/*' '/slides/*' >/dev/null
    echo "content live."

# Write dist/auth.json from the stack outputs. The app reads it at boot; without it the
# player runs open, which is what makes `just dev` work with no AWS account at all.
_auth-json:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r pool client < <(aws cloudformation describe-stacks --stack-name Icecore \
      --query "Stacks[0].[Outputs[?OutputKey=='UserPoolId'].OutputValue|[0],\
                          Outputs[?OutputKey=='UserPoolClientId'].OutputValue|[0]]" \
      --output text)
    printf '{"userPoolId":"%s","clientId":"%s","region":"%s"}\n' \
      "$pool" "$client" "$(aws configure get region)" > dist/auth.json
    echo "wrote dist/auth.json for user pool $pool"

# Where to publish. Read from the stack rather than asked for: they are outputs of the
# deploy that created them, and a hand-set bucket name is one typo from a silent no-op.
_targets:
    #!/usr/bin/env bash
    set -euo pipefail
    bucket="${ICECORE_SITE_BUCKET:-}"; dist="${ICECORE_DISTRIBUTION:-}"
    if [[ -z "$bucket" || -z "$dist" ]]; then
      read -r bucket dist < <(aws cloudformation describe-stacks --stack-name Icecore \
        --query "Stacks[0].[Outputs[?OutputKey=='SiteBucket'].OutputValue|[0],\
                            Outputs[?OutputKey=='DistributionId'].OutputValue|[0]]" \
        --output text 2>/dev/null || echo "None None")
    fi
    if [[ -z "$bucket" || "$bucket" == "None" || "$dist" == "None" ]]; then
      echo "Could not read SiteBucket/DistributionId from the Icecore stack." >&2
      echo "Deploy it first with \`just infra-deploy\`." >&2
      exit 1
    fi
    printf 'bucket=%q; dist=%q\n' "$bucket" "$dist"

# Who am I deploying as?
whoami:
    aws sts get-caller-identity
