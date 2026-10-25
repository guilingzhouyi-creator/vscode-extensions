//! Test Suite: Taxis Governance V2 — Policy, Intent Blackboard, Block Merge, and Provenance Ledger
//! File Path: tests/rust/test_governance_pipeline.rs
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard
//! - `FGT-ALG-001`: Myers diff, 3-way merge, and block pushout guard

use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::models::{current_unix_seconds, AuthoritySecret};
use fg_storage::commit_materializer::write_commit_objects_with_parents;
use fractal_git::{
    materialize_commit, ActorIdentity, AgentPushContext, BlockProvenanceEntry,
    BlockProvenanceParams, BlockThreeWayMerge, CommitGovernanceHook, CommitMaterializationRequest,
    CommitMessageGuard, DiskBlackboardStore, DiskProvenanceStore, DiskRefStore, FractalRef,
    GitSignature, HookContext, HookPipeline, HookTier, HygieneConflictHook, LooseOdb, Oid,
    PreReceiveGuard, RefStore, TaxisPolicy, UacPromotionGateHook,
};

#[test]
fn test_workspace_strict_commit_policy() {
    let policy = TaxisPolicy::workspace_strict();
    assert_eq!(policy.name, "workspace-strict");
    assert!(policy.require_project_tag);
    assert!(policy.human_controlled_trunks);

    // 1. Valid workspace-strict commit with [fractal-git] tag and clean sections
    let valid_msg = r#"feat(core): introduce mechanical provenance tracking

[Project]
fractal-git

[Why]
Record objective physical timestamps for code blocks to eliminate semantic disputes.

[Changed]
- Added BlockProvenanceEntry structure
- Implemented DiskProvenanceStore for atomic storage

[Verification]
Assert all block timestamps are monotonically ordered relative to host epoch."#;

    let res = CommitMessageGuard::parse_and_verify(valid_msg, &policy, None);
    assert!(
        res.is_ok(),
        "Valid workspace-strict message should pass: {:?}",
        res.err()
    );

    // 2. Failure: Missing [Project] tag
    let missing_tag = r#"feat(core): introduce mechanical provenance tracking

[Why]
Record objective physical timestamps for code blocks to eliminate semantic disputes.

[Changed]
- Added BlockProvenanceEntry structure

[Verification]
Assert all block timestamps are monotonically ordered relative to host epoch."#;

    let res_missing = CommitMessageGuard::parse_and_verify(missing_tag, &policy, None);
    assert!(res_missing.is_err());
    let err_str = format!("{:?}", res_missing.err().unwrap());
    assert!(
        err_str.contains("Missing mandatory [Project] section") || err_str.contains("[Project]"),
        "Should reject missing project: {}",
        err_str
    );

    // 3. Failure: Forbidden buzzwords (e.g. "perfect" or "完美")
    let forbidden_word_msg = r#"fix(core): perfect lockless memory barrier

[Project]
fractal-git

[Why]
Eliminate crashing defect in pre-receive validation loop.

[Changed]
- Fixed null reference check

[Verification]
Assert no panic occurs on boundary test suite."#;

    let res_forbidden = CommitMessageGuard::parse_and_verify(forbidden_word_msg, &policy, None);
    assert!(res_forbidden.is_err());
    let err_forbidden = format!("{:?}", res_forbidden.err().unwrap());
    assert!(
        err_forbidden.contains("Forbidden term") || err_forbidden.contains("CMG-STY"),
        "Should trigger forbidden term guard: {}",
        err_forbidden
    );
}

