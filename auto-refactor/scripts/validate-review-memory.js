#!/usr/bin/env node
/**
 * Module: Verification Harness — Review Memory & Quality System Validation
 * File Path: scripts/validate-review-memory.js
 * Architecture Role: Integration suite exercising the built dist/api public surface for review
 *                     memory, semantic domain reuse, trajectory modeling, and quality scoring.
 * Dependencies & Triggers: Run manually or from CI after `npm run build`; imports ../dist/api
 *                     (ReviewMemoryManager, QualityScorer, ChangeTrajectoryManager,
 *                     AgentConstraintGenerator, extractCodeDomains, computeAstDigest,
 *                     matchDomains, queryAgentConstraints, evaluateQualityScore, scan) plus
 *                     node's assert/path/fs.
 * Responsibilities: Exercise six behaviors end to end: review-memory record extraction with
 *                     stable-state eviction; line-shift-invariant semantic reuse; selective
 *                     re-audit after a partial rewrite; transparent 10-index quality scoring;
 *                     cross-agent trajectory anomalies (regression, drift, rollback, recurrence);
 *                     and agent-constraint prompt synthesis.
 * Exit Semantics & Design Rationale: test() catches each assertion failure, prints the failing
 *                     scenario, and calls process.exit(1) immediately so the first broken
 *                     invariant stays visible; an all-green run exits 0 with a passed/total
 *                     summary. Plain synchronous asserts keep the harness framework-free and
 *                     deterministic.
 *
 * Verification test suite for:
 * 1. Review Memory & Fingerprint Management (sub-1KB indexable record, heavy state eviction)
 * 2. Semantic Domain Reuse & Line-Shift Invariance
 * 3. Cross-Time & Cross-Agent Trajectory Modeling (regression, drift, rollback, recurring issues)
 * 4. Transparent Multi-Dimensional Quality Scoring (10 independent indices, zero black box)
 * 5. Agent Constraint & Engineering Prompt Generation
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  scan,
  ReviewMemoryManager,
  QualityScorer,
  ChangeTrajectoryManager,
  AgentConstraintGenerator,
  extractCodeDomains,
  computeAstDigest,
  matchDomains,
} = require('../dist/api');

console.log('🧪 Running Comprehensive Review Memory & Quality System Validation...');

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ [FAIL] ${name}: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. Review Memory Record & State Eviction
// ---------------------------------------------------------------------------
test('Review Memory Record extraction & compact memory eviction', () => {
  const sampleCode = `
/**
 * Calculate income tax for a single filer using a three-bracket progressive schedule.
 * Income at or below the tax-free threshold yields zero, including negative amounts.
 *
 * @param income - Taxable income in the bracket's currency units.
 * @returns The tax owed for the supplied income.
 */
export function calculateTax(income: number): number {
  if (income <= 10000) return 0;
  if (income <= 50000) return (income - 10000) * 0.1;
  return 4000 + (income - 50000) * 0.2;
}

/**
 * Domain service that validates order identifiers before an order is accepted.
 * The class itself holds no state; every call is independent of previous calls.
 */
