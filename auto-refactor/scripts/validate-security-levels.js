/**
 * Module: Verification Harness — Comprehensive Systemic Security Audit & 3-Level Governance
 * File Path: scripts/validate-security-levels.js
 * Architecture Role: End-to-end integration suite over the built scanner stack (Scanner plus
 *                     SecurityAnalyzer, SecretsAnalyzer, ArchitectureAnalyzer) that locks down
 *                     the off/basic/full security-level contract and its score impact.
 * Dependencies & Triggers: Run manually or from CI after `npm run build`; imports ../dist/api,
 *                     ../dist/analyzers/{security,secrets,architecture}, ../dist/core/config,
 *                     ../dist/core/scoring/qualityScorer, and node's assert/path/fs.
 * Responsibilities: Verify config cascading for off/basic/full; generate a disposable
 *                     .test_security_workspace (vulnerable service, high-entropy secret, DTO
 *                     leakage, benign game code); assert off yields zero security issues, basic
 *                     catches severe injections with zero false positives, full adds weak-crypto,
 *                     path-traversal and ARCH-LEAK-002 detection, and quality scores drop.
 * Exit Semantics & Design Rationale: runTests() rejects on the first failed assertion or scan;
 *                     the top-level catch logs the error and calls process.exit(1) so CI fails
 *                     loudly, while finally always deletes the workspace. Each level is asserted
 *                     on both what it must catch and what it must ignore, since a security
 *                     scanner only earns trust when its level boundary is explicit.
 *
 * Verifies:
 * 1. Three Security Levels: 'off', 'basic', 'full'
 * 2. Secrets, Vulnerabilities, Injections, Weak Crypto, and Architectural Leaks
 * 3. Zero false positives in 'basic' mode vs deep compliance in 'full' mode
 * 4. Architecture DTO leakage detection (ARCH-LEAK-002)
 * 5. Quality scoring impact and deductions
 * 6. Config resolution and CLI flag propagation
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { Scanner } = require('../dist/api');
const { resolveConfig } = require('../dist/core/config');
const { QualityScorer } = require('../dist/core/scoring/qualityScorer');

const TEST_DIR = path.join(__dirname, '../.test_security_workspace');

function setupWorkspace() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // 1. Vulnerable service file
  const serviceCode = `
import * as child_process from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Test fixture for the security suite: a payment service that combines untrusted input with
 * dangerous runtime APIs so each security level can be asserted on the same file. The code is
 * written to a disposable workspace and scanned only; it is never imported or executed.
 */
export class PaymentService {
  processCommand(userInput: string) {
    // SEC-VUL-001: Arbitrary code execution
    eval("console.log(" + userInput + ")");

    // SEC-VUL-002: Command injection
    child_process.exec("ping -c 1 " + userInput);

    // SEC-VUL-003: Prototype pollution
    const obj: any = {};
    obj.__proto__ = { admin: true };

    // SEC-VUL-004: Insecure random in security token context
    const authToken = "token_" + Math.random().toString(36).substring(2);

    // SEC-VUL-005: Broken crypto hash
    const hash = crypto.createHash('md5').update(userInput).digest('hex');

    // SEC-VUL-006: Path traversal
    const content = fs.readFileSync(userInput);

    // SEC-LEAK-001: Sensitive data logging
    console.log("Processing payment with secretKey:", authToken);

    // SEC-SECRET-001: Hardcoded GitHub token
    const apiKey = "ghp_123456789012345678901234567890123456";

    return { hash, apiKey };
  }
}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'service.ts'), serviceCode, 'utf8');

  // 2. High-entropy secret file
  const entropyCode = `
/**
 * Test fixture configuration whose masterKey value is a long mixed-character payload. Full
 * level scans must flag it via high-entropy detection, while basic level must leave it alone.
 */
export const ENCRYPTED_CONFIG = {
  // High Shannon entropy (>= 4.2), 32-char base64 payload
  masterKey: "qK9xP2wL8vN5zR7yT1uI4oM6aB3cD4eF",
};
`;
  fs.writeFileSync(path.join(TEST_DIR, 'entropy.ts'), entropyCode, 'utf8');

  // 3. Architecture DTO leakage file
  const dtoCode = `
/**
 * Test fixture response DTO that deliberately declares credential-shaped fields, giving the
 * full-level architecture scan an ARCH-LEAK-002 case to detect while basic level ignores it.
 */
export interface UserResponseDto {
  userId: string;
  username: string;
  email: string;
  passwordHash: string; // ARCH-LEAK-002
  secretKey: string;    // ARCH-LEAK-002
}

/**
 * Test fixture mapper that copies credential-shaped fields from a source user into
 * UserResponseDto, completing the leak path the architecture analyzer reports in full mode.
 */
export class DtoMapper {
  static toResponse(user: any): UserResponseDto {
    return {
      userId: user.id,
      username: user.name,
      email: user.email,
      passwordHash: user.passwordHash,
      secretKey: user.secretKey
    };
  }
}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'dto.ts'), dtoCode, 'utf8');

  // 4. Benign game / math file (must NEVER be flagged in 'basic' mode)
  const benignCode = `
