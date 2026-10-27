//! Module: taxis_cmd::unarchive — In-Place Archive Decompression CLI
//! File Path: src/bin/taxis_cmd/unarchive.rs
//! Architecture Role: Dispatches `taxis unarchive`, providing in-place tail-truncating archive
//!   extraction for ZIP and TAR archives, and forward hole-punching for TAR.GZ archives.
//! Dependencies & Triggers: Dispatched by `taxis unarchive` / `taxis extract`.
//! Responsibilities: Preflight SpacePlan simulation, journal recovery, execution reporting; option parsing lives in `unarchive_options`.
//! Exit Semantics & Design Rationale:
//!   - Preflight SpacePlan check prevents ENOSPC disk exhaustion.
//!   - Supports `--dry-run` to visualize the trough water-level curve before modifying any bytes.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `FGT-PRF-001`: Resource recycling and zero-transient allocation guard
//! - `FGT-COR-001`: Core error contract guard

use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use fg_algorithms::space_plan::{check_headroom, SpacePlanConfig};
use fg_core::models::{current_unix_seconds, FileMode, GitSignature, TaxisPolicy};
use fg_core::traits::{OdbStore, RefStore};
use fg_gate::commit_guard::CommitMessageGuard;
use fg_gate::pre_receive::PreReceiveGuard;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{serialize_commit_payload, serialize_tree_payload};
use fg_storage::in_place::{
    extract_member_payload, extract_tar_in_place_with_journal, extract_tar_standard,
    extract_targz_forward_hole_punch, extract_zip_in_place_with_journal, extract_zip_standard,
    index_tar_archive, read_zip_central_directory, read_zip_eocd, sanitize_relative_path,
    BundleConsumeOptions, InPlaceBundleConsumer, InPlaceJournal, InPlaceLogEntry, TailTruncator,
};
use fg_storage::loose::LooseOdb;
use fg_topology::refs::FractalRef;
use fg_topology::DiskRefStore;
use fractal_git::constants::cli::CliTag;
use serde_json::json;

use super::common::{fail_fatal, fail_io, find_arg_value, print_json, reject, CliContext};
use super::repo_view::RepoView;
use super::unarchive_options::{parse_unarchive_options, print_unarchive_help, UnarchiveOptions};
use super::unarchive_space::{
    build_preflight_plan, format_bytes, print_space_plan_projection, query_available_free_space,
    ArchiveProfile,
};

