//! Module: taxis_cmd::doctor — Repository Health Inspection
//! File Path: src/bin/taxis_cmd/doctor.rs
//! Architecture Role: Cross-checks the declared repository metadata against the physical filesystem
//!   and reports every mismatch instead of stopping at the first one.
//! Dependencies & Triggers: Dispatched by `taxis doctor`; reads the container and the workspace entry.
//! Responsibilities: Classify the workspace entry, compare it with `META.layout_mode`, verify the
//!   container decodes and every section re-encodes, and confirm the guard file and hidden attribute.
//! Exit Semantics & Design Rationale:
//!   - Classification goes through `symlink_metadata`, not `Path::exists`. On Windows an orphaned
//!     junction reports as an existing path while every child path reports as absent, so an existence
//!     check cannot tell "store deleted" apart from "repository deleted", and those need different
//!     repairs.
//!   - Every finding is collected before reporting. Stopping at the first mismatch would make the
//!     operator re-run the command once per defect.
//!   - The guard file and the hidden attribute are repaired, because both are derivable from the
//!     format and neither carries user data. Anything that would rewrite a section is reported only:
//!     silently repairing a section could discard the very records the operator is trying to recover.
//!   - The command is idempotent. A second run over a healthy repository reports no repairs.

use std::path::Path;

use fg_native::{LayoutMode, PhysicalLayout, RepoDocument};

use super::common::{print_json, CliContext};
use fractal_git::constants::cli::CliTag;

/// One inspection outcome.
struct Finding {
    check: &'static str,
    status: &'static str,
    detail: String,
}

/// Dispatches `taxis doctor`.
pub fn handle_doctor(ctx: &CliContext) {
    let workspace_root = match resolve_workspace_root(ctx) {
        Ok(root) => root,
        Err(resolve_err) => {
            eprintln!("{} {}", CliTag::ERROR, resolve_err);
            std::process::exit(super::common::EXIT_REJECTED);
        }
    };

    let findings = inspect(&workspace_root);
    let failures = findings
        .iter()
        .filter(|finding| finding.status == "FAIL")
        .count();

    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "doctor",
            "workspace_root": workspace_root.display().to_string(),
            "healthy": failures == 0,
            "findings": findings
                .iter()
                .map(|finding| serde_json::json!({
                    "check": finding.check,
                    "status": finding.status,
                    "detail": finding.detail,
                }))
                .collect::<Vec<serde_json::Value>>(),
        });
        print_json(&payload);
    } else {
        println!("=== Taxis Repository Doctor ===");
        println!("  Workspace: {}", workspace_root.display());
        for finding in &findings {
            println!(
                "  [{:4}] {:<26} {}",
                finding.status, finding.check, finding.detail
            );
        }
        if failures == 0 {
            println!("\n  Result: healthy ({} checks)", findings.len());
        } else {
            println!(
                "\n  Result: {} of {} checks failed",
                failures,
                findings.len()
            );
        }
    }

    if failures > 0 {
        std::process::exit(super::common::EXIT_REJECTED);
    }
}

/// Resolves the workspace to inspect from `--workspace <dir>` or the current directory.
fn resolve_workspace_root(ctx: &CliContext) -> Result<std::path::PathBuf, String> {
    let mut argument_cursor = 0;
    while argument_cursor < ctx.args.len() {
        if ctx.args[argument_cursor] == "--workspace" {
            let value = ctx
                .args
                .get(argument_cursor + 1)
                .ok_or_else(|| "--workspace requires a directory path".to_owned())?;
            return Ok(std::path::PathBuf::from(value));
        }
        argument_cursor += 1;
    }

    std::env::current_dir().map_err(|cwd_err| format!("resolve the current directory: {cwd_err}"))
}

