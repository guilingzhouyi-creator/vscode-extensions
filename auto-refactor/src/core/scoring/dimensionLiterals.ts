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

/** Points deducted when the circular dependency signal is present. */
export const DEDUCTION_CIRCULAR_DEPENDENCY = 25;
/** Points deducted when the critical code execution signal is present. */
export const DEDUCTION_CRITICAL_CODE_EXECUTION = 40;
/** Points deducted when the critical command injection signal is present. */
export const DEDUCTION_CRITICAL_COMMAND_INJECTION = 40;
/** Points deducted when the prototype pollution signal is present. */
export const DEDUCTION_PROTOTYPE_POLLUTION = 35;
/** Points deducted when the insecure randomness signal is present. */
export const DEDUCTION_INSECURE_RANDOMNESS = 25;
/** Points deducted when the generic security signal is present. */
export const DEDUCTION_GENERIC_SECURITY = 25;
/** Points deducted when the hardcoded credential signal is present. */
export const DEDUCTION_HARDCODED_CREDENTIAL = 50;
/** Points deducted when the missing public api doc signal is present. */
export const DEDUCTION_MISSING_PUBLIC_API_DOC = 8;
/** Points deducted when the duplicate literal signal is present. */
export const DEDUCTION_DUPLICATE_LITERAL = 8;
/** Points deducted when the magic number signal is present. */
export const DEDUCTION_MAGIC_NUMBER = 4;
/** Points deducted when the hardcoded string signal is present. */
export const DEDUCTION_HARDCODED_STRING = 3;
/** Quality dimension id for architecture consistency. */
export const DIMENSION_ARCHITECTURE_CONSISTENCY = 'architectureConsistency';
/** Quality dimension id for code security. */
export const DIMENSION_CODE_SECURITY = 'codeSecurity';

/**  */
export const DEDUCTION_DTO_CREDENTIAL_LEAK = 30;

/**  */
export const DEDUCTION_PATH_TRAVERSAL = 30;

/**  */
export const DEDUCTION_POTENTIAL_INJECTION = 30;

/**  */
export const DEDUCTION_LAYER_CONSTRAINT_VIOLATION = 20;

/**  */
export const DEDUCTION_BROKEN_HASH = 20;

/**  */
export const DEDUCTION_SENSITIVE_DATA_LOGGED = 20;

/**  */
export const DEDUCTION_MEMORY_LEAK_RISK = 20;

/**  */
export const DEDUCTION_ARCHITECTURE_DESIGN_VIOLATION = 15;

/**  */
export const DEDUCTION_TRANSIENT_LOOP_ALLOCATION = 15;

/**  */
export const DEDUCTION_LINE_COUNT_OVERFLOW = 15;

/**  */
export const DEDUCTION_CYCLOMATIC_COMPLEXITY = 15;

/**  */
export const DEDUCTION_BANNED_JARGON = 15;

/**  */
export const DEDUCTION_ERROR_TECH_DEBT = 15;

/**  */
export const DEDUCTION_TYPE_SAFETY_ESCAPE = 10;

/**  */
export const DEDUCTION_UNREACHABLE_DEAD_CODE = 10;

/**  */
export const DEDUCTION_INEFFICIENT_ALGORITHM = 10;

/**  */
export const DEDUCTION_DEPRECATED_FEATURE = 10;

/**  */
export const DEDUCTION_NESTING_DEPTH_OVERFLOW = 10;

/**  */
export const DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS = 10;

/**  */
export const DEDUCTION_UNUSED_BINDING = 5;

/**  */
export const DEDUCTION_NAMING_VIOLATION = 5;

/**  */
export const DEDUCTION_SUBSTANDARD_COMMENT = 5;

/**  */
export const DEDUCTION_WARNING_TECH_DEBT = 5;

/**  */
export const MAX_NESTING_DEPTH = 5;

/**  */
export const MAX_EXPORTED_SYMBOLS = 30;

/**  */
export const ANALYZER_ARCHITECTURE = 'architecture';

/**  */
export const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';

/**  */
export const ANALYZER_GOVERNANCE = 'governance';

/**  */
export const ANALYZER_HYGIENE = 'hygiene';

/**  */
export const ANALYZER_NAMING = 'naming';

/**  */
export const ANALYZER_SECURITY = 'security';

/**  */
export const ANALYZER_SECRETS = 'secrets';

