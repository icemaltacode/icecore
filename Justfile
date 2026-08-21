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

# Carries whatever decks have been built into content/slides/; run `just decks` first if
# you want them fresh. The course still gets its Slides buttons either way.
# Build the full deployable site — app + content — into dist/.
bundle:
    {{icecore}} bundle {{course}}/content

# Run the course's Slidev deck in a dev server.
slides:
    cd {{course}} && npm run slides

# No longer a prerequisite of publishing: the Slides button is derived from the deck
# *sources* in slides/, so content can publish on its own and a deck that wasn't rebuilt
# keeps whatever is already live. Pass --since <sha> to build only what a change touched,
# or --list to see what would be built without building it.
# Build the course's per-topic slide decks into its content/slides/.
decks *args:
    {{icecore}} slides {{course}}/content {{args}}

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
#
# Pass admin= to create that person and put them in the `admins` group. Only the `admins`
# group can invite users or assign courses, and nothing else in this repo ever adds anyone
# to it - so a pool with no admin is a pool nobody can ever sign anyone in to, from a deploy
# that went green. Idempotent: naming someone who already exists promotes them.
#
#   just admin=you@icemalta.com infra-deploy
#
# Create or update the stack; admin= also bootstraps someone who can invite people.
infra-deploy admin="":
    cd infra && npx cdk deploy --require-approval any-change \
      {{ if admin == "" { "" } else { "-c adminEmail=" + admin } }}

# An email subscription does nothing until the recipient clicks the confirmation link AWS
# sends, and an unconfirmed one looks identical to a working one from the console. Anything
# other than a real ARN in the second column means the alarms reach nobody.
#
# Who actually receives the CloudWatch alarms.
alerts:
    #!/usr/bin/env bash
    set -euo pipefail
    topic=$(aws sns list-topics --query "Topics[?contains(TopicArn, ':Icecore-Alerts')].TopicArn" --output text)
    [[ -n "$topic" ]] || { echo "no alerts topic - is the stack deployed?" >&2; exit 1; }
    aws sns list-subscriptions-by-topic --topic-arn "$topic" \
      --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text \
      || echo "(nobody - the alarms fire into nothing)"

# Who can currently invite people. Empty output is the lockout, and it is silent otherwise.
admins:
    #!/usr/bin/env bash
    set -euo pipefail
    pool=$(aws cloudformation describe-stacks --stack-name Icecore \
             --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
    aws cognito-idp list-users-in-group --user-pool-id "$pool" --group-name admins \
      --query 'Users[].Username' --output text | tr '\t' '\n' | sed '/^$/d' \
      || echo "(none - nobody can invite anyone)"

# The deploy-time path is preferred - see infra-deploy - but this is the one to reach for
# when the pool is already up.
#
# Put an existing user in the `admins` group, so they can invite people.
grant-admin email:
    #!/usr/bin/env bash
    set -euo pipefail
    pool=$(aws cloudformation describe-stacks --stack-name Icecore \
             --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
    aws cognito-idp admin-add-user-to-group --user-pool-id "$pool" \
      --username '{{email}}' --group-name admins
    echo "{{email}} is now an admin"

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
deploy: bundle _auth-json
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _targets)"
    # THE PLAYER ONLY, AND NEVER --delete ACROSS THE WHOLE BUCKET.
    #
    # This used to be `aws s3 sync dist/ --delete` against the bucket root, which is right
    # while the site is one course and destructive the moment it isn't: dist/ holds the one
    # course this machine just built, so a root --delete removes every OTHER course's
    # content and every deck that wasn't rebuilt here. Exactly the trap publish.yml carries
    # two warnings about - this copy simply never got the fix, which is what a second copy
    # of a deployment path always eventually does.
    #
    # Content and decks now come from each course repo's own pipeline, one prefix at a
    # time. `verify` and `decks` are no longer prerequisites either: CI gates the grading,
    # and rebuilding 79 decks with their PDFs to publish an unchanged app is ten minutes
    # spent to upload nothing.
    aws s3 sync dist/ "s3://$bucket/" --delete --exclude 'content/*' --exclude 'slides/*'
    aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*' >/dev/null
    domain=$(aws cloudfront get-distribution --id "$dist" \
      --query 'Distribution.DistributionConfig.Aliases.Items[0]' --output text 2>/dev/null)
    [ "$domain" = "None" ] && domain=$(aws cloudfront get-distribution --id "$dist" \
      --query 'Distribution.DomainName' --output text)
    echo "live: https://$domain"

# Push content and slides only — no app rebuild. The usual path for fixing an exercise.
deploy-content: decks build
    #!/usr/bin/env bash
    set -euo pipefail
    eval "$(just _targets)"
    # ONE PREFIX PER COURSE, and one per deck. See the note on `deploy`: dist/ holds only
    # the course this ran against, so --delete against content/ or slides/ as a whole
    # removes everything else the site is serving. --delete is still right *within* one
    # course and one deck - a removed exercise should stop being served.
    for dir in dist/content/*/; do
      course=$(basename "$dir")
      echo "publishing content/$course"
      aws s3 sync "$dir" "s3://$bucket/content/$course/" --delete
    done
    # THE CATALOGUE IS ASSEMBLED, NOT UPLOADED. Each build writes a one-entry courses.json,
    # so publishing this machine's copy would leave the grid showing only the course it was
    # built against. Rebuilt from every card.json in the bucket instead, exactly as the
    # pipeline does it, so the two cannot disagree about what the site contains.
    cards=$(mktemp -d)
    for prefix in $(aws s3 ls "s3://$bucket/content/" | awk '/PRE/ {print $2}' | tr -d '/'); do
      aws s3 cp "s3://$bucket/content/$prefix/card.json" "$cards/$prefix.json" --quiet \
        || { echo "no card.json under content/$prefix - not a course, skipped"; continue; }
    done
    jq -s '.' "$cards"/*.json > "$cards/courses.json"
    echo "catalogue: $(jq -r 'map(.id) | join(", ")' "$cards/courses.json")"
    aws s3 cp "$cards/courses.json" "s3://$bucket/content/courses.json"
    if [ -d dist/slides ]; then
      for d in dist/slides/*/; do
        topic=$(basename "$d")
        echo "publishing slides/$topic"
        aws s3 sync "$d" "s3://$bucket/slides/$topic/" --delete
      done
    fi
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
