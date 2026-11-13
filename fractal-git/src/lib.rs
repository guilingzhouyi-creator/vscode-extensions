//! Module: Fractal Git Engine (Workspace Facade)
//! File Path: src/lib.rs
//! Architecture Role: Central unified facade for the Fractal Git high-performance kernel,
//!   orchestrating fg-core, fg-object, fg-index, fg-algorithms, fg-pools, fg-native, fg-storage,
//!   fg-topology, fg-transport, and fg-gate kernel subsystems into one ergonomic public API.
//! Dependencies & Triggers: Depended upon by the Taxis CLI binary and integration test suites.
//! Responsibilities: Unified root API facade and rule catalog.
//! Exit Semantics & Design Rationale:
//!   - `FileMode` and `IndexStage` are re-exported from `fg-core`, not from `fg-object` or
//!     `fg-index`. They are domain value objects shared by every layer, so the facade must expose
//!     exactly one path to each.
//!   - No compatibility aliases are kept for renamed types. An alias keeps the old name alive at
//!     every call site, which is precisely what a rename is meant to remove.
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

pub use fg_algorithms as algorithms;
pub use fg_core as core;
pub use fg_gate as gate;
pub use fg_index as index;
pub use fg_object as object;
pub use fg_pools as pools;
pub use fg_storage as storage;
pub use fg_topology as fractal;
pub use fg_transport as server;

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
pub use fg_core::constants;
pub use fg_core::error::{FractalError, FractalResult};
pub use fg_core::models::{
    ActorIdentity, AgentCommitMeta, AgentPushContext, AuditHashChain, AuditIkceVerdict,
    AuditRecord, AuditScore, AuditTkcvVerdict, AuthorityTier, AutoQualityScoreEnvelope,
    BlackboardCollision, BlockProvenanceEntry, BlockProvenanceParams, BranchEnforcementTier,
    BranchPolicySpec, CardBlackboard, ChangeId, ConflictPresentationMode, DiffCoherenceMode,
    ElevationAttestation, EnforcementTier, FileMode, FileUid, FractalSubLease, GitSignature,
    IndexStage, IntentLease, LeaseStatus, MutationBudget, Oid, PraxisCardContext, ProjectLease,
    ProjectLeaseCache, ProvenanceLedger, QuarantineRegistry, RegistrationOrigin, ReservationStatus,
    ReservedFileToken, SealedPolicyPayload, SliceAuthorization, StagedPromotionRequest,
    StagedPromotionStatus, SubAuthorizationZone, TaxisPolicy, UnsignedAuditRecordParams,
    ValidatedCommitWitness, AUDIT_RECORD_BYTE_BUDGET, GENESIS_PREV_HASH,
};
pub use fg_core::traits::{
    AgentWorktreeHandle, GateVerdict, GateVerifier, OdbStore, ReclamationAudit, RefStore,
    StagedCandidate, TaxisEngine, WorktreeReclaimer,
};
pub use fg_object::{
    GitBlob, GitCommit, GitCommitRef, GitTag, GitTree, GitTreeEntry, GitTreeEntryRef, GitTreeIter,
    GitTreeRef, SmallParentList, TagCodecError,
};

// Index exports
pub use fg_index::{
    ConflictStageSlot, DirtyCollision, DirtyCollisionKind, DirtyWorktreeGuard, InMemoryIndexTree,
    StagingEntry,
};

// Algorithm exports
pub use fg_algorithms::cdc::{ChunkDescriptor, FastCdcChunker};
pub use fg_algorithms::diff::{
    ChangeKind, DiffEntry, PatchGenerator, PatchHunk, PatchLine, TreeDiff, TreeDiffState,
    UnifiedPatch,
};
pub use fg_algorithms::math::{
    compute_jeffreys_credible_lower, evaluate_score_envelope, PosteriorScoreEstimate,
};
pub use fg_algorithms::merge::{
    AlgebraicMerge, BlockMergeResult, BlockThreeWayMerge, CanonicalConflictEntry,
    CanonicalMergeResult, ConflictEntry, FastPathMerge, TextMergeResult, TextThreeWayMerge,
    ThreeWayMerge, ThreeWayMergeResult, VirtualMergeBaseSynthesizer,
};
pub use fg_algorithms::synthetic::{
    generate_commit_chain, generate_diamond_dag, generate_monorepo_trees, SyntheticCommitChain,
    SyntheticDag, SyntheticMonorepo,
};
pub use fg_algorithms::traverse::{DagWalker, FastOidHasher, FastOidSet};

// Pool exports
pub use fg_pools::buffer_pool::{BufferSizeClass, PageBufferPool};
pub use fg_pools::lru_cache::ByteLruCache;
pub use fg_pools::object_pool::{RecyclePool, Resettable};
pub use fg_pools::sandbox_pool::{SandboxPool, SandboxSlot};
pub use fg_pools::worktree_pool::{WorktreeDescriptor, WorktreeMode, WorktreePool};

