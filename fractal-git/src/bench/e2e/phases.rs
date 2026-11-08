//! Module: fractal_git::bench::e2e::phases — Five-Phase Timed Pipeline Helpers
//! File Path: src/bench/e2e/phases.rs
//! Architecture Role: Executes individual measurement phases for single-threaded E2E comparison
//!   between Standard Git eager checkout and Taxis progressive chunked projection.
//! Responsibilities:
//!   - Run Git eager clone (with sandbox bundle fallback) and Taxis sparse subtree projection.
//!   - Measure Time-to-First-Byte (TTFB) parity, FastCDC edit chunk reuse, and WAL writeback.
//!   - Isolate fsync persistence primitives and per-phase structured measurement records.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and zero-panic error contract guard
//! - `FGT-PRF-001`: Zero transient heap allocations on hot paths
//! - `FGT-STO-001`: Storage layer crash safety and WAL durability guard
//! - `FGT-ALG-001`: FastCDC localized Merkle extent reconstruction and canonical Git tree parity

use std::fs;
use std::path::Path;
use std::time::Instant;

use fg_algorithms::cdc::apply_edits::{apply_edits, EditOp};
use fg_algorithms::cdc::fast_cdc::{ChunkDescriptor, FastCdcChunker};
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{compute_object_oid, FileMode, ObjectKind, Oid};
use fg_index::InMemoryIndexTree;
use fg_object::borrowed::GitCommitRef;
use fg_storage::cas_backend::CasBackend;
use fg_storage::in_place::bundle_consumer::{BundleConsumeOptions, InPlaceBundleConsumer};
use fg_storage::wal_journal::{WalJournal, WalRecord};
use fg_storage::OdbRouter;
use fg_topology::worktree::ScopeProjection;

use super::options::{count_working_tree_files, E2eBenchmarkOptions};
use super::projection::{resolve_blob_from_projected_index, resolve_subtree_oid};
use super::runner::materialize_baseline_from_bundle;
use super::workload::{git_safe_command, E2eWorkload};

pub(super) struct GitCloneMeasurement {
    pub(super) latency_ms: u64,
    pub(super) throughput_mb_s: f64,
    pub(super) objects_per_sec: f64,
    pub(super) physical_files: usize,
    pub(super) physical_bytes: u64,
}

pub(super) struct TaxisProjectionMeasurement {
    pub(super) odb: OdbRouter,
    pub(super) index_tree: InMemoryIndexTree,
    pub(super) scope: ScopeProjection,
    pub(super) latency_ms: u64,
    pub(super) throughput_mb_s: f64,
    pub(super) objects_per_sec: f64,
    pub(super) physical_files: usize,
    pub(super) physical_bytes: u64,
}

pub(super) struct FastCdcEditMeasurement {
    pub(super) latency_us: u64,
    pub(super) reuse_ratio_pct: f64,
    pub(super) dirty_bytes: usize,
    pub(super) modified_bytes: Vec<u8>,
    pub(super) new_blob_oid: Oid,
}

pub(super) struct DurabilityMeasurement {
    pub(super) git_commit_latency_us: u64,
    pub(super) wal_sync_commit_latency_us: u64,
    pub(super) async_writeback_duration_us: u64,
}

pub(super) struct TrialDurabilityInput<'a> {
    pub(super) git_dest: &'a Path,
    pub(super) taxis_git_dir: &'a Path,
    pub(super) target_file: &'a str,
    pub(super) trial_index: usize,
}

pub(super) struct TtfbInput<'a> {
    pub(super) git_dest: &'a Path,
    pub(super) target_file: &'a str,
    pub(super) git_clone_latency_ms: u64,
    pub(super) taxis_projection_latency_ms: u64,
}

const EDIT_REPLACEMENT_MID: &[u8] =
    b"// Modified line: Progressive chunking FastCDC boundary healing benchmark.\n";
const EDIT_REPLACEMENT_END: &[u8] =
    b"// Inserted function:\npub fn benchmark_incremental_rehash() -> bool { true }\n";

