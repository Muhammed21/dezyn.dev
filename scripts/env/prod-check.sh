#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$(dirname "$0")/../.."

branch=${1:-$PRODUCTION_BRANCH}

require_neon_login
if ! gh auth status > /dev/null 2>&1; then
  echo "GitHub : lancer d'abord gh auth login" >&2
  exit 1
fi
if ! wrangler_api whoami 2> /dev/null | grep -q "You are logged in"; then
  echo "Cloudflare : lancer d'abord npx wrangler login dans apps/api" >&2
  exit 1
fi
project=$(preview_variable NEON_PROJECT_ID)

missing_from() {
  local present=$1 name missing=()
  shift
  for name in "$@"; do
    grep -qx "$name" <<< "$present" || missing+=("$name")
  done
  echo "${missing[*]:-}"
}

host_of() {
  sed -E 's#^[^@]*@([^/:?]*).*#\1#'
}

echo "Base, branche Neon $branch"
check_roles "$(inspect_roles "$(neon_role_url "$project" "$branch" migrator)")"
if ended=$(ended_team_spaces "$(neon_role_url "$project" "$branch" app)"); then
  check "aucun espace en Team avec un abonnement terminé" "$(tr '\n' ' ' <<< "$ended" | sed 's/ *$//')" ""
else
  check "aucun espace en Team avec un abonnement terminé" "lecture impossible" ""
fi
if carriers=$(dezyn_extension_carriers "$(neon_role_url "$project" "$branch" app)"); then
  check "aucun token ni proposition ne porte l'extension dev.dezyn" "$(tr '\n' ' ' <<< "$carriers" | sed 's/ *$//')" ""
else
  check "aucun token ni proposition ne porte l'extension dev.dezyn" "lecture impossible" ""
fi

versions_in_use=$(secret_versions_in_use "$(neon_role_url "$project" "$PRODUCTION_BRANCH" app)")

echo "GitHub"
github_secrets=$(gh secret list --env production --json name --jq '.[].name' 2> /dev/null || true)
check "secrets de l'environnement production" \
  "$(missing_from "$github_secrets" DATABASE_URL_MIGRATOR CLOUDFLARE_API_TOKEN)" ""
deploy_enabled=$(gh variable get DEPLOY_ENABLED 2> /dev/null || true)
case $deploy_enabled in
  true | false)
    check "DEPLOY_ENABLED vaut true ou false" ok ok
    info "DEPLOY_ENABLED=$deploy_enabled"
    ;;
  *) check "DEPLOY_ENABLED vaut true ou false" "$deploy_enabled" "true ou false" ;;
esac

echo "Worker dezyn-api"
if worker_secrets=$(worker_secret_names); then
  worker_read=ok
else
  worker_read="impossible, Cloudflare injoignable ou jeton refusé"
  worker_secrets=""
fi
check "lecture des secrets du Worker" "$worker_read" ok
check "secrets du Worker" "$(missing_from "$worker_secrets" BETTER_AUTH_SECRET)" ""
# shellcheck disable=SC2046
check "secrets dont dépendent les clés de signature valides" \
  "$(missing_from "$worker_secrets" $(secrets_for_versions <<< "$versions_in_use"))" ""
retirable=$(retirable_secret_versions "$worker_secrets" "$versions_in_use")
if [ -n "$retirable" ]; then
  info "Versions retirables, aucune clé valide n'en dépend : $(tr '\n' ' ' <<< "$retirable")"
fi
if [ -n "$(missing_from "$worker_secrets" RESEND_API_KEY)" ]; then
  info "RESEND_API_KEY absent : les emails ne partent pas, chacun est journalisé « email not sent »"
fi

echo "Polar"
check "wrangler.jsonc ne déclare aucune var POLAR_*, toutes sont des secrets du Worker" \
  "$(grep -o '"POLAR_[A-Z_]*"' apps/api/wrangler.jsonc | tr '\n' ' ' || true)" ""
polar=$(polar_configuration "$worker_secrets")
[ "$worker_read" = ok ] || polar="inconnue, secrets du Worker illisibles"
case $polar in
  absente)
    info "Paiement désactivé : aucun secret POLAR_* sur le Worker, à poser par pnpm polar:production"
    ;;
  complète)
    check "secrets Polar du Worker : les quatre" ok ok
    check "$POLAR_WEBHOOK_URL refuse un événement non signé" "$(polar_webhook_status)" 401
    ;;
  *) check "secrets Polar du Worker : les quatre ou aucun" "$polar" "" ;;
esac

echo "Hyperdrive $HYPERDRIVE_ID"
origin=$(wrangler_api hyperdrive get "$HYPERDRIVE_ID" 2> /dev/null | sed -n '/^{/,$p' | jq -c '.origin | {user, host}' || true)
check "Hyperdrive se connecte en app" "$(jq -r '.user // empty' <<< "$origin")" app
production_host=$(neon_role_url "$project" "$PRODUCTION_BRANCH" app | host_of)
if [ "$(jq -r '.host // empty' <<< "$origin")" = "$production_host" ]; then
  check "Hyperdrive vise le compute de la branche $PRODUCTION_BRANCH" ok ok
else
  check "Hyperdrive vise le compute de la branche $PRODUCTION_BRANCH" "un autre hôte" "ok"
fi

echo "API"
check "$HEALTH_URL répond 200" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || true)" 200

exit "$failed"
