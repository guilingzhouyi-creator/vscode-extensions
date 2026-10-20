//! Module: fg-pools — Resource Pooling & Zero-Heap Allocation Subsystem
//! File Path: crates/fg-pools/src/lib.rs
//! Architecture Role: Pure high-performance resource pooling subsystem strictly adhering
//!   to ADV-PRF-002, providing reusable buffers, AST object recyclers, and virtual sandbox slots.

pub mod buffer_pool;
pub mod lru_cache;
pub mod object_pool;
pub mod sandbox_pool;
pub mod worktree_pool;

pub use buffer_pool::{BufferSizeClass, PageBufferPool};
pub use lru_cache::ByteLruCache;
pub use object_pool::{RecyclePool, Resettable};
pub use sandbox_pool::{SandboxPool, SandboxSlot};
pub use worktree_pool::{WorktreeDescriptor, WorktreeMode, WorktreePool};
