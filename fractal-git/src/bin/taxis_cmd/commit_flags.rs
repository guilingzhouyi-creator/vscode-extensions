//! Module: taxis_cmd::commit_flags — Commit CLI Flag Parsing and Message Construction
//! File Path: src/bin/taxis_cmd/commit_flags.rs
//! Architecture Role: Parses standard Git CLI flags (`-m`, `-F`/`--file`, `--amend`, `--signoff`,
//!   `--no-verify`, `--reset-author`) and resolves the effective commit message and context.
//! Dependencies & Triggers: Dispatched by `taxis_cmd::commit` during commit setup.
//! Responsibilities: CLI flag parsing, argument stripping, message resolution, signoff trailer formatting.
//! Exit Semantics & Design Rationale:
//!   - Rejects mutually exclusive combinations (`-m` with `-F`) with a usage error.
//!   - Normalizes line endings to LF and enforces non-empty commit messages.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-CLI-001`: CLI exit status and parity contract guard

use std::fs;
use std::path::Path;

use fractal_git::constants::cli::CliTag;

use super::common::{fail_fatal, find_arg_value, reject, CliContext};

/// Parsed standard Git CLI flags for `taxis commit`.
pub(crate) struct CommitCliFlags<'a> {
    pub(crate) message: Option<&'a str>,
    pub(crate) msg_file: Option<&'a str>,
    pub(crate) amend: bool,
    pub(crate) no_verify: bool,
    pub(crate) signoff: bool,
    pub(crate) stage_all: bool,
    pub(crate) reset_author: bool,
}

/// Parses `-F`/`--file`, `-m`/`--message`, `--amend`, `--no-verify`, and `--signoff` flags.
pub(crate) fn parse_commit_cli_flags(args: &[String]) -> CommitCliFlags<'_> {
    let mut message: Option<&str> = None;
    let mut msg_file: Option<&str> = None;
    let mut amend = false;
    let mut no_verify = false;
    let mut signoff = false;
    let mut stage_all = false;
    let mut reset_author = false;
    let mut cursor = 0;

    while cursor < args.len() {
        let arg = args[cursor].as_str();
        match arg {
            "--amend" => amend = true,
            "-n" | "--no-verify" => no_verify = true,
            "-s" | "--signoff" => signoff = true,
            "--allow-empty" => {}
            "--reset-author" => reset_author = true,
            "-a" | "--all" => stage_all = true,
            "-am" => {
                stage_all = true;
                if cursor + 1 < args.len() {
                    message = Some(args[cursor + 1].as_str());
                    cursor += 1;
                }
            }
            "-m" | "--message" => {
                if cursor + 1 < args.len() {
                    message = Some(args[cursor + 1].as_str());
                    cursor += 1;
                } else {
                    fail_fatal("option `-m` requires a message value");
                }
            }
            "-F" | "--file" => {
                if cursor + 1 < args.len() {
                    msg_file = Some(args[cursor + 1].as_str());
                    cursor += 1;
                } else {
                    fail_fatal("option `-F` requires a file path");
                }
            }
            _ if arg.starts_with("--message=") => {
                message = Some(&arg["--message=".len()..]);
            }
            _ if arg.starts_with("--file=") => {
                msg_file = Some(&arg["--file=".len()..]);
            }
            _ if arg.starts_with("-F") && arg.len() > 2 => {
                msg_file = Some(&arg[2..]);
            }
            _ if arg.starts_with("-m") && arg.len() > 2 => {
                message = Some(&arg[2..]);
            }
            _ => {}
        }
        cursor += 1;
    }

    if message.is_some() && msg_file.is_some() {
        reject(
            CliTag::ERROR,
            "options '-m' and '-F' cannot be used together",
        );
    }

    CommitCliFlags {
        message,
        msg_file,
        amend,
        no_verify,
        signoff,
        stage_all,
        reset_author,
    }
}

