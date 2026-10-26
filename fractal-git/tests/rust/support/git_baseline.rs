//! Module: tests::support::git_baseline — System Git Object Reference Baseline for Differential Tests
//! File Path: fractal-git/tests/rust/support/git_baseline.rs
//! Architecture Role: Produces expected object ids and canonical ordering by driving the system git
//!   binary in an isolated object database, so byte-parity tests compare against Git rather than
//!   against a second copy of our own assumptions.
//! Dependencies & Triggers: Included by tests/rust/test_git_differential.rs through an explicit path
//!   attribute; requires the git binary at test time.
//! Responsibilities: Write blobs, trees, commits, and tags through git plumbing, list tree order the
//!   way git stores it, and fail loudly when the reference baseline command itself fails.
//! Exit Semantics & Design Rationale: GitBaseline::new returns None when git cannot be executed so the
//!   caller decides whether absence is a skip or a failure; every other method panics with the
//!   captured stderr, because a broken baseline validator must never be mistaken for a passing comparison.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-ALG-001.

use std::path::Path;
use std::process::{Command, Output, Stdio};

/// Fixed identity handed to git commit-tree and used by the differential vectors.
#[derive(Debug, Clone)]
pub struct BaselineSignature {
    /// Person name recorded in the object.
    pub name: String,
    /// Email address recorded in the object.
    pub email: String,
    /// Seconds since the Unix epoch.
    pub timestamp: i64,
    /// Textual time zone offset such as +0800.
    pub tz: String,
}

impl BaselineSignature {
    /// Builds a signature with the shared parity e-mail address.
    pub fn new(name: &str, tz: &str, timestamp: i64) -> Self {
        Self {
            name: name.to_string(),
            email: "parity@example.com".to_string(),
            timestamp,
            tz: tz.to_string(),
        }
    }

    /// Renders "<timestamp> <tz>", the form git accepts through GIT_AUTHOR_DATE.
    fn date(&self) -> String {
        format!("{} {}", self.timestamp, self.tz)
    }
}

/// One tree entry handed to git mktree.
pub struct BaselineTreeEntry {
    /// Octal file mode text such as 100644 or 40000.
    pub mode: String,
    /// Entry name relative to the containing tree.
    pub name: String,
    /// Object id the entry points at.
    pub oid: String,
}

impl BaselineTreeEntry {
    /// Builds one baseline tree entry.
    pub fn new(mode: &str, name: &str, oid: &str) -> Self {
        Self {
            mode: mode.to_string(),
            name: name.to_string(),
            oid: oid.to_string(),
        }
    }

    /// Returns the object type git mktree expects for this mode.
    fn object_type(&self) -> &'static str {
        match self.mode.as_str() {
            "40000" | "040000" => "tree",
            "160000" => "commit",
            _ => "blob",
        }
    }
}

/// Isolated git object database used to compute expected ids.
pub struct GitBaseline {
    git_dir: tempfile::TempDir,
}

impl GitBaseline {
    /// Creates an isolated bare repository, or returns None when git is unavailable.
    pub fn new() -> Option<Self> {
        let probe = Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !matches!(probe, Ok(status) if status.success()) {
            return None;
        }
        let base = std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = std::fs::create_dir_all(&base);
        let git_dir = tempfile::Builder::new()
            .prefix("taxis_git_base_")
            .tempdir_in(&base)
            .or_else(|_| tempfile::tempdir())
            .expect("create baseline git directory");
        run_git_output(git_dir.path(), &["init", "--quiet", "--bare"], None, &[]);
        Some(Self { git_dir })
    }

    /// Returns the isolated git directory.
    pub fn git_dir(&self) -> &Path {
        self.git_dir.path()
    }

    /// Returns the loose object file bytes git wrote for the given object id.
    pub fn read_loose_object_bytes(&self, oid_hex: &str) -> Vec<u8> {
        assert!(
            oid_hex.len() == 40,
            "object id must be 40 hexadecimal characters"
        );
        let (directory, remainder) = oid_hex.split_at(2);
        let path = self
            .git_dir
            .path()
            .join("objects")
            .join(directory)
            .join(remainder);
        std::fs::read(&path)
            .unwrap_or_else(|error| panic!("read loose object {}: {}", oid_hex, error))
    }

