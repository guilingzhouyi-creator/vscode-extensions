//! Module: fg-core — Fractal Git Domain Gate Rules SSOT
//! File Path: crates/fg-core/src/constants/rules.rs
//! Architecture Role: Single source of truth for all 37 registered Fractal Git domain
//!   rules in `scripts/common/rule-catalog.json`. Enforces zero rule ID drift (`RCFG-RULE-DRIFT`).

/// FGT-ALG-001: Myers diff, 3-way merge, and FastCDC chunking algorithm boundary guard.
pub const RULE_FGT_ALG_001: &str = "FGT-ALG-001";

/// FGT-AUD-001: Cryptographic telemetry audit hash-chain and <= 350B budget guard.
pub const RULE_FGT_AUD_001: &str = "FGT-AUD-001";

/// FGT-BRG-001: Pre-review zone gate bridge verification guard.
pub const RULE_FGT_BRG_001: &str = "FGT-BRG-001";

/// FGT-BYP-001: Direct-Bypass test cache immediate physical reclamation guard.
pub const RULE_FGT_BYP_001: &str = "FGT-BYP-001";

/// FGT-CAS-001: LayerVFS CAS snapshot materializer bridge guard.
pub const RULE_FGT_CAS_001: &str = "FGT-CAS-001";

/// FGT-COR-001: Core data model and error contract guard.
pub const RULE_FGT_COR_001: &str = "FGT-COR-001";

/// FGT-DEP-001: Subsystem DAG single-direction dependency guard.
pub const RULE_FGT_DEP_001: &str = "FGT-DEP-001";

/// FGT-ERR-001: Zero unwrap and expect panic guard.
pub const RULE_FGT_ERR_001: &str = "FGT-ERR-001";

/// FGT-FAC-001: Facade substantial burden and immutable freeze guard.
pub const RULE_FGT_FAC_001: &str = "FGT-FAC-001";

/// FGT-GAT-001: Fractal Git domain gate guard (commit message, conflict marker, quota).
pub const RULE_FGT_GAT_001: &str = "FGT-GAT-001";

/// FGT-IDX-001: Lockless in-memory git index concurrency guard.
pub const RULE_FGT_IDX_001: &str = "FGT-IDX-001";

/// FGT-IMPACT-001: Impact-slice map narrowing and unrecognised crate fallback guard.
pub const RULE_FGT_IMPACT_001: &str = "FGT-IMPACT-001";

/// FGT-LCK-001: Lock-free in-memory index concurrency guard.
pub const RULE_FGT_LCK_001: &str = "FGT-LCK-001";

/// FGT-MUT-001: In-Kernel Canary Engine (IKCE) blind mutation kill rate guard.
pub const RULE_FGT_MUT_001: &str = "FGT-MUT-001";

/// FGT-MSG-001: Commit header form guard (shape, character bounds, typography).
pub const RULE_FGT_MSG_001: &str = "FGT-MSG-001";
/// FGT-MSG-002: Commit section topology guard (slots, ordering, duplicates, markers).
pub const RULE_FGT_MSG_002: &str = "FGT-MSG-002";
/// FGT-MSG-003: Commit body density guard (substantive character floors).
pub const RULE_FGT_MSG_003: &str = "FGT-MSG-003";
/// FGT-MSG-004: Commit vocabulary guard (word-boundary matching with whitelist).
pub const RULE_FGT_MSG_004: &str = "FGT-MSG-004";
/// FGT-MSG-005: Commit unresolved marker and template placeholder guard.
pub const RULE_FGT_MSG_005: &str = "FGT-MSG-005";
/// FGT-MSG-006: Commit empty section and bullet content guard.
pub const RULE_FGT_MSG_006: &str = "FGT-MSG-006";
/// FGT-MSG-007: Commit project scope and nomenclature guard.
pub const RULE_FGT_MSG_007: &str = "FGT-MSG-007";
/// FGT-MSG-008: Commit construction batch codename guard.
pub const RULE_FGT_MSG_008: &str = "FGT-MSG-008";
/// FGT-MSG-009: Merge structure exemption guard (parent-count evidence).
pub const RULE_FGT_MSG_009: &str = "FGT-MSG-009";
/// FGT-MSG-010: Commit declaration anchor guard (verification cites a changed symbol).
pub const RULE_FGT_MSG_010: &str = "FGT-MSG-010";
/// FGT-MSG-011: Commit policy tier guard (selector may tighten, never relax).
pub const RULE_FGT_MSG_011: &str = "FGT-MSG-011";
/// FGT-MSG-012: Commit rule identifier anti-hallucination guard.
pub const RULE_FGT_MSG_012: &str = "FGT-MSG-012";

