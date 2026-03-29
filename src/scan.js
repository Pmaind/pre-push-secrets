'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { PATTERNS } = require('./patterns');
const { getRepoRoot } = require('./utils');

// Zero SHA: indicates a new branch with no history on the remote
const ZERO_SHA = '0000000000000000000000000000000000000000';

// Variable name keywords that must appear on the line (false positive filter, spec 2.3 rule ①)
const VAR_NAME_KEYWORDS = /API|SECRET|TOKEN|KEY|PASSWORD/i;

// Shannon entropy calculation (spec 2.3 rule ②)
function shannonEntropy(str) {
  const freq = {};
  for (const c of str) {
    freq[c] = (freq[c] || 0) + 1;
  }
  let h = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    h -= p * Math.log2(p);
  }
  return h;
}

// Check if a candidate string is high-entropy (spec 2.3 rule ②)
function isHighEntropy(candidate) {
  if (candidate.length < 16) return false;
  if (/^(.)\1+$/.test(candidate)) return false;
  return shannonEntropy(candidate) >= 3.5;
}

// Load .push-sentinel-ignore (spec 2.3 / 2.4)
function loadIgnoreRules(repoRoot) {
  const ignoreFile = path.join(repoRoot, '.push-sentinel-ignore');
  if (!fs.existsSync(ignoreFile)) return { lines: [], patterns: [] };

  const content = fs.readFileSync(ignoreFile, 'utf8');
  const lines = [];
  const patterns = [];

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/[:\/\\*?]/.test(line) || line.includes('.')) {
      lines.push(line);
    } else {
      patterns.push(line.toUpperCase());
    }
  }
  return { lines, patterns };
}

// Check if a file path matches a single glob-style ignore rule
function matchesGlob(filePath, rule) {
  if (rule.endsWith('/**')) {
    const dir = rule.slice(0, -3);
    return filePath.startsWith(dir + '/') || filePath === dir;
  }
  if (rule.endsWith('*')) {
    return filePath.startsWith(rule.slice(0, -1));
  }
  return false;
}

// Check if a file (regardless of line) matches any ignore rule
function matchesIgnoreFile(filePath, ignoreLines) {
  for (const rule of ignoreLines) {
    if (rule === filePath || matchesGlob(filePath, rule)) return true;
  }
  return false;
}

// Check if a file:line matches any ignore rule
function matchesIgnoreLine(filePath, lineNum, ignoreLines) {
  const target = `${filePath}:${lineNum}`;
  for (const rule of ignoreLines) {
    if (rule === target || matchesGlob(filePath, rule)) return true;
  }
  return false;
}

// Check if the line content is a test/fake/example dummy (spec 2.3)
function isDummyValue(line) {
  return /\b(test_|fake_|example_|dummy_|placeholder)/i.test(line);
}

// Build the git log command args for the range of commits being pushed.
// localSha/remoteSha come from the pre-push hook stdin (see hook-template.sh).
// When called manually (no SHAs), falls back to @{u}..HEAD then last commit.
function getDiffArgs(localSha, remoteSha) {
  if (localSha && remoteSha) {
    if (remoteSha === ZERO_SHA) {
      // New branch: scan commits not yet reachable from any remote
      return ['log', '--not', '--remotes', '-p', localSha];
    }
    return ['log', `${remoteSha}..${localSha}`, '-p'];
  }
  // Manual scan: use upstream range, or fall back to last commit
  return null;
}

function getFileListArgs(localSha, remoteSha) {
  if (localSha && remoteSha) {
    if (remoteSha === ZERO_SHA) {
      return ['log', '--not', '--remotes', '--name-only', '--format=', localSha];
    }
    return ['diff', '--name-only', `${remoteSha}..${localSha}`];
  }
  return null;
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0 ? (result.stdout || '') : null;
}

function runGitNonEmpty(args) {
  const out = runGit(args);
  return out && out.trim() ? out : null;
}

function getPushDiff(localSha, remoteSha) {
  const args = getDiffArgs(localSha, remoteSha);
  if (args) {
    const out = runGit(args);
    if (out !== null) return out;
  }
  // Manual scan: inspect unpushed commits first, then staged changes, then working tree,
  // and finally fall back to the last commit if none of those produce a diff.
  return runGitNonEmpty(['log', '@{u}..HEAD', '-p'])
    ?? runGitNonEmpty(['diff', '--cached'])
    ?? runGitNonEmpty(['diff'])
    ?? runGit(['log', '-1', '-p', 'HEAD'])
    ?? '';
}

