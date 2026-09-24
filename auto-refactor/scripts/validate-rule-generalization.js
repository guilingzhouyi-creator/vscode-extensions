/**
 * Module: Verification Harness — Rule Generalization & Knowledge Pipeline
 * File Path: scripts/validate-rule-generalization.js
 * Architecture Role: End-to-end verification suite for Rule Generalization;
 *   asserts candidate lifecycle, 4-tier generalization scrutiny,
 *   cross-language fixture evaluation (TS, Python, Rust),
 *   rule engine integration, and registry consistency.
 * Dependencies & Triggers: `node scripts/validate-rule-generalization.js`; part of
 *   parallel test runner suite.
 * Responsibilities: Verify candidate promotion, assert multi-language detection for
 *   HYG-WRAP-001, GOV-EXC-003, and ARCH-DISP-001, verify false positive guards, and assert
 *   rule pyramid tier alignment.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on assertion failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  defaultGeneralizationPipeline,
  RuleGeneralizationPipeline,
  auditVacuousWrappers,
  HYG_WRAP_RULE_ID,
  checkJsTsSilentExceptions,
  checkPythonSilentExceptions,
  GOV_EXC_SILENT_RULE_ID,
  auditDispatchComplexity,
  ARCH_DISP_RULE_ID,
  normalizeParameterNames,
  isTransparentForwarding,
  isPseudoCatchStatement,
} = require('../dist/core/rules/evolution');

const { classifyRuleLayer } = require('../dist/core/rules/pyramid/layer1Evaluator');
const { getRule, RULE_REGISTRY } = require('../dist/core/rules/registry');
const { HygieneAnalyzer } = require('../dist/analyzers/hygiene');
const { ArchitectureAnalyzer } = require('../dist/analyzers/architecture');

function testCandidateStateAndScrutiny() {
  console.log('── Step 1: Candidate State Machine & 4-Tier Scrutiny ──');

  const pipeline = defaultGeneralizationPipeline;
  const candidates = pipeline.listCandidates();
  assert.ok(candidates.length >= 3, 'Must have at least 3 foundational candidates');

  const wrapCand = pipeline.getCandidate('cand-hyg-wrap');
  assert.ok(wrapCand, 'cand-hyg-wrap must exist');
  assert.strictEqual(wrapCand.canonicalRuleId, 'HYG-WRAP-001');
  assert.strictEqual(wrapCand.level, 'universal');

  const excCand = pipeline.getCandidate('cand-gov-exc');
  assert.ok(excCand, 'cand-gov-exc must exist');
  assert.strictEqual(excCand.canonicalRuleId, 'GOV-EXC-003');
  assert.strictEqual(excCand.level, 'language_family');

  const dispCand = pipeline.getCandidate('cand-arch-disp');
  assert.ok(dispCand, 'cand-arch-disp must exist');
  assert.strictEqual(dispCand.canonicalRuleId, 'ARCH-DISP-001');
  assert.strictEqual(dispCand.level, 'universal');

  // Test Tier 0 rejection (project-specific)
  const customPipeline = new RuleGeneralizationPipeline();
  customPipeline.registerCandidate({
    id: 'cand-project-hack',
    canonicalRuleId: 'HACK-001',
    title: 'Project Specific Hack',
    family: 'HYG',
    targetAnalyzer: 'hygiene',
    level: 'project_specific',
    status: 'draft',
    origin: 'Test',
    badPattern: 'Specific bad pattern',
    goodPattern: 'Specific good pattern',
    fixtures: [],
  });

  const scrutiny = customPipeline.evaluateScrutiny('cand-project-hack');
  assert.strictEqual(scrutiny.passed, false, 'Project-specific rule must fail global promotion');
  assert.strictEqual(scrutiny.eligibleForPromotion, false);

  // Test successful promotion of foundational candidate
  const promotion = pipeline.promoteCandidate('cand-hyg-wrap');
  assert.strictEqual(promotion.canonicalRuleId, 'HYG-WRAP-001');
  assert.strictEqual(promotion.ruleLayer, 'layer1_universal');
  assert.ok(promotion.verifiedLanguages.includes('typescript'));
  assert.ok(promotion.verifiedLanguages.includes('python'));
  assert.ok(promotion.verifiedLanguages.includes('rust'));

  console.log('  [PASS] Candidate state machine & 4-tier scrutiny validated');
}

function testPatternNormalizer() {
  console.log('── Step 2: Pattern Normalizer Utilities ──');

  // Parameter normalizer
  assert.deepStrictEqual(
    normalizeParameterNames('a: string, b: number, c = 10'),
    ['a', 'b', 'c'],
    'TypeScript typed parameters normalized',
  );
  assert.deepStrictEqual(
    normalizeParameterNames('self, user_id, mode: str = "default"'),
    ['user_id', 'mode'],
    'Python parameters normalized (self stripped)',
  );
  assert.deepStrictEqual(
    normalizeParameterNames('&mut self, id: u64, code: usize'),
    ['id', 'code'],
    'Rust parameters normalized (&mut self stripped)',
  );

  // Transparent forwarding
  assert.strictEqual(
    isTransparentForwarding(['a', 'b'], 'a, b'),
    true,
    'Identical args must be recognized as forwarding',
  );
  assert.strictEqual(
    isTransparentForwarding(['a', 'b'], 'b, a'),
    false,
    'Reordered args must not be recognized as transparent',
  );
  assert.strictEqual(
    isTransparentForwarding(['a'], 'a + 1'),
    false,
    'Transformed arg must not be transparent',
  );

  // Pseudo-catch statement detection
  assert.strictEqual(isPseudoCatchStatement('void 0;'), true, 'void 0 detected');
  assert.strictEqual(isPseudoCatchStatement('pass'), true, 'pass detected');
  assert.strictEqual(isPseudoCatchStatement('const _ = err;'), true, 'dummy assignment detected');
  assert.strictEqual(isPseudoCatchStatement('logger.error(err);'), false, 'logging is active');
  assert.strictEqual(isPseudoCatchStatement('throw err;'), false, 'throw is active');

  console.log('  [PASS] Cross-language pattern normalizer validated');
}

function testHygWrapMultiLanguage() {
  console.log('── Step 3: HYG-WRAP-001 Multi-Language Verification ──');

  const tsBad = `
function forwardQuery(id: string, count: number): Result {
    return this.target.fetchData(id, count);
}
`;
  const tsGood = `
function forwardQuery(id: string, count: number): Result {
    if (count <= 0) throw new Error("Invalid count");
    return this.target.fetchData(id, count);
}
`;
  const tsExempt = `
/** @deprecated Use target.fetchData directly */
function forwardQuery(id: string, count: number): Result {
    return this.target.fetchData(id, count);
}
`;

  const fakeCtx = (content, filePath) => ({ content, filePath, options: {} });

  const tsBadIssues = auditVacuousWrappers(
    tsBad,
    'src/service.ts',
    fakeCtx(tsBad, 'src/service.ts'),
  );
  assert.strictEqual(tsBadIssues.length, 1, 'TS bad wrapper must be detected');
  assert.strictEqual(tsBadIssues[0].rule, HYG_WRAP_RULE_ID);

  const tsGoodIssues = auditVacuousWrappers(
    tsGood,
    'src/service.ts',
    fakeCtx(tsGood, 'src/service.ts'),
  );
  assert.strictEqual(tsGoodIssues.length, 0, 'TS good wrapper must pass');

  const tsExemptIssues = auditVacuousWrappers(
    tsExempt,
    'src/service.ts',
    fakeCtx(tsExempt, 'src/service.ts'),
  );
  assert.strictEqual(tsExemptIssues.length, 0, 'TS @deprecated wrapper must be exempt');

  // Python validation
  const pyBad = `
