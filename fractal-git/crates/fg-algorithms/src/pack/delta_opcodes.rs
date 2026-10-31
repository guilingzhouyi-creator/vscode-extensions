//! Module: fg-algorithms::pack::delta_opcodes — Shared Git Pack Delta Bytecode Emitter
//! File Path: crates/fg-algorithms/src/pack/delta_opcodes.rs
//! Architecture Role: Canonical bytecode emitter for Git packfile delta streams (`COPY` `0x80` and
//!   `INSERT` `0x01..=0x7F` instructions plus little-endian 7-bit header varints).
//! Dependencies & Triggers: Shared by `delta_search` (4-byte stride matcher) and `fossil_matcher`
//!   (16-byte rolling-hash bidirectional matcher).
//! Responsibilities: Emit byte-exact Git delta size headers, split matches above `0xFFFFFF`,
//!   handle Git's zero-size-byte `0x10000` copy convention, and chunk literal inserts at 127 bytes.
//! Exit Semantics & Design Rationale:
//!   - Deduplicates identical opcode framing previously copied across both delta encoders.
//!   - Operates purely on stack operand arrays (`[u8; 7]`) with zero transient heap allocations.
//!
//! Domain Governance Rules: FGT-ALG-001 (pack delta encoding), FGT-COR-001, FGT-PRF-001.

/// Maximum byte count a single Git copy opcode can encode: three size bytes (`0xFFFFFF`).
pub(crate) const COPY_MAX_LEN: usize = 0x00ff_ffff;

/// Maximum chunk size for a single Git delta insert instruction (`127` bytes).
pub(crate) const MAX_INSERT_LEN: usize = 127;

/// Opcode bit identifying a Git copy instruction.
pub(crate) const OPCODE_COPY: u8 = 0x80;

/// Encodes a variable-length integer into Git's 7-bit little-endian delta header varint format.
pub fn write_varint(mut value: usize, buffer: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value > 0 {
            byte |= 0x80;
            buffer.push(byte);
        } else {
            buffer.push(byte);
            break;
        }
    }
}

/// Emits one Git copy opcode and its variable-length operand bytes.
///
/// Git packs the copy offset into at most four bytes (opcode bits `0x01..=0x08`) and the copy
/// length into at most three bytes (opcode bits `0x10..=0x40`), each byte omitted when it is zero.
/// An omitted length decodes as `65536` (`0x10000`), so a length of `0x10000` intentionally emits
/// zero size bytes.
pub(crate) fn emit_copy_op(offset: usize, len: usize, out: &mut Vec<u8>) {
    debug_assert!(len > 0, "git copy opcode cannot encode a zero length");
    debug_assert!(
        len <= COPY_MAX_LEN,
        "git copy length {len} exceeds the 0xFFFFFF ceiling"
    );
    debug_assert!(
        offset <= u32::MAX as usize,
        "git copy offset cannot be encoded beyond four bytes"
    );

    let mut opcode = OPCODE_COPY;
    let mut operands = [0u8; 7];
    let mut operand_index = 0;

    for shift in [0u32, 8, 16, 24] {
        let byte = ((offset >> shift) & 0xff) as u8;
        if byte != 0 {
            opcode |= 1u8 << (shift / 8);
            operands[operand_index] = byte;
            operand_index += 1;
        }
    }

    if len != 0x10000 {
        for (index, shift) in [0u32, 8, 16].iter().enumerate() {
            let byte = ((len >> shift) & 0xff) as u8;
            if byte != 0 {
                opcode |= 0x10u8 << index;
                operands[operand_index] = byte;
                operand_index += 1;
            }
        }
    }

    out.push(opcode);
    out.extend_from_slice(&operands[..operand_index]);
}

/// Emits copy opcodes for one matched byte run, splitting runs larger than [`COPY_MAX_LEN`].
pub(crate) fn emit_match_copies(mut offset: usize, mut len: usize, out: &mut Vec<u8>) {
    while len > 0 {
        let chunk = len.min(COPY_MAX_LEN);
        emit_copy_op(offset, chunk, out);
        offset += chunk;
        len -= chunk;
    }
}

/// Emits one or more Git insert opcodes with literal payload bytes.
pub(crate) fn emit_insert_ops(bytes: &[u8], out: &mut Vec<u8>) {
    let mut cursor = 0;
    while cursor < bytes.len() {
        let chunk_len = (bytes.len() - cursor).min(MAX_INSERT_LEN);
        out.push(chunk_len as u8);
        out.extend_from_slice(&bytes[cursor..cursor + chunk_len]);
        cursor += chunk_len;
    }
}
