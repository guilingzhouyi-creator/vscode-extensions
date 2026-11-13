//! Module: fg-storage — Native <-> Git Reference Projection
//! File Path: crates/fg-storage/src/projection/refs.rs
//! Architecture Role: Bidirectional reference projection between native `RefsSection` / loose
//!   cell refs and `.git/refs/` + `packed-refs`.
//! Dependencies & Triggers: Internal submodule of `fg-storage::projection`.
//! Responsibilities: Export native and cell references to `.git/refs/heads/*`, parse Git
//!   `packed-refs`, and recursively scan loose refs into `RefsSection`.
//! Exit Semantics & Design Rationale: Propagates I/O failures via `FractalResult`; invalid
//!   hex reference payloads are skipped during scanning to tolerate partial worktrees.
//!
//! Domain Governance Rules: FGT-STO-001, FGT-OBJ-001.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use fg_core::error::FractalResult;
use fg_core::models::Oid;
use fg_native::sections::refs::{RefRecord, RefsSection};

/// Writes all native references into `.git/refs/` hierarchy, projecting cell branches to `refs/heads/`.
pub(super) fn write_git_refs(
    native_dir: &Path,
    git_dir: &Path,
    refs: &RefsSection,
) -> FractalResult<usize> {
    let mut written = BTreeSet::new();
    let mut projected_heads: Vec<(String, Oid)> = Vec::new();

    for record in refs.records() {
        write_single_git_ref(git_dir, &record.name, &record.oid, &mut written)?;
        collect_projected_cell_branch(&record.name, record.oid, &mut projected_heads);
    }

    let refs_dir = native_dir.join("refs");
    if refs_dir.is_dir() {
        let mut disk_refs = RefsSection::new();
        let _ = collect_loose_refs_recursive(&refs_dir, &refs_dir, &mut disk_refs);
        for record in disk_refs.records() {
            write_single_git_ref(git_dir, &record.name, &record.oid, &mut written)?;
            collect_projected_cell_branch(&record.name, record.oid, &mut projected_heads);
        }
    }

    for (head_ref, oid) in projected_heads {
        write_single_git_ref(git_dir, &head_ref, &oid, &mut written)?;
    }

    Ok(written.len())
}

fn write_single_git_ref(
    git_dir: &Path,
    ref_name: &str,
    oid: &Oid,
    written: &mut BTreeSet<String>,
) -> FractalResult<()> {
    let dest = git_dir.join(ref_name);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&dest, format!("{}\n", oid.to_hex()))?;
    written.insert(ref_name.to_string());
    Ok(())
}

fn collect_projected_cell_branch(ref_name: &str, oid: Oid, out: &mut Vec<(String, Oid)>) {
    if let Some(rest) = ref_name.strip_prefix("refs/fractal/cell/") {
        if let Some((_cell, branch)) = rest.split_once('/') {
            if !branch.is_empty() {
                out.push((format!("refs/heads/{branch}"), oid));
            }
        }
    }
}

/// Ingests Git references from `packed-refs` and loose `refs/` directory.
pub(super) fn import_git_refs(git_dir: &Path) -> FractalResult<RefsSection> {
    let mut refs = RefsSection::new();
    let packed_path = git_dir.join("packed-refs");
    if packed_path.is_file() {
        let packed_refs = parse_packed_refs(&packed_path);
        for (name, oid, peeled) in packed_refs {
            let _ = refs.upsert(RefRecord { name, oid, peeled });
        }
    }

    let refs_dir = git_dir.join("refs");
    if refs_dir.is_dir() {
        collect_loose_refs_recursive(&refs_dir, &refs_dir, &mut refs)?;
    }
    Ok(refs)
}

/// Parses Git `packed-refs` file preserving peeled tag associations.
fn parse_packed_refs(path: &Path) -> Vec<(String, Oid, Option<Oid>)> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut entries: Vec<(String, Oid, Option<Oid>)> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(peeled_hex) = trimmed.strip_prefix('^') {
            if let Ok(peeled_oid) = Oid::from_hex(peeled_hex.trim()) {
                if let Some(last) = entries.last_mut() {
                    last.2 = Some(peeled_oid);
                }
            }
            continue;
        }
        if let Some((hex, name)) = trimmed.split_once(' ') {
            if let Ok(oid) = Oid::from_hex(hex.trim()) {
                entries.push((name.trim().to_string(), oid, None));
            }
        }
    }
    entries
}

/// Recursively scans loose reference files into a `RefsSection`.
fn collect_loose_refs_recursive(
    base_refs_dir: &Path,
    current_dir: &Path,
    refs: &mut RefsSection,
) -> FractalResult<()> {
    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_loose_refs_recursive(base_refs_dir, &entry_path, refs)?;
        } else if entry_path.is_file() {
            let Ok(relative) =
                entry_path.strip_prefix(base_refs_dir.parent().unwrap_or(base_refs_dir))
            else {
                continue;
            };
            let ref_name = relative.to_string_lossy().replace('\\', "/");
            let Ok(content) = fs::read_to_string(&entry_path) else {
                continue;
            };
            let trimmed = content.trim();
            if let Ok(oid) = Oid::from_hex(trimmed) {
                let _ = refs.upsert(RefRecord {
                    name: ref_name,
                    oid,
                    peeled: None,
                });
            }
        }
    }
    Ok(())
}