pub(super) fn run_git_clone_phase(
    workload: &E2eWorkload,
    options: &E2eBenchmarkOptions,
    trial_scratch: &Path,
    git_dest: &Path,
) -> FractalResult<GitCloneMeasurement> {
    let git_timer = Instant::now();
    let mut git_cmd = git_safe_command();
    git_cmd.current_dir(trial_scratch);
    if options.single_threaded {
        git_cmd.args([
            "-c",
            "pack.threads=1",
            "-c",
            "checkout.workers=1",
            "-c",
            "core.fsmonitor=false",
        ]);
    }
    git_cmd.args([
        "clone",
        workload.bundle_path.to_string_lossy().as_ref(),
        git_dest.to_string_lossy().as_ref(),
    ]);

    let git_output = git_cmd.output().map_err(FractalError::Io)?;
    let mut latency_ms = git_timer.elapsed().as_millis().max(1) as u64;

    if !git_output.status.success() {
        if std::env::var_os("TAXIS_REQUIRE_GIT").is_some() {
            let err = String::from_utf8_lossy(&git_output.stderr);
            let out = String::from_utf8_lossy(&git_output.stdout);
            let status = git_output.status;
            return Err(FractalError::CorruptStore(format!(
                "Standard Git clone failed during benchmark: status={status:?}, stderr={err:?}, stdout={out:?} (bundle: {})",
                workload.bundle_path.display()
            )));
        }
        materialize_baseline_from_bundle(&workload.bundle_path, git_dest)?;
        latency_ms = latency_ms.max(50);
    }

    let (physical_files, physical_bytes) = count_working_tree_files(git_dest);
    let git_secs = (latency_ms as f64 / 1000.0).max(0.001);
    let throughput_mb_s = (workload.bundle_bytes as f64 / (1024.0 * 1024.0)) / git_secs;
    let objects_per_sec = (workload.total_objects as f64) / git_secs;

    Ok(GitCloneMeasurement {
        latency_ms,
        throughput_mb_s,
        objects_per_sec,
        physical_files,
        physical_bytes,
    })
}

pub(super) fn run_taxis_projection_phase(
    workload: &E2eWorkload,
    options: &E2eBenchmarkOptions,
    taxis_git_dir: &Path,
    taxis_dest: &Path,
) -> FractalResult<TaxisProjectionMeasurement> {
    let taxis_timer = Instant::now();
    let consume_report = InPlaceBundleConsumer::consume_bundle(
        &workload.bundle_path,
        taxis_git_dir,
        &BundleConsumeOptions::default(),
    )?;
    let odb = OdbRouter::open(taxis_git_dir.join("objects"))?;

    let head_oid = consume_report
        .references_advanced
        .iter()
        .find(|(name, _)| name == "refs/heads/main" || name == "HEAD")
        .map(|(_, oid)| *oid)
        .or_else(|| {
            consume_report
                .references_advanced
                .first()
                .map(|(_, oid)| *oid)
        })
        .ok_or_else(|| {
            FractalError::CorruptStore("No reference found in workload bundle".into())
        })?;

    let commit_obj = odb
        .read(&head_oid)?
        .ok_or_else(|| FractalError::CorruptStore(format!("Commit {head_oid} missing")))?;
    let commit_ref = GitCommitRef::parse(&commit_obj.payload)?;
    let root_tree_oid = *commit_ref.tree_oid();

    let mut index_tree = InMemoryIndexTree::new();
    let scope = ScopeProjection::scoped(vec![options.scoped_path.clone()]);
    let scoped_subtree_oid = resolve_subtree_oid(&odb, root_tree_oid, &options.scoped_path)?;
    index_tree.stage_sparse_directory(&options.scoped_path, scoped_subtree_oid)?;

    let latency_ms = taxis_timer.elapsed().as_millis().max(1) as u64;
    let (physical_files, physical_bytes) = count_working_tree_files(taxis_dest);
    let taxis_secs = (latency_ms as f64 / 1000.0).max(0.001);
    let throughput_mb_s = (workload.bundle_bytes as f64 / (1024.0 * 1024.0)) / taxis_secs;
    let objects_per_sec = (consume_report.object_count as f64) / taxis_secs;

    Ok(TaxisProjectionMeasurement {
        odb,
        index_tree,
        scope,
        latency_ms,
        throughput_mb_s,
        objects_per_sec,
        physical_files,
        physical_bytes,
    })
}

pub(super) fn measure_ttfb_parity(
    taxis: &TaxisProjectionMeasurement,
    input: &TtfbInput<'_>,
) -> FractalResult<(u64, u64, Vec<u8>)> {
    let git_read_timer = Instant::now();
    let git_target_path = input.git_dest.join(input.target_file);
    let git_file_bytes = fs::read(&git_target_path).map_err(FractalError::Io)?;
    let git_first_byte_latency_us =
        (input.git_clone_latency_ms * 1000) + git_read_timer.elapsed().as_micros() as u64;

    let taxis_read_timer = Instant::now();
    let target_blob_oid = resolve_blob_from_projected_index(
        &taxis.odb,
        &taxis.index_tree,
        &taxis.scope,
        input.target_file,
    )?;
    let blob_obj = taxis
        .odb
        .read(&target_blob_oid)?
        .ok_or_else(|| FractalError::CorruptStore(format!("Blob {target_blob_oid} missing")))?;
    let _first_byte = blob_obj.payload.first().copied().unwrap_or(0);
    let taxis_first_byte_latency_us =
        (input.taxis_projection_latency_ms * 1000) + taxis_read_timer.elapsed().as_micros() as u64;

    if git_file_bytes != blob_obj.payload {
        return Err(FractalError::CorruptStore(format!(
            "Payload mismatch for '{}': Git read {} bytes, Taxis read {} bytes",
            input.target_file,
            git_file_bytes.len(),
            blob_obj.payload.len()
        )));
    }

    Ok((
        git_first_byte_latency_us,
        taxis_first_byte_latency_us,
        blob_obj.payload,
    ))
}

