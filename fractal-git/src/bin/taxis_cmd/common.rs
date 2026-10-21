//! Shared CLI context, argument helpers, and JSON printer for Taxis subcommands.

use std::path::PathBuf;

/// CLI Execution Context.
#[derive(Debug, Clone)]
pub struct CliContext {
    pub git_dir: PathBuf,
    pub json_mode: bool,
    pub args: Vec<String>,
}

pub fn print_json<T: serde::Serialize>(value: &T) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).unwrap_or_default()
    );
}

pub fn find_arg_value<'a>(args: &'a [String], flags: &[&str]) -> Option<&'a str> {
    for index in 0..args.len().saturating_sub(1) {
        if flags.contains(&args[index].as_str()) {
            return Some(args[index + 1].as_str());
        }
    }
    None
}
