#!/usr/bin/env node
/**
 * Module: Verification Harness — Modern Governance & Quality Validation
 * File Path: scripts/validate-governance.js
 * Architecture Role: End-to-end integration gate for GovernanceAnalyzer; drives a real
 *   scan() over generated TS, GDScript, Rust and Python fixtures in an OS temp dir.
 * Dependencies & Triggers: ../dist/api (scan, GovernanceAnalyzer, getDefaultGovernanceRegistry)
 *   plus node fs/path/os; run manually or from the validation/CI gate.
 * Responsibilities: Writes one deliberately violating fixture per language; enables the
 *   governance analyzer with maxNestingDepth/maxInheritanceDepth limits; asserts all 8
 *   categories are detected: standardization (GOV-STD-*), file structure (GOV-FIL-*), code
 *   logic (GOV-LOG-*), type system (GOV-TYP-*), exception resilience (GOV-EXC-*), debug
 *   logging (GOV-DBG-*), performance (GOV-PRF-*) and maintainability (GOV-MNT-*); validates
 *   the diagnostic output contract
 *   (location -> category -> risk -> rationale -> suggestion -> fixable);
 *   checks Rust inheritance skipping, GDScript weak typing, TS empty catch, Python header/
 *   jargon/return/except findings and the GOV-STD-001/GOV-MNT-002 fixable flags; removes the
 *   temp dir afterwards.
 * Exit Semantics & Design Rationale: Counts passed/total assertions and exits 1 when any
 *   fails, otherwise 0. Generated os.tmpdir() fixtures keep the gate hermetic so it never
 *   depends on repository samples or leaves state behind.
 */

const { scan } = require('../dist/api');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP_DIR = path.join(os.tmpdir(), `ar-gov-validate-${Date.now()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

function write(relPath, content) {
  const full = path.join(TMP_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

/**
 * Set up sample files and configuration in TMP_DIR.
 */
function setupFixtures() {
  // TypeScript Sample with violations across dimensions
  write(
    'src/domain/payment_service.ts',
    `import * as vscode from 'vscode'; // Coupling violation (GOV-MNT-002)

var legacyKey = 'secret'; // Deprecated construct (GOV-STD-002)

// Root service class; its subclasses below exercise the inheritance depth rule.
export class BasePaymentService {}
// Mid-level child; kept empty on purpose so only the depth chain matters.
export class ChildPaymentService extends BasePaymentService {}
// Third level that must raise GOV-MNT-001 for exceeding maxInheritanceDepth.
export class SubChildPaymentService extends ChildPaymentService {} // Inheritance depth (GOV-MNT-001)

// Unsafe order handler; the any-typed parameter is deliberate for GOV-TYP-003.
export function processOrder(order: any) { // Unsafe any (GOV-TYP-003)
  console.log('Processing order', order); // Diagnostic leak (GOV-DBG-001)

  try {
    const raw = JSON.parse(order.data);
  } ${'catch (err) {'}
    // Swallowed exception (GOV-EXC-001)
  }

  // Redundant boolean (GOV-STD-001)
  if (order.amount > 0) return true; else return false;

  // Excessive nesting (GOV-LOG-001)
  if (order.valid) {
    if (order.verified) {
      if (order.hasFunds) {
        if (order.notBlacklisted) {
          if (order.isDomestic) {
            if (order.confirmed) {
              return true;
            }
          }
        }
      }
    }
  }

  // Loop invariant & linear search (GOV-PRF-001, GOV-PRF-002)
  const items = [1, 2, 3];
  for (let i = 0; i < 100; i++) {
    const cfg = JSON.parse('{"rate": 0.05}');
    const hit = items.includes(i);
  }

  return false;
}
`,
  );

  // Diagnostic message English violation fixture (GOV-MSG-001)
  write(
    'src/analyzers/sample_violating_analyzer.ts',
    `export class ViolatingAnalyzer {
    audit() {
        return {
            rule: 'TEST-001',
            message: '严重错误：变量未定义',
            suggestion: '请修复该变量声明',
        };
    }
}
`,
  );

  // GDScript Sample with violations
  write(
    'backend/domains/battle_system.gd',
    `# ==============================================================================
# 文件路径: res://backend/domains/battle_system.gd
# 职责: 战斗系统领域模型
# ==============================================================================
class_name BattleSystem
extends Control # Framework coupling (GOV-MNT-001)

var current_hp = 100 # Weak typing (GOV-TYP-001)

# Untyped helper kept deliberately weak for GOV-TYP-001/GOV-TYP-002 detection.
func calculate_damage(attacker, defender): # Missing return type (GOV-TYP-002)
\tprint("Debug attack: ", attacker) # Diagnostic leak (GOV-DBG-001)

\tif attacker.is_alive():
\t\treturn true
\telse:
\t\treturn false # Redundant boolean (GOV-STD-001)
`,
  );

  // Rust Sample with violations
  write(
    'src/engine.rs',
    `// Engine core module
