//! Module: fg-native — CRC32C (Castagnoli) Checksum Primitive
//! File Path: crates/fg-native/src/checksum.rs
//! Architecture Role: Self-contained CRC32C implementation used by every TAXC section and by
//!   the binary WAL frame codec.
//! Dependencies & Triggers: Consumed by container.rs, sections/*, and the binary WAL frame codec.
//! Responsibilities: Reflected Castagnoli polynomial checksum over a byte slice, computed with a
//!   compile-time generated 256-entry lookup table.
//! Exit Semantics & Design Rationale:
//!   - Pure Rust, no C toolchain and no build script: the `crc32c` crate's build script requires
//!     a working C compiler, which is unavailable in the constrained build hosts used here, so a
//!     self-contained implementation is the only way to keep the layer dependency-free.
//!   - The 256-entry table is generated at compile time by a `const fn`, so there is no runtime
//!     initialization and no lazy static lock.
//!   - Bit-by-bit loop is deliberate: hardware CRC32C intrinsics would require runtime feature
//!     detection plus `unsafe`, and the table-driven form already sustains the throughput needed
//!     for section-level verification.

/// Reflected Castagnoli polynomial (CRC-32C, polynomial 0x1EDC6F41 in normal form).
const CASTAGNOLI_REFLECTED: u32 = 0x82F6_3B78;

/// Initial CRC register value mandated by the CRC-32C specification.
const CRC_INIT: u32 = 0xFFFF_FFFF;

/// Builds the 256-entry reflected lookup table at compile time.
const fn build_lookup_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut slot = 0usize;
    while slot < 256 {
        let mut register = slot as u32;
        let mut bit = 0;
        while bit < 8 {
            register = if register & 1 != 0 {
                (register >> 1) ^ CASTAGNOLI_REFLECTED
            } else {
                register >> 1
            };
            bit += 1;
        }
        table[slot] = register;
        slot += 1;
    }
    table
}

/// Compile-time generated CRC32C lookup table.
static LOOKUP_TABLE: [u32; 256] = build_lookup_table();

/// Eight interleaved tables for the slicing-by-8 fast path.
///
/// Table `k` holds the CRC of a byte placed `k` positions back, which lets one step consume eight
/// bytes with eight independent table reads instead of eight dependent ones. That turns a serial
/// `1 byte/iteration` dependency chain into `8 bytes/iteration`, the standard slicing-by-8 form.
static SLICING_TABLE: [[u32; 256]; 8] = {
    let mut tables = [[0u32; 256]; 8];
    tables[0] = build_lookup_table();
    let mut level = 1usize;
    while level < 8 {
        let mut slot = 0usize;
        while slot < 256 {
            let previous = tables[level - 1][slot];
            tables[level][slot] = (previous >> 8) ^ tables[0][(previous & 0xFF) as usize];
            slot += 1;
        }
        level += 1;
    }
    tables
};

/// Computes the CRC32C (Castagnoli) checksum of `payload`.
///
/// # Examples
///
/// ```
/// use fg_native::checksum::crc32c;
///
/// assert_eq!(crc32c(b"123456789"), 0xE306_9283);
/// assert_eq!(crc32c(b""), 0x0000_0000);
/// ```
pub fn crc32c(payload: &[u8]) -> u32 {
    let mut hasher = Crc32cHasher::new();
    hasher.update(payload);
    hasher.finish()
}

/// Incrementally accumulates a CRC32C checksum across several slices.
///
/// This is the streaming form: `update` may be called repeatedly and `finish` yields the same
/// value that [`crc32c`] would produce over the concatenation of all fed slices.
#[derive(Debug, Clone, Copy)]
pub struct Crc32cHasher {
    register: u32,
}

impl Crc32cHasher {
    /// Creates a hasher with the specification-mandated initial register value.
    pub const fn new() -> Self {
        Self { register: CRC_INIT }
    }