export class OrderService {
  processOrder(id: string): boolean {
    if (!id) return false;
    return true;
  }
}
`;

  const domains = extractCodeDomains(undefined, sampleCode, []);
  assert(domains.length >= 2, `Expected at least 2 domains, got ${domains.length}`);
  const taxFn = domains.find((d) => d.name === 'calculateTax');
  assert(taxFn, 'calculateTax domain should be extracted');
  assert.strictEqual(taxFn.kind, 'function');
  assert(taxFn.semanticHash.length > 0, 'Semantic hash must be non-empty');

  const scorer = new QualityScorer();
  const qualityScore = scorer.evaluateFile('src/tax.ts', [], null);

  const memory = new ReviewMemoryManager();
  const record = {
    filePath: 'src/tax.ts',
    fileHash: 'dummy-hash-1',
    astDigest: computeAstDigest(undefined, sampleCode),
    codeDomains: domains,
    ruleHits: [],
    qualityScores: qualityScore,
    lastAudited: Date.now(),
    revisionId: 'rev-01',
    agentUid: 'agent-alpha',
    contextWindows: { imports: [], exports: ['calculateTax', 'OrderService'], layer: 'domain' },
    fixResults: [],
  };

  memory.saveRecord(record);
  assert.strictEqual(memory.size(), 1, 'Memory should contain 1 record');

  const retrieved = memory.getRecord('src/tax.ts');
  assert(retrieved, 'Should retrieve record from memory');
  assert.strictEqual(retrieved.codeDomains.length, domains.length);

  // Evict stable state
  memory.evictStable('src/tax.ts');
  const postEvict = memory.getRecord('src/tax.ts');
  assert(postEvict, 'Record must persist post eviction');
  assert.strictEqual(postEvict.codeDomains[0].name, 'calculateTax');
});

// ---------------------------------------------------------------------------
// 2. Semantic Reuse & Line-Shift Invariance
// ---------------------------------------------------------------------------
test('Line-shift invariance: inserting blank lines preserves semantic identity', () => {
  const codeV1 = `
/**
 * Add two numeric operands and return their arithmetic sum.
 *
 * @param a - Left operand of the addition.
 * @param b - Right operand of the addition.
 * @returns The sum a + b.
 */
export function add(a: number, b: number): number {
  return a + b;
}
`;

  const codeV2 = `
// Added header comments
// and extra whitespace

/**
 * Add two numeric operands and return their arithmetic sum.
 *
 * @param a - Left operand of the addition.
 * @param b - Right operand of the addition.
 * @returns The sum a + b.
 */
export function add(a: number, b: number): number {
  return a + b;
}
`;

  const domainsV1 = extractCodeDomains(undefined, codeV1, []);
  const domainsV2 = extractCodeDomains(undefined, codeV2, []);

  const fnV1 = domainsV1.find((d) => d.name === 'add');
  const fnV2 = domainsV2.find((d) => d.name === 'add');
  assert(fnV1 && fnV2, 'Both versions must contain function add');
  assert.strictEqual(
    fnV1.semanticHash,
    fnV2.semanticHash,
    'Semantic hash must be identical despite line shift',
  );

  const recordV1 = {
    filePath: 'src/math.ts',
    fileHash: 'hash-v1',
    astDigest: computeAstDigest(undefined, codeV1),
    codeDomains: domainsV1,
    ruleHits: [],
    qualityScores: new QualityScorer().evaluateFile('src/math.ts', []),
    lastAudited: Date.now(),
    revisionId: 'rev-1',
    contextWindows: { imports: [], exports: ['add'] },
    fixResults: [],
  };

  const match = matchDomains(recordV1, codeV2, domainsV2);
  assert.strictEqual(match.isByteEqual, false, 'Files are not byte equal');
  assert.strictEqual(match.isLineShiftOnly, true, 'Should detect line-shift only');
  assert.strictEqual(
    match.unaffectedDomains.length,
    1,
    'add function should be 100% unaffected and reusable',
  );
  assert.strictEqual(match.impactedDomains.length, 0, 'No domains should be impacted');
});

// ---------------------------------------------------------------------------
// 3. Selective Domain Re-Audit on Partial Code Rewrite
// ---------------------------------------------------------------------------
test('Selective domain re-audit: modifying function A does not invalidate function B', () => {
  const codeV1 = `
/**
 * Double the supplied value without branching or side effects.
 *
 * @param x - Value to double.
 * @returns The input multiplied by two.
 */
export function untouched(x: number): number {
  return x * 2;
}

/**
 * Increment the supplied value by one.
 *
 * @param y - Value to increment.
 * @returns The input plus one.
 */
export function modified(y: number): number {
  return y + 1;
}
`;

  const codeV2 = `
/**
 * Double the supplied value without branching or side effects.
 *
 * @param x - Value to double.
 * @returns The input multiplied by two.
 */
export function untouched(x: number): number {
  return x * 2;
}

