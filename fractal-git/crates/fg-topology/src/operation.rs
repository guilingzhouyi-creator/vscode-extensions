//! Module: fg-topology — Operation Log DAG & Time-Travel State Machine
//! File Path: crates/fg-topology/src/operation.rs
//! Architecture Role: Implements the immutable operation log DAG, recording complete repository
//!   views and predecessor graphs across transactions, powering instantaneous `taxis undo` and
//!   time-travel rollback for multi-agent workflows.
//! Dependencies & Triggers: Utilized by CLI commands (undo, op) and transaction boundaries.
//! Responsibilities: Operation graph persistence, topological DAG ordering, and view snapshots.
//! Exit Semantics & Design Rationale:
//!   - The operation id is derived from canonical binary bytes with a domain prefix, never from a
//!     serialized string. A serializer-dependent id would change identity when the serializer
//!     changed its field order or key quoting, silently rewriting history.
//!   - Durable state is a TAXC container section, not a JSON document. JSON cannot express a
//!     20-byte id without encoding it as text, and it makes the record width depend on the value's
//!     decimal spelling.
//!   - Publication is atomic: a partial write would leave a graph whose head names an operation that
//!     is not in the file.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FastOidSet, Oid};
use fg_native::document::RepoDocument;
use fg_native::sections::oplog::{OpLogEntry, OpLogParts, OpLogSection};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Snapshot of the complete repository view at a specific point in time.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RepoViewSnapshot {
    /// Object id the head pointed at, if any.
    pub head_oid: Option<Oid>,
    /// Branches and the object each pointed at.
    pub branches: BTreeMap<String, Oid>,
    /// Promotion request ids that were staged.
    pub staged_promotions: Vec<String>,
    /// Wall-clock timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: i64,
}

/// Metadata describing who ran the command and what action occurred.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationMetadata {
    /// Actor that ran the command.
    pub actor: String,
    /// Command that produced the operation.
    pub command: String,
    /// Human-facing description of the effect.
    pub description: String,
    /// Wall-clock timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: i64,
}

/// Single operation node within the immutable operation DAG.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Operation {
    /// Content-derived operation id.
    pub op_id: Oid,
    /// Parent operation ids; empty for the root operation.
    pub parent_ids: Vec<Oid>,
    /// Full repository view captured at this point.
    pub view: RepoViewSnapshot,
    /// Who ran the command and why.
    pub metadata: OperationMetadata,
}

impl Operation {
    /// Constructs an operation node and derives its id from canonical bytes.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the canonical encoding cannot be produced, which
    /// can only happen for a field the format rejects (an interior NUL in a name, for instance).
    pub fn new(
        parent_ids: Vec<Oid>,
        view: RepoViewSnapshot,
        metadata: OperationMetadata,
    ) -> FractalResult<Self> {
        let parts = OpLogParts {
            parent_ids: parent_ids.clone(),
            head_oid: view.head_oid,
            branches: view
                .branches
                .iter()
                .map(|(name, oid)| (name.clone(), *oid))
                .collect(),
            staged_promotions: view.staged_promotions.clone(),
            timestamp_ms: metadata.timestamp_ms,
            actor: metadata.actor.clone(),
            command: metadata.command.clone(),
            description: metadata.description.clone(),
        };

        let record = OpLogEntry::new(parts).map_err(native_to_domain)?;

        Ok(Self {
            op_id: record.op_id,
            parent_ids,
            view,
            metadata,
        })
    }
}

/// Translates a container-layer failure into the domain error type.
///
/// The topology crate deliberately does not depend on `fg-native`'s error type in its public
/// surface: callers of `undo` should not need to know that the durable form is a container.
fn native_to_domain(error: fg_native::NativeError) -> FractalError {
    FractalError::CorruptStore(format!("operation log encoding rejected: {error}"))
}

/// Complete in-memory and disk-backed operation log DAG.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OperationGraph {
    /// Operation the graph currently considers the tip.
    pub current_head: Option<Oid>,
    /// Every operation, keyed by id.
    pub operations: BTreeMap<Oid, Operation>,
    /// Container path the graph is published to, when disk-backed.
    disk_path: Option<PathBuf>,
}

impl OperationGraph {
    /// Creates an empty in-memory operation DAG.
    pub fn in_memory() -> Self {
        Self {
            current_head: None,
            operations: BTreeMap::new(),
            disk_path: None,
        }
    }

    /// Loads or initializes the operation DAG from the repository container.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the container exists but cannot be decoded, and
    /// [`FractalError::Io`] for a filesystem failure other than absence.
    pub fn load_or_init(git_dir: &Path) -> FractalResult<Self> {
        let disk_path = fg_native::container_path(git_dir);
        if !disk_path.exists() {
            return Ok(Self {
                current_head: None,
                operations: BTreeMap::new(),
                disk_path: Some(disk_path),
            });
        }

        let document = RepoDocument::load(&disk_path).map_err(native_to_domain)?;
        let operations = document
            .oplog
            .entries()
            .iter()
            .map(|record| (record.op_id, to_operation(record)))
            .collect::<BTreeMap<Oid, Operation>>();

        let current_head = Self::leaf_head(&operations);

        Ok(Self {
            current_head,
            operations,
            disk_path: Some(disk_path),
        })
    }