/// Runs every check and returns the complete finding list.
fn inspect(workspace_root: &Path) -> Vec<Finding> {
    let mut findings = Vec::new();

    let layout = match fg_native::classify_workspace_entry(workspace_root) {
        Ok(classified) => classified,
        Err(classify_err) => {
            findings.push(Finding {
                check: "workspace entry",
                status: "FAIL",
                detail: format!("cannot classify: {classify_err}"),
            });
            return findings;
        }
    };

    let repo_dir = match resolve_repo_dir(workspace_root, &layout, &mut findings) {
        Some(resolved) => resolved,
        None => return findings,
    };

    let container_path = fg_native::container_path(&repo_dir);
    let document = match RepoDocument::load(&container_path) {
        Ok(loaded) => {
            findings.push(Finding {
                check: "container decode",
                status: "PASS",
                detail: container_path.display().to_string(),
            });
            Some(loaded)
        }
        Err(load_err) => {
            findings.push(Finding {
                check: "container decode",
                status: "FAIL",
                detail: format!("{}: {load_err}", container_path.display()),
            });
            None
        }
    };

    if let Some(ref loaded) = document {
        check_layout_matches_metadata(loaded.meta.layout_mode, &layout, &mut findings);
        check_sections(loaded, &mut findings);
    }

    check_guard_file(&repo_dir, &mut findings);
    check_policy_vault(&repo_dir, &mut findings);
    check_legacy_branches(&repo_dir, &mut findings);
    check_hidden(&repo_dir, &mut findings);

    findings
}

/// Resolves the directory holding the repository bytes from the classified layout.
fn resolve_repo_dir(
    workspace_root: &Path,
    layout: &PhysicalLayout,
    findings: &mut Vec<Finding>,
) -> Option<std::path::PathBuf> {
    match layout {
        PhysicalLayout::Directory => {
            findings.push(Finding {
                check: "workspace entry",
                status: "PASS",
                detail: "real directory".to_owned(),
            });
            Some(workspace_root.join(fg_native::WORKSPACE_DIR_NAME))
        }
        PhysicalLayout::Linked { target } => {
            findings.push(Finding {
                check: "workspace entry",
                status: "PASS",
                detail: format!("link to '{}'", target.display()),
            });
            Some(target.clone())
        }
        PhysicalLayout::OrphanedLink { target } => {
            findings.push(Finding {
                check: "workspace entry",
                status: "FAIL",
                detail: format!(
                    "link target '{}' is missing; restore the store or re-run `taxis init`",
                    target.display()
                ),
            });
            None
        }
        PhysicalLayout::Absent => {
            findings.push(Finding {
                check: "workspace entry",
                status: "FAIL",
                detail: "no '.taxis' entry; run `taxis init` first".to_owned(),
            });
            None
        }
    }
}

/// Compares the declared layout mode with the physical layout.
fn check_layout_matches_metadata(
    declared: LayoutMode,
    physical: &PhysicalLayout,
    findings: &mut Vec<Finding>,
) {
    let matches = matches!(
        (declared, physical),
        (LayoutMode::Dev, PhysicalLayout::Directory)
            | (LayoutMode::Release, PhysicalLayout::Linked { .. })
    );

    findings.push(Finding {
        check: "layout mode",
        status: if matches { "PASS" } else { "FAIL" },
        detail: if matches {
            format!("declared {declared:?} matches the physical layout")
        } else {
            format!("declared {declared:?} disagrees with {physical:?}")
        },
    });
}

/// Re-encodes every section, which surfaces damage the decoder tolerates.
fn check_sections(document: &RepoDocument, findings: &mut Vec<Finding>) {
    let diagnoses = document.diagnose();
    if diagnoses.is_empty() {
        findings.push(Finding {
            check: "section integrity",
            status: "PASS",
            detail: "every section re-encodes".to_owned(),
        });
    } else {
        findings.push(Finding {
            check: "section integrity",
            status: "FAIL",
            detail: diagnoses.join("; "),
        });
    }
}

/// Verifies the guard file, rewriting it when it is absent or wrong.
fn check_guard_file(repo_dir: &Path, findings: &mut Vec<Finding>) {
    let observed = fg_native::read_guard_file(repo_dir);
    let needs_repair = match observed {
        Ok(Some(ref contents)) => contents != fg_native::GUARD_FILE_CONTENT,
        Ok(None) => true,
        Err(_) => true,
    };

    if !needs_repair {
        findings.push(Finding {
            check: "guard file",
            status: "PASS",
            detail: "present and correct".to_owned(),
        });
        return;
    }

    match fg_native::write_guard_file(repo_dir) {
        Ok(()) => findings.push(Finding {
            check: "guard file",
            status: "WARN",
            detail: "was missing or wrong; rewritten".to_owned(),
        }),
        Err(write_err) => findings.push(Finding {
            check: "guard file",
            status: "FAIL",
            detail: format!("cannot rewrite: {write_err}"),
        }),
    }
}

