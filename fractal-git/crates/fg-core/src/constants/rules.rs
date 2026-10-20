//! Module: fg-core — Fractal Git Domain Gate Rules SSOT
//! File Path: crates/fg-core/src/constants/rules.rs
//! Architecture Role: Single source of truth for all 17 registered Fractal Git domain
//!   rules in `scripts/common/rule-catalog.json`. Enforces zero rule ID drift (`RCFG-RULE-DRIFT`).

/// FGT-ALG-001: Myers diff, 3-way merge, and FastCDC chunking algorithm boundary guard.
pub const RULE_FGT_ALG_001: &str = "FGT-ALG-001";

/// FGT-BRG-001: Pre-review zone gate bridge verification guard.
pub const RULE_FGT_BRG_001: &str = "FGT-BRG-001";

/// FGT-CAS-001: LayerVFS CAS snapshot materializer bridge guard.
pub const RULE_FGT_CAS_001: &str = "FGT-CAS-001";

/// FGT-COR-001: Core data model and error contract guard.
pub const RULE_FGT_COR_001: &str = "FGT-COR-001";

/// FGT-DEP-001: Micro-crate DAG single-direction dependency guard.
pub const RULE_FGT_DEP_001: &str = "FGT-DEP-001";

/// FGT-ERR-001: Zero unwrap and expect panic guard.
pub const RULE_FGT_ERR_001: &str = "FGT-ERR-001";

/// FGT-FAC-001: Facade substantial burden and immutable freeze guard.
pub const RULE_FGT_FAC_001: &str = "FGT-FAC-001";

/// FGT-GAT-001: Fractal Git domain gate guard (commit message, conflict marker, quota).
pub const RULE_FGT_GAT_001: &str = "FGT-GAT-001";

/// FGT-IDX-001: Lockless in-memory git index concurrency guard.
pub const RULE_FGT_IDX_001: &str = "FGT-IDX-001";

/// FGT-LCK-001: Lock-free in-memory index concurrency guard.
pub const RULE_FGT_LCK_001: &str = "FGT-LCK-001";

/// FGT-OBJ-001: Git object model serialization guard.
pub const RULE_FGT_OBJ_001: &str = "FGT-OBJ-001";

/// FGT-POL-001: Resource recycling pool bounded governor.
pub const RULE_FGT_POL_001: &str = "FGT-POL-001";

/// FGT-PRF-001: Zero transient heap allocation guard in hot loops.
pub const RULE_FGT_PRF_001: &str = "FGT-PRF-001";

/// FGT-SAF-001: Documented unsafe block safety proof guard.
pub const RULE_FGT_SAF_001: &str = "FGT-SAF-001";

/// FGT-STO-001: Storage layer crash safety and WAL journal consistency guard.
pub const RULE_FGT_STO_001: &str = "FGT-STO-001";

/// FGT-TOP-001: DAG topology traversal guard.
pub const RULE_FGT_TOP_001: &str = "FGT-TOP-001";

/// FGT-TRN-001: Smart HTTP transport and packet-line streaming framing protocol compliance guard.
pub const RULE_FGT_TRN_001: &str = "FGT-TRN-001";

/// Complete array of all registered FGT domain rule identifiers.
pub const ALL_FGT_RULES: &[&str] = &[
    RULE_FGT_ALG_001,
    RULE_FGT_BRG_001,
    RULE_FGT_CAS_001,
    RULE_FGT_COR_001,
    RULE_FGT_DEP_001,
    RULE_FGT_ERR_001,
    RULE_FGT_FAC_001,
    RULE_FGT_GAT_001,
    RULE_FGT_IDX_001,
    RULE_FGT_LCK_001,
    RULE_FGT_OBJ_001,
    RULE_FGT_POL_001,
    RULE_FGT_PRF_001,
    RULE_FGT_SAF_001,
    RULE_FGT_STO_001,
    RULE_FGT_TOP_001,
    RULE_FGT_TRN_001,
];
