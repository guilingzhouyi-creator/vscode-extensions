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
 * Analyzer id owning the naming rule family.
 */
export const ANALYZER_NAMING = 'naming';

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
 * Analyzer id owning the simplify rule family.
 */
export const ANALYZER_SIMPLIFY = 'simplify';

/**
 * Analyzer id owning the python modernization pack.
 */
export const ANALYZER_PYTHON_MODERN = 'python-modern';

/**
 * Analyzer id owning the typescript modernization pack.
 */
export const ANALYZER_TYPESCRIPT_MODERN = 'ts-modern';

/**
 * Analyzer id owning the rust modernization pack.
 */
export const ANALYZER_RUST_MODERN = 'rust-modern';

/**
 * Analyzer id owning the gdscript modernization pack.
 */
export const ANALYZER_GDSCRIPT_MODERN = 'gdscript-modern';

/**
 * Analyzer id owning documentation markdown and link checks.
 */
export const ANALYZER_DOCS = 'docs';

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
 * Quality dimension id for performance efficiency.
 */
export const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';

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

/**
 * Rule-id or message fragment matched by credential key evaluators.
 */
export const FRAGMENT_KEY = 'key';

/** Analyzer id for data architecture modernization. */
export const ANALYZER_DATA_ARCHITECTURE = 'data-architecture';
/** Analyzer id for test code modernization and effectiveness. */
export const ANALYZER_TEST_MODERNITY = 'test-modernity';
/** Analyzer id for dependency layout and resource hygiene. */
export const ANALYZER_DEPENDENCY_LAYOUT = 'dependency-layout';

/** Rule id for cross-file polynomial time complexity amplification. */
export const RULE_CPX_TIME_001 = 'CPX-TIME-001';
/** Rule id for transient allocation in performance-critical loops. */
export const RULE_CPX_SPACE_001 = 'CPX-SPACE-001';
/** Rule id for blocking I/O and algorithmic amplification in loops. */
export const RULE_CPX_AMP_001 = 'CPX-AMP-001';
/** Rule id for unbounded or cyclic recursion without base case guarantee. */
export const RULE_CPX_REC_001 = 'CPX-REC-001';

/** Rule id for unbounded data fetch without pagination or cursor limit. */
export const RULE_DAT_QRY_001 = 'DAT-QRY-001';
/** Rule id for N+1 query execution within loop bodies. */
export const RULE_DAT_NPL_001 = 'DAT-NPL-001';
/** Rule id for redundant serialization roundtrips in hot paths. */
export const RULE_DAT_SER_001 = 'DAT-SER-001';
/** Rule id for presentation or domain layer leaking raw database drivers. */
export const RULE_DAT_LAY_001 = 'DAT-LAY-001';
/** Rule id for excessive defensive parameter checks past trusted perimeter. */
export const RULE_DAT_DEF_001 = 'DAT-DEF-001';

/** Rule id for tautological or self-affirming test assertions. */
export const RULE_TST_TAU_001 = 'TST-TAU-001';
/** Rule id for mock-only tests without state or business assertions. */
export const RULE_TST_ILS_001 = 'TST-ILS-001';
/** Rule id for silently skipped, pending or commented-out test cases. */
export const RULE_TST_SKP_001 = 'TST-SKP-001';
/** Rule id for insufficient test density relative to executable method count. */
export const RULE_TST_DEN_001 = 'TST-DEN-001';
/** Rule id for legacy test technical debt. */
export const RULE_TST_DBT_001 = 'TST-DBT-001';

/** Rule id for non-standard in-function dynamic imports. */
export const RULE_DEP_LAZ_001 = 'DEP-LAZ-001';
/** Rule id for hardcoded unmanaged remote resource URLs. */
export const RULE_DEP_RES_001 = 'DEP-RES-001';
/** Rule id for disordered external/internal import blocks. */
export const RULE_DEP_ORD_001 = 'DEP-ORD-001';
/** Rule id for wildcard or unbounded star imports. */
export const RULE_DEP_WLD_001 = 'DEP-WLD-001';
/** Rule id for dependency layer direction inversion. */
export const RULE_DEP_INV_001 = 'DEP-INV-001';

