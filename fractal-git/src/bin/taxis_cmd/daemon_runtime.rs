//! Module: taxis_cmd::daemon_runtime — Resident Hot-State IPC Session Engine
//! File Path: src/bin/taxis_cmd/daemon_runtime.rs
//! Architecture Role: Maintains an in-memory hot cache of `RepoDocument` and `InMemoryIndexTree`
//!   snapshots across local Agent IPC requests (`Ping`, `Status`, `Stage`, `Commit`, `DiffSlice`).
//! Dependencies & Triggers: Loaded by `src/bin/taxis_cmd/daemon.rs` during `--request`, `--once`,
//!   and `--serve` daemon invocations.
//! Responsibilities: Execute low-latency staging, tree/commit materialization, and scoped status
//!   or diff queries against warm memory state while keeping `.git` and TAXC containers synced.
//! Exit Semantics & Design Rationale: Never panics; returns structured `IpcDaemonReceipt` envelopes
//!   recording execution latency (`latency_us`), `cache_generation`, and `cache_hit` telemetry.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-IDX-001`: Lockless in-memory git index concurrency guard
//! - `FGT-TRN-001`: Network transport and framing guard

use std::path::{Path, PathBuf};
use std::time::Instant;

use fg_core::constants::git::{OBJ_BLOB, OBJ_COMMIT, OBJ_TREE};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{current_unix_seconds, FileMode, Oid};
use fg_core::traits::{OdbStore, RefStore};
use fg_index::{GitIndex, InMemoryIndexTree};
use fg_native::sections::indx::IndexEntry as NativeIndexEntry;
use fg_native::sections::refs::RefRecord;
use fg_native::RepoDocument;
use fractal_git::server::{IpcDaemonReceipt, IpcMessage, IpcStageEntry};
use fractal_git::{DiskRefStore, LooseOdb};

/// In-memory resident daemon session caching `RepoDocument` and `InMemoryIndexTree`.
pub struct DaemonHotSession {
    pub(crate) git_dir: PathBuf,
    pub(crate) container_doc: Option<RepoDocument>,
    pub(crate) index_tree: InMemoryIndexTree,
    pub(crate) cache_generation: u64,
    pub(crate) request_count: u64,
}

impl DaemonHotSession {
    /// Warms a new resident session from `.taxis/repo.txc` and `.git/index` on disk.
    #[must_use]
    pub fn open(git_dir: &Path) -> Self {
        let container_doc = RepoDocument::load(&fg_native::container_path(git_dir)).ok();
        let mut index_tree = InMemoryIndexTree::new();
        if let Ok(git_idx) = GitIndex::load(git_dir.join("index")) {
            for entry in git_idx.entries() {
                let _ = index_tree.stage_oid(&entry.path, entry.mode, entry.oid);
            }
        }
        if let Some(ref doc) = container_doc {
            for entry in doc.indx.entries() {
                let _ = index_tree.stage_oid(&entry.path, entry.mode, entry.oid);
            }
        }
        Self {
            git_dir: git_dir.to_path_buf(),
            container_doc,
            index_tree,
            cache_generation: 1,
            request_count: 0,
        }
    }

    /// Returns the monotonic generation counter of the in-memory session cache.
    #[must_use]
    pub const fn cache_generation(&self) -> u64 {
        self.cache_generation
    }

    /// Returns the total number of IPC requests processed by this warm session.
    #[must_use]
    pub const fn request_count(&self) -> u64 {
        self.request_count
    }

    /// Returns the number of resolved entries currently held in the hot index tree.
    #[must_use]
    pub fn entry_count(&self) -> usize {
        self.index_tree.entry_count()
    }

