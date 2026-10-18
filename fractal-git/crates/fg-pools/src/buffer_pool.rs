//! Module: fg-pools — Compression Page Buffer Pool
//! File Path: crates/fg-pools/src/buffer_pool.rs
//! Architecture Role: Reusable 64KB fixed-size scratch buffers for zlib deflate/inflate,
//!   preventing constant memory fragmentation in hot I/O paths.

use parking_lot::Mutex;

pub const DEFAULT_PAGE_SIZE: usize = 64 * 1024; // 64 KB

/// Thread-safe byte buffer pool for high-frequency I/O and compression.
pub struct PageBufferPool {
    pool: Mutex<Vec<Vec<u8>>>,
    page_size: usize,
    max_cached: usize,
}

impl Default for PageBufferPool {
    fn default() -> Self {
        Self::new(DEFAULT_PAGE_SIZE, 32)
    }
}

impl PageBufferPool {
    /// Creates a buffer pool with specific page size and pool limit.
    pub fn new(page_size: usize, max_cached: usize) -> Self {
        Self {
            pool: Mutex::new(Vec::with_capacity(max_cached)),
            page_size,
            max_cached,
        }
    }

    /// Borrows a buffer from the pool or allocates a new one of `page_size`.
    pub fn acquire(&self) -> Vec<u8> {
        let mut guard = self.pool.lock();
        guard.pop().unwrap_or_else(|| Vec::with_capacity(self.page_size))
    }

    /// Returns a buffer to the pool after clearing its contents.
    pub fn release(&self, mut buf: Vec<u8>) {
        buf.clear();
        let mut guard = self.pool.lock();
        if guard.len() < self.max_cached {
            guard.push(buf);
        }
    }
}
