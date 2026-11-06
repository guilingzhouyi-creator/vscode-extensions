//! Module: taxis_cmd::read_cat_file — cat-file Object Inspection
//! File Path: src/bin/taxis_cmd/read_cat_file.rs
//! Architecture Role: The cat-file family — mode parsing, batch streaming, and the diagnostics
//!   Git prints when an object cannot be resolved or read.
//! Dependencies & Triggers: Re-exported by read so taxis.rs keeps one dispatch surface.
//! Responsibilities: Byte-exact -t/-s/-p/-e output, --batch/--batch-check streaming, and the
//!   exit-code mapping that makes cat-file -e usable as a script probe.
//! Exit Semantics & Design Rationale:
//!   - A missing object is diagnosed, never approximated: the wording and the exit code are part
//!     of the contract scripts branch on.
//!   - -p writes the payload verbatim with no appended newline; a caller that pipes the output
//!     into a hash compares every byte.

use fg_core::models::ObjectKind;
use fg_object::GitTreeRef;
use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, fail_usage, print_json, reject, CliContext, EXIT_REJECTED};
use super::repo_view::RepoView;

struct CatFileArgs {
    mode: CatFileMode,
    mode_selected: bool,
    expect_type: Option<String>,
    revision: Option<String>,
    batch: Option<BatchMode>,
}

/// Dispatches `cat-file`.
pub fn handle_cat_file(ctx: &CliContext) {
    let view = match RepoView::open(ctx) {
        Ok(opened) => opened,
        Err(open_err) => fail_fatal(open_err),
    };
    let parsed = parse_cat_file_args(&ctx.args);
    if let Some(batch_mode) = parsed.batch {
        run_batch(&view, batch_mode);
    }

    let Some(revision) = parsed.revision else {
        fail_usage("taxis cat-file <type> <object>");
    };
    if !parsed.mode_selected && parsed.expect_type.is_none() {
        fail_usage("taxis cat-file <type> <object>");
    }
    let resolved = match view.resolve_object_spec(&revision) {
        Ok(oid) => oid,
        Err(_) => cat_file_resolution_failure(
            &view,
            &revision,
            parsed.mode,
            parsed.expect_type.as_deref(),
        ),
    };
    let object = match view.object(&resolved) {
        Ok(found) => found,
        Err(_) => cat_file_read_failure(&revision, parsed.mode),
    };

    if let Some(expected) = parsed.expect_type {
        if expected != object.kind.as_str() {
            fail_fatal(format!("git cat-file {revision}: bad file"));
        }
    }

    render_cat_file_object(ctx, resolved, &object, parsed.mode);
}

fn parse_cat_file_args(args: &[String]) -> CatFileArgs {
    let mut parsed = CatFileArgs {
        mode: CatFileMode::Pretty,
        mode_selected: false,
        expect_type: None,
        revision: None,
        batch: None,
    };
    for argument in args {
        apply_cat_file_arg(&mut parsed, argument.as_str());
    }
    parsed
}

fn apply_cat_file_arg(parsed: &mut CatFileArgs, arg: &str) {
    match arg {
        "-t" => {
            parsed.mode = CatFileMode::Type;
            parsed.mode_selected = true;
        }
        "-s" => {
            parsed.mode = CatFileMode::Size;
            parsed.mode_selected = true;
        }
        "-p" => {
            parsed.mode = CatFileMode::Pretty;
            parsed.mode_selected = true;
        }
        "-e" => {
            parsed.mode = CatFileMode::Exists;
            parsed.mode_selected = true;
        }
        "--batch" => parsed.batch = Some(BatchMode::Contents),
        "--batch-check" => parsed.batch = Some(BatchMode::Check),
        other if other.starts_with("--batch=") => reject(
            CliTag::ERROR,
            format!("cat-file does not implement the custom batch format in '{other}'"),
        ),
        other if other.starts_with('-') => {
            fail_usage(format!("taxis cat-file: unknown option '{other}'"))
        }
        other if parsed.revision.is_none() && is_object_type_name(other) => {
            parsed.expect_type = Some(other.to_string());
        }
        other if parsed.revision.is_none() => {
            parsed.revision = Some(other.to_string());
        }
        _ => fail_usage("taxis cat-file <type> <object>"),
    }
}

fn render_cat_file_object(
    ctx: &CliContext,
    resolved: fg_core::models::Oid,
    object: &fg_storage::PackedObject,
    mode: CatFileMode,
) {
    if ctx.json_mode {
        let payload = serde_json::json!({
            "engine": "taxis",
            "operation": "cat-file",
            "oid": resolved.to_hex(),
            "type": object.kind.as_str(),
            "size": object.payload.len(),
            "payload": String::from_utf8_lossy(&object.payload),
        });
        print_json(&payload);
        return;
    }

    match mode {
        CatFileMode::Type => println!("{}", object.kind.as_str()),
        CatFileMode::Size => println!("{}", object.payload.len()),
        CatFileMode::Exists => {}
        CatFileMode::Pretty => print_payload(object.kind, &object.payload),
    }
}

/// What a `cat-file` invocation asked to be printed.
#[derive(Clone, Copy)]
enum CatFileMode {
    /// Object type only.
    Type,
    /// Payload length only.
    Size,
    /// Full payload.
    Pretty,
    /// Nothing; only the exit status matters.
    Exists,
}

/// Which batch answer `cat-file` streams for each stdin line.
enum BatchMode {
    /// `--batch`: id, type, size, then the payload.
    Contents,
    /// `--batch-check`: id, type, and size only.
    Check,
}