// Storage exports
pub use fg_storage::backends::{
    IdxWriter, MultiPackIndex, OdbRouter, PackFile, PackIndex, PackLocation, PackWriter,
    PackedObject,
};
pub use fg_storage::cas_backend::CasBackend;
pub use fg_storage::cas_bridge::{CasFileDescriptor, CasToGitMaterializer, MaterializeRequest};
pub use fg_storage::commit_graph::{CommitGraphEntry, CommitGraphReader, CommitGraphWriter};
pub use fg_storage::commit_materializer::{
    materialize_commit, persist_commit_object, persist_index_tree, read_full_tree_entries,
    serialize_commit_payload, serialize_tree_payload, write_commit_objects,
    CommitMaterializationRequest, MaterializedCommit,
};
pub use fg_storage::loose::{write_loose_object, LooseOdb};
pub use fg_storage::reflink::{
    clone_file_cow, detach_for_write, is_readonly, set_readonly, ReflinkKind,
};
pub use fg_storage::repack::{scan_loose_objects, RepackEngine, RepackOptions, RepackReport};
pub use fg_storage::wal_journal::{WalJournal, WalRecord};

// Topology exports
pub use fg_topology::authorizer::{ElevationAuthorizer, StandardNonceAuthorizer};
pub use fg_topology::blackboard::{DiskBlackboardStore, BLACKBOARD_DIR};
pub use fg_topology::conflict_tree::{
    AgentConflictSliceReport, ConflictSlice, ConflictTreeManager,
};
pub use fg_topology::history_rollup::{
    CardMilestoneRecord, HierarchicalHistoryRollup, HierarchicalRollupFolder, MilestoneRollupEntry,
    PyramidFolder,
};
pub use fg_topology::operation::{Operation, OperationGraph, OperationMetadata, RepoViewSnapshot};
pub use fg_topology::project_store::{DiskProjectStore, PROJECTS_CACHE_FILE, PROJECTS_DIR};
pub use fg_topology::promotion_ledger::{PromotionLedgerData, PromotionStagingLedger};
pub use fg_topology::provenance::{DiskProvenanceStore, PROVENANCE_FILE};
pub use fg_topology::refs::{
    apply_os_telemetry_protection, reset_file_write_permission, DiskRefStore, FractalRef, HeadState,
};
pub use fg_topology::state_machine::{FractalWorkspaceNode, WorktreeState};
pub use fg_topology::telemetry::{
    CommitCountVerdict, CommitCounter, CommitTelemetryConfig, TelemetryCommitNode,
};
pub use fg_topology::verifier::TopologyVerifier;
pub use fg_topology::worktree::{FractalWorktree, PathJail, ScopeProjection};

// Transport exports
pub use fg_transport::ipc::{IpcCodec, IpcMessage};
pub use fg_transport::packetline::{PacketLine, PKT_DELIM, PKT_FLUSH};
pub use fg_transport::smart_protocol::ProtocolV2Handler;

// Gate & Policy exports
pub use fg_gate::auto_audit_hook::AutoAuditHook;
pub use fg_gate::branch_guard::{
    BranchBypassContext, BranchFloorSource, BranchGateOutcome, BranchGovernanceFloor, BranchGuard,
};
pub use fg_gate::canary::{
    CanaryConfig, CanaryReport, KernelCanaryEngine, MutantDescriptor, MutationKind,
    ShadowCanaryEngine,
};
pub use fg_gate::commit_guard::CommitMessageGuard;
pub use fg_gate::conflict_guard::ConflictGuard;
pub use fg_gate::credit::{
    AgentCreditController, AgentCreditScore, QuarantineRecord, QuarantineRequestParams,
    QuarantineStatus,
};
pub use fg_gate::git_hook::{
    hook_argument_path, GitHookOutcome, GitHookRunner, GitHookStatus, HookConfig,
};
pub use fg_gate::hook::{
    CommitGovernanceHook, ElevationPromotionGateHook, FractalHook, HookContext, HookPipeline,
    HookTier, HookVerdict, HygieneConflictHook,
};
pub use fg_gate::policy_floor::{PolicyFloor, PolicyVaultHealth};
pub use fg_gate::pre_receive::PreReceiveGuard;
pub use fg_gate::quota_governor::QuotaGovernor;
pub use fg_gate::verifier::{
    KernelAstVerifier, VerifierConfig, VerifierViolation, ViolationSeverity,
};

// Benchmark & Performance Ratchet exports
pub mod audit_runner;
pub mod bench;
pub mod pathspec;
pub use bench::{BaselineComparisonVerdict, BenchmarkLevel, BenchmarkMetric, TaxisBenchmarkSuite};
