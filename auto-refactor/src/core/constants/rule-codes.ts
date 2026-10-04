/**
 * Module: Core Constants — Analyzer Names and Standardized Rule Codes
 * File Path: src/core/constants/rule-codes.ts
 * Architecture Role: Single source of truth for built-in analyzer IDs, raw rule identifiers,
 *     and unified machine-actionable diagnostic codes (AR:<DOMAIN>:<ID>).
 * Dependencies & Triggers: Zero runtime dependencies; imported by all analyzers, rules
 *     registry, diagnostic formatters, and agent consumers.
 * Responsibilities: Centralize canonical strings for built-in analyzer names, existing rule
 *     identifiers, and standardized agent-actionable error codes.
 * Exit Semantics & Design Rationale: Immutable constants preventing analyzer/rule ID drift
 *     and providing the foundational taxonomy for Agent automated patch dispatch.
 */

// ============================================================================
// Built-in Analyzer Identifiers
// ============================================================================

/** Built-in analyzer name for constants. */
export const ANALYZER_CONSTANTS = 'constants';
/** Built-in analyzer name for complexity. */
export const ANALYZER_COMPLEXITY = 'complexity';
/** Built-in analyzer name for large-file. */
export const ANALYZER_LARGE_FILE = 'large-file';
/** Built-in analyzer name for simplify. */
export const ANALYZER_SIMPLIFY = 'simplify';
/** Built-in analyzer name for comments. */
export const ANALYZER_COMMENTS = 'comments';
/** Built-in analyzer name for docs. */
export const ANALYZER_DOCS = 'docs';
/** Built-in analyzer name for stdlib. */
export const ANALYZER_STDLIB = 'stdlib';
/** Built-in analyzer name for rules. */
export const ANALYZER_RULES = 'rules';
/** Built-in analyzer name for dependency-graph. */
export const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';
/** Built-in analyzer name for governance. */
export const ANALYZER_GOVERNANCE = 'governance';
/** Built-in analyzer name for hygiene. */
export const ANALYZER_HYGIENE = 'hygiene';
/** Built-in analyzer name for performance. */
export const ANALYZER_PERFORMANCE = 'performance';
/** Built-in analyzer name for secrets. */
export const ANALYZER_SECRETS = 'secrets';

/** Complete collection of built-in analyzer identifiers. */
export const BUILTIN_ANALYZERS = [
    ANALYZER_CONSTANTS,
    ANALYZER_COMPLEXITY,
    ANALYZER_LARGE_FILE,
    ANALYZER_SIMPLIFY,
    ANALYZER_COMMENTS,
    ANALYZER_DOCS,
    ANALYZER_STDLIB,
    ANALYZER_RULES,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_GOVERNANCE,
    ANALYZER_HYGIENE,
    ANALYZER_PERFORMANCE,
    ANALYZER_SECRETS,
] as const;

// ============================================================================
// Raw Rule Identifiers (Legacy / Engine Compatible)
// ============================================================================

// Constants domain
/** Canonical rule identifier for hardcoded-string checks. */
export const RULE_HARDCODED_STRING = 'hardcoded-string';
/** Canonical rule identifier for magic-number checks. */
export const RULE_MAGIC_NUMBER = 'magic-number';
/** Canonical rule identifier for duplicate-literal checks. */
export const RULE_DUPLICATE_LITERAL = 'duplicate-literal';
/** Canonical rule identifier for nested-constant checks. */
export const RULE_NESTED_CONSTANT = 'nested-constant';
/** Canonical rule identifier for const-lib-001 checks. */
export const RULE_CONST_LIB_001 = 'CONST-LIB-001';

// Complexity domain
/** Canonical rule identifier for high-complexity checks. */
export const RULE_HIGH_COMPLEXITY = 'high-complexity';
/** Canonical rule identifier for deep-nesting checks. */
export const RULE_DEEP_NESTING = 'deep-nesting';

// Large file domain
/** Canonical rule identifier for large-file checks. */
export const RULE_LARGE_FILE = 'large-file';

// Simplify domain
/** Canonical rule identifier for sim-long-function checks. */
export const RULE_SIM_LONG_FUNCTION = 'SIM-LONG-001';
/** Canonical rule identifier for sim-empty-implementation checks. */
export const RULE_SIM_EMPTY_IMPLEMENTATION = 'SIM-EMPTY-001';

// Comments domain
/** Canonical rule identifier for cmt-header-missing checks. */
export const RULE_CMT_HEADER_MISSING = 'CMT-HDR-001';

// TypeScript modern idioms
/** Canonical rule identifier for tsm-var checks. */
export const RULE_TSM_VAR = 'TSM-VAR-001';
/** Canonical rule identifier for tsm-ctor checks. */
export const RULE_TSM_CTOR = 'TSM-CTOR-001';

// Stdlib & robustness (matching RULE_REGISTRY canonical IDs)
/** Canonical rule identifier for stdlib-panic checks. */
export const RULE_STDLIB_PANIC = 'STDLIB-PANIC-001';
/** Canonical rule identifier for stdlib-alloc checks. */
export const RULE_STDLIB_ALLOC = 'STDLIB-ALLOC-001';
/** Canonical rule identifier for stdlib-unsafe checks. */
export const RULE_STDLIB_UNSAFE = 'STDLIB-UNSAFE-001';
/** Canonical rule identifier for stdlib-const checks. */
export const RULE_STDLIB_CONST = 'STDLIB-CONST-001';
/** Canonical rule identifier for stdlib-recursion checks. */
export const RULE_STDLIB_RECURSION = 'STDLIB-RECURSION-001';
/** Canonical rule identifier for stdlib-port checks. */
export const RULE_STDLIB_PORT = 'STDLIB-PORT-001';

