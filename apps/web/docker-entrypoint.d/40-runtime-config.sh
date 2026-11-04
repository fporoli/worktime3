#!/bin/sh
# Runs at container start (nginx's /docker-entrypoint.d hook). The image is built with the
# placeholders below in place of real URLs (see .github/workflows/build-push.yml), so one image
# serves every instance; each container swaps in its own values here. A variable left unset
# keeps its placeholder, which makes a misconfigured deploy fail visibly instead of silently.
set -eu
dir=/usr/share/nginx/html
replace() {
  [ -n "${2:-}" ] || return 0
  # `|` delimiter because URLs contain `/`; values must not contain `|` or `&`.
  find "$dir" -name '*.js' -exec sed -i "s|$1|$2|g" {} +
}
replace __WT_API_URL__ "${WT_API_URL:-}"
replace __WT_KEYCLOAK_URL__ "${WT_KEYCLOAK_URL:-}"
replace __WT_SHOW_DEMO_ACCOUNTS__ "${WT_SHOW_DEMO_ACCOUNTS:-}"