    /// Executes one IPC command message against the hot session and returns a structured receipt.
    #[must_use]
    pub fn execute(&mut self, message: &IpcMessage) -> IpcDaemonReceipt {
        let started = Instant::now();
        let cache_hit = self.request_count() > 0;
        self.request_count += 1;
        let outcome = match message {
            IpcMessage::Ping { timestamp_ms } => Ok(empty_receipt(
                "ping",
                self.index_tree.entry_count(),
                format!("pong:{timestamp_ms}"),
            )),
            IpcMessage::Status { scope_prefix } => Ok(self.exec_status(scope_prefix.as_deref())),
            IpcMessage::Stage { entries } => self.exec_stage(entries),
            IpcMessage::Commit {
                target_ref,
                parent_oids,
                entries,
                message: msg_text,
                author_name,
                author_email,
                timestamp_sec,
                tz_offset,
            } => self.exec_commit(
                target_ref,
                parent_oids,
                entries,
                msg_text,
                (
                    author_name,
                    author_email,
                    *timestamp_sec,
                    tz_offset.as_deref(),
                ),
            ),
            IpcMessage::DiffSlice {
                scope_prefix,
                base_oid,
                head_oid,
            } => Ok(self.exec_diff_slice(
                scope_prefix.as_deref(),
                base_oid.as_deref(),
                head_oid.as_deref(),
            )),
            _ => Err(FractalError::ObjectCodec(
                "Unsupported daemon IPC command".to_owned(),
            )),
        };
        finalize_receipt(outcome, started, self.cache_generation(), cache_hit)
    }

    fn exec_status(&self, scope_prefix: Option<&str>) -> IpcDaemonReceipt {
        let scoped = scoped_tree(&self.index_tree, scope_prefix);
        let mut receipt =
            empty_receipt("status", scoped.entry_count(), "hot_index_ready".to_owned());
        receipt.entries = scoped.entries().keys().cloned().collect();
        receipt.target_ref = resolve_head_ref(&self.git_dir);
        receipt
    }

    fn exec_stage(&mut self, entries: &[IpcStageEntry]) -> FractalResult<IpcDaemonReceipt> {
        let odb = LooseOdb::new(&self.git_dir);
        let tree_oid = self.stage_and_persist(&odb, entries)?;
        let mut receipt =
            empty_receipt("stage", self.index_tree.entry_count(), "staged".to_owned());
        receipt.tree_oid = Some(tree_oid.to_hex());
        receipt.entries = self.index_tree.entries().keys().cloned().collect();
        Ok(receipt)
    }

    fn exec_commit(
        &mut self,
        target_ref: &str,
        parent_oids: &[String],
        entries: &[IpcStageEntry],
        message: &str,
        author_meta: (&str, &str, Option<i64>, Option<&str>),
    ) -> FractalResult<IpcDaemonReceipt> {
        let odb = LooseOdb::new(&self.git_dir);
        let tree_oid = self.stage_and_persist(&odb, entries)?;
        let payload = format_commit_payload(&tree_oid, parent_oids, message, author_meta)?;
        let commit_oid = odb.write_object(OBJ_COMMIT, payload.as_bytes())?;
        DiskRefStore::new(&self.git_dir).update_ref(target_ref, &commit_oid, None)?;
        if let Some(ref mut doc) = self.container_doc {
            let _ = doc.refs.upsert(RefRecord {
                name: target_ref.to_owned(),
                oid: commit_oid,
                peeled: None,
            });
            self.flush_container();
        }
        let mut receipt = empty_receipt(
            "commit",
            self.index_tree.entry_count(),
            "committed".to_owned(),
        );
        receipt.tree_oid = Some(tree_oid.to_hex());
        receipt.commit_oid = Some(commit_oid.to_hex());
        receipt.target_ref = Some(target_ref.to_owned());
        receipt.entries = self.index_tree.entries().keys().cloned().collect();
        Ok(receipt)
    }

    fn exec_diff_slice(
        &self,
        scope: Option<&str>,
        base: Option<&str>,
        head: Option<&str>,
    ) -> IpcDaemonReceipt {
        let scoped = scoped_tree(&self.index_tree, scope);
        let entries: Vec<String> = scoped.entries().keys().cloned().collect();
        let detail = format!(
            "slice {}..{} ({})",
            base.unwrap_or("INDEX"),
            head.unwrap_or("WORKTREE"),
            entries.join(",")
        );
        let mut receipt = empty_receipt("diff_slice", entries.len(), detail);
        receipt.entries = entries;
        receipt
    }

    pub(crate) fn stage_and_persist(
        &mut self,
        odb: &LooseOdb,
        entries: &[IpcStageEntry],
    ) -> FractalResult<Oid> {
        for entry in entries {
            stage_one_entry(
                odb,
                &mut self.index_tree,
                self.container_doc.as_mut(),
                entry,
            )?;
        }
        let tree_oid = self
            .index_tree
            .write_tree_with_payload_persister(|payload| odb.write_object(OBJ_TREE, payload))?;
        self.flush_container();
        self.cache_generation += 1;
        Ok(tree_oid)
    }

