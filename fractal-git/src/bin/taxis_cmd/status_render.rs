//! Module: taxis_cmd::status_render — Long-Form Status Rendering
//! File Path: src/bin/taxis_cmd/status_render.rs
//! Architecture Role: The human-readable long form of taxis status, separated from the
//!   comparison engine so classification and presentation stay separate concerns.
//! Dependencies & Triggers: Called by status::handle_status for the default (long) flavour and by
//!   status::render_records for the --branch header.
//! Responsibilities: Section ordering, Git exact wording and padding, the clean-tree sentence, and
//!   the branch/detached header lines.
//! Exit Semantics & Design Rationale:
//!   - Sections print in the order a commit reads them; every header and separator is part of the
//!     contract a person comparing the two tools, and a screenshot test, relies on.
//!   - The clean-tree sentence changes on an unborn branch, which is why the renderer asks whether
//!     HEAD resolves instead of printing one fixed sentence.

use super::repo_view::RepoView;
use super::status::{StatusEntry, CODE_ADDED, CODE_DELETED, CODE_RENAMED};

/// Renders the long form Git prints by default.
///
/// The sections are printed in the order a commit reads them: what is already staged, what a
/// merge left unresolved, what the next `git add` would stage, and what no `git add` can reach
/// yet. A clean tree prints the single sentence Git prints instead of four empty headers.
pub(super) fn render_long(view: &RepoView, entries: &[StatusEntry]) {
    println!("{}", long_branch_line(view));
    let tracked: Vec<&StatusEntry> = entries
        .iter()
        .filter(|entry| !entry.is_untracked())
        .collect();
    if tracked.is_empty() && entries.is_empty() {
        print_clean_long(view);
        return;
    }
    let staged: Vec<&StatusEntry> = tracked
        .iter()
        .copied()
        .filter(|entry| entry.is_staged() && !entry.is_conflicted())
        .collect();
    let conflicted: Vec<&StatusEntry> = tracked
        .iter()
        .copied()
        .filter(|entry| entry.is_conflicted())
        .collect();
    let unstaged: Vec<&StatusEntry> = tracked
        .iter()
        .copied()
        .filter(|entry| entry.is_unstaged() && !entry.is_conflicted())
        .collect();
    let untracked: Vec<&StatusEntry> = entries
        .iter()
        .filter(|entry| entry.is_untracked())
        .collect();
    let mut sections = 0usize;
    if !staged.is_empty() {
        if sections > 0 {
            println!();
        }
        println!("Changes to be committed:");
        println!("  (use \"git restore --staged <file>...\" to unstage)");
        for entry in &staged {
            println!("\t{}", staged_line(entry));
        }
        sections += 1;
    }
    if !conflicted.is_empty() {
        if sections > 0 {
            println!();
        }
        println!("Unmerged paths:");
        println!("  (use \"git add <file>...\" to mark resolution)");
        for entry in &conflicted {
            println!("\t{}", conflict_line(entry));
        }
        sections += 1;
    }
    if !unstaged.is_empty() {
        if sections > 0 {
            println!();
        }
        println!("Changes not staged for commit:");
        println!("  (use \"git add <file>...\" to update what will be committed)");
        println!("  (use \"git restore <file>...\" to discard changes in working directory)");
        for entry in &unstaged {
            println!("\t{}", unstaged_line(entry));
        }
        sections += 1;
    }
    if !untracked.is_empty() {
        if sections > 0 {
            println!();
        }
        println!("Untracked files:");
        println!("  (use \"git add <file>...\" to include in what will be committed)");
        for entry in &untracked {
            println!("\t{}", entry.path);
        }
        sections += 1;
    }
    if sections == 0 {
        print_clean_long(view);
        return;
    }
    // Git closes the long form with the one action the user can take next. It only prints the
    // sentence when nothing is staged, because a pending commit makes the advice redundant.
    if staged.is_empty() && conflicted.is_empty() {
        println!();
        if !unstaged.is_empty() {
            println!("no changes added to commit (use \"git add\" and/or \"git commit -a\")");
        } else if !untracked.is_empty() {
            println!(
                "nothing added to commit but untracked files present (use \"git add\" to track)"
            );
        }
    }
}

/// Prints Git's closing sentence for a clean tree.
///
/// In a repository with no commits the sentence changes: Git tells the user how to create the
/// first commit instead of claiming the tree is clean, which would leave the `git add` step that
/// actually creates the commit unmentioned.
fn print_clean_long(view: &RepoView) {
    if is_unborn(view) {
        println!();
        println!("nothing to commit (create/copy files and use \"git add\" to track)");
    } else {
        println!("nothing to commit, working tree clean");
    }
}

/// Reports whether `HEAD` does not resolve to any commit yet.
///
/// An unborn branch is the state every repository starts in, and Git words several messages
/// differently there; this is the single predicate those wordings branch on.
fn is_unborn(view: &RepoView) -> bool {
    view.effective_head_commit().ok().flatten().is_none()
}

