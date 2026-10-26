//! Module: fg-storage — Git Delta Instruction Interpreter
//! File Path: crates/fg-storage/src/delta_git.rs
//! Architecture Role: Decodes the delta stream Git writes inside a packfile
//!   (`OBJ_OFS_DELTA` / `OBJ_REF_DELTA` payloads) and reconstructs the target bytes from a base.
//! Dependencies & Triggers: Consumed by the pack reader and the ODB router; never used by the
//!   Taxis-native `delta_codec` path.
//! Responsibilities: Parse copy/insert opcodes, enforce bounds, and emit the reconstructed payload.
//! Exit Semantics & Design Rationale:
//!   - This is deliberately a *separate* codec from [`crate::delta_codec`]. That module encodes
//!     Taxis' own block deltas with `0x01`/`0x02` tags and big-endian `u32` lengths. Git's format
//!     uses a bitfield opcode where `0x80` marks a copy and every other non-zero value is an insert
//!     length. Sharing one parser would silently misread whichever format it was not written for,
//!     and the misread only surfaces as a hash mismatch far from the cause.
//!   - Every instruction is located while decoding, so the render step never re-walks the stream.
//!     A cursor threaded through two passes is the classic way an insert offset drifts by one and
//!     only some objects come out wrong.
//!   - Bounds are checked against the declared base and target sizes before any copy runs. A
//!     forged delta can otherwise request a copy that walks past the base buffer; the resulting
//!     panic would be indistinguishable from a genuine engine fault.
//!   - A zero opcode is reserved by the format. It is rejected rather than treated as a
//!     zero-length insert, because accepting it turns a truncated stream into an infinite loop.
//!
//! Domain Governance Rules: FGT-STO-001 (pack delta decoder), FGT-COR-001, FGT-PRF-001.

use fg_core::error::{FractalError, FractalResult};

/// Opcode bit that marks a copy instruction; the remaining bits select the operand bytes.
const OPCODE_COPY: u8 = 0x80;

/// Bit 0 of a copy opcode: the offset carries the low byte.
const COPY_OFFSET_BYTE_0: u8 = 0x01;
/// Bit 1 of a copy opcode: the offset carries bits 8..15.
const COPY_OFFSET_BYTE_1: u8 = 0x02;
/// Bit 2 of a copy opcode: the offset carries bits 16..23.
const COPY_OFFSET_BYTE_2: u8 = 0x04;
/// Bit 3 of a copy opcode: the offset carries bits 24..31.
const COPY_OFFSET_BYTE_3: u8 = 0x08;
/// Bit 4 of a copy opcode: the size carries the low byte.
const COPY_SIZE_BYTE_0: u8 = 0x10;
/// Bit 5 of a copy opcode: the size carries bits 8..15.
const COPY_SIZE_BYTE_1: u8 = 0x20;
/// Bit 6 of a copy opcode: the size carries bits 16..23.
const COPY_SIZE_BYTE_2: u8 = 0x40;

/// Size substituted when a copy opcode encodes no size bytes at all.
///
/// The format defines a missing size as `0x10000`. Without this substitution a copy of the whole
/// base would decode as a zero-length copy and produce a truncated object.
const COPY_DEFAULT_SIZE: usize = 0x10000;

/// Width of the continuation mask in a varint byte.
const VARINT_CONTINUATION: u8 = 0x80;

/// Width of the payload bits carried by one varint byte.
const VARINT_PAYLOAD_MASK: u8 = 0x7f;

/// Bits of payload contributed by one varint byte.
const VARINT_SHIFT_STEP: u32 = 7;

/// One decoded Git delta instruction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitDeltaOp {
    /// Copy `len` bytes starting at `offset` from the base object.
    Copy {
        /// Byte offset inside the base payload.
        offset: usize,
        /// Number of bytes to copy.
        len: usize,
    },
    /// Append `len` literal bytes that start at `stream_offset` in the delta stream.
    Insert {
        /// Offset of the first literal byte inside the delta stream.
        stream_offset: usize,
        /// Number of literal bytes.
        len: usize,
    },
}

/// A decoded Git delta: the declared sizes plus the instruction list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitDelta {
    /// Size the delta expects the base payload to have.
    pub base_size: usize,
    /// Size the reconstructed payload must have.
    pub target_size: usize,
    /// Instructions in stream order.
    pub ops: Vec<GitDeltaOp>,
}

