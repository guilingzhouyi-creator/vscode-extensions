//! Module: fg-storage — In-Place Storage Engine Subsystem
//! File Path: crates/fg-storage/src/in_place/mod.rs
//! Architecture Role: Core primitives for In-Place ODB Engine, providing
//!   safe tail truncation, forward hole punching, reverse ZIP/TAR decompression,
//!   in-place bundle consumption, and crash-resilient write-ahead logging.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001, FGT-SAF-001, FGT-STO-001.

pub mod bundle_consumer;
pub mod hole_puncher;
pub mod journal;
pub mod restorer;
pub mod tail_truncator;
pub mod tar_extractor;
pub mod zip_extractor;

pub use bundle_consumer::{BundleConsumeOptions, BundleConsumeReport, InPlaceBundleConsumer};
pub use hole_puncher::HolePuncher;
pub use journal::{
    InPlaceJournal, InPlaceLogEntry, InPlaceResumeState, HISTORICAL_TIPSE_WAL_MAGIC,
    INPLACE_ODB_WAL_MAGIC,
};
pub use restorer::ArchiveRestorer;
pub use tail_truncator::TailTruncator;
pub use tar_extractor::{
    extract_tar_in_place, extract_tar_in_place_with_journal, extract_tar_standard,
    extract_targz_forward_hole_punch, index_tar_archive, plan_tar_in_place, TarMember,
};
pub use zip_extractor::{
    extract_member_payload, extract_zip_in_place, extract_zip_in_place_with_journal,
    extract_zip_standard, plan_zip_in_place, read_zip_central_directory, read_zip_eocd,
    sanitize_relative_path, InPlaceExtractionReport, ZipEocd, ZipMember, CDH_SIGNATURE,
    EOCD_SIGNATURE, LFH_SIGNATURE,
};
