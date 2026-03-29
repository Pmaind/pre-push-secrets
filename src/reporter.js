'use strict';

const MAX_FINDINGS = 10;

// Show only the first 6 characters and mask the rest to minimise log exposure
function maskValue(value) {
  if (!value) return '(staged file)';
  const show = Math.min(6, value.length);
  return value.slice(0, show) + 'x'.repeat(Math.max(0, value.length - show)) + '...';
}

function severityLabel(severity) {
  return `[${severity}]`;
}

function report(findings, { willBlock = false } = {}) {
  if (findings.length === 0) {
    process.stderr.write('[push-sentinel] \u2713 No secrets detected.\n');
    return;
  }

  const shown = findings.slice(0, MAX_FINDINGS);
  const extra = findings.length - shown.length;

  process.stderr.write('[push-sentinel] \u26a0 Potential secrets found:\n\n');

  for (const f of shown) {
    const location = f.lineNum ? `${f.file}:${f.lineNum}` : f.file;
    process.stderr.write(`  ${severityLabel(f.severity)} ${location}\n`);
    process.stderr.write(`  ${maskValue(f.matchedValue)}\n`);
    process.stderr.write(`  \u2192 Risk: ${f.risk}\n`);
    if (f.lineNum) {
      process.stderr.write(`  \u2192 To ignore this line: push-sentinel ignore ${location}\n`);
    }
    process.stderr.write('\n');
  }

  if (extra > 0) {
    process.stderr.write(`  + ${extra} more finding(s) not shown.\n\n`);
  }

  if (willBlock) {
    process.stderr.write('  Push will be blocked.\n');
  } else {
    process.stderr.write('  Push continues. Double-check before sharing.\n');
  }
}

function hasHighFindings(findings) {
  return findings.some((f) => f.severity === 'HIGH');
}

module.exports = { report, hasHighFindings };