/// Dispatches `taxis unarchive`.
pub fn handle_unarchive(ctx: &CliContext) {
    if ctx.args.is_empty()
        || ctx
            .args
            .iter()
            .any(|a| a == "-h" || a == "--help" || a == "help")
    {
        print_unarchive_help();
        return;
    }

    let opts = parse_unarchive_options(&ctx.args);

    if !opts.archive_path.exists() {
        fail_fatal(format!(
            "archive file '{}' does not exist",
            opts.archive_path.display()
        ));
    }

    let file_len = match opts.archive_path.metadata() {
        Ok(m) => m.len(),
        Err(e) => fail_io("stat archive file", e),
    };

    let filename = opts
        .archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let is_zip = filename.ends_with(".zip");
    let is_targz = filename.ends_with(".tar.gz") || filename.ends_with(".tgz");
    let is_tar = filename.ends_with(".tar");
    let is_bundle = filename.ends_with(".bundle");

    if !is_zip && !is_tar && !is_targz && !is_bundle {
        reject(
            CliTag::ERROR,
            format!(
                "unsupported archive format for '{}'. Must be .zip, .tar, .tar.gz, or .bundle",
                opts.archive_path.display()
            ),
        );
    }

    let mut config =
        SpacePlanConfig::adaptive_for_archive_size(file_len, Some(opts.safety_headroom_bytes));
    if let Some(batch_win) = opts.batch_window_bytes {
        config.batch_window_bytes = batch_win;
    }

    let probe_dir = if opts.to_odb || is_bundle {
        match RepoView::open(ctx) {
            Ok(v) => v.git_dir().to_path_buf(),
            Err(_) => PathBuf::from(".git"),
        }
    } else {
        opts.dest_dir.clone()
    };

    let free_space = match query_available_free_space(&probe_dir) {
        Ok(bytes) => bytes,
        Err(err) => reject(
            CliTag::ERROR,
            format!(
                "cannot determine free disk space for probe path '{}' (fail-closed): {err}",
                probe_dir.display()
            ),
        ),
    };

    if opts.to_odb && !is_zip && !is_tar {
        reject(
            CliTag::ERROR,
            "--to-odb is currently supported for .zip and .tar archives",
        );
    }

    let profile = ArchiveProfile {
        is_zip,
        is_tar,
        is_bundle,
    };

    // 1. Preflight SpacePlan simulation shared by the dry-run, to-odb, and execution paths.
    let plan_report = match build_preflight_plan(&opts, profile, file_len, free_space, &config) {
        Ok(report) => report,
        Err(err) => reject(CliTag::ERROR, format!("preflight planning failed: {err}")),
    };

    // 2. `--dry-run` projects the trough curve and touches nothing else: no truncation, no
    // worktree files, no ODB objects, no ref updates.
    if opts.dry_run {
        print_space_plan_projection(
            ctx,
            &opts,
            profile,
            file_len,
            free_space,
            &config,
            &plan_report,
        );
        return;
    }

    // 3. Preflight Headroom Enforcement
    if let Err(err) = check_headroom(&plan_report) {
        reject(
            CliTag::ERROR,
            format!("preflight space check rejected extraction: {err}"),
        );
    }

    // Special handling for Git Bundle v2 ingestion
    if is_bundle {
        handle_bundle_ingestion(ctx, &opts);
        return;
    }

    // Direct CAS ODB Ingestion mode (Decision 3)
    if opts.to_odb {
        handle_unarchive_to_odb(ctx, &opts, is_zip, is_tar);
        return;
    }

    // 4. Execute extraction (destination creation happens only after preflight passes)
    if let Err(err) = std::fs::create_dir_all(&opts.dest_dir) {
        fail_io("create destination directory", err);
    }

    let journal_path = opts.dest_dir.join(".taxis_unarchive.wal");
    let resume_state = if opts.in_place && journal_path.exists() {
        match InPlaceJournal::replay(&journal_path) {
            Ok(state) if !state.is_completed && !state.extracted_members.is_empty() => {
                if !ctx.json_mode {
                    println!(
                        "Notice: Incomplete in-place extraction detected in WAL. Resuming session ({} members already extracted)...",
                        state.extracted_members.len()
                    );
                }
                Some(state)
            }
            _ => None,
        }
    } else {
        None
    };

    let already_extracted = resume_state.as_ref().map(|s| &s.extracted_members);
    let mut journal = if opts.in_place {
        match InPlaceJournal::open(&journal_path) {
            Ok(mut j) => {
                if resume_state.is_none() {
                    let _ = j.append(&InPlaceLogEntry::SessionInit {
                        archive_path: opts.archive_path.display().to_string(),
                        target_path: opts.dest_dir.display().to_string(),
                        total_members: plan_report.steps.len(),
                        initial_archive_len: file_len,
                    });
                }
                Some(j)
            }
            Err(e) => fail_io("open extraction WAL journal", e),
        }
    } else {
        None
    };

    // Forward .tar.gz extraction reports punched (sparse) bytes instead of tail-truncated bytes;
    // keep that distinction visible in the summary instead of folding it into truncation counters.
    let mut hole_punched_bytes: Option<u64> = None;

    let result = if profile.is_zip {
        if opts.in_place {
            extract_zip_in_place_with_journal(
                &opts.archive_path,
                &opts.dest_dir,
                &config,
                journal.as_mut(),
                already_extracted,
            )
        } else {
            extract_zip_standard(&opts.archive_path, &opts.dest_dir)
        }
    } else if profile.is_tar {
        if opts.in_place {
            extract_tar_in_place_with_journal(
                &opts.archive_path,
                &opts.dest_dir,
                &config,
                journal.as_mut(),
                already_extracted,
            )
        } else {
            extract_tar_standard(&opts.archive_path, &opts.dest_dir)
        }
    } else if opts.in_place {
        extract_targz_forward_hole_punch(
            &opts.archive_path,
            &opts.dest_dir,
            config.batch_window_bytes,
        )
        .map(|report| {
            hole_punched_bytes = Some(report.hole_punched_bytes);
            report.into_extraction_report()
        })
    } else {
        extract_tar_standard(&opts.archive_path, &opts.dest_dir)
    };

    match result {
        Ok(report) => {
            if let Some(j) = journal {
                let _ = j.remove();
            }

            if ctx.json_mode {
                print_json(&json!({
                    "archive": opts.archive_path.display().to_string(),
                    "in_place": opts.in_place,
                    "files_extracted": report.files_extracted,
                    "total_extracted_bytes": report.total_extracted_bytes,
                    "total_truncated_bytes": report.total_truncated_bytes,
                    "hole_punched_bytes": hole_punched_bytes,
                    "final_archive_len": report.final_archive_len,
                }));
            } else {
                println!(
                    "Successfully extracted {} files from {} ({}).",
                    report.files_extracted,
                    opts.archive_path.display(),
                    format_bytes(report.total_extracted_bytes)
                );
                if !opts.in_place {
                    println!(
                        "Source archive retained intact ({}, {} truncated).",
                        format_bytes(report.final_archive_len),
                        format_bytes(report.total_truncated_bytes)
                    );
                } else if let Some(punched) = hole_punched_bytes {
                    println!(
                        "Reclaimed {} of disk space via forward hole punching; archive retained \
                         at {} (sparse).",
                        format_bytes(punched),
                        format_bytes(report.final_archive_len)
                    );
                } else {
                    println!(
                        "Reclaimed {} of disk space via tail-truncation.",
                        format_bytes(report.total_truncated_bytes)
                    );
                }
            }
        }
        Err(err) => {
            reject(
                CliTag::ERROR,
                format!("extraction aborted with error: {err}"),
            );
        }
    }
}

