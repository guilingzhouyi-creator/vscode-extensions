/**
 * Module: Core Scoring — Dimension Deduction Literals
 * File Path: src/core/scoring/dimensionLiterals.ts
 * Architecture Role: Leaf constant table shared by the dimension deduction modules.
 * Dependencies & Triggers: none (no imports); consumed by dimensionDeductions and
 *   dimensionFamilyDeductions.
 * Responsibilities: Name every dimension id, analyzer id, rule id, match fragment, point value,
 *   and threshold used by the deduction evaluators.
 * Exit Semantics & Design Rationale: Pure constants with no runtime logic, kept in one leaf
 *   module so both deduction modules share a single definition site and no import cycle.
 */

/**
 * Points deducted when the circular dependency signal is present.
 */
export const DEDUCTION_CIRCULAR_DEPENDENCY = 25;

/**
 * Points deducted when the critical code execution signal is present.
 */
export const DEDUCTION_CRITICAL_CODE_EXECUTION = 40;

/**
 * Points deducted when the critical command injection signal is present.
 */
export const DEDUCTION_CRITICAL_COMMAND_INJECTION = 40;

/**
 * Points deducted when the prototype pollution signal is present.
 */
export const DEDUCTION_PROTOTYPE_POLLUTION = 35;

/**
 * Points deducted when the insecure randomness signal is present.
 */
export const DEDUCTION_INSECURE_RANDOMNESS = 25;

/**
 * Points deducted when the generic security signal is present.
 */
export const DEDUCTION_GENERIC_SECURITY = 25;

/**
 * Points deducted when the hardcoded credential signal is present.
 */
export const DEDUCTION_HARDCODED_CREDENTIAL = 50;

/**
 * Points deducted when the missing public api doc signal is present.
 */
export const DEDUCTION_MISSING_PUBLIC_API_DOC = 8;

/**
 * Points deducted when the duplicate literal signal is present.
 */
export const DEDUCTION_DUPLICATE_LITERAL = 8;

/**
 * Points deducted when the magic number signal is present.
 */
export const DEDUCTION_MAGIC_NUMBER = 4;

/**
 * Points deducted when the hardcoded string signal is present.
 */
export const DEDUCTION_HARDCODED_STRING = 3;

/**
 * Quality dimension id for architecture consistency.
 */
export const DIMENSION_ARCHITECTURE_CONSISTENCY = 'architectureConsistency';

/**
 * Quality dimension id for code security.
 */
export const DIMENSION_CODE_SECURITY = 'codeSecurity';

/**
 * Points deducted when the dto credential leak signal is present.
 */
export const DEDUCTION_DTO_CREDENTIAL_LEAK = 30;

/**
 * Points deducted when the path traversal signal is present.
 */
export const DEDUCTION_PATH_TRAVERSAL = 30;

/**
 * Points deducted when the potential injection signal is present.
 */
export const DEDUCTION_POTENTIAL_INJECTION = 30;

/**
 * Points deducted when the layer constraint violation signal is present.
 */
export const DEDUCTION_LAYER_CONSTRAINT_VIOLATION = 20;

/**
 * Points deducted when the broken hash signal is present.
 */
export const DEDUCTION_BROKEN_HASH = 20;

/**
 * Points deducted when the sensitive data logged signal is present.
 */
export const DEDUCTION_SENSITIVE_DATA_LOGGED = 20;

/**
 * Points deducted when the memory leak risk signal is present.
 */
export const DEDUCTION_MEMORY_LEAK_RISK = 20;

/**
 * Points deducted when the architecture design violation signal is present.
 */
export const DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION = 15;

/**
 * Points deducted when the transient loop allocation signal is present.
 */
export const DEDUCTION_TRANSIENT_LOOP_ALLOCATION = 15;

/**
 * Points deducted when the line count overflow signal is present.
 */
export const DEDUCTION_LINE_COUNT_OVERFLOW = 15;

/**
 * Points deducted when the cyclomatic complexity signal is present.
 */
export const DEDUCTION_CYCLOMATIC_COMPLEXITY = 15;

/**
 * Points deducted when the banned jargon signal is present.
 */
export const DEDUCTION_BANNED_JARGON = 15;

/**
 * Points deducted when the error tech debt signal is present.
 */
export const DEDUCTION_ERROR_TECH_DEBT = 15;

/**
 * Points deducted when the type safety escape signal is present.
 */
export const DEDUCTION_TYPE_SAFETY_ESCAPE = 10;

/**
 * Points deducted when the unreachable dead code signal is present.
 */
export const DEDUCTION_UNREACHABLE_DEAD_CODE = 10;

/**
 * Points deducted when the inefficient algorithm signal is present.
 */
export const DEDUCTION_INEFFICIENT_ALGORITHM = 10;

/**
 * Points deducted when the deprecated feature signal is present.
 */
export const DEDUCTION_DEPRECATED_FEATURE = 10;

/**
 * Points deducted when the nesting depth overflow signal is present.
 */
export const DEDUCTION_NESTING_DEPTH_OVERFLOW = 10;

/**
 * Points deducted when the excessive exported symbols signal is present.
 */
export const DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS = 10;

/**
 * Points deducted when the unused binding signal is present.
 */