/**  */
export const ANALYZER_PERFORMANCE = 'performance';

/**  */
export const ANALYZER_LARGE_FILE = 'large-file';

/**  */
export const ANALYZER_COMPLEXITY = 'complexity';

/**  */
export const ANALYZER_COMMENTS = 'comments';

/**  */
export const ANALYZER_CONSTANTS = 'constants';

/**  */
export const ANALYZER_SIMPLIFY = 'simplify';

/**  */
export const ANALYZER_PYTHON_MODERN = 'python-modern';

/**  */
export const ANALYZER_TYPESCRIPT_MODERN = 'ts-modern';

/**  */
export const ANALYZER_RUST_MODERN = 'rust-modern';

/**  */
export const ANALYZER_GDSCRIPT_MODERN = 'gdscript-modern';

/**  */
export const ANALYZER_GO_MODERN = 'go-modern';

/**  */
export const ANALYZER_DOCS = 'docs';

/**  */
export const ANALYZER_GDSCRIPT_GAME = 'gdscript-game';

/**  */
export const ANALYZER_VSCODE_EXTENSION = 'vscode-extension';

/**  */
export const DIMENSION_SEMANTIC_PURITY = 'semanticPurity';

/**  */
export const DIMENSION_STANDARDIZATION = 'standardization';

/**  */
export const DIMENSION_MODERNITY = 'modernity';

/**  */
export const DIMENSION_MAINTAINABILITY = 'maintainability';

/**  */
export const DIMENSION_COMMENT_QUALITY = 'commentQuality';

/**  */
export const DIMENSION_DUPLICATION = 'duplication';

/**  */
export const DIMENSION_TECH_DEBT_RISK = 'techDebtRisk';

/**  */
export const DIMENSION_PERFORMANCE_EFFICIENCY = 'performanceEfficiency';

/**  */
export const RULE_ARCH_LEAK_002 = 'ARCH-LEAK-002';

/**  */
export const RULE_SEC_VUL_001 = 'SEC-VUL-001';

/**  */
export const RULE_SEC_VUL_002 = 'SEC-VUL-002';

/**  */
export const RULE_SEC_VUL_003 = 'SEC-VUL-003';

/**  */
export const RULE_SEC_VUL_004 = 'SEC-VUL-004';

/**  */
export const RULE_SEC_VUL_005 = 'SEC-VUL-005';

/**  */
export const RULE_SEC_VUL_006 = 'SEC-VUL-006';

/**  */
export const RULE_SEC_LEAK_001 = 'SEC-LEAK-001';

/**  */
export const FRAGMENT_PLACEHOLDER_MARKER = 'wip';

/**  */
export const FRAGMENT_LAYER = 'layer';

/**  */
export const FRAGMENT_BOUNDARY = 'boundary';

/**  */
export const FRAGMENT_LEAK = 'LEAK';

/**  */
export const FRAGMENT_CYCLE = 'cycle';

/**  */
export const FRAGMENT_CIRCULAR = 'circular';

/**  */
export const FRAGMENT_TYPE = 'type';

/**  */
export const FRAGMENT_ESCAPE = 'escape';

/**  */
export const FRAGMENT_DEAD = 'dead';

/**  */
export const FRAGMENT_UNREACHABLE = 'unreachable';

/**  */
export const FRAGMENT_UNUSED = 'unused';

/**  */
export const FRAGMENT_SECRET = 'secret';

/**  */
export const FRAGMENT_TOKEN = 'token';

/**  */
export const FRAGMENT_EVAL = 'eval';

/**  */
export const FRAGMENT_UNSAFE = 'unsafe';

/**  */
export const FRAGMENT_SANITIZATION = 'sanitization';

/**  */
export const FRAGMENT_LOOP = 'loop';

/**  */
export const FRAGMENT_ALLOC = 'alloc';

/**  */
export const FRAGMENT_UNBOUNDED = 'unbounded';

/**  */
export const FRAGMENT_LEAK_ALT = 'leak';

/**  */
export const FRAGMENT_NAMING = 'naming';

/**  */
export const FRAGMENT_LINES = 'lines';

/**  */
export const FRAGMENT_LEGACY = 'legacy';

/**  */
export const FRAGMENT_DEPRECATED = 'deprecated';

/**  */
export const FRAGMENT_NESTING = 'nesting';

/**  */
export const FRAGMENT_BANNED = 'banned';