/// Ingests a Git Bundle v2 operand into the repository ODB, honoring the in-place switch.
fn handle_bundle_ingestion(ctx: &CliContext, opts: &UnarchiveOptions) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(
            CliTag::ERROR,
            format!("open repository for bundle ingestion: {err}"),
        ),
    };
    let git_dir = view.git_dir();
    let consume_options = BundleConsumeOptions {
        truncate_source: opts.in_place,
    };
    match InPlaceBundleConsumer::consume_bundle(&opts.archive_path, git_dir, &consume_options) {
        Ok(report) => {
            if ctx.json_mode {
                print_json(&json!({
                    "status": "success",
                    "format": "bundle",
                    "pack_oid": report.pack_oid.to_hex(),
                    "object_count": report.object_count,
                    "bundle_bytes_reclaimed": report.bundle_bytes_reclaimed,
                    "source_truncated": report.source_truncated,
                    "source_retained_bytes": report.source_retained_bytes,
                    "references_advanced": report.references_advanced.iter().map(|(r, o)| {
                        json!({ "ref": r, "oid": o.to_hex() })
                    }).collect::<Vec<_>>(),
                }));
            } else {
                println!("=== Taxis Bundle Ingestion ===");
                println!("Packfile Ingested:       {}", report.pack_oid.to_hex());
                println!("Objects Extracted:       {}", report.object_count);
                println!(
                    "Source Bundle:           {}",
                    if report.source_truncated {
                        format!(
                            "truncated ({} reclaimed)",
                            format_bytes(report.bundle_bytes_reclaimed)
                        )
                    } else {
                        format!(
                            "retained ({} on disk)",
                            format_bytes(report.source_retained_bytes)
                        )
                    }
                );
                println!("References Advanced:");
                for (name, oid) in &report.references_advanced {
                    println!("  {} -> {}", oid.to_hex(), name);
                }
            }
        }
        Err(err) => {
            reject(
                CliTag::ERROR,
                format!("consume bundle '{}': {err}", opts.archive_path.display()),
            );
        }
    }
}

