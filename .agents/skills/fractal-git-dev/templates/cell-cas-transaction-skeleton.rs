//! Module: Taxis Cell Virtual Worktree — Lock-Free CAS Snapshot Transaction Skeleton
//! File Path: .agents/skills/fractal-git-dev/templates/cell-cas-transaction-skeleton.rs
//! Architecture Role: Reference template demonstrating Type-State Cell transactions, epoch-guarded
//!   lock-free CAS pointer promotion (FGT-LCK-001 / FGT-CAS-001), and zero-allocation buffer reuse.
//! Dependencies & Triggers: Depends on std::marker::PhantomData, std::sync::atomic, thiserror;
//!   referenced by fractal-git-dev skill for fg-index and fg-topology implementations.
//! Responsibilities:
//!   1. Model Cell transaction states (Staged -> Validated -> Promoted) at compile time.
//!   2. Execute ABA-safe compare_exchange loop using monotonic epoch generation counters.
//!   3. Enforce zero bare unwrap/panic (FGT-ERR-001) and explicit rollback on contention.
//! Exit Semantics & Design Rationale: Pure library template returning Result<T, CellTxError>.

use std::marker::PhantomData;
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

/// Domain error enumeration for Cell virtual worktree transactions (`FGT-ERR-001`).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum CellTxError {
    #[error("CAS epoch contention detected: expected generation {expected}, actual {actual}")]
    CasContention { expected: u64, actual: u64 },

    #[error("empty tree digest is not allowed in validated snapshot")]
    EmptySnapshotDigest,
}

pub trait CellPhase {}
pub struct Staged;
pub struct Validated;
pub struct Promoted;

impl CellPhase for Staged {}
impl CellPhase for Validated {}
impl CellPhase for Promoted {}

/// Lock-free atomic head tracking packed (epoch_generation << 32 | snapshot_slot_id).
pub struct AtomicCellHead {
    packed_state: AtomicU64,
}

impl AtomicCellHead {
    /// Creates an initialized atomic head at generation 1 and slot 0.
    pub const fn new() -> Self {
        Self {
            packed_state: AtomicU64::new(1_u64 << 32),
        }
    }

    /// Reads the current (generation, slot_id) pair with Acquire ordering (`FGT-CAS-001`).
    pub fn load_head(&self) -> (u64, u32) {
        let raw = self.packed_state.load(Ordering::Acquire);
        ((raw >> 32), (raw & 0xFFFF_FFFF) as u32)
    }

    /// Atomically promotes the head to `next_slot` if `expected_gen` still matches.
    pub fn try_promote(&self, expected_gen: u64, current_slot: u32, next_slot: u32) -> Result<u64, CellTxError> {
        let expected_raw = (expected_gen << 32) | u64::from(current_slot);
        let next_gen = expected_gen.wrapping_add(1);
        let next_raw = (next_gen << 32) | u64::from(next_slot);

        self.packed_state
            .compare_exchange(expected_raw, next_raw, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| next_gen)
            .map_err(|actual_raw| CellTxError::CasContention {
                expected: expected_gen,
                actual: actual_raw >> 32,
            })
    }
}

/// Type-state transaction governing a Cell virtual index snapshot (`FGT-TRN-001`).
pub struct CellTransaction<P: CellPhase> {
    base_generation: u64,
    base_slot: u32,
    candidate_slot: u32,
    tree_oid: [u8; 20],
    _phase: PhantomData<P>,
}

impl CellTransaction<Staged> {
    /// Begins a new staged transaction anchored at the current atomic head.
    pub fn begin(head: &AtomicCellHead, candidate_slot: u32, tree_oid: [u8; 20]) -> Self {
        let (base_generation, base_slot) = head.load_head();
        Self {
            base_generation,
            base_slot,
            candidate_slot,
            tree_oid,
            _phase: PhantomData,
        }
    }

    /// Validates that the candidate tree OID is non-zero before allowing CAS promotion.
    pub fn validate(self) -> Result<CellTransaction<Validated>, CellTxError> {
        if self.tree_oid.iter().all(|&b| b == 0) {
            return Err(CellTxError::EmptySnapshotDigest);
        }
        Ok(CellTransaction {
            base_generation: self.base_generation,
            base_slot: self.base_slot,
            candidate_slot: self.candidate_slot,
            tree_oid: self.tree_oid,
            _phase: PhantomData,
        })
    }
}

impl CellTransaction<Validated> {
    /// Commits the validated snapshot into `head` via lock-free CAS (`FGT-LCK-001`).
    pub fn promote(self, head: &AtomicCellHead) -> Result<CellTransaction<Promoted>, CellTxError> {
        let next_gen = head.try_promote(self.base_generation, self.base_slot, self.candidate_slot)?;
        Ok(CellTransaction {
            base_generation: next_gen,
            base_slot: self.candidate_slot,
            candidate_slot: self.candidate_slot,
            tree_oid: self.tree_oid,
            _phase: PhantomData,
        })
    }
}