/// Builds a cloned `CliContext` without `-F`/`--file` message arguments so downstream sync sees only staged path flags.
pub(crate) fn strip_message_file_flags(ctx: &CliContext) -> CliContext {
    let mut cleaned_args = Vec::with_capacity(ctx.args.len());
    let mut cursor = 0;
    while cursor < ctx.args.len() {
        let arg = ctx.args[cursor].as_str();
        if arg == "-F" || arg == "--file" {
            cursor += 2;
            continue;
        }
        if arg.starts_with("--file=") || (arg.starts_with("-F") && arg.len() > 2) {
            cursor += 1;
            continue;
        }
        cleaned_args.push(ctx.args[cursor].clone());
        cursor += 1;
    }
    CliContext {
        git_dir: ctx.git_dir.clone(),
        json_mode: ctx.json_mode,
        args: cleaned_args,
    }
}

/// Resolves the commit message from `-m`, `-F`/`--file`, `--amend` parent text, or the checkpoint template.
pub(crate) fn resolve_commit_message_with_flags(
    args: &[String],
    flags: &CommitCliFlags<'_>,
    card_id: &str,
    work_root: &Path,
    amend_default: Option<&str>,
) -> String {
    if let Some(msg) = flags.message {
        return msg.to_string();
    }
    if let Some(file_spec) = flags.msg_file {
        let raw = if file_spec == "-" {
            match std::io::read_to_string(std::io::stdin()) {
                Ok(text) => text,
                Err(err) => fail_fatal(format!("could not read commit message from stdin: {err}")),
            }
        } else {
            let direct = Path::new(file_spec);
            let chosen = if direct.is_file() {
                direct.to_path_buf()
            } else {
                work_root.join(file_spec)
            };
            match fs::read_to_string(&chosen) {
                Ok(text) => text,
                Err(err) => fail_fatal(format!("could not read log file '{file_spec}': {err}")),
            }
        };
        let normalized = raw.replace("\r\n", "\n");
        let trimmed = normalized.trim_end();
        if trimmed.is_empty() {
            fail_fatal("Aborting commit due to empty commit message.");
        }
        return format!("{trimmed}\n");
    }
    if let Some(previous_msg) = amend_default {
        return previous_msg.to_string();
    }

    let declared_project = find_arg_value(args, &["--project"]).unwrap_or("governance");
    format!(
        concat!(
            "feat(core): record atomic commit checkpoint for {card}\n\n",
            "[Project / 项目归属]\n- {project}\n\n",
            "[Why / 动机背景]\n- Capture the current working tree as a recoverable checkpoint ",
            "before further mutation begins.\n\n",
            "[Changed / 变更调整]\n- Persisted the staged working tree state as an immutable ",
            "commit object.\n\n",
            "[Verification / 验证结论]\n- Assert the recorded tree matches the staged content ",
            "and the target reference advances atomically."
        ),
        card = card_id,
        project = declared_project
    )
}

/// Appends a `Signed-off-by: <name> <<email>>` trailer unless already present at the end.
pub(crate) fn append_signoff_trailer(message: &str, name: &str, email: &str) -> String {
    let trailer = format!("Signed-off-by: {name} <{email}>");
    let trimmed = message.trim_end();
    if trimmed
        .lines()
        .last()
        .is_some_and(|last| last.trim() == trailer)
    {
        return format!("{trimmed}\n");
    }
    let last_para = trimmed.rsplit("\n\n").next().unwrap_or(trimmed);
    let has_trailer_block = last_para.lines().any(|line| {
        line.starts_with("Signed-off-by:")
            || line.starts_with("Co-authored-by:")
            || line.starts_with("Reviewed-by:")
    });
    if has_trailer_block {
        format!("{trimmed}\n{trailer}\n")
    } else {
        format!("{trimmed}\n\n{trailer}\n")
    }
}

/// Reports whether the caller explicitly supplied Taxis governance or actor flags.
pub(crate) fn has_taxis_governance_flags(args: &[String]) -> bool {
    args.iter().any(|arg| {
        matches!(
            arg.as_str(),
            "--policy" | "--agent" | "--human" | "--cell" | "--card" | "--token" | "--target"
        )
    })
}
