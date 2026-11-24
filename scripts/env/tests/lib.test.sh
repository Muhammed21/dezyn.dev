#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=../lib.sh
source "$ROOT/scripts/env/lib.sh"

failures=0
expect_next_version() {
  local label="$1" names="$2" expected="$3" actual
  actual=$(printf '%s' "$names" | next_secret_version)
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %s\n' "$label"
  else
    printf '  FAIL  %s : %s attendu, %s obtenu\n' "$label" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

echo "next_secret_version"
expect_next_version "sans version, la première est 1" $'BETTER_AUTH_SECRET\nRESEND_API_KEY' 1
expect_next_version "sans aucun secret, la première est 1" "" 1
expect_next_version "après _2 vient _3" $'BETTER_AUTH_SECRET\nBETTER_AUTH_SECRET_2' 3
expect_next_version "les versions se comparent en nombres" $'BETTER_AUTH_SECRET_10\nBETTER_AUTH_SECRET_9' 11
expect_next_version "les noms hors format sont ignorés" \
  $'BETTER_AUTH_SECRET_3\nBETTER_AUTH_SECRET_X\nBETTER_AUTH_SECRET_0\nBETTER_AUTH_SECRET_07\nBETTER_AUTH_SECRET_99a\nXBETTER_AUTH_SECRET_50' 4

expect_output() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %s\n' "$label"
  else
    printf '  FAIL  %s : %q attendu, %q obtenu\n' "$label" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

echo "secrets_for_versions"
expect_output "legacy désigne BETTER_AUTH_SECRET, N désigne BETTER_AUTH_SECRET_N" \
  $'BETTER_AUTH_SECRET\nBETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_10' \
  "$(printf 'legacy\n2\n10' | secrets_for_versions)"
expect_output "aucune version, aucun secret" "" "$(printf '' | secrets_for_versions)"

echo "retirable_secret_versions"
expect_output "une version dont aucune clé ne dépend se retire" \
  BETTER_AUTH_SECRET_2 \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET\nBETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_3' 3)"
expect_output "une version dont une clé dépend reste" \
  "" \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_3' $'2\n3')"
expect_output "la version la plus haute reste, même sans clé" \
  BETTER_AUTH_SECRET_2 \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_10' legacy)"
expect_output "les versions à retirer sont rangées en nombres" \
  $'BETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_9\nBETTER_AUTH_SECRET_10' \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET_10\nBETTER_AUTH_SECRET_9\nBETTER_AUTH_SECRET_2\nBETTER_AUTH_SECRET_11' "")"
expect_output "BETTER_AUTH_SECRET et les noms hors format ne se retirent pas" \
  "" \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET\nBETTER_AUTH_SECRET_X\nBETTER_AUTH_SECRET_07\nRESEND_API_KEY\nBETTER_AUTH_SECRET_4' "")"
expect_output "la version 1 ne se confond pas avec la 10" \
  BETTER_AUTH_SECRET_1 \
  "$(retirable_secret_versions $'BETTER_AUTH_SECRET_1\nBETTER_AUTH_SECRET_10\nBETTER_AUTH_SECRET_11' 10)"

echo "stale_secret_versions"
expect_output "les versions autres que la courante restent à expirer" \
  $'legacy\n2' "$(stale_secret_versions $'legacy\n2\n3' 3)"
expect_output "seule la version courante, rien à expirer" "" "$(stale_secret_versions 3 3)"
expect_output "aucune clé valide, rien à expirer" "" "$(stale_secret_versions "" 3)"
expect_output "la version 13 ne se confond pas avec la 3" 13 "$(stale_secret_versions $'3\n13' 3)"

echo "polar_configuration"
expect_output "aucun secret Polar : configuration absente" absente \
  "$(polar_configuration $'BETTER_AUTH_SECRET\nRESEND_API_KEY')"
expect_output "aucun secret du tout : configuration absente" absente "$(polar_configuration "")"
expect_output "les quatre secrets Polar : configuration complète" complète \
  "$(polar_configuration $'BETTER_AUTH_SECRET\nPOLAR_SERVER\nPOLAR_TEAM_PRODUCT_ID\nPOLAR_WEBHOOK_SECRET\nPOLAR_ACCESS_TOKEN')"
expect_output "une partie seulement : nomme ceux qui manquent" \
  "partielle, manquent POLAR_WEBHOOK_SECRET POLAR_SERVER" \
  "$(polar_configuration $'POLAR_ACCESS_TOKEN\nPOLAR_TEAM_PRODUCT_ID')"
expect_output "un nom qui en prolonge un autre ne compte pas" \
  "partielle, manquent POLAR_ACCESS_TOKEN POLAR_WEBHOOK_SECRET POLAR_TEAM_PRODUCT_ID" \
  "$(polar_configuration $'POLAR_ACCESS_TOKEN_OLD\nPOLAR_SERVER')"

echo "polar_secrets_json"
expect_output "les quatre valeurs viennent de l'environnement, échappées en JSON" \
  '{"POLAR_ACCESS_TOKEN":"polar_oat_a\"b","POLAR_WEBHOOK_SECRET":"polar_whs_c\\d","POLAR_TEAM_PRODUCT_ID":"0b1c2d3e-0000-4000-8000-000000000001","POLAR_SERVER":"production"}' \
  "$(POLAR_ACCESS_TOKEN='polar_oat_a"b' POLAR_WEBHOOK_SECRET='polar_whs_c\d' \
    POLAR_TEAM_PRODUCT_ID=0b1c2d3e-0000-4000-8000-000000000001 POLAR_SERVER=production polar_secrets_json)"
expect_output "sans valeur, chaque secret est supprimé" \
  '{"POLAR_ACCESS_TOKEN":null,"POLAR_WEBHOOK_SECRET":null,"POLAR_TEAM_PRODUCT_ID":null,"POLAR_SERVER":null}' \
  "$(polar_removal_json)"

[ "$failures" -eq 0 ]

echo "worker_secret_names"
wrangler_api() { printf '[{"name":"BETTER_AUTH_SECRET","type":"secret_text"},{"name":"POLAR_SERVER","type":"secret_text"}]'; }
expect_output "liste les noms des secrets du Worker" $'BETTER_AUTH_SECRET\nPOLAR_SERVER' "$(worker_secret_names)"
wrangler_api() { return 1; }
if worker_secret_names > /dev/null; then
  printf '  FAIL  %s\n' "un échec de wrangler fait échouer la lecture, au lieu d'une liste vide"
  failures=$((failures + 1))
else
  printf '  ok    %s\n' "un échec de wrangler fait échouer la lecture, au lieu d'une liste vide"
fi
wrangler_api() { printf 'pas du JSON'; }
if worker_secret_names > /dev/null 2>&1; then
  printf '  FAIL  %s\n' "une réponse illisible fait échouer la lecture"
  failures=$((failures + 1))
else
  printf '  ok    %s\n' "une réponse illisible fait échouer la lecture"
fi

