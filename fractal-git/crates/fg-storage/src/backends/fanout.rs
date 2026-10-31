//! Module: fg-storage::backends::fanout — Shared 256-Bucket Fanout & OID Binary Search
//! File Path: crates/fg-storage/src/backends/fanout.rs
//! Architecture Role: Canonical zero-copy lookup primitives shared across Git Pack Index (`.idx`),
//!   Multi-Pack Index (`MIDX`), and Commit-Graph (`CGPH`) readers.
//! Dependencies & Triggers: Invoked on every O(1) fanout hull lookup and O(log N) OID binary search
//!   in `idx_file`, `midx_file`, and `commit_graph`.
//! Responsibilities: Decode big-endian 32-bit and 64-bit words safely from byte slices without
//!   panicking, extract `[low, high)` index bounds from a 256-entry cumulative fanout table, and
//!   binary-search fixed-stride 20-byte OID tables in `O(log(N / 256))` comparisons.
//! Exit Semantics & Design Rationale:
//!   - Consolidates three near-identical fanout + binary-search implementations (`D9`) into one
//!     bounds-checked implementation so stride and boundary edge cases cannot diverge.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Zero transient heap allocation guard in hot lookup paths

/// Number of fanout buckets: one per possible leading byte (`0x00..=0xFF`).
pub const FANOUT_BUCKETS: usize = 256;

/// Byte width of one 32-bit big-endian fanout entry.
pub const FANOUT_ENTRY_LEN: usize = 4;

/// Byte width of a SHA-1 object identifier.
pub const OID_LEN: usize = 20;

/// Reads a big-endian `u32` at `start`, returning `0` if fewer than 4 bytes remain.
#[inline]
#[must_use]
pub fn read_be_u32(bytes: &[u8], start: usize) -> u32 {
    match bytes.get(start..start + 4) {
        Some(slice) => u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]),
        None => 0,
    }
}

/// Reads a big-endian `u64` at `start`, returning `0` if fewer than 8 bytes remain.
#[inline]
#[must_use]
pub fn read_be_u64(bytes: &[u8], start: usize) -> u64 {
    match bytes.get(start..start + 8) {
        Some(slice) => u64::from_be_bytes([
            slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
        ]),
        None => 0,
    }
}

/// Reads the cumulative count stored in fanout slot `bucket` (`0..256`).
#[inline]
#[must_use]
pub fn fanout_bucket(bytes: &[u8], fanout_start: usize, bucket: usize) -> usize {
    read_be_u32(bytes, fanout_start + bucket * FANOUT_ENTRY_LEN) as usize
}

/// Resolves the half-open `[low, high)` table index interval narrowed by `first_byte`.
#[inline]
#[must_use]
pub fn fanout_range(bytes: &[u8], fanout_start: usize, first_byte: u8) -> (usize, usize) {
    let bucket = usize::from(first_byte);
    let low = if bucket == 0 {
        0
    } else {
        fanout_bucket(bytes, fanout_start, bucket - 1)
    };
    let high = fanout_bucket(bytes, fanout_start, bucket);
    (low, high)
}

/// Binary-searches a sorted table of 20-byte OIDs starting at `table_start` with `stride` bytes
/// between consecutive OID records (`stride == 20` for contiguous v2/MIDX/CGPH tables, `stride == 24`
/// for interleaved v1 `.idx` tables).
#[must_use]
pub fn binary_search_oid_table(
    bytes: &[u8],
    table_start: usize,
    stride: usize,
    low: usize,
    high: usize,
    target: &[u8; OID_LEN],
) -> Option<usize> {
    let mut left = low;
    let mut right = high;
    while left < right {
        let mid = left + (right - left) / 2;
        let start = table_start.checked_add(mid.checked_mul(stride)?)?;
        let candidate = bytes.get(start..start + OID_LEN)?;
        match candidate.cmp(&target[..]) {
            std::cmp::Ordering::Less => left = mid + 1,
            std::cmp::Ordering::Greater => right = mid,
            std::cmp::Ordering::Equal => return Some(mid),
        }
    }
    None
}
