//! Module: taxis_cmd::unarchive_space — Preflight Space Planning & Projection
//! File Path: src/bin/taxis_cmd/unarchive_space.rs
//! Architecture Role: Computes preflight storage requirements, simulates headroom envelopes,
//!   queries filesystem free space across Windows and POSIX, and renders SpacePlan projections.
//! Dependencies & Triggers: Consumed by `unarchive.rs`.
//! Responsibilities: Probe free disk space, construct extraction unit profiles, simulate
//!   headroom trough level, and format JSON / human projections.
//! Exit Semantics & Design Rationale:
//!   - Pure read-only simulation that mutates no filesystem state.
//!   - Accurately models in-place progressive reclamation vs standard uncompressed staging.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-PRF-001.

use std::fs::File;
use std::path::{Path, PathBuf};

use fg_algorithms::space_plan::{
    simulate_space_plan, ExtractionUnit, SpacePlanConfig, SpacePlanReport,
};
use fg_core::error::{FractalError, FractalResult};
use fg_storage::in_place::{
    index_tar_archive, plan_tar_in_place, plan_zip_in_place, read_zip_central_directory,
    read_zip_eocd,
};
use serde_json::json;

use super::common::{print_json, CliContext};
use super::unarchive_options::UnarchiveOptions;

/// Profile identifying the compression and container shape of an archive operand.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArchiveProfile {
    /// Operand is a ZIP archive.
    pub is_zip: bool,
    /// Operand is an uncompressed TAR archive.
    pub is_tar: bool,
    /// Operand is a Git Bundle v2 file.
    pub is_bundle: bool,
}

/// Formats byte counts into human-readable strings (MB, GB).
pub fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.2} GB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
    } else if bytes >= 1024 * 1024 {
        format!("{:.2} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.2} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

/// Resolves an existing ancestor path whose volume can be probed for free space.
///
/// The destination directory may not exist yet (dry-run must create nothing), so the walk-up
/// keeps the probe read-only while still naming the volume the extraction will actually land on.
pub fn resolve_space_probe_path(target_path: &Path) -> PathBuf {
    let mut candidate = if target_path.is_absolute() {
        target_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(target_path))
            .unwrap_or_else(|_| target_path.to_path_buf())
    };
    loop {
        if candidate.exists() {
            return candidate;
        }
        match candidate.parent() {
            Some(parent) if parent != candidate => candidate = parent.to_path_buf(),
            _ => return candidate,
        }
    }
}

/// Queries available free disk space on the volume housing `target_path`.
///
/// Fails closed: an undeterminable figure is surfaced as an error, never replaced by an
/// optimistic constant, because the preflight headroom verdict would otherwise be fiction.
pub fn query_available_free_space(target_path: &Path) -> FractalResult<u64> {
    let probe_path = resolve_space_probe_path(target_path);

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                lpDirectoryName: *const u16,
                lpFreeBytesAvailableToCaller: *mut u64,
                lpTotalNumberOfBytes: *mut u64,
                lpTotalNumberOfFreeBytes: *mut u64,
            ) -> i32;
        }

        let mut wide: Vec<u16> = probe_path.as_os_str().encode_wide().collect();
        wide.push(0);

        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free: u64 = 0;

        // SAFETY: `wide` is a valid NUL-terminated wide string buffer. Out-pointers point to stack u64 variables.
        let status = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes,
                &mut total_bytes,
                &mut total_free,
            )
        };

        if status != 0 {
            return Ok(free_bytes);
        }

        Err(FractalError::Io(std::io::Error::last_os_error()))
    }

    #[cfg(not(windows))]
    {
        parse_df_available_bytes(&probe_path)
    }
}

