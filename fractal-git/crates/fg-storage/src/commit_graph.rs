//! Module: fg-storage — Git Commit-Graph Binary Codec & Fast Traversal Index
//! File Path: crates/fg-storage/src/commit_graph.rs
//! Architecture Role: Implements official Git Commit-Graph binary format
//!   (`.git/objects/info/commit-graph`), enabling O(1) fanout commit lookups, O(log N) binary
//!   search, and instant topological ordering.
//! Dependencies & Triggers: Utilized by loose/pack storage layers, DAG walker, and Taxis CLI.
//! Responsibilities: Generation number indexing, binary serialization, and integrity verification.
//! Exit Semantics & Design Rationale: 100% interoperable with Git `commit-graph.c` chunk layout
//!   (CGPH magic, OIDF, OIDL, and CDAT chunks) eliminating commit object traversal latency.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use sha1::{Digest, Sha1};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

const COMMIT_GRAPH_MAGIC: &[u8; 4] = b"CGPH";
const COMMIT_GRAPH_VERSION: u8 = 1;
const COMMIT_GRAPH_HASH_SHA1: u8 = 1;
const CHUNK_ID_OIDF: &[u8; 4] = b"OIDF";
const CHUNK_ID_OIDL: &[u8; 4] = b"OIDL";
const CHUNK_ID_CDAT: &[u8; 4] = b"CDAT";
const NO_PARENT_MARKER: u32 = 0x7000_0000;

/// Normalized in-memory record for a commit indexed inside the commit-graph.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitGraphEntry {
    pub commit_oid: Oid,
    pub tree_oid: Oid,
    pub parent_oids: Vec<Oid>,
    pub generation: u32,
    pub timestamp_sec: u64,
}

/// Binary serializer constructing official Git Commit-Graph (`CGPH`) files.
#[derive(Debug, Default)]
pub struct CommitGraphWriter {
    entries: Vec<CommitGraphEntry>,
}

impl CommitGraphWriter {
    /// Creates an empty commit-graph writer.
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Appends a commit record for commit-graph compilation.
    pub fn add_commit(&mut self, entry: CommitGraphEntry) {
        self.entries.push(entry);
    }

