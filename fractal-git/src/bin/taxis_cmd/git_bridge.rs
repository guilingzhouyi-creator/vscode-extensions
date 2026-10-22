//! Module: taxis_cmd::git_bridge — Read-Only Host Git Query Bridge
//! File Path: src/bin/taxis_cmd/git_bridge.rs
//! Architecture Role: Delegates read-only repository introspection (commit DAG, working tree
//!   status) to the host Git binary, then hands the parsed result to the Taxis engines.
//! Dependencies & Triggers: Consumed by `rev-list` and `diff` dispatchers.
//! Responsibilities: Process invocation, record framing, and status-code normalization.
//! Exit Semantics & Design Rationale: Every query either returns real repository data or
//!   surfaces the underlying failure. The bridge never substitutes a synthetic value: a
//!   fabricated commit count or a hardcoded "clean" verdict is indistinguishable from truth
//!   once it reaches a report, so absence of data must stay distinguishable from zero data.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TOP-001`: DAG topology traversal guard

use std::path::{Path, PathBuf};
use std::process::Command;

use fractal_git::{FractalError, FractalResult, Oid, TelemetryCommitNode};

/// Field separator inside one framed commit record (`0x1f`, unit separator).
const FIELD_SEP: char = '\u{1f}';
/// Record separator terminating one commit record (`0x1e`, record separator).
const RECORD_SEP: char = '\u{1e}';
/// Suffix that marks an autonomous agent mailbox rather than a human identity.
const AGENT_MAILBOX_SUFFIX: &str = ".praxis.local";
/// Trailer emitted by agent-authored commits inside the commit message body.
const AGENT_META_TRAILER: &str = "Praxis-Agent-Meta:";

/// One entry of the working tree status report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkTreeEntry {
    /// Two-letter porcelain status code (`M `, ` M`, `??`, `R `, ...).
    pub code: String,
    /// Repository-relative path, always using forward slashes.
    pub path: String,
    /// True when the path is untracked and therefore absent from the index.
    pub is_untracked: bool,
}

impl WorkTreeEntry {
    /// Human-readable classification derived from the porcelain code.
    pub fn classification(&self) -> &'static str {
        if self.is_untracked {
            return "untracked";
        }
        match self.code.trim() {
            "M" => "modified",
            "A" => "added",
            "D" => "deleted",
            "R" => "renamed",
            "C" => "copied",
            "T" => "type-changed",
            "U" => "unmerged",
            _ => "changed",
        }
    }
}

/// Resolves the working tree root that repository-relative paths are anchored to.
///
/// The git directory is normally `<root>/.git`; an empty or bare `git_dir` falls back to the
/// current directory so the bridge never invents an absolute anchor of its own.
pub fn resolve_work_root(git_dir: &Path) -> PathBuf {
    match git_dir.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

/// Runs a read-only host Git command and returns its standard output.
///
/// The repository root is passed as an explicit `-C` argument instead of relying on the child
/// process working directory, so a caller-supplied relative root resolves identically no matter
/// where the CLI itself was launched from.
fn run_git(work_root: &Path, args: &[&str]) -> FractalResult<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(work_root).args(args);
    // Sandbox & permission defense: an unreadable global config must not abort the query.
    if std::env::var("GIT_CONFIG_GLOBAL").is_err() {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let config_path = PathBuf::from(home).join(".gitconfig");
            if std::fs::File::open(&config_path).is_err() {
                command.env("GIT_CONFIG_GLOBAL", "NUL");
            }
        }
    }

    let output = command.output().map_err(|spawn_err| {
        FractalError::Io(std::io::Error::new(
            spawn_err.kind(),
            format!("cannot execute host git {:?}: {}", args, spawn_err),
        ))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // A failing host command is an environmental or usage problem, not corrupt local state;
        // classifying it as such would send operators hunting for damage that does not exist.
        return Err(FractalError::Io(std::io::Error::other(format!(
            "host git {:?} failed with status {:?}: {}",
            args,
            output.status.code(),
            stderr.trim()
        ))));
    }

    String::from_utf8(output.stdout).map_err(|utf_err| {
        FractalError::ObjectCodec(format!(
            "host git {:?} emitted non-UTF8 output: {}",
            args, utf_err
        ))
    })
}

