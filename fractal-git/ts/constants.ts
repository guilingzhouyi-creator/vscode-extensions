/**
 * Module: Fractal Git — TypeScript Mirror Constants & Domain Enums
 * File Path: ts/constants.ts
 * Architecture Role: Standardized constant single-source-of-truth mirroring the Rust native
 *   kernel (fg-core::constants), unifying Git protocols, reference prefixes, rule catalog IDs,
 *   benchmark metrics, and terminal status badges.
 * Dependencies & Triggers: Consumed by TypeScript contracts, native bindings, and Praxis client.
 * Responsibilities:
 *   - Export immutable Git object types and octal file modes.
 *   - Export canonical Fractal Ref prefixes and branch names.
 *   - Export 17 registered FGT-* rule identifiers.
 *   - Export hermetic benchmark metric names and CLI badges.
 * Exit Semantics & Design Rationale: Provides deeply frozen dictionary objects ensuring runtime
 *   tamper-proofing across JavaScript event loops and IPC bridges.
 */

/**
 * Git Object Types.
 */
export const GIT_OBJ_TYPE = Object.freeze({
    BLOB: 'blob',
    TREE: 'tree',
    COMMIT: 'commit',
    TAG: 'tag',
} as const);

/**
 * Git Octal File Modes.
 */
export const GIT_FILE_MODE = Object.freeze({
    REGULAR: '100644',
    EXECUTABLE: '100755',
    SYMLINK: '120000',
    GITLINK: '160000',
    DIR: '040000',
} as const);

/**
 * Fractal Git Reference Prefixes & Canonical Branch Names.
 */
export const FRACTAL_REF = Object.freeze({
    PREFIX: 'refs/fractal/',
    CELLS_PREFIX: 'refs/fractal/cells/',
    TRUNK: 'refs/fractal/trunk',
    SYSTEM_TRUNK: 'refs/heads/main',
    SYSTEM_BRANCH: 'main',
    DEFAULT_AGENT: 'praxis-worker',
} as const);

/**
 * 17 Registered FGT Rules registered in scripts/common/rule-catalog.json.
 */
export const FGT_RULES = Object.freeze({
    FGT_COR_001: 'FGT-COR-001',
    FGT_OBJ_001: 'FGT-OBJ-001',
    FGT_TOP_001: 'FGT-TOP-001',
    FGT_GAT_001: 'FGT-GAT-001',
    FGT_MEM_001: 'FGT-MEM-001',
    FGT_CAS_001: 'FGT-CAS-001',
    FGT_DAG_001: 'FGT-DAG-001',
    FGT_IPC_001: 'FGT-IPC-001',
    FGT_IDX_001: 'FGT-IDX-001',
    FGT_SEC_001: 'FGT-SEC-001',
    FGT_PRF_001: 'FGT-PRF-001',
    FGT_HYG_001: 'FGT-HYG-001',
    FGT_CON_001: 'FGT-CON-001',
    FGT_ISO_001: 'FGT-ISO-001',
    FGT_AUD_001: 'FGT-AUD-001',
    FGT_POL_001: 'FGT-POL-001',
    FGT_DOC_001: 'FGT-DOC-001',
} as const);

/**
 * Micro & Macro Benchmark Metric Names.
 */
export const BENCHMARK_METRICS = Object.freeze({
    DIFF_MYERS_BASELINE: 'diff_myers_baseline',
    DIFF_HIERARCHICAL_SHORT_CIRCUIT: 'diff_hierarchical_short_circuit',
    OBJECT_BLOB_SHA1_HASHING: 'object_blob_sha1_hashing',
    FAST_CDC_CHUNKING: 'fast_cdc_chunking',
    SWAR_SCAN_4096: 'swar_scan_4096',
    DAG_WALK_GENERATION_PRUNING: 'dag_walk_generation_pruning',
    STORAGE_CAS_READ_WRITE: 'storage_cas_read_write',
    IPC_PACKET_ENCODE_DECODE: 'ipc_packet_encode_decode',
    INDEX_CONFLICT_STAGE_CHECK: 'index_conflict_stage_check',
    TREE_SORT_AND_SERIALIZE: 'tree_sort_and_serialize',
    END_TO_END_COMMIT_CYCLE: 'end_to_end_commit_cycle',
} as const);

/**
 * CLI Terminal Status Badges.
 */
export const CLI_TAGS = Object.freeze({
    WORKTREE_OK: '[WORKTREE_OK]',
    COMMIT_OK: '[COMMIT_OK]',
    VERIFY_PASS: '[VERIFY_PASS]',
    VERIFY_FAIL: '[VERIFY_FAIL]',
    HUMAN_UAC_VERIFIED: '[HUMAN_UAC_VERIFIED]',
    UAC_PROMOTION_STAGED: '[UAC_PROMOTION_STAGED]',
    UAC_PROMOTION_REJECTED: '[UAC_PROMOTION_REJECTED]',
    UAC_APPROVAL_FAILED: '[UAC_APPROVAL_FAILED]',
    UAC_REJECT_FAILED: '[UAC_REJECT_FAILED]',
    PROMOTION_REJECTED: '[PROMOTION_REJECTED]',
    AUTHORITY_BREACH: '[AUTHORITY_BREACH]',
    COMMIT_GOVERNANCE_FAIL: '[COMMIT_GOVERNANCE_FAIL]',
    TAXIS_CHECKOUT: '[TAXIS_CHECKOUT]',
    HERMETIC_BASELINE: '[HERMETIC_BASELINE]',
    RECLAIM: '[RECLAIM]',
    OPTIMIZED: '[OPTIMIZED]',
    FAIL: '[FAIL]',
    ERROR: '[ERROR]',
} as const);

/**
 * Validates whether a candidate rule ID belongs to the canonical FGT-* catalog.
 */
export function isRegisteredFgtRule(ruleId: string): boolean {
    if (!ruleId || typeof ruleId !== 'string') {
        return false;
    }
    return Object.values(FGT_RULES).includes(ruleId as any);
}

/**
 * Validates whether a metric name is recognized by the Taxis benchmark suite.
 */
export function isValidBenchmarkMetric(metricName: string): boolean {
    if (!metricName || typeof metricName !== 'string') {
        return false;
    }
    return Object.values(BENCHMARK_METRICS).includes(metricName as any);
}