function getPushedFileList(localSha, remoteSha) {
  const args = getFileListArgs(localSha, remoteSha);
  if (args) {
    const out = runGit(args);
    if (out !== null) return out.split('\n').map((f) => f.trim()).filter(Boolean);
  }
  // Manual scan: include files from unpushed commits, staged changes, and working tree.
  const out = runGitNonEmpty(['diff', '--name-only', '@{u}..HEAD'])
    ?? runGitNonEmpty(['diff', '--name-only', '--cached'])
    ?? runGitNonEmpty(['diff', '--name-only'])
    ?? runGit(['diff', '--name-only', 'HEAD~1..HEAD'])
    ?? '';
  return out.split('\n').map((f) => f.trim()).filter(Boolean);
}

// Parse diff output into added lines: { file, lineNum, content }
function parseDiffAddedLines(diff) {
  const results = [];
  let currentFile = null;
  let lineNum = 0;

  for (const line of diff.split('\n')) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      lineNum = 0;
      continue;
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      lineNum = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    if (!currentFile) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineNum++;
      results.push({ file: currentFile, lineNum, content: line.slice(1) });
    } else if (!line.startsWith('-')) {
      lineNum++;
    }
  }
  return results;
}

// localSha / remoteSha: passed from the pre-push hook via --local-sha / --remote-sha flags.
// When omitted (manual scan), falls back to upstream-based diff.
function scan(localSha, remoteSha) {
  // Ref deletion (git push origin :branch): local_sha is all zeros.
  // There are no commits to scan — return immediately to avoid falling back
  // to @{u}..HEAD and producing spurious warnings.
  if (localSha === ZERO_SHA) return [];
  const repoRoot = getRepoRoot();
  const ignore = loadIgnoreRules(repoRoot);
  const findings = [];

  // .env file check (spec 2.2 / 2.3 rule ③)
  // Note: files appearing in the push diff are tracked by git.
  // We do NOT skip based on .gitignore — a tracked file in .gitignore can still leak secrets.
  const pushedFiles = getPushedFileList(localSha, remoteSha);
  for (const f of pushedFiles) {
    if (f === '.env' || f.endsWith('/.env') || /^\.env(\.|$)/.test(path.basename(f))) {
      if (!matchesIgnoreFile(f, ignore.lines)) {
        findings.push({
          file: f,
          lineNum: null,
          matchedValue: null,
          severity: 'MEDIUM',
          patternName: '.env file',
          risk: 'Committing a .env file may expose multiple secrets at once.',
        });
      }
    }
  }

  const diff = getPushDiff(localSha, remoteSha);
  if (!diff) return findings;

  const addedLines = parseDiffAddedLines(diff);

  for (const { file, lineNum, content } of addedLines) {
    // Files appearing in a push diff are tracked; we do NOT skip based on .gitignore.
    if (matchesIgnoreLine(file, lineNum, ignore.lines)) continue;
    if (isDummyValue(content)) continue;

    let matched = false;
    for (const pattern of PATTERNS) {
      const skipVarFilter = ['Private Key', 'AWS Access Key', 'GitHub Token', 'OpenAI API Key', 'Anthropic API Key'];
      if (!skipVarFilter.includes(pattern.name) && !VAR_NAME_KEYWORDS.test(content)) continue;

      if (ignore.patterns.includes(pattern.name.toUpperCase().replace(/\s+/g, '_'))) continue;
      const lineUpper = content.toUpperCase();
      if (ignore.patterns.some((p) => lineUpper.includes(p))) continue;

      const match = content.match(pattern.regex);
      if (!match) continue;

      const candidate = pattern.captureGroup ? match[pattern.captureGroup] : match[0];
      if (pattern.name === 'Generic API Key' && !isHighEntropy(candidate)) continue;

      findings.push({
        file,
        lineNum,
        matchedValue: candidate,
        severity: pattern.severity,
        patternName: pattern.name,
        risk: pattern.risk,
      });
      matched = true;
      break;
    }

    if (matched) continue;

    // AWS Secret Key: variable name + high entropy (no fixed prefix)
    // isDummyValue and matchesIgnoreLine are already checked above
    if (VAR_NAME_KEYWORDS.test(content) && /AWS.*SECRET|SECRET.*AWS/i.test(content)) {
      const valueMatch = content.match(/[a-zA-Z0-9/+=]{40}/);
      if (valueMatch && isHighEntropy(valueMatch[0])) {
        findings.push({
          file,
          lineNum,
          matchedValue: valueMatch[0],
          severity: 'HIGH',
          patternName: 'AWS Secret Key',
          risk: 'Full access to AWS resources. Attacker can create/delete instances, incur charges, or exfiltrate data.',
        });
      }
    }
  }

  return findings;
}

module.exports = { scan };