// Naming domain
/** Canonical rule identifier for nam-dec-001 checks. */
export const RULE_NAM_DEC_001 = 'NAM-DEC-001';

// Test modernity domain
/** Canonical rule identifier for tst-top-001 checks. */
export const RULE_TST_TOP_001 = 'TST-TOP-001';
/** Agent-actionable diagnostic code for tst:topology:discipline. */
export const CODE_TST_TOPOLOGY_DISCIPLINE = 'AR:TST:001';

// ============================================================================
// Standardized Agent-Actionable Diagnostic Codes (AR:DOMAIN:ID)
// ============================================================================

/** Agent-actionable diagnostic code for const:hardcoded:string. */
export const CODE_CONST_HARDCODED_STRING = 'AR:CONST:001';
/** Agent-actionable diagnostic code for const:magic:number. */
export const CODE_CONST_MAGIC_NUMBER = 'AR:CONST:002';
/** Agent-actionable diagnostic code for const:duplicate:literal. */
export const CODE_CONST_DUPLICATE_LITERAL = 'AR:CONST:003';
/** Agent-actionable diagnostic code for const:nested:constant. */
export const CODE_CONST_NESTED_CONSTANT = 'AR:CONST:004';
/** Agent-actionable diagnostic code for const:lib:topology. */
export const CODE_CONST_LIB_TOPOLOGY = 'AR:CONST:005';

/** Agent-actionable diagnostic code for cpx:high:complexity. */
export const CODE_CPX_HIGH_COMPLEXITY = 'AR:CPX:001';
/** Agent-actionable diagnostic code for cpx:deep:nesting. */
export const CODE_CPX_DEEP_NESTING = 'AR:CPX:002';

/** Agent-actionable diagnostic code for file:too:large. */
export const CODE_FILE_TOO_LARGE = 'AR:FILE:001';
/** Agent-actionable diagnostic code for sim:long:function. */
export const CODE_SIM_LONG_FUNCTION = 'AR:SIM:001';
/** Agent-actionable diagnostic code for sim:empty:function. */
export const CODE_SIM_EMPTY_FUNCTION = 'AR:SIM:002';

/** Agent-actionable diagnostic code for cmt:missing:header. */
export const CODE_CMT_MISSING_HEADER = 'AR:CMT:001';
/** Agent-actionable diagnostic code for cmt:concurrency:contract. */
export const CODE_CMT_CONCURRENCY_CONTRACT = 'AR:CMT:002';

/** Agent-actionable diagnostic code for tsm:avoid:var. */
export const CODE_TSM_AVOID_VAR = 'AR:TSM:001';
/** Agent-actionable diagnostic code for tsm:avoid:wrapper:ctor. */
export const CODE_TSM_AVOID_WRAPPER_CTOR = 'AR:TSM:002';
/** Agent-actionable diagnostic code for tsm:prefer:esm:import. */
export const CODE_TSM_PREFER_ESM_IMPORT = 'AR:TSM:003';
/** Agent-actionable diagnostic code for tsm:rest:params. */
export const CODE_TSM_REST_PARAMS = 'AR:TSM:004';
/** Agent-actionable diagnostic code for tsm:object:spread. */
export const CODE_TSM_OBJECT_SPREAD = 'AR:TSM:005';

/** Agent-actionable diagnostic code for stb:panic:escape. */
export const CODE_STB_PANIC_ESCAPE = 'AR:STB:001';
/** Agent-actionable diagnostic code for stb:unchecked:error. */
export const CODE_STB_UNCHECKED_ERROR = 'AR:STB:002';
/** Agent-actionable diagnostic code for stb:dynamic:alloc. */
export const CODE_STB_DYNAMIC_ALLOC = 'AR:STB:003';
/** Agent-actionable diagnostic code for stb:missing:safety. */
export const CODE_STB_MISSING_SAFETY = 'AR:STB:004';
/** Agent-actionable diagnostic code for stb:timing:attack. */
export const CODE_STB_TIMING_ATTACK = 'AR:STB:005';
/** Agent-actionable diagnostic code for stb:unbounded:recursion. */
export const CODE_STB_UNBOUNDED_RECURSION = 'AR:STB:006';
/** Agent-actionable diagnostic code for stb:conditional:compilation. */
export const CODE_STB_CONDITIONAL_COMPILATION = 'AR:STB:007';

/** Agent-actionable diagnostic code for nam:decoupling. */
export const CODE_NAM_DECOUPLING = 'AR:NAM:001';

/** Agent-actionable diagnostic code for tst:skipped. */
export const CODE_TST_SKIPPED = 'AR:TST:002';
/** Agent-actionable diagnostic code for tst:tautological. */
export const CODE_TST_TAUTOLOGICAL = 'AR:TST:003';
/** Agent-actionable diagnostic code for tst:fragile:float. */
export const CODE_TST_FRAGILE_FLOAT = 'AR:TST:004';

/** Agent-actionable diagnostic code for num:precision:lossy. */
export const CODE_NUM_PRECISION_LOSSY = 'AR:NUM:001';

/** Agent-actionable diagnostic code for gov:sanitization:prose. */
export const CODE_GOV_PROSE_SANITIZATION = 'AR:GOV:001';
/** Agent-actionable diagnostic code for gov:logic:guard. */
export const CODE_GOV_LOGIC_GUARD = 'AR:GOV:002';
/** Agent-actionable diagnostic code for gov:facade:decoupling. */
export const CODE_GOV_FACADE_DECOUPLING = 'AR:GOV:003';
