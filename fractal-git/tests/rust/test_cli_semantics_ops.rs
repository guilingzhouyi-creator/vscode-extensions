//! Module: tests::test_cli_semantics_ops — Stash Multi-Slot, Network Transport, and Submodules
//! File Path: tests/rust/test_cli_semantics_ops.rs
//! Architecture Role: Verifies Phase 0.4 fixes for multi-slot `stash` stack, pop conflict preservation,
//!   network transport fail-closed diagnostics, and offline submodule checkout.
//! Dependencies & Triggers: Mounted in `tests/integration_cli.rs` and run by `cargo test --workspace`.
//! Responsibilities: Validate stash slot lifecycle, conflict integrity, and network disabled contracts.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-CLI-001`: CLI exit status and parity contract guard

use std::fs;
use std::path::Path;

use crate::cli_harness::{
    compliant_msg, run_git, run_git_ok, run_taxis, run_taxis_ok, system_git_available,
    test_temp_dir,
};

fn write_file(dir: &Path, rel: &str, body: &str) {
    let full = dir.join(rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("create parent directories");
    }
    fs::write(full, body).expect("write test file");
}

#[test]
fn stash_multislot_stack_and_pop_conflict_keeps_entry() {
    let tmp = test_temp_dir("sem_st_");
    let repo = tmp.path();
    run_taxis_ok(repo, &["init", "--dev"]);
    run_taxis_ok(repo, &["config", "conflict.mode", "git-compat"]);

    write_file(repo, "src/file.txt", "line 1\nbase\nline 3\n");
    run_taxis_ok(repo, &["add", "src/file.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(src): base file", "src/file.txt"),
        ],
    );

    // Slot 1: edit + brand-new staged file -> push must remove src/temp_new.txt from worktree & index
    write_file(repo, "src/file.txt", "line 1\nstash one edit\nline 3\n");
    write_file(repo, "src/temp_new.txt", "staged temp\n");
    run_taxis_ok(repo, &["add", "src/temp_new.txt"]);
    run_taxis_ok(repo, &["stash", "push", "-m", "slot one"]);
    assert!(
        !repo.join("src/temp_new.txt").exists(),
        "stash push must remove newly staged src/temp_new.txt from worktree"
    );

    // Slot 2: edit same line for later pop conflict
    write_file(repo, "src/file.txt", "line 1\nstash two edit\nline 3\n");
    run_taxis_ok(repo, &["stash", "push", "-m", "slot two"]);

    let list_both = run_taxis_ok(repo, &["stash", "list"]);
    assert!(
        list_both.contains("stash@{0}") && list_both.contains("stash@{1}"),
        "stash list must contain multi-slot entries:\n{list_both}"
    );

    // Advance HEAD on the same line so popping stash@{0} produces a real conflict
    write_file(repo, "src/file.txt", "line 1\nupstream edit\nline 3\n");
    run_taxis_ok(repo, &["add", "src/file.txt"]);
    run_taxis_ok(
        repo,
        &[
            "commit",
            "-m",
            &compliant_msg("feat(src): upstream edit", "src/file.txt"),
        ],
    );

    let pop_out = run_taxis(repo, &["stash", "pop"]);
    assert!(
        !pop_out.status.success(),
        "conflicting stash pop must exit non-zero"
    );
    let content = fs::read_to_string(repo.join("src/file.txt")).unwrap();
    assert!(
        content.contains("<<<<<<<") && content.contains(">>>>>>>"),
        "conflicting stash pop must write conflict markers:\n{content}"
    );
    // Stash entry MUST NOT be dropped on conflict
    let list_after_conflict = run_taxis_ok(repo, &["stash", "list"]);
    assert!(
        list_after_conflict.contains("stash@{0}") && list_after_conflict.contains("stash@{1}"),
        "stash pop conflict must keep stash entry intact:\n{list_after_conflict}"
    );

    // Explicitly drop stash@{1} -> only one slot remains
    run_taxis_ok(repo, &["stash", "drop", "stash@{1}"]);
    let list_after_drop = run_taxis_ok(repo, &["stash", "list"]);
    assert!(list_after_drop.contains("stash@{0}"));
    assert!(!list_after_drop.contains("stash@{1}"));
}

