#!/usr/bin/env bash
# Tier floor of a PR from the paths it changes, read from .github/labeler.yml.
# Source it, then: review_floor CONFIG < changed-files. Prints critical, standard, or nothing.
# Globs: ** spans directories, * stays inside one; brackets and braces are not supported.

floor_globs() {
  awk -v key="$2:" '
    /^[^ #]/ { inside = ($0 == key) }
    inside && /^ +- / { sub(/^ +- /, ""); gsub(/"/, ""); print }
  ' "$1"
}

glob_regex() {
  printf '%s' "$1" | sed -E \
    -e 's/[.+?(){}|^$]/\\&/g' \
    -e 's#\*\*/#@DIRS@#g' \
    -e 's#\*\*#@ANY@#g' \
    -e 's#\*#[^/]*#g' \
    -e 's#@DIRS@#(.*/)?#g' \
    -e 's#@ANY@#.*#g'
}

review_floor() {
  local config="$1" files tier glob
  files=$(cat)
  for tier in critical standard; do
    while IFS= read -r glob; do
      if grep -Eq "^$(glob_regex "$glob")\$" <<<"$files"; then
        echo "$tier"
        return
      fi
    done < <(floor_globs "$config" "review:$tier")
  done
}
