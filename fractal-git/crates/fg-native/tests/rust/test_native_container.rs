//! Module: fg-native — Container Assembly Integration Tests
//! File Path: crates/fg-native/tests/rust/test_native_container.rs
//! Architecture Role: Verifies that all seven implemented section codecs survive a real container
//!   round trip, which is the contract `taxis init` and `Repo::open` rely on.
//! Dependencies & Triggers: Run by `cargo test`; exercises only the public fg-native surface.
//! Responsibilities: Assemble a repository container with every section populated, publish it
//!   atomically, reopen it, and assert every field survives byte-for-byte.
//! Exit Semantics & Design Rationale: Uses the public API only, so it catches breakage that unit
//!   tests inside the crate could mask through access to private helpers. Every section is
//!   populated with non-trivial content — an empty section would pass even if its codec were a stub.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use fg_core::models::{FileMode, IndexStage, Oid};
use fg_native::{
    ContainerBuilder, ContainerView, HeadState, IndexEntry, IndxSection, LayoutMode, MetaSection,
    OpLogEntry, OpLogParts, OpLogSection, PromSection, PromotionRecord, PromotionStatus, RefRecord,
    RefsSection, SectionTag, StatCache, WktrSection, WorktreeMode, WorktreeRecord, WorktreeTier,
    CHALLENGE_NONCE_LEN,
};

/// Monotonic counter keeping scratch file names unique across parallel test threads.
static SCRATCH_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Resolves a unique writable scratch path.
fn scratch_path(label: &str) -> PathBuf {
    let sequence = SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut path = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("target")
        .join("test_tmp");
    path.push("fg-native-integration");
    let _ = std::fs::create_dir_all(&path);
    path.push(format!("{}-{}-{}.txc", label, std::process::id(), sequence));
    path
}

/// Builds an object id with a recognizable seed byte.
fn oid_from(seed: u8) -> Oid {
    let mut raw = [0u8; 20];
    raw[0] = seed;
    raw[19] = seed.wrapping_mul(3);
    Oid::from_bytes(raw)
}

/// The seven mandatory sections, each fully populated.
struct Fixture {
    meta: MetaSection,
    head: HeadState,
    refs: RefsSection,
    indx: IndxSection,
    oplog: OpLogSection,
    prom: PromSection,
    wktr: WktrSection,
}

/// Adds every section the container format mandates.
fn add_all_mandatory_sections(builder: &mut ContainerBuilder, fixture: &Fixture) {
    let sections: [(SectionTag, Vec<u8>); 7] = [
        (
            SectionTag::Meta,
            fixture.meta.encode().expect("encode meta"),
        ),
        (
            SectionTag::Head,
            fixture.head.encode().expect("encode head"),
        ),
        (
            SectionTag::Refs,
            fixture.refs.encode().expect("encode refs"),
        ),
        (
            SectionTag::Indx,
            fixture.indx.encode().expect("encode indx"),
        ),
        (
            SectionTag::OpLog,
            fixture.oplog.encode().expect("encode oplog"),
        ),
        (
            SectionTag::Prom,
            fixture.prom.encode().expect("encode prom"),
        ),
        (
            SectionTag::Wktr,
            fixture.wktr.encode().expect("encode wktr"),
        ),
    ];
    for (tag, payload) in sections {
        builder.add_section(tag, payload).expect("add section");
    }
}

