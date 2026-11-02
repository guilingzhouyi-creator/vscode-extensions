//! Module: fg-core::crypto::sm3 — GB/T 32918.4 Sovereign SM3 Cryptographic Hash
//! File Path: crates/fg-core/src/crypto/sm3.rs
//! Architecture Role: Pure Rust zero-allocation GB/T 32918.4-2016 cryptographic hash implementation.
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001 (zero transient heap allocation).

/// Standard initial vector constants defined by GB/T 32918.4-2016 section 4.1.
const INITIAL_VECTOR_IV: [u32; 8] = [
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
    0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

/// SM3 input block size in bytes (512 bits / 64 bytes).
pub const SM3_BLOCK_SIZE_BYTES: usize = 64;

/// SM3 digest output size in bytes (256 bits / 32 bytes).
pub const SM3_DIGEST_SIZE_BYTES: usize = 32;

#[inline(always)]
const fn permutation_p0(word: u32) -> u32 {
    word ^ word.rotate_left(9) ^ word.rotate_left(17)
}

#[inline(always)]
const fn permutation_p1(word: u32) -> u32 {
    word ^ word.rotate_left(15) ^ word.rotate_left(23)
}

#[inline(always)]
const fn boolean_function_ff(word_x: u32, word_y: u32, word_z: u32, round_index: usize) -> u32 {
    if round_index < 16 { word_x ^ word_y ^ word_z } else { (word_x & word_y) | (word_x & word_z) | (word_y & word_z) }
}

#[inline(always)]
const fn boolean_function_gg(word_x: u32, word_y: u32, word_z: u32, round_index: usize) -> u32 {
    if round_index < 16 { word_x ^ word_y ^ word_z } else { (word_x & word_y) | (!word_x & word_z) }
}

#[inline(always)]
const fn round_constant_t(round_index: usize) -> u32 {
    if round_index < 16 { 0x79cc4519 } else { 0x7a879d8a }
}

/// Streaming state machine for GB/T 32918.4 SM3 256-bit cryptographic digest.
#[derive(Clone, Copy)]
pub struct Sm3Hasher {
    intermediate_state: [u32; 8],
    block_buffer: [u8; SM3_BLOCK_SIZE_BYTES],
    buffer_length: usize,
    total_bytes_processed: u64,
}

impl Default for Sm3Hasher {
    fn default() -> Self {
        Self {
            intermediate_state: INITIAL_VECTOR_IV,
            block_buffer: [0u8; SM3_BLOCK_SIZE_BYTES],
            buffer_length: 0,
            total_bytes_processed: 0,
        }
    }
}

impl Sm3Hasher {
    /// Creates a new SM3 hasher instance initialized with standard IV constants.
    pub const fn new() -> Self {
        Self {
            intermediate_state: INITIAL_VECTOR_IV,
            block_buffer: [0u8; SM3_BLOCK_SIZE_BYTES],
            buffer_length: 0,
            total_bytes_processed: 0,
        }
    }

    /// Feeds additional input bytes into the incremental SM3 digest state machine.
    pub fn update(&mut self, payload: &[u8]) {
        self.total_bytes_processed += payload.len() as u64;
        let mut payload_cursor = 0;
        if self.buffer_length > 0 {
            let bytes_to_copy = (SM3_BLOCK_SIZE_BYTES - self.buffer_length).min(payload.len());
            self.block_buffer[self.buffer_length..self.buffer_length + bytes_to_copy]
                .copy_from_slice(&payload[..bytes_to_copy]);
            self.buffer_length += bytes_to_copy;
            payload_cursor += bytes_to_copy;
            if self.buffer_length == SM3_BLOCK_SIZE_BYTES {
                self.compress_internal_buffer();
                self.buffer_length = 0;
            }
        }
        while payload_cursor + SM3_BLOCK_SIZE_BYTES <= payload.len() {
            let mut block = [0u8; SM3_BLOCK_SIZE_BYTES];
            block.copy_from_slice(&payload[payload_cursor..payload_cursor + SM3_BLOCK_SIZE_BYTES]);
            self.compress_block_chunk(&block);
            payload_cursor += SM3_BLOCK_SIZE_BYTES;
        }
        if payload_cursor < payload.len() {
            let remaining_bytes = payload.len() - payload_cursor;
            self.block_buffer[..remaining_bytes].copy_from_slice(&payload[payload_cursor..]);
            self.buffer_length = remaining_bytes;
        }
    }

    /// Consumes the hasher, applies PKCS padding, and returns the 32-byte SM3 digest.
    pub fn finalize(mut self) -> [u8; SM3_DIGEST_SIZE_BYTES] {
        let total_length_bits = self.total_bytes_processed * 8;
        self.block_buffer[self.buffer_length] = 0x80;
        self.buffer_length += 1;
        if self.buffer_length > 56 {
            self.block_buffer[self.buffer_length..SM3_BLOCK_SIZE_BYTES].fill(0);
            self.compress_internal_buffer();
            self.block_buffer.fill(0);
        } else {
            self.block_buffer[self.buffer_length..56].fill(0);
        }
        self.block_buffer[56..SM3_BLOCK_SIZE_BYTES]
            .copy_from_slice(&total_length_bits.to_be_bytes());
        self.compress_internal_buffer();

        let mut final_digest = [0u8; SM3_DIGEST_SIZE_BYTES];
        for (word_index, word) in self.intermediate_state.iter().enumerate() {
            final_digest[word_index * 4..(word_index + 1) * 4].copy_from_slice(&word.to_be_bytes());
        }
        final_digest
    }

    fn compress_internal_buffer(&mut self) {
        let block_copy = self.block_buffer;
        self.compress_block_chunk(&block_copy);
    }

    fn compress_block_chunk(&mut self, block: &[u8; SM3_BLOCK_SIZE_BYTES]) {
        let mut message_schedule_w = [0u32; 68];
        for round_index in 0..16 {
            message_schedule_w[round_index] = u32::from_be_bytes([
                block[round_index * 4],
                block[round_index * 4 + 1],
                block[round_index * 4 + 2],
                block[round_index * 4 + 3],
            ]);
        }
        for round_index in 16..68 {
            let intermediate_x = message_schedule_w[round_index - 16]
                ^ message_schedule_w[round_index - 9]
                ^ message_schedule_w[round_index - 3].rotate_left(15);
            message_schedule_w[round_index] = permutation_p1(intermediate_x)
                ^ message_schedule_w[round_index - 13].rotate_left(7)
                ^ message_schedule_w[round_index - 6];
        }
        let (mut reg_a, mut reg_b, mut reg_c, mut reg_d) =
            (self.intermediate_state[0], self.intermediate_state[1], self.intermediate_state[2], self.intermediate_state[3]);
        let (mut reg_e, mut reg_f, mut reg_g, mut reg_h) =
            (self.intermediate_state[4], self.intermediate_state[5], self.intermediate_state[6], self.intermediate_state[7]);

        for round_index in 0..64 {
            let shift_intermediate_1 = (reg_a
                .rotate_left(12)
                .wrapping_add(reg_e)
                .wrapping_add(round_constant_t(round_index).rotate_left((round_index % 32) as u32)))
            .rotate_left(7);
            let shift_intermediate_2 = shift_intermediate_1 ^ reg_a.rotate_left(12);
            let temp_intermediate_1 = boolean_function_ff(reg_a, reg_b, reg_c, round_index)
                .wrapping_add(reg_d)
                .wrapping_add(shift_intermediate_2)
                .wrapping_add(message_schedule_w[round_index] ^ message_schedule_w[round_index + 4]);
            let temp_intermediate_2 = boolean_function_gg(reg_e, reg_f, reg_g, round_index)
                .wrapping_add(reg_h)
                .wrapping_add(shift_intermediate_1)
                .wrapping_add(message_schedule_w[round_index]);
            reg_d = reg_c;
            reg_c = reg_b.rotate_left(9);
            reg_b = reg_a;
            reg_a = temp_intermediate_1;
            reg_h = reg_g;
            reg_g = reg_f.rotate_left(19);
            reg_f = reg_e;
            reg_e = permutation_p0(temp_intermediate_2);
        }
        self.intermediate_state[0] ^= reg_a; self.intermediate_state[1] ^= reg_b;
        self.intermediate_state[2] ^= reg_c; self.intermediate_state[3] ^= reg_d;
        self.intermediate_state[4] ^= reg_e; self.intermediate_state[5] ^= reg_f;
        self.intermediate_state[6] ^= reg_g; self.intermediate_state[7] ^= reg_h;
    }
}

/// Computes the 32-byte SM3 cryptographic hash of a byte slice.
#[inline]
pub fn sm3_hash(payload: &[u8]) -> [u8; SM3_DIGEST_SIZE_BYTES] {
    let mut hasher = Sm3Hasher::new();
    hasher.update(payload);
    hasher.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sm3_standard_vector_abc() {
        let digest = sm3_hash(b"abc");
        let hex_string = crate::models::hex::encode_hex(&digest);
        assert_eq!(
            hex_string,
            "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
        );
    }

    #[test]
    fn test_sm3_standard_vector_64_bytes() {
        let input_bytes = b"abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
        let digest = sm3_hash(input_bytes);
        let hex_string = crate::models::hex::encode_hex(&digest);
        assert_eq!(
            hex_string,
            "debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732"
        );
    }
}