/**
 * Scale values above ten by a factor of ten, otherwise decrement them by one.
 *
 * @param y - Value to transform.
 * @returns y * 10 when greater than ten, otherwise y - 1.
 */
export function modified(y: number): number {
  if (y > 10) return y * 10;
  return y - 1;
}
`;

  const domainsV1 = extractCodeDomains(undefined, codeV1, []);
  const domainsV2 = extractCodeDomains(undefined, codeV2, []);

  const recordV1 = {
    filePath: 'src/calc.ts',
    fileHash: 'hash-calc-v1',
    astDigest: computeAstDigest(undefined, codeV1),
    codeDomains: domainsV1,
    ruleHits: [],
    qualityScores: new QualityScorer().evaluateFile('src/calc.ts', []),
    lastAudited: Date.now(),
    revisionId: 'rev-c1',
    contextWindows: { imports: [], exports: ['untouched', 'modified'] },
    fixResults: [],
  };

  const match = matchDomains(recordV1, codeV2, domainsV2);
  assert.strictEqual(match.isByteEqual, false);
  assert.strictEqual(match.unaffectedDomains.length, 1, 'untouched() must be unaffected');
  assert.strictEqual(match.unaffectedDomains[0].name, 'untouched');
  assert.strictEqual(match.impactedDomains.length, 1, 'modified() must be marked impacted');
  assert.strictEqual(match.impactedDomains[0].name, 'modified');
  assert.strictEqual(match.impactedDomains[0].reason, 'modified');
});

// ---------------------------------------------------------------------------
// 4. Transparent Multi-Dimensional Quality Scoring
// ---------------------------------------------------------------------------
test('Transparent Quality Scoring: 10 independent indices, zero black-box deductions', () => {
  const scorer = new QualityScorer();
  const mockIssues = [
    {
      id: 'architecture:layer-violation:src/domain/user.ts:10',
      analyzer: 'architecture',
      rule: 'layer-violation',
      severity: 'error',
      message: 'Domain layer imports infrastructure',
      location: {
        file: 'src/domain/user.ts',
        start: { line: 10, column: 1 },
        end: { line: 10, column: 20 },
      },
      detail: {},
    },
    {
      id: 'complexity:cyclomatic-complexity:src/domain/user.ts:25',
      analyzer: 'complexity',
      rule: 'high-complexity',
      severity: 'warning',
      message: 'Cyclomatic complexity is 18',
      location: {
        file: 'src/domain/user.ts',
        start: { line: 25, column: 1 },
        end: { line: 40, column: 1 },
      },
      detail: { complexity: 18 },
    },
    {
      id: 'secrets:secret-detected:src/domain/user.ts:50',
      analyzer: 'secrets',
      rule: 'secret-detected',
      severity: 'error',
      message: 'Hardcoded API Key',
      location: {
        file: 'src/domain/user.ts',
        start: { line: 50, column: 1 },
        end: { line: 50, column: 30 },
      },
      detail: {},
    },
  ];

  const breakdown = scorer.evaluateFile('src/domain/user.ts', mockIssues, {
    file: 'src/domain/user.ts',
    lines: 100,
    nonBlankLines: 80,
    functions: 5,
    maxNestingDepth: 4,
    topLevelDeclarations: 3,
    exportedSymbols: 2,
  });

  assert(
    breakdown.indices.architectureConsistency <= 80,
    'Architecture consistency score must be deducted',
  );
  assert(breakdown.indices.maintainability <= 85, 'Maintainability score must be deducted for CC');
  assert(
    breakdown.indices.codeSecurity <= 50,
    'Code security score must be severely deducted for secret',
  );
  assert.strictEqual(
    breakdown.indices.modernity,
    100,
    'Modernity should remain 100 when untouched',
  );

  assert(
    breakdown.compositeScore < 90,
    `Composite score must reflect deductions, got ${breakdown.compositeScore}`,
  );
  assert(breakdown.rationales.length >= 3, 'Must provide explicit rationale for each deduction');
  assert(breakdown.rationales.some((r) => r.dimension === 'codeSecurity' && r.delta === -50));
  assert(
    breakdown.confidence >= 0.6 && breakdown.confidence <= 1.0,
    'Confidence must be within [0.6, 1.0]',
  );
});

// ---------------------------------------------------------------------------
// 5. Cross-Time & Cross-Agent Trajectory Modeling & Anomaly Detection
// ---------------------------------------------------------------------------
test('Cross-Agent Trajectory: detects quality regression, style drift, and logical rollback', () => {
  const trajManager = new ChangeTrajectoryManager();
  const scorer = new QualityScorer();

  // Rev 1: Clean code by Agent Alpha
  const rev1 = {
    revisionId: 'rev-001',
    timestamp: 1000,
    agentUid: 'agent-alpha',
    fileHash: 'hash-clean',
    astDigest: 'ast-clean',
    qualityScore: scorer.evaluateFile('src/service.ts', []),
    ruleHitIds: [],
  };
  const comp1 = trajManager.recordRevision('src/service.ts', rev1);
  assert.strictEqual(comp1, undefined, 'First revision has no prior comparison');

  // Rev 2: Agent Beta introduces complexity and secret
  const badIssues = [
    {
      id: 'secrets:secret-detected:src/service.ts:5',
      analyzer: 'secrets',
      rule: 'secret-detected',
      severity: 'error',
      message: 'Token found',
      location: {
        file: 'src/service.ts',
        start: { line: 5, column: 1 },
        end: { line: 5, column: 20 },
      },
      detail: {},
    },
    {
      id: 'comments:banned-jargon:src/service.ts:12',
      analyzer: 'comments',
      rule: 'banned-jargon',
      severity: 'warning',
      message: 'Temporary blacklisted keyword used',
      location: {
        file: 'src/service.ts',
        start: { line: 12, column: 1 },
        end: { line: 12, column: 20 },
      },
      detail: {},
    },
  ];
  const rev2 = {
    revisionId: 'rev-002',
    timestamp: 2000,
    agentUid: 'agent-beta',
    fileHash: 'hash-regressed',
    astDigest: 'ast-regressed',
    qualityScore: scorer.evaluateFile('src/service.ts', badIssues),
    ruleHitIds: [
      'secrets:secret-detected:src/service.ts:5',
      'comments:banned-jargon:src/service.ts:12',
    ],
  };
  const comp2 = trajManager.recordRevision('src/service.ts', rev2);
  assert(comp2, 'Must produce comparison for revision 2');
  assert(comp2.compositeDelta < -5, 'Must report composite drop');
  assert(
    comp2.anomalies.some((a) => a.kind === 'quality-regression'),
    'Must detect quality-regression',
  );
  assert(
    comp2.anomalies.some((a) => a.kind === 'style-drift'),
    'Must detect style-drift between agents',
  );

  // Rev 3: Agent Gamma reverts to clean code (hash matches Rev 1)
  const rev3 = {
    revisionId: 'rev-003',
    timestamp: 3000,
    agentUid: 'agent-gamma',
    fileHash: 'hash-clean',
    astDigest: 'ast-clean',
    qualityScore: scorer.evaluateFile('src/service.ts', []),
    ruleHitIds: [],
  };
  const comp3 = trajManager.recordRevision('src/service.ts', rev3);
  assert(comp3, 'Must produce comparison for revision 3');
  assert.strictEqual(comp3.isLogicalRollback, true, 'Must detect logical rollback');
  assert(
    comp3.anomalies.some((a) => a.kind === 'logical-rollback'),
    'Anomaly list must include logical-rollback',
  );
  assert.strictEqual(rev3.rolledBackToRevisionId, 'rev-001', 'Must link back to rev-001');

  // Rev 4: Agent Delta modifies and re-introduces the banned jargon
  const rev4 = {
    revisionId: 'rev-004',
    timestamp: 4000,
    agentUid: 'agent-delta',
    fileHash: 'hash-v4',
    astDigest: 'ast-v4',
    qualityScore: scorer.evaluateFile('src/service.ts', [badIssues[1]]),
    ruleHitIds: ['comments:banned-jargon:src/service.ts:12'],
  };
  const comp4 = trajManager.recordRevision('src/service.ts', rev4);
  assert(comp4, 'Must produce comparison for revision 4');
  assert(
    comp4.anomalies.some((a) => a.kind === 're-introduced-issue'),
    'Must detect re-introduced-issue',
  );
});

// ---------------------------------------------------------------------------
// 6. Agent Constraint & Engineering Prompt Synthesis
// ---------------------------------------------------------------------------
test('Agent Constraint Generator: synthesizes high-purity, localized prompts', () => {
  const gen = new AgentConstraintGenerator();

  const mockMemory = {
    filePath: 'src/domain/order.ts',
    fileHash: 'order-hash',
    astDigest: 'order-ast',
    codeDomains: [
      {
        domainId: 'function:calculateDiscount:15',
        kind: 'function',
        name: 'calculateDiscount',
        span: { startLine: 15, endLine: 35, startCol: 1, endCol: 1 },
        semanticHash: 'hash-fn',
        cyclomaticComplexity: 6,
        ruleViolations: [
          {
            rule: 'allocation-in-loop',
            analyzer: 'performance',
            severity: 'warning',
            line: 22,
            message: 'Avoid allocation inside loop',
          },
        ],
      },
    ],
    ruleHits: [],
    qualityScores: new QualityScorer().evaluateFile('src/domain/order.ts', []),
    lastAudited: Date.now(),
    revisionId: 'rev-1',
    contextWindows: { imports: [], exports: ['calculateDiscount'], layer: 'domain' },
    fixResults: [],
  };

  const prompt = gen.generate(
    {
      filePath: 'src/domain/order.ts',
      domainName: 'calculateDiscount',
      layer: 'domain',
    },
    mockMemory,
    undefined,
  );

  assert(
    prompt.renderedMarkdown.includes('calculateDiscount'),
    'Prompt must target calculateDiscount',
  );
  assert(
    prompt.hardConstraints.some((c) => c.includes('Domain')),
    'Prompt must include Domain layer constraints',
  );
  assert(
    prompt.frequentViolations.some((v) => v.includes('allocation-in-loop')),
    'Prompt must include historical violations',
  );
  assert(prompt.recommendedPatterns.length > 0, 'Prompt must include recommended patterns');
});

test('Review-memory discovery walks up to the scanned root cache', () => {
  const { resolveReviewMemoryDir } = require('../dist/api');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-walk-'));
  try {
    fs.mkdirSync(path.join(root, '.auto-refactor-cache'), { recursive: true });
    fs.mkdirSync(path.join(root, 'app', 'deep'), { recursive: true });
    const expected = path.join(root, '.auto-refactor-cache');
    assert.strictEqual(resolveReviewMemoryDir(path.join(root, 'app', 'deep')), expected);
    assert.strictEqual(resolveReviewMemoryDir(root), expected);
    assert.strictEqual(resolveReviewMemoryDir(path.join(root, 'app')), expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Review memory compacts its JSONL log instead of growing without bound', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-compact-'));
  try {
    const manager = new ReviewMemoryManager(dir);
    for (let round = 0; round < 4; round += 1) {
      for (let file = 0; file < 200; file += 1) {
        manager.saveRecord({
          filePath: `src/file_${file}.ts`,
          fileHash: `hash-${round}`,
          astDigest: `digest-${round}`,
          codeDomains: [],
          ruleHits: [],
        });
      }
    }
    const lines = fs
      .readFileSync(path.join(dir, 'memory.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0).length;
    assert(lines <= 400, `log must stay inside its compaction budget, got ${lines} lines`);
    assert(manager.size() === 200, 'the in-memory store keeps one record per file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Reloading a log keeps one record per file and the newest audit', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-reload-'));
  try {
    const manager = new ReviewMemoryManager(dir);
    for (const hash of ['first', 'second', 'third']) {
      manager.saveRecord({
        filePath: 'src/repeat.ts',
        fileHash: hash,
        astDigest: 'digest',
        codeDomains: [],
        ruleHits: [],
      });
    }
    // Appends are buffered for one write per batch, so durability starts at the flush boundary
    // the scanner calls when a scan finishes.
    manager.flush();
    const reloaded = new ReviewMemoryManager(dir);
    assert(reloaded.getStats().recordsCount === 1, 'one file maps to one record after reload');
    assert(
      reloaded.get('src/repeat.ts').fileHash === 'third',
      'the newest audit of a file must survive the reload',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('The in-memory cap still evicts after reloading a log with duplicate audits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-evict-'));
  try {
    const record = (filePath, index) =>
      JSON.stringify({
        filePath,
        fileHash: `hash-${index}`,
        astDigest: `digest-${index}`,
        codeDomains: [],
        ruleHits: [],
        lastAudited: index,
      });
    const log = [
      record('src/a.ts', 1),
      record('src/a.ts', 2),
      record('src/a.ts', 3),
      record('src/b.ts', 4),
    ];
    fs.writeFileSync(path.join(dir, 'memory.jsonl'), log.join('\n') + '\n');
    const manager = new ReviewMemoryManager(dir, { maxFilesInMemory: 1 });
    manager.saveRecord({
      filePath: 'src/c.ts',
      fileHash: 'hash-5',
      astDigest: 'digest-5',
      codeDomains: [],
      ruleHits: [],
    });
    assert(manager.size() === 1, 'the in-memory cap must hold after reload');
    assert(manager.get('src/c.ts'), 'the newest audit stays resident');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function cacheDisabledLeavesNoLog() {
  const { resolveConfig } = require('../dist/core/config');
  assert.strictEqual(
    resolveConfig({ cache: false }).cacheEnabled,
    false,
    'cache:false disables disk caches',
  );
  assert.strictEqual(resolveConfig({}).cacheEnabled, true, 'caching stays enabled by default');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-nocache-'));
  const childRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-memory-persist-'));
  try {
    fs.writeFileSync(path.join(root, 'probe.ts'), 'export const value = 1;\n');
    const configFile = path.join(root, 'auto-refactor.config.json');
    fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*.ts'] }, null, 2));
    await scan({ root, configFile, logLevel: 'silent', cache: false, daemon: 'off' });
    assert.strictEqual(
      fs.existsSync(path.join(root, '.auto-refactor-cache')),
      false,
      'a --no-cache scan must not create any cache directory',
    );

    // Persistence needs a cold process: inside this one the session cache would serve a second
    // scan without auditing the fixture, and only an audit writes review memory.
    fs.writeFileSync(path.join(childRoot, 'probe.ts'), 'export const value = 1;\n');
    fs.writeFileSync(
      path.join(childRoot, 'auto-refactor.config.json'),
      JSON.stringify({ include: ['**/*.ts'] }, null, 2),
    );
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "require('./dist/api').scan({ root: process.env.AR_ROOT, configFile: process.env.AR_CFG, logLevel: 'silent', daemon: 'off' }).then(() => process.exit(0)).catch(() => process.exit(1));",
      ],
      {
        cwd: path.join(__dirname, '..'),
        env: {
          ...process.env,
          AR_ROOT: childRoot,
          AR_CFG: path.join(childRoot, 'auto-refactor.config.json'),
        },
      },
    );
    assert.strictEqual(child.status, 0, `default scan must succeed, exit=${child.status}`);
    assert.ok(
      fs.existsSync(path.join(childRoot, '.auto-refactor-cache', 'memory.jsonl')),
      'a default scan must still persist review memory',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(childRoot, { recursive: true, force: true });
  }
  total += 1;
  passed += 1;
  console.log('  ✓ [PASS] cache:false leaves no trace on disk, a default scan still persists');
}

cacheDisabledLeavesNoLog()
  .then(() => {
    console.log(`\n All ${passed}/${total} Review Memory & Quality System tests PASSED!\n`);
  })
  .catch((error) => {
    console.error('  x [FAIL] cache:false check:', error && error.message ? error.message : error);
    process.exit(1);
  });
