//! Module: taxis_cmd::hash_object — hash-object Object Hashing and Ingestion
//! File Path: src/bin/taxis_cmd/hash_object.rs
//! Architecture Role: Implements the Git plumbing command `hash-object`, computing canonical
//!   SHA-1 object identifiers and optionally persisting loose objects into the object database.
//! Dependencies & Triggers: Dispatched from `src/bin/taxis.rs`.
//! Responsibilities: File and standard input reading, canonical loose object SHA-1 hashing,
//!   and loose ODB persistence under `-w`.
//! Exit Semantics & Design Rationale:
//!   - Computes canonical Git loose object format `"{type} {length}\0{content}"`.
//!   - Exits 128 on missing files or I/O failure, matching Git semantics.
//!   - Does not require a repository unless `-w` is passed.
//!
//! Domain Governance Rules: FGT-OBJ-001 (object codec), FGT-COR-001, FGT-CLI-001.

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use fg_core::models::{compute_object_oid, ObjectKind};
use fractal_git::{LooseOdb, OdbStore};

use super::common::{fail_fatal, fail_usage, CliContext};
use super::repo_view::RepoView;

/// Dispatches `hash-object`.
///
/// Supported arguments:
/// - `-t <type>`: Specify object type (blob, commit, tree, tag). Default: blob.
/// - `-w`: Actually write the object into the object database.
/// - `--stdin`: Read the object from standard input.
/// - `--no-filters`, `--literally`: Accepted for CLI compatibility with Git.
/// - `<file>...`: Paths to files to hash.
pub fn handle_hash_object(ctx: &CliContext) {
    let mut object_kind = ObjectKind::Blob;
    let mut kind_name = "blob";
    let mut write_to_odb = false;
    let mut read_stdin = false;
    let mut files = Vec::new();

    let mut cursor = 0;
    while cursor < ctx.args.len() {
        let arg = &ctx.args[cursor];
        match arg.as_str() {
            "-w" => {
                write_to_odb = true;
            }
            "--stdin" => {
                read_stdin = true;
            }
            "--no-filters" | "--literally" => {
                // Accepted for compatibility
            }
            "-t" => {
                cursor += 1;
                if cursor >= ctx.args.len() {
                    fail_usage("hash-object: missing argument for -t");
                }
                let type_arg = &ctx.args[cursor];
                match type_arg.as_str() {
                    "blob" => {
                        object_kind = ObjectKind::Blob;
                        kind_name = "blob";
                    }
                    "commit" => {
                        object_kind = ObjectKind::Commit;
                        kind_name = "commit";
                    }
                    "tree" => {
                        object_kind = ObjectKind::Tree;
                        kind_name = "tree";
                    }
                    "tag" => {
                        object_kind = ObjectKind::Tag;
                        kind_name = "tag";
                    }
                    other => {
                        fail_usage(format!("hash-object: unknown object type '{other}'"));
                    }
                }
            }
            other if other.starts_with('-') => {
                fail_usage(format!("hash-object: unknown option '{other}'"));
            }
            other => {
                files.push(other.to_string());
            }
        }
        cursor += 1;
    }

    let loose_odb = if write_to_odb {
        let view = match RepoView::open(ctx) {
            Ok(opened) => opened,
            Err(open_err) => fail_fatal(open_err),
        };
        Some(LooseOdb::new(view.git_dir().join("objects")))
    } else {
        None
    };

    if read_stdin {
        let mut buffer = Vec::new();
        if let Err(err) = io::stdin().read_to_end(&mut buffer) {
            fail_fatal(format!("could not read from stdin: {err}"));
        }
        hash_and_output(&buffer, object_kind, kind_name, loose_odb.as_ref());
    }

    for file_path in &files {
        let path = Path::new(file_path);
        let buffer = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(err) => {
                fail_fatal(format!("could not open '{file_path}' for reading: {err}"));
            }
        };
        hash_and_output(&buffer, object_kind, kind_name, loose_odb.as_ref());
    }
}

/// Hashes payload bytes and optionally writes them to the loose object database.
fn hash_and_output(
    payload: &[u8],
    kind: ObjectKind,
    kind_name: &str,
    loose_odb: Option<&LooseOdb>,
) {
    let oid = if let Some(odb) = loose_odb {
        match odb.write_object(kind_name, payload) {
            Ok(written_oid) => written_oid,
            Err(write_err) => {
                fail_fatal(format!("failed to write object to database: {write_err}"));
            }
        }
    } else {
        compute_object_oid(kind, payload)
    };

    println!("{}", oid.to_hex());
}
