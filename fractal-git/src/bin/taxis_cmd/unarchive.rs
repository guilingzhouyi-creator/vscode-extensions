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
use std::path::{Path, PathBuf};

use fg_algorithms::space_plan::{check_headroom, SpacePlanConfig};
use fg_core::models::{current_unix_seconds, FileMode, GitSignature, Oid, TaxisPolicy};
use fg_core::traits::{OdbStore, RefStore};
use fg_gate::commit_guard::CommitMessageGuard;
use fg_gate::pre_receive::PreReceiveGuard;
use fg_index::InMemoryIndexTree;
use fg_object::GitCommit;
use fg_storage::commit_materializer::{persist_commit_object, persist_index_tree};
use fg_storage::in_place::{
    extract_member_payload, extract_tar_in_place_with_journal, extract_tar_standard,
    extract_targz_forward_hole_punch, extract_zip_in_place_with_journal, extract_zip_standard,
    index_tar_archive, read_zip_central_directory, read_zip_eocd, sanitize_relative_path,
    BundleConsumeOptions, InPlaceBundleConsumer, InPlaceExtractionReport, InPlaceJournal,
    InPlaceLogEntry, TailTruncator,
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
    let (file_len, profile) = resolve_archive_profile(&opts);

    let mut config =
        SpacePlanConfig::adaptive_for_archive_size(file_len, Some(opts.safety_headroom_bytes));
    if let Some(batch_win) = opts.batch_window_bytes {
        config.batch_window_bytes = batch_win;
    }

    let probe_dir = if opts.to_odb || profile.is_bundle {
        RepoView::open(ctx)
            .map(|v| v.git_dir().to_path_buf())
            .unwrap_or_else(|_| PathBuf::from(".git"))
    } else {
        opts.dest_dir.clone()
    };

    let free_space = query_available_free_space(&probe_dir).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!(
                "cannot determine free disk space for probe path '{}' (fail-closed): {err}",
                probe_dir.display()
            ),
        )
    });

    if opts.to_odb && !profile.is_zip && !profile.is_tar {
        reject(
            CliTag::ERROR,
            "--to-odb is currently supported for .zip and .tar archives",
        );
    }

    // 1. Preflight SpacePlan simulation shared by the dry-run, to-odb, and execution paths.
    let plan_report = build_preflight_plan(&opts, profile, file_len, free_space, &config)
        .unwrap_or_else(|err| reject(CliTag::ERROR, format!("preflight planning failed: {err}")));

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

    if profile.is_bundle {
        handle_bundle_ingestion(ctx, &opts);
        return;
    }

    if opts.to_odb {
        handle_unarchive_to_odb(ctx, &opts, profile);
        return;
    }

    execute_worktree_extraction(
        ctx,
        &opts,
        (&profile, &config, plan_report.steps.len(), file_len),
    );
}

fn resolve_archive_profile(opts: &UnarchiveOptions) -> (u64, ArchiveProfile) {
    if !opts.archive_path.exists() {
        fail_fatal(format!(
            "archive file '{}' does not exist",
            opts.archive_path.display()
        ));
    }

    let file_len = opts
        .archive_path
        .metadata()
        .unwrap_or_else(|e| fail_io("stat archive file", e))
        .len();

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

    (
        file_len,
        ArchiveProfile {
            is_zip,
            is_tar,
            is_bundle,
        },
    )
}

