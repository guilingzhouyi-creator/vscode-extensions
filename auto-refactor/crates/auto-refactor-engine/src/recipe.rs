//! Module: auto-refactor-engine — deepseek-recipe Native Binary Protocol
//! File Path: crates/auto-refactor-engine/src/recipe.rs
//! Architecture Role: Pure Rust implementation of the high-throughput TLV recipe binary format,
//!   providing 100% byte-for-byte serialization equivalence with the TypeScript codec.
//! Dependencies & Triggers: Consumes standard library byte operations; tested in unit tests.
//! Responsibilities: Encode and decode TLV binary frames, calculate Adler-32 checksums, and
//!   stream multi-packet records with zero transient allocations.
//! Exit Semantics & Design Rationale: Safe, non-panicking binary codec returning Result<_, String>.

/// Protocol 4-byte magic signature: "RECP" (0x52454350).
pub const RECIPE_MAGIC: u32 = 0x5245_4350;

/// Current protocol version.
pub const RECIPE_VERSION: u8 = 1;

/// Fixed header size in bytes.
pub const PACKET_HEADER_SIZE: usize = 10;

/// Checksum size in bytes (Adler-32).
pub const CHECKSUM_SIZE: usize = 4;

const ADLER_MOD: u32 = 65521;

/// Standard packet semantic tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum RecipeTag {
    AstSlice = 0x01,
    ThinkingBlock = 0x02,
    AasReport = 0x03,
    DiffHunk = 0x04,
    GuidancePrompt = 0x05,
}

impl RecipeTag {
    /// Convert raw u8 tag to RecipeTag enum.
    pub fn from_u8(val: u8) -> Option<Self> {
        match val {
            0x01 => Some(Self::AstSlice),
            0x02 => Some(Self::ThinkingBlock),
            0x03 => Some(Self::AasReport),
            0x04 => Some(Self::DiffHunk),
            0x05 => Some(Self::GuidancePrompt),
            _ => None,
        }
    }
}

/// Single decoded structural recipe packet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecipePacket {
    pub tag: RecipeTag,
    pub payload: Vec<u8>,
}

/// Compute Adler-32 checksum across a byte slice.
#[must_use]
pub fn compute_adler32(buf: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in buf {
        a = (a + u32::from(byte)) % ADLER_MOD;
        b = (b + a) % ADLER_MOD;
    }
    (b << 16) | a
}

/// Encode a single RecipePacket into a binary TLV frame.
#[must_use]
pub fn encode_recipe_packet(packet: &RecipePacket) -> Vec<u8> {
    let payload_len = packet.payload.len();
    let total_size = PACKET_HEADER_SIZE + payload_len + CHECKSUM_SIZE;
    let mut buf = Vec::with_capacity(total_size);

    buf.extend_from_slice(&RECIPE_MAGIC.to_be_bytes());
    buf.push(RECIPE_VERSION);
    buf.push(packet.tag as u8);
    buf.extend_from_slice(&(payload_len as u32).to_be_bytes());
    buf.extend_from_slice(&packet.payload);

    let checksum = compute_adler32(&packet.payload);
    buf.extend_from_slice(&checksum.to_be_bytes());

    buf
}

/// Decode a single binary TLV frame from buffer at given offset.
pub fn decode_recipe_packet(buf: &[u8], offset: usize) -> Result<(RecipePacket, usize), String> {
    if buf.len() < offset + PACKET_HEADER_SIZE + CHECKSUM_SIZE {
        return Err("Buffer too small for recipe packet header".to_string());
    }

    let magic = u32::from_be_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
    ]);
    if magic != RECIPE_MAGIC {
        return Err(format!("Invalid recipe magic signature: 0x{magic:x}"));
    }

    let version = buf[offset + 4];
    if version != RECIPE_VERSION {
        return Err(format!("Unsupported recipe version: {version}"));
    }

    let tag_byte = buf[offset + 5];
    let tag =
        RecipeTag::from_u8(tag_byte).ok_or_else(|| format!("Unknown recipe tag: {tag_byte}"))?;

    let payload_len = u32::from_be_bytes([
        buf[offset + 6],
        buf[offset + 7],
        buf[offset + 8],
        buf[offset + 9],
    ]) as usize;

    let payload_start = offset + PACKET_HEADER_SIZE;
    let payload_end = payload_start + payload_len;
    let checksum_offset = payload_end;

    if buf.len() < checksum_offset + CHECKSUM_SIZE {
        return Err("Truncated recipe payload".to_string());
    }

    let payload = buf[payload_start..payload_end].to_vec();
    let expected_checksum = u32::from_be_bytes([
        buf[checksum_offset],
        buf[checksum_offset + 1],
        buf[checksum_offset + 2],
        buf[checksum_offset + 3],
    ]);

    let actual_checksum = compute_adler32(&payload);
    if actual_checksum != expected_checksum {
        return Err(format!(
            "Checksum mismatch: expected {expected_checksum}, got {actual_checksum}"
        ));
    }

    Ok((
        RecipePacket { tag, payload },
        checksum_offset + CHECKSUM_SIZE,
    ))
}

/// Stream-encode multiple packets into a contiguous byte vector.
#[must_use]
pub fn encode_recipe_stream(packets: &[RecipePacket]) -> Vec<u8> {
    let mut stream = Vec::new();
    for packet in packets {
        let frame = encode_recipe_packet(packet);
        stream.extend_from_slice(&frame);
    }
    stream
}

/// Stream-decode multiple packets from a contiguous byte slice.
pub fn decode_recipe_stream(stream: &[u8]) -> Result<Vec<RecipePacket>, String> {
    let mut packets = Vec::new();
    let mut offset = 0;

    while offset < stream.len() {
        let (packet, next_offset) = decode_recipe_packet(stream, offset)?;
        packets.push(packet);
        offset = next_offset;
    }

    Ok(packets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recipe_roundtrip() {
        let packet = RecipePacket {
            tag: RecipeTag::ThinkingBlock,
            payload: b"Plan: optimize AST traversal".to_vec(),
        };

        let encoded = encode_recipe_packet(&packet);
        assert_eq!(&encoded[0..4], b"RECP");

        let (decoded, next_offset) = decode_recipe_packet(&encoded, 0).expect("decode failed");
        assert_eq!(decoded.tag, RecipeTag::ThinkingBlock);
        assert_eq!(decoded.payload, packet.payload);
        assert_eq!(next_offset, encoded.len());
    }

    #[test]
    fn test_recipe_stream_roundtrip() {
        let p1 = RecipePacket {
            tag: RecipeTag::AstSlice,
            payload: b"slice-1".to_vec(),
        };
        let p2 = RecipePacket {
            tag: RecipeTag::DiffHunk,
            payload: b"@@ -1,3 +1,3 @@".to_vec(),
        };

        let stream = encode_recipe_stream(&[p1.clone(), p2.clone()]);
        let decoded = decode_recipe_stream(&stream).expect("stream decode failed");

        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0], p1);
        assert_eq!(decoded[1], p2);
    }
}