    /// Feeds one slice into the running checksum.
    ///
    /// Consumes eight bytes per step through [`SLICING_TABLE`], then finishes the tail one byte at
    /// a time. Slicing-by-8 is used rather than the SSE4.2 `crc32q` instruction because the
    /// hardware form needs a `target_feature` split (hardware CRC32C is not part of the
    /// `x86-64-v2` baseline this workspace compiles for, and `crc32q` over 8 bytes with a 64-bit
    /// accumulator has a different finalisation than the 32-bit reflected form used here). The
    /// table form keeps one code path that is byte-identical on every target, which matters
    /// because these checksums are persisted and cross-checked against `git fsck`.
    pub fn update(&mut self, payload: &[u8]) {
        let mut register = self.register;

        let mut cursor = 0usize;
        if payload.len() >= 8 {
            while cursor <= payload.len() - 8 {
                let first = u32::from(payload[cursor])
                    ^ (u32::from(payload[cursor + 1]) << 8)
                    ^ (u32::from(payload[cursor + 2]) << 16)
                    ^ (u32::from(payload[cursor + 3]) << 24);
                let second = u32::from(payload[cursor + 4])
                    ^ (u32::from(payload[cursor + 5]) << 8)
                    ^ (u32::from(payload[cursor + 6]) << 16)
                    ^ (u32::from(payload[cursor + 7]) << 24);

                let merged = first ^ register;
                register = SLICING_TABLE[7][(merged & 0xFF) as usize]
                    ^ SLICING_TABLE[6][((merged >> 8) & 0xFF) as usize]
                    ^ SLICING_TABLE[5][((merged >> 16) & 0xFF) as usize]
                    ^ SLICING_TABLE[4][((merged >> 24) & 0xFF) as usize]
                    ^ SLICING_TABLE[3][(second & 0xFF) as usize]
                    ^ SLICING_TABLE[2][((second >> 8) & 0xFF) as usize]
                    ^ SLICING_TABLE[1][((second >> 16) & 0xFF) as usize]
                    ^ SLICING_TABLE[0][((second >> 24) & 0xFF) as usize];

                cursor += 8;
            }
        }

        while cursor < payload.len() {
            let slot = ((register ^ u32::from(payload[cursor])) & 0xFF) as usize;
            register = (register >> 8) ^ LOOKUP_TABLE[slot];
            cursor += 1;
        }

        self.register = register;
    }

    /// Finalizes the checksum, applying the specification-mandated final XOR.
    pub fn finish(self) -> u32 {
        !self.register
    }
}

impl Default for Crc32cHasher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::{crc32c, Crc32cHasher};

    #[test]
    fn matches_published_check_value() {
        assert_eq!(crc32c(b"123456789"), 0xE306_9283);
    }

    #[test]
    fn empty_input_yields_zero() {
        assert_eq!(crc32c(b""), 0x0000_0000);
    }

    #[test]
    fn known_vector_abc() {
        assert_eq!(crc32c(b"abc"), 0x364B_3FB7);
    }

    #[test]
    fn streaming_matches_one_shot() {
        let payload = b"the quick brown fox jumps over the lazy dog";
        let mut hasher = Crc32cHasher::new();
        hasher.update(&payload[..10]);
        hasher.update(&payload[10..25]);
        hasher.update(&payload[25..]);
        assert_eq!(hasher.finish(), crc32c(payload));
    }

    #[test]
    fn single_bit_flip_changes_checksum() {
        let mut mutated = *b"123456789";
        mutated[4] ^= 0x01;
        assert_ne!(crc32c(&mutated), crc32c(b"123456789"));
    }

    /// Reference implementation: the bit-at-a-time Castagnoli recurrence.
    ///
    /// Deliberately the slowest possible correct form. It shares no table with the shipping code,
    /// so agreement between the two is a real cross-check rather than a self-consistency check.
    fn reference_crc32c(payload: &[u8]) -> u32 {
        const POLY: u32 = 0x82F6_3B78;
        let mut register = 0xFFFF_FFFFu32;
        for &byte in payload {
            register ^= u32::from(byte);
            let mut bit = 0;
            while bit < 8 {
                register = if register & 1 != 0 {
                    (register >> 1) ^ POLY
                } else {
                    register >> 1
                };
                bit += 1;
            }
        }
        !register
    }

    /// Slicing-by-8 must equal the bit-at-a-time reference at every length across the 8-byte
    /// boundary. Lengths 0..=40 deliberately straddle 8, 16, 24, 32 and 40 so the bulk loop, the
    /// byte tail, and the "shorter than one block" path are all exercised.
    #[test]
    fn slicing_by_eight_agrees_with_the_bitwise_reference_across_the_block_boundary() {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        for len in 0..=40usize {
            let mut payload = Vec::with_capacity(len);
            for _ in 0..len {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                payload.push((state >> 33) as u8);
            }
            assert_eq!(
                crc32c(&payload),
                reference_crc32c(&payload),
                "disagreement at len {len}"
            );
        }
    }

    /// Streaming splits must be transparent: any partition of the same bytes yields one checksum.
    #[test]
    fn every_split_point_yields_the_same_streaming_checksum() {
        let payload: Vec<u8> = (0..37u8).collect();
        let expected = reference_crc32c(&payload);
        for split in 0..=payload.len() {
            let mut hasher = Crc32cHasher::new();
            hasher.update(&payload[..split]);
            hasher.update(&payload[split..]);
            assert_eq!(hasher.finish(), expected, "disagreement at split {split}");
        }
    }
}
