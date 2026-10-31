//! Module: fg-algorithms::cdc::streaming — High-Throughput Streaming FastCDC
//! File Path: crates/fg-algorithms/src/cdc/streaming.rs
//! Architecture Role: Streams data from any `std::io::Read` source through a fixed 128 KiB
//!   ring buffer, computing content-defined chunk boundaries with 4-wide SWAR unrolled Gear hashing.
//! Dependencies & Triggers: Consumed by CAS materializers and streaming pack/bundle ingest.
//! Responsibilities: Continuous variable-length chunking with bounded memory footprint (`O(1)` memory)
//!   and `>= 1.8 GB/s` hashing throughput.
//! Exit Semantics & Design Rationale:
//!   - Fixed 128 KiB buffer eliminates large memory allocations when chunking multi-gigabyte streams.
//!   - `next_chunk` computes `ChunkDescriptor` directly over the internal ring slice without allocating
//!     or copying a 64 KiB `Vec<u8>` (`FGT-PRF-001`).
//!   - Produces standard `ChunkDescriptor` with SHA-1 `Oid` identical to in-memory FastCDC.
//!
//! Domain Governance Rules: FGT-ALG-001 (FastCDC chunking), FGT-COR-001, FGT-PRF-001.

use std::io::{self, Read};
use std::ops::Range;

use crate::cdc::fast_cdc::{ChunkDescriptor, FastCdcChunker, GEAR_TABLE};

/// Internal circular buffer capacity (128 KiB), twice the default max chunk size.
pub const STREAMING_BUFFER_CAPACITY: usize = 128 * 1024;

/// A streaming FastCDC chunker reading incrementally from an I/O source.
pub struct StreamingFastCdc<R> {
    reader: R,
    chunker: FastCdcChunker,
    buffer: Vec<u8>,
    head: usize,
    tail: usize,
    stream_offset: usize,
    eof_reached: bool,
}

impl<R: Read> StreamingFastCdc<R> {
    /// Constructs a streaming chunker with default FastCDC parameters.
    pub fn new(reader: R) -> Self {
        Self::with_chunker(reader, FastCdcChunker::default())
    }

    /// Constructs a streaming chunker with a custom configured chunker.
    pub fn with_chunker(reader: R, chunker: FastCdcChunker) -> Self {
        Self {
            reader,
            chunker,
            buffer: vec![0u8; STREAMING_BUFFER_CAPACITY],
            head: 0,
            tail: 0,
            stream_offset: 0,
            eof_reached: false,
        }
    }

    /// Returns the total stream bytes consumed so far.
    pub fn stream_offset(&self) -> usize {
        self.stream_offset
    }

    /// Pulls more bytes from the underlying reader into the internal buffer.
    fn refill(&mut self) -> io::Result<()> {
        if self.eof_reached {
            return Ok(());
        }

        if self.head > 0 {
            if self.head < self.tail {
                self.buffer.copy_within(self.head..self.tail, 0);
                self.tail -= self.head;
                self.head = 0;
            } else {
                self.head = 0;
                self.tail = 0;
            }
        }

        while self.tail < self.buffer.len() && !self.eof_reached {
            match self.reader.read(&mut self.buffer[self.tail..]) {
                Ok(0) => {
                    self.eof_reached = true;
                    break;
                }
                Ok(bytes_read) => {
                    self.tail += bytes_read;
                    if self.tail - self.head >= self.chunker.max_size {
                        break;
                    }
                }
                Err(ref err) if err.kind() == io::ErrorKind::Interrupted => continue,
                Err(err) => return Err(err),
            }
        }

        Ok(())
    }

    /// Scans `[cut_offset..limit)` with 4-way unrolled Gear hashing against `mask`.
    fn scan_masked_window(
        slice: &[u8],
        mut cut_offset: usize,
        limit: usize,
        mask: u64,
        fingerprint: &mut u64,
    ) -> Result<usize, usize> {
        while cut_offset + 4 <= limit {
            for lane in 0..4 {
                let byte = slice[cut_offset + lane] as usize;
                *fingerprint = (*fingerprint << 1).wrapping_add(GEAR_TABLE[byte]);
                if (*fingerprint & mask) == 0 {
                    return Ok(cut_offset + lane + 1);
                }
            }
            cut_offset += 4;
        }

        while cut_offset < limit {
            let byte = slice[cut_offset] as usize;
            *fingerprint = (*fingerprint << 1).wrapping_add(GEAR_TABLE[byte]);
            cut_offset += 1;
            if (*fingerprint & mask) == 0 {
                return Ok(cut_offset);
            }
        }

        Err(cut_offset)
    }

    /// Finds the next cut length using 4-way unrolled Gear hashing.
    fn find_cut(&self, available: usize) -> usize {
        if available <= self.chunker.min_size {
            return available;
        }

        let max_cut = available.min(self.chunker.max_size);
        let midpoint = self.chunker.min_size + (max_cut - self.chunker.min_size) / 2;
        let slice = &self.buffer[self.head..self.head + max_cut];
        let mut fingerprint: u64 = 0;

        // Small-mask normalization window [min_size..midpoint)
        let after_small = match Self::scan_masked_window(
            slice,
            self.chunker.min_size,
            midpoint,
            self.chunker.mask_s,
            &mut fingerprint,
        ) {
            Ok(cut) => return cut,
            Err(next_offset) => next_offset,
        };

        // Large-mask normalization window [midpoint..max_cut)
        match Self::scan_masked_window(
            slice,
            after_small,
            max_cut,
            self.chunker.mask_l,
            &mut fingerprint,
        ) {
            Ok(cut) => cut,
            Err(_) => max_cut,
        }
    }

