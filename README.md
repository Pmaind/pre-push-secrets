# push-sentinel

**Catches secrets in your git commits before they leave your machine.**

You've seen the stories. Someone pushes an AWS key to a public repo. Bots scrape GitHub in seconds. The bill arrives the next morning: $8,000.

push-sentinel sits in your `pre-push` hook and warns you before that happens.

```
$ git push

[push-sentinel] ⚠ Potential secrets found:

  [HIGH] src/config.ts:12
  AKIAIO...
  → Risk: Full access to AWS resources. Attacker can create/delete
           instances, incur charges, or exfiltrate data.
  → To ignore this line: push-sentinel ignore src/config.ts:12

  Push continues. Double-check before sharing.
```

## Install

```sh
npx --yes --prefer-online push-sentinel@latest install
```

That's it. Runs automatically on every `git push` from now on.

## What it detects

| Pattern | Severity |
|---------|----------|
| Private Key (RSA, EC, OPENSSH, DSA, PKCS#8) | 🔴 HIGH |
| AWS Access Key (`AKIA...`) | 🔴 HIGH |
| AWS Secret Key (entropy-based) | 🔴 HIGH |
| GitHub Token (`ghp_`, `github_pat_`) | 🔴 HIGH |
| Anthropic API Key (`sk-ant-...`) | 🟡 MEDIUM |
| OpenAI API Key (`sk-...`) | 🟡 MEDIUM |
| Generic API Key (variable name + high entropy) | 🟢 LOW |
| `.env` file committed | 🟡 MEDIUM |

## False positive? Ignore it in one command

```sh
push-sentinel ignore src/config.ts:12          # ignore a specific line
push-sentinel ignore --pattern OPENAI_API_KEY  # ignore a pattern everywhere
push-sentinel ignore --list                    # see all ignore rules
```

Rules are saved to `.push-sentinel-ignore` in your repo root.

## Why warning-only by default?

Blocking pushes creates friction. Friction leads to `--no-verify`. A warning at push time is early enough to catch real accidents — and you'll actually leave it installed.

Want hard blocking for HIGH findings? Add `--block-on-high`:

```sh
# edit .git/hooks/pre-push, change the scan line to:
npx --yes --prefer-online push-sentinel@latest scan --local-sha "$local_sha" --remote-sha "$remote_sha" --block-on-high
```

## Manual scan

```sh
npx --yes --prefer-online push-sentinel@latest scan
```

Manual scan checks, in order:

- commits not yet pushed to your upstream
- staged changes
- unstaged working tree changes
- the last commit as a final fallback

## Uninstall

```sh
npx --yes --prefer-online push-sentinel@latest uninstall
```

Your original `pre-push` hook is restored automatically.

## Details

- Scans only the commits being pushed — not your entire history
- Zero dependencies (Node.js stdlib only)
- Node.js >= 16
- Existing `pre-push` hooks are preserved and still run
- For the most predictable versioning in a repo, install as a dev dependency and run the local binary via `npx push-sentinel`
