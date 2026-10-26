//! Module: fg-native — Repository Container Document
//! File Path: crates/fg-native/src/document.rs
//! Architecture Role: The whole-repository document: every TAXC section held together so a command
//!   can load, mutate, and publish the repository state in one atomic write.
//! Dependencies & Triggers: Consumed by `fg-repo` (`init`, `doctor`), every CLI mutating command, and
//!   the section codecs themselves.
//! Responsibilities: Load a container from disk with every section decoded, mutate individual
//!   sections, and publish the result atomically.
//! Exit Semantics & Design Rationale:
//!   - Sections are decoded eagerly on load. A lazy view would let a corrupt section surface as a
//!     failure halfway through a command that has already begun writing.
//!   - Missing sections are materialized as empty rather than reported as errors. A repository that
//!     has never staged a file legitimately has an empty `INDX`, and refusing to open it would make
//!     the first command of a fresh repository fail.
//!   - Publication is a single atomic write of the whole container. Writing sections independently
//!     would expose a state where `HEAD` points at a commit whose `REFS` entry is absent.
//!   - `IDMP` is carried through verbatim even though no codec reads it yet, so an older build
//!     cannot silently drop a newer build's data.

use std::path::Path;

use crate::constants::DEFAULT_BRANCH_REF;
use crate::container::{ContainerBuilder, ContainerView};
use crate::error::NativeResult;
use crate::section_tag::SectionTag;
use crate::sections::head::HeadState;
use crate::sections::indx::IndxSection;
use crate::sections::meta::{LayoutMode, MetaSection};
use crate::sections::oplog::OpLogSection;
use crate::sections::prom::PromSection;
use crate::sections::refs::RefsSection;
use crate::sections::worktree_registry::WktrSection;

/// Returns the current wall-clock time in milliseconds since the Unix epoch.
///
/// A clock that reads before the epoch is clamped to zero: a negative creation timestamp would make
/// every age computation in `taxis doctor` report a repository from the future, which is worse than
/// reporting one created at the epoch.
fn current_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

/// The decoded contents of one repository container.
#[derive(Debug, Clone, PartialEq)]
pub struct RepoDocument {
    /// Repository identity and layout metadata.
    pub meta: MetaSection,
    /// Current head state.
    pub head: HeadState,
    /// Reference table.
    pub refs: RefsSection,
    /// Staging index.
    pub indx: IndxSection,
    /// Operation log DAG.
    pub oplog: OpLogSection,
    /// Promotion ledger.
    pub prom: PromSection,
    /// Worktree registry.
    pub wktr: WktrSection,
    /// Change-id mapping section carried through verbatim; `None` when the container has none.
    pub idmp: Option<Vec<u8>>,
}

impl RepoDocument {
    /// Creates a document for a freshly initialized repository.
    pub fn new(meta: MetaSection, head: HeadState) -> Self {
        Self {
            meta,
            head,
            refs: RefsSection::new(),
            indx: IndxSection::new(),
            oplog: OpLogSection::new(),
            prom: PromSection::new(),
            wktr: WktrSection::new(),
            idmp: None,
        }
    }

    /// Creates a document for a repository that does not exist yet, without touching the disk.
    ///
    /// The repository id is generated from the platform random source and the head starts on the
    /// conventional `taxis` branch, so a freshly created repository has the same shape as one
    /// produced by `taxis init`. Returning the document before it is written lets a caller read the
    /// id first, which is what a store-backed layout needs: the store directory is named after the
    /// id, so the id must exist before the destination path can be computed.
    ///
    /// # Errors
    ///
    /// Returns [`crate::error::NativeError::RandomUnavailable`] when the platform refuses random
    /// bytes.
    pub fn for_new_repository(layout_mode: LayoutMode) -> NativeResult<Self> {
        let repo_id = crate::repo_identity::generate_repo_id()?;
        let meta = MetaSection::new(repo_id, current_time_ms(), layout_mode);
        let head = HeadState::Symbolic {
            target: DEFAULT_BRANCH_REF.to_owned(),
        };
        Ok(Self::new(meta, head))
    }

    /// Publishes this document as a repository that does not exist yet.
    ///
    /// # Errors
    ///
    /// Returns [`crate::error::NativeError::RepositoryExists`] when a container is already present,
    /// and propagates encoding and I/O failures.
    pub fn publish_new(&self, path: &Path) -> NativeResult<()> {
        if path.exists() {
            return Err(crate::error::NativeError::RepositoryExists {
                path: path.display().to_string(),
            });
        }
        self.save_atomic(path)
    }

