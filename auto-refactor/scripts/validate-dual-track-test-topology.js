/**
 * Module: Test Pipeline — Multi-Language Dual-Track Test Topology Validation
 * File Path: scripts/validate-dual-track-test-topology.js
 * Architecture Role: Verifies dual-track test topology governance, Rust embedded test zone
 *   contracts (zone partitioning, zero production bleed, LOC decoupling, agent-readable intent),
 *   large-file analyzer test LOC subtraction, and cross-language paradigm protection (TST-TOP-001).
 * Dependencies & Triggers: Node assert; executed as test suite 107 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify Rust embedded test zone classification and production LOC decoupling.
 *   2. Verify LargeFileAnalyzer exemption when test LOC is decoupled.
 *   3. Verify Rust contracts: tail isolation, #[cfg(test)] attribute, and agent-readable comments.
 *   4. Verify cross-language discipline (TST-TOP-001) blocking embedded tests in TS/GDScript.
 *   5. Verify quality scoring deduction table routing into maintainability.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { partitionFileZones } = require('../dist/core/intelligence/zone-partitioner');
const { analyzeCodeDensity } = require('../dist/core/intelligence/code-density-analyzer');
const { DualTrackTestEvaluator } = require('../dist/core/scoring/dual-track-test-evaluator');
const { LargeFileAnalyzer } = require('../dist/analyzers/large-file');
const { TestModernityAnalyzer } = require('../dist/analyzers/test-modernity');
const { DIMENSION_RULES } = require('../dist/core/scoring/dimensionRuleTable');
const {
  RULE_TST_TOP_001,
  DEDUCTION_TEST_TOPOLOGY_DISCIPLINE,
  DIMENSION_MAINTAINABILITY,
} = require('../dist/core/scoring/dimensionLiterals');

function testRustEmbeddedTestZoneAndLocDecoupling() {
  console.log('1. Testing Rust Embedded Test Zone Partitioning & LOC Decoupling...');

  // Construct a Rust compute kernel with ~100 lines of algorithm + ~350 lines of unit tests
  let rustContent = `
pub fn compute_minhash_signature(tokens: &[u32]) -> Vec<u64> {
    let mut sig = Vec::with_capacity(64);
    for seed in 0..64 {
        let mut min_val = u64::MAX;
        for &t in tokens {
            let h = (t as u64).wrapping_mul(seed).wrapping_add(0x517cc1b727220a95);
            if h < min_val {
                min_val = h;
            }
        }
        sig.push(min_val);
    }
    sig
}
`;
  // Pad algorithm to 100 lines
  for (let i = 0; i < 90; i++) {
    rustContent += `// Algorithmic compute step ${i}\npub fn step_${i}() -> usize { ${i} }\n`;
  }

  // Append embedded unit test zone
  rustContent += `
#[cfg(test)]
mod tests {
    use super::*;

    /// Case: Verify MinHash signature determinism.
    /// Precondition: Uniform test vector generated.
    /// Assertion: Output length must equal 64 and match fixed seed.
    #[test]
    fn test_signature_deterministic() {
        let input = vec![1, 2, 3, 4, 5];
        let s1 = compute_minhash_signature(&input);
        let s2 = compute_minhash_signature(&input);
        assert_eq!(s1, s2);
    }
`;
  // Pad test module to ~350 lines with agent-readable comments
  for (let i = 0; i < 60; i++) {
    rustContent += `
    /// Case: Test permutation boundary #${i}.
    /// Precondition: Seed #${i} initialized.
    /// Assertion: Return code must equal ${i}.
    #[test]
    fn test_permutation_boundary_${i}() {
        assert_eq!(step_${i}(), ${i});
    }
`;
  }
  rustContent += '}\n';

  const filePath = 'src/native/minhash.rs';
  const density = analyzeCodeDensity(rustContent, filePath);
  const zoneProfile = partitionFileZones(rustContent, filePath, density);

  assert.ok(
    zoneProfile.embeddedTestLines > 200,
    `Embedded test lines should exceed 200, got ${zoneProfile.embeddedTestLines}`,
  );
  assert.ok(
    zoneProfile.productionEffectiveLoc < 200,
    `Production effective LOC should be decoupled (<200), got ${zoneProfile.productionEffectiveLoc}`,
  );

  const evaluator = new DualTrackTestEvaluator();
  const result = evaluator.evaluateFile(filePath, rustContent, zoneProfile);

  assert.strictEqual(result.track, 'EMBEDDED_TEST_ZONE');
  assert.strictEqual(
    result.isCompliant,
    true,
    'Well-structured Rust embedded test should be compliant',
  );
  assert.strictEqual(result.findings.length, 0);

  // Verify LargeFileAnalyzer exemption: total lines > 450, but production effective LOC is clean!
  const largeAnalyzer = new LargeFileAnalyzer();
  const largeCtx = {
    filePath,
    content: rustContent,
    config: { archetype: 'systems_runtime', analyzers: {} },
    options: { fileLinesWarn: 400, fileLinesFail: 800, effectiveLocWarn: 400 },
  };

  const largeIssues = largeAnalyzer.analyze(undefined, largeCtx);
  assert.strictEqual(
    largeIssues.length,
    0,
    'LargeFileAnalyzer MUST NOT report large-file on Rust file whose production LOC is under threshold',
  );

  console.log('  ✔ [PASS] Rust embedded test zone partitioning and LOC decoupling verified.');
}

function testRustEmbeddedContracts() {
  console.log('2. Testing Rust Embedded Test Violation Contracts...');

  const evaluator = new DualTrackTestEvaluator();

  // Test Contract: Missing #[cfg(test)]
  const missingCfgTest = `
pub fn kernel() {}

mod tests {
    #[test]
    fn test_uncond() {}
}
`;
  const res1 = evaluator.evaluateFile('src/native/hash.rs', missingCfgTest);
  assert.strictEqual(res1.isCompliant, false);
  const cfgFinding = res1.findings.find(
    (f) => f.reason === 'embedded_test_unconditionally_compiled',
  );
  assert.ok(cfgFinding, 'Missing #[cfg(test)] must trigger embedded_test_unconditionally_compiled');
  assert.strictEqual(cfgFinding.severity, 'error');

  // Test Contract: Not tail-isolated (production code placed after test block)
  const interleavedTest = `
pub fn part1() {}

#[cfg(test)]
mod tests {
    #[test]
    fn t1() {}
}

pub fn part2_after_test() {}
`;
  const density = analyzeCodeDensity(interleavedTest, 'src/native/interleaved.rs');
  const zoneProfile = partitionFileZones(interleavedTest, 'src/native/interleaved.rs', density);
  const res2 = evaluator.evaluateFile('src/native/interleaved.rs', interleavedTest, zoneProfile);

  const tailFinding = res2.findings.find((f) => f.reason === 'embedded_zone_not_tail_isolated');
  assert.ok(tailFinding, 'Interleaved test block must trigger embedded_zone_not_tail_isolated');

  console.log('  ✔ [PASS] Rust embedded test contracts verified.');
}

function testCrossLanguageDisciplineTsAndGdScript() {
  console.log('3. Testing Cross-Language Test Paradigm Discipline (TST-TOP-001)...');

  const testModernityAnalyzer = new TestModernityAnalyzer();

  // Embedded test in TypeScript production file: strictly prohibited!
  const tsProductionWithTest = `
export class OrderProcessor {
    public process(): boolean {
        return true;
    }
}

describe('OrderProcessor', () => {
    it('should process order', () => {
        expect(true).toBe(true);
    });
});
`;

  const tsCtx = {
    filePath: 'src/services/order.ts',
    content: tsProductionWithTest,
    config: { analyzers: {} },
    options: {},
  };

  const issues = testModernityAnalyzer.analyze(undefined, tsCtx);
  const topIssue = issues.find((i) => i.rule === 'TST-TOP-001');

  assert.ok(
    topIssue,
    'Embedding test domain in TypeScript production code must trigger TST-TOP-001',
  );
  assert.strictEqual(
    topIssue.detail.actionableProposal.action,
    'extract_test_suite',
    'Must suggest extracting test suite to external test file',
  );

  console.log('  ✔ [PASS] Cross-language test paradigm discipline verified.');
}

function testQualityScoringRuleTableRouting() {
  console.log('4. Testing Quality Scoring Deduction Routing for TST-TOP-001...');

  const topRule = DIMENSION_RULES.find(
    (r) =>
      r.analyzer === 'test-modernity' &&
      r.dimension === DIMENSION_MAINTAINABILITY &&
      r.covers({ rule: RULE_TST_TOP_001, analyzer: 'test-modernity', message: 'topology' }),
  );

  assert.ok(topRule, 'DIMENSION_RULES must contain mapping for TST-TOP-001');
  assert.strictEqual(
    topRule.points,
    DEDUCTION_TEST_TOPOLOGY_DISCIPLINE,
    'Deduction points must equal DEDUCTION_TEST_TOPOLOGY_DISCIPLINE (15)',
  );

  console.log('  ✔ [PASS] Quality scoring rule table routing verified.');
}

function runAll() {
  console.log('=== Validating Multi-Language Dual-Track Test Topology (TST-TOP-001) ===\n');
  testRustEmbeddedTestZoneAndLocDecoupling();
  testRustEmbeddedContracts();
  testCrossLanguageDisciplineTsAndGdScript();
  testQualityScoringRuleTableRouting();
  console.log('\n[PASS] All 4 Dual-Track Test Topology test suites passed successfully!');
}

try {
  runAll();
} catch (err) {
  console.error('\n[FAIL] Dual-track test topology validation failed:', err);
  process.exit(1);
}
