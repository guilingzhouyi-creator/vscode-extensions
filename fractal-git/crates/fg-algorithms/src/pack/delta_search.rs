//! Module: fg-algorithms::pack::delta_search — Sliding-Window Pack Delta Search
//! File Path: crates/fg-algorithms/src/pack/delta_search.rs
//! Architecture Role: Implements Git-compatible packfile delta encoding and sliding-window
//!   delta base search heuristics.
//! Dependencies & Triggers: Consumed by PackWriter and RepackEngine in fg-storage.
//! Responsibilities: Git delta opcode encoding, sliding-window search, and cycle-free delta chain generation.
//! Exit Semantics & Design Rationale:
//!   - Git delta format uses little-endian 7-bit varints for base/target sizes and bitfield copy opcodes.
//!   - Sliding window sorts objects by (kind, basename_hash, size) to cluster similar objects together.
//!   - Hard ceiling on delta depth (`MAX_DELTA_DEPTH = 50`) prevents long reconstruction chains.
//!
//! Domain Governance Rules: FGT-ALG-001 (pack delta search), FGT-COR-001, FGT-PRF-001.

use fg_core::models::{ObjectKind, Oid};
use std::collections::HashMap;

/// Default window size for sliding-window delta search (10 objects).
pub const DEFAULT_DELTA_WINDOW: usize = 10;

/// Maximum allowable delta chain depth to prevent deep recursion.
pub const MAX_DELTA_DEPTH: usize = 50;

/// Minimum match length to trigger a Git delta copy instruction (4 bytes).
const MIN_MATCH_LEN: usize = 4;

/// Maximum chunk size for a single Git delta insert instruction (127 bytes).
const MAX_INSERT_LEN: usize = 127;

/// Opcode bit identifying a copy instruction.
const OPCODE_COPY: u8 = 0x80;

/// Computes a fast 32-bit FNV-1a hash of a filename or path's basename.
pub fn compute_basename_hash(path: &str) -> u32 {
    let clean = path.replace('\\', "/");
    let basename = clean.rsplit('/').next().unwrap_or(&clean);
    let mut hash: u32 = 0x811c9dc5;
    for &byte in basename.as_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    hash
}

/// An object candidate for packfile generation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackDeltaItem {
    pub oid: Oid,
    pub kind: ObjectKind,
    pub payload: Vec<u8>,
    pub basename_hash: u32,
}

impl PackDeltaItem {
    /// Constructs a new packable delta item.
    pub fn new(oid: Oid, kind: ObjectKind, payload: Vec<u8>, path: Option<&str>) -> Self {
        let basename_hash = path.map(compute_basename_hash).unwrap_or(0);
        Self {
            oid,
            kind,
            payload,
            basename_hash,
        }
    }
}

/// Chosen storage resolution for an object in a packfile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeltaResolution {
    /// Stored as a full, uncompressed base object.
    Full { payload: Vec<u8> },
    /// Stored as an `OBJ_OFS_DELTA` or `OBJ_REF_DELTA` against an earlier base.
    Delta {
        base_oid: Oid,
        base_index: usize,
        delta_payload: Vec<u8>,
    },
}

/// Final resolved pack item with its assigned delta chain facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackDeltaChain {
    pub oid: Oid,
    pub kind: ObjectKind,
    pub resolution: DeltaResolution,
    pub original_size: usize,
    pub depth: usize,
}

/// Encodes a variable-length integer into Git's 7-bit varint stream format.
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

/// Maximum byte count a single Git copy opcode can encode: three size bytes, 24 bits.
const COPY_MAX_LEN: usize = 0x00ff_ffff;

/// Emits one Git copy opcode and its variable-length operand bytes.
///
/// Git packs the copy offset into at most four bytes (opcode bits `0x01..=0x08`) and the copy
/// length into at most three bytes (opcode bits `0x10..=0x40`), each byte omitted when it is zero.
/// An omitted length therefore decodes as 65536, which is why a length of exactly `0x10000` must
/// not emit any size byte, and why a longer match has to be split by [`emit_match_copies`].
fn emit_copy_op(offset: usize, len: usize, out: &mut Vec<u8>) {
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
    let mut op_idx = 0;

    for shift in [0u32, 8, 16, 24] {
        let byte = ((offset >> shift) & 0xff) as u8;
        if byte != 0 {
            opcode |= 1u8 << (shift / 8);
            operands[op_idx] = byte;
            op_idx += 1;
        }
    }

    if len != 0x10000 {
        for (index, shift) in [0u32, 8, 16].iter().enumerate() {
            let byte = ((len >> shift) & 0xff) as u8;
            if byte != 0 {
                opcode |= 0x10u8 << index;
                operands[op_idx] = byte;
                op_idx += 1;
            }
        }
    }

    out.push(opcode);
    out.extend_from_slice(&operands[..op_idx]);
}