    /// Reads and decodes a container from disk.
    ///
    /// # Errors
    ///
    /// Propagates I/O failures, container-level rejections (magic, version, alignment, CRC), and
    /// section-level decode failures. A section that is present but unparseable is reported, never
    /// replaced by an empty default: doing so would present a repository whose history vanished.
    pub fn load(path: &Path) -> NativeResult<Self> {
        let bytes = std::fs::read(path)?;
        Self::from_bytes(&bytes)
    }

    /// Decodes a container from an in-memory byte slice.
    ///
    /// # Errors
    ///
    /// Same failure set as [`RepoDocument::load`], minus I/O.
    pub fn from_bytes(bytes: &[u8]) -> NativeResult<Self> {
        let view = ContainerView::parse(bytes)?;

        let meta = MetaSection::decode(view.payload(SectionTag::Meta)?)?;
        let head = HeadState::decode(view.payload(SectionTag::Head)?)?;

        let refs = decode_or_default(view.payload(SectionTag::Refs), RefsSection::decode)?;
        let indx = decode_or_default(view.payload(SectionTag::Indx), IndxSection::decode)?;
        let oplog = decode_or_default(view.payload(SectionTag::OpLog), OpLogSection::decode)?;
        let prom = decode_or_default(view.payload(SectionTag::Prom), PromSection::decode)?;
        let wktr = decode_or_default(view.payload(SectionTag::Wktr), WktrSection::decode)?;

        let idmp = view.payload(SectionTag::Idmp).ok().map(<[u8]>::to_vec);

        Ok(Self {
            meta,
            head,
            refs,
            indx,
            oplog,
            prom,
            wktr,
            idmp,
        })
    }

    /// Serializes the document into a complete container byte vector.
    ///
    /// # Errors
    ///
    /// Propagates section-encoding failures and [`crate::error::NativeError::TooManySections`].
    pub fn to_bytes(&self) -> NativeResult<Vec<u8>> {
        Ok(self.build_container()?.build())
    }

    /// Publishes the document atomically to `path`.
    ///
    /// # Errors
    ///
    /// Propagates section-encoding and I/O failures. The staging file is removed on failure so a
    /// half-written container never survives to be mistaken for the real one.
    pub fn save_atomic(&self, path: &Path) -> NativeResult<()> {
        self.build_container()?.write_atomic(path)
    }

    /// Assembles every section into a container builder in the mandated tag order.
    ///
    /// One assembly path serves both serialization and publication: two copies of the section list
    /// would let a section be added to `to_bytes` and forgotten in `save_atomic`, so a value that
    /// round-trips in memory would vanish on disk.
    ///
    /// # Errors
    ///
    /// Propagates section-encoding failures and [`crate::error::NativeError::TooManySections`].
    fn build_container(&self) -> NativeResult<ContainerBuilder> {
        let mut builder = ContainerBuilder::new();
        builder.add_section(SectionTag::Meta, self.meta.encode()?)?;
        builder.add_section(SectionTag::Head, self.head.encode()?)?;
        builder.add_section(SectionTag::Refs, self.refs.encode()?)?;
        builder.add_section(SectionTag::Indx, self.indx.encode()?)?;
        builder.add_section(SectionTag::OpLog, self.oplog.encode()?)?;
        builder.add_section(SectionTag::Prom, self.prom.encode()?)?;
        builder.add_section(SectionTag::Wktr, self.wktr.encode()?)?;
        if let Some(payload) = self.idmp.as_ref() {
            builder.add_section(SectionTag::Idmp, payload.clone())?;
        }
        Ok(builder)
    }

    /// Reports every damaged section without aborting on the first one.
    ///
    /// `taxis doctor` needs the complete list: fixing one damaged section only to discover the next
    /// one on the following run doubles the operator's work for no reason.
    pub fn diagnose(&self) -> Vec<String> {
        let mut findings = Vec::new();
        if let Err(error) = self.meta.encode() {
            findings.push(format!("META: {error}"));
        }
        if let Err(error) = self.head.encode() {
            findings.push(format!("HEAD: {error}"));
        }
        if let Err(error) = self.refs.encode() {
            findings.push(format!("REFS: {error}"));
        }
        if let Err(error) = self.indx.encode() {
            findings.push(format!("INDX: {error}"));
        }
        if let Err(error) = self.oplog.encode() {
            findings.push(format!("OPLG: {error}"));
        }
        if let Err(error) = self.prom.encode() {
            findings.push(format!("PROM: {error}"));
        }
        if let Err(error) = self.wktr.encode() {
            findings.push(format!("WKTR: {error}"));
        }
        findings
    }
}