/// Parses the available-block column of POSIX `df -P -k` output for `path`.
#[cfg(not(windows))]
fn parse_df_available_bytes(path: &Path) -> FractalResult<u64> {
    let output = std::process::Command::new("df")
        .arg("-Pk")
        .arg(path)
        .output()
        .map_err(FractalError::Io)?;
    if !output.status.success() {
        return Err(FractalError::Io(std::io::Error::other(format!(
            "df -Pk failed for '{}'",
            path.display()
        ))));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        if let Ok(blocks) = fields[3].parse::<u64>() {
            return Ok(blocks.saturating_mul(1024));
        }
    }
    Err(FractalError::Io(std::io::Error::other(format!(
        "cannot parse available space from df output for '{}'",
        path.display()
    ))))
}

/// Builds the preflight SpacePlan report for the selected family and execution mode.
///
/// In-place modes model progressive tail truncation reclamation; standard modes model a full
/// duplicate of the uncompressed payload because the source archive stays intact afterwards.
pub fn build_preflight_plan(
    opts: &UnarchiveOptions,
    profile: ArchiveProfile,
    file_len: u64,
    free_space: u64,
    config: &SpacePlanConfig,
) -> FractalResult<SpacePlanReport> {
    if opts.to_odb {
        if profile.is_zip {
            let mut file = File::open(&opts.archive_path).map_err(FractalError::Io)?;
            let eocd = read_zip_eocd(&mut file)?;
            let members = read_zip_central_directory(&mut file, &eocd)?;
            let units: Vec<ExtractionUnit> = members
                .iter()
                .filter(|member| !member.is_dir)
                .map(|member| {
                    let est_blob_size = if member.compression_method == 8 {
                        member.compressed_size.saturating_add(32)
                    } else {
                        (member.uncompressed_size as f64 * 0.4).ceil() as u64 + 32
                    };
                    let bytes_truncated = if opts.in_place {
                        member.compressed_size
                    } else {
                        0
                    };
                    ExtractionUnit::new(
                        &member.name,
                        est_blob_size,
                        bytes_truncated,
                        member.local_header_offset,
                    )
                })
                .collect();
            return Ok(simulate_space_plan(free_space, &units, config));
        }
        if profile.is_tar {
            let mut file = File::open(&opts.archive_path).map_err(FractalError::Io)?;
            let members = index_tar_archive(&mut file)?;
            let units: Vec<ExtractionUnit> = members
                .iter()
                .filter(|member| !member.is_dir)
                .map(|member| {
                    let est_blob_size = (member.size as f64 * 0.4).ceil() as u64 + 32;
                    let bytes_truncated = if opts.in_place { member.total_span } else { 0 };
                    ExtractionUnit::new(
                        &member.name,
                        est_blob_size,
                        bytes_truncated,
                        member.header_offset,
                    )
                })
                .collect();
            return Ok(simulate_space_plan(free_space, &units, config));
        }
    }

    if profile.is_bundle {
        // The embedded pack is staged as a full copy before any reclamation becomes possible.
        let units = if opts.in_place {
            vec![
                ExtractionUnit::new("bundle.pack.staging", file_len, 0, 0),
                ExtractionUnit::new("bundle.truncate", 0, file_len, 0),
            ]
        } else {
            vec![ExtractionUnit::new("bundle.pack.staging", file_len, 0, 0)]
        };
        return Ok(simulate_space_plan(free_space, &units, config));
    }

    if profile.is_zip {
        let mut file = File::open(&opts.archive_path).map_err(FractalError::Io)?;
        let eocd = read_zip_eocd(&mut file)?;
        let members = read_zip_central_directory(&mut file, &eocd)?;
        if opts.in_place {
            return Ok(plan_zip_in_place(free_space, &members, config));
        }
        let units: Vec<ExtractionUnit> = members
            .iter()
            .filter(|member| !member.is_dir)
            .map(|member| {
                ExtractionUnit::new(
                    &member.name,
                    member.uncompressed_size,
                    0,
                    member.local_header_offset,
                )
            })
            .collect();
        return Ok(simulate_space_plan(free_space, &units, config));
    }

    if profile.is_tar {
        let mut file = File::open(&opts.archive_path).map_err(FractalError::Io)?;
        let members = index_tar_archive(&mut file)?;
        if opts.in_place {
            return Ok(plan_tar_in_place(free_space, &members, config));
        }
        let units: Vec<ExtractionUnit> = members
            .iter()
            .filter(|member| !member.is_dir)
            .map(|member| ExtractionUnit::new(&member.name, member.size, 0, member.header_offset))
            .collect();
        return Ok(simulate_space_plan(free_space, &units, config));
    }

    // tar.gz forward stream: expansion is estimated, reclamation only happens in-place.
    let estimated_expanded = file_len.saturating_mul(3);
    let reclaimed = if opts.in_place { file_len } else { 0 };
    let units = vec![ExtractionUnit::new(
        "stream.tar.gz",
        estimated_expanded,
        reclaimed,
        0,
    )];
    Ok(simulate_space_plan(free_space, &units, config))
}