def get_user(user_id, mode):
    return self.client.get_user(user_id, mode)
`;
  const pyGood = `
def get_user(user_id, mode):
    logger.info("Fetching user %s", user_id)
    return self.client.get_user(user_id, mode)
`;
  const pyBadIssues = auditVacuousWrappers(pyBad, 'app/client.py', fakeCtx(pyBad, 'app/client.py'));
  assert.strictEqual(pyBadIssues.length, 1, 'Python bad wrapper must be detected');

  const pyGoodIssues = auditVacuousWrappers(
    pyGood,
    'app/client.py',
    fakeCtx(pyGood, 'app/client.py'),
  );
  assert.strictEqual(pyGoodIssues.length, 0, 'Python good wrapper must pass');

  // Rust validation
  const rsBad = `
fn dispatch(id: u64, code: u32) -> Result {
    self.inner.dispatch(id, code)
}
`;
  const rsGood = `
/// @deprecated use inner.dispatch
fn dispatch(id: u64, code: u32) -> Result {
    self.inner.dispatch(id, code)
}
`;
  const rsBadIssues = auditVacuousWrappers(rsBad, 'src/lib.rs', fakeCtx(rsBad, 'src/lib.rs'));
  assert.strictEqual(rsBadIssues.length, 1, 'Rust bad wrapper must be detected');

  const rsGoodIssues = auditVacuousWrappers(rsGood, 'src/lib.rs', fakeCtx(rsGood, 'src/lib.rs'));
  assert.strictEqual(rsGoodIssues.length, 0, 'Rust documented wrapper must pass');

  console.log('  [PASS] HYG-WRAP-001 verified on TypeScript, Python, Rust');
}

function testGovExcSilentMultiLanguage() {
  console.log('── Step 4: GOV-EXC-003 Multi-Language Verification ──');

  const tsBad = `
