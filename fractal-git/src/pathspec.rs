//! Module: fractal-git — Pathspec Resolution
//! File Path: src/pathspec.rs
//! Architecture Role: Converts a command-line path into a path relative to the repository root, the
//!   form every candidate list in the CLI is expressed in.
//! Dependencies & Triggers: Used by `add`, `rm`, `mv` and `restore` through the CLI layer.
//! Responsibilities: Normalize separators, apply the caller's directory as a prefix, collapse `.`
//!   and `..`, and reject anything that resolves outside the work tree.
//! Exit Semantics & Design Rationale:
//!   - Git resolves pathspecs against the current working directory. Omitting that rule is invisible
//!     from the repository root, which is why it survived in four commands while every root-level
//!     test passed: `taxis add Cargo.toml` in a subdirectory reported "pathspec did not match any
//!     files" for a file that plainly existed.
//!   - The traversal check is not merely hygiene. A spec of `../../escape` cannot match any candidate
//!     because candidates are all inside the work tree, so accepting it would turn a clear "outside
//!     repository" refusal into a confusing "did not match" message pointing at the wrong thing.
//!   - Living in the library rather than the binary keeps one implementation: a test can then assert
//!     the same arithmetic the command runs instead of a duplicate that may drift.

use std::path::Path;

/// Normalizes separators and strips a leading `./`.
///
/// Backslashes are accepted on every platform because a path typed on Windows is often pasted
/// elsewhere, and rejecting it would fail a command that names a real file.
pub fn normalize_rel_spec(raw: &str) -> String {
    let forward = raw.replace('\\', "/");
    let stripped = forward.strip_prefix("./").unwrap_or(&forward);
    if stripped == "." {
        String::new()
    } else {
        stripped.trim_matches('/').to_string()
    }
}

/// Converts `raw`, interpreted relative to `cwd`, into a work-root-relative path.
pub fn spec_relative_to_root(work_root: &Path, cwd: &Path, raw: &str) -> Result<String, String> {
    if Path::new(raw).is_absolute() {
        // An absolute path is legal only when it lies inside the work tree; reinterpreting it as
        // relative would stage a different file than the one named.
        return match absolute_under(raw, work_root) {
            Some(relative) => Ok(relative),
            None => Err(format!("{raw}: is outside repository")),
        };
    }

    let relative_cwd = match cwd.strip_prefix(work_root) {
        Ok(relative) => relative,
        Err(_) => return Err(format!("{raw}: is outside repository")),
    };
    let prefix = relative_cwd
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");

    let normalized = normalize_rel_spec(raw);
    let mut parts: Vec<&str> = if prefix.is_empty() {
        Vec::new()
    } else {
        prefix.split('/').filter(|part| !part.is_empty()).collect()
    };
    for segment in normalized.split('/').filter(|segment| !segment.is_empty()) {
        match segment {
            "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(format!("{raw}: is outside repository"));
                }
            }
            other => parts.push(other),
        }
    }
    Ok(parts.join("/"))
}

/// Converts an absolute path into a work-root-relative one, or `None` when it lies outside.
fn absolute_under(raw: &str, work_root: &Path) -> Option<String> {
    let candidate = Path::new(raw);
    let relative = candidate.strip_prefix(work_root).ok()?;
    Some(normalize_rel_spec(&relative.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> &'static Path {
        Path::new("/repo")
    }

    #[test]
    fn spec_at_root_is_unchanged() {
        let resolved = spec_relative_to_root(root(), root(), "src/lib.rs").expect("resolve");
        assert_eq!(resolved, "src/lib.rs");
    }

    #[test]
    fn spec_in_subdirectory_is_prefixed() {
        let resolved =
            spec_relative_to_root(root(), &root().join("crates/kernel"), "Cargo.toml").expect("resolve");
        assert_eq!(
            resolved, "crates/kernel/Cargo.toml",
            "a bare name typed one level down names the file below the caller, exactly as git does"
        );
    }

    #[test]
    fn parent_traversal_is_collapsed() {
        let resolved =
            spec_relative_to_root(root(), &root().join("crates/kernel"), "../shared.txt")
                .expect("resolve");
        assert_eq!(resolved, "crates/shared.txt");
    }

    #[test]
    fn traversal_above_the_root_is_rejected() {
        let outcome = spec_relative_to_root(root(), &root().join("crates"), "../../escape.txt");
        assert!(
            outcome.is_err(),
            "a spec that climbs out of the work tree can never match a candidate and must be refused"
        );
    }

    #[test]
    fn working_directory_outside_the_root_is_rejected() {
        assert!(spec_relative_to_root(root(), Path::new("/elsewhere"), "file.txt").is_err());
    }

    #[test]
    fn dot_segments_are_ignored() {
        let resolved =
            spec_relative_to_root(root(), &root().join("a/b"), "././x.txt").expect("resolve");
        assert_eq!(resolved, "a/b/x.txt");
    }

    #[test]
    fn backslashes_are_accepted_as_separators() {
        let resolved =
            spec_relative_to_root(root(), &root().join("a"), "b\\c.txt").expect("resolve");
        assert_eq!(resolved, "a/b/c.txt");
    }
}
