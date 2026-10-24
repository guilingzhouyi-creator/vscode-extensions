//! Module: fg-gate — Git Hook Contract Runner
//! File Path: crates/fg-gate/src/git_hook.rs
//! Architecture Role: Bridges Taxis local commands to the repository's user-owned Git hook
//!   scripts so that a workspace gate pipeline observes the same lifecycle points Git itself
//!   would produce for the equivalent plain Git command.
//! Dependencies & Triggers: Consumed by the Taxis commit, merge, and checkout dispatchers
//!   immediately before and after the durable mutation they perform.
//! Responsibilities: Resolving `core.hooksPath` and the `core.taxishooks` switch, executing
//!   hook scripts with Git-compatible arguments, stdin, and environment overrides, enforcing a
//!   wall-clock budget, then interpreting their exit codes.
//! Exit Semantics & Design Rationale: An absent or policy-disabled hook is reported as `Missing`
//!   and never blocks; a hook that exists but exits non-zero blocks the caller, so local policy
//!   cannot silently disappear just because Taxis replaced the Git porcelain. A hook that exceeds
//!   the budget is killed and downgraded to `TimedOut` so an unresponsive script degrades rather
//!   than deadlocks the mutation.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Maximum number of characters retained from each captured hook output stream.
const OUTPUT_TAIL_LIMIT: usize = 4096;

/// Exit code reported when a hook exists but no shell interpreter can execute it.
const EXIT_INTERPRETER_UNAVAILABLE: i32 = 126;

/// Default wall-clock budget for one hook invocation, matching a conservative CI ceiling.
const DEFAULT_HOOK_TIMEOUT: Duration = Duration::from_secs(600);

/// Polling interval used while waiting for a hook process to finish.
const HOOK_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Budget for one interpreter health probe; broken launchers must not stall hook discovery.
#[cfg(windows)]
const SHELL_PROBE_TIMEOUT: Duration = Duration::from_millis(250);

/// Total budget for interpreter discovery; unprobed candidates remain available as fallbacks.
#[cfg(windows)]
const TOTAL_PROBE_BUDGET: Duration = Duration::from_millis(1000);

/// Lifecycle result of a single Git hook invocation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHookStatus {
    /// No executable hook file is installed at the resolved path.
    Missing,
    /// The hook exited with status code zero.
    Passed,
    /// The hook exited non-zero and therefore blocks the calling operation.
    Blocked { exit_code: i32 },
    /// The hook exceeded its wall-clock budget and was killed without blocking the operation.
    TimedOut { timeout_millis: u64 },
}

/// Captured execution result of one Git hook.
#[derive(Debug, Clone)]
pub struct GitHookOutcome {
    /// Hook file name, for example `pre-commit`.
    pub hook: String,
    /// Interpreted lifecycle status.
    pub status: GitHookStatus,
    /// Captured standard output, tail-limited.
    pub stdout: String,
    /// Captured standard error, tail-limited.
    pub stderr: String,
}

impl GitHookOutcome {
    /// Returns true when the hook rejected the operation.
    pub fn is_blocked(&self) -> bool {
        matches!(self.status, GitHookStatus::Blocked { .. })
    }

    /// Returns the observed exit code, or zero for passing and missing hooks.
    pub fn exit_code(&self) -> i32 {
        match self.status {
            GitHookStatus::Blocked { exit_code } => exit_code,
            _ => 0,
        }
    }

    /// Renders a single-line diagnostic suitable for CLI rejection messages.
    pub fn describe(&self) -> String {
        match &self.status {
            GitHookStatus::Missing => format!("{}: no executable hook installed", self.hook),
            GitHookStatus::Passed => format!("{}: hook accepted the operation", self.hook),
            GitHookStatus::TimedOut { timeout_millis } => format!(
                "{}: hook exceeded {} ms budget and was terminated",
                self.hook, timeout_millis
            ),
            GitHookStatus::Blocked { exit_code } => {
                let detail = self.describe_failure_detail();
                if detail.is_empty() {
                    format!("{}: hook exited with status {}", self.hook, exit_code)
                } else {
                    format!(
                        "{}: hook exited with status {}: {}",
                        self.hook, exit_code, detail
                    )
                }
            }
        }
    }