fn open_extraction_journal(
    ctx: &CliContext,
    opts: &UnarchiveOptions,
    session_meta: (usize, u64),
) -> (
    Option<fg_storage::in_place::InPlaceResumeState>,
    Option<InPlaceJournal>,
) {
    if !opts.in_place {
        return (None, None);
    }
    let (total_members, file_len) = session_meta;
    let journal_path = opts.dest_dir.join(".taxis_unarchive.wal");
    let resume_state = if journal_path.exists() {
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

    let mut journal = InPlaceJournal::open(&journal_path)
        .unwrap_or_else(|e| fail_io("open extraction WAL journal", e));
    if resume_state.is_none() {
        let _ = journal.append(&InPlaceLogEntry::SessionInit {
            archive_path: opts.archive_path.display().to_string(),
            target_path: opts.dest_dir.display().to_string(),
            total_members,
            initial_archive_len: file_len,
        });
    }
    (resume_state, Some(journal))
}

fn execute_worktree_extraction(
    ctx: &CliContext,
    opts: &UnarchiveOptions,
    plan: (&ArchiveProfile, &SpacePlanConfig, usize, u64),
) {
    let (profile, config, total_members, file_len) = plan;
    if let Err(err) = std::fs::create_dir_all(&opts.dest_dir) {
        fail_io("create destination directory", err);
    }

    let (resume_state, mut journal) = open_extraction_journal(ctx, opts, (total_members, file_len));
    let already_extracted = resume_state.as_ref().map(|s| &s.extracted_members);

    let mut hole_punched_bytes: Option<u64> = None;
    let result = if profile.is_zip {
        if opts.in_place {
            extract_zip_in_place_with_journal(
                &opts.archive_path,
                &opts.dest_dir,
                config,
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
                config,
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
            report_extraction_result(ctx, opts, (&report, hole_punched_bytes));
        }
        Err(err) => reject(
            CliTag::ERROR,
            format!("extraction aborted with error: {err}"),
        ),
    }
}

fn report_extraction_result(
    ctx: &CliContext,
    opts: &UnarchiveOptions,
    outcome: (&InPlaceExtractionReport, Option<u64>),
) {
    let (report, hole_punched_bytes) = outcome;
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
        return;
    }

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
            "Reclaimed {} of disk space via forward hole punching; archive retained at {} (sparse).",
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

/// Ingests a Git Bundle v2 operand into the repository ODB, honoring the in-place switch.
fn handle_bundle_ingestion(ctx: &CliContext, opts: &UnarchiveOptions) {
    let view = RepoView::open(ctx).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("open repository for bundle ingestion: {err}"),
        )
    });
    let consume_options = BundleConsumeOptions {
        truncate_source: opts.in_place,
    };
    let report =
        InPlaceBundleConsumer::consume_bundle(&opts.archive_path, view.git_dir(), &consume_options)
            .unwrap_or_else(|err| {
                reject(
                    CliTag::ERROR,
                    format!("consume bundle '{}': {err}", opts.archive_path.display()),
                )
            });

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
        return;
    }

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

struct OdbIngestState {
    loose_odb: LooseOdb,
    index_tree: InMemoryIndexTree,
    total_blobs: usize,
    total_blob_bytes: u64,
    accumulated_reclaim: u64,
    batch_window: u64,
    in_place: bool,
}

impl OdbIngestState {
    fn new(git_dir: &Path, opts: &UnarchiveOptions) -> Self {
        Self {
            loose_odb: LooseOdb::new(git_dir),
            index_tree: InMemoryIndexTree::new(),
            total_blobs: 0,
            total_blob_bytes: 0,
            accumulated_reclaim: 0,
            batch_window: opts.batch_window_bytes.unwrap_or(16 * 1024 * 1024),
            in_place: opts.in_place,
        }
    }

    fn stage_member_to_odb(&mut self, name: &str, executable: bool, payload: &[u8]) {
        let blob_oid = self
            .loose_odb
            .write_object("blob", payload)
            .unwrap_or_else(|err| reject(CliTag::ERROR, format!("write blob to ODB: {err}")));

        let rel_path = sanitize_relative_path(name)
            .unwrap_or_else(|err| reject(CliTag::ERROR, format!("sanitize path '{name}': {err}")));

        let mode = if executable {
            FileMode::ExecutableFile
        } else {
            FileMode::RegularFile
        };

        let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
        if let Err(err) = self.index_tree.stage_oid(&rel_path_str, mode, blob_oid) {
            reject(CliTag::ERROR, format!("stage path in index tree: {err}"));
        }

        self.total_blobs += 1;
        self.total_blob_bytes = self.total_blob_bytes.saturating_add(payload.len() as u64);
    }

    fn maybe_truncate_batch(
        &mut self,
        truncator: &mut TailTruncator,
        step_info: (u64, u64, bool, &str),
    ) {
        if !self.in_place {
            return;
        }
        let (target_offset, step_reclaim, is_last, label) = step_info;
        self.accumulated_reclaim = self.accumulated_reclaim.saturating_add(step_reclaim);
        if (self.accumulated_reclaim >= self.batch_window || is_last)
            && target_offset < truncator.current_len()
        {
            if let Err(err) = truncator.truncate_to(target_offset) {
                reject(
                    CliTag::ERROR,
                    format!("truncate archive member tail '{label}': {err}"),
                );
            }
            self.accumulated_reclaim = 0;
        }
    }