/**  */
export const FRAGMENT_JARGON = 'jargon';

/**  */
export const FRAGMENT_MISSING = 'missing';

/**  */
export const FRAGMENT_DUPLICATE = 'duplicate';

/**  */
export const FRAGMENT_MAGIC = 'magic';

/**  */
export const FRAGMENT_ERROR = 'error';

/**  */
export const FRAGMENT_WARNING = 'warning';

/**  */
export const FRAGMENT_KEY = 'key';

/** Analyzer id for data architecture modernization. */
export const ANALYZER_DATA_ARCHITECTURE = 'data-architecture';
/** Analyzer id for test code modernization and effectiveness. */
export const ANALYZER_TEST_MODERNITY = 'test-modernity';
/** Analyzer id for dependency layout and resource hygiene. */
export const ANALYZER_DEPENDENCY_LAYOUT = 'dependency-layout';
/** Analyzer id for shell/PowerShell lint rules. */
export const ANALYZER_SHELL_LINT = 'shell-lint';
/** Analyzer id for standard library and systems runtime verification. */
export const ANALYZER_STDLIB = 'stdlib';
/** Analyzer id for repository gate architecture governance. */
export const ANALYZER_GATE_ARCHITECTURE = 'gate-architecture';

/** Rule id for bare panic/unwrap escaping public API. */
export const RULE_STDLIB_PANIC_001 = 'STDLIB-PANIC-001';
/** Rule id for implicit heap allocation in no_std/systems runtime. */
export const RULE_STDLIB_ALLOC_001 = 'STDLIB-ALLOC-001';
/** Rule id for unsafe blocks lacking explicit SAFETY contracts. */
export const RULE_STDLIB_UNSAFE_001 = 'STDLIB-UNSAFE-001';
/** Rule id for variable-time comparisons in cryptographic routines. */
export const RULE_STDLIB_CONST_001 = 'STDLIB-CONST-001';
/** Rule id for unbounded recursion lacking explicit stack depth limits. */
export const RULE_STDLIB_RECURSION_001 = 'STDLIB-RECURSION-001';
/** Rule id for platform conditional compilation missing fallback/error guard. */
export const RULE_STDLIB_PORT_001 = 'STDLIB-PORT-001';

/** Points deducted for bare panic/unwrap in public API. */
export const DEDUCTION_STDLIB_PANIC = 15;
/** Points deducted for implicit heap allocation in no_std environments. */
export const DEDUCTION_STDLIB_ALLOC = 20;
/** Points deducted for unsafe blocks lacking SAFETY contract. */
export const DEDUCTION_STDLIB_UNSAFE = 20;
/** Points deducted for variable-time comparison in crypto routines. */
export const DEDUCTION_STDLIB_CONST = 20;
/** Points deducted for unbounded recursion without stack guard. */
export const DEDUCTION_STDLIB_RECURSION = 15;
/** Points deducted for platform cfg missing fallback compile error. */
export const DEDUCTION_STDLIB_PORT = 15;

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
/** Rule id for multi-language test topology discipline and embedded zone contracts. */
export const RULE_TST_TOP_001 = 'TST-TOP-001';

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
/** Rule id for excessive identifier length suggesting architectural decomposition. */
export const RULE_NAM_DEC_001 = 'NAM-DEC-001';

/** Points deducted for excessive identifier length requiring architectural decoupling. */
export const DEDUCTION_NAMING_DECOUPLING = 15;

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
/** Points deducted for test topology discipline breaches. */
export const DEDUCTION_TEST_TOPOLOGY_DISCIPLINE = 15;

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

// ── Redundancy family ────────────────────────────────────────────────────────
// These rules were registered but had no explicit deduction row, so each one fell through
// to whichever `anyFinding` catch-all happened to sit in its analyzer's block and was charged
// to a semantically wrong axis. Each now names its own axis and weight.