    /// Advances the stream by one chunk and returns its descriptor and valid buffer slice range.
    ///
    /// The returned `Range<usize>` remains intact in `self.buffer` until the next `refill()` call,
    /// allowing `next_chunk` to avoid allocating a `Vec<u8>` while `next_chunk_payload` copies once.
    fn advance_next_chunk_range(&mut self) -> io::Result<Option<(ChunkDescriptor, Range<usize>)>> {
        let available = self.tail - self.head;
        if available < self.chunker.max_size && !self.eof_reached {
            self.refill()?;
        }

        let available = self.tail - self.head;
        if available == 0 {
            return Ok(None);
        }

        let cut_offset = self.find_cut(available);
        let range = self.head..self.head + cut_offset;
        let descriptor =
            FastCdcChunker::make_chunk_from_slice(&self.buffer[range.clone()], self.stream_offset);

        self.head += cut_offset;
        self.stream_offset += cut_offset;

        Ok(Some((descriptor, range)))
    }

    /// Reads and returns the next content-defined chunk and its bytes, or `None` on EOF.
    pub fn next_chunk_payload(&mut self) -> io::Result<Option<(ChunkDescriptor, Vec<u8>)>> {
        let Some((descriptor, range)) = self.advance_next_chunk_range()? else {
            return Ok(None);
        };
        Ok(Some((descriptor, self.buffer[range].to_vec())))
    }

    /// Reads and returns only the next `ChunkDescriptor` with zero heap allocation (`FGT-PRF-001`).
    pub fn next_chunk(&mut self) -> io::Result<Option<ChunkDescriptor>> {
        Ok(self.advance_next_chunk_range()?.map(|(desc, _)| desc))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_streaming_fast_cdc_empty() {
        let mut cdc = StreamingFastCdc::new(Cursor::new(Vec::new()));
        assert_eq!(cdc.next_chunk().expect("read"), None);
        assert_eq!(cdc.stream_offset(), 0);
    }

    #[test]
    fn test_streaming_fast_cdc_matches_in_memory() {
        let mut data = Vec::with_capacity(128 * 1024);
        let mut seed: u32 = 0x12345678;
        for _ in 0..128 * 1024 {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            data.push((seed >> 16) as u8);
        }

        let chunker = FastCdcChunker::new(1024, 4096, 16384);
        let in_memory_chunks = chunker.chunk(&data);

        let mut streaming = StreamingFastCdc::with_chunker(Cursor::new(&data), chunker);
        let mut streaming_chunks = Vec::new();

        while let Some(chunk) = streaming.next_chunk().expect("streaming chunk") {
            streaming_chunks.push(chunk);
        }

        assert_eq!(in_memory_chunks.len(), streaming_chunks.len());
        for (i, (mem, stream)) in in_memory_chunks.iter().zip(&streaming_chunks).enumerate() {
            assert_eq!(mem.offset, stream.offset, "Offset mismatch at chunk {i}");
            assert_eq!(mem.length, stream.length, "Length mismatch at chunk {i}");
            assert_eq!(mem.oid, stream.oid, "OID mismatch at chunk {i}");
        }
        assert_eq!(streaming.stream_offset(), data.len());
    }

    #[test]
    fn test_streaming_fast_cdc_payload_integrity() {
        let text = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let chunker = FastCdcChunker::new(16, 32, 64);
        let mut streaming = StreamingFastCdc::with_chunker(Cursor::new(text), chunker);

        let mut recovered = Vec::new();
        while let Some((desc, payload)) = streaming.next_chunk_payload().expect("chunk") {
            assert_eq!(desc.length, payload.len());
            recovered.extend_from_slice(&payload);
        }
        assert_eq!(&recovered, text);
    }

    #[test]
    fn test_streaming_fast_cdc_sub_min_size() {
        let tiny = b"tiny";
        let chunker = FastCdcChunker::new(16, 32, 64);
        let mut streaming = StreamingFastCdc::with_chunker(Cursor::new(tiny), chunker);

        let chunk = streaming.next_chunk().expect("read").expect("chunk");
        assert_eq!(chunk.offset, 0);
        assert_eq!(chunk.length, 4);
        assert_eq!(streaming.next_chunk().expect("eof"), None);
    }

    #[test]
    fn test_streaming_fast_cdc_large_stream_multibuffer() {
        let mut data = Vec::with_capacity(256 * 1024);
        for i in 0..256 * 1024 {
            data.push(((i * 31) ^ (i >> 5)) as u8);
        }

        let chunker = FastCdcChunker::new(2048, 8192, 32768);
        let in_memory_chunks = chunker.chunk(&data);

        let mut streaming = StreamingFastCdc::with_chunker(Cursor::new(&data), chunker);
        let mut streaming_chunks = Vec::new();

        while let Some(chunk) = streaming.next_chunk().expect("chunk") {
            streaming_chunks.push(chunk);
        }

        assert_eq!(in_memory_chunks.len(), streaming_chunks.len());
        assert_eq!(streaming.stream_offset(), data.len());
    }
}
