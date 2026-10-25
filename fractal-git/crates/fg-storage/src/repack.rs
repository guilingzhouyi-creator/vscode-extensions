//! Module: fg-storage::repack — Object Repack & Packfile Consolidation Engine
//! File Path: crates/fg-storage/src/repack.rs
//! Architecture Role: Consolidates loose Git objects into high-density Git Packfile v2 streams with
//!   sliding-window delta compression and generates canonical Index v2 files.
//! Dependencies & Triggers: Consumed by Taxis CLI `repack` command and background async workers.
//! Responsibilities: Scan loose objects, coordinate delta compression, atomically publish .pack and .idx,
//!   and safely purge redundant loose objects.
//! Exit Semantics & Design Rationale:
//!   - Atomic write-and-rename prevents partial pack visibility during generation.
//!   - Verification pass ensures every packed object decodes before loose objects are deleted.
//!   - Background async spawning allows zero-blocking auto-repack triggers.
//!   - Zero-transient allocation: extraction helpers hoist allocation outside directory loops.

use flate2::read::ZlibDecoder;
use sha1::{Digest, Sha1};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Instant;

use fg_algorithms::pack::{find_pack_deltas, PackDeltaItem, DEFAULT_DELTA_WINDOW, MAX_DELTA_DEPTH};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, ObjectKind, Oid};

use crate::backends::idx_file::PackIndex;
use crate::backends::idx_writer::IdxWriter;
use crate::backends::pack_file::{DeltaBaseSource, PackFile};
use crate::backends::pack_writer::{crc32_ieee, PackEntryMeta, PackWriter};

/// Configuration options controlling object consolidation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepackOptions {
    /// Window size for sliding-window delta compression (default: 10).
    pub window_size: usize,
    /// Maximum allowed delta chain depth (default: 50).
    pub max_depth: usize,
    /// Whether to preserve loose objects after packing (default: false).
    pub keep_loose: bool,
    /// Minimum count of loose objects required to trigger an automatic repack (default: 128).
    pub auto_repack_threshold: usize,
}

impl Default for RepackOptions {
    fn default() -> Self {
        Self {
            window_size: DEFAULT_DELTA_WINDOW,
            max_depth: MAX_DELTA_DEPTH,
            keep_loose: false,
            auto_repack_threshold: 128,
        }
    }
}

/// Execution summary returned upon successful repack completion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepackReport {
    pub pack_oid: Oid,
    pub idx_oid: Oid,
    pub objects_packed: usize,
    /// Entries decoded from the freshly written pack and matched against their recorded ids.
    pub objects_verified: usize,
    pub pack_bytes: u64,
    pub loose_pruned: usize,
    pub duration_ms: u64,
}

/// Marker emitted when a freshly written pack fails replay verification.
pub const REPACK_BLOCKED_MARKER: &str = "[REPACK_BLOCKED]";

/// Byte count of a Git pack v2 header: magic, version, and object count.
const PACK_HEADER_LEN: usize = 12;

/// Byte count of one SHA-1 digest.
const SHA1_LEN: usize = 20;

/// Byte count of the pack-sha plus index-sha trailer of an Index v2 file.
const IDX_TRAILER_LEN: usize = SHA1_LEN * 2;

/// Replay facts proving a written pack and index agree with the objects they replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackReplayReport {
    /// Number of entries decoded from the pack and matched against their recorded ids.
    pub objects_verified: usize,
}

/// Turns a replay finding into a store error carrying [`REPACK_BLOCKED_MARKER`].
fn blocked_repack(detail: impl std::fmt::Display) -> FractalError {
    FractalError::CorruptStore(format!("{REPACK_BLOCKED_MARKER} {detail}"))
}

/// Resolver that refuses `REF_DELTA` bases outside a pack written by this run.
///
/// [`PackWriter`] only emits `OBJ_OFS_DELTA`, so any external-base request means the written pack
/// is not self-contained; consulting another store would validate an object this pack cannot
/// reconstruct on its own.
struct PackOnlyBase;

impl DeltaBaseSource for PackOnlyBase {
    fn read_base(&self, oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
        Err(blocked_repack(format!(
            "newly written pack entry references external base {}",
            oid.to_hex()
        )))
    }
}

