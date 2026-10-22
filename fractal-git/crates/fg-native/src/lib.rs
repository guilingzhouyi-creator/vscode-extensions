//! Module: fg-native — TAXC Native Repository Container Facade
//! File Path: crates/fg-native/src/lib.rs
//! Architecture Role: Root of the native binary layer. Owns the TAXC container format, the
//!   CRC32C primitive, and the closed section-tag registry that the section codecs build on.
//! Dependencies & Triggers: Depends only on fg-core (Oid) and thiserror; consumed by fg-storage
//!   section codecs, fg-repo (`init`, `doctor`), and the Taxis CLI.
//! Responsibilities: Provide container parse/build with atomic publication, integrity primitives,
//!   and the format constants that no other module may re-derive.
//! Exit Semantics & Design Rationale:
//!   - The layer holds no git-format knowledge: git compatibility lives in the projection layer,
//!     so this crate can be tested and evolved without any git semantics in scope.
//!   - Every fallible entry point returns a strongly-typed NativeError; no production path panics.

pub mod codec;
pub mod constants;
pub mod container;
pub mod checksum;
pub mod document;
pub mod error;
pub mod junction;
pub mod repo_identity;
pub mod repo_layout;
pub mod section_tag;
pub mod sections;

#[cfg(test)]
pub mod test_support;

pub use codec::{FieldReader, FieldWriter};
pub use constants::{
    CONTAINER_FILE_NAME, DEFAULT_BRANCH_REF, FLAG_READ_ONLY, GUARD_FILE_CONTENT, GUARD_FILE_NAME,
    HEADER_LEN, JOURNAL_DIR_NAME, MAX_FIELD_LEN, MAX_RECORD_COUNT, MAX_SECTION_COUNT,
    OBJECTS_DIR_NAME, SECTION_ALIGNMENT, SECTION_ENTRY_LEN, SECTION_FLAG_ZLIB, TAXC_FORMAT_VERSION,
    TAXC_MAGIC, TAXC_MAGIC_WORD, TRAILER_LEN,
};
pub use container::{ContainerBuilder, ContainerHeader, ContainerView, SectionEntry};
pub use checksum::{crc32c, Crc32cHasher};
pub use document::RepoDocument;
pub use error::{NativeError, NativeResult};
pub use junction::create_junction;
pub use repo_identity::{
    generate_repo_id, repo_id_from_hex, repo_id_to_hex, store_path, store_root, REPO_ID_HEX_LEN,
    STORES_DIR_NAME, STORE_DIR_NAME,
};
pub use repo_layout::{
    classify_workspace_entry, container_path, hide_directory, is_directory_hidden, read_guard_file,
    write_guard_file, InitializedRepository, PhysicalLayout, RepoLayout, WORKSPACE_DIR_NAME,
};
pub use section_tag::SectionTag;
pub use sections::{
    FileMode, HeadState, IndexEntry, IndexStage, IndxSection, LayoutMode, MetaSection,
    ObjectFormat, OpLogEntry, OpLogParts, OpLogSection, PromSection, PromotionRecord,
    PromotionStatus, RefRecord, RefsSection, StatCache, WktrSection, WorktreeMode, WorktreeRecord,
    WorktreeTier, CHALLENGE_NONCE_LEN, REPO_ID_LEN,
};