/// Reads a Git delta varint (little-endian 7-bit groups, high bit continues).
///
/// Returns the decoded value and the number of bytes consumed.
fn read_varint(bytes: &[u8]) -> FractalResult<(usize, usize)> {
    let mut value: usize = 0;
    let mut shift: u32 = 0;
    for (index, byte) in bytes.iter().enumerate() {
        if shift >= usize::BITS {
            return Err(FractalError::ObjectCodec(format!(
                "git delta varint overflows usize at byte {index}"
            )));
        }
        value |= usize::from(byte & VARINT_PAYLOAD_MASK) << shift;
        if byte & VARINT_CONTINUATION == 0 {
            return Ok((value, index + 1));
        }
        shift += VARINT_SHIFT_STEP;
    }
    Err(FractalError::ObjectCodec(
        "git delta varint is truncated before its terminator".to_string(),
    ))
}

/// Decodes a Git delta stream into its declared sizes and instruction list.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the stream is truncated, when a copy operand runs
/// past the stream, or when an instruction is structurally impossible.
pub fn decode_git_delta(delta: &[u8]) -> FractalResult<GitDelta> {
    let (base_size, consumed) = read_varint(delta)?;
    let (target_size, consumed_target) = read_varint(&delta[consumed..])?;
    let mut cursor = consumed + consumed_target;

    let mut ops = Vec::new();
    while cursor < delta.len() {
        let opcode = delta[cursor];
        let opcode_at = cursor;
        cursor += 1;
        if opcode == 0 {
            return Err(FractalError::ObjectCodec(format!(
                "git delta opcode 0 is reserved but appears at byte {opcode_at}"
            )));
        }
        if opcode & OPCODE_COPY == 0 {
            let len = usize::from(opcode);
            let end = cursor + len;
            if end > delta.len() {
                return Err(FractalError::ObjectCodec(format!(
                    "git delta insert of {len} bytes at byte {cursor} runs past the stream"
                )));
            }
            ops.push(GitDeltaOp::Insert {
                stream_offset: cursor,
                len,
            });
            cursor = end;
            continue;
        }
        let (offset, used) = read_copy_offset(&delta[cursor..], opcode)?;
        cursor += used;
        let (len, used) = read_copy_size(&delta[cursor..], opcode)?;
        cursor += used;
        ops.push(GitDeltaOp::Copy { offset, len });
    }

    Ok(GitDelta {
        base_size,
        target_size,
        ops,
    })
}

/// Reads the optional offset bytes selected by a copy opcode.
fn read_copy_offset(bytes: &[u8], opcode: u8) -> FractalResult<(usize, usize)> {
    const OFFSET_BITS: [u8; 4] = [
        COPY_OFFSET_BYTE_0,
        COPY_OFFSET_BYTE_1,
        COPY_OFFSET_BYTE_2,
        COPY_OFFSET_BYTE_3,
    ];
    let mut offset: usize = 0;
    let mut used: usize = 0;
    for (shift, bit) in OFFSET_BITS.iter().enumerate() {
        if opcode & bit == 0 {
            continue;
        }
        let byte = bytes.get(used).ok_or_else(|| {
            FractalError::ObjectCodec(format!(
                "git delta copy offset byte {shift} is missing from the stream"
            ))
        })?;
        offset |= usize::from(*byte) << (shift * 8);
        used += 1;
    }
    Ok((offset, used))
}

/// Reads the optional size bytes selected by a copy opcode, applying the `0x10000` default.
fn read_copy_size(bytes: &[u8], opcode: u8) -> FractalResult<(usize, usize)> {
    const SIZE_BITS: [u8; 3] = [COPY_SIZE_BYTE_0, COPY_SIZE_BYTE_1, COPY_SIZE_BYTE_2];
    let mut size: usize = 0;
    let mut used: usize = 0;
    for (shift, bit) in SIZE_BITS.iter().enumerate() {
        if opcode & bit == 0 {
            continue;
        }
        let byte = bytes.get(used).ok_or_else(|| {
            FractalError::ObjectCodec(format!(
                "git delta copy size byte {shift} is missing from the stream"
            ))
        })?;
        size |= usize::from(*byte) << (shift * 8);
        used += 1;
    }
    if size == 0 {
        size = COPY_DEFAULT_SIZE;
    }
    Ok((size, used))
}