// Fixture hash helper; the naked unwrap below is intentional for GOV-EXC-002.
pub fn compute_hash(input: &str) -> String {
    let opt: Option<i32> = Some(42);
    let val = opt.unwrap(); // Naked unwrap (GOV-EXC-002)
    println!("Computing hash: {}", input); // Diagnostic leak (GOV-DBG-001)
    format!("{}_{}", input, val)
}
`,
  );

  // Python Sample with violations (GOV-FIL-002 path mismatch, GOV-SAN-001 jargon tag,
  // GOV-TYP-002 missing return, GOV-EXC-001 bare/swallowed except)
  write(
    'src/domain/worker.py',
    `# ==============================================================================
# 文件路径: src/domain/wrong_worker.py
# 职责: 任务处理工作器
# ==============================================================================
# Temporary fix for p85 combat loop and st99 wip items

# Task worker fixture; the bare except below is intentional for GOV-EXC-001.
def process_task(task_id: str):
    try:
        do_work()
    except:
        pass
`,
  );

  // Documented best-effort catch: the rationale marker must satisfy GOV-EXC-001, while an
  // unexplained comment-only catch (the fixture above) still fails.
  write(
    'src/domain/documented_catch.ts',
    `export function readQuietly(loader: () => string): string | null {
  try {
    return loader();
  } catch {
    /* Best-effort: optional cache read; a miss simply yields null. */
  }
  return null;
}
`,
  );

  // Sync-I/O policy fixture: the same call is reported for library code and silenced for a
  // path declared in blockingIoAllowPatterns (shared policy key with performance/PRF-IO-001).
  write(
    'src/domain/sync_io.ts',
    `export function loadSync(): string {
  return require('fs').readFileSync('data.json', 'utf8');
}
`,
  );

  // Configuration enabling governance analyzer
  const config = {
    include: ['**/*.ts', '**/*.gd', '**/*.rs', '**/*.py'],
    thresholds: { blockingIoAllowPatterns: ['scripts/**'] },
    analyzers: {
      governance: {
        enabled: true,
        options: {
          maxNestingDepth: 5,
          maxInheritanceDepth: 2,
        },
      },
    },
    logLevel: 'silent',
    workers: 1,
  };
  write('auto-refactor.config.json', JSON.stringify(config, null, 2));
}

/**
 * Verify that findings cover all 8 governance categories.
 */
function verifyCoreCategories(govIssues) {
  console.log('\n--- 2. Verifying 8 Core Governance Categories ---');
  const categoryCounts = {};
  for (const issue of govIssues) {
    const cat = issue.detail?.category;
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const expectedCategories = [
    'standardization',
    'file_structure',
    'code_logic',
    'type_system',
    'exception_safety',
    'debug_logging',
    'performance',
    'maintainability',
  ];

  for (const cat of expectedCategories) {
    assert(
      categoryCounts[cat] > 0,
      `Category \`${cat}\` detected (findings: ${categoryCounts[cat] || 0})`,
    );
  }
}

/**
 * Verify the diagnostic schema contract on every governance finding.
 */
function verifyOutputSchema(govIssues) {
  console.log('\n--- 3. Verifying the Diagnostic Output Schema ---');
  let contractValid = true;
  for (const issue of govIssues) {
    const { id, analyzer, rule, severity, message, location, detail, suggestion } = issue;
    if (
      !id ||
      analyzer !== 'governance' ||
      !rule ||
      !severity ||
      !message ||
      !location ||
      !location.file ||
      !location.start ||
      !detail ||
      !detail.category ||
      !detail.risk ||
      !detail.rationale ||
      typeof detail.fixable !== 'boolean' ||
      !detail.targetLanguage ||
      !suggestion
    ) {
      contractValid = false;
      console.error('Invalid issue contract:', issue);
      break;
    }
  }
  assert(
    contractValid,
    'All findings strictly comply with the diagnostic output schema (location -> ' +
      'category -> risk -> rationale -> suggestion -> fixable)',
  );
}

/**
 * Verify language-specific adaptation and boundary rules across TS, GDScript, Rust, and Python.
 */