/// Verifies a freshly written pack and index by replaying every object.
///
/// # Errors
///
/// Returns [`FractalError::Io`] when either file cannot be read, and
/// [`FractalError::CorruptStore`] whose message starts with [`REPACK_BLOCKED_MARKER`] when the pack
/// trailer, the index trailer, an index offset or CRC, the entry layout, or any decoded object id
/// disagrees with what the writer reported.
pub fn verify_written_pack(
    pack_path: &Path,
    idx_path: &Path,
    entries: &[PackEntryMeta],
) -> FractalResult<PackReplayReport> {
    let pack_bytes = fs::read(pack_path)?;
    if pack_bytes.len() < PACK_HEADER_LEN + SHA1_LEN {
        return Err(blocked_repack(format!(
            "pack '{}' is {} bytes, shorter than a header plus trailer",
            pack_path.display(),
            pack_bytes.len()
        )));
    }
    let pack_payload_end = pack_bytes.len() - SHA1_LEN;
    let pack_trailer = &pack_bytes[pack_payload_end..];
    let pack_digest = Sha1::digest(&pack_bytes[..pack_payload_end]);
    if pack_trailer != pack_digest.as_slice() {
        return Err(blocked_repack(format!(
            "pack '{}' trailer does not match its SHA-1",
            pack_path.display()
        )));
    }

    let idx_bytes = fs::read(idx_path)?;
    if idx_bytes.len() < IDX_TRAILER_LEN {
        return Err(blocked_repack(format!(
            "index '{}' is {} bytes, shorter than its two-SHA-1 trailer",
            idx_path.display(),
            idx_bytes.len()
        )));
    }
    let idx_payload_end = idx_bytes.len() - SHA1_LEN;
    let idx_digest = Sha1::digest(&idx_bytes[..idx_payload_end]);
    if &idx_bytes[idx_payload_end..] != idx_digest.as_slice() {
        return Err(blocked_repack(format!(
            "index '{}' trailer does not match its SHA-1",
            idx_path.display()
        )));
    }
    let idx_pack_sha_start = idx_payload_end - SHA1_LEN;
    if &idx_bytes[idx_pack_sha_start..idx_payload_end] != pack_trailer {
        return Err(blocked_repack(format!(
            "index '{}' does not name pack '{}'",
            idx_path.display(),
            pack_path.display()
        )));
    }

    let index = PackIndex::load(idx_path)?;
    if index.object_count() != entries.len() {
        return Err(blocked_repack(format!(
            "index '{}' lists {} objects but the pack contains {}",
            idx_path.display(),
            index.object_count(),
            entries.len()
        )));
    }

    let mut ordered: Vec<&PackEntryMeta> = entries.iter().collect();
    ordered.sort_by_key(|entry| entry.offset);
    let mut expected_offset = PACK_HEADER_LEN as u64;
    for (position, entry) in ordered.iter().enumerate() {
        if entry.offset != expected_offset {
            return Err(blocked_repack(format!(
                "entry at offset {} is not contiguous with the extent ending at {}",
                entry.offset, expected_offset
            )));
        }
        if index.lookup(&entry.oid) != Some(entry.offset) {
            return Err(blocked_repack(format!(
                "index '{}' does not map object {} to offset {}",
                idx_path.display(),
                entry.oid.to_hex(),
                entry.offset
            )));
        }
        let entry_end = ordered
            .get(position + 1)
            .map_or(pack_payload_end as u64, |next| next.offset);
        if entry_end <= entry.offset || entry_end > pack_payload_end as u64 {
            return Err(blocked_repack(format!(
                "pack entry {} has invalid extent {}..{}",
                entry.oid.to_hex(),
                entry.offset,
                entry_end
            )));
        }
        let compressed = &pack_bytes[entry.offset as usize..entry_end as usize];
        if crc32_ieee(compressed) != entry.crc32 {
            return Err(blocked_repack(format!(
                "pack entry {} CRC32 does not match its index record",
                entry.oid.to_hex()
            )));
        }
        expected_offset = entry_end;
    }
    if expected_offset != pack_payload_end as u64 {
        return Err(blocked_repack(format!(
            "pack '{}' leaves {} bytes after the last object",
            pack_path.display(),
            pack_payload_end as u64 - expected_offset
        )));
    }

    let pack = PackFile::load(pack_path)?;
    if pack.object_count() as usize != entries.len() {
        return Err(blocked_repack(format!(
            "pack '{}' header declares {} objects but the writer reported {}",
            pack_path.display(),
            pack.object_count(),
            entries.len()
        )));
    }
    for entry in entries {
        let packed = pack.read_at(entry.offset, &PackOnlyBase).map_err(|error| {
            blocked_repack(format!(
                "pack entry {} cannot be replayed: {error}",
                entry.oid.to_hex()
            ))
        })?;
        let actual = compute_object_oid(packed.kind, &packed.payload);
        if actual != entry.oid {
            return Err(blocked_repack(format!(
                "pack entry at offset {} decodes to {} instead of {}",
                entry.offset,
                actual.to_hex(),
                entry.oid.to_hex()
            )));
        }
    }

    Ok(PackReplayReport {
        objects_verified: entries.len(),
    })
}

