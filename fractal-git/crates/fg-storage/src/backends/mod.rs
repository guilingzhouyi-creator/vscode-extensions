//! Module: fg-storage — Git Object Store Backends Facade
//! File Path: crates/fg-storage/src/backends/mod.rs
//! Architecture Role: Groups the compatibility-side object readers that decode Git's own on-disk
//!   format (pack, index, multi-pack index) and the router that selects among them.
//! Dependencies & Triggers: Re-exported by [`crate`]; consumed by every read command.
//! Responsibilities: Declare the backend modules and re-export their public surfaces.
//! Exit Semantics & Design Rationale:
//!   - These readers are the only place in the workspace that understands Git's pack layout. The
//!     Taxis-native container lives in `fg-native` and shares nothing with them, which is what keeps
//!     "read Git repositories" separable from "Taxis has its own format".

pub mod fanout;
pub mod idx_file;
pub mod idx_writer;
pub mod midx_file;
pub mod midx_writer;
pub mod odb_router;
pub mod pack_bitmap;
pub mod pack_file;
pub mod pack_writer;

pub use idx_file::PackIndex;
pub use idx_writer::IdxWriter;
pub use midx_file::{MultiPackIndex, PackLocation};
pub use midx_writer::MidxWriter;
pub use odb_router::{OdbRouter, DEFAULT_ROUTER_CACHE_BYTES};
pub use pack_bitmap::{PackBitmap, BITMAP_MAGIC, BITMAP_VERSION_1};
pub use pack_file::{DeltaBaseSource, PackFile, PackedObject, MAX_CHAIN_DEPTH};
pub use pack_writer::{crc32_ieee, PackEntryMeta, PackWriter};
