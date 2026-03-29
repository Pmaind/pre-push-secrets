#!/bin/sh
# push-sentinel
#
# Git passes pushed ref information via stdin, one line per ref being pushed:
#   <local-ref> <local-sha1> <remote-ref> <remote-sha1>
#
# We read each line and pass the SHAs explicitly so push-sentinel can compute
# the exact range of commits being pushed (including new branch / first push).

EXIT_CODE=0

while read local_ref local_sha remote_ref remote_sha; do
  npx push-sentinel scan --local-sha "$local_sha" --remote-sha "$remote_sha"
  RESULT=$?
  if [ $RESULT -ne 0 ]; then
    EXIT_CODE=$RESULT
  fi
done

if [ $EXIT_CODE -ne 0 ]; then
  exit $EXIT_CODE
fi

if [ -f "$(git rev-parse --git-dir)/hooks/pre-push.local" ]; then
  "$(git rev-parse --git-dir)/hooks/pre-push.local" "$@"
fi