/** Points deducted when a file contains an unreferenced declaration of its own. */
export const DEDUCTION_UNUSED_DECLARATION = 8;
/** Points deducted for an exported symbol nothing consumes, per occurrence. */
export const DEDUCTION_UNUSED_EXPORT = 5;
/** Points deducted for a module no file imports, and which exports symbols. */
export const DEDUCTION_UNUSED_MODULE = 5;
/** Points deducted for vacuous passthrough or redundant zero-argument wrapper functions. */
export const DEDUCTION_VACUOUS_WRAPPER = 8;
/** Points deducted for duplicated code blocks inside one file. */
export const DEDUCTION_DUPLICATE_CODE_BLOCK = 8;
/** Points deducted for near-identical code blocks repeated across files. */
export const DEDUCTION_CROSS_FILE_CLONE = 6;
/** Points deducted for over-abstraction and unnecessary indirection layers. */
export const DEDUCTION_UNNECESSARY_ABSTRACTION = 10;
/** Points deducted for a function or method with no call site anywhere in the repository. */
export const DEDUCTION_UNREFERENCED_FUNCTION = 5;
/** Points deducted for a local variable declared and never read again. */
export const DEDUCTION_UNUSED_LOCAL = 5;
/** Points deducted for a mechanically redundant comment. */
export const DEDUCTION_MEANINGLESS_COMMENT = 5;
/** Points deducted for repeated prose inside one document. */
export const DEDUCTION_DOCUMENT_DUPLICATION = 5;
/** Points deducted for same-domain literals left unconsolidated within a call scope. */
export const DEDUCTION_UNCONSOLIDATED_LITERALS = 6;
/** Points deducted for the same semantic constant drifting or splitting across files. */
export const DEDUCTION_CONSTANT_NAME_SPLIT = 6;
/** Points deducted for scattered same-kind literals inside one function body. */
export const DEDUCTION_SCATTERED_LOCALS = 4;
/** Points deducted for an unnecessary resource-management indirection (dispose/close). */
export const DEDUCTION_VACUOUS_RESOURCE_GUARD = 8;
/** Points deducted for a declaration bound to a redundant alias. */
export const DEDUCTION_REDUNDANT_ALIAS = 5;
/** Points deducted for redundant boolean logic (SIM-DED lineage). */
export const DEDUCTION_REDUNDANT_BOOLEAN = 5;

// ── Host language packs (VS Code extension / Godot) specialized ──────────────────

/** Points deducted when a Disposable or listener is never registered for cleanup. */
export const DEDUCTION_UNDISPOSED_RESOURCE = 15;
/** Points deducted for blocking synchronous I/O on the extension host main thread. */
export const DEDUCTION_MAIN_THREAD_BLOCKING_IO = 15;
/** Points deducted for hard-coded user-facing text bypassing localisation. */
export const DEDUCTION_UNLOCALIZED_TEXT = 8;
/** Points deducted for an object-pool contract breach such as a skipped reset_state. */
export const DEDUCTION_POOL_CONTRACT_BREACH = 12;
/** Points deducted for a host-lifecycle or performance-budget contract violation. */
export const DEDUCTION_HOST_LIFECYCLE_BREACH = 10;

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

/** Rule id for unbounded deep control-flow nesting exceeding contextual budget. */
export const RULE_CPX_NEST_001 = 'CPX-NEST-001';
/** Rule id for deep control-flow jump over long cognitive distance. */
export const RULE_CPX_NEST_002 = 'CPX-NEST-002';
/** Rule id for state machine structural dispatch discipline. */
export const RULE_CPX_STM_001 = 'CPX-STM-001';

/** Points deducted for unbounded deep control-flow nesting. */
export const DEDUCTION_UNBOUNDED_NESTING = 12;
/** Points deducted for deep long-span control flow escape. */
export const DEDUCTION_DEEP_CONTROL_ESCAPE = 12;
/** Points deducted for state machine structural dispatch discipline violations. */
export const DEDUCTION_STATE_MACHINE_DISCIPLINE = 8;

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

/** Rule id for interactive action missing debounce or loading lock. */
export const RULE_GDM_DEB_001 = 'GDM-DEB-001';
/** Rule id for finite state machine direct state mutation bypassing transitions. */
export const RULE_GDM_FSM_001 = 'GDM-FSM-001';
/** Rule id for dynamic observer holding strong Node reference without weakref. */
export const RULE_GDM_WEAK_001 = 'GDM-WEAK-001';
/** Rule id for hardcoded absolute pixel bounds violating responsive scaling. */
export const RULE_GDM_RES_001 = 'GDM-RES-001';
/** Rule id for presentation layer in-place mutation on immutable Snapshot DTOs. */
export const RULE_GDM_UNI_001 = 'GDM-UNI-001';