/// Makes directory-entry changes durable on platforms that expose directory handles.
#[cfg(unix)]
fn sync_directory(dir: &Path) {
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
}

/// Directory handles are not syncable through the Windows standard library.
#[cfg(not(unix))]
fn sync_directory(_dir: &Path) {}

/// Helper parsing Git object header: `<type> <size>\0<content>`.
fn parse_raw_object_header(bytes: &[u8]) -> Option<(ObjectKind, usize, usize)> {
    let nul_pos = bytes.iter().position(|&b| b == 0)?;
    let header_str = std::str::from_utf8(&bytes[..nul_pos]).ok()?;
    let mut parts = header_str.split(' ');
    let type_name = parts.next()?;
    let size_str = parts.next()?;
    let size: usize = size_str.parse().ok()?;
    let kind = match type_name {
        "commit" => ObjectKind::Commit,
        "tree" => ObjectKind::Tree,
        "blob" => ObjectKind::Blob,
        "tag" => ObjectKind::Tag,
        _ => return None,
    };
    Some((kind, size, nul_pos + 1))
}

/// Reads a single loose object file from disk without in-loop allocation.
fn read_loose_entry(dir_prefix: &str, file_path: &Path) -> Option<(Oid, ObjectKind, Vec<u8>)> {
    let file_name = file_path.file_name()?;
    let file_str = file_name.to_str()?;
    if file_str.len() != 38 || !file_str.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }

    let mut hex = String::with_capacity(40);
    hex.push_str(dir_prefix);
    hex.push_str(file_str);
    let oid = Oid::from_hex(&hex).ok()?;

    let file = File::open(file_path).ok()?;
    let mut decoder = ZlibDecoder::new(file);
    let mut decompressed = Vec::with_capacity(4096);
    decoder.read_to_end(&mut decompressed).ok()?;

    let (kind, declared_size, header_len) = parse_raw_object_header(&decompressed)?;
    let payload = decompressed[header_len..].to_vec();
    if payload.len() == declared_size {
        Some((oid, kind, payload))
    } else {
        None
    }
}

/// Scans and loads loose objects from `.git/objects/??/*`.
pub fn scan_loose_objects(git_dir: &Path) -> FractalResult<Vec<(Oid, ObjectKind, Vec<u8>)>> {
    let objects_dir = git_dir.join("objects");
    if !objects_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut found = Vec::new();
    let entries = fs::read_dir(&objects_dir)?;

    for entry_res in entries {
        let entry = entry_res?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let dir_name = entry.file_name();
        let dir_str = dir_name.to_string_lossy();
        if dir_str.len() != 2 || !dir_str.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }

        let sub_entries = fs::read_dir(entry.path())?;
        for sub_res in sub_entries {
            let sub = sub_res?;
            if !sub.file_type()?.is_file() {
                continue;
            }

            if let Some(record) = read_loose_entry(&dir_str, &sub.path()) {
                found.push(record);
            }
        }
    }

    Ok(found)
}

/// Primary repack engine entry point.
pub struct RepackEngine;

