//! Module: Fractal Git Engine (Workspace Facade)
//! File Path: src/lib.rs
//! Architecture Role: Central unified facade for the Fractal Git high-performance kernel,
//!   orchestrating fg-core, fg-object, fg-index, fg-algorithms, fg-pools, fg-storage, fg-topology,
//!   fg-transport, and fg-gate micro-crates into an ergonomic, unified public API.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard (fg-core)
//! - `FGT-OBJ-001`: Git object model serialization guard (fg-object)
//! - `FGT-IDX-001`: Lockless in-memory git index concurrency guard (fg-index)
//! - `FGT-ALG-001`: Myers diff, 3-way merge, and FastCDC chunking algorithm guard (fg-algorithms)
//! - `FGT-POL-001`: Resource recycling pool bounded governor (fg-pools)
//! - `FGT-STO-001`: Storage layer crash safety guard (fg-storage)
//! - `FGT-TOP-001`: DAG topology traversal guard (fg-topology)
//! - `FGT-TRN-001`: Smart HTTP transport and packet-line streaming guard (fg-transport)
//! - `FGT-GAT-001`: Fractal Git domain gate guard (fg-gate)
//! - `FGT-CAS-001`: LayerVFS CAS snapshot materializer bridge guard (fg-storage/cas_bridge)

pub use fg_core as core;
pub use fg_object as object;
pub use fg_index as index;
pub use fg_algorithms as algorithms;
pub use fg_pools as pools;
pub use fg_storage as storage;
pub use fg_topology as fractal;
pub use fg_transport as server;
pub use fg_gate as gate;

// Backwards-compatible modular namespaces
pub mod cas {
    pub use fg_algorithms::cdc::*;
    pub use fg_storage::cas_backend::*;
    pub use fg_storage::cas_bridge::*;
}

pub mod error {
    pub use fg_core::error::*;
}

pub mod reclaimer {
    pub use fg_core::traits::reclaimer::*;
    pub use fg_gate::quota_governor::*;
    pub use fg_pools::sandbox_pool::*;
    pub use fg_pools::worktree_pool::*;
}

// Flat primary exports
pub use fg_core::error::{FractalError, FractalResult};
pub use fg_core::models::{AgentCommitMeta, GitSignature, Oid, PraxisCardContext};
pub use fg_core::traits::{
    GateVerdict, GateVerifier, OdbStore, ReclamationAudit, RefStore, StagedCandidate,
    WorktreeReclaimer,
};
pub use fg_object::{FileMode, GitBlob, GitCommit, GitTree, GitTreeEntry};

// Index exports
pub use fg_index::{ConflictStageSlot, InMemoryIndexTree, IndexStage, VirtualIndexEntry};
pub type InMemoryTreeBuilder = InMemoryIndexTree; // Compatibility alias

// Algorithm exports
pub use fg_algorithms::cdc::{ChunkDescriptor, FastCdcChunker};
pub use fg_algorithms::diff::{ChangeKind, DiffEntry, PatchGenerator, PatchHunk, PatchLine, TreeDiff, UnifiedPatch};
pub use fg_algorithms::merge::{ConflictEntry, ThreeWayMerge, ThreeWayMergeResult};
pub use fg_algorithms::traverse::DagWalker;

// Pool exports
pub use fg_pools::buffer_pool::PageBufferPool;
pub use fg_pools::object_pool::{RecyclePool, Resettable};
pub use fg_pools::sandbox_pool::{SandboxPool, SandboxSlot};
pub use fg_pools::worktree_pool::{WorktreeDescriptor, WorktreePool};

// Storage exports
pub use fg_storage::cas_backend::CasBackend;
pub use fg_storage::cas_bridge::{CasFileDescriptor, CasToGitMaterializer, MaterializeRequest};
pub use fg_storage::loose::{write_loose_object, LooseOdb};
pub use fg_storage::wal_journal::{WalJournal, WalRecord};

// Topology exports
pub use fg_topology::refs::{DiskRefStore, FractalRef};
pub use fg_topology::state_machine::{FractalWorkspaceNode, WorktreeState};
pub use fg_topology::verifier::TopologyVerifier;
pub use fg_topology::worktree::{FractalWorktree, PathJail};

// Transport exports
pub use fg_transport::ipc::{IpcCodec, IpcMessage};
pub use fg_transport::packetline::{PacketLine, PKT_DELIM, PKT_FLUSH};
pub use fg_transport::smart_protocol::ProtocolV2Handler;

// Gate & Policy exports
pub use fg_gate::conflict_guard::ConflictGuard;
pub use fg_gate::pre_receive::{AgentPushContext, PreReceiveGuard};
pub use fg_gate::quota_governor::QuotaGovernor;
pub type WorkspaceQuotaGuard = QuotaGovernor; // Compatibility alias
