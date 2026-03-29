'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SENTINEL_MARKER = '# push-sentinel';

function getGitDir() {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Not inside a git repository.');
  }
}

function getHookPath(gitDir) {
  return path.join(gitDir, 'hooks', 'pre-push');
}

function getLocalHookPath(gitDir) {
  return path.join(gitDir, 'hooks', 'pre-push.local');
}

// Wrapper hook content (spec 4.2)
// Reads git's stdin (one line per ref being pushed) and passes each SHA pair
// to push-sentinel so it can compute the exact commit range being pushed.
function hookContent() {
  return `#!/bin/sh
${SENTINEL_MARKER}
#
# Git passes pushed ref information via stdin, one line per ref:
#   <local-ref> <local-sha1> <remote-ref> <remote-sha1>
# We forward the SHAs so push-sentinel can determine exactly which commits
# are being pushed, including new branches (remote-sha = 0000...0000).
# Stdin is saved and re-supplied to pre-push.local so existing hooks still work.

EXIT_CODE=0
STDIN_DATA=""

while read local_ref local_sha remote_ref remote_sha; do
  STDIN_DATA="${'$'}{STDIN_DATA}${'$'}{local_ref} ${'$'}{local_sha} ${'$'}{remote_ref} ${'$'}{remote_sha}
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
`;
}

function install() {
  const gitDir = getGitDir();
  const hookPath = getHookPath(gitDir);
  const localPath = getLocalHookPath(gitDir);

  // Idempotency: already installed
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(SENTINEL_MARKER)) {
      console.log('[push-sentinel] Already installed.');
      return;
    }
    // Preserve existing hook as pre-push.local (spec 4.2)
    fs.renameSync(hookPath, localPath);
    fs.chmodSync(localPath, 0o755);
    console.log('[push-sentinel] Existing pre-push hook preserved as pre-push.local.');
  }

  fs.writeFileSync(hookPath, hookContent(), 'utf8');
  fs.chmodSync(hookPath, 0o755);
  console.log('[push-sentinel] Installed pre-push hook.');
  console.log('[push-sentinel] Tip: to block pushes on HIGH findings, edit the hook to use: npx --yes --prefer-online push-sentinel@latest scan --block-on-high');
}

function uninstall() {
  const gitDir = getGitDir();
  const hookPath = getHookPath(gitDir);
  const localPath = getLocalHookPath(gitDir);

  if (!fs.existsSync(hookPath)) {
    console.log('[push-sentinel] No pre-push hook found.');
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes(SENTINEL_MARKER)) {
    console.log('[push-sentinel] push-sentinel hook not found. Nothing to remove.');
    return;
  }

  fs.unlinkSync(hookPath);

  // Restore pre-push.local if it exists (spec 4.2)
  if (fs.existsSync(localPath)) {
    fs.renameSync(localPath, hookPath);
    console.log('[push-sentinel] Uninstalled. Original pre-push hook restored.');
  } else {
    console.log('[push-sentinel] Uninstalled.');
  }
}

module.exports = { install, uninstall };