    fn ingest_zip(&mut self, archive_path: &Path) {
        let mut truncator = TailTruncator::open_read_write(archive_path)
            .unwrap_or_else(|err| fail_io("open archive for in-place extraction", err));
        let eocd = read_zip_eocd(truncator.file_mut())
            .unwrap_or_else(|err| reject(CliTag::ERROR, format!("read zip headers: {err}")));
        let mut members =
            read_zip_central_directory(truncator.file_mut(), &eocd).unwrap_or_else(|err| {
                reject(CliTag::ERROR, format!("read zip central directory: {err}"))
            });

        if self.in_place {
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
        for (idx, member) in members.iter().enumerate() {
            if member.is_dir {
                continue;
            }
            let payload =
                extract_member_payload(truncator.file_mut(), member).unwrap_or_else(|err| {
                    reject(
                        CliTag::ERROR,
                        format!("decompress zip member '{}': {err}", member.name),
                    )
                });
            let executable = (member.external_attributes >> 16) & 0o111 != 0;
            self.stage_member_to_odb(&member.name, executable, &payload);

            let reclaimed_step = truncator
                .current_len()
                .saturating_sub(member.local_header_offset);
            self.maybe_truncate_batch(
                &mut truncator,
                (
                    member.local_header_offset,
                    reclaimed_step,
                    idx + 1 == total_members,
                    &member.name,
                ),
            );
        }

        if self.in_place && truncator.current_len() > 0 {
            if let Err(err) = truncator.truncate_to(0) {
                reject(
                    CliTag::ERROR,
                    format!("truncate consumed zip archive: {err}"),
                );
            }
        }
    }

    fn ingest_tar(&mut self, archive_path: &Path) {
        let mut truncator = TailTruncator::open_read_write(archive_path)
            .unwrap_or_else(|err| fail_io("open archive for in-place extraction", err));
        let mut members = index_tar_archive(truncator.file_mut())
            .unwrap_or_else(|err| reject(CliTag::ERROR, format!("index tar archive: {err}")));

        if self.in_place {
            members.sort_by_key(|member| std::cmp::Reverse(member.header_offset));
        }

        let total_members = members.len();
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

            let executable = (member.mode & 0o111) != 0;
            self.stage_member_to_odb(&member.name, executable, &payload);
            self.maybe_truncate_batch(
                &mut truncator,
                (
                    member.header_offset,
                    member.total_span,
                    idx + 1 == total_members,
                    &member.name,
                ),
            );
        }

        if self.in_place && truncator.current_len() > 0 {
            if let Err(err) = truncator.truncate_to(0) {
                reject(
                    CliTag::ERROR,
                    format!("truncate consumed tar archive: {err}"),
                );
            }
        }
    }
}

/// Ingests archive entries directly into CAS ODB bypassing working tree files (Decision 3).
fn handle_unarchive_to_odb(ctx: &CliContext, opts: &UnarchiveOptions, profile: ArchiveProfile) {
    if opts.dry_run {
        reject(
            CliTag::ERROR,
            "--to-odb dry-run must be served by the preflight projection path",
        );
    }

    let view = RepoView::open(ctx).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("open repository for --to-odb: {err}"),
        )
    });
    let mut state = OdbIngestState::new(view.git_dir(), opts);
    if profile.is_zip {
        state.ingest_zip(&opts.archive_path);
    } else if profile.is_tar {
        state.ingest_tar(&opts.archive_path);
    }

    let root_tree_oid = persist_index_tree(&state.index_tree, &state.loose_odb)
        .unwrap_or_else(|e| reject(CliTag::ERROR, format!("persist trees to ODB: {e}")));

    if opts.tree_only {
        if ctx.json_mode {
            print_json(&json!({
                "status": "success",
                "mode": "tree_only",
                "tree_oid": root_tree_oid.to_hex(),
                "blobs_written": state.total_blobs,
                "total_blob_bytes": state.total_blob_bytes,
            }));
        } else {
            println!("{}", root_tree_oid.to_hex());
        }
        return;
    }

    commit_ingested_odb_tree(
        ctx,
        opts,
        (
            &view,
            &state.loose_odb,
            root_tree_oid,
            state.total_blobs,
            state.total_blob_bytes,
        ),
    );
}