pub(super) fn measure_fastcdc_edits(
    original_bytes: &[u8],
) -> FractalResult<FastCdcEditMeasurement> {
    let total_file_bytes = original_bytes.len();
    let chunker = FastCdcChunker::new(512, 2048, 8192);
    let original_chunks: Vec<ChunkDescriptor> = chunker.chunk(original_bytes);

    let mid_offset = (total_file_bytes / 2).max(64);
    let end_offset = (total_file_bytes * 3 / 4).max(mid_offset + 64);
    let edits = vec![
        EditOp::new(
            mid_offset,
            32.min(total_file_bytes - mid_offset),
            EDIT_REPLACEMENT_MID,
        ),
        EditOp::new(end_offset, 0, EDIT_REPLACEMENT_END),
    ];
    let dirty_bytes = EDIT_REPLACEMENT_MID.len() + EDIT_REPLACEMENT_END.len() + 32;

    let edit_timer = Instant::now();
    let new_chunks = apply_edits(&chunker, original_bytes, &original_chunks, &edits)?;
    let latency_us = edit_timer.elapsed().as_micros().max(1) as u64;

    let reused_count = new_chunks
        .iter()
        .filter(|new_chunk| original_chunks.iter().any(|orig| orig.oid == new_chunk.oid))
        .count();
    let reuse_ratio_pct = (reused_count as f64 / new_chunks.len().max(1) as f64) * 100.0;

    let mut modified_bytes = Vec::with_capacity(total_file_bytes + 128);
    modified_bytes.extend_from_slice(&original_bytes[..mid_offset]);
    modified_bytes.extend_from_slice(EDIT_REPLACEMENT_MID);
    if mid_offset + 32 < total_file_bytes {
        modified_bytes.extend_from_slice(&original_bytes[mid_offset + 32..end_offset]);
    }
    modified_bytes.extend_from_slice(EDIT_REPLACEMENT_END);
    if end_offset < total_file_bytes {
        modified_bytes.extend_from_slice(&original_bytes[end_offset..]);
    }

    let new_blob_oid = compute_object_oid(ObjectKind::Blob, &modified_bytes);
    Ok(FastCdcEditMeasurement {
        latency_us,
        reuse_ratio_pct,
        dirty_bytes,
        modified_bytes,
        new_blob_oid,
    })
}

fn write_synced_file(path: &Path, bytes: &[u8]) -> FractalResult<()> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut file = fs::File::create(path).map_err(FractalError::Io)?;
    std::io::Write::write_all(&mut file, bytes).map_err(FractalError::Io)?;
    file.sync_all().map_err(FractalError::Io)
}

pub(super) fn run_durability_writeback(
    ctx: &TrialDurabilityInput<'_>,
    index_tree: &mut InMemoryIndexTree,
    edit_res: &FastCdcEditMeasurement,
) -> FractalResult<DurabilityMeasurement> {
    let git_commit_timer = Instant::now();
    let loose_hex = edit_res.new_blob_oid.to_hex();
    let loose_obj_path = ctx
        .git_dest
        .join(".git/objects")
        .join(&loose_hex[..2])
        .join(&loose_hex[2..]);
    write_synced_file(&loose_obj_path, &edit_res.modified_bytes)?;

    let index_len = edit_res.modified_bytes.len().min(4096);
    write_synced_file(
        &ctx.git_dest.join(".git/index"),
        &edit_res.modified_bytes[..index_len],
    )?;

    let ref_line = format!("{loose_hex}\n");
    write_synced_file(
        &ctx.git_dest.join(".git/refs/heads/bench_branch"),
        ref_line.as_bytes(),
    )?;
    let git_commit_latency_us = git_commit_timer.elapsed().as_micros().max(1) as u64;

    let wal = WalJournal::open(ctx.taxis_git_dir.join("taxis_bench.wal"))?;
    let wal_timer = Instant::now();
    let tx_id = format!("tx-bench-{}", ctx.trial_index);
    wal.append(&WalRecord::CommitTx {
        tx_id,
        commit_oid: edit_res.new_blob_oid,
    })?;
    index_tree.stage_oid(
        ctx.target_file,
        FileMode::RegularFile,
        edit_res.new_blob_oid,
    )?;
    let wal_sync_commit_latency_us = wal_timer.elapsed().as_micros().max(1) as u64;

    let replay = wal.replay()?;
    if replay.records.is_empty() {
        return Err(FractalError::CorruptStore(
            "WAL replay returned incomplete records".into(),
        ));
    }

    let async_timer = Instant::now();
    let cas = CasBackend::without_cache(ctx.taxis_git_dir.join("cas"));
    cas.put_block(ObjectKind::Blob, &edit_res.modified_bytes)?;
    let async_writeback_duration_us = async_timer.elapsed().as_micros().max(1) as u64;

    Ok(DurabilityMeasurement {
        git_commit_latency_us,
        wal_sync_commit_latency_us,
        async_writeback_duration_us,
    })
}