/// Builds a container whose every section carries non-trivial content.
fn assemble() -> (Fixture, Vec<u8>) {
    let mut repo_id = [0u8; 16];
    repo_id[0] = 0x7A;
    repo_id[15] = 0x01;
    let meta = MetaSection::new(repo_id, 1_726_000_000_000, LayoutMode::Dev);

    let head = HeadState::Symbolic {
        target: "refs/heads/main".to_owned(),
    };

    let mut refs = RefsSection::new();
    refs.upsert(RefRecord {
        name: "refs/heads/main".to_owned(),
        oid: oid_from(0x11),
        peeled: None,
    })
    .expect("upsert main");
    refs.upsert(RefRecord {
        name: "refs/tags/v1".to_owned(),
        oid: oid_from(0x22),
        peeled: Some(oid_from(0x33)),
    })
    .expect("upsert tag");

    let mut indx = IndxSection::new();
    let mut staged = IndexEntry::new("src/lib.rs", FileMode::RegularFile, oid_from(0x44));
    staged.stat = StatCache {
        mtime_secs: 1_726_000_001,
        mtime_nanos: 500_000_000,
        ctime_secs: 1_726_000_002,
        ctime_nanos: 250_000_000,
        size: 4096,
        dev: 0xABCD,
        ino: 0x1234,
        uid: 1000,
        gid: 1000,
    };
    indx.upsert(staged).expect("upsert staged");
    indx.upsert(IndexEntry::new(
        "vendor/",
        FileMode::Directory,
        oid_from(0x55),
    ))
    .expect("upsert collapsed directory");
    let mut conflicted = IndexEntry::new("conflict.txt", FileMode::RegularFile, oid_from(0x66));
    conflicted.stage = IndexStage::Theirs;
    indx.upsert(conflicted).expect("upsert conflict stage");

    let mut oplog = OpLogSection::new();
    let root_op = OpLogEntry::new(OpLogParts {
        parent_ids: Vec::new(),
        head_oid: Some(oid_from(0x11)),
        branches: vec![("refs/heads/main".to_owned(), oid_from(0x11))],
        staged_promotions: Vec::new(),
        timestamp_ms: 1_726_000_000_000,
        actor: "agent-007".to_owned(),
        command: "init".to_owned(),
        description: "initialize the repository".to_owned(),
    })
    .expect("build root op");
    let tip_op = OpLogEntry::new(OpLogParts {
        parent_ids: vec![root_op.op_id],
        head_oid: Some(oid_from(0x77)),
        branches: vec![("refs/heads/main".to_owned(), oid_from(0x77))],
        staged_promotions: vec!["promo-1".to_owned()],
        timestamp_ms: 1_726_000_060_000,
        actor: "agent-007".to_owned(),
        command: "commit".to_owned(),
        description: "stage a change".to_owned(),
    })
    .expect("build tip op");
    oplog.upsert(root_op).expect("upsert root op");
    oplog.upsert(tip_op).expect("upsert tip op");

    let mut prom = PromSection::new();
    let mut nonce = [0u8; CHALLENGE_NONCE_LEN];
    nonce[0] = 0xAB;
    nonce[CHALLENGE_NONCE_LEN - 1] = 0xCD;
    prom.set_active(PromotionRecord {
        request_id: "promo-active".to_owned(),
        candidate_oid: oid_from(0x88),
        source_ref: "refs/fractal/trunk".to_owned(),
        target_ref: "refs/heads/main".to_owned(),
        composite_score: 95.01,
        cai_index: 90.31,
        credible_interval_lower: 86.75,
        anti_gaming_passed: true,
        status: PromotionStatus::Pending,
        created_at_ms: 1_726_000_000_000,
        expires_at_ms: 1_726_003_600_000,
        challenge_nonce: nonce,
        agent_uid: "taxis-auditor".to_owned(),
        summary: "clean topology and zero-alloc boundary".to_owned(),
    });
    prom.record_history(PromotionRecord {
        request_id: "promo-rejected".to_owned(),
        candidate_oid: oid_from(0x99),
        source_ref: "refs/fractal/trunk".to_owned(),
        target_ref: "refs/heads/main".to_owned(),
        composite_score: 71.5,
        cai_index: 60.0,
        credible_interval_lower: 55.0,
        anti_gaming_passed: false,
        status: PromotionStatus::Rejected,
        created_at_ms: 1_725_000_000_000,
        expires_at_ms: 1_725_003_600_000,
        challenge_nonce: nonce,
        agent_uid: "agent-007".to_owned(),
        summary: "below the minimum composite threshold".to_owned(),
    })
    .expect("record history");

    let mut wktr = WktrSection::new();
    wktr.upsert(WorktreeRecord::full("")).expect("upsert main");
    let mut sparse_agent = WorktreeRecord::sparse(
        "agents/vendor",
        vec!["auto-refactor/src/analyzers/".to_owned()],
    );
    sparse_agent.tier = WorktreeTier::Cold;
    wktr.upsert(sparse_agent).expect("upsert sparse agent");
    wktr.upsert(WorktreeRecord {
        path: "agents/virtual".to_owned(),
        mode: WorktreeMode::Virtual,
        scopes: vec!["docs/".to_owned()],
        is_full: false,
        tier: WorktreeTier::Warm,
    })
    .expect("upsert virtual agent");

    let fixture = Fixture {
        meta,
        head,
        refs,
        indx,
        oplog,
        prom,
        wktr,
    };

    let mut builder = ContainerBuilder::new();
    add_all_mandatory_sections(&mut builder, &fixture);
    let bytes = builder.build();
    (fixture, bytes)
}

#[test]
fn every_implemented_section_survives_container_round_trip() {
    let (fixture, bytes) = assemble();
    let view = ContainerView::parse(&bytes).expect("container must parse");

    let decoded_meta =
        MetaSection::decode(view.payload(SectionTag::Meta).expect("meta payload")).expect("meta");
    let decoded_head =
        HeadState::decode(view.payload(SectionTag::Head).expect("head payload")).expect("head");
    let decoded_refs =
        RefsSection::decode(view.payload(SectionTag::Refs).expect("refs payload")).expect("refs");
    let decoded_indx =
        IndxSection::decode(view.payload(SectionTag::Indx).expect("indx payload")).expect("indx");
    let decoded_oplog =
        OpLogSection::decode(view.payload(SectionTag::OpLog).expect("oplog payload"))
            .expect("oplog");
    let decoded_prom =
        PromSection::decode(view.payload(SectionTag::Prom).expect("prom payload")).expect("prom");
    let decoded_wktr =
        WktrSection::decode(view.payload(SectionTag::Wktr).expect("wktr payload")).expect("wktr");

    assert_eq!(decoded_meta, fixture.meta);
    assert_eq!(decoded_head, fixture.head);
    assert_eq!(decoded_refs, fixture.refs);
    assert_eq!(decoded_indx, fixture.indx);
    assert_eq!(decoded_oplog, fixture.oplog);
    assert_eq!(decoded_prom, fixture.prom);
    assert_eq!(decoded_wktr, fixture.wktr);
}

