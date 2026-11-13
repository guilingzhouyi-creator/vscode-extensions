//! Module: fg-native — TAXC Native Repository Container Facade
//! File Path: crates/fg-native/src/lib.rs
//! Architecture Role: Root of the native binary layer. Owns the TAXC container format, the
//!   CRC32C primitive, and the closed section-tag registry that the section codecs build on.
//! Dependencies & Triggers: Depends only on fg-core (Oid) and thiserror; consumed by fg-storage
//!   section codecs, fg-repo (`init`, `doctor`), and the Taxis CLI.
//! Responsibilities: Provide container parse/build with atomic publication, integrity primitives,
//!   format constants, and physical envelope boundary validation (`ARCH-FAC-001`).
//! Exit Semantics & Design Rationale:
//!   - The layer holds no git-format knowledge: git compatibility lives in the projection layer,
//!     so this crate can be tested and evolved without any git semantics in scope.
//!   - Every fallible entry point returns a strongly-typed NativeError; no production path panics.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-STO-001.

pub mod checksum;
pub mod codec;
pub mod constants;
pub mod container;
pub mod document;
pub mod error;
pub mod junction;
pub mod policy_vault;
pub mod repo_identity;
pub mod repo_layout;
pub mod section_tag;
pub mod sections;

#[cfg(test)]
pub mod test_support;

pub use checksum::{crc32c, Crc32cHasher};
pub use codec::{FieldReader, FieldWriter};
pub use constants::{
    CONTAINER_FILE_NAME, DEFAULT_BRANCH_REF, FLAG_READ_ONLY, GUARD_FILE_CONTENT, GUARD_FILE_NAME,
    HEADER_LEN, JOURNAL_DIR_NAME, MAX_FIELD_LEN, MAX_RECORD_COUNT, MAX_SECTION_COUNT,
    OBJECTS_DIR_NAME, SECTION_ALIGNMENT, SECTION_ENTRY_LEN, SECTION_FLAG_ZLIB, TAXC_FORMAT_VERSION,
    TAXC_MAGIC, TAXC_MAGIC_WORD, TRAILER_LEN,
};
pub use container::{ContainerBuilder, ContainerHeader, ContainerView, SectionEntry};
pub use document::RepoDocument;
pub use error::{NativeError, NativeResult};
pub use junction::create_junction;
pub use policy_vault::{LoadedPolicyVault, PolicyVaultState, PolicyVaultStore};
pub use repo_identity::{
    fill_random_bytes, generate_repo_id, repo_id_from_hex, repo_id_to_hex, store_path, store_root,
    REPO_ID_HEX_LEN, STORES_DIR_NAME, STORE_DIR_NAME,
};
pub use repo_layout::{
    attempt_hide, classify_workspace_entry, container_path, hide_directory, hide_path,
    is_directory_hidden, read_guard_file, write_guard_file, InitializedRepository, PhysicalLayout,
    RepoLayout, WORKSPACE_DIR_NAME,
};
pub use section_tag::SectionTag;
pub use sections::{
    FileMode, HeadState, IndexEntry, IndexStage, IndxSection, LayoutMode, MetaSection,
    ObjectFormat, OpLogEntry, OpLogParts, OpLogSection, PromSection, PromotionRecord,
    PromotionStatus, RefRecord, RefsSection, StatCache, WktrSection, WorktreeMode, WorktreeRecord,
    WorktreeTier, CHALLENGE_NONCE_LEN, REPO_ID_LEN,
};

/// Canonical facade contract version for the `fg-native` container layer.
pub const NATIVE_FACADE_VERSION: u16 = 1;

/// Immutable capability and geometry contract for TAXC native containers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeContainerContract {
    /// Facade contract version.
    pub facade_version: u16,
    /// On-disk TAXC format version supported by this build.
    pub format_version: u16,
    /// Mandatory header byte width.
    pub header_len: usize,
    /// Mandatory trailer byte width.
    pub trailer_len: usize,
    /// Required section payload byte alignment.
    pub section_alignment: u64,
    /// Hard structural limit on declared section entries.
    pub max_section_count: u32,
    /// Whether NTFS directory junctions are natively supported on this target OS.
    pub junction_supported: bool,
}