/** Points deducted for missing interactive debounce or loading lock. */
export const DEDUCTION_DEBOUNCE_MISSING = 8;
/** Points deducted for finite state machine direct wild mutation. */
export const DEDUCTION_FSM_WILD_MUTATION = 12;
/** Points deducted for missing weakref in dynamic observer registration. */
export const DEDUCTION_WEAKREF_MISSING = 10;
/** Points deducted for hardcoded absolute pixel bounds. */
export const DEDUCTION_HARDCODED_PIXELS = 8;
/** Points deducted for in-place mutation on Snapshot DTOs. */
export const DEDUCTION_DTO_IN_PLACE_MUTATION = 12;

/** Rule id for physical 0-byte or vacuous empty files. */
export const RULE_HYG_EMP_001 = 'HYG-EMP-001';
/** Points deducted for empty or vacuous file placeholders. */
export const DEDUCTION_EMPTY_FILE_PLACEHOLDER = 15;

/** Rule id for config directory sprawl / flat tables anti-pattern. */
export const RULE_ARCH_CFG_008 = 'ARCH-CFG-008';
/** Rule id for unrouted config subtables bypassing domain routers. */
export const RULE_ARCH_CFG_009 = 'ARCH-CFG-009';
/** Rule id for resource registry bidirectional integrity & orphan asset guard. */
export const RULE_DAT_RES_001 = 'DAT-RES-001';
/** Rule id for polynomial algorithmic complexity linear search in loop. */
export const RULE_PRF_ALG_002 = 'PRF-ALG-002';
/** Rule id for unpooled streaming buffer allocating in hot ingestion loop. */
export const RULE_PRF_POL_004 = 'PRF-POL-004';
/** Rule id for cross-tier monolithic staging blast radius guard. */
export const RULE_GOV_BLS_001 = 'GOV-BLS-001';
/** Rule id for rule catalog anti-drift and anti-hallucination guard. */
export const RULE_GOV_RUL_001 = 'GOV-RUL-001';
/** Rule id for historical dossier nomenclature boundary isolation guard. */
export const RULE_GOV_ARC_001 = 'GOV-ARC-001';

/** Points deducted for flat config directory sprawl. */
export const DEDUCTION_FLAT_CONFIG_SPRAWL = 10;
/** Points deducted for unrouted config subtables. */
export const DEDUCTION_UNROUTED_CONFIG_SUBTABLE = 12;
/** Points deducted for dangling or unmapped resource assets. */
export const DEDUCTION_DANGLING_RESOURCE_ASSET = 10;
/** Points deducted for polynomial algorithmic complexity in loops. */
export const DEDUCTION_POLYNOMIAL_ALG_COMPLEXITY = 15;
/** Points deducted for streaming unpooled buffer allocation. */
export const DEDUCTION_STREAMING_UNPOOLED_BUFFER = 12;
/** Points deducted for cross-tier monolithic blast radius. */
export const DEDUCTION_CROSS_TIER_BLAST_RADIUS = 15;
/** Points deducted for rule identifier drift or hallucination. */
export const DEDUCTION_RULE_CATALOG_DRIFT = 20;
/** Points deducted for historical dossier nomenclature boundary breach. */
export const DEDUCTION_DOSSIER_BOUNDARY_BREACH = 10;

/** Points deducted for gate architecture structural violations. */
export const DEDUCTION_GATE_ARCHITECTURE = 20;
/** Points deducted for gate execution reliability or AST complexity budget breached. */
export const DEDUCTION_GATE_RELIABILITY = 15;
/** Points deducted for gate standardization, SSOT catalog or commit style contract breach. */
export const DEDUCTION_GATE_STANDARDIZATION = 12;

/** Points deducted for shell script error discipline or trap exit guard breached. */
export const DEDUCTION_SHELL_ERROR_DISCIPLINE = 12;
/** Points deducted for shell script standardization or non-interactive guard breach. */
export const DEDUCTION_SHELL_STANDARDIZATION = 10;

/** Points deducted for code simplification maintainability defects. */
export const DEDUCTION_SIMPLIFY_MAINTAINABILITY = 10;
/** Points deducted for dead or redundant comments identified by simplify analyzer. */
export const DEDUCTION_SIMPLIFY_COMMENT = 8;
/** Points deducted for standardization smells identified by simplify analyzer. */
export const DEDUCTION_SIMPLIFY_STANDARDIZATION = 10;

/** Points deducted for outdated Go idioms or patterns. */
export const DEDUCTION_GO_MODERNITY = 12;
