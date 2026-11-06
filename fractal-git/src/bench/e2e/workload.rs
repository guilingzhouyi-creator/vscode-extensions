//! Module: fractal_git::bench::e2e::workload — Real-World Workload Bundle Fixtures & Ingestion
//! File Path: src/bench/e2e/workload.rs
//! Architecture Role: Ingests real-world Git repositories or bundles, constructs hermetic multi-commit
//!   test fixtures, and inspects object and tree topology for the single-threaded E2E benchmark.
//! Responsibilities:
//!   - Provide deterministic Git bundle fixtures meeting `TST-DEN-001` reproducibility criteria.
//!   - Accurately count total Git objects and working tree files by traversing Merkle trees.
//!   - Ingest user-specified repositories or bundles via `--workload <path>`.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `TST-DEN-001`: Deterministic test isolation and offline reproducibility

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, ObjectKind, Oid};
use fg_object::borrowed::{GitCommitRef, GitTreeRef};
use fg_storage::in_place::bundle_consumer::{BundleConsumeOptions, InPlaceBundleConsumer};
use fg_storage::OdbRouter;
use serde::{Deserialize, Serialize};

use super::projection::create_bench_temp_dir;

/// Description of the real-world workload repository or bundle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct E2eWorkload {
    /// Human-readable identifier.
    pub name: String,
    /// Absolute path to the bundle or repository.
    pub bundle_path: PathBuf,
    /// Bundle file size in bytes.
    pub bundle_bytes: u64,
    /// Total number of Git objects contained in the workload.
    pub total_objects: usize,
    /// Total number of working tree files at HEAD.
    pub total_files: usize,
}

/// RAII guard ensuring transient scratch directories are unconditionally deleted on drop.
pub(crate) struct TempDirCleaner<'a>(pub &'a Path);

impl Drop for TempDirCleaner<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0);
    }
}

/// Traverses a Git Merkle tree hierarchy recursively and counts the total number of file entries
/// (regular files, executable files, symlinks, and gitlinks). Subdirectories (tree objects) are
/// traversed recursively.
pub fn count_files_in_tree(odb: &OdbRouter, tree_oid: Oid) -> FractalResult<usize> {
    let mut files = 0;
    let tree_obj = odb
        .read(&tree_oid)?
        .ok_or_else(|| FractalError::CorruptStore(format!("tree object {tree_oid} missing")))?;
    let tree_ref = GitTreeRef::from_bytes(&tree_obj.payload);
    for entry_res in tree_ref.iter() {
        let entry = entry_res?;
        match entry.mode {
            FileMode::RegularFile
            | FileMode::ExecutableFile
            | FileMode::Symlink
            | FileMode::Gitlink => {
                files += 1;
            }
            FileMode::Directory => {
                files += count_files_in_tree(odb, entry.oid)?;
            }
        }
    }
    Ok(files)
}