    /// Returns the most informative captured stream for rejection messages.
    fn describe_failure_detail(&self) -> String {
        if !self.stderr.trim().is_empty() {
            return self.stderr.trim().to_string();
        }
        self.stdout.trim().to_string()
    }
}

/// Runtime policy that decides whether and how the repository's own hooks participate.
#[derive(Debug, Clone)]
pub struct HookConfig {
    /// Whether hook execution is enabled at all, read from `core.taxishooks`.
    pub enabled: bool,
    /// Optional hooks directory override, read from `core.hooksPath`.
    pub hooks_path_override: Option<PathBuf>,
    /// Wall-clock budget applied to a single hook invocation.
    pub timeout: Duration,
}

impl Default for HookConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hooks_path_override: None,
            timeout: DEFAULT_HOOK_TIMEOUT,
        }
    }
}

impl HookConfig {
    /// Reads the supported `[core]` switches from `<git-dir>/config` without following includes.
    pub fn from_git_config(work_root: &Path, git_dir: &Path) -> Self {
        let mut config = Self::default();
        let Some(settings) = read_core_hook_settings(&git_dir.join("config")) else {
            return config;
        };
        config.enabled = settings.enabled.unwrap_or(true);
        if let Some(configured) = settings.hooks_path.filter(|value| !value.is_empty()) {
            let candidate = PathBuf::from(&configured);
            config.hooks_path_override = Some(if candidate.is_absolute() {
                candidate
            } else {
                work_root.join(candidate)
            });
        }
        if let Some(millis) = settings.timeout_millis.filter(|value| *value > 0) {
            config.timeout = Duration::from_millis(millis);
        }
        config
    }
}

/// Locates and executes Git hook scripts for one repository worktree.
#[derive(Debug, Clone)]
pub struct GitHookRunner {
    work_root: PathBuf,
    git_dir: PathBuf,
    hooks_dir: PathBuf,
    config: HookConfig,
}

impl GitHookRunner {
    /// Discovers the active hooks directory from `core.hooksPath`, falling back to
    /// `<git-dir>/hooks` exactly like Git does when the setting is absent.
    pub fn discover(work_root: impl Into<PathBuf>, git_dir: impl Into<PathBuf>) -> Self {
        let work_root = absolutize(work_root.into());
        let git_dir = absolutize(git_dir.into());
        let config = HookConfig::from_git_config(&work_root, &git_dir);
        let hooks_dir = match config.hooks_path_override.clone() {
            Some(configured) => configured,
            None => resolve_hooks_dir(&work_root, &git_dir),
        };
        Self {
            work_root,
            git_dir,
            hooks_dir,
            config,
        }
    }

