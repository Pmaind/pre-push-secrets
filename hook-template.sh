#!/bin/sh
# push-sentinel
#
# Git passes pushed ref information via stdin, one line per ref being pushed:
#   <local-ref> <local-sha1> <remote-ref> <remote-sha1>
#
# We read each line and pass the SHAs explicitly so push-sentinel can compute
# the exact range of commits being pushed (including new branch / first push).
# Stdin is saved and re-supplied to pre-push.local so existing hooks still work.

EXIT_CODE=0
STDIN_DATA=""

while read local_ref local_sha remote_ref remote_sha; do
  STDIN_DATA="${STDIN_DATA}${local_ref} ${local_sha} ${remote_ref} ${remote_sha}
"
  npx --yes --prefer-online push-sentinel@latest scan --local-sha "$local_sha" --remote-sha "$remote_sha"
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    EXIT_CODE=$RESULT
  fi
done

if [ $EXIT_CODE -ne 0 ]; then
  exit $EXIT_CODE
fi

if [ -f "$(git rev-parse --git-dir)/hooks/pre-push.local" ]; then
  echo "$STDIN_DATA" | "$(git rev-parse --git-dir)/hooks/pre-push.local" "$@"
fi