#[test]
fn test_force_push_pre_receive_barriers() {
    let human = ActorIdentity::human("Guiling", "guiling@example.com", "token-secret");
    let agent_force = ActorIdentity::agent(AgentPushContext {
        agent_uid: "agent-007".to_string(),
        cell_id: "cell-core".to_string(),
        role: "coder".to_string(),
        is_force_push: true,
    });
    let trunk_ref = FractalRef::SystemTrunk {
        branch: "main".to_string(),
    };
    let cell_ref = FractalRef::CellMain {
        cell_id: "cell-core".to_string(),
    };
    let sub_ref = FractalRef::SubAgentWorktree {
        cell_id: "cell-core".to_string(),
        card_id: "card-01".to_string(),
        subagent_id: "sub-02".to_string(),
    };

    // System trunk strictly forbids force-push, even for Human
    assert!(PreReceiveGuard::assert_force_push_allowed(&trunk_ref, &human).is_err());
    // Cell main strictly forbids force-push for all
    assert!(PreReceiveGuard::assert_force_push_allowed(&cell_ref, &human).is_err());
    // Agent can NEVER force-push anywhere
    assert!(PreReceiveGuard::assert_force_push_allowed(&sub_ref, &agent_force).is_err());

    // Human force-push on leaf sub-tree is allowed (operator emergency reset)
    assert!(PreReceiveGuard::assert_force_push_allowed(&sub_ref, &human).is_ok());

    // Non-force agent push to authorized sub-tree is allowed by authority guard
    let agent_normal = ActorIdentity::agent(AgentPushContext {
        agent_uid: "agent-007".to_string(),
        cell_id: "cell-core".to_string(),
        role: "coder".to_string(),
        is_force_push: false,
    });
    let policy = TaxisPolicy::workspace_strict();
    assert!(PreReceiveGuard::assert_actor_authorized(&sub_ref, &agent_normal, &policy).is_ok());
}

#[test]
fn test_block_three_way_merge_concurrent_modifications() {
    // Base file with common header and two functions
    let base = r#"use std::collections::HashMap;
use std::sync::Arc;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    subtotal / 10
}
"#;

    // Side A adds an import and modifies calculate_subtotal
    let side_a = r#"use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    let _start = Instant::now();
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    subtotal / 10
}
"#;

    // Side B adds another import and modifies calculate_tax
    let side_b = r#"use std::collections::HashMap;
use std::sync::Arc;
use std::path::PathBuf;

pub fn calculate_subtotal(items: &[u32]) -> u32 {
    items.iter().sum()
}

pub fn calculate_tax(subtotal: u32) -> u32 {
    (subtotal as f64 * 0.12) as u32
}
"#;

    let result = BlockThreeWayMerge::merge(
        base.as_bytes(),
        side_a.as_bytes(),
        side_b.as_bytes(),
        "side_a",
        "side_b",
    );

    assert!(
        result.is_clean,
        "Block merge should succeed cleanly without false conflicts"
    );
    let merged = String::from_utf8_lossy(&result.content);

    // Verify union of imports
    assert!(merged.contains("use std::time::Instant;"));
    assert!(merged.contains("use std::path::PathBuf;"));
    assert!(merged.contains("use std::collections::HashMap;"));

    // Verify both function modifications co-exist
    assert!(merged.contains("let _start = Instant::now();"));
    assert!(merged.contains("(subtotal as f64 * 0.12) as u32"));
}

