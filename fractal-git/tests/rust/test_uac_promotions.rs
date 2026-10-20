//! Module: Taxis Integration Tests — Human GUI UAC Elevation & Score Ratchet Promotion
//! File Path: tests/rust/test_uac_promotions.rs
//! Architecture Role: Comprehensive integration test suite verifying human GUI UAC authorization,
//!   Auto quality scoring integration, 1-hour lease expiry, score ratchet delta replacements,
//!   and IPC wire codec roundtrips.

use fractal_git::server::{IpcCodec, IpcMessage};
use fractal_git::{
    AutoQualityScoreEnvelope, DiskRefStore, HumanUacProof, Oid, PromotionStagingLedger, RefStore,
    StagedPromotionRequest, StagedPromotionStatus, StandardNonceAuthorizer, TaxisPolicy,
};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

static DIR_LOCK: Mutex<()> = Mutex::new(());

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(prefix: &str) -> Self {
        let _guard = DIR_LOCK.lock().unwrap();
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let base = if cfg!(windows) {
            let low = std::env::temp_dir().join("Low");
            let _ = std::fs::create_dir_all(&low);
            if low.exists() {
                low
            } else {
                std::env::temp_dir()
            }
        } else {
            std::env::temp_dir()
        };
        let path = base.join(format!("fg_uac_{}_{}_{}", prefix, pid, count));
        std::fs::create_dir_all(&path).expect("Failed to create test directory");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn sample_auto_score(score: f64, anti_gaming: bool) -> AutoQualityScoreEnvelope {
    AutoQualityScoreEnvelope {
        composite_score: score,
        cai_index: 95.0,
        cyclomatic_complexity_delta: -4,
        eloc_delta: -18,
        credible_interval_lower: score - 2.5,
        anti_gaming_passed: anti_gaming,
        summary_report: format!("Quality Score: {:.1}, Anti-Gaming: {}", score, anti_gaming),
    }
}

#[test]
fn test_scenario_1_staged_promotion_leaves_system_trunk_unchanged_with_1h_lease() {
    let tmp = TestDir::new("scenario_1");
    let git_dir = tmp.path().to_path_buf();
    let mut ledger = PromotionStagingLedger::load_or_init(&git_dir).unwrap();
    let ref_store = DiskRefStore::new(&git_dir);
    let policy = TaxisPolicy::default();

    let candidate_oid = Oid::from_bytes([0x11; 20]);
    let start_time_ms = 1_700_000_000_000;

    // 1. SubAgent proposes promotion
    let req_id = ledger
        .stage_promotion(
            candidate_oid,
            sample_auto_score(88.0, true),
            "Refactor: eliminate transient allocations",
            "agent-worker-01",
            &policy,
            start_time_ms,
        )
        .expect("Staging should succeed");

    // 2. System Trunk (refs/heads/main) MUST remain unchanged!
    let main_ref = ref_store.get_ref("refs/heads/main").unwrap();
    assert!(
        main_ref.is_none(),
        "System Trunk must not be touched by Agent alone"
    );

    // 3. Staged candidate is active with status PendingHumanUac and 1-hour TTL
    let active = ledger
        .get_active_candidate(start_time_ms)
        .expect("Active candidate must exist");
    assert_eq!(active.request_id, req_id);
    assert_eq!(active.status, StagedPromotionStatus::PendingHumanUac);
    assert_eq!(active.candidate_commit_oid, candidate_oid);
    assert_eq!(
        active.expires_at_ms,
        start_time_ms + 3_600_000,
        "Lease TTL must be exactly 3600 seconds (1 hour)"
    );

    drop(ledger);
    drop(ref_store);
}

#[test]
fn test_scenario_2_anti_gaming_and_score_threshold_rejections() {
    let mut ledger = PromotionStagingLedger::in_memory();
    let policy = TaxisPolicy::default();
    let now = 1_700_000_000_000;

    // A. Anti-Gaming Guardrail rejection (BLOCK_GAMING_DETECTED)
    let gaming_score = sample_auto_score(99.0, false);
    let err_gaming = ledger
        .stage_promotion(
            Oid::from_bytes([0x01; 20]),
            gaming_score,
            "Fake refactor gaming metrics",
            "agent-rogue",
            &policy,
            now,
        )
        .unwrap_err();
    assert!(
        err_gaming.to_string().contains("BLOCK_GAMING_DETECTED"),
        "Anti-gaming guardrail must reject unverified optimizations"
    );

    // B. Sub-threshold score rejection (< 80.0)
    let low_score = sample_auto_score(76.5, true);
    let err_low = ledger
        .stage_promotion(
            Oid::from_bytes([0x02; 20]),
            low_score,
            "Low score patch",
            "agent-novice",
            &policy,
            now,
        )
        .unwrap_err();
    assert!(
        err_low.to_string().contains("below minimum threshold"),
        "Scores below minimum baseline must be rejected"
    );
}

#[test]
fn test_scenario_3_score_ratchet_superiority_replacement() {
    let mut ledger = PromotionStagingLedger::in_memory();
    let policy = TaxisPolicy::default();
    let now = 1_700_000_000_000;

    // 1. Initial candidate stages with score 85.0
    let id_1 = ledger
        .stage_promotion(
            Oid::from_bytes([0x21; 20]),
            sample_auto_score(85.0, true),
            "Initial candidate",
            "agent-alpha",
            &policy,
            now,
        )
        .unwrap();

    // 2. Candidate 2 arrives with score 88.0 (+3.0 delta < +5.0 baseline) -> REJECTED
    let err_delta = ledger
        .stage_promotion(
            Oid::from_bytes([0x22; 20]),
            sample_auto_score(88.0, true),
            "Marginal improvement (+3.0)",
            "agent-beta",
            &policy,
            now + 10_000,
        )
        .unwrap_err();
    assert!(
        err_delta
            .to_string()
            .contains("does not meet required baseline"),
        "Marginal candidate must not displace active candidate without meeting +5.0 delta"
    );

    // Verify initial candidate is still active
    let active_mid = ledger.get_active_candidate(now + 20_000).unwrap();
    assert_eq!(active_mid.request_id, id_1);

    // 3. Candidate 3 arrives with score 92.0 (+7.0 delta >= +5.0 baseline) -> SUPERSEDES!
    let id_3 = ledger
        .stage_promotion(
            Oid::from_bytes([0x23; 20]),
            sample_auto_score(92.0, true),
            "Major architectural optimization (+7.0)",
            "agent-gamma",
            &policy,
            now + 30_000,
        )
        .unwrap();

    // Active candidate is now Candidate 3
    let active_final = ledger.get_active_candidate(now + 40_000).unwrap();
    assert_eq!(active_final.request_id, id_3);
    assert_eq!(active_final.auto_score.composite_score, 92.0);

    // Initial candidate has been archived with SupersededByHigherScore status
    let (_active, history) = ledger.list_promotions();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].request_id, id_1);
    match &history[0].status {
        StagedPromotionStatus::SupersededByHigherScore {
            superseded_by_id, ..
        } => {
            assert_eq!(superseded_by_id, &id_3);
        }
        other => panic!("Expected SupersededByHigherScore, got {:?}", other),
    }
}

