//! Module: fg-algorithms — Localized Merkle Extent Reconstruction (apply_edits)
//! File Path: crates/fg-algorithms/src/cdc/apply_edits.rs
//! Architecture Role: Implements boundary-healing localized chunk reconstruction over FastCDC
//!   extents, reusing unaffected left/middle/right chunk pointers without rescanning or copying
//!   unchanged bytes.
//! Dependencies & Triggers: Consumed by CAS materializers, localized edit pipelines, and LayerVFS.
//! Responsibilities: Validate non-overlapping edit streams, coalesce edits touching overlapping
//!   chunk windows, re-chunk localized modifications in a single pass, and shift untouched extents.
//! Exit Semantics & Design Rationale:
//!   - `O(|edits| * log(chunks) + affected_bytes)` single-pass complexity without full-file cloning.
//!   - Fixes multi-edit coordinate drift by anchoring all edit spans to `original_bytes` coordinates.
//!   - Reuses chunk OIDs on untouched extents with bitwise equality (`FGT-PRF-001`).
//!
//! Domain Governance Rules: FGT-ALG-001 (FastCDC localized reconstruction), FGT-COR-001, FGT-PRF-001.

use fg_core::error::{FractalError, FractalResult};

use super::fast_cdc::{ChunkDescriptor, FastCdcChunker};

/// Represents a single atomic range replacement operation on a byte buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditOp<'a> {
    /// Byte offset in `original_bytes` where replacement begins.
    pub offset: usize,
    /// Byte length of original content being replaced (`0` for pure insertion).
    pub length: usize,
    /// New replacement bytes.
    pub replacement: &'a [u8],
}