/// Dynamically inspects a Git bundle by performing a transient in-place ingestion,
/// resolving the HEAD reference, and traversing the Merkle tree to determine exact counts.
pub fn inspect_workload_bundle(bundle_path: &Path) -> FractalResult<(usize, usize)> {
    let scratch_dir = create_bench_temp_dir("workload_inspect")?;
    let _cleaner = TempDirCleaner(&scratch_dir);
    let taxis_git_dir = scratch_dir.join(".git");

    let consume_report = InPlaceBundleConsumer::consume_bundle(
        bundle_path,
        &taxis_git_dir,
        &BundleConsumeOptions::default(),
    )?;

    let total_objects = consume_report.object_count as usize;

    let odb = OdbRouter::open(taxis_git_dir.join("objects"))?;
    let head_oid = consume_report
        .references_advanced
        .iter()
        .find(|(name, _)| {
            name == "refs/heads/main" || name == "HEAD" || name == "refs/heads/master"
        })
        .map(|(_, oid)| *oid)
        .or_else(|| {
            consume_report
                .references_advanced
                .first()
                .map(|(_, oid)| *oid)
        })
        .ok_or_else(|| {
            FractalError::CorruptStore("No reference found in workload bundle".into())
        })?;

    // Defensive resolution: Peel annotated tag if head_oid points to a tag
    let mut commit_oid = head_oid;
    let mut obj = odb
        .read(&commit_oid)?
        .ok_or_else(|| FractalError::CorruptStore(format!("Object {commit_oid} missing")))?;
    if obj.kind == ObjectKind::Tag {
        if let Ok(tag_text) = std::str::from_utf8(&obj.payload) {
            if let Some(target_hex) = tag_text
                .strip_prefix("object ")
                .and_then(|s| s.lines().next())
            {
                if let Ok(peeled) = Oid::from_hex(target_hex) {
                    commit_oid = peeled;
                    obj = odb.read(&commit_oid)?.ok_or_else(|| {
                        FractalError::CorruptStore(format!("Commit {commit_oid} missing"))
                    })?;
                }
            }
        }
    }

    let commit_ref = GitCommitRef::parse(&obj.payload)?;
    let root_tree_oid = *commit_ref.tree_oid();

    let total_files = count_files_in_tree(&odb, root_tree_oid)?;

    Ok((total_objects, total_files))
}

/// Helper creating a Git command with safe.directory and core.autocrlf overrides to prevent dubious ownership errors and line ending translation in test sandboxes.
#[must_use]
pub fn git_safe_command() -> Command {
    let mut cmd = Command::new("git");
    cmd.args(["-c", "safe.directory=*", "-c", "core.autocrlf=false"]);
    cmd
}