/// Decodes an optional section, treating absence as the type's default.
///
/// Absence is legitimate: a repository that has never staged a file has no `INDX` records, and a
/// build that predates a section will not have written it. A section that is *present* but
/// unparseable is still an error, so the distinction between "absent" and "damaged" is preserved.
///
/// # Errors
///
/// Propagates the decoder's failure for a present but unparseable payload.
fn decode_or_default<T, F>(payload: NativeResult<&[u8]>, decoder: F) -> NativeResult<T>
where
    T: Default,
    F: Fn(&[u8]) -> NativeResult<T>,
{
    match payload {
        Ok(bytes) => decoder(bytes),
        Err(_) => Ok(T::default()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use fg_core::models::{FileMode, Oid};

    use super::RepoDocument;
    use crate::sections::head::HeadState;
    use crate::sections::indx::IndexEntry;
    use crate::sections::meta::{LayoutMode, MetaSection};
    use crate::sections::oplog::{OpLogEntry, OpLogParts};
    use crate::sections::prom::{PromotionRecord, PromotionStatus};
    use crate::sections::refs::RefRecord;
    use crate::sections::worktree_registry::WorktreeRecord;

    static SCRATCH: AtomicU64 = AtomicU64::new(0);

    fn scratch_path(label: &str) -> std::path::PathBuf {
        let sequence = SCRATCH.fetch_add(1, Ordering::Relaxed);
        let mut path = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        path.push("fg-native-document");
        let _ = std::fs::create_dir_all(&path);
        path.push(format!("{label}-{}-{sequence}.txc", std::process::id()));
        path
    }

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    fn fresh_document() -> RepoDocument {
        let mut repo_id = [0u8; 16];
        repo_id[0] = 0x42;
        let meta = MetaSection::new(repo_id, 1_700_000_000_000, LayoutMode::Dev);
        RepoDocument::new(
            meta,
            HeadState::Symbolic {
                target: "refs/heads/main".to_owned(),
            },
        )
    }

    #[test]
    fn fresh_document_has_empty_sections() {
        let document = fresh_document();
        assert!(document.refs.is_empty());
        assert!(document.indx.is_empty());
        assert!(document.oplog.is_empty());
        assert_eq!(document.prom.history_len(), 0);
        assert!(document.wktr.is_empty());
        assert!(document.idmp.is_none());
        assert!(document.diagnose().is_empty());
    }

    #[test]
    fn empty_document_round_trips_through_bytes() {
        let document = fresh_document();
        let bytes = document.to_bytes().expect("encode");
        let decoded = RepoDocument::from_bytes(&bytes).expect("decode");
        assert_eq!(decoded, document);
    }

    #[test]
    fn fully_populated_document_round_trips() {
        let mut document = fresh_document();

        document
            .refs
            .upsert(RefRecord {
                name: "refs/heads/main".to_owned(),
                oid: oid_from(0x11),
                peeled: None,
            })
            .expect("upsert ref");

        document
            .indx
            .upsert(IndexEntry::new(
                "src/lib.rs",
                FileMode::RegularFile,
                oid_from(0x22),
            ))
            .expect("upsert index entry");

        let op = OpLogEntry::new(OpLogParts {
            parent_ids: Vec::new(),
            head_oid: Some(oid_from(0x11)),
            branches: vec![("refs/heads/main".to_owned(), oid_from(0x11))],
            staged_promotions: Vec::new(),
            timestamp_ms: 1_700_000_000_000,
            actor: "agent-007".to_owned(),
            command: "init".to_owned(),
            description: "initialize".to_owned(),
        })
        .expect("build op");
        document.oplog.upsert(op).expect("upsert op");

        document.prom.set_active(PromotionRecord {
            request_id: "promo-1".to_owned(),
            candidate_oid: oid_from(0x33),
            source_ref: "refs/fractal/trunk".to_owned(),
            target_ref: "refs/heads/main".to_owned(),
            composite_score: 95.0,
            cai_index: 90.0,
            credible_interval_lower: 86.0,
            anti_gaming_passed: true,
            status: PromotionStatus::Pending,
            created_at_ms: 1_700_000_000_000,
            expires_at_ms: 1_700_003_600_000,
            challenge_nonce: [0x5A; 32],
            agent_uid: "taxis-auditor".to_owned(),
            summary: "clean".to_owned(),
        });

        document
            .wktr
            .upsert(WorktreeRecord::full(""))
            .expect("upsert worktree");

        let bytes = document.to_bytes().expect("encode");
        let decoded = RepoDocument::from_bytes(&bytes).expect("decode");
        assert_eq!(decoded, document);
    }

    #[test]
    fn document_survives_atomic_save_and_load() {
        let mut document = fresh_document();
        document
            .refs
            .upsert(RefRecord {
                name: "refs/heads/main".to_owned(),
                oid: oid_from(0x44),
                peeled: None,
            })
            .expect("upsert ref");

        let path = scratch_path("save");
        document.save_atomic(&path).expect("save");
        let loaded = RepoDocument::load(&path).expect("load");
        assert_eq!(loaded, document);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unknown_idmp_section_is_carried_through_verbatim() {
        // An older build must not drop a newer build's data merely because it has no codec for it.
        let mut document = fresh_document();
        document.idmp = Some(vec![0xDE, 0xAD, 0xBE, 0xEF]);

        let bytes = document.to_bytes().expect("encode");
        let decoded = RepoDocument::from_bytes(&bytes).expect("decode");
        assert_eq!(decoded.idmp, Some(vec![0xDE, 0xAD, 0xBE, 0xEF]));
    }

    #[test]
    fn empty_record_streams_decode_as_empty_sections() {
        // A container may carry a section with zero records; the container format mandates the
        // section's presence, not its content. A fresh repository legitimately has none.
        use crate::container::ContainerBuilder;
        use crate::section_tag::SectionTag;

        let document = fresh_document();
        let empty_stream = vec![0u8, 0, 0, 0];
        let mut builder = ContainerBuilder::new();
        let sections: [(SectionTag, Vec<u8>); 7] = [
            (SectionTag::Meta, document.meta.encode().expect("meta")),
            (SectionTag::Head, document.head.encode().expect("head")),
            (SectionTag::Refs, empty_stream.clone()),
            (SectionTag::Indx, empty_stream.clone()),
            (SectionTag::OpLog, empty_stream.clone()),
            (SectionTag::Prom, vec![0u8, 0, 0, 0, 0]),
            (SectionTag::Wktr, empty_stream),
        ];
        for (tag, payload) in sections {
            builder.add_section(tag, payload).expect("add section");
        }
        let bytes = builder.build();

        let decoded = RepoDocument::from_bytes(&bytes).expect("decode");
        assert!(decoded.refs.is_empty());
        assert!(decoded.indx.is_empty());
        assert!(decoded.oplog.is_empty());
        assert_eq!(decoded.prom.history_len(), 0);
        assert!(decoded.wktr.is_empty());
    }

    #[test]
    fn damaged_section_is_reported_not_defaulted() {
        // A present-but-unparseable REFS must fail loudly: defaulting it to empty would present a
        // repository whose every branch vanished.
        use crate::container::ContainerBuilder;
        use crate::section_tag::SectionTag;

        let document = fresh_document();
        let empty_stream = vec![0u8, 0, 0, 0];
        let mut builder = ContainerBuilder::new();
        let sections: [(SectionTag, Vec<u8>); 7] = [
            (SectionTag::Meta, document.meta.encode().expect("meta")),
            (SectionTag::Head, document.head.encode().expect("head")),
            (SectionTag::Refs, vec![0xFF, 0xFF, 0xFF, 0x7F]),
            (SectionTag::Indx, empty_stream.clone()),
            (SectionTag::OpLog, empty_stream.clone()),
            (SectionTag::Prom, vec![0u8, 0, 0, 0, 0]),
            (SectionTag::Wktr, empty_stream),
        ];
        for (tag, payload) in sections {
            builder.add_section(tag, payload).expect("add section");
        }
        let bytes = builder.build();

        assert!(RepoDocument::from_bytes(&bytes).is_err());
    }
}