/// Streams batch answers for every revision read from stdin.
///
/// Git keeps the process alive and answers line by line, reporting `<input> missing` for anything
/// that does not resolve instead of failing the whole run. A one-shot lookup cannot express that: a
/// caller feeding a hundred revisions expects ninety-nine answers and one diagnosis, not an abort.
fn run_batch(view: &RepoView, mode: BatchMode) -> ! {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut sink = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let request = line.trim();
        if request.is_empty() {
            continue;
        }
        let Ok(oid) = view.resolve_object_spec(request) else {
            let _ = writeln!(sink, "{request} missing");
            continue;
        };
        let Ok(object) = view.object(&oid) else {
            let _ = writeln!(sink, "{request} missing");
            continue;
        };
        let _ = writeln!(
            sink,
            "{} {} {}",
            oid.to_hex(),
            object.kind.as_str(),
            object.payload.len()
        );
        if matches!(mode, BatchMode::Contents) {
            let _ = sink.write_all(&object.payload);
            // Git always closes a batch payload with a newline, even when the payload already ends
            // with one. That unconditional terminator is what lets a reader find the next header.
            let _ = sink.write_all(b"\n");
        }
    }
    let _ = sink.flush();
    std::process::exit(0)
}

/// Reports whether `text` names one of the four object types.
fn is_object_type_name(text: &str) -> bool {
    matches!(text, "blob" | "tree" | "commit" | "tag")
}

/// Reports whether `text` is a full hexadecimal object name (SHA-1 40 or SHA-256 64 characters).
///
/// Git only treats such a name as an id it could have looked up; anything else is an unknown
/// revision. The distinction decides whether `-e` answers "absent" (1) or "not a valid name" (128).
pub(super) fn well_formed_object_name(text: &str) -> bool {
    matches!(text.len(), 40 | 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Terminates the way Git does when a revision argument cannot be resolved to an object id.
///
/// The diagnosis is chosen in the same order Git chooses it. A `rev:path` argument is reported as a
/// path failure when the revision resolves and as an invalid object name otherwise -- for every
/// mode, including `-e`, which therefore exits 128 here instead of the 1 a well-formed missing id
/// answers. An explicit `<type>` argument turns any remaining failure into Git's "bad file"
/// diagnosis. Only a bare well-formed id reaches the mode-dependent mapping; keeping that mapping
/// is what makes `cat-file -e` usable as a probe in scripts.
fn cat_file_resolution_failure(
    view: &RepoView,
    revision: &str,
    mode: CatFileMode,
    expected_type: Option<&str>,
) -> ! {
    if let Some((rev, path)) = revision.split_once(':') {
        if view.resolve(rev).is_err() {
            fail_fatal(format!("invalid object name '{rev}'."));
        }
        fail_fatal(format!("path '{path}' does not exist in '{rev}'"));
    }
    if expected_type.is_some() {
        fail_fatal(format!("git cat-file {revision}: bad file"));
    }
    if well_formed_object_name(revision) {
        match mode {
            CatFileMode::Exists => std::process::exit(EXIT_REJECTED),
            CatFileMode::Type | CatFileMode::Size => {
                fail_fatal("git cat-file: could not get object info")
            }
            CatFileMode::Pretty => fail_fatal(format!("Not a valid object name {revision}")),
        }
    }
    fail_fatal(format!("Not a valid object name {revision}"))
}

/// Terminates the way Git does when an object id resolves but its object cannot be read.
///
/// `-e` and `-p` name the missing object, while `-t` and `-s` report that the object info is
/// unavailable; both are fatal except for the existence probe, which answers with status 1.
fn cat_file_read_failure(revision: &str, mode: CatFileMode) -> ! {
    match mode {
        CatFileMode::Exists => std::process::exit(EXIT_REJECTED),
        CatFileMode::Pretty => fail_fatal(format!("Not a valid object name {revision}")),
        CatFileMode::Type | CatFileMode::Size => {
            fail_fatal("git cat-file: could not get object info")
        }
    }
}

/// Writes a payload to stdout, flattening a tree into its readable listing.
///
/// The payload is written verbatim, with no trailing newline added. `cat-file -p` output is compared
/// byte-for-byte by callers that pipe it into a hash, and a single appended newline changes every
/// such hash for every object whose content does not already end with one.
fn print_payload(kind: ObjectKind, payload: &[u8]) {
    if kind == ObjectKind::Tree {
        for entry in GitTreeRef::from_bytes(payload).iter() {
            match entry {
                Ok(item) => println!(
                    "{:06o} {} {}\t{}",
                    item.mode.to_u32(),
                    object_kind_of(item.mode).as_str(),
                    item.oid.to_hex(),
                    item.name
                ),
                Err(codec_err) => reject(CliTag::ERROR, codec_err),
            }
        }
        return;
    }
    use std::io::Write;
    let mut sink = std::io::stdout();
    let _ = sink.write_all(payload);
    let _ = sink.flush();
}

/// Maps a tree entry mode to the object kind it references.
pub(super) fn object_kind_of(mode: fg_core::models::FileMode) -> ObjectKind {
    if mode.is_tree() {
        ObjectKind::Tree
    } else if mode == fg_core::models::FileMode::Gitlink {
        ObjectKind::Commit
    } else {
        ObjectKind::Blob
    }
}

#[cfg(test)]
mod tests {
    use super::is_object_type_name;

    #[test]
    fn recognises_the_four_object_type_names() {
        for name in ["blob", "tree", "commit", "tag"] {
            assert!(is_object_type_name(name));
        }
        assert!(!is_object_type_name("blobs"));
        assert!(!is_object_type_name("HEAD"));
    }
}
