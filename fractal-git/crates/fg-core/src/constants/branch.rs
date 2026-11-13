//! Module: fg-core — Branch Standardization & Policy Vault Constants
//! File Path: crates/fg-core/src/constants/branch.rs
//! Architecture Role: Compiled single-binary source of truth for canonical five-tier branch grammar,
//!   facade types, recognized domain cells, forbidden temporary prefixes, and encrypted policy
//!   vault binary format constants.
//! Dependencies & Triggers: Zero internal crate dependencies; consumed by `fg-native`, `fg-topology`,
//!   `fg-gate`, `taxis` CLI, and cross-checked by workspace conformance gates.
//! Responsibilities: Hold immutable defaults and zero-allocation ASCII kebab-case validation helpers.
//! Exit Semantics & Design Rationale: Keeps every canonical lexical bound in compiled binary memory
//!   so distributed `taxis` binaries operate with zero runtime JSON manifest dependency.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-TOP-001`: Fractal topology reference guard
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-PRF-001`: Hot-path zero allocation guard

/// Canonical terminal leaf segment separating Tier 3 card branches from Tier 4 subagent directories.
pub const CARD_CANONICAL_LEAF: &str = "main";

/// Maximum byte length allowed for any single branch coordinate segment (`<cell-id>`, `<card-id>`, `<agent-id>`).
pub const MAX_BRANCH_SEGMENT_LEN: usize = 63;

/// Maximum serialized plaintext payload byte ceiling for `.taxis-policy.txp`.
pub const POLICY_MAX_PAYLOAD_LEN: usize = 64 * 1024;

/// Four-byte magic identifying the custom binary encrypted policy container (`TXPF`).
pub const POLICY_VAULT_MAGIC: [u8; 4] = *b"TXPF";

/// Current on-disk binary format version for the encrypted policy vault.
pub const POLICY_VAULT_VERSION: u16 = 1;

/// Four-byte magic identifying the companion initialization seal record (`TXSL`).
pub const POLICY_SEAL_MAGIC: [u8; 4] = *b"TXSL";

/// Hidden binary policy file stored inside `.taxis/` (or `.git/` common dir).
pub const POLICY_VAULT_FILENAME: &str = ".taxis-policy.txp";

/// Hidden initialization seal file allowing fail-closed detection if the policy vault is deleted.
pub const POLICY_SEAL_FILENAME: &str = ".taxis-policy.seal";

/// Hidden repository identity anchor for bare Git repositories lacking a `.taxis/repo.txc` container.
pub const POLICY_REPO_ID_FILENAME: &str = ".taxis-repo.id";

/// Environment variable overriding/tightening the branch governance tier (`strict`, `advisory`, `native`).
pub const BRANCH_GOVERNANCE_ENV: &str = "TAXIS_BRANCH_GOVERNANCE";

/// Environment variable selecting an explicit branch bypass reason guard audit check.
pub const BRANCH_BYPASS_MIN_REASON_CHARS: usize = 10;

/// Recognized workspace domain cell identifiers for Tier 2/3/4 branch partitioning.
pub const RECOGNIZED_CELLS: [&str; 7] = [
    "auto-refactor",
    "fractal-git",
    "workspace-timing",
    "webgames",
    "infra",
    "governance",
    "core",
];

/// Canonical cell alias mappings normalized before topological checks.
pub const CELL_ALIASES: [(&str, &str); 3] = [
    ("web-games", "webgames"),
    ("fractalgit", "fractal-git"),
    ("timing", "workspace-timing"),
];

/// Conventional facade prefixes permitted for human-facing Tier 3 branches (`<type>/<cell-id>/<desc>`).
pub const FACADE_TYPES: [&str; 10] = [
    "feat", "fix", "refactor", "perf", "docs", "test", "chore", "style", "ci", "build",
];

/// Ad-hoc branch prefixes prohibited under Strict branch governance.
pub const FORBIDDEN_BRANCH_PREFIXES: [&str; 3] = ["temp", "tmp", "wip"];

/// Protected system trunk branch names (Tier 0).
pub const PROTECTED_SYSTEM_TRUNKS: [&str; 2] = ["main", "master"];

/// Checks whether a single segment strictly matches lowercase ASCII `kebab-case` (`[a-z0-9]+(-[a-z0-9]+)*`)
/// within [`MAX_BRANCH_SEGMENT_LEN`] without performing any heap allocation.
#[must_use]
pub fn is_valid_kebab_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    if bytes.is_empty() || bytes.len() > MAX_BRANCH_SEGMENT_LEN {
        return false;
    }
    let mut prev_hyphen = true;
    for &byte in bytes {
        let is_alnum = byte.is_ascii_lowercase() || byte.is_ascii_digit();
        if is_alnum {
            prev_hyphen = false;
        } else if byte == b'-' && !prev_hyphen {
            prev_hyphen = true;
        } else {
            return false;
        }
    }
    !prev_hyphen
}

/// Checks whether `segment` starts with or equals a forbidden ad-hoc scratch prefix.
#[must_use]
pub fn is_forbidden_branch_prefix(segment: &str) -> bool {
    for prefix in FORBIDDEN_BRANCH_PREFIXES {
        if segment == prefix {
            return true;
        }
        if let Some(after) = segment.strip_prefix(prefix) {
            if after.starts_with('-') || after.starts_with('/') {
                return true;
            }
        }
    }
    false
}

/// Normalizes a known cell alias to its canonical identifier, returning `input` unchanged otherwise.
#[must_use]
pub fn canonicalize_cell_alias(cell_id: &str) -> &str {
    for (alias, canonical) in CELL_ALIASES {
        if cell_id == alias {
            return canonical;
        }
    }
    cell_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_kebab_segments_pass_and_invalid_reject() {
        assert!(is_valid_kebab_segment("fractal-git"));
        assert!(is_valid_kebab_segment("phase-3"));
        assert!(is_valid_kebab_segment("p3-fg-split"));
        assert!(is_valid_kebab_segment("a"));

        assert!(!is_valid_kebab_segment(""));
        assert!(!is_valid_kebab_segment("-lead"));
        assert!(!is_valid_kebab_segment("trail-"));
        assert!(!is_valid_kebab_segment("double--dash"));
        assert!(!is_valid_kebab_segment("UpperCase"));
        assert!(!is_valid_kebab_segment("snake_case"));
        assert!(!is_valid_kebab_segment(
            &"a".repeat(MAX_BRANCH_SEGMENT_LEN + 1)
        ));
    }

    #[test]
    fn forbidden_prefix_detection_is_exact() {
        assert!(is_forbidden_branch_prefix("wip"));
        assert!(is_forbidden_branch_prefix("wip-fix"));
        assert!(is_forbidden_branch_prefix("temp/experiment"));
        assert!(is_forbidden_branch_prefix("tmp-check"));
        assert!(!is_forbidden_branch_prefix("template-engine"));
        assert!(!is_forbidden_branch_prefix("wiping-cache"));
    }

    #[test]
    fn cell_alias_normalizes_compatibly() {
        assert_eq!(canonicalize_cell_alias("web-games"), "webgames");
        assert_eq!(canonicalize_cell_alias("fractalgit"), "fractal-git");
        assert_eq!(canonicalize_cell_alias("timing"), "workspace-timing");
        assert_eq!(canonicalize_cell_alias("auto-refactor"), "auto-refactor");
    }
}
