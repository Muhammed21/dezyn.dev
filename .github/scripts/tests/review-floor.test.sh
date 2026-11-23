#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
# shellcheck source=../review-floor.sh
source "$ROOT/.github/scripts/review-floor.sh"

CONFIG="$ROOT/.github/labeler.yml"
failures=0
expect_floor() {
  local label="$1" files="$2" expected="$3" config="${4:-$CONFIG}" actual
  actual=$(printf '%s' "$files" | review_floor "$config")
  if [ "$actual" = "$expected" ]; then
    printf '  ok    %s\n' "$label"
  else
    printf '  FAIL  %s : %q attendu, %q obtenu\n' "$label" "$expected" "$actual"
    failures=$((failures + 1))
  fi
}

echo "review_floor"
expect_floor "une migration est critical" "packages/db/migrations/0027_x.sql" critical
expect_floor "un workflow est critical" ".github/workflows/ci.yml" critical
expect_floor "un fichier à la racine nommé dans la liste est critical" ".oxlintrc.json" critical
expect_floor "** couvre zéro dossier" "apps/api/auth/session.ts" critical
expect_floor "** couvre plusieurs dossiers" "apps/api/src/modules/auth/domain/x.ts" critical
expect_floor "le code d'une app est standard" "apps/web/src/main.tsx" standard
expect_floor "un ADR est standard" "docs/adr/0053-x.md" standard
expect_floor "compose.yaml est standard" "compose.yaml" standard
expect_floor "la documentation hors ADR n'a pas de plancher" "docs/agents/domain.md" ""
expect_floor "aucun fichier, aucun plancher" "" ""
expect_floor "le plus haut palier l'emporte" $'docs/x.md\napps/web/a.ts\n.github/scripts/x.sh' critical
expect_floor "un point du motif ne vaut pas n'importe quel caractère" "xoxlintrc.json" ""
expect_floor "un nom qui commence comme un motif sans le suivre n'a pas de plancher" "compose.yaml.bak" ""
expect_floor "un dossier voisin du motif n'en fait pas partie" "docs/adrx/0053.md" ""
expect_floor "un chemin qui contient auth sans en être un dossier n'est pas critical" \
  "apps/api/src/author.ts" standard
expect_floor "un motif ne commence pas au milieu d'un chemin" "docs/apps/notes.md" ""
expect_floor "un dossier dont le nom finit par auth n'est pas auth" "apps/api/src/oauth/x.ts" standard

SINGLE_STAR_CONFIG=$(mktemp)
trap 'rm -f "$SINGLE_STAR_CONFIG"' EXIT
printf 'review:standard:\n# un commentaire ne ferme pas la section\n  - changed-files:\n      - any-glob-to-any-file:\n          - docs/*.md\n' >"$SINGLE_STAR_CONFIG"
expect_floor "* couvre un nom dans un dossier" "docs/notes.md" standard "$SINGLE_STAR_CONFIG"
expect_floor "* ne traverse pas un dossier" "docs/adr/notes.md" "" "$SINGLE_STAR_CONFIG"

[ "$failures" -eq 0 ] || exit 1