/// Ingests archive entries directly into CAS ODB bypassing working tree files (Decision 3).
fn handle_unarchive_to_odb(ctx: &CliContext, opts: &UnarchiveOptions, is_zip: bool, is_tar: bool) {
    if opts.dry_run {
        reject(
            CliTag::ERROR,
            "--to-odb dry-run must be served by the preflight projection path",
        );
    }

    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => reject(
            CliTag::ERROR,
            format!("open repository for --to-odb: {err}"),
        ),
    };
    let git_dir = view.git_dir();
    let loose_odb = LooseOdb::new(git_dir);
    let mut index_tree = InMemoryIndexTree::new();

    let mut total_blobs = 0;
    let mut total_blob_bytes: u64 = 0;

    if is_zip {
        let mut truncator = match TailTruncator::open_read_write(&opts.archive_path) {
            Ok(truncator_instance) => truncator_instance,
            Err(err) => fail_io("open archive for in-place extraction", err),
        };
        let eocd = match read_zip_eocd(truncator.file_mut()) {
            Ok(parsed_eocd) => parsed_eocd,
            Err(err) => reject(CliTag::ERROR, format!("read zip headers: {err}")),
        };
        let mut members = match read_zip_central_directory(truncator.file_mut(), &eocd) {
            Ok(central_directory_members) => central_directory_members,
            Err(err) => reject(CliTag::ERROR, format!("read zip central directory: {err}")),
        };

        if opts.in_place {
            members.sort_by_key(|member| std::cmp::Reverse(member.local_header_offset));
            if eocd.central_directory_offset < truncator.current_len() {
                if let Err(err) = truncator.truncate_to(eocd.central_directory_offset) {
                    reject(
                        CliTag::ERROR,
                        format!("truncate zip central directory: {err}"),
                    );
                }
            }
        }

        let total_members = members.len();
        let mut accumulated_reclaim: u64 = 0;
        let batch_window = opts.batch_window_bytes.unwrap_or(16 * 1024 * 1024);

        for (idx, member) in members.iter().enumerate() {
            if member.is_dir {
                continue;
            }
            let payload = match extract_member_payload(truncator.file_mut(), member) {
                Ok(payload_bytes) => payload_bytes,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("decompress zip member '{}': {err}", member.name),
                ),
            };

            let blob_oid = match loose_odb.write_object("blob", &payload) {
                Ok(oid) => oid,
                Err(err) => reject(CliTag::ERROR, format!("write blob to ODB: {err}")),
            };

            let rel_path = match sanitize_relative_path(&member.name) {
                Ok(sanitized_path) => sanitized_path,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("sanitize path '{}': {err}", member.name),
                ),
            };

            let mode = if (member.external_attributes >> 16) & 0o111 != 0 {
                FileMode::ExecutableFile
            } else {
                FileMode::RegularFile
            };

            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            if let Err(err) = index_tree.stage_oid(&rel_path_str, mode, blob_oid) {
                reject(CliTag::ERROR, format!("stage path in index tree: {err}"));
            }

            total_blobs += 1;
            total_blob_bytes = total_blob_bytes.saturating_add(payload.len() as u64);

            if opts.in_place {
                let reclaimed_step = truncator
                    .current_len()
                    .saturating_sub(member.local_header_offset);
                accumulated_reclaim = accumulated_reclaim.saturating_add(reclaimed_step);

                let is_last = idx + 1 == total_members;
                if (accumulated_reclaim >= batch_window || is_last)
                    && member.local_header_offset < truncator.current_len()
                {
                    if let Err(err) = truncator.truncate_to(member.local_header_offset) {
                        reject(
                            CliTag::ERROR,
                            format!("truncate zip member tail '{}': {err}", member.name),
                        );
                    }
                    accumulated_reclaim = 0;
                }
            }
        }

        if opts.in_place && truncator.current_len() > 0 {
            if let Err(err) = truncator.truncate_to(0) {
                reject(
                    CliTag::ERROR,
                    format!("truncate consumed zip archive: {err}"),
                );
            }
        }
    } else if is_tar {
        let mut truncator = match TailTruncator::open_read_write(&opts.archive_path) {
            Ok(truncator_instance) => truncator_instance,
            Err(err) => fail_io("open archive for in-place extraction", err),
        };
        let mut members = match index_tar_archive(truncator.file_mut()) {
            Ok(tar_members) => tar_members,
            Err(err) => reject(CliTag::ERROR, format!("index tar archive: {err}")),
        };

        if opts.in_place {
            members.sort_by_key(|member| std::cmp::Reverse(member.header_offset));
        }

        let total_members = members.len();
        let mut accumulated_reclaim: u64 = 0;
        let batch_window = opts.batch_window_bytes.unwrap_or(16 * 1024 * 1024);

        for (idx, member) in members.iter().enumerate() {
            if member.is_dir {
                continue;
            }

            if let Err(err) = truncator
                .file_mut()
                .seek(SeekFrom::Start(member.header_offset + 512))
            {
                reject(CliTag::ERROR, format!("seek to tar payload: {err}"));
            }
            let mut payload = vec![0u8; member.size as usize];
            if let Err(err) = truncator.file_mut().read_exact(&mut payload) {
                reject(CliTag::ERROR, format!("read tar payload: {err}"));
            }

            let blob_oid = match loose_odb.write_object("blob", &payload) {
                Ok(oid) => oid,
                Err(err) => reject(CliTag::ERROR, format!("write blob to ODB: {err}")),
            };

            let rel_path = match sanitize_relative_path(&member.name) {
                Ok(sanitized_path) => sanitized_path,
                Err(err) => reject(
                    CliTag::ERROR,
                    format!("sanitize path '{}': {err}", member.name),
                ),
            };

            let mode = if (member.mode & 0o111) != 0 {
                FileMode::ExecutableFile
            } else {
                FileMode::RegularFile
            };

            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            if let Err(err) = index_tree.stage_oid(&rel_path_str, mode, blob_oid) {
                reject(CliTag::ERROR, format!("stage path in index tree: {err}"));
            }

            total_blobs += 1;
            total_blob_bytes = total_blob_bytes.saturating_add(payload.len() as u64);

            if opts.in_place {
                accumulated_reclaim = accumulated_reclaim.saturating_add(member.total_span);
                let is_last = idx + 1 == total_members;
                if (accumulated_reclaim >= batch_window || is_last)
                    && member.header_offset < truncator.current_len()
                {
                    if let Err(err) = truncator.truncate_to(member.header_offset) {
                        reject(
                            CliTag::ERROR,
                            format!("truncate tar member tail '{}': {err}", member.name),
                        );
                    }
                    accumulated_reclaim = 0;
                }
            }
        }

        if opts.in_place && truncator.current_len() > 0 {
            if let Err(err) = truncator.truncate_to(0) {
                reject(
                    CliTag::ERROR,
                    format!("truncate consumed tar archive: {err}"),
                );
            }
        }
    }

    // Build hierarchical trees directly in ODB
    let root_tree_oid = match index_tree.write_tree_with_persister(|tree| {
        let payload = serialize_tree_payload(tree);
        loose_odb.write_object("tree", &payload).map(|_| ())
    }) {
        Ok(oid) => oid,
        Err(e) => reject(CliTag::ERROR, format!("persist trees to ODB: {e}")),
    };

    if opts.tree_only {
        if ctx.json_mode {
            print_json(&json!({
                "status": "success",
                "mode": "tree_only",
                "tree_oid": root_tree_oid.to_hex(),
                "blobs_written": total_blobs,
                "total_blob_bytes": total_blob_bytes,
            }));
        } else {
            println!("{}", root_tree_oid.to_hex());
        }
        return;
    }

    // Assemble commit and advance ref under full governance
    let ref_store = DiskRefStore::new(git_dir);
    let target_ref_str = opts
        .branch
        .as_deref()
        .map(|branch_name| {
            if branch_name.starts_with("refs/") {
                branch_name.to_string()
            } else {
                format!("refs/heads/{branch_name}")
            }
        })
        .unwrap_or_else(|| format!("refs/heads/import-{}", current_unix_seconds()));

    let target_ref = match FractalRef::parse(&target_ref_str) {
        Some(fref) => fref,
        None => {
            if let Some(branch) = target_ref_str.strip_prefix("refs/heads/") {
                FractalRef::SystemTrunk {
                    branch: branch.to_string(),
                }
            } else {
                FractalRef::CellMain {
                    cell_id: "cell-default".into(),
                }
            }
        }
    };

    let human_author = find_arg_value(&ctx.args, &["--human"])
        .map(String::from)
        .or_else(|| std::env::var("TAXIS_HUMAN_AUTHOR").ok());
    let auth_token = find_arg_value(&ctx.args, &["--token"])
        .map(String::from)
        .or_else(|| std::env::var("TAXIS_AUTHORITY_TOKEN").ok());
    let agent_id = find_arg_value(&ctx.args, &["--agent"])
        .map(String::from)
        .or_else(|| std::env::var("TAXIS_AGENT_ID").ok())
        .unwrap_or_else(|| "agent-default".to_string());
    let cell_id = find_arg_value(&ctx.args, &["--cell"])
        .map(String::from)
        .or_else(|| std::env::var("TAXIS_CELL_ID").ok())
        .unwrap_or_else(|| "cell-default".to_string());

    let policy_name = find_arg_value(&ctx.args, &["--policy"]).unwrap_or("workspace-strict");
    let mut policy = match policy_name {
        "rust-strict" => TaxisPolicy::rust_strict(),
        _ => TaxisPolicy::workspace_strict(),
    };
    let authority_secret = human_author
        .as_deref()
        .and_then(|_| fg_gate::authority::resolve_authority_secret(git_dir).ok());
    if let Some(secret) = authority_secret.as_ref() {
        policy.authority_secret = Some(secret.clone());
    }

    let actor = super::commit::resolve_actor_identity(
        human_author.as_deref(),
        auth_token,
        &agent_id,
        &cell_id,
        authority_secret.as_ref(),
    );

    // 1. Enforce PreReceiveGuard authorization (P1-7)
    if let Err(auth_err) = PreReceiveGuard::assert_actor_authorized(&target_ref, &actor, &policy) {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!(
                "Push to '{}' rejected by PreReceiveGuard: {}",
                target_ref.to_git_ref(),
                auth_err
            ),
        );
    }

    let archive_name = opts
        .archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("archive");

    let initial_msg = opts.message.clone().unwrap_or_else(|| {
        format!(
            "feat(core): import archive '{archive_name}' into ODB\n\n\
             [Project]\nfractal-git\n\n\
             [Why]\nIngest structured archive asset into repository object database.\n\n\
             [Changed]\n- Materialized root tree from archive members\n- Ingested objects directly into ODB\n\n\
             [Verification]\nAsserted tree integrity and actor authorization."
        )
    });

    let touched_files = vec![archive_name.to_string()];

    // 2. Validate commit message prior to hooks (Option B: Dual-validation)
    if let Err(gov_err) =
        CommitMessageGuard::parse_and_verify(&initial_msg, &policy, Some(&touched_files))
    {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!(
                "Commit message rejected by Taxis policy '{}': {gov_err}",
                policy.name
            ),
        );
    }

    // 3. Verify project lease authorization
    super::commit::verify_project_lease_authorization(git_dir, &touched_files);

    // 4. Assert hook pipeline approved
    let source_ref = target_ref.to_git_ref();
    super::git_hooks::assert_pipeline_approved(
        &source_ref,
        &target_ref.to_git_ref(),
        &actor,
        &policy,
        &touched_files,
        &initial_msg,
    );

    // 5. Run commit hook chain
    let hook_runner = super::git_hooks::discover(git_dir, view.work_root());
    let final_msg = super::git_hooks::run_commit_chain(&hook_runner, git_dir, &initial_msg);

    // 6. Post-hook commit message validation (Option B: Dual-validation)
    if let Err(gov_err) =
        CommitMessageGuard::parse_and_verify(&final_msg, &policy, Some(&touched_files))
    {
        reject(
            CliTag::COMMIT_GOVERNANCE_FAIL,
            format!(
                "Commit message rejected after hook rewriting by Taxis policy '{}': {gov_err}",
                policy.name
            ),
        );
    }

    let parent_oid = ref_store.get_ref(&target_ref.to_git_ref()).ok().flatten();
    let parent_oids = parent_oid.map(|p| vec![p]).unwrap_or_default();
    let now_secs = current_unix_seconds();
    let sig = match human_author {
        Some(name) => GitSignature::new(&name, format!("{name}@taxis.internal"), now_secs),
        None => GitSignature::for_agent(&agent_id, &cell_id, now_secs),
    };

    let commit = GitCommit::new(
        root_tree_oid,
        parent_oids,
        sig.clone(),
        sig,
        final_msg,
        None,
    );
    let commit_payload = serialize_commit_payload(&commit);
    let commit_oid = match loose_odb.write_object("commit", &commit_payload) {
        Ok(oid) => oid,
        Err(e) => reject(CliTag::ERROR, format!("write commit to ODB: {e}")),
    };

    // 7. Execute reference-transaction (preparing -> prepared -> write -> committed / aborted)
    let branch_update = super::git_hooks::ReferenceUpdate {
        previous: parent_oid,
        next: commit_oid.to_hex(),
        name: target_ref.to_git_ref(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[branch_update], || {
            ref_store
                .update_ref(&target_ref.to_git_ref(), &commit_oid, parent_oid.as_ref())
                .map_err(|e| format!("advance ref '{}': {e}", target_ref.to_git_ref()))
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    let target_ref = target_ref.to_git_ref();

    if ctx.json_mode {
        print_json(&json!({
            "status": "success",
            "mode": "to_odb",
            "commit_oid": commit_oid.to_hex(),
            "tree_oid": root_tree_oid.to_hex(),
            "ref": target_ref,
            "blobs_written": total_blobs,
            "total_blob_bytes": total_blob_bytes,
        }));
    } else {
        println!("=== Taxis In-Place Direct ODB Ingestion ===");
        println!("Target Branch Ref:   {}", target_ref);
        println!("Root Tree OID:       {}", root_tree_oid.to_hex());
        println!("Created Commit OID:  {}", commit_oid.to_hex());
        println!(
            "Blobs Persisted:     {} ({})",
            total_blobs,
            format_bytes(total_blob_bytes)
        );
        println!("Working Tree:        Bypassed (Zero disk files allocated)");
    }
}