/// FGT-OBJ-001: Git object model serialization guard.
pub const RULE_FGT_OBJ_001: &str = "FGT-OBJ-001";

/// FGT-POL-001: Resource recycling pool bounded governor.
pub const RULE_FGT_POL_001: &str = "FGT-POL-001";

/// FGT-PRF-001: Zero transient heap allocation guard in hot loops.
pub const RULE_FGT_PRF_001: &str = "FGT-PRF-001";

/// FGT-PYR-001: Four-tier hierarchical audit rollup Merkle integrity guard.
pub const RULE_FGT_PYR_001: &str = "FGT-PYR-001";

/// FGT-QRN-001: Pre-Review Zone quarantine isolation and Bayesian credit circuit-breaker guard.
pub const RULE_FGT_QRN_001: &str = "FGT-QRN-001";

/// FGT-SAF-001: Documented unsafe block safety proof guard.
pub const RULE_FGT_SAF_001: &str = "FGT-SAF-001";

/// FGT-STO-001: Storage layer crash safety and WAL journal consistency guard.
pub const RULE_FGT_STO_001: &str = "FGT-STO-001";

/// FGT-TAU-001: In-Kernel Canary Engine (IKCE) anti-tautology assertion guard.
pub const RULE_FGT_TAU_001: &str = "FGT-TAU-001";

/// FGT-TOP-001: DAG topology traversal guard.
pub const RULE_FGT_TOP_001: &str = "FGT-TOP-001";

/// FGT-TRN-001: Smart HTTP transport and packet-line streaming framing protocol compliance guard.
pub const RULE_FGT_TRN_001: &str = "FGT-TRN-001";

/// FGT-VRF-001: Taxis Kernel Code Verifier (TKCV) formal AST invariant guard.
pub const RULE_FGT_VRF_001: &str = "FGT-VRF-001";

/// Complete sorted array of all 37 registered FGT domain rule identifiers.
pub const ALL_FGT_RULES: &[&str] = &[
    RULE_FGT_ALG_001,
    RULE_FGT_AUD_001,
    RULE_FGT_BRG_001,
    RULE_FGT_BYP_001,
    RULE_FGT_CAS_001,
    RULE_FGT_COR_001,
    RULE_FGT_DEP_001,
    RULE_FGT_ERR_001,
    RULE_FGT_FAC_001,
    RULE_FGT_GAT_001,
    RULE_FGT_IDX_001,
    RULE_FGT_IMPACT_001,
    RULE_FGT_LCK_001,
    RULE_FGT_MSG_001,
    RULE_FGT_MSG_002,
    RULE_FGT_MSG_003,
    RULE_FGT_MSG_004,
    RULE_FGT_MSG_005,
    RULE_FGT_MSG_006,
    RULE_FGT_MSG_007,
    RULE_FGT_MSG_008,
    RULE_FGT_MSG_009,
    RULE_FGT_MSG_010,
    RULE_FGT_MSG_011,
    RULE_FGT_MSG_012,
    RULE_FGT_MUT_001,
    RULE_FGT_OBJ_001,
    RULE_FGT_POL_001,
    RULE_FGT_PRF_001,
    RULE_FGT_PYR_001,
    RULE_FGT_QRN_001,
    RULE_FGT_SAF_001,
    RULE_FGT_STO_001,
    RULE_FGT_TAU_001,
    RULE_FGT_TOP_001,
    RULE_FGT_TRN_001,
    RULE_FGT_VRF_001,
];