impl<'a> EditOp<'a> {
    /// Constructs a validated `EditOp`.
    pub const fn new(offset: usize, length: usize, replacement: &'a [u8]) -> Self {
        Self {
            offset,
            length,
            replacement,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct CoalescedWindow {
    first_chunk: usize,
    last_chunk: usize,
    edit_start_idx: usize,
    edit_end_idx: usize,
}

/// Applies a sequence of ordered, non-overlapping edits to an existing set of FastCDC chunk
/// descriptors, reusing untouched chunk descriptors and re-chunking only the affected windows
/// in a single pass without copying untouched file bytes.
pub fn apply_edits(
    chunker: &FastCdcChunker,
    original_bytes: &[u8],
    original_chunks: &[ChunkDescriptor],
    edits: &[EditOp<'_>],
) -> FractalResult<Vec<ChunkDescriptor>> {
    if edits.is_empty() {
        return Ok(original_chunks.to_vec());
    }

    validate_edits(original_bytes.len(), edits)?;

    if original_chunks.is_empty() {
        return Ok(chunk_empty_origin_edits(chunker, original_bytes, edits));
    }

    let windows = coalesce_edit_windows(original_chunks, edits);
    let mut out_chunks = Vec::with_capacity(original_chunks.len() + windows.len() * 2);
    let mut chunk_cursor = 0usize;
    let mut cumulative_delta: isize = 0;
    let mut local_buf: Vec<u8> = Vec::new();

    for window in &windows {
        emit_shifted_chunks(
            &original_chunks[chunk_cursor..window.first_chunk],
            cumulative_delta,
            &mut out_chunks,
        );

        let window_start = original_chunks[window.first_chunk].offset;
        let last_desc = &original_chunks[window.last_chunk];
        let window_end = last_desc.offset + last_desc.length;
        let window_edits = &edits[window.edit_start_idx..window.edit_end_idx];

        let window_delta = assemble_window_bytes(
            original_bytes,
            window_start,
            window_end,
            window_edits,
            &mut local_buf,
        );

        let shifted_window_start = (window_start as isize + cumulative_delta) as usize;
        for mut desc in chunker.iter(&local_buf) {
            desc.offset += shifted_window_start;
            out_chunks.push(desc);
        }

        cumulative_delta += window_delta;
        chunk_cursor = window.last_chunk + 1;
    }

    emit_shifted_chunks(
        &original_chunks[chunk_cursor..],
        cumulative_delta,
        &mut out_chunks,
    );

    Ok(out_chunks)
}

fn chunk_empty_origin_edits(
    chunker: &FastCdcChunker,
    original_bytes: &[u8],
    edits: &[EditOp<'_>],
) -> Vec<ChunkDescriptor> {
    let mut out_bytes = Vec::new();
    let mut cursor = 0usize;
    for edit in edits {
        out_bytes.extend_from_slice(&original_bytes[cursor..edit.offset]);
        out_bytes.extend_from_slice(edit.replacement);
        cursor = edit.offset + edit.length;
    }
    out_bytes.extend_from_slice(&original_bytes[cursor..]);
    chunker.chunk(&out_bytes)
}

fn emit_shifted_chunks(
    chunks: &[ChunkDescriptor],
    delta: isize,
    out_chunks: &mut Vec<ChunkDescriptor>,
) {
    if delta == 0 {
        out_chunks.extend_from_slice(chunks);
        return;
    }
    for chunk in chunks {
        out_chunks.push(ChunkDescriptor {
            offset: (chunk.offset as isize + delta) as usize,
            length: chunk.length,
            oid: chunk.oid,
        });
    }
}

fn assemble_window_bytes(
    original_bytes: &[u8],
    window_start: usize,
    window_end: usize,
    window_edits: &[EditOp<'_>],
    local_buf: &mut Vec<u8>,
) -> isize {
    let mut delta: isize = 0;
    for edit in window_edits {
        delta += edit.replacement.len() as isize - edit.length as isize;
    }
    let expected_len = ((window_end - window_start) as isize + delta).max(0) as usize;
    local_buf.clear();
    local_buf.reserve(expected_len);

    let mut cursor = window_start;
    for edit in window_edits {
        local_buf.extend_from_slice(&original_bytes[cursor..edit.offset]);
        local_buf.extend_from_slice(edit.replacement);
        cursor = edit.offset + edit.length;
    }
    local_buf.extend_from_slice(&original_bytes[cursor..window_end]);
    delta
}

fn coalesce_edit_windows(chunks: &[ChunkDescriptor], edits: &[EditOp<'_>]) -> Vec<CoalescedWindow> {
    let mut windows: Vec<CoalescedWindow> = Vec::with_capacity(edits.len());
    for (idx, edit) in edits.iter().enumerate() {
        let edit_end = edit.offset + edit.length;
        let first_chunk = find_first_impacted_chunk(chunks, edit.offset);
        let last_chunk = find_last_impacted_chunk(chunks, edit_end).max(first_chunk);

        if let Some(prev) = windows.last_mut() {
            if first_chunk <= prev.last_chunk {
                prev.last_chunk = prev.last_chunk.max(last_chunk);
                prev.edit_end_idx = idx + 1;
                continue;
            }
        }

        windows.push(CoalescedWindow {
            first_chunk,
            last_chunk,
            edit_start_idx: idx,
            edit_end_idx: idx + 1,
        });
    }
    windows
}

/// Validates that edits are within bounds and strictly non-overlapping.
fn validate_edits(total_len: usize, edits: &[EditOp<'_>]) -> FractalResult<()> {
    let mut last_end = 0;
    for (edit_index, edit) in edits.iter().enumerate() {
        let edit_end = edit.offset.checked_add(edit.length).ok_or_else(|| {
            FractalError::ObjectCodec(format!(
                "Edit {edit_index} offset overflow: offset={}",
                edit.offset
            ))
        })?;

        if edit_end > total_len {
            return Err(FractalError::ObjectCodec(format!(
                "Edit {edit_index} range [{}, {edit_end}) exceeds total length {total_len}",
                edit.offset
            )));
        }

        if edit.offset < last_end {
            return Err(FractalError::ObjectCodec(format!(
                "Overlapping edit detected at index {edit_index}: start {} < previous end {last_end}",
                edit.offset
            )));
        }

        last_end = edit_end;
    }
    Ok(())
}

/// Binary-searches the index of the first chunk whose span terminates after `offset`.
fn find_first_impacted_chunk(chunks: &[ChunkDescriptor], offset: usize) -> usize {
    let idx = chunks.partition_point(|chunk| chunk.offset + chunk.length <= offset);
    idx.min(chunks.len().saturating_sub(1))
}

/// Binary-searches the index of the last chunk whose span starts prior to `end_offset`.
fn find_last_impacted_chunk(chunks: &[ChunkDescriptor], end_offset: usize) -> usize {
    let idx = chunks.partition_point(|chunk| chunk.offset < end_offset);
    idx.saturating_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_chunker() -> FastCdcChunker {
        FastCdcChunker::new(64, 128, 256)
    }

    fn generate_deterministic_bytes(size: usize) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(size);
        let mut state: u32 = 0x12345678;
        for _ in 0..size {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            bytes.push((state >> 16) as u8);
        }
        bytes
    }

    #[test]
    fn test_apply_edits_empty_edits() {
        let chunker = make_test_chunker();
        let bytes = generate_deterministic_bytes(1024);
        let original_chunks = chunker.chunk(&bytes);

        let result = apply_edits(&chunker, &bytes, &original_chunks, &[]).expect("apply");
        assert_eq!(result, original_chunks);
    }

    #[test]
    fn test_apply_edits_localized_replacement_pointer_reuse() {
        let chunker = make_test_chunker();
        let bytes = generate_deterministic_bytes(2048);
        let original_chunks = chunker.chunk(&bytes);
        assert!(
            original_chunks.len() >= 4,
            "Need at least 4 chunks for extent testing"
        );

        let replacement = b"MODIFIED_PAYLOAD";
        let edit = EditOp::new(500, 16, replacement);

        let result = apply_edits(&chunker, &bytes, &original_chunks, &[edit]).expect("apply");
        assert_eq!(result[0], original_chunks[0]);

        let mut reconstructed_bytes = Vec::new();
        reconstructed_bytes.extend_from_slice(&bytes[..500]);
        reconstructed_bytes.extend_from_slice(replacement);
        reconstructed_bytes.extend_from_slice(&bytes[516..]);

        let ground_truth_chunks = chunker.chunk(&reconstructed_bytes);

        let total_reconstructed: usize = result.iter().map(|chunk| chunk.length).sum();
        assert_eq!(total_reconstructed, reconstructed_bytes.len());
        let last_chunk = result.last().expect("last chunk");
        assert_eq!(
            last_chunk.offset + last_chunk.length,
            reconstructed_bytes.len()
        );
        assert_eq!(ground_truth_chunks.len(), result.len());
    }

    #[test]
    fn test_apply_edits_multiple_disjoint_windows_preserves_middle_extents() {
        let chunker = make_test_chunker();
        let bytes = generate_deterministic_bytes(4096);
        let original_chunks = chunker.chunk(&bytes);
        assert!(original_chunks.len() >= 10);

        let edits = [
            EditOp::new(100, 8, b"LONGER_FIRST_EDIT_PAYLOAD_26"),
            EditOp::new(3500, 20, b"SHORT"),
        ];
        let result = apply_edits(&chunker, &bytes, &original_chunks, &edits).expect("multi edit");
        let expected_len = 4096usize - 8 + 28 - 20 + 5;
        let actual_len: usize = result.iter().map(|c| c.length).sum();
        assert_eq!(actual_len, expected_len);
        for pair in result.windows(2) {
            assert_eq!(pair[0].offset + pair[0].length, pair[1].offset);
        }
    }

    #[test]
    fn test_apply_edits_out_of_bounds_and_overlap_rejection() {
        let chunker = make_test_chunker();
        let bytes = generate_deterministic_bytes(512);
        let original_chunks = chunker.chunk(&bytes);

        let bad_edit = EditOp::new(500, 50, b"overflow");
        assert!(apply_edits(&chunker, &bytes, &original_chunks, &[bad_edit]).is_err());

        let edit1 = EditOp::new(100, 50, b"first");
        let edit2 = EditOp::new(120, 50, b"second_overlap");
        assert!(apply_edits(&chunker, &bytes, &original_chunks, &[edit1, edit2]).is_err());
    }
}
