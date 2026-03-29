'use strict';

// Detection patterns per design spec section 2.2
const PATTERNS = [
  {
    name: 'Private Key',
    severity: 'HIGH',
    // Covers RSA, EC, OPENSSH, DSA, ECDSA, and PKCS#8 (PRIVATE KEY)
    regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |ECDSA )?PRIVATE KEY-----/,
    risk: 'Full server/certificate takeover. Attacker can impersonate your server or decrypt all traffic.',
  },
  {
    name: 'AWS Access Key',
    severity: 'HIGH',
    regex: /AKIA[0-9A-Z]{16}/,
    risk: 'Full access to AWS resources. Attacker can create/delete instances, incur charges, or exfiltrate data.',
  },
  {
    name: 'GitHub Token',
    severity: 'HIGH',
    // ghp_ tokens are 36 chars; github_pat_ tokens are longer — require at least 36 chars after prefix
    regex: /ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{36,}/,
    risk: 'Full read/write access to your GitHub repositories, including deletion.',
  },
  {
    // Must appear before OpenAI: sk-ant-... also matches the broader sk- pattern
    name: 'Anthropic API Key',
    severity: 'MEDIUM',
    regex: /sk-ant-[a-zA-Z0-9\-]{32,}/,
    risk: 'Unauthorized API usage billed to your account. Possible data access.',
  },
  {
    name: 'OpenAI API Key',
    severity: 'MEDIUM',
    // Matches sk-proj-..., sk-...-..., and legacy sk-... formats (dash included in character class)
    regex: /sk-[a-zA-Z0-9\-]{32,}/,
    risk: 'Unauthorized API usage billed to your account. Possible data access.',
  },
  {
    name: 'Generic API Key',
    severity: 'LOW',
    regex: /[Aa][Pp][Ii]_?[Kk][Ee][Yy]\s*=\s*["']?([^\s"']{16,})/,
    risk: 'Depends on the service. May allow unauthorized access or actions.',
    captureGroup: 1,
  },
];

// AWS Secret Key is detected by variable name filter + high entropy (no fixed prefix pattern)
// handled in scan.js via variable name filter + entropy check

module.exports = { PATTERNS };
