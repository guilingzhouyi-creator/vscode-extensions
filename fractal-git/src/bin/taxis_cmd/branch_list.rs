//! Module: taxis_cmd::branch_list — Local and Remote-Tracking Branch Listing
//! File Path: src/bin/taxis_cmd/branch_list.rs
//! Architecture Role: Renders `taxis branch` listings over local heads and `refs/remotes/*`,
//!   honoring `-a`/`--all`, `-r`/`--remotes`, and `-v`/`-vv` verbosity.
//! Dependencies & Triggers: Called by `taxis_cmd::branch` when no mutating option is given.
//! Responsibilities: Collect branch rows with HEAD (`*`) and linked-worktree (`+`) markers, align
//!   verbose rows with short object ids, upstream tracking, and commit subjects, and emit JSON.
//! Exit Semantics & Design Rationale:
//!   - Plain `taxis branch` output stays byte-identical to `git branch`; remote rows appear only
//!     when `-a` or `-r` asks for them, using Git's `remotes/<r>/<b>` and `<r>/<b>` labels.
//!   - Symbolic `refs/remotes/<r>/HEAD` entries are skipped because Git lists them as aliases.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-GAT-001`: Fractal Git domain gate guard

use fg_index::config::{read_config, ConfigEntry};
use fractal_git::constants::cli::CliTag;
use fractal_git::{DiskRefStore, Oid};

use super::commit_walk::parse_commit_record;
use super::common::{print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Listing switches parsed from `taxis branch` arguments.
pub(crate) struct ListingOptions {
    pub(crate) all: bool,
    pub(crate) remotes: bool,
    pub(crate) tree: bool,
    pub(crate) verbosity: u8,
}

/// One resolved branch row for listing (`local` or `refs/remotes/*`).
struct ListedBranchRow {
    label: String,
    marker: char,
    oid: Option<Oid>,
    local_name: Option<String>,
    is_remote: bool,
}

/// Prints local and/or remote-tracking branches honoring `-a`, `-r`, and `-v`/`-vv`.
pub(crate) fn list_branches_with_options(view: &RepoView, opts: &ListingOptions, ctx: &CliContext) {
    let current = match view.head_branch() {
        Ok(state) => state,
        Err(head_err) => reject(CliTag::ERROR, head_err),
    };
    let unborn = current
        .as_ref()
        .filter(|(_, target)| target.is_none())
        .map(|(name, _)| name.clone());
    let listed = match view.branches() {
        Ok(branches) => branches,
        Err(list_err) => reject(CliTag::ERROR, list_err),
    };
    let elsewhere: Vec<String> = view.linked_worktree_branches();
    let include_local = !opts.remotes || opts.all;
    let include_remotes = opts.all || opts.remotes;

    let mut rows: Vec<ListedBranchRow> = Vec::new();
    if include_local {
        let mut local_rows: Vec<ListedBranchRow> = listed
            .iter()
            .map(|(name, oid)| {
                let marker = if current.as_ref().is_some_and(|(head, _)| head == name) {
                    '*'
                } else if elsewhere.contains(name) {
                    '+'
                } else {
                    ' '
                };
                ListedBranchRow {
                    label: name.clone(),
                    marker,
                    oid: Some(*oid),
                    local_name: Some(name.clone()),
                    is_remote: false,
                }
            })
            .collect();
        if let Some(name) = unborn {
            local_rows.push(ListedBranchRow {
                label: name.clone(),
                marker: '*',
                oid: None,
                local_name: Some(name),
                is_remote: false,
            });
            local_rows.sort_by(|left, right| left.label.cmp(&right.label));
        }
        rows.extend(local_rows);
    }

    if include_remotes {
        let mut remote_rows = collect_remote_branch_rows(view, opts.all);
        rows.append(&mut remote_rows);
    }

    if ctx.json_mode {
        emit_branch_list_json(view, &rows, opts.verbosity, &current);
        return;
    }

    if opts.tree {
        print_fractal_tree(view, &rows);
        return;
    }

    if opts.verbosity == 0 {
        for row in &rows {
            println!("{} {}", row.marker, row.label);
        }
        return;
    }

    let max_width = rows.iter().map(|r| r.label.len()).max().unwrap_or(0);
    let config_entries = if opts.verbosity >= 2 {
        read_config(&view.git_dir().join("config")).unwrap_or_default()
    } else {
        Vec::new()
    };
    for row in &rows {
        print_verbose_branch_row(view, &config_entries, row, max_width, opts.verbosity);
    }
}

/// Collects sorted remote-tracking branches under `refs/remotes/`.
fn collect_remote_branch_rows(
    view: &RepoView,
    include_remotes_prefix: bool,
) -> Vec<ListedBranchRow> {
    let all_refs = DiskRefStore::new(view.git_dir())
        .list_all()
        .unwrap_or_default();
    let mut rows: Vec<ListedBranchRow> = all_refs
        .into_iter()
        .filter_map(|(ref_name, oid)| {
            let short_remote = ref_name.strip_prefix("refs/remotes/")?;
            if short_remote.ends_with("/HEAD") || short_remote == "HEAD" {
                return None;
            }
            let label = if include_remotes_prefix {
                format!("remotes/{short_remote}")
            } else {
                short_remote.to_string()
            };
            Some(ListedBranchRow {
                label,
                marker: ' ',
                oid: Some(oid),
                local_name: None,
                is_remote: true,
            })
        })
        .collect();
    rows.sort_by(|left, right| left.label.cmp(&right.label));
    rows
}

/// Emits machine-readable JSON output for `taxis branch`.
fn emit_branch_list_json(
    view: &RepoView,
    rows: &[ListedBranchRow],
    verbosity: u8,
    current: &Option<(String, Option<Oid>)>,
) {
    let rendered: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let mut branch_json = serde_json::json!({
                "name": row.label,
                "oid": row.oid.map(|o| o.to_hex()),
                "current": !row.is_remote
                    && current
                        .as_ref()
                        .is_some_and(|(head, _)| head == &row.label),
                "remote": row.is_remote,
            });
            if verbosity >= 1 {
                if let Some(oid) = row.oid {
                    if let Some(subject) = read_commit_subject(view, &oid) {
                        if let Some(map) = branch_json.as_object_mut() {
                            map.insert("subject".to_string(), serde_json::json!(subject));
                        }
                    }
                }
            }
            branch_json
        })
        .collect();
    print_json(&serde_json::json!({
        "engine": "taxis",
        "operation": "branch",
        "branch_count": rendered.len(),
        "branches": rendered,
    }));
}

