# icecore — task runner.
#
# There is one environment. No dev/staging/prod split: `just deploy` publishes live.
# AWS goes through the `ice` profile for every recipe.

export AWS_PROFILE := "ice"

# The course repo to build against. Override per invocation:
#   just course=../icecore-some-other-course dev
course := "../icecore-datacamp-data-analyst"

# Filled in once the CDK stack has been deployed once.
site_bucket    := env_var_or_default("ICECORE_SITE_BUCKET", "")
distribution   := env_var_or_default("ICECORE_DISTRIBUTION", "")

icecore := "node " + justfile_directory() + "/bin/icecore.mjs"

_default:
    @just --list --unsorted

# --- local -----------------------------------------------------------------

# Run the player against the course content, with hot reload.
dev:
    {{icecore}} dev {{course}}/content

# Every reference solution must grade itself correct, and a wrong query must fail.
verify:
    {{icecore}} verify {{course}}/content

# Publish content as static files into dist/content/.
build:
    {{icecore}} build {{course}}/content

# Build the full deployable site — app + content — into dist/.
bundle:
    {{icecore}} bundle {{course}}/content

# Run the course's Slidev deck (per-unit static build still to be written).
slides:
    cd {{course}} && npm run slides

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

# Build everything and push it live. This IS production.
deploy: verify bundle _auth-json _require-targets
    aws s3 sync dist/ s3://{{site_bucket}}/ --delete
    aws cloudfront create-invalidation --distribution-id {{distribution}} --paths '/*'
    @echo "live."

# Push content and slides only — no app rebuild. The usual path for fixing an exercise.
deploy-content: build _require-targets
    aws s3 sync dist/content/ s3://{{site_bucket}}/content/ --delete
    # Decks are built by the course repo and published alongside the content, so a content
    # push has to carry them too, or a corrected slide never reaches anyone.
    [ -d dist/slides ] && aws s3 sync dist/slides/ s3://{{site_bucket}}/slides/ --delete || true
    aws cloudfront create-invalidation --distribution-id {{distribution}} --paths '/content/*' '/slides/*'
    @echo "content live."

# Write dist/auth.json from the stack outputs. The app reads it at boot; without it the
# player runs open, which is what makes `just dev` work with no AWS account at all.
_auth-json:
    #!/usr/bin/env bash
    set -euo pipefail
    read -r pool client region < <(aws cloudformation describe-stacks --stack-name Icecore \
      --query "Stacks[0].[Outputs[?OutputKey=='UserPoolId'].OutputValue|[0],\
                          Outputs[?OutputKey=='UserPoolClientId'].OutputValue|[0]]" \
      --output text | tr '\t' ' ' | awk -v r="$(aws configure get region)" '{print $1, $2, r}')
    printf '{"userPoolId":"%s","clientId":"%s","region":"%s"}\n' "$pool" "$client" "$region" > dist/auth.json
    echo "wrote dist/auth.json for user pool $pool"

_require-targets:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -z "{{site_bucket}}" || -z "{{distribution}}" ]]; then
      echo "Set ICECORE_SITE_BUCKET and ICECORE_DISTRIBUTION (from the CDK stack outputs)." >&2
      exit 1
    fi

# Who am I deploying as?
whoami:
    aws sts get-caller-identity