fn resolve_odb_actor_and_policy(
    ctx: &CliContext,
    git_dir: &Path,
) -> (
    Option<String>,
    String,
    String,
    TaxisPolicy,
    fg_core::models::ActorIdentity,
) {
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
    (human_author, agent_id, cell_id, policy, actor)
}

fn commit_ingested_odb_tree(
    ctx: &CliContext,
    opts: &UnarchiveOptions,
    ingest: (&RepoView, &LooseOdb, Oid, usize, u64),
) {
    let (view, loose_odb, root_tree_oid, total_blobs, total_blob_bytes) = ingest;
    let git_dir = view.git_dir();
    let ref_store = DiskRefStore::new(git_dir);
    let target_ref = resolve_odb_target_ref(opts);
    let (human_author, agent_id, cell_id, policy, actor) =
        resolve_odb_actor_and_policy(ctx, git_dir);

    if let Err(auth_err) = PreReceiveGuard::assert_actor_authorized(&target_ref, &actor, &policy) {
        reject(
            CliTag::AUTHORITY_BREACH,
            format!(
                "Push to '{}' rejected by PreReceiveGuard: {auth_err}",
                target_ref.to_git_ref()
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
             [Added]\n- Materialized root tree from archive members\n- Ingested objects directly into ODB\n\n\
             [Verification]\nAsserted tree integrity and actor authorization."
        )
    });
    let touched_files = vec![archive_name.to_string()];

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

    super::commit::verify_project_lease_authorization(git_dir, &touched_files);
    let target_ref_name = target_ref.to_git_ref();
    super::git_hooks::assert_pipeline_approved(
        &target_ref_name,
        &target_ref_name,
        &actor,
        &policy,
        &touched_files,
        &initial_msg,
    );

    let hook_runner = super::git_hooks::discover(git_dir, view.work_root());
    let final_msg = super::git_hooks::run_commit_chain(&hook_runner, git_dir, &initial_msg);
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

    let parent_oid = ref_store.get_ref(&target_ref_name).ok().flatten();
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
    let commit_oid = persist_commit_object(&commit, loose_odb)
        .unwrap_or_else(|e| reject(CliTag::ERROR, format!("write commit to ODB: {e}")));

    let branch_update = super::git_hooks::ReferenceUpdate {
        previous: parent_oid,
        next: commit_oid.to_hex(),
        name: target_ref_name.clone(),
    };
    if let Err(err_msg) =
        super::git_hooks::execute_reference_transaction(&hook_runner, &[branch_update], || {
            ref_store
                .update_ref(&target_ref_name, &commit_oid, parent_oid.as_ref())
                .map_err(|e| format!("advance ref '{target_ref_name}': {e}"))
        })
    {
        reject(CliTag::ERROR, err_msg);
    }

    report_odb_ingestion(
        ctx,
        (
            &target_ref_name,
            root_tree_oid,
            commit_oid,
            total_blobs,
            total_blob_bytes,
        ),
    );
}

fn report_odb_ingestion(ctx: &CliContext, summary: (&str, Oid, Oid, usize, u64)) {
    let (target_ref_name, root_tree_oid, commit_oid, total_blobs, total_blob_bytes) = summary;
    if ctx.json_mode {
        print_json(&json!({
            "status": "success",
            "mode": "to_odb",
            "commit_oid": commit_oid.to_hex(),
            "tree_oid": root_tree_oid.to_hex(),
            "ref": target_ref_name,
            "blobs_written": total_blobs,
            "total_blob_bytes": total_blob_bytes,
        }));
        return;
    }

    println!("=== Taxis In-Place Direct ODB Ingestion ===");
    println!("Target Branch Ref:   {target_ref_name}");
    println!("Root Tree OID:       {}", root_tree_oid.to_hex());
    println!("Created Commit OID:  {}", commit_oid.to_hex());
    println!(
        "Blobs Persisted:     {} ({})",
        total_blobs,
        format_bytes(total_blob_bytes)
    );
    println!("Working Tree:        Bypassed (Zero disk files allocated)");
}

fn resolve_odb_target_ref(opts: &UnarchiveOptions) -> FractalRef {
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

    FractalRef::parse(&target_ref_str).unwrap_or_else(|| {
        if let Some(branch) = target_ref_str.strip_prefix("refs/heads/") {
            FractalRef::SystemTrunk {
                branch: branch.to_string(),
            }
        } else {
            FractalRef::CellMain {
                cell_id: "cell-default".into(),
            }
        }
    })
}