/// Prints one aligned `-v` or `-vv` branch row to stdout.
fn print_verbose_branch_row(
    view: &RepoView,
    config_entries: &[ConfigEntry],
    row: &ListedBranchRow,
    max_width: usize,
    verbosity: u8,
) {
    let Some(oid) = row.oid else {
        println!(
            "{} {:width$} [unborn]",
            row.marker,
            row.label,
            width = max_width
        );
        return;
    };
    let short_hex = &oid.to_hex()[..7];
    let subject = read_commit_subject(view, &oid).unwrap_or_default();
    let tracking = if verbosity >= 2 {
        row.local_name
            .as_deref()
            .and_then(|name| lookup_upstream_tracking(config_entries, name))
            .map(|upstream| format!(" [{upstream}]"))
            .unwrap_or_default()
    } else {
        String::new()
    };
    println!(
        "{} {:width$} {short_hex}{tracking} {subject}",
        row.marker,
        row.label,
        width = max_width
    );
}

/// Reads the commit summary line for `oid`.
fn read_commit_subject(view: &RepoView, oid: &Oid) -> Option<String> {
    let commit_obj = view.object(oid).ok()?;
    let rec = parse_commit_record(*oid, &commit_obj.payload).ok()?;
    let first = rec.message.lines().next().unwrap_or("").trim();
    Some(first.to_string())
}

/// Renders an indented fractal topology tree view for `taxis branch --tree`.
fn print_fractal_tree(view: &RepoView, rows: &[ListedBranchRow]) {
    let floor = fg_gate::BranchGovernanceFloor::resolve(view.git_dir());
    println!(
        "Fractal Branch Topology (branch-policy: {})",
        floor.tier.as_str()
    );
    for row in rows {
        if row.is_remote {
            println!("{} [remote] {}", row.marker, row.label);
            continue;
        }
        let parsed = fractal_git::FractalRef::parse(&row.label);
        let (indent, tier_tag) = match parsed {
            Some(ref r) => {
                let depth = usize::from(r.tier());
                let legacy = if fractal_git::FractalRef::is_predecessor_card_ref(&row.label) {
                    " [LEGACY-4SEG]"
                } else {
                    ""
                };
                ("  ".repeat(depth), format!("[Tier {}{legacy}]", r.tier()))
            }
            None if floor.spec.is_allowed_facade(&row.label) => {
                ("      ".to_string(), "[Facade]".to_string())
            }
            None => ("  ".to_string(), "[Uncategorized]".to_string()),
        };
        let short_oid = row
            .oid
            .map(|o| format!(" {}", &o.to_hex()[..7]))
            .unwrap_or_else(|| " [unborn]".to_string());
        println!("{} {indent}{tier_tag} {}{short_oid}", row.marker, row.label);
    }
}

/// Resolves configured upstream `<remote>/<branch>` from `branch.<name>.{remote,merge}`.
fn lookup_upstream_tracking(entries: &[ConfigEntry], branch: &str) -> Option<String> {
    let mut remote_name: Option<&str> = None;
    let mut merge_ref: Option<&str> = None;
    for entry in entries {
        let key = entry.key();
        if key.section() == "branch" && key.subsection() == Some(branch) {
            if key.name() == "remote" {
                remote_name = entry.value();
            } else if key.name() == "merge" {
                merge_ref = entry.value();
            }
        }
    }
    let remote = remote_name?;
    let merge = merge_ref?;
    let short_merge = merge.strip_prefix("refs/heads/").unwrap_or(merge);
    Some(format!("{remote}/{short_merge}"))
}
