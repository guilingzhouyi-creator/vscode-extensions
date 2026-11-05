//! Module: taxis_cmd::path_filter — Pathspec Disambiguation & Filter Operator
//! File Path: src/bin/taxis_cmd/path_filter.rs
//! Architecture Role: Disambiguates CLI arguments at '--' boundaries and filters commits,
//!   diff comparisons, and revision listings by file and directory pathspecs.
//! Dependencies & Triggers: Consumed by taxis diff, log, and rev-list.
//! Responsibilities: CLI pathspec separation, prefix and exact path matching, and tree path resolution.
//! Exit Semantics & Design Rationale:
//!   - Separates flags from paths at '--' according to Git CLI standard conventions.
//!   - Supports exact path matching and directory prefix matching without allocations.
//!   - Compares path-level OIDs across commit trees to filter history with O(1) negative short-circuits.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Algorithmic performance and differential parity guard
//! - `FGT-PRF-001`: Zero-allocation tight loop and boundary contract guard

use fg_core::error::FractalResult;
use fg_core::models::Oid;
use fg_object::GitTreeRef;

use super::commit_walk::CommitRecord;
use super::repo_view::RepoView;

/// Splits a CLI argument slice at the first '--' delimiter into (arguments, pathspecs).
/// If no '--' is present, all arguments are returned in the first vector and pathspecs are empty.
pub fn split_args_at_dashdash(arguments: &[String]) -> (Vec<String>, Vec<String>) {
    if let Some(separator_index) = arguments.iter().position(|arg| arg == "--") {
        let options = arguments[..separator_index].to_vec();
        let pathspecs = arguments[separator_index + 1..].to_vec();
        (options, pathspecs)
    } else {
        (arguments.to_vec(), Vec::new())
    }
}

/// Evaluates whether a candidate file path matches any of the provided pathspecs.
/// Returns `true` if `pathspecs` is empty, or if `candidate_path` matches at least one pathspec.
pub fn matches_any_pathspec(candidate_path: &str, pathspecs: &[String]) -> bool {
    if pathspecs.is_empty() {
        return true;
    }
    let normalized_candidate = candidate_path.trim_start_matches("./");
    for raw_spec in pathspecs {
        let clean_spec = raw_spec.trim_start_matches("./").trim_end_matches('/');
        if clean_spec.is_empty() {
            return true;
        }
        if normalized_candidate == clean_spec {
            return true;
        }
        if normalized_candidate.starts_with(clean_spec) {
            let remaining_slice = &normalized_candidate[clean_spec.len()..];
            if remaining_slice.starts_with('/') {
                return true;
            }
        }
    }
    false
}

/// Resolves a path within a tree object to its object ID.
/// Returns `None` if the path or any intermediate subtree does not exist.
pub fn resolve_path_in_tree(
    view: &RepoView,
    root_tree_oid: &Oid,
    target_path: &str,
) -> Option<Oid> {
    let clean_path = target_path.trim_start_matches("./").trim_matches('/');
    if clean_path.is_empty() {
        return Some(*root_tree_oid);
    }

    let mut current_tree_oid = *root_tree_oid;
    let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();

    for (segment_index, &segment_name) in segments.iter().enumerate() {
        let object_result = view.object(&current_tree_oid).ok()?;
        let tree_ref = GitTreeRef::from_bytes(&object_result.payload);
        let entry_match = tree_ref.find_entry(segment_name).ok()??;

        if segment_index + 1 == segments.len() {
            return Some(entry_match.oid);
        }
        if !entry_match.mode.is_tree() {
            return None;
        }
        current_tree_oid = entry_match.oid;
    }
    None
}

/// Evaluates whether a commit modified any of the specified pathspecs relative to its parent(s).
/// For a root commit, returns `true` if any pathspec exists in the commit's tree.
pub fn commit_modifies_pathspecs(
    view: &RepoView,
    commit_record: &CommitRecord,
    pathspecs: &[String],
) -> FractalResult<bool> {
    if pathspecs.is_empty() {
        return Ok(true);
    }

    if commit_record.parents.is_empty() {
        for pathspec_item in pathspecs {
            if resolve_path_in_tree(view, &commit_record.tree, pathspec_item).is_some() {
                return Ok(true);
            }
        }
        return Ok(false);
    }

    // Inspect difference against the primary parent commit
    let primary_parent_oid = commit_record.parents[0];
    let parent_object = view.object(&primary_parent_oid)?;
    let parent_tree_oid = super::repo_view::parse_commit_tree(&parent_object.payload)?;

    for pathspec_item in pathspecs {
        let commit_oid_opt = resolve_path_in_tree(view, &commit_record.tree, pathspec_item);
        let parent_oid_opt = resolve_path_in_tree(view, &parent_tree_oid, pathspec_item);
        if commit_oid_opt != parent_oid_opt {
            return Ok(true);
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_args_at_dashdash_with_separator() {
        let args = vec![
            "log".to_string(),
            "-n".to_string(),
            "5".to_string(),
            "--".to_string(),
            "src/main.rs".to_string(),
            "README.md".to_string(),
        ];
        let (options, paths) = split_args_at_dashdash(&args);
        assert_eq!(options, vec!["log", "-n", "5"]);
        assert_eq!(paths, vec!["src/main.rs", "README.md"]);
    }

    #[test]
    fn test_split_args_at_dashdash_without_separator() {
        let args = vec!["diff".to_string(), "--cached".to_string()];
        let (options, paths) = split_args_at_dashdash(&args);
        assert_eq!(options, vec!["diff", "--cached"]);
        assert!(paths.is_empty());
    }

    #[test]
    fn test_matches_any_pathspec_exact_and_prefix() {
        let pathspecs = vec!["src".to_string(), "Cargo.toml".to_string()];
        assert!(matches_any_pathspec("src/main.rs", &pathspecs));
        assert!(matches_any_pathspec("src/bin/taxis.rs", &pathspecs));
        assert!(matches_any_pathspec("Cargo.toml", &pathspecs));
        assert!(!matches_any_pathspec("README.md", &pathspecs));
        assert!(!matches_any_pathspec("src_other/file.rs", &pathspecs));
    }

    #[test]
    fn test_matches_any_pathspec_empty_matches_all() {
        assert!(matches_any_pathspec("anything.txt", &[]));
    }
}
