//! Module: fg-core::crypto::digest — Pure Rust National Standard SM3 Hash
//! File Path: crates/fg-core/src/crypto/digest.rs
//! Architecture Role: GB/T 32918.4-2016 cryptographic hash and HMAC-SM3 implementation.
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001 (zero transient heap allocation).

const IV: [u32; 8] = [
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
    0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

#[inline(always)]
const fn p0(x: u32) -> u32 {
    x ^ x.rotate_left(9) ^ x.rotate_left(17)
}

#[inline(always)]
const fn p1(x: u32) -> u32 {
    x ^ x.rotate_left(15) ^ x.rotate_left(23)
}

#[inline(always)]
const fn ff(x: u32, y: u32, z: u32, j: usize) -> u32 {
    if j < 16 {
        x ^ y ^ z
    } else {
        (x & y) | (x & z) | (y & z)
    }
}

#[inline(always)]
const fn gg(x: u32, y: u32, z: u32, j: usize) -> u32 {
    if j < 16 {
        x ^ y ^ z
    } else {
        (x & y) | (!x & z)
    }
}

#[inline(always)]
const fn tj(j: usize) -> u32 {
    if j < 16 {
        0x79cc4519
    } else {
        0x7a879d8a
    }
}

/// Streaming state machine for GB/T 32918.4 SM3 256-bit cryptographic digest.
#[derive(Clone, Copy)]
pub struct Sm3Hasher {
    state: [u32; 8],
    buffer: [u8; 64],
    buf_len: usize,
    total_len: u64,
}

impl Default for Sm3Hasher {
    fn default() -> Self {
        Self {
            state: IV,
            buffer: [0u8; 64],
            buf_len: 0,
            total_len: 0,
        }
    }
}

impl Sm3Hasher {
    /// Creates a new SM3 hasher instance initialized with standard IV constants.
    pub const fn new() -> Self {
        Self {
            state: IV,
            buffer: [0u8; 64],
            buf_len: 0,
            total_len: 0,
        }
    }

    /// Feeds additional input bytes into the incremental SM3 digest state machine.
    pub fn update(&mut self, data: &[u8]) {
        self.total_len += data.len() as u64;
        let mut offset = 0;
        if self.buf_len > 0 {
            let to_copy = (64 - self.buf_len).min(data.len());
            self.buffer[self.buf_len..self.buf_len + to_copy].copy_from_slice(&data[..to_copy]);
            self.buf_len += to_copy;
            offset += to_copy;
            if self.buf_len == 64 {
                self.compress_buffer();
                self.buf_len = 0;
            }
        }
        while offset + 64 <= data.len() {
            let mut block = [0u8; 64];
            block.copy_from_slice(&data[offset..offset + 64]);
            self.compress_chunk(&block);
            offset += 64;
        }
        if offset < data.len() {
            let remaining = data.len() - offset;
            self.buffer[..remaining].copy_from_slice(&data[offset..]);
            self.buf_len = remaining;
        }
    }

    /// Consumes the hasher, applies PKCS padding, and returns the 32-byte SM3 digest.
    pub fn finalize(mut self) -> [u8; 32] {
        let bit_len = self.total_len * 8;
        self.buffer[self.buf_len] = 0x80;
        self.buf_len += 1;
        if self.buf_len > 56 {
            self.buffer[self.buf_len..64].fill(0);
            self.compress_buffer();
            self.buffer.fill(0);
        } else {
            self.buffer[self.buf_len..56].fill(0);
        }
        self.buffer[56..64].copy_from_slice(&bit_len.to_be_bytes());
        self.compress_buffer();

        let mut digest = [0u8; 32];
        for (i, word) in self.state.iter().enumerate() {
            digest[i * 4..(i + 1) * 4].copy_from_slice(&word.to_be_bytes());
        }
        digest
    }

    fn compress_buffer(&mut self) {
        let block = self.buffer;
        self.compress_chunk(&block);
    }

    fn compress_chunk(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 68];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for j in 16..68 {
            let x = w[j - 16] ^ w[j - 9] ^ w[j - 3].rotate_left(15);
            w[j] = p1(x) ^ w[j - 13].rotate_left(7) ^ w[j - 6];
        }
        let (mut a, mut b, mut c, mut d) =
            (self.state[0], self.state[1], self.state[2], self.state[3]);
        let (mut e, mut f, mut g, mut h) =
            (self.state[4], self.state[5], self.state[6], self.state[7]);

        for j in 0..64 {
            let ss1 = (a
                .rotate_left(12)
                .wrapping_add(e)
                .wrapping_add(tj(j).rotate_left((j % 32) as u32)))
            .rotate_left(7);
            let ss2 = ss1 ^ a.rotate_left(12);
            let tt1 = ff(a, b, c, j)
                .wrapping_add(d)
                .wrapping_add(ss2)
                .wrapping_add(w[j] ^ w[j + 4]);
            let tt2 = gg(e, f, g, j)
                .wrapping_add(h)
                .wrapping_add(ss1)
                .wrapping_add(w[j]);
            d = c;
            c = b.rotate_left(9);
            b = a;
            a = tt1;
            h = g;
            g = f.rotate_left(19);
            f = e;
            e = p0(tt2);
        }
        self.state[0] ^= a;
        self.state[1] ^= b;
        self.state[2] ^= c;
        self.state[3] ^= d;
        self.state[4] ^= e;
        self.state[5] ^= f;
        self.state[6] ^= g;
        self.state[7] ^= h;
    }
}

/// Computes the 32-byte SM3 cryptographic hash of a byte slice.
#[inline]
pub fn sm3_hash(payload: &[u8]) -> [u8; 32] {
    let mut hasher = Sm3Hasher::new();
    hasher.update(payload);
    hasher.finalize()
}

/// Computes RFC 2104 compliant HMAC-SM3 over the given key and message.
pub fn hmac_sm3(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut normalized = [0u8; BLOCK];
    if key.len() > BLOCK {
        let digest = sm3_hash(key);
        normalized[..32].copy_from_slice(&digest);
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        inner_pad[i] ^= normalized[i];
        outer_pad[i] ^= normalized[i];
    }
    let mut inner = Sm3Hasher::new();
    inner.update(&inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sm3Hasher::new();
    outer.update(&outer_pad);
    outer.update(&inner_digest);
    outer.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sm3_standard_vector_abc() {
        let digest = sm3_hash(b"abc");
        let hex = crate::models::hex::encode_hex(&digest);
        assert_eq!(
            hex,
            "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
        );
    }

    #[test]
    fn test_sm3_standard_vector_64_bytes() {
        let input = b"abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
        let digest = sm3_hash(input);
        let hex = crate::models::hex::encode_hex(&digest);
        assert_eq!(
            hex,
            "debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732"
        );
    }

    #[test]
    fn test_hmac_sm3_deterministic() {
        let mac = hmac_sm3(
            b"key-secret-64-byte-aligned-token-for-taxis-kernel-governance-000",
            b"payload",
        );
        assert_ne!(mac, [0u8; 32]);
        let mac2 = hmac_sm3(
            b"key-secret-64-byte-aligned-token-for-taxis-kernel-governance-000",
            b"payload",
        );
        assert_eq!(mac, mac2);
    }
}