/// Returns the compile-time immutable container contract for `fg-native`.
pub const fn native_container_contract() -> NativeContainerContract {
    NativeContainerContract {
        facade_version: NATIVE_FACADE_VERSION,
        format_version: TAXC_FORMAT_VERSION,
        header_len: HEADER_LEN,
        trailer_len: TRAILER_LEN,
        section_alignment: SECTION_ALIGNMENT,
        max_section_count: MAX_SECTION_COUNT,
        junction_supported: junction::is_supported(),
    }
}

/// Validates that a raw TAXC container image meets the minimum header + trailer byte floor.
///
/// # Errors
///
/// Returns [`NativeError::FileTooShort`] if `total_bytes` cannot contain the mandatory envelope.
pub const fn validate_container_file_size(total_bytes: usize) -> NativeResult<usize> {
    let minimum = HEADER_LEN + TRAILER_LEN;
    if total_bytes < minimum {
        return Err(NativeError::FileTooShort {
            actual: total_bytes,
            minimum,
        });
    }
    Ok(total_bytes)
}

/// Validates container format version, section count ceiling, and alignment without heap allocation.
///
/// # Errors
///
/// Returns [`NativeError::UnsupportedFormatVersion`], [`NativeError::SectionCountExceeded`], or
/// [`NativeError::SectionMisaligned`] when header invariants are violated.
pub const fn validate_container_header_bounds(
    version: u16,
    section_count: u32,
    body_len: u64,
) -> NativeResult<()> {
    if version != TAXC_FORMAT_VERSION {
        return Err(NativeError::UnsupportedFormatVersion {
            found: version,
            supported: TAXC_FORMAT_VERSION,
        });
    }
    if section_count > MAX_SECTION_COUNT {
        return Err(NativeError::SectionCountExceeded {
            declared: section_count,
            ceiling: MAX_SECTION_COUNT,
        });
    }
    if !body_len.is_multiple_of(SECTION_ALIGNMENT) {
        return Err(NativeError::SectionMisaligned {
            tag: "BODY",
            offset: body_len,
            alignment: SECTION_ALIGNMENT,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_contract_and_header_bounds_work() {
        let contract = native_container_contract();
        assert_eq!(contract.facade_version, NATIVE_FACADE_VERSION);
        assert_eq!(contract.format_version, TAXC_FORMAT_VERSION);
        assert_eq!(contract.header_len, HEADER_LEN);
        assert_eq!(contract.trailer_len, TRAILER_LEN);
        assert_eq!(contract.junction_supported, cfg!(windows));

        assert_eq!(
            validate_container_file_size(HEADER_LEN + TRAILER_LEN).ok(),
            Some(HEADER_LEN + TRAILER_LEN)
        );
        assert!(matches!(
            validate_container_file_size(HEADER_LEN + TRAILER_LEN - 1),
            Err(NativeError::FileTooShort { .. })
        ));

        assert!(validate_container_header_bounds(TAXC_FORMAT_VERSION, 4, 64).is_ok());
        assert!(matches!(
            validate_container_header_bounds(TAXC_FORMAT_VERSION + 1, 4, 64),
            Err(NativeError::UnsupportedFormatVersion { .. })
        ));
        assert!(matches!(
            validate_container_header_bounds(TAXC_FORMAT_VERSION, MAX_SECTION_COUNT + 1, 64),
            Err(NativeError::SectionCountExceeded { .. })
        ));
        assert!(matches!(
            validate_container_header_bounds(TAXC_FORMAT_VERSION, 1, 13),
            Err(NativeError::SectionMisaligned { .. })
        ));
    }
}