#[test]
fn test_scenario_4_1_hour_lease_expiry_lifecycle() {
    let mut ledger = PromotionStagingLedger::in_memory();
    let policy = TaxisPolicy::default();
    let t0 = 1_700_000_000_000;

    // Stage candidate with 1h TTL
    let req_id = ledger
        .stage_promotion(
            Oid::from_bytes([0x31; 20]),
            sample_auto_score(90.0, true),
            "Feature implementation",
            "agent-delta",
            &policy,
            t0,
        )
        .unwrap();

    // 59 minutes later: still active
    let t_59m = t0 + 59 * 60 * 1000;
    assert!(ledger.get_active_candidate(t_59m).is_some());

    // 60 minutes and 1 second later: expired!
    let t_60m_1s = t0 + 3_600_001;
    let expired_check = ledger.get_active_candidate(t_60m_1s);
    assert!(
        expired_check.is_none(),
        "Candidate must expire after 1 hour"
    );

    // After expiration, a candidate with score 82.0 can stage cleanly without needing to beat 90.0
    let id_new = ledger
        .stage_promotion(
            Oid::from_bytes([0x32; 20]),
            sample_auto_score(82.0, true),
            "Subsequent proposal after timeout",
            "agent-epsilon",
            &policy,
            t_60m_1s + 100,
        )
        .expect("Should stage freely once previous lease expired");
    assert_ne!(id_new, req_id);
}