/// Reconstructs the target payload by applying `delta` to `base`.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the base size disagrees with the delta header, when a
/// copy reads outside the base, or when the reconstructed length differs from the declared target.
pub fn apply_git_delta(base: &[u8], delta: &[u8]) -> FractalResult<Vec<u8>> {
    let decoded = decode_git_delta(delta)?;
    if decoded.base_size != base.len() {
        return Err(FractalError::ObjectCodec(format!(
            "git delta expects a {}-byte base but the base object is {} bytes",
            decoded.base_size,
            base.len()
        )));
    }

    let mut out = Vec::with_capacity(decoded.target_size);
    for op in &decoded.ops {
        match *op {
            GitDeltaOp::Copy { offset, len } => {
                let end = offset.checked_add(len).ok_or_else(|| {
                    FractalError::ObjectCodec("git delta copy range overflows usize".to_string())
                })?;
                if end > base.len() {
                    return Err(FractalError::ObjectCodec(format!(
                        "git delta copy {offset}..{end} exceeds the {}-byte base",
                        base.len()
                    )));
                }
                out.extend_from_slice(&base[offset..end]);
            }
            GitDeltaOp::Insert { stream_offset, len } => {
                let end = stream_offset + len;
                if end > delta.len() {
                    return Err(FractalError::ObjectCodec(format!(
                        "git delta insert {stream_offset}..{end} exceeds the stream"
                    )));
                }
                out.extend_from_slice(&delta[stream_offset..end]);
            }
        }
    }

    if out.len() != decoded.target_size {
        return Err(FractalError::ObjectCodec(format!(
            "git delta reconstructed {} bytes but declared {}",
            out.len(),
            decoded.target_size
        )));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{apply_git_delta, decode_git_delta, GitDeltaOp};

    #[test]
    fn decodes_a_pure_copy_delta() {
        // base size 5, target size 5, opcode 0x91 = copy with one offset byte and one size byte.
        let delta = [0x05, 0x05, 0x91, 0x00, 0x05];
        let decoded = decode_git_delta(&delta).expect("decode");
        assert_eq!((decoded.base_size, decoded.target_size), (5, 5));
        assert_eq!(decoded.ops, vec![GitDeltaOp::Copy { offset: 0, len: 5 }]);
    }

    #[test]
    fn decodes_an_insert_then_copy() {
        // base 4, target 4: insert "ab", then copy base[2..4].
        let delta = [0x04, 0x04, 0x02, b'a', b'b', 0x91, 0x02, 0x02];
        let decoded = decode_git_delta(&delta).expect("decode");
        assert_eq!(decoded.target_size, 4);
        assert_eq!(
            decoded.ops,
            vec![
                GitDeltaOp::Insert {
                    stream_offset: 3,
                    len: 2
                },
                GitDeltaOp::Copy { offset: 2, len: 2 },
            ]
        );
        let out = apply_git_delta(b"WXYZ", &delta).expect("apply");
        assert_eq!(out, b"abYZ");
    }

    #[test]
    fn rejects_the_reserved_zero_opcode() {
        let delta = [0x00, 0x00, 0x00];
        assert!(decode_git_delta(&delta).is_err());
    }

    #[test]
    fn rejects_an_insert_that_runs_past_the_stream() {
        // base 0, target 9, insert 9 bytes, but only two follow.
        let delta = [0x00, 0x09, 0x09, 0xAA, 0xBB];
        assert!(decode_git_delta(&delta).is_err());
    }

    #[test]
    fn copy_without_size_uses_the_format_default() {
        // base 0, target 65536 (varint 0x80 0x80 0x80 0x08), copy with offset byte only.
        let delta = [0x00, 0x80, 0x80, 0x80, 0x08, 0x81, 0x00];
        let decoded = decode_git_delta(&delta).expect("decode");
        assert_eq!(
            decoded.ops,
            vec![GitDeltaOp::Copy {
                offset: 0,
                len: 0x10000
            }]
        );
    }

    #[test]
    fn applying_a_delta_requires_the_declared_base_size() {
        let delta = [0x09, 0x01, 0x91, 0x00, 0x01];
        assert!(apply_git_delta(b"abcd", &delta).is_err());
    }

    #[test]
    fn rejects_a_copy_that_exceeds_the_base() {
        // base 2, target 4, copy offset 1 len 3 -> 1..4 exceeds 2.
        let delta = [0x02, 0x04, 0x91, 0x01, 0x03];
        assert!(apply_git_delta(b"ab", &delta).is_err());
    }

    #[test]
    fn rejects_a_target_size_that_disagrees_with_the_instructions() {
        // base 4, target 9, copy 2 -> reconstructs 2.
        let delta = [0x04, 0x09, 0x91, 0x00, 0x02];
        assert!(apply_git_delta(b"abcd", &delta).is_err());
    }

    #[test]
    fn test_fossil_git_delta_encoder_decoder_roundtrip() {
        let base = b"Rust 2021 edition provides exceptional performance and memory safety guarantees for Git algorithms.";
        let target = b"Rust 2024 edition provides exceptional throughput and memory safety guarantees for Fractal Git algorithms.";

        let delta = fg_algorithms::pack::encode_fossil_git_delta(base, target).expect("encode");
        let reconstructed = apply_git_delta(base, &delta).expect("apply delta");
        assert_eq!(&reconstructed[..], &target[..]);
    }
}