try {
    doWork();
} ${'catch'} (err) {
    ${'void 0'};
}
`;
  const tsGood = `
try {
    doWork();
} catch (err) {
    // best-effort cleanup on shutdown
}
`;

  const tsBadViolations = checkJsTsSilentExceptions(tsBad.split('\n'));
  assert.strictEqual(tsBadViolations.length, 1, 'TS pseudo-catch must be flagged');
  assert.strictEqual(tsBadViolations[0].ruleId, GOV_EXC_SILENT_RULE_ID);

  const tsGoodViolations = checkJsTsSilentExceptions(tsGood.split('\n'));
  assert.strictEqual(tsGoodViolations.length, 0, 'TS catch with best-effort marker must pass');

  // Python validation
  const pyBad = `
try:
    do_work()
except Exception as e:
    _ = e
`;
  const pyGood = `
try:
    do_work()
except Exception as e:
    # expected during shutdown
    pass
`;

  const pyBadViolations = checkPythonSilentExceptions(pyBad.split('\n'));
  assert.strictEqual(pyBadViolations.length, 1, 'Python pseudo-catch must be flagged');
  assert.strictEqual(pyBadViolations[0].ruleId, GOV_EXC_SILENT_RULE_ID);

  const pyGoodViolations = checkPythonSilentExceptions(pyGood.split('\n'));
  assert.strictEqual(pyGoodViolations.length, 0, 'Python except with rationale marker must pass');

  console.log('  [PASS] GOV-EXC-003 verified on TypeScript & Python');
}

function testArchDispMultiLanguage() {
  console.log('── Step 5: ARCH-DISP-001 Monolithic Dispatcher Verification ──');

  const badSwitch = `
function dispatch(action: string, payload: any) {
    switch (action) {
        case 'A': handleA(payload); break;
        case 'B': handleB(payload); break;
        case 'C': handleC(payload); break;
        case 'D': handleD(payload); break;
        case 'E': handleE(payload); break;
        case 'F': handleF(payload); break;
        case 'G': handleG(payload); break;
        case 'H': handleH(payload); break;
        case 'I': handleI(payload); break;
        default: break;
    }
}
`;

  const goodTable = `
const TABLE: Record<string, (p: any) => void> = {
    A: handleA,
    B: handleB,
};
function dispatch(action: string, payload: any) {
    TABLE[action]?.(payload);
}
`;

  const fakeCtx = { options: { maxDispatchBranches: 8 } };
  const badIssues = auditDispatchComplexity(badSwitch, 'src/dispatcher.ts', fakeCtx);
  assert.strictEqual(badIssues.length, 1, 'Monolithic switch dispatcher must be flagged');
  assert.strictEqual(badIssues[0].rule, ARCH_DISP_RULE_ID);

  const goodIssues = auditDispatchComplexity(goodTable, 'src/dispatcher.ts', fakeCtx);
  assert.strictEqual(goodIssues.length, 0, 'Table-driven dispatcher must pass');

  console.log('  [PASS] ARCH-DISP-001 verified on procedural dispatchers');
}

function testArchDspClosureFragmentation() {
  console.log('── Step 5b: ARCH-DSP-002 Dispatcher Closure Fragmentation Verification ──');

  const closureLines = [];
  for (let i = 1; i <= 20; i++) {
    closureLines.push(`    'flag-${i}': (opt, v) => { opt.f${i} = v; },`);
  }
  const badClosureTable = `
const BOOL_SETTERS: Record<string, (opt: any, v: boolean) => void> = {
${closureLines.join('\n')}
};
`;

  const fakeCtx = { options: { maxDispatcherClosures: 15 } };
  const badIssues = auditDispatchComplexity(badClosureTable, 'src/dispatcher.ts', fakeCtx);
  const closureIssue = badIssues.find((i) => i.rule === 'ARCH-DSP-002');
  assert.ok(closureIssue, 'Dispatcher table with >= 15 closures must emit ARCH-DSP-002');
  assert.strictEqual(closureIssue.detail.closureCount, 20);

  // cli-parser.ts should have 0 ARCH-DSP-002 issues
  const cliParserPath = path.join(__dirname, '..', 'src', 'cli', 'cli-parser.ts');
  const cliContent = fs.readFileSync(cliParserPath, 'utf8');
  const cliIssues = auditDispatchComplexity(cliContent, 'src/cli/cli-parser.ts', fakeCtx);
  const cliClosureIssues = cliIssues.filter((i) => i.rule === 'ARCH-DSP-002');
  assert.strictEqual(
    cliClosureIssues.length,
    0,
    'cli-parser.ts orthogonal switch dispatchers must pass',
  );

  console.log('  [PASS] ARCH-DSP-002 verified on closure fragmentation');
}

function testAnalyzerIntegration() {
  console.log('── Step 6: Analyzer Pipeline & Registry Integration ──');

  // Test HygieneAnalyzer emitting HYG-WRAP-001
  const hygiene = new HygieneAnalyzer();
  const sampleContent = `
