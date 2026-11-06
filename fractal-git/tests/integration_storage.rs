//! Integration Test Harness: Storage, Index, Object Codec & In-Place Engine
//! File Path: tests/integration_storage.rs
//! Architecture Role: Consolidates storage, memory pool, and TIPSE in-place engine
//!   integration tests into a single compiled binary harness, eliminating cargo linker sprawl.

#[path = "rust/support/cli_harness.rs"]
pub mod cli_harness;

#[path = "rust/test_storage.rs"]
mod test_storage;

#[path = "rust/test_object_codec.rs"]
mod test_object_codec;

#[path = "rust/test_tag_codec.rs"]
mod test_tag_codec;

#[path = "rust/test_pack_generation.rs"]
mod test_pack_generation;

#[path = "rust/test_in_place_engine.rs"]
mod test_in_place_engine;

#[path = "rust/test_tipse_safety.rs"]
mod test_tipse_safety;

#[path = "rust/test_pools.rs"]
mod test_pools;

#[path = "rust/test_index.rs"]
mod test_index;

#[path = "rust/test_in_memory_index.rs"]
mod test_in_memory_index;

#[path = "rust/test_commit_materializer.rs"]
mod test_commit_materializer;