/// Emits the copy opcodes for one matched byte run.
///
/// A single Git copy opcode carries at most [`COPY_MAX_LEN`] bytes, so a longer match is split into
/// consecutive chunks with strictly increasing offsets; the concatenation still reproduces the
/// original run byte-for-byte.
fn emit_match_copies(mut offset: usize, mut len: usize, out: &mut Vec<u8>) {
    while len > 0 {
        let chunk = len.min(COPY_MAX_LEN);
        emit_copy_op(offset, chunk, out);
        offset += chunk;
        len -= chunk;
    }
}

/// Emits one or more Git insert opcodes with literal payload bytes.
fn emit_insert_ops(bytes: &[u8], out: &mut Vec<u8>) {
    let mut cursor = 0;
    while cursor < bytes.len() {
        let chunk_len = (bytes.len() - cursor).min(MAX_INSERT_LEN);
        out.push(chunk_len as u8);
        out.extend_from_slice(&bytes[cursor..cursor + chunk_len]);
        cursor += chunk_len;
    }
}

/// Encodes a Git-compatible delta stream from `base` to `target`.
///
/// Always returns `Some(delta_bytes)`; callers compare the delta length against the original
/// object size to decide whether storing the delta is actually worthwhile.
pub fn encode_git_delta(base: &[u8], target: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(target.len().min(1024));
    write_varint(base.len(), &mut out);
    write_varint(target.len(), &mut out);

    if target.is_empty() {
        return Some(out);
    }
    if base.is_empty() {
        emit_insert_ops(target, &mut out);
        return Some(out);
    }
    if base.len() > u32::MAX as usize {
        // Git copy opcodes address the base with at most four offset bytes, so a base above 4 GiB
        // is not addressable; emit the target as literal inserts instead of truncating offsets.
        emit_insert_ops(target, &mut out);
        return Some(out);
    }

    let mut index: HashMap<u32, usize> = HashMap::new();
    if base.len() >= MIN_MATCH_LEN {
        let mut b_cursor = 0;
        while b_cursor + MIN_MATCH_LEN <= base.len() {
            let key = u32::from_le_bytes([
                base[b_cursor],
                base[b_cursor + 1],
                base[b_cursor + 2],
                base[b_cursor + 3],
            ]);
            index.entry(key).or_insert(b_cursor);
            b_cursor += MIN_MATCH_LEN;
        }
    }

    let mut t_cursor = 0;
    let mut pending_insert_start = 0;

    while t_cursor + MIN_MATCH_LEN <= target.len() {
        let key = u32::from_le_bytes([
            target[t_cursor],
            target[t_cursor + 1],
            target[t_cursor + 2],
            target[t_cursor + 3],
        ]);

        if let Some(&b_pos) = index.get(&key) {
            let mut match_len = 0;
            while t_cursor + match_len < target.len()
                && b_pos + match_len < base.len()
                && target[t_cursor + match_len] == base[b_pos + match_len]
            {
                match_len += 1;
            }

            if match_len >= MIN_MATCH_LEN {
                if pending_insert_start < t_cursor {
                    emit_insert_ops(&target[pending_insert_start..t_cursor], &mut out);
                }
                emit_match_copies(b_pos, match_len, &mut out);
                t_cursor += match_len;
                pending_insert_start = t_cursor;
                continue;
            }
        }
        t_cursor += 1;
    }

    if pending_insert_start < target.len() {
        emit_insert_ops(&target[pending_insert_start..], &mut out);
    }

    Some(out)
}

/// Determines sorting order rank for ObjectKind to maximize delta locality.
fn kind_rank(kind: ObjectKind) -> u8 {
    match kind {
        ObjectKind::Commit => 1,
        ObjectKind::Tree => 2,
        ObjectKind::Blob => 3,
        ObjectKind::Tag => 4,
    }
}