    /// Compiles all registered commit entries into standard Git Commit-Graph binary bytes.
    pub fn build_bytes(&mut self) -> FractalResult<Vec<u8>> {
        // Sort commits lexicographically by OID as required by Git commit-graph specification
        self.entries.sort_by_key(|entry| entry.commit_oid);

        let num_commits = self.entries.len();
        let chunk_count = 3u8;

        // Header: 8 bytes
        // Chunk Table: (3 chunks + 1 terminator) * 12 bytes = 48 bytes
        let header_and_table_size = 8 + 48;
        let oidf_offset = header_and_table_size as u64;
        let oidf_size = 256 * 4;
        let oidl_offset = oidf_offset + oidf_size as u64;
        let oidl_size = (num_commits * 20) as u64;
        let cdat_offset = oidl_offset + oidl_size;
        let cdat_size = (num_commits * 36) as u64;
        let file_data_end = cdat_offset + cdat_size;

        let total_file_size = (file_data_end + 20) as usize;
        let mut buffer = Vec::with_capacity(total_file_size);

        // 1. Header (8 bytes)
        buffer.extend_from_slice(COMMIT_GRAPH_MAGIC);
        buffer.push(COMMIT_GRAPH_VERSION);
        buffer.push(COMMIT_GRAPH_HASH_SHA1);
        buffer.push(chunk_count);
        buffer.push(0); // Base graph count = 0

        // 2. Chunk Table (4 entries * 12 bytes = 48 bytes)
        buffer.extend_from_slice(CHUNK_ID_OIDF);
        buffer.extend_from_slice(&oidf_offset.to_be_bytes());

        buffer.extend_from_slice(CHUNK_ID_OIDL);
        buffer.extend_from_slice(&oidl_offset.to_be_bytes());

        buffer.extend_from_slice(CHUNK_ID_CDAT);
        buffer.extend_from_slice(&cdat_offset.to_be_bytes());

        // Terminator entry
        buffer.extend_from_slice(&[0u8; 4]);
        buffer.extend_from_slice(&file_data_end.to_be_bytes());

        // 3. OIDF (OID Fanout table, 256 * 4 bytes)
        let mut cumulative_count = 0u32;
        let mut commit_cursor = 0usize;
        for fanout_byte in 0..=255u8 {
            while commit_cursor < num_commits {
                let first_byte = self.entries[commit_cursor].commit_oid.as_bytes()[0];
                if first_byte <= fanout_byte {
                    cumulative_count += 1;
                    commit_cursor += 1;
                } else {
                    break;
                }
            }
            buffer.extend_from_slice(&cumulative_count.to_be_bytes());
        }

        // 4. OIDL (OID Lookup table, num_commits * 20 bytes)
        for entry in &self.entries {
            buffer.extend_from_slice(entry.commit_oid.as_bytes());
        }

        // Helper map to lookup commit position for parent encoding
        let mut position_map = std::collections::HashMap::new();
        for (pos_index, entry) in self.entries.iter().enumerate() {
            position_map.insert(entry.commit_oid, pos_index as u32);
        }

        // 5. CDAT (Commit Data table, num_commits * 36 bytes)
        for entry in &self.entries {
            // 20 bytes: Tree OID
            buffer.extend_from_slice(entry.tree_oid.as_bytes());

            // 4 bytes: First parent position
            let first_parent_pos = if let Some(parent_oid) = entry.parent_oids.first() {
                *position_map.get(parent_oid).unwrap_or(&NO_PARENT_MARKER)
            } else {
                NO_PARENT_MARKER
            };
            buffer.extend_from_slice(&first_parent_pos.to_be_bytes());

            // 4 bytes: Second parent position
            let second_parent_pos = if entry.parent_oids.len() > 1 {
                *position_map
                    .get(&entry.parent_oids[1])
                    .unwrap_or(&NO_PARENT_MARKER)
            } else {
                NO_PARENT_MARKER
            };
            buffer.extend_from_slice(&second_parent_pos.to_be_bytes());

            // 8 bytes: Generation (top 30 bits) and Unix timestamp (lower 34 bits)
            let generation_val = (entry.generation.min(0x3fff_ffff) as u64) << 34;
            let timestamp_val = entry.timestamp_sec & 0x0000_0003_ffff_ffff;
            let packed_metadata = generation_val | timestamp_val;
            buffer.extend_from_slice(&packed_metadata.to_be_bytes());
        }

        // 6. Trailing SHA-1 Checksum (20 bytes)
        let mut hasher = Sha1::new();
        hasher.update(&buffer);
        let checksum: [u8; 20] = hasher.finalize().into();
        buffer.extend_from_slice(&checksum);

        Ok(buffer)
    }

    /// Atomically persists the commit-graph to disk.
    pub fn write_to_file(&mut self, target_path: &Path) -> FractalResult<()> {
        if let Some(parent_dir) = target_path.parent() {
            fs::create_dir_all(parent_dir)?;
        }
        let graph_bytes = self.build_bytes()?;
        let temp_path = target_path.with_extension("tmp");
        {
            let mut file = File::create(&temp_path)?;
            file.write_all(&graph_bytes)?;
            file.sync_all()?;
        }
        fs::rename(&temp_path, target_path)?;
        Ok(())
    }
}

/// Zero-copy reader & validator for Git Commit-Graph (`CGPH`) files.
#[derive(Debug, Clone)]
pub struct CommitGraphReader {
    binary_buffer: Vec<u8>,
    oidf_offset: usize,
    oidl_offset: usize,
    cdat_offset: usize,
    num_commits: usize,
}

impl CommitGraphReader {
    /// Loads and validates a Commit-Graph binary from disk.
    pub fn open(path: &Path) -> FractalResult<Self> {
        let mut file = File::open(path)?;
        let mut file_bytes = Vec::new();
        file.read_to_end(&mut file_bytes)?;
        Self::from_bytes(file_bytes)
    }