export const DEDUCTION_UNUSED_BINDING = 5;

/**
 * Points deducted when the naming violation signal is present.
 */
export const DEDUCTION_NAMING_VIOLATION = 5;

/**
 * Points deducted when the substandard comment signal is present.
 */
export const DEDUCTION_SUBSTANDARD_COMMENT = 5;

/**
 * Points deducted when the warning tech debt signal is present.
 */
export const DEDUCTION_WARNING_TECH_DEBT = 5;

/**
 * Shared threshold used by the deduction evaluators.
 */
export const MAX_NESTING_DEPTH = 5;

/**
 * Shared threshold used by the deduction evaluators.
 */
export const MAX_EXPORTED_SYMBOLS = 30;

/**
 * Analyzer id owning the architecture rule family.
 */
export const ANALYZER_ARCHITECTURE = 'architecture';

/**
 * Analyzer id owning the dependency graph rule family.
 */
export const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';

/**
 * Analyzer id owning the governance rule family.
 */
export const ANALYZER_GOVERNANCE = 'governance';

/**
 * Analyzer id owning the hygiene rule family.
 */
export const ANALYZER_HYGIENE = 'hygiene';

/**
 * Analyzer id owning the security rule family.
 */
export const ANALYZER_SECURITY = 'security';

/**
 * Analyzer id owning the secrets rule family.
 */
export const ANALYZER_SECRETS = 'secrets';

/**
 * Analyzer id owning the performance rule family.
 */
export const ANALYZER_PERFORMANCE = 'performance';

/**
 * Analyzer id owning the large file rule family.
 */
export const ANALYZER_LARGE_FILE = 'large-file';

/**
 * Analyzer id owning the complexity rule family.
 */
export const ANALYZER_COMPLEXITY = 'complexity';

/**
 * Analyzer id owning the comments rule family.
 */
export const ANALYZER_COMMENTS = 'comments';

/**
 * Analyzer id owning the constants rule family.
 */
export const ANALYZER_CONSTANTS = 'constants';

/**
 * Quality dimension id for semantic purity.
 */
export const DIMENSION_SEMANTIC_PURITY = 'semanticPurity';

/**
 * Quality dimension id for standardization.
 */
export const DIMENSION_STANDARDIZATION = 'standardization';

/**
 * Quality dimension id for modernity.
 */
export const DIMENSION_MODERNITY = 'modernity';

/**
 * Quality dimension id for maintainability.
 */
export const DIMENSION_MAINTAINABILITY = 'maintainability';

/**
 * Quality dimension id for comment quality.
 */
export const DIMENSION_COMMENT_QUALITY = 'commentQuality';

/**
 * Quality dimension id for duplication.
 */
export const DIMENSION_DUPLICATION = 'duplication';

/**
 * Quality dimension id for tech debt risk.
 */
export const DIMENSION_TECH_DEBT_RISK = 'techDebtRisk';

/**
 * Rule id of the arch leak 002 finding.
 */
export const RULE_ARCH_LEAK_002 = 'ARCH-LEAK-002';

/**
 * Rule id of the sec vul 001 finding.
 */
export const RULE_SEC_VUL_001 = 'SEC-VUL-001';

/**
 * Rule id of the sec vul 002 finding.
 */
export const RULE_SEC_VUL_002 = 'SEC-VUL-002';

/**
 * Rule id of the sec vul 003 finding.
 */
export const RULE_SEC_VUL_003 = 'SEC-VUL-003';

/**
 * Rule id of the sec vul 004 finding.
 */
export const RULE_SEC_VUL_004 = 'SEC-VUL-004';

/**
 * Rule id of the sec vul 005 finding.
 */
export const RULE_SEC_VUL_005 = 'SEC-VUL-005';

/**
 * Rule id of the sec vul 006 finding.
 */
export const RULE_SEC_VUL_006 = 'SEC-VUL-006';

/**
 * Rule id of the sec leak 001 finding.
 */
export const RULE_SEC_LEAK_001 = 'SEC-LEAK-001';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_PLACEHOLDER_MARKER = 'wip';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LAYER = 'layer';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_BOUNDARY = 'boundary';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LEAK = 'LEAK';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_CYCLE = 'cycle';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_CIRCULAR = 'circular';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_TYPE = 'type';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_ESCAPE = 'escape';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_DEAD = 'dead';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_UNREACHABLE = 'unreachable';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_UNUSED = 'unused';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_SECRET = 'secret';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_TOKEN = 'token';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_EVAL = 'eval';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_UNSAFE = 'unsafe';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_SANITIZATION = 'sanitization';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LOOP = 'loop';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_ALLOC = 'alloc';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_UNBOUNDED = 'unbounded';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LEAK_ALT = 'leak';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_NAMING = 'naming';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LINES = 'lines';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_LEGACY = 'legacy';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_DEPRECATED = 'deprecated';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_NESTING = 'nesting';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_BANNED = 'banned';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_JARGON = 'jargon';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_MISSING = 'missing';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_DUPLICATE = 'duplicate';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_MAGIC = 'magic';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_ERROR = 'error';

/**
 * Rule-id or message fragment matched by the deduction evaluators.
 */
export const FRAGMENT_WARNING = 'warning';