#[test]
fn test_fractal_hook_pipeline() {
    let mut pipeline = HookPipeline::new();
    pipeline.register(Arc::new(HygieneConflictHook));
    pipeline.register(Arc::new(CommitGovernanceHook));
    pipeline.register(Arc::new(UacPromotionGateHook));

    let secret = match AuthoritySecret::from_bytes(&[7u8; 32]) {
        Ok(secret) => secret,
        Err(secret_err) => panic!("fixture authority secret: {secret_err}"),
    };
    let token = match secret.issue("Guiling", 3600, current_unix_seconds()) {
        Ok(token) => token,
        Err(issue_err) => panic!("fixture authority token: {issue_err}"),
    };
    let actor = ActorIdentity::human("Guiling", "guiling@example.com", token);
    let mut policy = TaxisPolicy::workspace_strict();
    policy.authority_secret = Some(secret);
    let staged_clean = vec!["crates/fg-gate/src/hook.rs".to_string()];

    let valid_msg = r#"feat(core): add clean hook pipeline

[Project]
fractal-git

[Why]
Test hook execution with structured verification.

[Changed]
- Added hook tests

[Verification]
Assert all hook pipeline assertions succeed."#;

    let ctx_sub = HookContext {
        tier: HookTier::SubToCard,
        source_ref: "refs/fractal/cell/cell-01/card/card-02/sub/sub-03",
        target_ref: "refs/fractal/cell/cell-01/card/card-02",
        actor: &actor,
        policy: &policy,
        staged_files: &staged_clean,
        commit_message: Some(valid_msg),
    };

    // SubToCard evaluation should pass
    let verdicts_sub = pipeline
        .evaluate_tier(HookTier::SubToCard, &ctx_sub)
        .unwrap();
    assert!(verdicts_sub.iter().all(|(_, v)| v.is_passing()));
    assert!(pipeline
        .assert_tier_approved(HookTier::SubToCard, &ctx_sub)
        .is_ok());

    // Empty path in staged set triggers hygiene hook block
    let staged_dirty = vec!["".to_string()];
    let ctx_dirty = HookContext {
        tier: HookTier::SubToCard,
        source_ref: "refs/fractal/cell/cell-01/card/card-02/sub/sub-03",
        target_ref: "refs/fractal/cell/cell-01/card/card-02",
        actor: &actor,
        policy: &policy,
        staged_files: &staged_dirty,
        commit_message: Some(valid_msg),
    };
    let verdict_dirty = pipeline.assert_tier_approved(HookTier::SubToCard, &ctx_dirty);
    assert!(
        verdict_dirty.is_err(),
        "Should block commit containing empty path"
    );
}

