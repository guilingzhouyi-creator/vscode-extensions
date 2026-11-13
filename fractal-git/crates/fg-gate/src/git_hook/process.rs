//! Module: fg-gate — Git Hook Subprocess Spawning & Stream Capture
//! File Path: crates/fg-gate/src/git_hook/process.rs
//! Architecture Role: Builds hook child commands, feeds optional stdin, enforces wall-clock
//!   timeouts, and captures tail-bounded stdout/stderr streams.
//! Dependencies & Triggers: Internal submodule of `fg-gate::git_hook`.
//! Responsibilities: Construct `Command` with forward-slash hook paths, poll subprocess completion
//!   with kill-on-timeout fallback, and truncate captured output streams.
//! Exit Semantics & Design Rationale: Timed-out processes are killed and reported as
//!   `SpawnOutcome::TimedOut` without blocking on inherited grandchild pipe descriptors.
//!
//! Domain Governance Rules: FGT-GAT-001 (hook contracts), FGT-COR-001.

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use super::{hook_argument_path, HOOK_POLL_INTERVAL};

/// Maximum number of characters retained from each captured hook output stream.
const OUTPUT_TAIL_LIMIT: usize = 4096;

/// Captured result of one spawned interpreter attempt.
pub(super) enum SpawnOutcome {
    /// The hook finished and its streams were collected.
    Completed(std::process::Output),
    /// The wall-clock budget expired and the hook was terminated.
    TimedOut,
}

/// Builds the command that runs one hook file, optionally through a POSIX shell.
pub(super) fn build_command(shell: Option<&str>, hook_path: &Path) -> Command {
    match shell {
        Some(program) => {
            let mut command = Command::new(program);
            command.arg(hook_argument_path(hook_path));
            command
        }
        None => Command::new(hook_path),
    }
}

/// Feeds optional stdin into the hook process and collects its captured output.
///
/// A hook that exceeds the budget is killed and reported without draining its inherited pipes,
/// because grandchildren may keep those handles open after their parent was terminated.
pub(super) fn capture_child_output(
    mut child: Child,
    stdin: Option<&str>,
    timeout: Duration,
) -> std::io::Result<SpawnOutcome> {
    if let Some(input) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            pipe.write_all(input.as_bytes())?;
        }
    }

    let deadline = Instant::now() + timeout;
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(SpawnOutcome::Completed);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(SpawnOutcome::TimedOut);
        }
        std::thread::sleep(HOOK_POLL_INTERVAL);
    }
}

/// Keeps only the trailing portion of one captured hook stream.
pub(super) fn capture_tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let trimmed = text.trim_end();
    let character_count = trimmed.chars().count();
    if character_count <= OUTPUT_TAIL_LIMIT {
        return trimmed.to_string();
    }
    trimmed
        .chars()
        .skip(character_count - OUTPUT_TAIL_LIMIT)
        .collect()
}