impl RepackEngine {
    /// Consolidates all loose objects in `git_dir` into a single new Packfile and Index v2.
    pub fn repack_repository(
        git_dir: &Path,
        options: &RepackOptions,
    ) -> FractalResult<Option<RepackReport>> {
        let start_time = Instant::now();
        let loose_objects = scan_loose_objects(git_dir)?;
        if loose_objects.is_empty() {
            return Ok(None);
        }

        let count = loose_objects.len();
        let mut delta_items = Vec::with_capacity(count);
        for (oid, kind, payload) in loose_objects {
            delta_items.push(PackDeltaItem::new(oid, kind, payload, None));
        }

        // 1. Sliding-window delta search
        let chains = find_pack_deltas(delta_items, options.window_size, options.max_depth);

        // 2. Prepare destination paths in objects/pack/
        let pack_dir = git_dir.join("objects").join("pack");
        fs::create_dir_all(&pack_dir)?;

        let temp_pack_path = pack_dir.join(format!("tmp_pack_{}.tmp", std::process::id()));
        let temp_idx_path = pack_dir.join(format!("tmp_idx_{}.tmp", std::process::id()));

        // 3. Write and flush the pack stream. The handle stays open because syncing, the replay
        //    pass, and the reported size must all observe the bytes that reached the disk.
        let pack_file = File::create(&temp_pack_path)?;
        let (pack_oid, entries) = PackWriter::write_pack(&chains, &pack_file)?;
        pack_file.sync_all()?;
        let pack_bytes = pack_file.metadata()?.len();

        // 4. Write and flush Index v2 stream
        let idx_file = File::create(&temp_idx_path)?;
        let idx_oid = IdxWriter::write_idx(entries.clone(), &pack_oid, &idx_file)?;
        idx_file.sync_all()?;

        // 5. Replay the fresh pack before publishing it or deleting a single loose object.
        let replay = match verify_written_pack(&temp_pack_path, &temp_idx_path, &entries) {
            Ok(report) => report,
            Err(error) => {
                let _ = fs::remove_file(&temp_pack_path);
                let _ = fs::remove_file(&temp_idx_path);
                return Err(blocked_repack(format!(
                    "repack replay failed before publishing: {error}"
                )));
            }
        };

        // 6. Atomic publish, then make the directory entry durable where the platform allows it.
        let final_pack_path = pack_dir.join(format!("pack-{}.pack", pack_oid.to_hex()));
        let final_idx_path = pack_dir.join(format!("pack-{}.idx", pack_oid.to_hex()));

        fs::rename(&temp_pack_path, &final_pack_path)?;
        fs::rename(&temp_idx_path, &final_idx_path)?;
        sync_directory(&pack_dir);

        // 7. Purge packed loose objects only after the verified pack is published.
        let mut loose_pruned = 0;
        if !options.keep_loose {
            for chain in &chains {
                let hex = chain.oid.to_hex();
                let (d, f) = hex.split_at(2);
                let loose_path = git_dir.join("objects").join(d).join(f);
                if loose_path.is_file() && fs::remove_file(&loose_path).is_ok() {
                    loose_pruned += 1;
                }
            }
        }

        let duration_ms = start_time.elapsed().as_millis() as u64;

        Ok(Some(RepackReport {
            pack_oid,
            idx_oid,
            objects_packed: count,
            objects_verified: replay.objects_verified,
            pack_bytes,
            loose_pruned,
            duration_ms,
        }))
    }

    /// Spawns a background thread to execute asynchronous repack.
    pub fn trigger_async_repack(
        git_dir: PathBuf,
        options: RepackOptions,
    ) -> thread::JoinHandle<FractalResult<Option<RepackReport>>> {
        thread::spawn(move || Self::repack_repository(&git_dir, &options))
    }

    /// Checks if loose object count exceeds auto-repack threshold.
    pub fn should_auto_repack(git_dir: &Path, threshold: usize) -> bool {
        let objects_dir = git_dir.join("objects");
        if !objects_dir.is_dir() {
            return false;
        }

        let mut count = 0;
        if let Ok(entries) = fs::read_dir(objects_dir) {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() {
                        let name = entry.file_name();
                        let s = name.to_string_lossy();
                        if s.len() == 2 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                            if let Ok(subs) = fs::read_dir(entry.path()) {
                                count += subs.flatten().count();
                                if count >= threshold {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        false
    }
}
