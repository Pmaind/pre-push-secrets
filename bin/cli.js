#!/usr/bin/env node
'use strict';

const { install, uninstall } = require('../src/install');
const { scan } = require('../src/scan');
const { report, hasHighFindings } = require('../src/reporter');
const { getRepoRoot } = require('../src/utils');
const fs = require('fs');
const path = require('path');

const [, , command, ...args] = process.argv;

function getIgnoreFilePath() {
  return path.join(getRepoRoot(), '.push-sentinel-ignore');
}

function readIgnoreFile() {
  const p = getIgnoreFilePath();
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function writeIgnoreFile(content) {
  fs.writeFileSync(getIgnoreFilePath(), content, 'utf8');
}

function handleIgnore(args) {
  if (args.includes('--list')) {
    const content = readIgnoreFile();
    if (!content.trim()) {
      console.log('[push-sentinel] No ignore rules set.');
    } else {
      console.log('[push-sentinel] Ignore rules:');
      console.log(content);
    }
    return;
  }

  if (args.includes('--remove')) {
    const idx = args.indexOf('--remove');
    const target = args[idx + 1];
    if (!target) {
      console.error('[push-sentinel] Usage: push-sentinel ignore --remove <pattern>');
      process.exit(1);
    }
    const lines = readIgnoreFile().split('\n').filter((l) => l.trim() !== target);
    writeIgnoreFile(lines.join('\n'));
    console.log(`[push-sentinel] Removed ignore rule: ${target}`);
    return;
  }

  if (args.includes('--pattern')) {
    const idx = args.indexOf('--pattern');
    const pattern = args[idx + 1];
    if (!pattern) {
      console.error('[push-sentinel] Usage: push-sentinel ignore --pattern <PATTERN_NAME>');
      process.exit(1);
    }
    const content = readIgnoreFile();
    if (content.split('\n').some((l) => l.trim() === pattern)) {
      console.log(`[push-sentinel] Pattern already ignored: ${pattern}`);
      return;
    }
    writeIgnoreFile(content + (content.endsWith('\n') || !content ? '' : '\n') + pattern + '\n');
    console.log(`[push-sentinel] Added ignore pattern: ${pattern}`);
    return;
  }

  const target = args[0];
  if (!target) {
    console.error('[push-sentinel] Usage: push-sentinel ignore <file>:<line>');
    console.error('               push-sentinel ignore --pattern <PATTERN_NAME>');
    console.error('               push-sentinel ignore --list');
    console.error('               push-sentinel ignore --remove <entry>');
    process.exit(1);
  }
  const content = readIgnoreFile();
  if (content.split('\n').some((l) => l.trim() === target)) {
    console.log(`[push-sentinel] Already ignored: ${target}`);
    return;
  }
  writeIgnoreFile(content + (content.endsWith('\n') || !content ? '' : '\n') + target + '\n');
  console.log(`[push-sentinel] Added ignore rule: ${target}`);
}

switch (command) {
  case 'install':
    install();
    break;

  case 'uninstall':
    uninstall();
    break;

  case 'scan': {
    // --block-on-high: exit 1 if any HIGH severity findings are detected, blocking the push
    const blockOnHigh = args.includes('--block-on-high');
    // --local-sha / --remote-sha: passed by the pre-push hook from git's stdin
    const localShaIdx = args.indexOf('--local-sha');
    const remoteShaIdx = args.indexOf('--remote-sha');
    const localSha = localShaIdx !== -1 ? args[localShaIdx + 1] : undefined;
    const remoteSha = remoteShaIdx !== -1 ? args[remoteShaIdx + 1] : undefined;
    const findings = scan(localSha, remoteSha);
    report(findings);
    if (blockOnHigh && hasHighFindings(findings)) {
      process.stderr.write('\n[push-sentinel] Push blocked: HIGH severity secret(s) detected. Remove the secret or run `push-sentinel ignore` to suppress.\n');
      process.exit(1);
    }
    process.exit(0);
    break;
  }

  case 'ignore':
    handleIgnore(args);
    break;

  default:
    console.log('push-sentinel: Warns you if secrets are in your git diff before push.\n');
    console.log('Usage:');
    console.log('  push-sentinel install                 Install pre-push hook');
    console.log('  push-sentinel uninstall               Remove pre-push hook');
    console.log('  push-sentinel scan                    Manually run secret scan (warn only)');
    console.log('  push-sentinel scan --block-on-high    Block push if HIGH findings detected');
    console.log('  push-sentinel ignore <file:line>      Ignore a specific finding');
    console.log('  push-sentinel ignore --pattern <NAME> Ignore a pattern');
    console.log('  push-sentinel ignore --list           Show all ignore rules');
    console.log('  push-sentinel ignore --remove <entry> Remove an ignore rule');
    break;
}