    /// Parses and verifies a Commit-Graph binary from memory.
    pub fn from_bytes(raw_bytes: Vec<u8>) -> FractalResult<Self> {
        if raw_bytes.len() < 8 + 48 + 20 {
            return Err(FractalError::ObjectCodec(
                "Commit-graph data is too short for minimal header and chunks".to_string(),
            ));
        }

        // 1. Verify Magic and Version
        if &raw_bytes[0..4] != COMMIT_GRAPH_MAGIC {
            return Err(FractalError::ObjectCodec(
                "Invalid commit-graph magic header".to_string(),
            ));
        }
        if raw_bytes[4] != COMMIT_GRAPH_VERSION {
            return Err(FractalError::ObjectCodec(format!(
                "Unsupported commit-graph version: {}",
                raw_bytes[4]
            )));
        }
        if raw_bytes[5] != COMMIT_GRAPH_HASH_SHA1 {
            return Err(FractalError::ObjectCodec(format!(
                "Unsupported hash version: {}",
                raw_bytes[5]
            )));
        }

        // 2. Verify Trailing Checksum
        let payload_len = raw_bytes.len() - 20;
        let mut hasher = Sha1::new();
        hasher.update(&raw_bytes[..payload_len]);
        let expected_checksum: [u8; 20] = hasher.finalize().into();
        if raw_bytes[payload_len..] != expected_checksum[..] {
            return Err(FractalError::ObjectCodec(
                "Commit-graph checksum mismatch; corrupt file".to_string(),
            ));
        }

        let chunk_count = raw_bytes[6] as usize;
        let mut oidf_offset = None;
        let mut oidl_offset = None;
        let mut cdat_offset = None;

        let mut cursor = 8usize;
        for _ in 0..chunk_count {
            if cursor + 12 > raw_bytes.len() {
                break;
            }
            let chunk_id = &raw_bytes[cursor..cursor + 4];
            let offset_bytes: [u8; 8] = raw_bytes[cursor + 4..cursor + 12]
                .try_into()
                .map_err(|_| FractalError::ObjectCodec("Slice conversion error".to_string()))?;
            let chunk_offset = u64::from_be_bytes(offset_bytes) as usize;

            if chunk_id == CHUNK_ID_OIDF {
                oidf_offset = Some(chunk_offset);
            } else if chunk_id == CHUNK_ID_OIDL {
                oidl_offset = Some(chunk_offset);
            } else if chunk_id == CHUNK_ID_CDAT {
                cdat_offset = Some(chunk_offset);
            }
            cursor += 12;
        }

        let oidf_off = oidf_offset.ok_or_else(|| {
            FractalError::ObjectCodec("Missing OIDF chunk in commit-graph".to_string())
        })?;
        let oidl_off = oidl_offset.ok_or_else(|| {
            FractalError::ObjectCodec("Missing OIDL chunk in commit-graph".to_string())
        })?;
        let cdat_off = cdat_offset.ok_or_else(|| {
            FractalError::ObjectCodec("Missing CDAT chunk in commit-graph".to_string())
        })?;

        // Number of commits is fanout[255]
        let fanout_end = oidf_off + 256 * 4;
        let last_fanout_bytes: [u8; 4] = raw_bytes[fanout_end - 4..fanout_end]
            .try_into()
            .map_err(|_| FractalError::ObjectCodec("Slice error".to_string()))?;
        let num_commits = u32::from_be_bytes(last_fanout_bytes) as usize;

        Ok(Self {
            binary_buffer: raw_bytes,
            oidf_offset: oidf_off,
            oidl_offset: oidl_off,
            cdat_offset: cdat_off,
            num_commits,
        })
    }

    /// Total number of commits indexed inside this commit-graph.
    pub fn num_commits(&self) -> usize {
        self.num_commits
    }