#[test]
fn test_scenario_5_cryptographic_nonce_verification_and_atomic_cas_merge() {
    let tmp = TestDir::new("scenario_5");
    let git_dir = tmp.path().to_path_buf();
    let mut ledger = PromotionStagingLedger::load_or_init(&git_dir).unwrap();
    let ref_store = DiskRefStore::new(&git_dir);
    let authorizer = StandardNonceAuthorizer::new();
    let policy = TaxisPolicy::default();
    let t0 = 1_700_000_000_000;

    let candidate_oid = Oid::from_bytes([0x42; 20]);
    let req_id = ledger
        .stage_promotion(
            candidate_oid,
            sample_auto_score(94.0, true),
            "Critical security fix and memory optimization",
            "agent-security",
            &policy,
            t0,
        )
        .unwrap();

    let active = ledger.get_active_candidate(t0 + 1000).unwrap().clone();

    // A. Forged / Tampered Nonce -> REJECTED
    let bad_proof = HumanUacProof {
        request_id: req_id.clone(),
        signed_nonce: [0xff; 32], // incorrect nonce!
        operator_name: "Human Architect (GUI Click)".into(),
        operator_email: "architect@deepmind.internal".into(),
        gui_session_token: "GUI_SESSION_VERIFIED".into(),
        timestamp_ms: t0 + 2000,
    };
    let err_tamper = ledger
        .apply_uac_approval(&req_id, &bad_proof, &authorizer, &ref_store)
        .unwrap_err();
    assert!(
        err_tamper
            .to_string()
            .contains("invalid cryptographic nonce"),
        "Tampered nonce must fail UAC verification"
    );
    assert!(ref_store.get_ref("refs/heads/main").unwrap().is_none());

    // B. Valid Human GUI UAC Proof -> ATOMIC PROMOTION!
    let valid_proof = HumanUacProof {
        request_id: req_id.clone(),
        signed_nonce: active.challenge_nonce, // correct cryptographic challenge nonce
        operator_name: "Human Architect (GUI Click)".into(),
        operator_email: "architect@deepmind.internal".into(),
        gui_session_token: "GUI_SESSION_VERIFIED".into(),
        timestamp_ms: t0 + 3000,
    };

    ledger
        .apply_uac_approval(&req_id, &valid_proof, &authorizer, &ref_store)
        .expect("Valid UAC approval must succeed");

    // System Trunk (refs/heads/main) is now atomically pointing to candidate_oid!
    let main_ref = ref_store.get_ref("refs/heads/main").unwrap();
    assert_eq!(main_ref, Some(candidate_oid));

    // Audit trail must record the immutable promotion event
    let audits = authorizer.audit_entries();
    assert_eq!(audits.len(), 1);
    assert!(audits[0].contains("SYSTEM_TRUNK_PROMOTION_APPROVED"));
    assert!(audits[0].contains("Human Architect (GUI Click)"));

    drop(ledger);
    drop(ref_store);
}

#[test]
fn test_scenario_6_human_rejection_with_constructive_feedback() {
    let mut ledger = PromotionStagingLedger::in_memory();
    let policy = TaxisPolicy::default();
    let t0 = 1_700_000_000_000;

    let req_id = ledger
        .stage_promotion(
            Oid::from_bytes([0x55; 20]),
            sample_auto_score(87.0, true),
            "UI theme refactor",
            "agent-ui",
            &policy,
            t0,
        )
        .unwrap();

    // Human operator rejects in GUI modal with feedback
    ledger
        .reject_uac_promotion(
            &req_id,
            "Human Design Lead",
            "High-contrast palette missing WCAG AAA certification on borders",
            t0 + 5000,
        )
        .expect("Rejection should succeed");

    // Candidate is cleared from active queue
    assert!(ledger.get_active_candidate(t0 + 6000).is_none());
}

#[test]
fn test_scenario_7_ipc_message_roundtrip_codec() {
    let candidate = StagedPromotionRequest {
        request_id: "promo-1700000000000-abcd12".into(),
        source_ref: "refs/fractal/trunk/integration".into(),
        target_ref: "refs/heads/main".into(),
        candidate_commit_oid: Oid::from_bytes([0x77; 20]),
        auto_score: sample_auto_score(91.5, true),
        status: StagedPromotionStatus::PendingHumanUac,
        challenge_nonce: [0x5a; 32],
        created_at_ms: 1_700_000_000_000,
        expires_at_ms: 1_700_003_600_000,
        summary: "Zero-copy IPC optimization".into(),
        agent_uid: "agent-opt-99".into(),
    };

    let msg = IpcMessage::RequestSystemPromotion {
        request: candidate.clone(),
    };

    let frame = IpcCodec::encode(&msg).expect("IPC encode should succeed");
    let (decoded, consumed) = IpcCodec::decode(&frame)
        .expect("IPC decode should succeed")
        .expect("Complete frame expected");

    assert_eq!(consumed, frame.len());
    assert_eq!(decoded, msg);
}
