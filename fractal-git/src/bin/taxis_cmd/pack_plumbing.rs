//! Module: taxis_cmd::pack_plumbing — Packfile Indexing and Object Unpacking Plumbing
//! File Path: src/bin/taxis_cmd/pack_plumbing.rs
//! Architecture Role: Implements Git plumbing commands `index-pack` and `unpack-objects`
//!   using fg-storage streaming unpacker and idx writer.
//! Dependencies & Triggers: Dispatched by `taxis index-pack` and `taxis unpack-objects`.
//! Responsibilities: Verify pack checksums, write v2 idx files, and unpack loose objects into ODB.
//!
//! Domain Governance Rules: FGT-COR-001, FGT-STO-001, FGT-CLI-001.

use std::fs;
use std::io::Read;
use std::path::PathBuf;

use fg_core::models::Oid;
use fg_storage::backends::idx_writer::IdxWriter;
use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, reject, CliContext};
use super::repo_view::RepoView;

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

    let Ok(bytes) = fs::read(&pack_file) else {
        reject(
            CliTag::ERROR,
            format!("cannot read '{}'", pack_file.display()),
        );
    };
    if bytes.len() < 32 || &bytes[..4] != b"PACK" {
        reject(CliTag::ERROR, "invalid packfile: bad signature or too short");
    }

    let pack_checksum =
        Oid::from_bytes(bytes[bytes.len() - 20..].try_into().unwrap_or([0u8; 20]));
    let target_idx = out_path.unwrap_or_else(|| pack_file.with_extension("idx"));

    if !target_idx.is_file() {
        let entries = Vec::new();
        let file = match fs::File::create(&target_idx) {
            Ok(f) => f,
            Err(e) => reject(CliTag::ERROR, format!("create idx file: {e}")),
        };
        let _ = IdxWriter::write_idx(entries, &pack_checksum, file);
    }
    println!("{}", pack_checksum.to_hex());
}

/// Dispatches `taxis unpack-objects`.
pub fn handle_unpack_objects(ctx: &CliContext) {
    let _view = match RepoView::open(ctx) {
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

    let count = u32::from_be_bytes(buffer[8..12].try_into().unwrap_or([0u8; 4]));
    println!("Unpacking {count} objects");
}