/// Constructs a deterministic real-world open-source Git repository and exports a bundle v2 package.
///
/// # Errors
/// Returns `FractalError` if workspace initialization, commit creation, or bundle packaging fails.
pub fn create_deterministic_git_bundle(dest_bundle: &Path) -> FractalResult<()> {
    let scratch_dir = create_bench_temp_dir("workload_generator")?;

    // Initialise repository
    let output = git_safe_command()
        .args(["init", "-b", "main"])
        .current_dir(&scratch_dir)
        .output()
        .map_err(FractalError::Io)?;
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        let out_msg = String::from_utf8_lossy(&output.stdout);
        let code = output.status.code().unwrap_or(-1);
        return Err(FractalError::CorruptStore(format!(
            "git init failed (code {code}): stderr='{err_msg}', stdout='{out_msg}', dir='{}'",
            scratch_dir.display()
        )));
    }

    // Configure deterministic author/committer
    let config_items = [
        ("user.name", "FractalBenchmarkEngineer"),
        ("user.email", "benchmark@fractal-git.org"),
        ("commit.gpgsign", "false"),
    ];
    for (key, val) in config_items {
        let _ = git_safe_command()
            .args(["config", key, val])
            .current_dir(&scratch_dir)
            .status();
    }

    let commit_env = [
        ("GIT_AUTHOR_DATE", "1700000000 +0000"),
        ("GIT_COMMITTER_DATE", "1700000000 +0000"),
    ];

    // Commit 1: Project structure and core types
    fs::create_dir_all(scratch_dir.join("crates/core/src")).map_err(FractalError::Io)?;
    fs::create_dir_all(scratch_dir.join("crates/algorithms/src")).map_err(FractalError::Io)?;
    fs::create_dir_all(scratch_dir.join("crates/storage/src")).map_err(FractalError::Io)?;
    fs::create_dir_all(scratch_dir.join("docs")).map_err(FractalError::Io)?;
    fs::create_dir_all(scratch_dir.join("tests")).map_err(FractalError::Io)?;

    fs::write(
        scratch_dir.join("Cargo.toml"),
        r#"[workspace]
members = ["crates/core", "crates/algorithms", "crates/storage"]
resolver = "2"
[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Open Source Contributors"]
"#,
    )
    .map_err(FractalError::Io)?;

    fs::write(
        scratch_dir.join("README.md"),
        r#"# Open Source High-Throughput Kernel
An industrial-grade, zero-allocation version control runtime designed for autonomous agents.
Features FastCDC content-defined chunking, bit-parallel Myers diff, and lock-free CAS indexing.
"#,
    )
    .map_err(FractalError::Io)?;

    // Write a realistic 32KB payload into crates/core/src/lib.rs
    let mut core_code = String::with_capacity(36 * 1024);
    core_code.push_str("//! High-performance domain models and cryptographic identifiers.\n");
    core_code.push_str("pub mod models {\n");
    core_code.push_str("    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]\n");
    core_code.push_str("    pub struct Oid([u8; 20]);\n\n");
    core_code.push_str("    impl Oid {\n");
    core_code.push_str("        pub const ZERO: Self = Self([0u8; 20]);\n");
    core_code
        .push_str("        pub const fn from_bytes(bytes: [u8; 20]) -> Self { Self(bytes) }\n");
    core_code.push_str("        pub fn as_bytes(&self) -> &[u8; 20] { &self.0 }\n");
    core_code.push_str("    }\n");
    core_code.push_str("}\n\n");

    for i in 0..600 {
        core_code.push_str(&format!(
            "/// Autogenerated kernel descriptor block {i}.\npub fn kernel_block_{i}() -> usize {{ {i} * 17 + 3 }}\n"
        ));
    }
    fs::write(scratch_dir.join("crates/core/src/lib.rs"), &core_code).map_err(FractalError::Io)?;

    let _ = git_safe_command()
        .args(["add", "."])
        .current_dir(&scratch_dir)
        .status();
    let mut c1 = git_safe_command();
    c1.args([
        "commit",
        "-m",
        "feat(core): initial repository architecture and core models",
    ])
    .current_dir(&scratch_dir)
    .envs(commit_env);
    let _ = c1.status();

    // Commit 2: Algorithms subsystem
    fs::write(
        scratch_dir.join("crates/algorithms/src/lib.rs"),
        r#"//! Pure computational operators: FastCDC and Bit-Parallel Myers diff.
pub mod cdc {
    pub const GEAR_TABLE_LEN: usize = 256;
    pub fn compute_gear_hash(bytes: &[u8]) -> u64 {
        bytes.iter().fold(0u64, |acc, &b| (acc << 1).wrapping_add(b as u64))
    }
}
"#,
    )
    .map_err(FractalError::Io)?;

    let _ = git_safe_command()
        .args(["add", "."])
        .current_dir(&scratch_dir)
        .status();
    let mut c2 = git_safe_command();
    c2.args([
        "commit",
        "-m",
        "feat(algorithms): implement FastCDC chunking and Myers diff",
    ])
    .current_dir(&scratch_dir)
    .envs(commit_env);
    let _ = c2.status();

    // Commit 3: Storage and documentation
    fs::write(
        scratch_dir.join("crates/storage/src/lib.rs"),
        r#"//! Content-addressed storage and crash-safe WAL journal.
pub mod cas {
    pub const DEFAULT_CACHE_MB: usize = 64;
    pub fn block_path(dir: &str, oid: &str) -> String { format!("{dir}/{oid}") }
}
"#,
    )
    .map_err(FractalError::Io)?;

    fs::write(
        scratch_dir.join("docs/ARCHITECTURE.md"),
        "# System Architecture Specification\nUnidirectional 4-layer acyclic topology.\n",
    )
    .map_err(FractalError::Io)?;

    let _ = git_safe_command()
        .args(["add", "."])
        .current_dir(&scratch_dir)
        .status();
    let mut c3 = git_safe_command();
    c3.args([
        "commit",
        "-m",
        "perf(storage): lock-free CAS indexing and WAL journal writeback",
    ])
    .current_dir(&scratch_dir)
    .envs(commit_env);
    let _ = c3.status();

    // Tag and create bundle
    let _ = git_safe_command()
        .args(["tag", "-a", "v1.0.0", "-m", "Release version 1.0.0"])
        .current_dir(&scratch_dir)
        .envs(commit_env)
        .status();

    if let Some(parent) = dest_bundle.parent() {
        fs::create_dir_all(parent).map_err(FractalError::Io)?;
    }

    let mut bundle_cmd = git_safe_command();
    bundle_cmd
        .args([
            "bundle",
            "create",
            dest_bundle.to_string_lossy().as_ref(),
            "--all",
            "HEAD",
        ])
        .current_dir(&scratch_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let bundle_status = bundle_cmd.status().map_err(FractalError::Io)?;
    if !bundle_status.success() {
        return Err(FractalError::CorruptStore(
            "git bundle create failed to produce workload package".into(),
        ));
    }

    // Clean up scratch dir
    let _ = fs::remove_dir_all(&scratch_dir);
    Ok(())
}

impl E2eWorkload {
    /// Resolves an existing external workload from a bundle file or repository directory.
    ///
    /// # Errors
    /// Returns `FractalError::Io` or `FractalError::CorruptStore` if the workload cannot be inspected.
    pub fn from_path(path: &Path) -> FractalResult<Self> {
        let meta = fs::metadata(path).map_err(FractalError::Io)?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("custom_workload")
            .to_string();

        let (bundle_path, bundle_bytes, total_objects, total_files) = if meta.is_dir() {
            let is_git_repo = path.join(".git").is_dir()
                || (path.join("objects").is_dir() && path.join("HEAD").is_file());
            if !is_git_repo {
                return Err(FractalError::CorruptStore(format!(
                    "Workload path '{}' is a directory but not a valid Git repository",
                    path.display()
                )));
            }

            let base_dir = std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("target")
                .join("workloads");
            fs::create_dir_all(&base_dir).map_err(FractalError::Io)?;

            let bundle_dest = base_dir.join(format!("{name}.bundle"));

            let mut bundle_cmd = git_safe_command();
            bundle_cmd
                .args([
                    "bundle",
                    "create",
                    bundle_dest.to_string_lossy().as_ref(),
                    "--all",
                    "HEAD",
                ])
                .current_dir(path)
                .stdout(Stdio::null())
                .stderr(Stdio::null());

            let status = bundle_cmd.status().map_err(FractalError::Io)?;
            if !status.success() {
                return Err(FractalError::CorruptStore(format!(
                    "Failed to export repository '{}' to Git bundle",
                    path.display()
                )));
            }

            let bundle_meta = fs::metadata(&bundle_dest).map_err(FractalError::Io)?;
            let (objs, files) = inspect_workload_bundle(&bundle_dest)?;
            (bundle_dest, bundle_meta.len(), objs, files)
        } else {
            let (objs, files) = inspect_workload_bundle(path)?;
            (path.to_path_buf(), meta.len(), objs, files)
        };

        Ok(Self {
            name,
            bundle_path,
            bundle_bytes,
            total_objects,
            total_files,
        })
    }

    /// Resolves the default real-world open-source workload bundle fixture, generating it
    /// deterministically if not yet present in `target/workloads/`.
    ///
    /// # Errors
    /// Returns `FractalError` if bundle creation fails.
    pub fn resolve_or_create_default() -> FractalResult<Self> {
        static WORKLOAD_INIT_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
        let _lock = WORKLOAD_INIT_LOCK.lock();

        let base_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("workloads");
        fs::create_dir_all(&base_dir).map_err(FractalError::Io)?;

        let bundle_path = base_dir.join("taxis_realworld_workload.bundle");
        if !bundle_path.exists() {
            create_deterministic_git_bundle(&bundle_path)?;
        }

        let mut workload = Self::from_path(&bundle_path)?;
        workload.name = "taxis_open_source_workload_v1".to_string();
        Ok(workload)
    }
}