    /// Builds a runner bound to an explicit hooks directory, used by focused tests.
    pub fn with_hooks_dir(
        work_root: impl Into<PathBuf>,
        git_dir: impl Into<PathBuf>,
        hooks_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            work_root: absolutize(work_root.into()),
            git_dir: absolutize(git_dir.into()),
            hooks_dir: absolutize(hooks_dir.into()),
            config: HookConfig::default(),
        }
    }

    /// Replaces the runtime policy, used by focused tests and future configuration plumbing.
    pub fn with_config(mut self, config: HookConfig) -> Self {
        self.config = config;
        self
    }

    /// Returns the active runtime policy.
    pub fn config(&self) -> &HookConfig {
        &self.config
    }

    /// Returns the worktree root used as hook working directory.
    pub fn work_root(&self) -> &Path {
        &self.work_root
    }

    /// Returns the repository metadata directory.
    pub fn git_dir(&self) -> &Path {
        &self.git_dir
    }

    /// Returns the resolved hooks directory.
    pub fn hooks_dir(&self) -> &Path {
        &self.hooks_dir
    }

    /// Resolves the on-disk path of one hook by its Git name.
    pub fn hook_path(&self, name: &str) -> PathBuf {
        self.hooks_dir.join(name)
    }

    /// Reports whether the named hook exists and is executable.
    pub fn is_installed(&self, name: &str) -> bool {
        hook_is_executable(&self.hook_path(name))
    }

    /// Runs one hook with Git-compatible arguments, optional stdin, and environment overrides.
    pub fn run(
        &self,
        name: &str,
        args: &[String],
        stdin: Option<&str>,
        envs: &BTreeMap<String, String>,
    ) -> GitHookOutcome {
        if !self.config.enabled {
            return GitHookOutcome {
                hook: name.to_string(),
                status: GitHookStatus::Missing,
                stdout: String::new(),
                stderr: "hook execution disabled by core.taxishooks=false".to_string(),
            };
        }

        let hook_path = self.hook_path(name);
        if !hook_is_executable(&hook_path) {
            return GitHookOutcome {
                hook: name.to_string(),
                status: GitHookStatus::Missing,
                stdout: String::new(),
                stderr: String::new(),
            };
        }

        match self.execute(&hook_path, args, stdin, envs) {
            Ok((status, stdout, stderr)) => GitHookOutcome {
                hook: name.to_string(),
                status,
                stdout,
                stderr,
            },
            Err(exec_err) => GitHookOutcome {
                hook: name.to_string(),
                status: GitHookStatus::Blocked {
                    exit_code: EXIT_INTERPRETER_UNAVAILABLE,
                },
                stdout: String::new(),
                stderr: format!("cannot execute hook '{}': {exec_err}", hook_path.display()),
            },
        }
    }

    /// Computes the subdirectory prefix Git exports when a command runs below the worktree root.
    ///
    /// Git sets GIT_PREFIX only for commands started inside a subdirectory; hooks inherit it so
    /// path-sensitive scripts can resolve relative paths like Git does. An empty or foreign
    /// working directory yields no prefix, which mirrors Git's own behaviour.
    fn working_prefix(&self) -> Option<String> {
        let current = std::env::current_dir().ok()?;
        let root = self.work_root.canonicalize().ok()?;
        let current = current.canonicalize().ok()?;
        let relative = current.strip_prefix(&root).ok()?;
        let segments: Vec<String> = relative
            .components()
            .filter_map(|component| match component {
                std::path::Component::Normal(segment) => {
                    Some(segment.to_string_lossy().to_string())
                }
                _ => None,
            })
            .collect();
        if segments.is_empty() {
            return None;
        }
        Some(format!("{}/", segments.join("/")))
    }

    /// Executes one resolved hook file and captures its streams.
    fn execute(
        &self,
        hook_path: &Path,
        args: &[String],
        stdin: Option<&str>,
        envs: &BTreeMap<String, String>,
    ) -> std::io::Result<(GitHookStatus, String, String)> {
        let timeout_millis = self.config.timeout.as_millis() as u64;
        match self.spawn(hook_path, args, stdin, envs)? {
            SpawnOutcome::TimedOut => Ok((
                GitHookStatus::TimedOut { timeout_millis },
                String::new(),
                String::new(),
            )),
            SpawnOutcome::Completed(output) => {
                let exit_code = output.status.code().unwrap_or(1);
                let status = if output.status.success() {
                    GitHookStatus::Passed
                } else {
                    GitHookStatus::Blocked { exit_code }
                };
                Ok((
                    status,
                    capture_tail(&output.stdout),
                    capture_tail(&output.stderr),
                ))
            }
        }
    }

    /// Spawns the hook through the first available interpreter and waits for completion.
    fn spawn(
        &self,
        hook_path: &Path,
        args: &[String],
        stdin: Option<&str>,
        envs: &BTreeMap<String, String>,
    ) -> std::io::Result<SpawnOutcome> {
        let mut interpreter_error: Option<std::io::Error> = None;

        for shell in interpreter_chain() {
            let mut command = build_command(shell, hook_path);
            command
                .args(args)
                .current_dir(&self.work_root)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .stdin(if stdin.is_some() {
                    Stdio::piped()
                } else {
                    Stdio::null()
                });
            for (key, value) in envs {
                command.env(key, value);
            }
            if !envs.contains_key("GIT_PREFIX") {
                if let Some(prefix) = self.working_prefix() {
                    command.env("GIT_PREFIX", prefix);
                }
            }

            match command.spawn() {
                Ok(child) => {
                    let captured = capture_child_output(child, stdin, self.config.timeout)?;
                    let SpawnOutcome::Completed(output) = captured else {
                        return Ok(captured);
                    };
                    if output.status.code().unwrap_or(1) < 0 {
                        interpreter_error = Some(std::io::Error::other(format!(
                            "shell launcher terminated abnormally: {}",
                            output.status
                        )));
                        continue;
                    }
                    return Ok(SpawnOutcome::Completed(output));
                }
                Err(spawn_err) if spawn_err.kind() == std::io::ErrorKind::NotFound => {
                    interpreter_error = Some(spawn_err);
                }
                Err(spawn_err) => return Err(spawn_err),
            }
        }

        Err(interpreter_error.unwrap_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no shell interpreter available to run Git hooks",
            )
        }))
    }
}

