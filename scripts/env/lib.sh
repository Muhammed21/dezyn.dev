# shellcheck shell=bash
# Bibliothèque chargée par source : ses constantes et failed sont lues par les scripts appelants.
# shellcheck disable=SC2034
NEONCTL_VERSION=2.47.0
DEMO_EMAIL=dev@dezyn.test
REFUSED=3
ALREADY_SEEDED=3
PRIVILEGED=4
ROLES="migrator app history_maintainer"

neon() {
  npx --yes "neonctl@$NEONCTL_VERSION" "$@"
}

require_terminal() {
  if [ ! -t 0 ]; then
    echo "Lancer cette commande dans un terminal : elle demande des valeurs masquées." >&2
    exit 1
  fi
}

require_neon_login() {
  if ! neon me > /dev/null 2>&1; then
    echo "Neon : lancer d'abord npx neonctl@$NEONCTL_VERSION auth" >&2
    exit 1
  fi
}

confirm() {
  local answer
  read -r -p "$1 [o/N] " answer
  [ "$answer" = o ] || [ "$answer" = O ]
}

secret_to_set() {
  ! gh secret list --env "$1" --json name --jq '.[].name' | grep -qx "$2" ||
    confirm "$2 existe déjà. Le remplacer ?"
}

next_secret_version() {
  sed -nE 's/^BETTER_AUTH_SECRET_([1-9][0-9]*)$/\1/p' | awk '$1 > max { max = $1 } END { print max + 1 }'
}

secrets_for_versions() {
  sed -E 's/^legacy$/BETTER_AUTH_SECRET/; s/^([0-9]+)$/BETTER_AUTH_SECRET_\1/'
}

retirable_secret_versions() {
  sed -nE 's/^BETTER_AUTH_SECRET_([1-9][0-9]*)$/\1/p' <<< "$1" | sort -n | sed '$d' |
    grep -vxF -f <(printf '%s\n' "$2") | sed 's/^/BETTER_AUTH_SECRET_/' || true
}

stale_secret_versions() {
  grep -vxF -e "$2" <<< "$1" || true
}

reserve_to_main() {
  local environment
  environment="repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/environments/$1"
  gh api -X PUT "$environment" \
    -F "deployment_branch_policy[protected_branches]=false" \
    -F "deployment_branch_policy[custom_branch_policies]=true" > /dev/null
  if ! gh api "$environment/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
    gh api -X POST "$environment/deployment-branch-policies" -f name=main -f type=branch > /dev/null
  fi
  echo "Environnement GitHub $1, réservé à main"
}

preview_variable() {
  gh variable get "$1" --env preview
}

owner_url() {
  neon connection-string "$2" --project-id "$1" --role-name "${NEON_OWNER_ROLE:-neondb_owner}"
}

role_url() {
  sed -E "s#//[^@]*@#//$2:$3@#" <<< "$1"
}

provision_roles() {
  DATABASE_URL_OWNER=$1 \
    PASSWORD_MIGRATOR=$2 \
    PASSWORD_APP=$3 \
    PASSWORD_HISTORY_MAINTAINER=$4 \
    node packages/db/scripts/provision-roles.ts
}

PRODUCTION_BRANCH=production
HEALTH_URL=https://api.dezyn.dev/health
HYPERDRIVE_ID=ed807e2d1a7e437f9a17bb749123c6d2
failed=0

verify_full() {
  sed 's/sslmode=require/sslmode=verify-full/'
}

neon_role_url() {
  neon connection-string "$2" --project-id "$1" --role-name "$3" | verify_full
}

inspect_roles() {
  DATABASE_URL_MIGRATOR=$1 node packages/db/scripts/replace-role.ts inspect
}

expire_signing_keys() {
  DATABASE_URL_MIGRATOR=$1 node packages/db/scripts/expire-signing-keys.ts
}

secret_versions_in_use() {
  DATABASE_URL=$1 node packages/db/scripts/secret-versions.ts
}

wrangler_api() {
  (cd apps/api && pnpm exec wrangler "$@")
}

worker_secret_names() {
  local listed
  listed=$(wrangler_api secret list --env="" --format json 2> /dev/null) || return 1
  jq -r '.[].name' <<< "$listed" 2> /dev/null
}

check() {
  if [ "$2" = "$3" ]; then
    echo "OK  $1"
  else
    echo "ÉCHEC  $1 : ${2:-absent}" >&2
    failed=1
  fi
}

info() {
  echo "INFO  $1"
}

check_roles() {
  check "aucun rôle privilégié" "$(jq -r '.privileged | join(" ")' <<< "$1")" ""
  check "tout appartient à migrator" "$(jq -r '.foreign | join(" ")' <<< "$1")" ""
  check "app ne fait qu'ajouter à l'historique" "$(jq -r '.history | join(" ")' <<< "$1")" "INSERT"
}

POLAR_SECRETS="POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_TEAM_PRODUCT_ID POLAR_SERVER"
POLAR_WEBHOOK_URL=https://api.dezyn.dev/webhooks/polar

polar_configuration() {
  local name missing=() present=0
  for name in $POLAR_SECRETS; do
    if grep -qx "$name" <<< "$1"; then
      present=$((present + 1))
    else
      missing+=("$name")
    fi
  done
  if [ "$present" -eq 0 ]; then
    echo absente
  elif [ "${#missing[@]}" -eq 0 ]; then
    echo complète
  else
    echo "partielle, manquent ${missing[*]}"
  fi
}

polar_secrets_json() {
  jq -cn '{
    POLAR_ACCESS_TOKEN: $ENV.POLAR_ACCESS_TOKEN,
    POLAR_WEBHOOK_SECRET: $ENV.POLAR_WEBHOOK_SECRET,
    POLAR_TEAM_PRODUCT_ID: $ENV.POLAR_TEAM_PRODUCT_ID,
    POLAR_SERVER: $ENV.POLAR_SERVER
  }'
}

polar_removal_json() {
  jq -cn --arg names "$POLAR_SECRETS" '$names | split(" ") | map({ (.): null }) | add'
}

ended_team_spaces() {
  DATABASE_URL=$1 node packages/db/scripts/ended-team-spaces.ts
}

dezyn_extension_carriers() {
  DATABASE_URL=$1 node packages/db/scripts/dezyn-extension-carriers.ts
}

polar_webhook_status() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
    -H 'content-type: application/json' --data '{}' "$POLAR_WEBHOOK_URL" || true
}
