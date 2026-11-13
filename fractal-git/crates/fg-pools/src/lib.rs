//! Module: fg-pools — Resource Pooling & Zero-Heap Allocation Subsystem
//! File Path: crates/fg-pools/src/lib.rs
//! Architecture Role: Pure high-performance resource pooling subsystem strictly guaranteeing
//!   zero transient heap allocations in critical hot loops, providing reusable byte buffers,
//!   object recyclers, and virtual worktree slots.
//! Dependencies & Triggers: Consumed by fg-storage, fg-algorithms, fg-topology, and Taxis CLI.
//! Responsibilities: Buffer size classes, page recycling, object pooling, worktree slots,
//!   and deterministic capacity / zero-allocation budget validation.
//! Exit Semantics & Design Rationale: Bounded capacity with reset-state contracts on release,
//!   enforcing substantive facade validation (`ARCH-FAC-001`, `FGT-PRF-001`).
//!
//! Domain Governance Rules: FGT-PRF-001 (resource pooling subsystem), FGT-COR-001, FGT-POL-001.

use fg_core::error::{FractalError, FractalResult};

pub mod buffer_pool;
pub mod lru_cache;
pub mod object_pool;
pub mod sandbox_pool;
pub mod worktree_pool;

pub use buffer_pool::{BufferSizeClass, PageBufferPool, PooledBuffer};
pub use lru_cache::ByteLruCache;
pub use object_pool::{RecyclePool, Resettable};
pub use sandbox_pool::{SandboxPool, SandboxSlot};
pub use worktree_pool::{WorktreeDescriptor, WorktreeMode, WorktreePool};

/// Canonical contract version for the `fg-pools` resource management facade.
pub const POOL_CONTRACT_VERSION: u16 = 1;

/// Default page buffer capacity in bytes (64 KiB).
pub const DEFAULT_POOL_PAGE_BYTES: usize = buffer_pool::DEFAULT_PAGE_SIZE;

/// Maximum buffer capacity retained in thread-local or shared freelists (2 MiB).
pub const MAX_POOL_RETAINED_BYTES: usize = buffer_pool::MAX_RETAINED_BUFFER_BYTES;

/// Immutable budget contract summarizing pool size classes and zero-allocation promises.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PoolBudgetContract {
    /// Facade contract schema version.
    pub contract_version: u16,
    /// Small size-class threshold in bytes (4 KiB).
    pub small_class_bytes: usize,
    /// Page size-class threshold in bytes (64 KiB).
    pub page_class_bytes: usize,
    /// Large size-class threshold in bytes (1 MiB).
    pub large_class_bytes: usize,
    /// Hard ceiling above which transient buffers are dropped instead of retained.
    pub max_retained_bytes: usize,
    /// Guarantees steady-state hot-loop acquisition performs zero transient heap allocations.
    pub zero_loop_heap_alloc: bool,
}

/// Returns the compile-time immutable budget contract for `fg-pools`.
pub const fn pool_budget_contract() -> PoolBudgetContract {
    PoolBudgetContract {
        contract_version: POOL_CONTRACT_VERSION,
        small_class_bytes: BufferSizeClass::Small as usize,
        page_class_bytes: BufferSizeClass::Page as usize,
        large_class_bytes: BufferSizeClass::Large as usize,
        max_retained_bytes: MAX_POOL_RETAINED_BYTES,
        zero_loop_heap_alloc: true,
    }
}

/// Selects the smallest [`BufferSizeClass`] able to hold `required_bytes`, or `None` if the
/// request exceeds [`MAX_POOL_RETAINED_BYTES`] and must stream directly without freelist pinning.
pub const fn select_buffer_size_class(required_bytes: usize) -> Option<BufferSizeClass> {
    if required_bytes <= BufferSizeClass::Small as usize {
        Some(BufferSizeClass::Small)
    } else if required_bytes <= BufferSizeClass::Page as usize {
        Some(BufferSizeClass::Page)
    } else if required_bytes <= MAX_POOL_RETAINED_BYTES {
        Some(BufferSizeClass::Large)
    } else {
        None
    }
}

/// Validates that a requested pool capacity is strictly positive and within `max_ceiling`.
///
/// # Errors
///
/// Returns [`FractalError::PolicyViolation`] when `capacity` is zero or exceeds `max_ceiling`.
pub fn validate_pool_capacity(capacity: usize, max_ceiling: usize) -> FractalResult<usize> {
    if capacity == 0 {
        return Err(FractalError::PolicyViolation(
            "pool capacity must be greater than zero".to_owned(),
        ));
    }
    if capacity > max_ceiling {
        return Err(FractalError::PolicyViolation(format!(
            "pool capacity {capacity} exceeds ceiling {max_ceiling}"
        )));
    }
    Ok(capacity)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_budget_and_size_class_selection_work() {
        let contract = pool_budget_contract();
        assert_eq!(contract.contract_version, POOL_CONTRACT_VERSION);
        assert!(contract.zero_loop_heap_alloc);
        assert_eq!(contract.page_class_bytes, DEFAULT_POOL_PAGE_BYTES);

        assert_eq!(select_buffer_size_class(512), Some(BufferSizeClass::Small));
        assert_eq!(
            select_buffer_size_class(16 * 1024),
            Some(BufferSizeClass::Page)
        );
        assert_eq!(
            select_buffer_size_class(512 * 1024),
            Some(BufferSizeClass::Large)
        );
        assert_eq!(select_buffer_size_class(MAX_POOL_RETAINED_BYTES + 1), None);

        assert_eq!(validate_pool_capacity(8, 64).ok(), Some(8));
        assert!(validate_pool_capacity(0, 64).is_err());
        assert!(validate_pool_capacity(65, 64).is_err());
    }
}