/// Renders a filesystem path in the forward-slash form Git hands to hook scripts.
pub fn hook_argument_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Returns the interpreter cache for the current platform.
///
/// Windows has no shebang execution, so hook scripts are handed to an available POSIX shell;
/// other platforms execute the hook file directly and let the kernel honour its shebang.
fn shell_candidates() -> &'static [String] {
    static CANDIDATES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    CANDIDATES.get_or_init(resolve_shell_candidates)
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
            return ordered;
        }
    }

    discovered
}

/// Reports whether one launcher can start a POSIX shell and exit cleanly within the probe budget.
///
/// A launcher that cannot start a shell is rejected quickly so a host with several broken MSYS
/// installations does not pay their startup cost on every process; the surviving launcher is
/// placed first and the unprobed remainder stays available as fallback candidates.
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

/// Orders launchers so the first entry of the chain is attempted first.
fn interpreter_chain() -> Vec<Option<&'static str>> {
    let shells = shell_candidates();
    if shells.is_empty() {
        return vec![None];
    }
    shells.iter().map(|shell| Some(shell.as_str())).collect()
}

/// Discovers POSIX shells on Windows, preferring Git and MSYS installations over WSL shims.
#[cfg(windows)]
fn windows_shell_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(path_value) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path_value) {
            if is_windows_shim_root(&directory) {
                continue;
            }
            push_shell_candidates(&mut candidates, &directory);
        }
    }
    for known_root in well_known_install_roots() {
        push_shell_candidates(&mut candidates, &known_root);
    }
    for fallback in ["bash", "sh"] {
        candidates.push(fallback.to_string());
    }
    candidates
}

/// Derives POSIX shell locations from the host environment instead of hardcoded drive letters.
///
/// Git for Windows may be absent from PATH while its interpreter still exists under the
/// program-files directories, and MSYS2 commonly lives next to the system drive. Building the
/// candidates from environment variables keeps the module portable across hosts and avoids
/// embedding machine-specific absolute paths in tracked source.
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
    lower.contains("system32") || lower.contains("windowsapps")
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

/// Builds the command that runs one hook file, optionally through a POSIX shell.
fn build_command(shell: Option<&str>, hook_path: &Path) -> Command {
    match shell {
        Some(program) => {
            let mut command = Command::new(program);
            command.arg(hook_argument_path(hook_path));
            command
        }
        None => Command::new(hook_path),
    }
}

/// Captured result of one spawned interpreter attempt.
enum SpawnOutcome {
    /// The hook finished and its streams were collected.
    Completed(std::process::Output),
    /// The wall-clock budget expired and the hook was terminated.
    TimedOut,
}

