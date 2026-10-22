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
    let mut register = CRC_INIT;
    for &byte in payload {
        let slot = ((register ^ u32::from(byte)) & 0xFF) as usize;
        register = (register >> 8) ^ LOOKUP_TABLE[slot];
    }
    !register
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
    pub fn update(&mut self, payload: &[u8]) {
        let mut register = self.register;
        for &byte in payload {
            let slot = ((register ^ u32::from(byte)) & 0xFF) as usize;
            register = (register >> 8) ^ LOOKUP_TABLE[slot];
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
}
