//! Module: taxis_cmd::pack_plumbing — Packfile Indexing and Object Unpacking Plumbing
//! File Path: src/bin/taxis_cmd/pack_plumbing.rs
//! Architecture Role: Implements Git plumbing commands `index-pack` and `unpack-objects`
//!   using fg-storage streaming unpacker and idx writer.
//! Dependencies & Triggers: Dispatched by `taxis index-pack` and `taxis unpack-objects`.
//! Responsibilities: Verify pack checksums, write v2 idx files, and unpack loose objects into ODB.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-STO-001, FGT-GAT-001.

use std::fs;
use std::io::Read;
use std::path::PathBuf;

use fg_core::error::FractalResult;
use fg_core::models::{ObjectKind, Oid};
use fg_core::traits::OdbStore;
use fg_storage::backends::idx_writer::IdxWriter;
use fg_storage::backends::pack_file::{DeltaBaseSource, PackFile};
use fg_storage::{LooseOdb, OdbRouter};
use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, print_json, reject, CliContext};
use super::repo_view::RepoView;

/// Fallback resolver when operating on packs without a local repository context.
struct EmptyDeltaSource;

impl DeltaBaseSource for EmptyDeltaSource {
    fn read_base(&self, oid: &Oid) -> FractalResult<(ObjectKind, Vec<u8>)> {
        Err(fg_core::error::FractalError::ObjectCodec(format!(
            "external base {} not available in standalone mode",
            oid.to_hex()
        )))
    }
}

/// Dispatches `taxis index-pack`.
pub fn handle_index_pack(ctx: &CliContext) {
    let mut pack_path: Option<PathBuf> = None;
    let mut out_path: Option<PathBuf> = None;
    let mut cursor = 0;
    while cursor < ctx.args.len() {
        match ctx.args[cursor].as_str() {
            "-o" if cursor + 1 < ctx.args.len() => {
                out_path = Some(PathBuf::from(&ctx.args[cursor + 1]));
                cursor += 1;
            }
            "-v" => {}
            other if !other.starts_with('-') && pack_path.is_none() => {
                pack_path = Some(PathBuf::from(other));
            }
            _ => {}
        }
        cursor += 1;
    }

    let Some(pack_file) = pack_path else {
        reject(CliTag::ERROR, "index-pack requires a pack file path");
    };
    if !pack_file.is_file() {
        reject(
            CliTag::ERROR,
            format!("pack file '{}' does not exist", pack_file.display()),
        );
    }

    let pack = match PackFile::load(&pack_file) {
        Ok(p) => p,
        Err(e) => reject(CliTag::ERROR, format!("load packfile: {e}")),
    };

    let router = RepoView::open(ctx)
        .ok()
        .and_then(|v| OdbRouter::open(v.git_dir().join("objects")).ok());
    let (pack_checksum, entries) = if let Some(ref r) = router {
        match pack.index_objects(r) {
            Ok(res) => res,
            Err(e) => reject(CliTag::ERROR, format!("index pack objects: {e}")),
        }
    } else {
        match pack.index_objects(&EmptyDeltaSource) {
            Ok(res) => res,
            Err(e) => reject(CliTag::ERROR, format!("index pack objects: {e}")),
        }
    };

    let target_idx = out_path.unwrap_or_else(|| pack_file.with_extension("idx"));
    let file = match fs::File::create(&target_idx) {
        Ok(f) => f,
        Err(e) => reject(CliTag::ERROR, format!("create idx file: {e}")),
    };
    if let Err(e) = IdxWriter::write_idx(entries, &pack_checksum, file) {
        reject(CliTag::ERROR, format!("write idx file: {e}"));
    }
    println!("{}", pack_checksum.to_hex());
}

/// Dispatches `taxis unpack-objects`.
pub fn handle_unpack_objects(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(v) => v,
        Err(err) => fail_fatal(err),
    };

    let mut buffer = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut buffer);
    if buffer.is_empty() {
        return;
    }
    if buffer.len() < 32 || &buffer[..4] != b"PACK" {
        reject(CliTag::ERROR, "unpack-objects: invalid pack signature");
    }

    let pack = match PackFile::parse(PathBuf::from("stdin.pack"), buffer) {
        Ok(p) => p,
        Err(e) => reject(CliTag::ERROR, format!("unpack-objects: {e}")),
    };

    let router = match OdbRouter::open(view.git_dir().join("objects")) {
        Ok(r) => r,
        Err(e) => reject(CliTag::ERROR, format!("open object store: {e}")),
    };

    let (_pack_oid, entries) = match pack.index_objects(&router) {
        Ok(res) => res,
        Err(e) => reject(CliTag::ERROR, format!("decode pack objects: {e}")),
    };

    let loose_odb = LooseOdb::new(view.git_dir());
    let mut unpacked_count = 0usize;
    for entry in &entries {
        match pack.read_at(entry.offset, &router) {
            Ok(packed) => {
                if let Err(e) = loose_odb.write_object(packed.kind.as_str(), &packed.payload) {
                    reject(
                        CliTag::ERROR,
                        format!("write unpacked object {}: {e}", entry.oid.to_hex()),
                    );
                }
                unpacked_count += 1;
            }
            Err(e) => {
                reject(
                    CliTag::ERROR,
                    format!("read packed object at {}: {e}", entry.offset),
                );
            }
        }
    }

    if ctx.json_mode {
        print_json(&serde_json::json!({
            "operation": "unpack-objects",
            "unpacked_count": unpacked_count
        }));
    } else {
        println!("Unpacked {unpacked_count} object(s)");
    }
}

/// Dispatches `taxis multi-pack-index`.
pub fn handle_multi_pack_index(ctx: &CliContext) {
    let view = RepoView::open_or_exit(ctx);
    let pack_dir = view.git_dir().join("objects/pack");
    let action = ctx.args.first().map(String::as_str).unwrap_or("write");
    match action {
        "write" => {
            match fg_storage::MultiPackIndex::write_midx(&pack_dir) {
                Ok(path) => {
                    if let Ok(midx) = fg_storage::MultiPackIndex::load(&path) {
                        if ctx.json_mode {
                            print_json(&serde_json::json!({
                                "status": "ok",
                                "objects": midx.object_count(),
                                "packs": midx.pack_names().len(),
                                "path": path.display().to_string(),
                            }));
                        } else {
                            println!(
                                "Wrote multi-pack-index with {} objects across {} pack(s)",
                                midx.object_count(),
                                midx.pack_names().len()
                            );
                        }
                    } else {
                        println!("Wrote multi-pack-index at {}", path.display());
                    }
                }
                Err(err) => reject(CliTag::ERROR, format!("write multi-pack-index failed: {err}")),
            }
        }
        "verify" => {
            let midx_path = pack_dir.join("multi-pack-index");
            if !midx_path.is_file() {
                reject(CliTag::ERROR, "no multi-pack-index found to verify");
            }
            match fg_storage::MultiPackIndex::load(&midx_path) {
                Ok(midx) => {
                    if ctx.json_mode {
                        print_json(&serde_json::json!({
                            "status": "ok",
                            "objects": midx.object_count(),
                            "packs": midx.pack_names().len(),
                        }));
                    } else {
                        println!(
                            "Verifying multi-pack-index: {} object(s) across {} pack(s) verified OK",
                            midx.object_count(),
                            midx.pack_names().len()
                        );
                    }
                }
                Err(err) => reject(CliTag::ERROR, format!("verify multi-pack-index failed: {err}")),
            }
        }
        _ => reject(
            CliTag::ERROR,
            format!("unknown multi-pack-index action '{action}'; supported: write, verify"),
        ),
    }
}