/// Feeds optional stdin into the hook process and collects its captured output.
///
/// A hook that exceeds the budget is killed and reported without draining its inherited pipes,
/// because grandchildren may keep those handles open after their parent was terminated.
fn capture_child_output(
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

/// Resolved `[core]` switches that influence whether user hooks participate.
#[derive(Debug, Default, Clone)]
struct CoreHookSettings {
    hooks_path: Option<String>,
    enabled: Option<bool>,
    timeout_millis: Option<u64>,
}

/// Resolves the hooks directory from config, defaulting to `<git-dir>/hooks`.
fn resolve_hooks_dir(work_root: &Path, git_dir: &Path) -> PathBuf {
    let configured = read_core_hook_settings(&git_dir.join("config"))
        .and_then(|settings| settings.hooks_path)
        .filter(|value| !value.is_empty());
    match configured {
        Some(configured) => {
            let candidate = PathBuf::from(&configured);
            if candidate.is_absolute() {
                candidate
            } else {
                work_root.join(candidate)
            }
        }
        None => git_dir.join("hooks"),
    }
}

/// Reads the supported `[core]` hook switches from a Git config file without following includes.
fn read_core_hook_settings(config_path: &Path) -> Option<CoreHookSettings> {
    let contents = std::fs::read_to_string(config_path).ok()?;
    let mut settings = CoreHookSettings::default();
    let mut in_core_section = false;

    for raw_line in contents.lines() {
        let line = strip_config_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') {
            in_core_section = line.eq_ignore_ascii_case("[core]");
            continue;
        }
        if !in_core_section {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = unquote_config_value(value.trim());
        if key.eq_ignore_ascii_case("hookspath") {
            settings.hooks_path = Some(value);
        } else if key.eq_ignore_ascii_case("taxishooks") {
            settings.enabled = Some(parse_config_bool(&value));
        } else if key.eq_ignore_ascii_case("taxishooktimeout") {
            settings.timeout_millis = value.parse::<u64>().ok();
        }
    }

    Some(settings)
}

/// Interprets one Git boolean config value.
fn parse_config_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "yes" | "on" | "1"
    )
}

/// Removes a trailing Git config comment while honouring double-quoted values.
fn strip_config_comment(line: &str) -> &str {
    let mut inside_quotes = false;
    for (index, character) in line.char_indices() {
        match character {
            '"' => inside_quotes = !inside_quotes,
            '#' | ';' if !inside_quotes => return &line[..index],
            _ => {}
        }
    }
    line
}

/// Unwraps one double-quoted Git config value, leaving bare values untouched.
fn unquote_config_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return trimmed[1..trimmed.len() - 1].replace("\\\"", "\"");
    }
    trimmed.to_string()
}

/// Reports whether a path is a hook Git would consider executable.
fn hook_is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Converts a path to an absolute path anchored at the process working directory.
fn absolutize(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    match std::env::current_dir() {
        Ok(current) => current.join(path),
        Err(_) => path,
    }
}

/// Keeps only the trailing portion of one captured hook stream.
fn capture_tail(bytes: &[u8]) -> String {
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

#[cfg(test)]
mod tests {
    use super::{parse_config_bool, strip_config_comment, unquote_config_value};

    #[test]
    fn strips_comments_outside_quotes_only() {
        assert_eq!(
            strip_config_comment("  hooksPath = .githooks # note"),
            "  hooksPath = .githooks "
        );
        assert_eq!(
            strip_config_comment("hooksPath = \"a#b\""),
            "hooksPath = \"a#b\""
        );
    }

    #[test]
    fn unwraps_quoted_values() {
        assert_eq!(unquote_config_value("\".githooks\""), ".githooks");
        assert_eq!(unquote_config_value(".githooks"), ".githooks");
        assert_eq!(unquote_config_value("\"\""), "");
    }

    #[test]
    fn interprets_git_boolean_switches() {
        for enabled in ["true", "TRUE", "yes", "on", "1", " true "] {
            assert!(parse_config_bool(enabled), "{enabled} should enable hooks");
        }
        for disabled in ["false", "no", "off", "0", "", "maybe"] {
            assert!(
                !parse_config_bool(disabled),
                "{disabled} should disable hooks"
            );
        }
    }
}
