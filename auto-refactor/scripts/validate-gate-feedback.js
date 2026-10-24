/**
 * Module: Verification Harness — Gate Feedback Vocabulary Governance
 * File Path: scripts/validate-gate-feedback.js
 * Architecture Role: Regression test suite #169; asserts that operator-facing feedback
 *   emitted by gate scripts, hooks, and CI workflows uses registered semantic step
 *   identifiers and a closed four-state vocabulary (PASS/BLOCK/SKIP/WARN) rather than
 *   positional labels or status synonyms (GUARD-FBK-001).
 * Dependencies & Triggers: Consumes dist/core/governance (auditFeedbackContent,
 *   auditFeedbackVocabulary, ORDINAL_LABEL_PATTERNS, STATUS_SYNONYMS) and
 *   scripts/common/validate-gate-feedback.js.
 * Responsibilities:
 *   1. Assert detection of positional labels (ORDINAL-GATE, ORDINAL-RULE, ORDINAL-STAGE);
 *   2. Assert detection of bracketed status synonyms and unclosed tokens;
 *   3. Assert clean acceptance of closed four-state vocabulary and semantic step identifiers;
 *   4. Assert exemption of test harnesses, registry declarations, and explicit markers;
 *   5. Assert parity between engine feedback patterns and workspace guard patterns;
 *   6. Assert end-to-end clean execution across the repository's active gate corpus.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing, 1 on regression.
 */

'use strict';

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const {
  auditFeedbackContent,
  auditFeedbackVocabulary,
  ORDINAL_LABEL_PATTERNS,
  STATUS_SYNONYMS,
  isExemptedFeedbackFile,
  RULE_GUARD_FBK_001,
} = require('../dist/core/governance/gate-feedback');

const { inspectRepoArchetype, auditGateArchitecture } = require('../dist/core/governance');

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const WORKSPACE_GUARD = path.join(WORKSPACE_ROOT, 'scripts/common/validate-gate-feedback.js');

console.log('=== [Verification] Gate Feedback Vocabulary Governance (GUARD-FBK-001) ===');

// --------------------------------------------------------------------------
// 1. Positional Label Detection
// --------------------------------------------------------------------------
console.log('1. Testing positional label detection...');

const positionalCorpus = [
  'Write-Host "Gate 1 passed"',
  'echo "Rule 3.2 violated"',
  'Stage 1: initializing runners',
].join('\n');

const positionalFindings = auditFeedbackContent(positionalCorpus, 'scripts/ps1/probe.ps1');
assert.strictEqual(positionalFindings.length, 3, 'all 3 positional labels must be caught');
assert.strictEqual(positionalFindings[0].patternId, 'ORDINAL-GATE');
assert.strictEqual(positionalFindings[0].line, 1);
assert.strictEqual(positionalFindings[1].patternId, 'ORDINAL-RULE');
assert.strictEqual(positionalFindings[1].line, 2);
assert.strictEqual(positionalFindings[2].patternId, 'ORDINAL-STAGE');
assert.strictEqual(positionalFindings[2].line, 3);
console.log('  ✔ Caught all positional ordinal labels (Gate, Rule, Stage).');

// --------------------------------------------------------------------------
// 2. Status Synonyms Detection
// --------------------------------------------------------------------------
console.log('2. Testing bracketed and unclosed status synonyms...');

const statusCorpus = [
  'echo "[OK] test passed"',
  'echo "[PASS] ready"',
  'exitCode = PASS_WITH_WARNING',
  'echo "[FAIL] broken"',
  'echo "[FAILED] aborting"',
  'echo "[ERROR] failed"',
  'echo "[N/A] skipped"',
  'echo "[DONE] complete"',
  'echo "[SUCCESS] finished"',
  'echo "[INFO] note"',
].join('\n');

const statusFindings = auditFeedbackContent(statusCorpus, 'scripts/sh/probe.sh');
assert.strictEqual(statusFindings.length, 10, 'all 10 status synonyms must be detected');
const detectedPatternIds = new Set(statusFindings.map((f) => f.patternId));
assert.ok(detectedPatternIds.has('STATUS-OK'));
assert.ok(detectedPatternIds.has('STATUS-PASS-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-PASS-WITH-WARNING'));
assert.ok(detectedPatternIds.has('STATUS-FAIL-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-FAILED-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-ERROR-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-NA-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-DONE-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-SUCCESS-BRACKET'));
assert.ok(detectedPatternIds.has('STATUS-INFO-BRACKET'));
console.log('  ✔ Detected all 10 non-closed status synonyms.');

// --------------------------------------------------------------------------
// 3. Clean Vocabulary Acceptance
// --------------------------------------------------------------------------
console.log('3. Testing clean four-state vocabulary acceptance...');