#[test]
fn test_card_blackboard_and_disk_store() {
    let temp_dir = std::env::temp_dir().join(format!("taxis-test-bb-{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp_dir);
    let _ = fs::create_dir_all(&temp_dir);

    let store = DiskBlackboardStore::new(&temp_dir);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let mut bb = store.load_or_create("card-alpha", "cell-01").unwrap();

    // Agent 1 claims scope A
    let lease1 = bb
        .claim("agent-1", "src/service.rs", "fn process_order", 100, now_ms)
        .unwrap();
    assert_eq!(lease1.agent_uid, "agent-1");

    // Agent 2 claims disjoint scope B in the same file -> SUCCESS
    let lease2 = bb
        .claim("agent-2", "src/service.rs", "fn cancel_order", 100, now_ms)
        .unwrap();
    assert_eq!(lease2.agent_uid, "agent-2");

    // Agent 3 claims colliding scope A -> REJECT with collision details
    let collision = bb
        .claim("agent-3", "src/service.rs", "fn process_order", 100, now_ms)
        .unwrap_err();
    assert_eq!(collision.conflicting_agent, "agent-1");

    // Persist to disk and reload
    store.save(&bb).unwrap();
    let reloaded = store.load_or_create("card-alpha", "cell-01").unwrap();
    assert_eq!(reloaded.active_leases.len(), 2);

    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_mechanical_provenance_store() {
    let temp_dir = std::env::temp_dir().join(format!("taxis-test-prov-{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp_dir);
    let _ = fs::create_dir_all(&temp_dir);

    let store = DiskProvenanceStore::new(&temp_dir);
    let now_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;

    let entry1 = BlockProvenanceEntry::new(BlockProvenanceParams {
        file_path: "crates/fg-gate/src/hook.rs".to_string(),
        block_id: "fn evaluate_tier".to_string(),
        line_span: (10, 25),
        block_hash: Oid::from_bytes([1u8; 20]),
        physical_timestamp_ns: now_ns,
        ccd_generation: 1,
        agent_uid: "agent-infra".to_string(),
        cell_id: "cell-gate".to_string(),
        base_commit: Oid::ZERO,
    });
    let entry2 = BlockProvenanceEntry::new(BlockProvenanceParams {
        file_path: "crates/fg-gate/src/hook.rs".to_string(),
        block_id: "fn assert_tier_approved".to_string(),
        line_span: (30, 45),
        block_hash: Oid::from_bytes([2u8; 20]),
        physical_timestamp_ns: now_ns + 1000,
        ccd_generation: 1,
        agent_uid: "agent-infra".to_string(),
        cell_id: "cell-gate".to_string(),
        base_commit: Oid::ZERO,
    });

    store
        .record_batch(vec![entry1.clone(), entry2.clone()])
        .unwrap();

    let ledger = store.load_or_create().unwrap();
    assert_eq!(ledger.entries.len(), 2);

    let queried = ledger.query_file("crates/fg-gate/src/hook.rs");
    assert_eq!(queried.len(), 2);

    let latest = ledger
        .query_latest_block("crates/fg-gate/src/hook.rs", "fn assert_tier_approved")
        .expect("Should locate block");
    assert_eq!(latest.physical_timestamp_ns, now_ns + 1000);
    assert_eq!(latest.agent_uid, "agent-infra");

    let _ = fs::remove_dir_all(&temp_dir);
}

/// Monotonic counter keeping merge scratch directories unique within one process.
static MERGE_SCRATCH_COUNTER: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[test]
fn test_merge_commit_records_two_ordered_parents() {
    let count = MERGE_SCRATCH_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "taxis_merge_parents_{}_{}",
        std::process::id(),
        count
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create scratch root");
    let git_dir = root.join("repo.git");
    let work_root = root.join("work");
    fs::create_dir_all(&work_root).expect("create work root");
    fs::write(work_root.join("base.txt"), "base\n").expect("write base file");

    let odb = LooseOdb::new(&git_dir);
    let ref_store = DiskRefStore::new(&git_dir);
    let author = GitSignature::new("Merge Tester", "merge@example.com", 1_700_000_000);

    let base = materialize_commit(
        &odb,
        &ref_store,
        &CommitMaterializationRequest {
            files: vec!["base.txt".to_string()],
            work_root: work_root.clone(),
            message: "feat: base".to_string(),
            author: author.clone(),
            target_ref: "refs/heads/main".to_string(),
        },
    )
    .expect("base commit");

    fs::write(work_root.join("ours.txt"), "ours\n").expect("write ours file");
    let ours = materialize_commit(
        &odb,
        &ref_store,
        &CommitMaterializationRequest {
            files: vec!["base.txt".to_string(), "ours.txt".to_string()],
            work_root: work_root.clone(),
            message: "feat: ours".to_string(),
            author: author.clone(),
            target_ref: "refs/heads/main".to_string(),
        },
    )
    .expect("ours commit");
    assert_eq!(ours.parent_oid, Some(base.commit_oid));

    fs::write(work_root.join("theirs.txt"), "theirs\n").expect("write theirs file");
    let theirs = materialize_commit(
        &odb,
        &ref_store,
        &CommitMaterializationRequest {
            files: vec!["base.txt".to_string(), "theirs.txt".to_string()],
            work_root: work_root.clone(),
            message: "feat: theirs".to_string(),
            author: author.clone(),
            target_ref: "refs/heads/topic".to_string(),
        },
    )
    .expect("theirs commit");
    assert!(theirs.parent_oid.is_none());

    let merge = write_commit_objects_with_parents(
        &odb,
        &ref_store,
        &CommitMaterializationRequest {
            files: vec![
                "base.txt".to_string(),
                "ours.txt".to_string(),
                "theirs.txt".to_string(),
            ],
            work_root: work_root.clone(),
            message: "merge: topic into main".to_string(),
            author: author.clone(),
            target_ref: "refs/heads/main".to_string(),
        },
        &[theirs.commit_oid],
    )
    .expect("merge commit objects");
    ref_store
        .update_ref("refs/heads/main", &merge.commit_oid, Some(&ours.commit_oid))
        .expect("advance main to merge");

    // System Git requires a HEAD file and repository config before it will read objects.
    fs::create_dir_all(git_dir.join("refs/heads")).expect("create refs directory");
    fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD file");
    fs::write(
        git_dir.join("config"),
        "[core]\n\trepositoryformatversion = 0\n\tbare = true\n",
    )
    .expect("write repository config");

    // System Git is the independent oracle for parent ordering and ancestry.
    let cat_file = std::process::Command::new("git")
        .arg("--git-dir")
        .arg(&git_dir)
        .args(["cat-file", "-p", &merge.commit_oid.to_hex()])
        .output()
        .expect("run git cat-file");
    assert!(
        cat_file.status.success(),
        "git cat-file failed: {}",
        String::from_utf8_lossy(&cat_file.stderr)
    );
    let commit_text = String::from_utf8_lossy(&cat_file.stdout);
    let parents: Vec<String> = commit_text
        .lines()
        .filter_map(|line| line.strip_prefix("parent "))
        .map(str::to_string)
        .collect();
    let expected_parents = vec![ours.commit_oid.to_hex(), theirs.commit_oid.to_hex()];
    assert_eq!(
        parents, expected_parents,
        "merge commit must declare [ours, theirs] in that order\n{commit_text}"
    );

    for ancestor in [&ours.commit_oid, &theirs.commit_oid] {
        let status = std::process::Command::new("git")
            .arg("--git-dir")
            .arg(&git_dir)
            .args([
                "merge-base",
                "--is-ancestor",
                &ancestor.to_hex(),
                &merge.commit_oid.to_hex(),
            ])
            .status()
            .expect("run git merge-base");
        assert!(
            status.success(),
            "{} must be an ancestor of the merge commit",
            ancestor.to_hex()
        );
    }

    let _ = fs::remove_dir_all(&root);
}

/// Runs one system Git command inside `repo` and returns trimmed stdout.
fn run_git_oracle(repo: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .expect("spawn git oracle");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[test]
fn test_merge_commit_matches_git_merge_oracle() {
    let count = MERGE_SCRATCH_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let repo = std::env::temp_dir().join(format!(
        "taxis_git_merge_oracle_{}_{}",
        std::process::id(),
        count
    ));
    let _ = fs::remove_dir_all(&repo);
    fs::create_dir_all(&repo).expect("create oracle repo");
    run_git_oracle(&repo, &["init", "-b", "main"]);
    run_git_oracle(&repo, &["config", "user.name", "Oracle"]);
    run_git_oracle(&repo, &["config", "user.email", "oracle@example.com"]);
    run_git_oracle(&repo, &["config", "core.autocrlf", "false"]);
    run_git_oracle(&repo, &["config", "core.filemode", "false"]);
    run_git_oracle(&repo, &["config", "commit.gpgsign", "false"]);

    fs::write(repo.join("base.txt"), "base\n").expect("write base file");
    run_git_oracle(&repo, &["add", "base.txt"]);
    run_git_oracle(&repo, &["commit", "-m", "feat: base"]);
    let base_oid = run_git_oracle(&repo, &["rev-parse", "HEAD"]);

    fs::write(repo.join("ours.txt"), "ours\n").expect("write ours file");
    run_git_oracle(&repo, &["add", "ours.txt"]);
    run_git_oracle(&repo, &["commit", "-m", "feat: ours"]);
    let ours_oid = run_git_oracle(&repo, &["rev-parse", "HEAD"]);

    run_git_oracle(&repo, &["checkout", "-b", "topic", base_oid.as_str()]);
    fs::write(repo.join("theirs.txt"), "theirs\n").expect("write theirs file");
    run_git_oracle(&repo, &["add", "theirs.txt"]);
    run_git_oracle(&repo, &["commit", "-m", "feat: theirs"]);
    let theirs_oid = run_git_oracle(&repo, &["rev-parse", "HEAD"]);

    run_git_oracle(&repo, &["checkout", "main"]);
    run_git_oracle(
        &repo,
        &[
            "-c",
            "user.name=Oracle",
            "-c",
            "user.email=oracle@example.com",
            "merge",
            "--no-ff",
            "topic",
            "-m",
            "merge: topic into main",
        ],
    );
    let real_merge_oid = run_git_oracle(&repo, &["rev-parse", "HEAD"]);
    let real_first = run_git_oracle(&repo, &["rev-parse", "HEAD^1"]);
    let real_second = run_git_oracle(&repo, &["rev-parse", "HEAD^2"]);
    let real_tree = run_git_oracle(&repo, &["rev-parse", "HEAD^{tree}"]);
    assert_eq!(real_first, ours_oid);
    assert_eq!(real_second, theirs_oid);

    // Rebuild the very same merge through Taxis plumbing, then compare it with the
    // system Git commit produced by `git merge --no-ff` above.
    let odb = LooseOdb::new(repo.join(".git"));
    let ref_store = DiskRefStore::new(repo.join(".git"));
    let ours = match Oid::from_hex(&ours_oid) {
        Ok(oid) => oid,
        Err(oid_err) => panic!("parse ours oid: {oid_err}"),
    };
    let theirs = match Oid::from_hex(&theirs_oid) {
        Ok(oid) => oid,
        Err(oid_err) => panic!("parse theirs oid: {oid_err}"),
    };
    ref_store
        .update_ref("refs/heads/oracle-ours", &ours, None)
        .expect("seed oracle-ours reference");
    let author = GitSignature::new("Oracle", "oracle@example.com", 1_700_000_000);
    let taxis_merge = write_commit_objects_with_parents(
        &odb,
        &ref_store,
        &CommitMaterializationRequest {
            files: vec![
                "base.txt".to_string(),
                "ours.txt".to_string(),
                "theirs.txt".to_string(),
            ],
            work_root: repo.clone(),
            message: "merge: topic into main".to_string(),
            author,
            target_ref: "refs/heads/oracle-ours".to_string(),
        },
        &[theirs],
    )
    .expect("taxis merge commit objects");
    let taxis_commit_hex = taxis_merge.commit_oid.to_hex();
    let taxis_commit_text = run_git_oracle(&repo, &["cat-file", "-p", taxis_commit_hex.as_str()]);
    let taxis_parents: Vec<String> = taxis_commit_text
        .lines()
        .filter_map(|line| line.strip_prefix("parent "))
        .map(str::to_string)
        .collect();
    assert_eq!(taxis_parents, vec![ours_oid.clone(), theirs_oid.clone()]);
    let tree_expression = format!("{taxis_commit_hex}^{{tree}}");
    let taxis_tree = run_git_oracle(&repo, &["rev-parse", tree_expression.as_str()]);
    assert_eq!(
        taxis_tree, real_tree,
        "Taxis merge tree must equal git merge tree"
    );
    let taxis_tree_body = run_git_oracle(&repo, &["cat-file", "-p", taxis_tree.as_str()]);
    let real_tree_body = run_git_oracle(&repo, &["cat-file", "-p", real_tree.as_str()]);
    assert_eq!(
        taxis_tree_body, real_tree_body,
        "tree payloads must be byte identical to git merge"
    );
    let real_commit_text = run_git_oracle(&repo, &["cat-file", "-p", real_merge_oid.as_str()]);
    assert!(
        real_commit_text.contains(&format!("tree {real_tree}")),
        "git merge commit must reference the synthesized tree\n{real_commit_text}"
    );
    let _ = fs::remove_dir_all(&repo);
}
