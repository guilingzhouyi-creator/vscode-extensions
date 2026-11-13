//! Module: taxis_cmd::remote_sync_push — Local Filesystem Repository Push Transport
//! File Path: src/bin/taxis_cmd/remote_sync_push.rs
//! Architecture Role: Handles offline local filesystem repository push,
//!   validating fast-forward ancestry, updating tracking refs, and publishing objects.
//! Dependencies & Triggers: Dispatched by taxis_cmd::remote during local transport push.
//! Responsibilities: Local repository reference updates and fast-forward ancestry verification.
//! Exit Semantics & Design Rationale:
//!   - Synchronizes references and loose/packed objects deterministically without network overhead.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage engine content-addressable storage guard

use std::collections::HashSet;
use std::path::Path;

use fg_core::models::Oid;
use fg_core::traits::RefStore;
use fg_topology::refs::{DiskRefStore, FractalRef};
use fractal_git::constants::cli::CliTag;
use serde_json::json;

use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::remote_sync::copy_object_store_contents;
use super::repo_view::RepoView;

/// Parameters for a local filesystem repository push.
pub struct LocalPushParams<'a> {
    pub ctx: &'a CliContext,
    pub dest_git_dir: &'a Path,
    pub remote_target: &'a str,
    pub target_url: &'a str,
    pub refspecs: &'a [String],
    pub force: bool,
}

/// Pushes local objects and references to a local filesystem repository (`LocalFile`).
///
/// Publishes both `refs/heads/<branch>` (for standard Git visibility) and
/// `refs/fractal/cell/<cell>/<branch>` (preserving Taxis cell lineage), verifying fast-forward
/// ancestry unless `force` is enabled.
pub fn sync_local_repository_push(params: &LocalPushParams<'_>) {
    let view = match RepoView::open(params.ctx) {
        Ok(opened) => opened,
        Err(open_err) => reject(CliTag::ERROR, format!("open repository view: {open_err}")),
    };

    let (effective_ref, head_oid) = match view.effective_head_commit() {
        Ok(Some(resolved)) => resolved,
        Ok(None) => reject(
            CliTag::ERROR,
            "fatal: HEAD is unborn or repository is empty",
        ),
        Err(head_err) => reject(CliTag::ERROR, format!("read HEAD: {head_err}")),
    };

    let updates = build_push_ref_updates(
        &view,
        &effective_ref,
        head_oid,
        params.refspecs,
        params.force,
    );
    if let Err(io_err) = copy_object_store_contents(
        &view.git_dir().join("objects"),
        &params.dest_git_dir.join("objects"),
    ) {
        reject(
            CliTag::ERROR,
            format!("copy object store during push: {io_err}"),
        );
    }

    let results =
        apply_remote_ref_updates(&view, params.dest_git_dir, params.remote_target, &updates);
    report_push_outcome(params, head_oid, &results);
}

fn build_push_ref_updates(
    view: &RepoView,
    effective_ref: &str,
    head_oid: Oid,
    refspecs: &[String],
    global_force: bool,
) -> Vec<(String, Oid, bool)> {
    if refspecs.is_empty() {
        let branch = extract_branch_short_name(effective_ref);
        let head_ref = format!("refs/heads/{branch}");
        let cell_ref = derive_cell_ref(effective_ref, branch);
        let mut updates = vec![(head_ref.clone(), head_oid, global_force)];
        if cell_ref != head_ref {
            updates.push((cell_ref, head_oid, global_force));
        }
        return updates;
    }

    let mut updates = Vec::new();
    for raw_spec in refspecs {
        let (spec, spec_force) = match raw_spec.strip_prefix('+') {
            Some(stripped) => (stripped, true),
            None => (raw_spec.as_str(), global_force),
        };
        append_single_refspec_updates(
            view,
            effective_ref,
            head_oid,
            spec,
            spec_force,
            &mut updates,
        );
    }
    updates
}

fn append_single_refspec_updates(
    view: &RepoView,
    effective_ref: &str,
    head_oid: Oid,
    spec: &str,
    force: bool,
    updates: &mut Vec<(String, Oid, bool)>,
) {
    if let Some((src, dst)) = spec.split_once(':') {
        let src_oid = resolve_push_source(view, src, head_oid);
        let dst_ref = normalize_dest_ref(dst);
        updates.push((dst_ref.clone(), src_oid, force));
        if let Some(branch) = dst_ref.strip_prefix("refs/heads/") {
            let cell_ref = derive_cell_ref(effective_ref, branch);
            if !updates.iter().any(|(r, _, _)| r == &cell_ref) {
                updates.push((cell_ref, src_oid, force));
            }
        }
        return;
    }

    let src_oid = resolve_push_source(view, spec, head_oid);
    let branch = spec
        .strip_prefix("refs/heads/")
        .unwrap_or_else(|| extract_branch_short_name(spec));
    let head_ref = format!("refs/heads/{branch}");
    let cell_ref = derive_cell_ref(effective_ref, branch);
    updates.push((head_ref, src_oid, force));
    if !updates.iter().any(|(r, _, _)| r == &cell_ref) {
        updates.push((cell_ref, src_oid, force));
    }
}

fn resolve_push_source(view: &RepoView, src: &str, fallback_head: Oid) -> Oid {
    if src.is_empty() || src == "HEAD" || src == "@" {
        return fallback_head;
    }
    if let Ok(oid) = view.resolve(src) {
        return oid;
    }
    reject(
        CliTag::ERROR,
        format!("error: src refspec {src} does not match any"),
    );
}

fn normalize_dest_ref(dst: &str) -> String {
    if dst.starts_with("refs/") {
        dst.to_string()
    } else {
        format!("refs/heads/{dst}")
    }
}