function forwardCall(a: string, b: number) {
    return this.target.forwardCall(a, b);
}
`;
  const hygieneIssues = hygiene.analyze(null, {
    filePath: 'src/test-wrapper.ts',
    content: sampleContent,
    options: {},
  });
  const wrapFinding = hygieneIssues.find((i) => i.rule === 'HYG-WRAP-001');
  assert.ok(wrapFinding, 'HygieneAnalyzer must emit HYG-WRAP-001');

  // Test ArchitectureAnalyzer emitting ARCH-DISP-001
  const arch = new ArchitectureAnalyzer();
  const archContent = `
function run(cmd: string) {
    switch (cmd) {
        case '1': do1(); break;
        case '2': do2(); break;
        case '3': do3(); break;
        case '4': do4(); break;
        case '5': do5(); break;
        case '6': do6(); break;
        case '7': do7(); break;
        case '8': do8(); break;
        case '9': do9(); break;
        default: break;
    }
}
`;
  const archIssues = arch.analyze(null, {
    filePath: 'src/domain/dispatcher.ts',
    content: archContent,
    config: {},
    options: { maxDispatchBranches: 8 },
  });
  const dispFinding = archIssues.find((i) => i.rule === 'ARCH-DISP-001');
  assert.ok(dispFinding, 'ArchitectureAnalyzer must emit ARCH-DISP-001');

  // Test ArchitectureAnalyzer emitting ARCH-DEC-002
  const parserDecoupleContent = `
import { Parser } from 'oxc-parser';
export class CustomService {}
`;
  const decoupleIssues = arch.analyze(null, {
    filePath: 'src/domain/analyzer-service.ts',
    content: parserDecoupleContent,
    config: {},
    options: {},
  });
  const decoupleFinding = decoupleIssues.find((i) => i.rule === 'ARCH-DEC-002');
  assert.ok(
    decoupleFinding,
    'ArchitectureAnalyzer must emit ARCH-DEC-002 for direct parser coupling',
  );

  // Test Pyramid Layer Classification
  assert.strictEqual(classifyRuleLayer('HYG-WRAP-001'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('ARCH-DISP-001'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('ARCH-DEC-002'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('GOV-EXC-003'), 'layer2_family');

  // Test Registry Registration
  const wrapRule = getRule('HYG-WRAP-001');
  assert.ok(wrapRule, 'HYG-WRAP-001 must be registered');
  assert.strictEqual(wrapRule.analyzer, 'hygiene');
  assert.strictEqual(wrapRule.canonical, true);

  const excRule = getRule('GOV-EXC-003');
  assert.ok(excRule, 'GOV-EXC-003 must be registered');
  assert.strictEqual(excRule.analyzer, 'governance');
  assert.strictEqual(excRule.canonical, true);

  const dispRule = getRule('ARCH-DISP-001');
  assert.ok(dispRule, 'ARCH-DISP-001 must be registered');
  assert.strictEqual(dispRule.analyzer, 'architecture');
  assert.strictEqual(dispRule.canonical, true);

  const decRule = getRule('ARCH-DEC-002');
  assert.ok(decRule, 'ARCH-DEC-002 must be registered');
  assert.strictEqual(decRule.analyzer, 'architecture');
  assert.strictEqual(decRule.canonical, true);

  console.log(
    `  [PASS] Full analyzer integration & registry lookup (${RULE_REGISTRY.length} rules)`,
  );
}

function run() {
  console.log('===============================================================');
  console.log(' Rule Generalization: RULE GENERALIZATION & KNOWLEDGE PIPELINE VERIFICATION');
  console.log('===============================================================');

  testCandidateStateAndScrutiny();
  testPatternNormalizer();
  testHygWrapMultiLanguage();
  testGovExcSilentMultiLanguage();
  testArchDispMultiLanguage();
  testArchDspClosureFragmentation();
  testAnalyzerIntegration();

  console.log(
    '\n>>> ALL Rule Generalization RULE GENERALIZATION CHECKS PASSED SUCCESSFULLY! <<<\n',
  );
}

run();
