#!/bin/bash
# usage: PUSH_TOKEN=<token> with-token.sh <git command ...>
# Runs one git command with the access token in PUSH_TOKEN, for that command only. The workflows check the repositories out without keeping a token on disk (persist-credentials: false),
# and hand the token only to the step that pushes, so the steps that install packages and read other sites hold no write access to anything.
# The token travels the way actions/checkout sends it (an Authorization header for github.com); it is passed to git through the environment, so it appears in no command line and no file.
set -euo pipefail
: "${PUSH_TOKEN:?PUSH_TOKEN is not set (the token to push with)}"
[ $# -gt 0 ] || { echo "usage: with-token.sh <git command ...>" >&2; exit 2; }
host=${GITHUB_SERVER_URL:-https://github.com}
b64=$(printf 'x-access-token:%s' "$PUSH_TOKEN" | base64 | tr -d '\n')
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$b64"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.$host/.extraheader" GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $b64"
unset PUSH_TOKEN
exec "$@"
