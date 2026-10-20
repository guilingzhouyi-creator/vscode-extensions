//! Module: fg-topology — Operation Log DAG & Time-Travel State Machine
//! File Path: crates/fg-topology/src/operation.rs
//! Architecture Role: Implements Jujutsu-style immutable Operation Log DAG, recording complete
//!   repository views and predecessor graphs across transactions, powering instantaneous
//!   `taxis undo` and time-travel rollback for multi-agent workflows.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Snapshot of the complete repository view at a specific point in time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RepoViewSnapshot {
    pub head_oid: Option<Oid>,
    pub branches: BTreeMap<String, Oid>,
    pub staged_promotions: Vec<String>,
    pub timestamp_ms: i64,
}

/// Metadata describing who ran the command and what action occurred.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OperationMetadata {
    pub actor: String,
    pub command: String,
    pub description: String,
    pub timestamp_ms: i64,
}

/// Single operation node within the immutable Operation DAG.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Operation {
    pub operation_id: Oid,
    pub parent_ids: Vec<Oid>,
    pub view: RepoViewSnapshot,
    pub metadata: OperationMetadata,
}

impl Operation {
    /// Constructs and content-hashes a new Operation node.
    pub fn new(parent_ids: Vec<Oid>, view: RepoViewSnapshot, metadata: OperationMetadata) -> Self {
        let serialized =
            serde_json::to_string(&(&parent_ids, &view, &metadata)).unwrap_or_default();

        let mut hasher = Sha1::new();
        hasher.update(b"operation ");
        hasher.update(serialized.as_bytes());
        let hash_bytes: [u8; 20] = hasher.finalize().into();
        let operation_id = Oid::from_bytes(hash_bytes);

        Self {
            operation_id,
            parent_ids,
            view,
            metadata,
        }
    }
}

/// Complete in-memory and disk-backed Operation Log DAG.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct OperationGraph {
    pub current_head: Option<Oid>,
    pub operations: BTreeMap<Oid, Operation>,
    #[serde(skip)]
    disk_path: Option<PathBuf>,
}

impl OperationGraph {
    /// Creates an empty in-memory Operation DAG.
    pub fn in_memory() -> Self {
        Self {
            current_head: None,
            operations: BTreeMap::new(),
            disk_path: None,
        }
    }

    /// Loads or initializes the Operation DAG backed by `.git/fractal/op_log.json`.
    pub fn load_or_init(git_dir: &Path) -> FractalResult<Self> {
        let fractal_dir = git_dir.join("fractal");
        let disk_path = fractal_dir.join("op_log.json");

        if disk_path.exists() {
            let content = fs::read_to_string(&disk_path)?;
            let mut graph: Self = serde_json::from_str(&content).map_err(|parse_err| {
                FractalError::ObjectCodec(format!(
                    "Failed to parse operation graph at '{}': {}",
                    disk_path.display(),
                    parse_err
                ))
            })?;
            graph.disk_path = Some(disk_path);
            Ok(graph)
        } else {
            Ok(Self {
                current_head: None,
                operations: BTreeMap::new(),
                disk_path: Some(disk_path),
            })
        }
    }

    /// Records a new atomic repository operation and advances the current head.
    pub fn record_operation(
        &mut self,
        view: RepoViewSnapshot,
        actor: impl Into<String>,
        command: impl Into<String>,
        description: impl Into<String>,
        timestamp_ms: i64,
    ) -> FractalResult<Oid> {
        let parent_ids = match self.current_head {
            Some(head_id) => vec![head_id],
            None => Vec::new(),
        };

        let metadata = OperationMetadata {
            actor: actor.into(),
            command: command.into(),
            description: description.into(),
            timestamp_ms,
        };

        let operation_node = Operation::new(parent_ids, view, metadata);
        let new_id = operation_node.operation_id;
        self.operations.insert(new_id, operation_node);
        self.current_head = Some(new_id);

        self.persist_to_disk()?;
        Ok(new_id)
    }

    /// Performs a time-travel undo: reverts to the parent operation of the current head.
    /// Returns the restored operation snapshot on success.
    pub fn undo(&mut self) -> FractalResult<Option<Operation>> {
        let active_head = match self.current_head {
            Some(head_id) => head_id,
            None => return Ok(None),
        };

        let current_op = match self.operations.get(&active_head) {
            Some(found_op) => found_op.clone(),
            None => {
                return Err(FractalError::IndexConflict(format!(
                    "Corrupt operation graph: active head '{}' not found",
                    active_head.to_hex()
                )));
            }
        };

        if current_op.parent_ids.is_empty() {
            // Already at root operation; cannot undo further
            return Ok(None);
        }

        let previous_head = current_op.parent_ids[0];
        let previous_op = match self.operations.get(&previous_head) {
            Some(found_op) => found_op.clone(),
            None => {
                return Err(FractalError::IndexConflict(format!(
                    "Corrupt operation graph: parent op '{}' not found",
                    previous_head.to_hex()
                )));
            }
        };

        self.current_head = Some(previous_head);
        self.persist_to_disk()?;
        Ok(Some(previous_op))
    }

    /// Returns the history of operations tracing back from current head.
    pub fn history(&self, limit: usize) -> Vec<&Operation> {
        let mut result = Vec::new();
        let mut next_id = self.current_head;

        while let Some(current_id) = next_id {
            if result.len() >= limit {
                break;
            }
            if let Some(operation_entry) = self.operations.get(&current_id) {
                result.push(operation_entry);
                next_id = operation_entry.parent_ids.first().copied();
            } else {
                break;
            }
        }

        result
    }

    /// Atomically persists the operation DAG to disk.
    fn persist_to_disk(&self) -> FractalResult<()> {
        if let Some(ref path) = self.disk_path {
            if let Some(parent_dir) = path.parent() {
                fs::create_dir_all(parent_dir)?;
            }
            let json = serde_json::to_string_pretty(self).map_err(|ser_err| {
                FractalError::ObjectCodec(format!(
                    "Failed to serialize operation graph: {}",
                    ser_err
                ))
            })?;
            let tmp_path = path.with_extension("tmp");
            {
                let mut tmp_file = File::create(&tmp_path)?;
                tmp_file.write_all(json.as_bytes())?;
                tmp_file.sync_all()?;
            }
            fs::rename(&tmp_path, path)?;
        }
        Ok(())
    }
}