    /// Fast O(1) + O(log N) lookup finding commit position inside the graph.
    pub fn find_position(&self, target_oid: &Oid) -> Option<usize> {
        if self.num_commits == 0 {
            return None;
        }

        let first_byte = target_oid.as_bytes()[0] as usize;
        let range_start = if first_byte == 0 {
            0
        } else {
            let offset = self.oidf_offset + (first_byte - 1) * 4;
            let bytes: [u8; 4] = self.binary_buffer[offset..offset + 4].try_into().ok()?;
            u32::from_be_bytes(bytes) as usize
        };

        let offset = self.oidf_offset + first_byte * 4;
        let bytes: [u8; 4] = self.binary_buffer[offset..offset + 4].try_into().ok()?;
        let range_end = u32::from_be_bytes(bytes) as usize;

        if range_start >= range_end {
            return None;
        }

        let mut low = range_start;
        let mut high = range_end;

        while low < high {
            let mid = low + (high - low) / 2;
            let entry_offset = self.oidl_offset + mid * 20;
            let entry_bytes: [u8; 20] = self.binary_buffer[entry_offset..entry_offset + 20]
                .try_into()
                .ok()?;
            let entry_oid = Oid::from_bytes(entry_bytes);

            match entry_oid.cmp(target_oid) {
                std::cmp::Ordering::Less => low = mid + 1,
                std::cmp::Ordering::Greater => high = mid,
                std::cmp::Ordering::Equal => return Some(mid),
            }
        }

        None
    }

    /// Extracts complete commit entry at zero-based commit index position.
    pub fn get_entry(&self, position: usize) -> Option<CommitGraphEntry> {
        if position >= self.num_commits {
            return None;
        }

        // 1. Commit OID from OIDL
        let oidl_off = self.oidl_offset + position * 20;
        let commit_bytes: [u8; 20] = self.binary_buffer[oidl_off..oidl_off + 20]
            .try_into()
            .ok()?;
        let commit_oid = Oid::from_bytes(commit_bytes);

        // 2. CDAT Record (36 bytes)
        let cdat_off = self.cdat_offset + position * 36;
        let tree_bytes: [u8; 20] = self.binary_buffer[cdat_off..cdat_off + 20]
            .try_into()
            .ok()?;
        let tree_oid = Oid::from_bytes(tree_bytes);

        let parent_1_bytes: [u8; 4] = self.binary_buffer[cdat_off + 20..cdat_off + 24]
            .try_into()
            .ok()?;
        let parent_1_pos = u32::from_be_bytes(parent_1_bytes);

        let parent_2_bytes: [u8; 4] = self.binary_buffer[cdat_off + 24..cdat_off + 28]
            .try_into()
            .ok()?;
        let parent_2_pos = u32::from_be_bytes(parent_2_bytes);

        let packed_meta_bytes: [u8; 8] = self.binary_buffer[cdat_off + 28..cdat_off + 36]
            .try_into()
            .ok()?;
        let packed_meta = u64::from_be_bytes(packed_meta_bytes);
        let generation = ((packed_meta >> 34) & 0x3fff_ffff) as u32;
        let timestamp_sec = packed_meta & 0x0000_0003_ffff_ffff;

        let mut parent_oids = Vec::new();
        if parent_1_pos != NO_PARENT_MARKER {
            let parent_off = self.oidl_offset + (parent_1_pos as usize) * 20;
            if parent_off + 20 <= self.binary_buffer.len() {
                if let Ok(bytes) = self.binary_buffer[parent_off..parent_off + 20].try_into() {
                    parent_oids.push(Oid::from_bytes(bytes));
                }
            }
        }
        if parent_2_pos != NO_PARENT_MARKER {
            let parent_off = self.oidl_offset + (parent_2_pos as usize) * 20;
            if parent_off + 20 <= self.binary_buffer.len() {
                if let Ok(bytes) = self.binary_buffer[parent_off..parent_off + 20].try_into() {
                    parent_oids.push(Oid::from_bytes(bytes));
                }
            }
        }

        Some(CommitGraphEntry {
            commit_oid,
            tree_oid,
            parent_oids,
            generation,
            timestamp_sec,
        })
    }
}