    /// Finds the greatest operation id that no other operation claims as a parent.
    ///
    /// One pass to collect every claimed parent id, then one scan for the largest unclaimed key:
    /// `O(n + total_parents)`. The previous form nested a full `values()` scan inside another and
    /// ran a linear `contains` per candidate, which is `O(n^2 * parents)` — 25 million comparisons
    /// for a 5 000-operation log, paid on every load.
    fn leaf_head(operations: &BTreeMap<Oid, Operation>) -> Option<Oid> {
        let mut claimed: FastOidSet = FastOidSet::default();
        claimed.reserve(operations.len());
        for operation in operations.values() {
            for parent in &operation.parent_ids {
                claimed.insert(*parent);
            }
        }
        operations
            .keys()
            .filter(|op_id| !claimed.contains(*op_id))
            .max()
            .copied()
    }

    /// Records a new atomic repository operation and advances the current head.
    ///
    /// # Errors
    ///
    /// Propagates canonical-encoding and publication failures.
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

        let operation_node = Operation::new(parent_ids, view, metadata)?;
        let new_id = operation_node.op_id;
        self.operations.insert(new_id, operation_node);
        self.current_head = Some(new_id);

        self.persist_to_disk()?;
        Ok(new_id)
    }

    /// Performs a time-travel undo: reverts to the parent operation of the current head.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when the head or its parent is absent from the graph,
    /// and propagates publication failures.
    pub fn undo(&mut self) -> FractalResult<Option<Operation>> {
        let active_head = match self.current_head {
            Some(head_id) => head_id,
            None => return Ok(None),
        };

        let current_op = match self.operations.get(&active_head) {
            Some(found_op) => found_op.clone(),
            None => {
                return Err(FractalError::CorruptStore(format!(
                    "Corrupt operation graph: active head '{}' not found",
                    active_head.to_hex()
                )));
            }
        };

        if current_op.parent_ids.is_empty() {
            return Ok(None);
        }

        let previous_head = current_op.parent_ids[0];
        let previous_op = match self.operations.get(&previous_head) {
            Some(found_op) => found_op.clone(),
            None => {
                return Err(FractalError::CorruptStore(format!(
                    "Corrupt operation graph: parent op '{}' not found",
                    previous_head.to_hex()
                )));
            }
        };

        self.operations.remove(&active_head);
        self.current_head = Some(previous_head);
        self.persist_to_disk()?;
        Ok(Some(previous_op))
    }

    /// Returns the history of operations tracing back from the current head.
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

    /// Atomically publishes the operation DAG into the repository container.
    ///
    /// # Errors
    ///
    /// Propagates container-encoding and I/O failures.
    fn persist_to_disk(&self) -> FractalResult<()> {
        let Some(ref path) = self.disk_path else {
            return Ok(());
        };

        let mut document = if path.exists() {
            RepoDocument::load(path).map_err(native_to_domain)?
        } else {
            return Err(FractalError::CorruptStore(format!(
                "operation graph has no repository container at '{}'; run `taxis init` first",
                path.display()
            )));
        };

        document.oplog = self.to_oplog_section()?;
        document.save_atomic(path).map_err(native_to_domain)
    }

    /// Projects the in-memory graph onto the container's `OPLG` section.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when a record cannot be encoded.
    pub fn to_oplog_section(&self) -> FractalResult<OpLogSection> {
        let mut section = OpLogSection::new();
        for operation in self.operations.values() {
            let record = OpLogEntry::new(OpLogParts {
                parent_ids: operation.parent_ids.clone(),
                head_oid: operation.view.head_oid,
                branches: operation
                    .view
                    .branches
                    .iter()
                    .map(|(name, oid)| (name.clone(), *oid))
                    .collect(),
                staged_promotions: operation.view.staged_promotions.clone(),
                timestamp_ms: operation.metadata.timestamp_ms,
                actor: operation.metadata.actor.clone(),
                command: operation.metadata.command.clone(),
                description: operation.metadata.description.clone(),
            })
            .map_err(native_to_domain)?;
            section.upsert(record).map_err(native_to_domain)?;
        }
        Ok(section)
    }
}

/// Rebuilds an in-memory operation from its container record.
fn to_operation(record: &OpLogEntry) -> Operation {
    Operation {
        op_id: record.op_id,
        parent_ids: record.parent_ids.clone(),
        view: RepoViewSnapshot {
            head_oid: record.head_oid,
            branches: record
                .branches
                .iter()
                .map(|(name, oid)| (name.clone(), *oid))
                .collect(),
            staged_promotions: record.staged_promotions.clone(),
            timestamp_ms: record.timestamp_ms,
        },
        metadata: OperationMetadata {
            actor: record.actor.clone(),
            command: record.command.clone(),
            description: record.description.clone(),
            timestamp_ms: record.timestamp_ms,
        },
    }
}