/// Resolves the commit OID that `rev` points at, or `None` when the revision is unknown.
pub fn resolve_revision(work_root: &Path, rev: &str) -> FractalResult<Option<Oid>> {
    match run_git(work_root, &["rev-parse", "--verify", "--quiet", rev]) {
        Ok(stdout) => {
            let trimmed = stdout.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            Oid::from_hex(trimmed).map(Some)
        }
        Err(_) => Ok(None),
    }
}

/// Reads the full reachable commit DAG beneath `rev` as telemetry nodes.
///
/// A commit is classified as an agent micro-commit when its author mailbox carries the agent
/// suffix or its body embeds the agent metadata trailer; a merge with two or more parents is a
/// promotion merge. Everything else is treated as a human-signed commit.
pub fn read_commit_nodes(work_root: &Path, rev: &str) -> FractalResult<Vec<TelemetryCommitNode>> {
    let format_arg = format!(
        "--format=%H{sep}%P{sep}%ae{sep}%B{rec}",
        sep = FIELD_SEP,
        rec = RECORD_SEP
    );
    let stdout = run_git(work_root, &["log", &format_arg, rev])?;
    Ok(parse_commit_nodes(&stdout))
}

/// Parses the framed `git log` output produced by [`read_commit_nodes`].
pub fn parse_commit_nodes(framed_log: &str) -> Vec<TelemetryCommitNode> {
    let mut nodes = Vec::new();
    for raw_record in framed_log.split(RECORD_SEP) {
        let record = raw_record.trim_start_matches(['\n', '\r']);
        if record.trim().is_empty() {
            continue;
        }
        let mut fields = record.split(FIELD_SEP);
        let (Some(oid_hex), Some(parent_field), Some(mailbox), Some(body)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };

        let commit_oid = match Oid::from_hex(oid_hex.trim()) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        let mut parent_oids = Vec::with_capacity(2);
        for parent_hex in parent_field.split_whitespace() {
            if let Ok(parent_oid) = Oid::from_hex(parent_hex) {
                parent_oids.push(parent_oid);
            }
        }

        let is_agent_authored =
            mailbox.trim().ends_with(AGENT_MAILBOX_SUFFIX) || body.contains(AGENT_META_TRAILER);

        nodes.push(TelemetryCommitNode {
            oid: commit_oid,
            is_promotion_merge: parent_oids.len() >= 2,
            is_human_signed: !is_agent_authored,
            is_agent_micro_commit: is_agent_authored,
            parent_oids,
        });
    }

    nodes
}

