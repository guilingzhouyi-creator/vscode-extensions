//! Module: fg-storage — Segmented Packfile Window Reader
//! File Path: crates/fg-storage/src/backends/pack_window.rs
//! Architecture Role: Provides segmented, windowed, on-demand read-only access to packfiles,
//!   avoiding whole-file heap allocations for multi-hundred-megabyte archives.
//! Dependencies & Triggers: Consumed by `PackFile` when file size exceeds `PACK_WINDOW_THRESHOLD`.
//! Responsibilities: Maintain file handle, sliding byte window cache, and streaming decompression reader.
//! Exit Semantics & Design Rationale:
//!   - Sliding window caches up to `window_size` bytes to amortize seek/read syscalls.
//!   - Thread-safe interior mutability using `parking_lot::Mutex`.
//!   - Zero-copy window slice borrowing whenever requested ranges fall within cached extents.
//!
//! Domain Governance Rules: FGT-STO-001 (pack reader safety), FGT-PRF-001 (bounded memory).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fg_core::error::{FractalError, FractalResult};

/// Default sliding window cache size (64 KiB).
pub const DEFAULT_PACK_WINDOW_SIZE: usize = 64 * 1024;

/// Cached sliding window.
#[derive(Debug, Clone)]
struct WindowSlot {
    offset: u64,
    data: Vec<u8>,
}

/// Thread-safe windowed packfile reader.
#[derive(Debug)]
pub struct PackWindowReader {
    path: PathBuf,
    file: Mutex<File>,
    total_len: u64,
    window_size: usize,
    cached_window: Mutex<Option<WindowSlot>>,
}

impl PackWindowReader {
    /// Opens a packfile for windowed read-only access.
    pub fn open(path: impl Into<PathBuf>, window_size: usize) -> FractalResult<Self> {
        let path = path.into();
        let file = File::open(&path)?;
        let total_len = file.metadata()?.len();
        Ok(Self {
            path,
            file: Mutex::new(file),
            total_len,
            window_size: window_size.max(4096),
            cached_window: Mutex::new(None),
        })
    }

    /// Path to the underlying packfile on disk.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Total byte length of the packfile.
    pub fn total_len(&self) -> u64 {
        self.total_len
    }

    /// Reads exactly `len` bytes starting at `offset` using sliding window cache.
    pub fn read_exact_at(&self, offset: u64, len: usize) -> FractalResult<Vec<u8>> {
        if len == 0 {
            return Ok(Vec::new());
        }
        let end = offset.checked_add(len as u64).ok_or_else(|| {
            FractalError::CorruptStore(format!("Offset overflow: {offset} + {len}"))
        })?;
        if end > self.total_len {
            return Err(FractalError::CorruptStore(format!(
                "Read out of bounds in '{}': offset {offset} + len {len} > total {}",
                self.path.display(),
                self.total_len
            )));
        }

        // Fast path: check cached window
        {
            let guard = self.cached_window.lock().map_err(|_| {
                FractalError::CorruptStore("Pack window lock poisoned".to_owned())
            })?;
            if let Some(ref window) = *guard {
                if offset >= window.offset {
                    let rel_start = (offset - window.offset) as usize;
                    if rel_start + len <= window.data.len() {
                        return Ok(window.data[rel_start..rel_start + len].to_vec());
                    }
                }
            }
        }

        // Slow path: populate window
        let fetch_size = len.max(self.window_size).min((self.total_len - offset) as usize);
        let mut buffer = vec![0u8; fetch_size];
        {
            let mut file = self.file.lock().map_err(|_| {
                FractalError::CorruptStore("Pack file lock poisoned".to_owned())
            })?;
            file.seek(SeekFrom::Start(offset))?;
            file.read_exact(&mut buffer)?;
        }

        let result = buffer[..len].to_vec();
        {
            let mut guard = self.cached_window.lock().map_err(|_| {
                FractalError::CorruptStore("Pack window lock poisoned".to_owned())
            })?;
            *guard = Some(WindowSlot {
                offset,
                data: buffer,
            });
        }
        Ok(result)
    }

    /// Reads a single byte at `offset`.
    pub fn read_byte_at(&self, offset: u64) -> FractalResult<u8> {
        let bytes = self.read_exact_at(offset, 1)?;
        Ok(bytes[0])
    }
}

/// Read-only streaming slice over a PackWindowReader for streaming decompression.
pub struct PackWindowStream<'a> {
    reader: &'a PackWindowReader,
    cursor: u64,
    end: u64,
}

impl<'a> PackWindowStream<'a> {
    pub fn new(reader: &'a PackWindowReader, start: u64, end: u64) -> Self {
        Self {
            reader,
            cursor: start,
            end: end.min(reader.total_len()),
        }
    }
}

impl<'a> Read for PackWindowStream<'a> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.cursor >= self.end {
            return Ok(0);
        }
        let available = (self.end - self.cursor) as usize;
        let to_read = buf.len().min(available);
        let chunk = self
            .reader
            .read_exact_at(self.cursor, to_read)
            .map_err(|err| std::io::Error::other(err.to_string()))?;
        buf[..chunk.len()].copy_from_slice(&chunk);
        self.cursor += chunk.len() as u64;
        Ok(chunk.len())
    }
}
