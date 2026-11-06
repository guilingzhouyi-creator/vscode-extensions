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
//! Domain Governance Rules: FGT-OBJ-001 (object codec), FGT-COR-001, FGT-GAT-001.

use std::fs;
use std::io::{self, Read};
use std::path::Path;

use fg_core::models::{compute_object_oid, ObjectKind};
use fractal_git::{LooseOdb, OdbStore};

use super::common::{fail_fatal, fail_usage, CliContext};
use super::repo_view::RepoView;

/// Parsed options for `taxis hash-object`.
struct HashObjectOptions {
    object_kind: ObjectKind,
    kind_name: &'static str,
    write_to_odb: bool,
    read_stdin: bool,
    files: Vec<String>,
}

/// Dispatches `hash-object`.
///
/// Supported arguments:
/// - `-t <type>`: Specify object type (blob, commit, tree, tag). Default: blob.
/// - `-w`: Actually write the object into the object database.
/// - `--stdin`: Read the object from standard input.
/// - `--no-filters`, `--literally`: Accepted for CLI compatibility with Git.
/// - `<file>...`: Paths to files to hash.
pub fn handle_hash_object(ctx: &CliContext) {
    let opts = parse_hash_object_args(&ctx.args);

    let loose_odb = if opts.write_to_odb {
        let view = match RepoView::open(ctx) {
            Ok(opened) => opened,
            Err(open_err) => fail_fatal(open_err),
        };
        Some(LooseOdb::new(view.git_dir()))
    } else {
        None
    };

    if opts.read_stdin {
        let mut buffer = Vec::new();
        if let Err(err) = io::stdin().read_to_end(&mut buffer) {
            fail_fatal(format!("could not read from stdin: {err}"));
        }
        hash_and_output(
            &buffer,
            (opts.object_kind, opts.kind_name),
            loose_odb.as_ref(),
        );
    }

    for file_path in &opts.files {
        let path = Path::new(file_path);
        let buffer = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(err) => {
                fail_fatal(format!("could not open '{file_path}' for reading: {err}"));
            }
        };
        hash_and_output(
            &buffer,
            (opts.object_kind, opts.kind_name),
            loose_odb.as_ref(),
        );
    }
}

/// Parses command-line options for `taxis hash-object`.
fn parse_hash_object_args(args: &[String]) -> HashObjectOptions {
    let mut opts = HashObjectOptions {
        object_kind: ObjectKind::Blob,
        kind_name: "blob",
        write_to_odb: false,
        read_stdin: false,
        files: Vec::new(),
    };

    let mut cursor = 0;
    while cursor < args.len() {
        match args[cursor].as_str() {
            "-w" => opts.write_to_odb = true,
            "--stdin" => opts.read_stdin = true,
            "--no-filters" | "--literally" => {}
            "-t" => {
                cursor += 1;
                let Some(type_arg) = args.get(cursor) else {
                    fail_usage("hash-object: missing argument for -t");
                };
                let (kind, name) = resolve_hash_object_kind(type_arg);
                opts.object_kind = kind;
                opts.kind_name = name;
            }
            other if other.starts_with('-') => {
                fail_usage(format!("hash-object: unknown option '{other}'"));
            }
            other => opts.files.push(other.to_string()),
        }
        cursor += 1;
    }
    opts
}

/// Maps a `-t <type>` argument to [`ObjectKind`] and its canonical header string.
fn resolve_hash_object_kind(type_arg: &str) -> (ObjectKind, &'static str) {
    match type_arg {
        "blob" => (ObjectKind::Blob, "blob"),
        "commit" => (ObjectKind::Commit, "commit"),
        "tree" => (ObjectKind::Tree, "tree"),
        "tag" => (ObjectKind::Tag, "tag"),
        other => fail_usage(format!("hash-object: unknown object type '{other}'")),
    }
}

/// Hashes payload bytes and optionally writes them to the loose object database.
fn hash_and_output(payload: &[u8], kind_spec: (ObjectKind, &str), loose_odb: Option<&LooseOdb>) {
    let (kind, kind_name) = kind_spec;
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