#[test]
fn network_commands_and_submodule_update_contracts() {
    let tmp = test_temp_dir("sem_ns_");
    let root = tmp.path();

    // 1. Network transport commands return structured JSON with `fallback_hint` and exit 69
    let net_repo = root.join("net-repo");
    run_taxis_ok(root, &["init", "net-repo"]);
    run_taxis_ok(
        &net_repo,
        &["remote", "add", "net", "https://example.invalid/x.git"],
    );

    for args in [
        vec!["push", "--json", "-u", "net", "main"],
        vec!["fetch", "--json", "net"],
        vec!["pull", "--json", "net"],
        vec!["clone", "--json", "https://example.invalid/x.git", "dst"],
    ] {
        let out = run_taxis(&net_repo, &args);
        assert_eq!(
            out.status.code(),
            Some(69),
            "expected EXIT_UNAVAILABLE(69) for {:?}, got {:?}",
            args,
            out.status.code()
        );
        let parsed: serde_json::Value = serde_json::from_slice(&out.stdout).expect("valid json");
        assert_eq!(parsed["status"], "unavailable");
        assert_eq!(parsed["capability"], "network_transport");
        assert!(
            parsed["fallback_hint"]
                .as_str()
                .is_some_and(|s| !s.is_empty()),
            "missing fallback_hint in JSON for {:?}: {}",
            args,
            String::from_utf8_lossy(&out.stdout)
        );
    }

    // 2. Network submodule URL fails closed (never silent empty dir success!)
    let sub_net = root.join("sub-net");
    run_taxis_ok(root, &["init", "sub-net"]);
    write_file(
        &sub_net,
        ".gitmodules",
        "[submodule \"vendor/ext\"]\n\tpath = vendor/ext\n\turl = https://example.invalid/ext.git\n",
    );
    let sub_fail = run_taxis(&sub_net, &["submodule", "update", "--json", "--init"]);
    assert_eq!(sub_fail.status.code(), Some(69));
    let sub_json: serde_json::Value =
        serde_json::from_slice(&sub_fail.stdout).expect("submodule unavailable json");
    assert_eq!(sub_json["status"], "unavailable");
    assert!(sub_json["fallback_hint"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));

    // 3. Local offline submodule checks out exact gitlink OID (pinned before source moves ahead)
    if system_git_available() {
        let sub_src = root.join("sub_src");
        fs::create_dir_all(&sub_src).expect("mkdir sub_src");
        let _ = run_git_ok(&sub_src, &["-c", "core.longpaths=true", "init", "-q", "."]);
        write_file(&sub_src, "mod.txt", "pinned-v1\n");
        let _ = run_git(&sub_src, &["-c", "core.longpaths=true", "add", "mod.txt"]);
        let _ = run_git(
            &sub_src,
            &["-c", "core.longpaths=true", "commit", "-q", "-m", "sub v1"],
        );
        let pinned_oid = run_git_ok(&sub_src, &["rev-parse", "HEAD"]);

        write_file(&sub_src, "mod.txt", "newer-v2\n");
        let _ = run_git(&sub_src, &["-c", "core.longpaths=true", "add", "mod.txt"]);
        let _ = run_git(
            &sub_src,
            &["-c", "core.longpaths=true", "commit", "-q", "-m", "sub v2"],
        );

        let parent = root.join("parent");
        fs::create_dir_all(&parent).expect("mkdir parent");
        let _ = run_git_ok(&parent, &["-c", "core.longpaths=true", "init", "-q", "."]);
        write_file(
            &parent,
            ".gitmodules",
            &format!(
                "[submodule \"vendor/mod\"]\n\tpath = vendor/mod\n\turl = {}\n",
                sub_src.to_string_lossy().replace('\\', "/")
            ),
        );
        let _ = run_git(
            &parent,
            &["-c", "core.longpaths=true", "add", ".gitmodules"],
        );
        let cacheinfo = format!("160000,{pinned_oid},vendor/mod");
        let _ = run_git_ok(
            &parent,
            &["update-index", "--add", "--cacheinfo", &cacheinfo],
        );
        let _ = run_git_ok(
            &parent,
            &["-c", "core.longpaths=true", "commit", "-q", "-m", "pin sub"],
        );

        run_taxis_ok(&parent, &["submodule", "update", "--init"]);
        assert_eq!(
            fs::read_to_string(parent.join("vendor/mod/mod.txt")).expect("read submodule file"),
            "pinned-v1\n"
        );
        assert_eq!(
            run_taxis_ok(&parent.join("vendor/mod"), &["rev-parse", "HEAD"]),
            pinned_oid
        );
    }
}