    /// Writes a blob and returns the object id git assigned.
    pub fn write_blob(&self, payload: &[u8]) -> String {
        let output = self.run(&["hash-object", "-w", "--stdin"], Some(payload), &[]);
        stdout_text(&output, "hash-object")
    }

    /// Writes a tree from unsorted entries and returns the object id git assigned.
    pub fn write_tree(&self, entries: &[BaselineTreeEntry]) -> String {
        let mut input = String::new();
        for entry in entries {
            input.push_str(&format!(
                "{} {} {}\t{}\n",
                entry.mode,
                entry.object_type(),
                entry.oid,
                entry.name
            ));
        }
        let output = self.run(&["mktree"], Some(input.as_bytes()), &[]);
        stdout_text(&output, "mktree")
    }

    /// Creates a commit and returns the object id git assigned.
    pub fn write_commit(
        &self,
        tree: &str,
        parents: &[String],
        author: &BaselineSignature,
        committer: &BaselineSignature,
        message: &str,
    ) -> String {
        let mut args: Vec<String> = vec!["commit-tree".to_string(), tree.to_string()];
        for parent in parents {
            args.push("-p".to_string());
            args.push(parent.clone());
        }
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        let author_date = author.date();
        let committer_date = committer.date();
        let envs = [
            ("GIT_AUTHOR_NAME", author.name.as_str()),
            ("GIT_AUTHOR_EMAIL", author.email.as_str()),
            ("GIT_COMMITTER_NAME", committer.name.as_str()),
            ("GIT_COMMITTER_EMAIL", committer.email.as_str()),
            ("GIT_AUTHOR_DATE", author_date.as_str()),
            ("GIT_COMMITTER_DATE", committer_date.as_str()),
        ];
        let output = self.run(&borrowed, Some(message.as_bytes()), &envs);
        stdout_text(&output, "commit-tree")
    }

    /// Writes an annotated tag from an exact payload and returns the object id git assigned.
    pub fn write_tag(&self, payload: &[u8]) -> String {
        let output = self.run(&["mktag"], Some(payload), &[]);
        stdout_text(&output, "mktag")
    }

    /// Lists tree entry names in the order git stores them.
    pub fn list_tree_names(&self, tree_oid: &str) -> Vec<String> {
        let output = self.run(
            &["-c", "core.quotepath=false", "ls-tree", tree_oid],
            None,
            &[],
        );
        String::from_utf8(output.stdout)
            .expect("ls-tree output is UTF-8")
            .lines()
            .filter_map(|line| line.find('\t').map(|tab| line[tab + 1..].to_string()))
            .collect()
    }

    fn run(&self, args: &[&str], stdin: Option<&[u8]>, envs: &[(&str, &str)]) -> Output {
        run_git_output(self.git_dir.path(), args, stdin, envs)
    }
}

/// Runs one git command against the given git directory and returns its captured output.
fn run_git_output(
    git_dir: &Path,
    args: &[&str],
    stdin: Option<&[u8]>,
    envs: &[(&str, &str)],
) -> Output {
    let mut command = Command::new("git");
    command.arg("--git-dir").arg(git_dir);
    command.args(args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    for (key, value) in envs {
        command.env(key, value);
    }
    let mut child = command.spawn().expect("spawn git baseline command");
    if let Some(payload) = stdin {
        use std::io::Write;
        let mut pipe = child.stdin.take().expect("git stdin pipe");
        pipe.write_all(payload).expect("write git stdin payload");
    }
    child
        .wait_with_output()
        .expect("wait for git baseline command")
}

/// Extracts trimmed standard output, panicking with stderr when git exits unsuccessfully.
fn stdout_text(output: &Output, operation: &str) -> String {
    if !output.status.success() {
        panic!(
            "git {} failed: {}",
            operation,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