    pub(crate) fn flush_container(&self) {
        if let Some(ref doc) = self.container_doc {
            let path = fg_native::container_path(&self.git_dir);
            if path.exists() {
                let _ = doc.save_atomic(&path);
            }
        }
    }
}

fn parse_ipc_mode(mode_str: &str) -> FractalResult<FileMode> {
    match mode_str.trim() {
        "100644" => Ok(FileMode::RegularFile),
        "100755" => Ok(FileMode::ExecutableFile),
        "120000" => Ok(FileMode::Symlink),
        "160000" => Ok(FileMode::Gitlink),
        other => Err(FractalError::ObjectCodec(format!(
            "Unsupported IPC file mode '{other}'"
        ))),
    }
}

fn stage_one_entry(
    odb: &LooseOdb,
    tree: &mut InMemoryIndexTree,
    doc: Option<&mut RepoDocument>,
    entry: &IpcStageEntry,
) -> FractalResult<()> {
    let mode = parse_ipc_mode(&entry.mode)?;
    let oid = match (&entry.oid, &entry.content, mode) {
        (Some(hex), _, _) => Oid::from_hex(hex)?,
        (None, Some(text), FileMode::Gitlink) => Oid::from_hex(text.trim())?,
        (None, Some(text), _) => odb.write_object(OBJ_BLOB, text.as_bytes())?,
        (None, None, _) => return Err(FractalError::ObjectCodec("Missing IPC oid".to_owned())),
    };
    tree.stage_oid(&entry.path, mode, oid)?;
    if let Some(container) = doc {
        let _ = container
            .indx
            .upsert(NativeIndexEntry::new(entry.path.clone(), mode, oid));
    }
    Ok(())
}

pub(crate) fn scoped_tree(tree: &InMemoryIndexTree, scope: Option<&str>) -> InMemoryIndexTree {
    match scope {
        Some(prefix) if !prefix.trim().is_empty() => tree.filter_by_scope(&[prefix]),
        _ => tree.clone(),
    }
}

fn format_commit_payload(
    tree_oid: &Oid,
    parent_oids: &[String],
    message: &str,
    author_meta: (&str, &str, Option<i64>, Option<&str>),
) -> FractalResult<String> {
    let (name, email, ts_opt, tz_opt) = author_meta;
    let ts = ts_opt.unwrap_or_else(current_unix_seconds);
    let tz = tz_opt.unwrap_or("+0000");
    let mut header = format!("tree {}\n", tree_oid.to_hex());
    for parent_hex in parent_oids {
        append_parent_line(&mut header, &Oid::from_hex(parent_hex)?);
    }
    Ok(format!(
        "{header}author {name} <{email}> {ts} {tz}\ncommitter {name} <{email}> {ts} {tz}\n\n{message}"
    ))
}

fn append_parent_line(header: &mut String, parent_oid: &Oid) {
    header.push_str("parent ");
    header.push_str(&parent_oid.to_hex());
    header.push('\n');
}

fn resolve_head_ref(git_dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let trimmed = raw.trim();
    Some(
        trimmed
            .strip_prefix("ref:")
            .map_or(trimmed, str::trim)
            .to_owned(),
    )
}

pub(crate) fn empty_receipt(command: &str, entry_count: usize, detail: String) -> IpcDaemonReceipt {
    IpcDaemonReceipt {
        command: command.to_owned(),
        ok: true,
        latency_us: 1,
        cache_generation: 1,
        cache_hit: false,
        tree_oid: None,
        commit_oid: None,
        target_ref: None,
        entry_count,
        entries: Vec::new(),
        detail,
    }
}

pub(crate) fn finalize_receipt(
    outcome: FractalResult<IpcDaemonReceipt>,
    started: Instant,
    cache_generation: u64,
    cache_hit: bool,
) -> IpcDaemonReceipt {
    let latency_us = u64::try_from(started.elapsed().as_micros())
        .unwrap_or(u64::MAX)
        .max(1);
    let mut receipt = outcome.unwrap_or_else(|err| {
        let mut failed = empty_receipt("error", 0, err.to_string());
        failed.ok = false;
        failed
    });
    receipt.latency_us = latency_us;
    receipt.cache_generation = cache_generation;
    receipt.cache_hit = cache_hit;
    receipt
}