function verifyLanguageAdaptation(issues) {
  console.log('\n--- 4. Verifying Language Adaptation & Boundary Protection ---');
  const rustIssues = issues.filter((i) => i.location.file.endsWith('.rs'));
  const rustInheritanceIssues = rustIssues.filter((i) => i.rule === 'GOV-MNT-001');
  assert(
    rustInheritanceIssues.length === 0,
    'Rust file receives 0 class inheritance violations (Rust lacks classes, correctly skipped)',
  );

  const gdIssues = issues.filter((i) => i.location.file.endsWith('.gd'));
  const gdWeakTypeIssues = gdIssues.filter((i) => i.rule === 'GOV-TYP-001');
  assert(
    gdWeakTypeIssues.length > 0,
    `GDScript file correctly detected weak \`var =\` type violation (${gdWeakTypeIssues.length})`,
  );

  const tsIssues = issues.filter((i) => i.location.file.endsWith('.ts'));
  const tsCatchIssues = tsIssues.filter((i) => i.rule === 'GOV-EXC-001');
  assert(
    tsCatchIssues.length > 0,
    `TypeScript file correctly detected empty catch block violation (${tsCatchIssues.length})`,
  );

  const documentedCatchIssues = tsIssues.filter(
    (i) => i.rule === 'GOV-EXC-001' && i.location.file.endsWith('documented_catch.ts'),
  );
  assert(
    documentedCatchIssues.length === 0,
    `A catch documented with a rationale marker must stay silent (${documentedCatchIssues.length})`,
  );

  const syncIoIssues = tsIssues.filter((i) => i.rule === 'GOV-PRF-004');
  assert(
    syncIoIssues.length > 0,
    `GOV-PRF-004 must report synchronous fs outside the policy globs (${syncIoIssues.length})`,
  );

  const pyIssues = issues.filter((i) => i.location.file.endsWith('.py'));
  const pyJargonIssues = pyIssues.filter((i) => i.rule === 'GOV-SAN-001');
  assert(
    pyJargonIssues.length > 0,
    `Python file correctly detected lexical hygiene / temporary jargon violation (${pyJargonIssues.length})`,
  );

  const pyHeaderIssues = pyIssues.filter((i) => i.rule === 'GOV-FIL-002');
  assert(
    pyHeaderIssues.length > 0,
    `Python file correctly detected module header path mismatch violation (${pyHeaderIssues.length})`,
  );

  const pyReturnIssues = pyIssues.filter((i) => i.rule === 'GOV-TYP-002');
  assert(
    pyReturnIssues.length > 0,
    `Python file correctly detected unannotated function return type violation (${pyReturnIssues.length})`,
  );

  const pyExceptIssues = pyIssues.filter((i) => i.rule === 'GOV-EXC-001');
  assert(
    pyExceptIssues.length > 0,
    `Python file correctly detected bare/swallowed except violation (${pyExceptIssues.length})`,
  );

  const msgIssues = issues.filter((i) => i.rule === 'GOV-MSG-001');
  assert(
    msgIssues.length > 0,
    `Analyzer diagnostic message correctly detected non-English characters (GOV-MSG-001) (${msgIssues.length})`,
  );
}

/**
 * Verify auto-fixability flags on findings.
 */
function verifyAutoFixability(issues) {
  console.log('\n--- 5. Verifying Safe Auto-Fixability Annotations ---');
  const boolIssues = issues.filter((i) => i.rule === 'GOV-STD-001');
  assert(
    boolIssues.length > 0 && boolIssues[0].detail.fixable === true,
    'GOV-STD-001 marked fixable: true with suggestedPatch',
  );

  const domainCouplingIssues = issues.filter((i) => i.rule === 'GOV-MNT-002');
  assert(
    domainCouplingIssues.length > 0 && domainCouplingIssues[0].detail.fixable === false,
    'GOV-MNT-002 marked fixable: false (architectural change, only recommendation provided)',
  );
}

/**
 * Clean up temporary test files and print final test summary.
 */
function cleanupAndExit() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch (_e) {
    /* Best-effort: a failed temp-dir cleanup must never mask the verification verdict. */
  }

  console.log('='.repeat(80));
  if (passedCount === totalCount) {
    console.log(`🎉 ALL ${passedCount}/${totalCount} GOVERNANCE VALIDATION CHECKS PASSED!`);
    process.exit(0);
  } else {
    console.error(`❌ ${totalCount - passedCount}/${totalCount} CHECKS FAILED!`);
    process.exit(1);
  }
}

/**
 * Execute the governance validation suite end to end.
 */
async function run() {
  console.log('='.repeat(80));
  console.log('🧪 Running Modern Governance & Cross-Language Quality Validation Suite');
  console.log('='.repeat(80));

  // 1. Setup sample files in TMP_DIR
  setupFixtures();

  // 2. Execute Scan
  console.log('\n--- 1. Executing Governance Scan across TS, GDScript & Rust ---');
  const report = await scan({
    root: TMP_DIR,
    configFile: path.join(TMP_DIR, 'auto-refactor.config.json'),
    format: 'json',
    logLevel: 'silent',
  });

  const issues = report.issues || [];
  const govIssues = issues.filter((i) => i.analyzer === 'governance');
  console.log(
    `  Scanned files: ${report.summary?.totalFiles || 0}, Governance findings: ${govIssues.length} (total: ${issues.length})`,
  );

  // 3. Verify All 8 Categories Are Detected
  verifyCoreCategories(govIssues);

  // 4. Verify the structured output contract
  verifyOutputSchema(govIssues);

  // 5. Verify language adaptation
  verifyLanguageAdaptation(issues);

  // 6. Verify Auto-Fixability Annotations
  verifyAutoFixability(issues);

  // 7. Clean up and exit
  cleanupAndExit();
}

run().catch((err) => {
  console.error('Fatal error in validate-governance:', err);
  process.exit(1);
});