/** Rule id for domain logic coupling with UI/presentation frameworks. */
export const RULE_ARCH_HDL_001 = 'ARCH-HDL-001';
/** Rule id for domain logic leaking direct access to infrastructure config. */
export const RULE_ARCH_CFG_001 = 'ARCH-CFG-001';

/** Points deducted for polynomial time complexity amplification. */
export const DEDUCTION_POLYNOMIAL_TIME = 15;
/** Points deducted for transient loop allocations. */
export const DEDUCTION_TRANSIENT_LOOP_ALLOC = 15;
/** Points deducted for loop complexity amplification. */
export const DEDUCTION_COMPLEXITY_AMPLIFICATION = 12;
/** Points deducted for unbounded or cyclic recursion. */
export const DEDUCTION_UNBOUNDED_RECURSION = 25;

/** Points deducted for unbounded data queries on request paths. */
export const DEDUCTION_UNBOUNDED_DATA_QUERY = 20;
/** Points deducted for N+1 loop queries. */
export const DEDUCTION_N_PLUS_ONE_QUERY = 15;
/** Points deducted for database driver leaks across architectural boundaries. */
export const DEDUCTION_DATA_LAYER_LEAK = 15;
/** Points deducted for redundant serialization. */
export const DEDUCTION_REDUNDANT_SERIALIZATION = 8;
/** Points deducted for excessive defensive validation. */
export const DEDUCTION_EXCESSIVE_DEFENSE = 10;

/** Points deducted for tautological test assertions. */
export const DEDUCTION_TAUTOLOGICAL_ASSERTION = 10;
/** Points deducted for mock-only illusory tests. */
export const DEDUCTION_MOCK_ONLY_TEST = 15;
/** Points deducted for skipped or abandoned tests. */
export const DEDUCTION_SKIPPED_TEST = 8;
/** Points deducted for effective method test density deficit. */
export const DEDUCTION_TEST_DENSITY_DEFICIT = 12;

/** Points deducted for in-function dynamic imports. */
export const DEDUCTION_IN_FUNCTION_IMPORT = 15;
/** Points deducted for unmanaged remote resource URLs. */
export const DEDUCTION_UNMANAGED_REMOTE_RESOURCE = 15;
/** Points deducted for import layout ordering violation. */
export const DEDUCTION_IMPORT_ORDER_VIOLATION = 5;

/** Points deducted for headless architecture decoupling violation. */
export const DEDUCTION_HEADLESS_DECOUPLING_VIOLATION = 20;
/** Points deducted for direct configuration access violation. */
export const DEDUCTION_CONFIG_LEAK_VIOLATION = 20;

/** Rule id legacy form for nested constant anti-patterns. */
export const RULE_NESTED_CONSTANT = 'nested-constant';
/** Points deducted for nested constant anti-patterns and redundant aliases. */
export const DEDUCTION_NESTED_CONSTANT = 5;

/** Rule id for unused or dead configuration declarations. */
export const RULE_ARCH_CFG_002 = 'ARCH-CFG-002';
/** Rule id for duplicate configuration declarations across modules. */
export const RULE_ARCH_CFG_003 = 'ARCH-CFG-003';
/** Rule id for implicit configuration and hardcoded environment reads. */
export const RULE_ARCH_CFG_004 = 'ARCH-CFG-004';
/** Rule id for scattered configuration access across domain boundaries. */
export const RULE_ARCH_CFG_005 = 'ARCH-CFG-005';
/** Rule id for tight coupling between domain entities and concrete configs. */
export const RULE_ARCH_CFG_006 = 'ARCH-CFG-006';
/** Rule id for over-abstracted configuration indirection layers. */
export const RULE_ARCH_CFG_007 = 'ARCH-CFG-007';