/// Describes the execution mode in user-facing terms.
pub fn execution_mode_label(opts: &UnarchiveOptions, profile: ArchiveProfile) -> &'static str {
    if profile.is_bundle {
        if opts.in_place {
            "In-Place Git Bundle Ingestion"
        } else {
            "Non-Destructive Git Bundle Ingestion"
        }
    } else if opts.to_odb {
        if opts.in_place {
            "In-Place Direct CAS ODB Ingestion"
        } else {
            "Direct CAS ODB Ingestion (source retained)"
        }
    } else if opts.in_place {
        "In-Place Adaptive Reclamation"
    } else {
        "Standard Extraction (source archive retained)"
    }
}

/// Prints the dry-run SpacePlan projection; performs no filesystem mutation of any kind.
pub fn print_space_plan_projection(
    ctx: &CliContext,
    opts: &UnarchiveOptions,
    profile: ArchiveProfile,
    file_len: u64,
    free_space: u64,
    config: &SpacePlanConfig,
    plan_report: &SpacePlanReport,
) {
    if ctx.json_mode {
        print_json(&json!({
            "archive": opts.archive_path.display().to_string(),
            "archive_size_bytes": file_len,
            "initial_free_bytes": free_space,
            "trough_free_bytes": plan_report.trough_free_space,
            "safety_headroom_bytes": config.safety_headroom_bytes,
            "is_viable": plan_report.is_viable,
            "required_additional_bytes": plan_report.required_additional_bytes,
            "in_place": opts.in_place,
            "mode": execution_mode_label(opts, profile),
        }));
        return;
    }

    println!("=== Taxis SpacePlan Projection (dry-run) ===");
    println!(
        "Archive:                 {} ({})",
        opts.archive_path.display(),
        format_bytes(file_len)
    );
    let target_display = if opts.to_odb {
        "Repository ODB (Zero Worktree Footprint)".to_string()
    } else {
        opts.dest_dir.display().to_string()
    };
    println!("Target Destination:      {target_display}");
    println!(
        "Execution Mode:          {}",
        execution_mode_label(opts, profile)
    );
    println!("Initial Free Disk Space: {}", format_bytes(free_space));
    println!(
        "Safety Headroom:         {}",
        format_bytes(config.safety_headroom_bytes)
    );
    println!(
        "Simulated Trough Level:  {}",
        format_bytes(plan_report.trough_free_space)
    );
    println!(
        "Projected Final Space:   {}",
        format_bytes(plan_report.final_free_space)
    );
    println!(
        "Assessment:              {}",
        if plan_report.is_viable {
            "VIABLE (Safe for execution)"
        } else {
            "BLOCKED (Headroom deficit)"
        }
    );
    if !plan_report.is_viable {
        println!(
            "Additional Space Needed: {}",
            format_bytes(plan_report.required_additional_bytes)
        );
    }
    println!("Disk Effects:            none (projection only)");
}