/**
 * Benign game fixture used as the basic-level control: its arithmetic-only methods must never
 * be reported as security or secrets issues, protecting the suite against false positives.
 */
export class GameDice {
  rollD20(): number {
    return Math.floor(Math.random() * 20) + 1;
  }
  generateColorHash(seed: string): string {
    return "color-" + seed.length;
  }
}
`;
  fs.writeFileSync(path.join(TEST_DIR, 'dice.ts'), benignCode, 'utf8');
}

function cleanupWorkspace() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

async function runTests() {
  console.log('=== [1/5] Testing Security Config Cascading ===');
  const cfgOff = resolveConfig({ securityLevel: 'off' });
  assert.strictEqual(cfgOff.securityLevel, 'off');
  assert.strictEqual(cfgOff.analyzers.security.enabled, false);
  assert.strictEqual(cfgOff.analyzers.secrets.enabled, false);

  const cfgBasic = resolveConfig({ securityLevel: 'basic' });
  assert.strictEqual(cfgBasic.securityLevel, 'basic');
  assert.strictEqual(cfgBasic.analyzers.security.enabled, true);
  assert.strictEqual(cfgBasic.analyzers.security.options.level, 'basic');
  assert.strictEqual(cfgBasic.analyzers.secrets.enabled, true);
  assert.strictEqual(cfgBasic.analyzers.secrets.options.level, 'basic');

  const cfgFull = resolveConfig({ securityLevel: 'full' });
  assert.strictEqual(cfgFull.securityLevel, 'full');
  assert.strictEqual(cfgFull.analyzers.security.enabled, true);
  assert.strictEqual(cfgFull.analyzers.security.options.level, 'full');
  assert.strictEqual(cfgFull.analyzers.secrets.enabled, true);
  assert.strictEqual(cfgFull.analyzers.secrets.options.level, 'full');
  assert.strictEqual(cfgFull.analyzers.architecture.options.checkDtoCredentialLeakage, true);
  console.log('✔ Config cascading across all 3 levels verified.\n');

  setupWorkspace();

  try {
    console.log('=== [2/5] Testing Level: "off" (Zero Overhead & Zero Issues) ===');
    const scannerOff = new Scanner(
      resolveConfig({
        root: TEST_DIR,
        include: ['**/*.ts'],
        securityLevel: 'off',
      }),
    );
    const resultOff = await scannerOff.scan();
    const secIssuesOff = resultOff.issues.filter(
      (i) => i.analyzer === 'security' || i.analyzer === 'secrets',
    );
    console.log(`Issues found at level 'off': ${secIssuesOff.length}`);
    assert.strictEqual(
      secIssuesOff.length,
      0,
      'Level "off" must return 0 security and secrets issues',
    );
    console.log('✔ Level "off" verified.\n');

    console.log('=== [3/5] Testing Level: "basic" (Severe Injections & Zero False Positives) ===');
    const scannerBasic = new Scanner(
      resolveConfig({
        root: TEST_DIR,
        include: ['**/*.ts'],
        securityLevel: 'basic',
      }),
    );
    const resultBasic = await scannerBasic.scan();
    const rulesBasic = new Set(resultBasic.issues.map((i) => i.rule));
    console.log('Rules triggered in basic mode:', Array.from(rulesBasic));

    // Must catch critical vulnerabilities
    assert(rulesBasic.has('SEC-VUL-001'), 'Must detect eval() (SEC-VUL-001)');
    assert(rulesBasic.has('SEC-VUL-002'), 'Must detect command injection (SEC-VUL-002)');
    assert(rulesBasic.has('SEC-VUL-003'), 'Must detect prototype pollution (SEC-VUL-003)');
    assert(
      rulesBasic.has('secret-detected'),
      'Must detect hardcoded GitHub token (secret-detected)',
    );

    // Must NOT flag benign or strict-only rules
    assert(!rulesBasic.has('SEC-VUL-004'), 'Basic mode must not flag weak random in general');
    assert(!rulesBasic.has('SEC-VUL-005'), 'Basic mode must not flag MD5 hash');
    assert(!rulesBasic.has('high-entropy-token'), 'Basic mode must not run high-entropy detection');
    assert(!rulesBasic.has('ARCH-LEAK-002'), 'Basic mode must not flag DTO field names');

    // Benign file dice.ts must have 0 security issues
    const diceIssues = resultBasic.issues.filter(
      (i) =>
        i.location.file.includes('dice.ts') &&
        (i.analyzer === 'security' || i.analyzer === 'secrets'),
    );
    assert.strictEqual(
      diceIssues.length,
      0,
      'Benign math/game code must produce 0 false positives',
    );
    console.log('✔ Level "basic" gate verified.\n');

    console.log('=== [4/5] Testing Level: "full" (Deep Compliance & Architectural Leaks) ===');
    const scannerFull = new Scanner(
      resolveConfig({
        root: TEST_DIR,
        include: ['**/*.ts'],
        securityLevel: 'full',
      }),
    );
    const resultFull = await scannerFull.scan();
    const rulesFull = new Set(resultFull.issues.map((i) => i.rule));
    console.log('Rules triggered in full mode:', Array.from(rulesFull));

    // Full mode must catch everything
    assert(rulesFull.has('SEC-VUL-001'), 'Full mode must detect SEC-VUL-001');
    assert(rulesFull.has('SEC-VUL-002'), 'Full mode must detect SEC-VUL-002');
    assert(rulesFull.has('SEC-VUL-003'), 'Full mode must detect SEC-VUL-003');
    assert(
      rulesFull.has('SEC-VUL-004'),
      'Full mode must detect weak random in token context (SEC-VUL-004)',
    );
    assert(rulesFull.has('SEC-VUL-005'), 'Full mode must detect MD5 crypto hash (SEC-VUL-005)');
    assert(rulesFull.has('SEC-VUL-006'), 'Full mode must detect path traversal (SEC-VUL-006)');
    assert(
      rulesFull.has('SEC-LEAK-001'),
      'Full mode must detect sensitive data logging (SEC-LEAK-001)',
    );
    assert(
      rulesFull.has('secret-detected'),
      'Full mode must detect hardcoded token (secret-detected)',
    );
    assert(
      rulesFull.has('high-entropy-token'),
      'Full mode must detect high-entropy masterKey (high-entropy-token)',
    );
    assert(
      rulesFull.has('ARCH-LEAK-002'),
      'Full mode must detect DTO credential exposure (ARCH-LEAK-002)',
    );

    console.log('✔ Level "full" deep compliance verified.\n');

    console.log('=== [5/5] Testing Quality Scorer Deductions for Security ===');
    const scorer = new QualityScorer();
    const scoreOff = scorer.evaluateFile('service.ts', resultOff.issues);
    const scoreFull = scorer.evaluateFile('service.ts', resultFull.issues);

    console.log(`Composite score (off): ${scoreOff.compositeScore} (${scoreOff.grade})`);
    console.log(`Composite score (full): ${scoreFull.compositeScore} (${scoreFull.grade})`);
    console.log(`Security subscore (full): ${scoreFull.indices.codeSecurity}`);
    console.log(`Architecture subscore (full): ${scoreFull.indices.architectureConsistency}`);

    assert(
      scoreOff.compositeScore > scoreFull.compositeScore,
      'Full mode security issues must lower composite score',
    );
    assert(
      scoreFull.indices.codeSecurity < 80,
      'Critical security vulnerabilities must significantly penalize codeSecurity',
    );
    assert(
      scoreFull.indices.architectureConsistency < 100,
      'ARCH-LEAK-002 must penalize architectureConsistency',
    );
    console.log('✔ Quality scoring security deductions verified.\n');

    console.log('================================================================');
    console.log('🎉 ALL SYSTEMIC SECURITY AUDIT & GOVERNANCE CHECKS PASSED (5/5)!');
    console.log('================================================================');
  } finally {
    cleanupWorkspace();
  }
}

runTests().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