/** Rule id for elastic complexity budget violations. */
export const RULE_CPX_BUD_001 = 'CPX-BUD-001';
/** Rule id for unjustified complexity lacking algorithmic proof. */
export const RULE_CPX_JST_001 = 'CPX-JST-001';
/** Rule id for file boundary imbalance aggregating disjoint complex functions. */
export const RULE_ARCH_BLR_001 = 'ARCH-BLR-001';
/** Rule id for shared execution skeleton candidates with divergent strategies. */
export const RULE_ARCH_SKL_001 = 'ARCH-SKL-001';
/** Rule id for mechanical function splitting and trivial forwarding wrappers. */
export const RULE_CPX_HOP_001 = 'CPX-HOP-001';

/** Points deducted for unused or dead configuration declarations. */
export const DEDUCTION_DEAD_CONFIG = 10;
/** Points deducted for duplicate configuration declarations. */
export const DEDUCTION_DUPLICATE_CONFIG = 10;
/** Points deducted for implicit configuration scattered in domain code. */
export const DEDUCTION_IMPLICIT_CONFIG = 15;
/** Points deducted for scattered configuration access. */
export const DEDUCTION_SCATTERED_CONFIG = 12;
/** Points deducted for domain coupling with physical configuration formats. */
export const DEDUCTION_CONFIG_COUPLING = 15;
/** Points deducted for exceeding context-aware elastic complexity budget. */
export const DEDUCTION_ELASTIC_BUDGET = 15;
/** Points deducted for unjustified design-collapse complexity. */
export const DEDUCTION_UNJUSTIFIED_COMPLEXITY = 15;
/** Points deducted for file boundary imbalance with disjoint complex functions. */
export const DEDUCTION_BOUNDARY_IMBALANCE = 15;
/** Points deducted for mechanical decomposition and trivial forwarding wrappers. */
export const DEDUCTION_MECHANICAL_SPLITTING = 15;

/** Rule id for project-scale distributed redundant complexity. */
export const RULE_CPX_RED_001 = 'CPX-RED-001';
/** Rule id for misclassified pseudo-shared library and boundary drift. */
export const RULE_ARCH_ROL_001 = 'ARCH-ROL-001';
/** Rule id for business modules bearing unbounded common utilities. */
export const RULE_ARCH_ROL_002 = 'ARCH-ROL-002';
/** Rule id for monolithic god object utility and junk drawer file anti-patterns. */
export const RULE_ARCH_UTL_001 = 'ARCH-UTL-001';
/** Rule id for over-abstraction, spurious indirection, and cyclic sharing. */
export const RULE_ARCH_ABS_001 = 'ARCH-ABS-001';
/** Rule id for unpooled high-frequency expensive allocations in hot paths. */
export const RULE_PRF_POL_001 = 'PRF-POL-001';
/** Rule id for unsound pooling missing reset contracts or capacity caps. */
export const RULE_PRF_POL_002 = 'PRF-POL-002';
/** Rule id for negative-ROI excessive pooling of tiny objects or cold paths. */
export const RULE_PRF_POL_003 = 'PRF-POL-003';

/** Points deducted for project-scale distributed redundant complexity. */
export const DEDUCTION_DISTRIBUTED_REDUNDANCY = 15;
/** Points deducted for misclassified pseudo-shared library or role drift. */
export const DEDUCTION_ROLE_DEVIATION = 15;
/** Points deducted for monolithic god object utility anti-pattern. */
export const DEDUCTION_GOD_UTILS = 20;
/** Points deducted for over-abstraction and spurious indirection. */
export const DEDUCTION_OVER_ABSTRACTION = 15;
/** Points deducted for unpooled high-frequency allocations in hot paths. */
export const DEDUCTION_UNPOOLED_RESOURCE = 15;
/** Points deducted for unsound resource pooling lacking reset or caps. */
export const DEDUCTION_UNSOUND_POOLING = 15;
/** Points deducted for negative-ROI excessive pooling of tiny objects. */
export const DEDUCTION_NEGATIVE_ROI_POOLING = 10;