/// Evaluates sliding window delta compression over a collection of pack items.
///
/// Objects are sorted deterministically, and each object searches up to `window_size`
/// predecessors of the same type for optimal delta compression.
pub fn find_pack_deltas(
    mut items: Vec<PackDeltaItem>,
    window_size: usize,
    max_depth: usize,
) -> Vec<PackDeltaChain> {
    items.sort_by(|a, b| {
        kind_rank(a.kind)
            .cmp(&kind_rank(b.kind))
            .then_with(|| a.basename_hash.cmp(&b.basename_hash))
            .then_with(|| b.payload.len().cmp(&a.payload.len()))
            .then_with(|| a.oid.cmp(&b.oid))
    });

    let count = items.len();
    let mut depths = vec![0usize; count];
    let mut resolutions = Vec::with_capacity(count);

    for i in 0..count {
        let target = &items[i];
        let original_size = target.payload.len();
        let mut best_delta: Option<(usize, Vec<u8>)> = None;
        let mut best_size = (original_size * 4) / 5; // Require at least 20% size savings

        let window_start = i.saturating_sub(window_size);
        for j in window_start..i {
            let candidate = &items[j];
            if candidate.kind != target.kind {
                continue;
            }
            if depths[j] >= max_depth {
                continue;
            }

            if let Some(delta) = encode_git_delta(&candidate.payload, &target.payload) {
                if delta.len() < best_size {
                    best_size = delta.len();
                    best_delta = Some((j, delta));
                }
            }
        }

        if let Some((base_idx, delta_payload)) = best_delta {
            depths[i] = depths[base_idx] + 1;
            resolutions.push(PackDeltaChain {
                oid: target.oid,
                kind: target.kind,
                resolution: DeltaResolution::Delta {
                    base_oid: items[base_idx].oid,
                    base_index: base_idx,
                    delta_payload,
                },
                original_size,
                depth: depths[i],
            });
        } else {
            depths[i] = 0;
            resolutions.push(PackDeltaChain {
                oid: target.oid,
                kind: target.kind,
                resolution: DeltaResolution::Full {
                    payload: target.payload.clone(),
                },
                original_size,
                depth: 0,
            });
        }
    }

    resolutions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_basename_hash_consistency() {
        assert_eq!(
            compute_basename_hash("src/lib.rs"),
            compute_basename_hash("crates/fg-algorithms/src/lib.rs")
        );
        assert_ne!(
            compute_basename_hash("src/lib.rs"),
            compute_basename_hash("src/main.rs")
        );
    }

    #[test]
    fn test_encode_git_delta_roundtrip_simple() {
        let base = b"The quick brown fox jumps over the lazy dog";
        let target = b"The fast brown fox jumps over the lazy dog!";
        let delta = encode_git_delta(base, target).expect("delta encoding must succeed");
        assert!(delta.len() < target.len() + 10);
    }

    #[test]
    fn test_encode_git_delta_identical() {
        let base = b"identical content across revisions";
        let delta = encode_git_delta(base, base).expect("delta encoding must succeed");
        assert!(delta.len() < base.len());
    }

    #[test]
    fn test_sliding_window_depth_ceiling() {
        let mut items = Vec::new();
        for i in 0..15 {
            let payload =
                format!("version {} of common file with identical footer\n", i).into_bytes();
            let mut oid_bytes = [0u8; 20];
            oid_bytes[0] = i as u8;
            items.push(PackDeltaItem::new(
                Oid::from_bytes(oid_bytes),
                ObjectKind::Blob,
                payload,
                Some("test.txt"),
            ));
        }

        let chains = find_pack_deltas(items, 5, 2);
        for chain in chains {
            assert!(
                chain.depth <= 2,
                "chain depth {} exceeds ceiling 2",
                chain.depth
            );
        }
    }

    /// One decoded Git delta operation, kept local to the tests so the checks do not depend on
    /// `fg-storage` going through the same decoder that production code uses.
    #[derive(Debug, PartialEq, Eq)]
    enum TestOp {
        Copy { offset: usize, len: usize },
        Insert { start: usize, len: usize },
    }

    fn deterministic_bytes(len: usize, seed: u32) -> Vec<u8> {
        let mut state = seed;
        let mut bytes = Vec::with_capacity(len);
        for _ in 0..len {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            bytes.push((state >> 24) as u8);
        }
        bytes
    }

    fn read_varint_test(data: &[u8], cursor: &mut usize) -> usize {
        let mut value = 0usize;
        let mut shift = 0u32;
        loop {
            let byte = data[*cursor];
            *cursor += 1;
            value |= usize::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return value;
            }
            shift += 7;
        }
    }

    /// Parses a Git delta stream into its header sizes and ordered operations.
    fn parse_delta_for_test(delta: &[u8]) -> (usize, usize, Vec<TestOp>) {
        let mut cursor = 0;
        let base_size = read_varint_test(delta, &mut cursor);
        let target_size = read_varint_test(delta, &mut cursor);
        let mut ops = Vec::new();
        while cursor < delta.len() {
            let opcode = delta[cursor];
            cursor += 1;
            if opcode & OPCODE_COPY != 0 {
                let mut offset = 0usize;
                let mut len = 0usize;
                for bit_index in 0..4 {
                    if opcode & (1u8 << bit_index) != 0 {
                        offset |= usize::from(delta[cursor]) << (8 * bit_index);
                        cursor += 1;
                    }
                }
                for bit_index in 0..3 {
                    if opcode & (0x10u8 << bit_index) != 0 {
                        len |= usize::from(delta[cursor]) << (8 * bit_index);
                        cursor += 1;
                    }
                }
                if len == 0 {
                    len = 0x10000;
                }
                ops.push(TestOp::Copy { offset, len });
            } else {
                let len = usize::from(opcode);
                assert!(
                    len > 0,
                    "insert opcode must carry at least one literal byte"
                );
                ops.push(TestOp::Insert { start: cursor, len });
                cursor += len;
            }
        }
        (base_size, target_size, ops)
    }

    fn apply_delta_for_test(base: &[u8], delta: &[u8]) -> Vec<u8> {
        let (base_size, target_size, ops) = parse_delta_for_test(delta);
        assert_eq!(base_size, base.len(), "delta base size must match the base");
        let mut out = Vec::with_capacity(target_size);
        for op in ops {
            match op {
                TestOp::Copy { offset, len } => out.extend_from_slice(&base[offset..offset + len]),
                TestOp::Insert { start, len } => out.extend_from_slice(&delta[start..start + len]),
            }
        }
        assert_eq!(out.len(), target_size);
        out
    }

    #[test]
    fn test_emit_copy_op_encodes_exactly_65536_without_size_bytes() {
        let mut delta = Vec::new();
        write_varint(0, &mut delta);
        write_varint(0x10000, &mut delta);
        emit_copy_op(0, 0x10000, &mut delta);

        assert_eq!(
            *delta.last().expect("copy opcode"),
            0x80u8,
            "a 65536-byte copy must emit no size byte and no offset byte"
        );
        let (base_size, target_size, ops) = parse_delta_for_test(&delta);
        assert_eq!((base_size, target_size), (0, 0x10000));
        assert_eq!(
            ops,
            vec![TestOp::Copy {
                offset: 0,
                len: 0x10000
            }]
        );
    }

    #[test]
    fn test_emit_match_copies_splits_above_single_opcode_ceiling() {
        let mut delta = Vec::new();
        write_varint(0, &mut delta);
        write_varint(0x0100_0005, &mut delta);
        emit_match_copies(0x0102_0304, 0x0100_0005, &mut delta);

        let (base_size, target_size, ops) = parse_delta_for_test(&delta);
        assert_eq!((base_size, target_size), (0, 0x0100_0005));
        assert_eq!(ops.len(), 2);
        assert_eq!(
            ops[0],
            TestOp::Copy {
                offset: 0x0102_0304,
                len: COPY_MAX_LEN
            }
        );
        assert_eq!(
            ops[1],
            TestOp::Copy {
                offset: 0x0102_0304 + COPY_MAX_LEN,
                len: 6
            }
        );
        let copied: usize = ops
            .iter()
            .map(|op| match op {
                TestOp::Copy { len, .. } | TestOp::Insert { len, .. } => *len,
            })
            .sum();
        assert_eq!(copied, target_size);
    }

    #[test]
    fn test_encode_git_delta_roundtrips_a_65536_byte_copy() {
        let base = deterministic_bytes(0x10000 + 1024, 0x5EED_1234);
        let target = base[512..512 + 0x10000].to_vec();

        let delta = encode_git_delta(&base, &target).expect("delta encoding must succeed");
        assert_eq!(apply_delta_for_test(&base, &delta), target);
        let (_, _, ops) = parse_delta_for_test(&delta);
        assert!(
            ops.iter()
                .any(|op| matches!(op, TestOp::Copy { len, .. } if *len == 0x10000)),
            "an exact 65536-byte match must round-trip as one copy operation"
        );
    }

    #[test]
    fn test_encode_git_delta_insert_boundaries() {
        let base = [0u8; 1];
        for target_len in [127usize, 128, 16_383, 16_384, 65_536] {
            let target = deterministic_bytes(target_len, 0xABCD_1234 ^ target_len as u32);
            let delta = encode_git_delta(&base, &target).expect("delta encoding must succeed");
            assert_eq!(
                apply_delta_for_test(&base, &delta),
                target,
                "insert boundary {target_len}"
            );

            let (base_size, target_size, ops) = parse_delta_for_test(&delta);
            assert_eq!((base_size, target_size), (1, target_len));
            let expected_chunks = target_len.div_ceil(MAX_INSERT_LEN);
            assert_eq!(
                ops.len(),
                expected_chunks,
                "insert chunk count at {target_len}"
            );
            assert!(ops.iter().all(|op| matches!(
                op,
                TestOp::Insert { len, .. } if *len > 0 && *len <= MAX_INSERT_LEN
            )));
        }
    }
}