/// Verifies presence and HMAC-SM3 integrity of hidden `.taxis-policy.txp` without auto-recreating.
fn check_policy_vault(repo_dir: &Path, findings: &mut Vec<Finding>) {
    match fg_topology::PolicyVaultStore::load_state(repo_dir) {
        fg_topology::PolicyVaultState::Sealed(loaded) => {
            findings.push(Finding {
                check: "policy vault",
                status: "PASS",
                detail: format!(
                    "verified TXPF v1 (rev={}, branch_tier={}, commit_tier={:?}, locked={})",
                    loaded.payload.revision,
                    loaded.payload.branch_floor,
                    loaded.payload.commit_floor,
                    loaded.payload.locked_by_authority
                ),
            });
        }
        fg_topology::PolicyVaultState::MissingAfterInit { expected_path, .. } => {
            findings.push(Finding {
                check: "policy vault",
                status: "FAIL",
                detail: format!(
                    "hidden policy vault '{}' was removed; run 'taxis policy init' to regenerate and configure",
                    expected_path.display()
                ),
            });
        }
        fg_topology::PolicyVaultState::TamperedOrCorrupt { path, reason } => {
            findings.push(Finding {
                check: "policy vault",
                status: "FAIL",
                detail: format!(
                    "policy vault '{}' failed integrity verification ({reason}); recover via 'taxis policy init'",
                    path.display()
                ),
            });
        }
        fg_topology::PolicyVaultState::UninitializedExternal => {
            findings.push(Finding {
                check: "policy vault",
                status: "FAIL",
                detail: "policy vault not sealed for initialized store; run 'taxis policy init'"
                    .to_owned(),
            });
        }
    }
}

/// Audits local branch refs against the repository's 5-tier taxonomy and D/F `/main` rule.
fn check_legacy_branches(repo_dir: &Path, findings: &mut Vec<Finding>) {
    let floor = fg_gate::BranchGovernanceFloor::resolve(repo_dir);
    let Ok(all_refs) = fg_topology::DiskRefStore::new(repo_dir).list_all() else {
        return;
    };
    let mut legacy_cards = Vec::new();
    let mut non_canonical = Vec::new();
    for (full_ref, _) in all_refs {
        let Some(short) = full_ref.strip_prefix("refs/heads/") else {
            continue;
        };
        if fg_topology::FractalRef::is_predecessor_card_ref(&full_ref) {
            legacy_cards.push(short.to_owned());
        }
        if fg_topology::FractalRef::from_git_ref_checked(&full_ref, &floor.spec, false).is_err() {
            non_canonical.push(short.to_owned());
        }
    }
    if legacy_cards.is_empty() && non_canonical.is_empty() {
        findings.push(Finding {
            check: "branch taxonomy",
            status: "PASS",
            detail: "all local branches conform to 5-tier canonical naming".to_owned(),
        });
    } else {
        findings.push(Finding {
            check: "branch taxonomy",
            status: "WARN",
            detail: format!(
                "{} non-canonical/legacy branch(es): {}; run 'taxis branch migrate' or 'taxis branch -m'",
                non_canonical.len(),
                non_canonical.join(", ")
            ),
        });
    }
}

/// Reports the hidden attribute; a missing attribute is repaired where the platform supports it.
fn check_hidden(repo_dir: &Path, findings: &mut Vec<Finding>) {
    match fg_native::is_directory_hidden(repo_dir) {
        Ok(true) => findings.push(Finding {
            check: "hidden attribute",
            status: "PASS",
            detail: "hidden".to_owned(),
        }),
        Ok(false) => match fg_native::hide_directory(repo_dir) {
            Ok(()) => findings.push(Finding {
                check: "hidden attribute",
                status: "WARN",
                detail: "was not hidden; hidden now".to_owned(),
            }),
            Err(hide_err) => findings.push(Finding {
                check: "hidden attribute",
                status: "WARN",
                detail: format!("not hidden and cannot be set: {hide_err}"),
            }),
        },
        Err(read_err) => findings.push(Finding {
            check: "hidden attribute",
            status: "WARN",
            detail: format!("cannot read attributes: {read_err}"),
        }),
    }
}