/// Renders the first line of the long form: the branch, or how `HEAD` is detached.
fn long_branch_line(view: &RepoView) -> String {
    let branch = view.head_branch().ok().flatten().map(|(name, _)| name);
    let detached = view
        .effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid);
    match (branch, detached) {
        (Some(name), Some(_)) => format!("On branch {name}"),
        (Some(name), None) => format!("On branch {name}\n\nNo commits yet"),
        (None, Some(oid)) => {
            // Git names the commit the detached HEAD sits on, abbreviated the same way it
            // abbreviates object ids everywhere else.
            let hex = oid.to_hex();
            format!("HEAD detached at {}", &hex[..hex.len().min(7)])
        }
        (None, None) => "On an unborn branch".to_string(),
    }
}

/// Renders the `## <branch>` header the short and porcelain forms print under `--branch`.
pub(super) fn branch_header(view: &RepoView) -> String {
    let branch = view.head_branch().ok().flatten().map(|(name, _)| name);
    let detached = view
        .effective_head_commit()
        .ok()
        .flatten()
        .map(|(_, oid)| oid);
    match (branch, detached) {
        (Some(name), Some(_)) => format!("## {name}"),
        (Some(name), None) => format!("## No commits yet on {name}"),
        (None, Some(_)) => "## HEAD (no branch)".to_string(),
        (None, None) => "## No commits yet on an unborn branch".to_string(),
    }
}

/// Names the index-side change in the words Git prints, padded to the column Git pads to.
fn staged_line(entry: &StatusEntry) -> String {
    match entry.index_code {
        CODE_ADDED => format!("new file:   {}", entry.path),
        CODE_DELETED => format!("deleted:    {}", entry.path),
        CODE_RENAMED => match &entry.rename_from {
            Some(from) => format!("renamed:    {from} -> {}", entry.path),
            None => format!("renamed:    {}", entry.path),
        },
        _ => format!("modified:   {}", entry.path),
    }
}

/// Names the worktree-side change in the words Git prints.
fn unstaged_line(entry: &StatusEntry) -> String {
    match entry.worktree_code {
        CODE_DELETED => format!("deleted:    {}", entry.path),
        _ => format!("modified:   {}", entry.path),
    }
}

/// Names the surviving sides of an unmerged path in the words Git prints.
fn conflict_line(entry: &StatusEntry) -> String {
    match entry.code().as_str() {
        "AA" => format!("both added:      {}", entry.path),
        "DD" => format!("both deleted:    {}", entry.path),
        "AU" => format!("added by us:     {}", entry.path),
        "UA" => format!("added by them:   {}", entry.path),
        "UD" => format!("deleted by them: {}", entry.path),
        "DU" => format!("deleted by us:   {}", entry.path),
        _ => format!("both modified:   {}", entry.path),
    }
}

#[cfg(test)]
mod tests {
    use super::super::status::{
        StatusEntry, CODE_ADDED, CODE_DELETED, CODE_MODIFIED, CODE_RENAMED, CODE_UNCHANGED,
    };
    use super::{conflict_line, staged_line, unstaged_line};

    #[test]
    fn long_form_names_the_index_side_changes() {
        assert_eq!(
            staged_line(&StatusEntry::new(CODE_ADDED, CODE_UNCHANGED, "a.txt")),
            "new file:   a.txt"
        );
        assert_eq!(
            staged_line(&StatusEntry::new(CODE_DELETED, CODE_UNCHANGED, "a.txt")),
            "deleted:    a.txt"
        );
        assert_eq!(
            staged_line(&StatusEntry::new(CODE_MODIFIED, CODE_UNCHANGED, "a.txt")),
            "modified:   a.txt"
        );
        let mut renamed = StatusEntry::new(CODE_RENAMED, CODE_UNCHANGED, "b.txt");
        renamed.rename_from = Some("a.txt".to_string());
        assert_eq!(staged_line(&renamed), "renamed:    a.txt -> b.txt");
    }

    #[test]
    fn long_form_names_the_worktree_side_changes() {
        assert_eq!(
            unstaged_line(&StatusEntry::new(CODE_UNCHANGED, CODE_MODIFIED, "a.txt")),
            "modified:   a.txt"
        );
        assert_eq!(
            unstaged_line(&StatusEntry::new(CODE_UNCHANGED, CODE_DELETED, "a.txt")),
            "deleted:    a.txt"
        );
    }

    #[test]
    fn long_form_names_every_unmerged_state() {
        let cases = [
            (('A', 'A'), "both added:      a.txt"),
            (('D', 'D'), "both deleted:    a.txt"),
            (('A', 'U'), "added by us:     a.txt"),
            (('U', 'A'), "added by them:   a.txt"),
            (('U', 'D'), "deleted by them: a.txt"),
            (('D', 'U'), "deleted by us:   a.txt"),
            (('U', 'U'), "both modified:   a.txt"),
        ];
        for ((index_code, worktree_code), expected) in cases {
            let entry = StatusEntry::new(index_code, worktree_code, "a.txt");
            assert_eq!(conflict_line(&entry), expected);
        }
    }
}