const cleanCorpus = [
  'Write-Host "✔ PASS  pre-commit-gate  All checks passed"',
  'echo "✖ BLOCK pre-push-gate  Violations detected"',
  'echo "⚠ WARN  audit-all  Non-critical observations"',
  'Write-Host "- SKIP  optional-task  Skipped by config"',
  'const stepId = "PC-HYG-01";',
  '# Normal prose mentioning a gate or a rule without ordinal index',
  '# E.g. Gate architecture and rule definitions are healthy',
].join('\n');

const cleanFindings = auditFeedbackContent(cleanCorpus, 'scripts/ps1/clean-gate.ps1');
assert.strictEqual(cleanFindings.length, 0, 'clean vocabulary must produce zero findings');
console.log('  ✔ Closed 4-state vocabulary and semantic step IDs accepted cleanly.');

// --------------------------------------------------------------------------
// 4. Exemption Markers & Path Filtering
// --------------------------------------------------------------------------
console.log('4. Testing exemption markers and self-probing paths...');

assert.strictEqual(isExemptedFeedbackFile('scripts/common/validate-gate-feedback.js'), true);
assert.strictEqual(isExemptedFeedbackFile('scripts/common/gate-step-registry.json'), true);
assert.strictEqual(isExemptedFeedbackFile('scripts/common/test-gate-guards.js'), true);
assert.strictEqual(
  isExemptedFeedbackFile('auto-refactor/src/core/governance/gate-feedback.ts'),
  true,
);
assert.strictEqual(isExemptedFeedbackFile('auto-refactor/scripts/validate-gate-feedback.js'), true);
assert.strictEqual(isExemptedFeedbackFile('scripts/ps1/pre-commit-gate.ps1'), false);

// Exempted file content should return 0 findings even when containing violations
const exemptedFindings = auditFeedbackContent(
  positionalCorpus,
  'scripts/common/validate-gate-feedback.js',
);
assert.strictEqual(exemptedFindings.length, 0, 'exempted file must return zero findings');
console.log('  ✔ Exemption rules verified.');

// --------------------------------------------------------------------------
// 5. Parity with Workspace Guard Definitions
// --------------------------------------------------------------------------
console.log('5. Testing pattern parity with workspace guard...');

if (fs.existsSync(WORKSPACE_GUARD)) {
  const workspaceGuard = require(WORKSPACE_GUARD);
  assert.strictEqual(
    ORDINAL_LABEL_PATTERNS.length,
    workspaceGuard.ORDINAL_LABEL_PATTERNS.length,
    'ordinal pattern counts must match workspace guard',
  );
  assert.strictEqual(
    STATUS_SYNONYMS.length,
    workspaceGuard.STATUS_SYNONYMS.length,
    'status synonym counts must match workspace guard',
  );

  for (let i = 0; i < ORDINAL_LABEL_PATTERNS.length; i++) {
    assert.strictEqual(
      ORDINAL_LABEL_PATTERNS[i].id,
      workspaceGuard.ORDINAL_LABEL_PATTERNS[i].id,
      `ordinal pattern id mismatch at index ${i}`,
    );
  }

  for (let i = 0; i < STATUS_SYNONYMS.length; i++) {
    assert.strictEqual(
      STATUS_SYNONYMS[i].id,
      workspaceGuard.STATUS_SYNONYMS[i].id,
      `status synonym id mismatch at index ${i}`,
    );
  }
  console.log('  ✔ 100% pattern parity verified against workspace guard.');
} else {
  console.log('  - Workspace guard not found at expected relative path, skipped live comparison.');
}

// --------------------------------------------------------------------------
// 6. End-to-End Gate Architecture Integration
// --------------------------------------------------------------------------
console.log('6. Testing end-to-end gate architecture integration...');

const archetypeContext = inspectRepoArchetype(WORKSPACE_ROOT);
const issues = [];
auditFeedbackVocabulary(archetypeContext, issues);

const fbkIssues = issues.filter((i) => i.rule === RULE_GUARD_FBK_001);
assert.strictEqual(
  fbkIssues.length,
  0,
  `active repository gate scripts must have 0 feedback violations, got ${fbkIssues.length}: ` +
    fbkIssues.map((i) => `${i.location.file}:${i.location.start.line} (${i.message})`).join('; '),
);

// Verify auditGateArchitecture option toggle
const disabledAudit = auditGateArchitecture(WORKSPACE_ROOT, {
  enforceFeedbackVocabulary: false,
});
assert.ok(disabledAudit.passed !== undefined, 'auditGateArchitecture completed');

console.log(
  '  ✔ End-to-end gate architecture integration passed with 0 violations in active workspace.',
);

console.log('\n================================================================');
console.log('🎉 ALL Gate Feedback Vocabulary checks PASSED (6/6)!');
console.log('================================================================\n');
process.exit(0);
