# push-sentinel

Warns you if secrets are in your git commits before push.

## What it does

Scans the commits you are about to push for potential secrets (API keys, private keys, tokens) and prints a warning. **It does not block the push by default** — it is a safety net, not a gatekeeper.

## Install

```sh
npx push-sentinel install
```

This writes a `pre-push` hook to `.git/hooks/`. Any existing hook is preserved as `pre-push.local` and called automatically after the scan.

## Usage

### Automatic (after install)

The hook runs on every `git push`. No action required.

```
[push-sentinel] ⚠ Potential secrets found:

  [HIGH] src/config.ts:12
  AKIAIO...
  → Risk: Full access to AWS resources. Attacker can create/delete instances, incur charges, or exfiltrate data.
  → To ignore this line: push-sentinel ignore src/config.ts:12

  Push continues. Double-check before sharing.
```

### Manual scan

```sh
npx push-sentinel scan
```

### Block push on HIGH findings

To treat HIGH severity findings as blocking errors, edit `.git/hooks/pre-push` and change the scan line to:

```sh
npx push-sentinel scan --local-sha "$local_sha" --remote-sha "$remote_sha" --block-on-high
```

## Suppressing false positives

```sh
# Ignore a specific line
push-sentinel ignore src/config.ts:12

# Ignore all matches of a pattern name
push-sentinel ignore --pattern OPENAI_API_KEY

# List current ignore rules
push-sentinel ignore --list

# Remove a rule
push-sentinel ignore --remove OPENAI_API_KEY
```

Rules are saved to `.push-sentinel-ignore` in the repo root. Add it to `.gitignore` or commit it — your choice.

## Detected patterns

| Pattern | Severity |
|---------|----------|
| Private Key (RSA, EC, OPENSSH, DSA, PKCS#8) | HIGH |
| AWS Access Key (`AKIA...`) | HIGH |
| AWS Secret Key (entropy-based) | HIGH |
| GitHub Token (`ghp_`, `github_pat_`) | HIGH |
| Anthropic API Key (`sk-ant-...`) | MEDIUM |
| OpenAI API Key (`sk-...`) | MEDIUM |
| Generic API Key (variable name + high entropy) | LOW |
| `.env` file committed | MEDIUM |

## Non-blocking design

push-sentinel warns — it does not block — because:

- Blocking creates friction that causes developers to skip or uninstall the hook
- A warning seen at push time is still early enough to catch accidental leaks
- Use `--block-on-high` if you want stricter enforcement for HIGH-severity findings

## Uninstall

```sh
npx push-sentinel uninstall
```

The original `pre-push` hook (if any) is automatically restored.

## Requirements

- Node.js >= 16
- No additional dependencies
