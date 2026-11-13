//! Module: fg-gate — POSIX Shell Launcher Discovery & Probing
//! File Path: crates/fg-gate/src/git_hook/shell.rs
//! Architecture Role: Discovers and health-probes POSIX shell launchers on Windows while keeping
//!   direct shebang execution on POSIX hosts.
//! Dependencies & Triggers: Internal submodule of `fg-gate::git_hook`; cached via `OnceLock`.
//! Responsibilities: Enumerate Git/MSYS/PATH shell candidates, reject broken launchers quickly,
//!   and expose the ordered `interpreter_chain()` to hook execution.
//! Exit Semantics & Design Rationale: Unprobed candidates stay as fallbacks when probe budget
//!   is exhausted, preventing broken MSYS installations from stalling hook execution.
//!
//! Domain Governance Rules: FGT-GAT-001 (hook contracts), FGT-COR-001.

#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::time::{Duration, Instant};

#[cfg(windows)]
use super::HOOK_POLL_INTERVAL;

/// Budget for one interpreter health probe; broken launchers must not stall hook discovery.
#[cfg(windows)]
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Total budget for interpreter discovery; unprobed candidates remain available as fallbacks.
#[cfg(windows)]
const TOTAL_PROBE_BUDGET: Duration = Duration::from_millis(1000);

/// Returns the interpreter cache for the current platform.
///
/// Windows has no shebang execution, so hook scripts are handed to an available POSIX shell;
/// other platforms execute the hook file directly and let the kernel honour its shebang.
pub(super) fn shell_candidates() -> &'static [String] {
    static CANDIDATES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    CANDIDATES.get_or_init(resolve_shell_candidates)
}

/// Orders launchers so the first entry of the chain is attempted first.
pub(super) fn interpreter_chain() -> Vec<Option<&'static str>> {
    let shells = shell_candidates();
    if shells.is_empty() {
        return vec![None];
    }
    shells.iter().map(|shell| Some(shell.as_str())).collect()
}

/// Resolves the interpreter chain, keeping only launchers proven able to start a shell.
///
/// Some Windows hosts ship several MSYS installations whose runtimes cannot coexist; probing
/// each candidate once avoids selecting a launcher that only fails at hook execution time.
fn resolve_shell_candidates() -> Vec<String> {
    let discovered = build_shell_candidates();

    #[cfg(windows)]
    {
        let probing_started = Instant::now();
        let mut healthy_index: Option<usize> = None;
        for (index, candidate) in discovered.iter().enumerate() {
            if probing_started.elapsed() >= TOTAL_PROBE_BUDGET {
                break;
            }
            if healthy_shell(candidate) {
                healthy_index = Some(index);
                break;
            }
        }
        if let Some(index) = healthy_index {
            let mut ordered = Vec::with_capacity(discovered.len());
            ordered.push(discovered[index].clone());
            ordered.extend(
                discovered
                    .into_iter()
                    .enumerate()
                    .filter(|(position, _)| *position != index)
                    .map(|(_, candidate)| candidate),
            );
            ordered
        } else {
            Vec::new()
        }
    }
    #[cfg(not(windows))]
    {
        discovered
    }
}

/// Reports whether one launcher can start a POSIX shell and exit cleanly within the probe budget.
#[cfg(windows)]
fn healthy_shell(program: &str) -> bool {
    let Ok(mut child) = Command::new(program)
        .args(["-c", "exit 0"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };

    let deadline = Instant::now() + SHELL_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {}
            Err(_) => {
                let _ = child.kill();
                return false;
            }
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return false;
        }
        std::thread::sleep(HOOK_POLL_INTERVAL);
    }
}

/// Builds the one-shot interpreter chain: no shell on POSIX, POSIX shells on Windows.
fn build_shell_candidates() -> Vec<String> {
    #[cfg(windows)]
    {
        windows_shell_candidates()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Discovers POSIX shells on Windows, preferring Git and MSYS installations over WSL shims.
#[cfg(windows)]
fn windows_shell_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    for known_root in well_known_install_roots() {
        push_shell_candidates(&mut candidates, &known_root);
    }
    if let Some(path_value) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path_value) {
            if is_windows_shim_root(&directory) {
                continue;
            }
            push_shell_candidates(&mut candidates, &directory);
        }
    }
    for fallback in ["bash", "sh"] {
        candidates.push(fallback.to_string());
    }
    candidates
}

/// Derives POSIX shell locations from the host environment instead of hardcoded drive letters.
#[cfg(windows)]
fn well_known_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        let Some(directory) = std::env::var_os(variable) else {
            continue;
        };
        let base = PathBuf::from(directory);
        roots.push(base.join("Git").join("bin"));
        roots.push(base.join("Git").join("usr").join("bin"));
    }
    if let Some(drive) = std::env::var_os("SystemDrive") {
        let base = PathBuf::from(drive);
        roots.push(base.join("msys64").join("usr").join("bin"));
        roots.push(base.join("msys64").join("mingw64").join("bin"));
    }
    if let Some(msys_root) = std::env::var_os("MSYS2_ROOT") {
        roots.push(PathBuf::from(msys_root).join("usr").join("bin"));
    }
    roots
}

/// Reports whether a PATH entry hosts Windows-native shells that are not POSIX shells.
#[cfg(windows)]
fn is_windows_shim_root(directory: &Path) -> bool {
    let lower = directory.to_string_lossy().to_ascii_lowercase();
    lower.contains("system32")
        || lower.contains("windowsapps")
        || lower.contains("shims")
        || lower.contains("scoop")
}

/// Appends the POSIX shells installed in one directory, preserving discovery order.
#[cfg(windows)]
fn push_shell_candidates(candidates: &mut Vec<String>, directory: &Path) {
    for file_name in ["bash.exe", "sh.exe"] {
        let candidate = directory.join(file_name);
        if !candidate.is_file() {
            continue;
        }
        let candidate_text = candidate.to_string_lossy().to_string();
        if candidates
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&candidate_text))
        {
            continue;
        }
        candidates.push(candidate_text);
    }
}