/// Reads the working tree status as normalized entries.
///
/// Uses the NUL-delimited porcelain format so that paths containing spaces or quotes survive
/// unchanged; a rename record contributes its destination path only.
pub fn read_status_entries(work_root: &Path) -> FractalResult<Vec<WorkTreeEntry>> {
    let stdout = run_git(
        work_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    Ok(parse_status_entries(&stdout))
}

/// Parses NUL-delimited `git status --porcelain=v1 -z` output.
pub fn parse_status_entries(null_delimited: &str) -> Vec<WorkTreeEntry> {
    let mut entries = Vec::new();
    let mut records = null_delimited
        .split('\0')
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let code = record[..2].to_string();
        let path_field = &record[3..];
        let is_untracked = code == "??";
        let is_rename_or_copy = code.starts_with('R') || code.starts_with('C');
        entries.push(WorkTreeEntry {
            code,
            path: path_field.replace('\\', "/"),
            is_untracked,
        });
        // Rename and copy records are followed by the source path record, which is dropped.
        if is_rename_or_copy {
            let _ = records.next();
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic 20-byte OID built from a single repeated byte.
    fn oid_of(fill: u8) -> Oid {
        Oid::from_bytes([fill; 20])
    }

    /// Builds one framed log record matching the `--format` used by `read_commit_nodes`.
    fn frame(oid: &Oid, parents: &[Oid], mailbox: &str, body: &str) -> String {
        let parent_field = parents
            .iter()
            .map(|parent| parent.to_hex())
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "{oid}{sep}{parents}{sep}{mailbox}{sep}{body}{rec}",
            oid = oid.to_hex(),
            sep = FIELD_SEP,
            parents = parent_field,
            mailbox = mailbox,
            body = body,
            rec = RECORD_SEP
        )
    }

    #[test]
    fn parse_commit_nodes_reads_parents_and_author_classification() {
        let root = oid_of(0x11);
        let child = oid_of(0x22);
        let framed = format!(
            "{}{}",
            frame(&root, &[], "architect@company.com", "feat: root\n"),
            frame(
                &child,
                &[root],
                "agent-primary@cell-core.praxis.local",
                "chore: micro\n"
            )
        );

        let nodes = parse_commit_nodes(&framed);
        assert_eq!(nodes.len(), 2);

        let root_node = nodes.iter().find(|node| node.oid == root).unwrap();
        assert!(root_node.parent_oids.is_empty());
        assert!(root_node.is_human_signed);
        assert!(!root_node.is_agent_micro_commit);
        assert!(!root_node.is_promotion_merge);

        let child_node = nodes.iter().find(|node| node.oid == child).unwrap();
        assert_eq!(child_node.parent_oids, vec![root]);
        assert!(child_node.is_agent_micro_commit);
        assert!(!child_node.is_human_signed);
    }

    #[test]
    fn parse_commit_nodes_marks_merges_and_meta_trailer_as_promotion() {
        let first_parent = oid_of(0x33);
        let second_parent = oid_of(0x44);
        let merge = oid_of(0x55);
        let framed = frame(
            &merge,
            &[first_parent, second_parent],
            "architect@company.com",
            "refactor: promotion\n\nPraxis-Agent-Meta: {\"agent_uid\":\"a\"}\n",
        );

        let nodes = parse_commit_nodes(&framed);
        assert_eq!(nodes.len(), 1);
        assert!(nodes[0].is_promotion_merge);
        assert_eq!(nodes[0].parent_oids.len(), 2);
        // The embedded trailer outranks the human-looking mailbox.
        assert!(nodes[0].is_agent_micro_commit);
        assert!(!nodes[0].is_human_signed);
    }

    #[test]
    fn parse_commit_nodes_skips_malformed_records() {
        let valid = oid_of(0x66);
        let framed = format!(
            "not-a-hex-oid{sep}{sep}x@y{sep}body{rec}{}",
            frame(&valid, &[], "human@company.com", "fix: ok\n"),
            sep = FIELD_SEP,
            rec = RECORD_SEP
        );

        let nodes = parse_commit_nodes(&framed);
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].oid, valid);
    }

    #[test]
    fn parse_status_entries_classifies_modified_and_untracked() {
        let raw = " M src/main.rs\u{0}?? notes.txt\u{0}";
        let entries = parse_status_entries(raw);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "src/main.rs");
        assert_eq!(entries[0].classification(), "modified");
        assert!(!entries[0].is_untracked);

        assert_eq!(entries[1].path, "notes.txt");
        assert_eq!(entries[1].classification(), "untracked");
        assert!(entries[1].is_untracked);
    }

    #[test]
    fn parse_status_entries_drops_rename_source_record() {
        // A rename emits the destination record followed by the source record.
        let raw = "R  new/name.rs\u{0}old/name.rs\u{0} M keep.rs\u{0}";
        let entries = parse_status_entries(raw);

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "new/name.rs");
        assert_eq!(entries[0].classification(), "renamed");
        assert_eq!(entries[1].path, "keep.rs");
    }

    #[test]
    fn parse_status_entries_returns_empty_for_clean_tree() {
        assert!(parse_status_entries("").is_empty());
    }

    #[test]
    fn resolve_work_root_strips_trailing_git_component() {
        let resolved = resolve_work_root(Path::new(".git"));
        assert_eq!(resolved, PathBuf::from("."));

        let nested = resolve_work_root(Path::new("repo/.git"));
        assert_eq!(nested, PathBuf::from("repo"));
    }
}