#[test]
fn container_survives_atomic_write_and_reopen() {
    let (fixture, _) = assemble();
    let path = scratch_path("reopen");

    let mut builder = ContainerBuilder::new();
    add_all_mandatory_sections(&mut builder, &fixture);
    builder.write_atomic(&path).expect("atomic write");

    let bytes = std::fs::read(&path).expect("read back");
    let view = ContainerView::parse(&bytes).expect("reopened container must parse");

    let decoded_meta =
        MetaSection::decode(view.payload(SectionTag::Meta).expect("meta payload")).expect("meta");
    assert_eq!(decoded_meta, fixture.meta);
    assert_eq!(decoded_meta.repo_id_hex().len(), 32);

    let decoded_indx =
        IndxSection::decode(view.payload(SectionTag::Indx).expect("indx payload")).expect("indx");
    assert_eq!(
        decoded_indx
            .get_clean("src/lib.rs")
            .map(|entry| entry.stat.size),
        Some(4096)
    );

    let decoded_prom =
        PromSection::decode(view.payload(SectionTag::Prom).expect("prom payload")).expect("prom");
    assert_eq!(
        decoded_prom
            .active()
            .map(|record| record.composite_score.to_bits()),
        Some(95.01f64.to_bits())
    );

    let decoded_wktr =
        WktrSection::decode(view.payload(SectionTag::Wktr).expect("wktr payload")).expect("wktr");
    assert!(decoded_wktr
        .find_owner("auto-refactor/src/analyzers/hygiene.ts")
        .is_some());

    let _ = std::fs::remove_file(&path);
}

#[test]
fn section_payloads_stay_eight_byte_aligned_after_assembly() {
    let (_, bytes) = assemble();
    let view = ContainerView::parse(&bytes).expect("parse");
    for entry in view.entries() {
        assert_eq!(entry.offset % 8, 0, "section {} misaligned", entry.tag);
    }
}

#[test]
fn verify_all_sections_reports_no_damage_on_fresh_container() {
    let (_, bytes) = assemble();
    let view = ContainerView::parse(&bytes).expect("parse");
    assert!(view.verify_all_sections().is_empty());
}

#[test]
fn single_byte_corruption_is_located_by_tag() {
    let (_, mut bytes) = assemble();
    let view = ContainerView::parse(&bytes).expect("parse");
    let target = view
        .entries()
        .find(|entry| entry.tag == SectionTag::Refs)
        .expect("refs present");
    let offset = target.offset as usize + 2;
    drop(view);

    bytes[offset] ^= 0xFF;

    let view = ContainerView::parse(&bytes).expect("table CRC untouched");
    let failures = view.verify_all_sections();
    assert_eq!(failures.len(), 1);
    let rendered = failures[0].to_string();
    assert!(
        rendered.contains("REFS"),
        "diagnostic must name the section"
    );
}

#[test]
fn tampering_with_an_operation_record_is_caught_by_identity_recomputation() {
    // The container CRC proves only that the bytes arrived intact. An attacker who rewrites a
    // record and refreshes the CRC defeats that check entirely, so the operation id must be
    // content-derived and re-verified on decode.
    let (fixture, bytes) = assemble();
    let view = ContainerView::parse(&bytes).expect("parse");
    let original_payload = view
        .payload(SectionTag::OpLog)
        .expect("oplog payload")
        .to_vec();
    drop(view);

    let mut tampered = original_payload.clone();
    let flip_at = tampered.len() - 2;
    tampered[flip_at] ^= 0x01;
    assert_ne!(tampered, original_payload, "tamper must change the bytes");

    let mut builder = ContainerBuilder::new();
    let sections: [(SectionTag, Vec<u8>); 7] = [
        (SectionTag::Meta, fixture.meta.encode().expect("meta")),
        (SectionTag::Head, fixture.head.encode().expect("head")),
        (SectionTag::Refs, fixture.refs.encode().expect("refs")),
        (SectionTag::Indx, fixture.indx.encode().expect("indx")),
        (SectionTag::OpLog, tampered),
        (SectionTag::Prom, fixture.prom.encode().expect("prom")),
        (SectionTag::Wktr, fixture.wktr.encode().expect("wktr")),
    ];
    for (tag, payload) in sections {
        builder.add_section(tag, payload).expect("add section");
    }
    let rebuilt = builder.build();

    let view = ContainerView::parse(&rebuilt).expect("rebuilt container parses");
    let payload = view
        .payload(SectionTag::OpLog)
        .expect("refreshed CRC passes");
    let error = OpLogSection::decode(payload).expect_err("tampered record must be rejected");
    assert!(
        matches!(
            error,
            fg_native::NativeError::OpIdMismatch { .. }
                | fg_native::NativeError::TruncatedRecord { .. }
                | fg_native::NativeError::InvalidUtf8 { .. }
                | fg_native::NativeError::InteriorNul { .. }
        ),
        "rejection must come from record validation, not a CRC check: {error}"
    );
}