fn extract_branch_short_name(ref_name: &str) -> &str {
    if let Some(b) = ref_name.strip_prefix("refs/heads/") {
        return b;
    }
    ref_name.rsplit('/').next().unwrap_or("main")
}

fn derive_cell_ref(effective_ref: &str, branch: &str) -> String {
    if let Some(fractal) = fractal_git::FractalRef::parse(branch) {
        if !matches!(fractal, fractal_git::FractalRef::SystemTrunk { .. })
            && !fractal.is_telemetry()
        {
            return fractal.to_git_ref();
        }
    }
    if let Some(fractal) = fractal_git::FractalRef::parse(effective_ref) {
        if !matches!(fractal, fractal_git::FractalRef::SystemTrunk { .. })
            && !fractal.is_telemetry()
        {
            return fractal.to_git_ref();
        }
    }
    if let Some(rest) = effective_ref.strip_prefix("refs/fractal/cell/") {
        if let Some((cell_id, _)) = rest.split_once('/') {
            return format!("refs/fractal/cell/{cell_id}/{branch}");
        }
    }
    if let Some(rest) = branch.strip_prefix("cell/") {
        return format!("refs/fractal/cell/{rest}");
    }
    format!(
        "refs/fractal/cell/{}/{branch}",
        fg_core::constants::policy::DEFAULT_CELL_ID
    )
}

fn apply_remote_ref_updates(
    view: &RepoView,
    dest_git_dir: &Path,
    remote_target: &str,
    updates: &[(String, Oid, bool)],
) -> Vec<(String, Result<(), String>)> {
    let dest_store = DiskRefStore::new(dest_git_dir);
    let mut results = Vec::with_capacity(updates.len());
    for (dst_ref, new_oid, force) in updates {
        let existing = match dest_store.get_ref(dst_ref) {
            Ok(val) => val,
            Err(read_err) => {
                results.push((dst_ref.clone(), Err(read_err.to_string())));
                continue;
            }
        };
        if let Some(fractal_ref) = FractalRef::parse(dst_ref) {
            if let Err(policy_err) =
                fractal_ref.verify_telemetry_update_policy(existing, Some(*new_oid), *force)
            {
                results.push((dst_ref.clone(), Err(policy_err.to_string())));
                continue;
            }
        }
        if let Some(old_oid) = existing {
            if old_oid != *new_oid && !*force && !is_ancestor(view, old_oid, *new_oid) {
                results.push((dst_ref.clone(), Err("non-fast-forward".to_string())));
                continue;
            }
        }
        if let Err(update_err) = dest_store.update_ref(dst_ref, new_oid, existing.as_ref()) {
            results.push((dst_ref.clone(), Err(update_err.to_string())));
            continue;
        }
        if let Some(branch) = dst_ref.strip_prefix("refs/heads/") {
            update_local_tracking_ref(view.git_dir(), remote_target, branch, *new_oid);
            ensure_remote_head_resolvable(dest_git_dir, dst_ref);
        }
        results.push((dst_ref.clone(), Ok(())));
    }
    results
}

fn is_ancestor(view: &RepoView, ancestor: Oid, descendant: Oid) -> bool {
    if ancestor == descendant {
        return true;
    }
    let mut visited = HashSet::new();
    let mut stack = vec![descendant];
    while let Some(current) = stack.pop() {
        if current == ancestor {
            return true;
        }
        if !visited.insert(current) {
            continue;
        }
        let Ok(obj) = view.object(&current) else {
            continue;
        };
        let Ok(record) = parse_commit_record(current, &obj.payload) else {
            continue;
        };
        stack.extend(record.parents);
    }
    false
}

fn update_local_tracking_ref(git_dir: &Path, remote_target: &str, branch: &str, oid: Oid) {
    let tracking_file = git_dir
        .join("refs/remotes")
        .join(remote_target)
        .join(branch);
    if let Some(parent) = tracking_file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(tracking_file, format!("{}\n", oid.to_hex()));
}

fn ensure_remote_head_resolvable(dest_git_dir: &Path, pushed_head_ref: &str) {
    let head_path = dest_git_dir.join("HEAD");
    let current_target = std::fs::read_to_string(&head_path)
        .ok()
        .and_then(|s| s.trim().strip_prefix("ref:").map(|t| t.trim().to_string()));
    if let Some(target) = current_target {
        if dest_git_dir.join(&target).is_file() {
            return;
        }
    }
    let _ = std::fs::write(&head_path, format!("ref: {pushed_head_ref}\n"));
}

fn report_push_outcome(
    params: &LocalPushParams<'_>,
    head_oid: Oid,
    results: &[(String, Result<(), String>)],
) {
    let rejected_count = results.iter().filter(|(_, s)| s.is_err()).count();
    if params.ctx.json_mode {
        let reports_json: Vec<serde_json::Value> = results
            .iter()
            .map(|(ref_name, status)| {
                json!({
                    "ref": ref_name,
                    "success": status.is_ok(),
                    "error": status.as_ref().err()
                })
            })
            .collect();
        print_json(&json!({
            "status": if rejected_count == 0 { "ok" } else { "rejected" },
            "transport": "local_file",
            "remote": params.remote_target,
            "url": params.target_url,
            "dry_run": false,
            "reports": reports_json
        }));
    } else {
        println!(
            "Pushing to local_file endpoint '{}' ({})...",
            params.remote_target, params.target_url
        );
        for (ref_name, status) in results {
            match status {
                Ok(()) => println!("  * [pushed] {ref_name} -> {}", head_oid.to_hex()),
                Err(err_msg) => println!("  ! [rejected] {ref_name} ({err_msg})"),
            }
        }
    }

    if rejected_count > 0 {
        reject(
            CliTag::ERROR,
            format!("{rejected_count} reference(s) were rejected by the remote"),
        );
    }
}
