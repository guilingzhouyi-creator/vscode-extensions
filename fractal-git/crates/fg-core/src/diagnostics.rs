//! Module: fg-core — Structured Diagnostic Logging
//! File Path: crates/fg-core/src/diagnostics.rs
//! Architecture Role: Emits structured, level-filtered diagnostics to stderr without adding a
//!   logging dependency to the kernel's lowest layer.
//! Dependencies & Triggers: Used by any subsystem that needs to explain what it decided. Configured
//!   once at CLI start-up from `--log-level` or `TAXIS_LOG`.
//! Responsibilities: Hold the process-wide severity threshold, format one record per event, and stay
//!   allocation-free when the event is filtered out.
//! Exit Semantics & Design Rationale: Diagnostics go to stderr and never to stdout, because stdout
//!   carries machine-readable command output and a stray log line would corrupt a JSON consumer.
//!   A disabled level costs one atomic load and no formatting, so a hot path can call `trace!`
//!   freely; formatting a message that is then discarded is the usual reason logging becomes the
//!   thing everyone turns off.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use crate::constants::Edition;
use crate::sanitizer::{sanitize_sensitive_tokens, split_rule_id};

pub mod record;
pub mod sink;

pub use record::*;
pub use sink::*;

/// Severity of a diagnostic record, ordered from most to least verbose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    /// Per-operation detail for diagnosing a specific failure.
    Trace = 0,
    /// Decisions and state transitions worth seeing while developing.
    Debug = 1,
    /// Normal lifecycle events an operator may want to see.
    Info = 2,
    /// Something unexpected that did not stop the operation.
    Warn = 3,
    /// An operation failed.
    Error = 4,
    /// Logging is off entirely.
    Off = 5,
}

impl LogLevel {
    /// Parses a level name case-insensitively.
    pub fn parse_str(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "trace" => Some(Self::Trace),
            "debug" => Some(Self::Debug),
            "info" => Some(Self::Info),
            "warn" | "warning" => Some(Self::Warn),
            "error" => Some(Self::Error),
            "off" | "none" | "quiet" => Some(Self::Off),
            _ => None,
        }
    }

    /// Canonical lower-case name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Trace => "trace",
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
            Self::Off => "off",
        }
    }

    /// Numeric rank used by the atomic threshold.
    const fn rank(self) -> u8 {
        self as u8
    }
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A severity threshold as a value, not as process state.
///
/// The process-wide threshold below is one `Threshold`; a caller that must not depend on it — a test,
/// or a subsystem deciding its own verbosity — can build one and pass it instead. Separating the
/// value from the storage is what makes the level testable: while the only way to ask "is this level
/// admitted" read a global, two tests running in parallel could hold different thresholds and both
/// be wrong about the other's answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Threshold {
    level: LogLevel,
}

impl Threshold {
    /// Creates a threshold admitting `level` and everything more severe.
    #[must_use]
    pub const fn at(level: LogLevel) -> Self {
        Self { level }
    }

    /// The default used when nothing has been configured.
    ///
    /// `Warn` rather than `Info`: an unconfigured run must stay quiet, because stdout carries
    /// machine-readable output and a stray narration line breaks a JSON consumer.
    #[must_use]
    pub const fn ambient() -> Self {
        Self::at(LogLevel::Warn)
    }

    /// The level this threshold sits at.
    #[must_use]
    pub const fn level(self) -> LogLevel {
        self.level
    }

    /// Reports whether a record at `level` would be admitted.
    #[must_use]
    pub const fn admits(self, level: LogLevel) -> bool {
        level.rank() >= self.level.rank()
    }
}

impl Default for Threshold {
    fn default() -> Self {
        Self::ambient()
    }
}
/// Process-wide severity threshold.
static THRESHOLD: AtomicU8 = AtomicU8::new(LogLevel::Warn as u8);

/// Sets the process-wide threshold, returning the previous value.
pub fn set_level(level: LogLevel) -> LogLevel {
    let previous = THRESHOLD.swap(level.rank(), Ordering::Relaxed);
    LogLevel::from_rank(previous)
}

/// Returns the current threshold.
pub fn level() -> LogLevel {
    LogLevel::from_rank(THRESHOLD.load(Ordering::Relaxed))
}

/// Returns the process-wide threshold as a value.
pub fn current_threshold() -> Threshold {
    Threshold::at(level())
}

impl LogLevel {
    /// Reconstructs a level from its stored rank.
    fn from_rank(rank: u8) -> Self {
        match rank {
            0 => Self::Trace,
            1 => Self::Debug,
            2 => Self::Info,
            3 => Self::Warn,
            4 => Self::Error,
            _ => Self::Off,
        }
    }
}

/// Configures logging from an explicit flag, then the environment, then the default.
pub fn configure(flag: Option<&str>) {
    let selected = flag
        .and_then(LogLevel::parse_str)
        .or_else(|| {
            std::env::var("TAXIS_LOG")
                .ok()
                .and_then(|value| LogLevel::parse_str(&value))
        })
        .or_else(|| {
            if std::env::var_os("TAXIS_DIAGNOSTIC").is_some_and(|val| val == "1" || val == "true")
                || std::env::var_os("TAXIS_DEV_MODE").is_some_and(|val| val == "1" || val == "true")
            {
                Some(LogLevel::Debug)
            } else {
                None
            }
        });
    if let Some(chosen) = selected {
        set_level(chosen);
    }
}

/// Whether diagnostic / debug output is active.
pub fn is_diagnostic_mode() -> bool {
    enabled(LogLevel::Debug)
        || std::env::var_os("TAXIS_DIAGNOSTIC").is_some_and(|val| val == "1" || val == "true")
        || std::env::var_os("TAXIS_DEV_MODE").is_some_and(|val| val == "1" || val == "true")
}

/// Whether a record at `level` would be emitted, checked before any formatting happens.
pub fn enabled(level: LogLevel) -> bool {
    current_threshold().admits(level)
}

static FILE_SINK: Mutex<Option<RotatingLogSink>> = Mutex::new(None);
static ACTIVE_SUBCOMMAND: Mutex<Option<String>> = Mutex::new(None);

/// Initializes the passive rotating file logger.
pub fn set_file_sink(
    path: PathBuf,
    max_bytes: Option<u64>,
    max_backups: Option<usize>,
) -> Result<(), std::io::Error> {
    let sink = RotatingLogSink::open(path, max_bytes, max_backups)?;
    if let Ok(mut guard) = FILE_SINK.lock() {
        *guard = Some(sink);
    }
    Ok(())
}

/// Sets the active subcommand name for correlation in subsequent records.
pub fn set_active_subcommand(subcommand: &str) {
    if let Ok(mut guard) = ACTIVE_SUBCOMMAND.lock() {
        *guard = Some(subcommand.to_string());
    }
}

/// Retrieves the active subcommand name if registered.
pub fn active_subcommand() -> Option<String> {
    ACTIVE_SUBCOMMAND
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

/// Writes one diagnostic record to the passive file sink and to stderr if appropriate.
pub fn emit(level: LogLevel, target: &str, message: &str) {
    emit_with(current_threshold(), level, target, message);
}

/// Writes one diagnostic record, honouring an explicit threshold instead of the process one.
///
/// Provided so a caller whose verbosity is not the process's can be tested without configuring a
/// global. That is the only way to assert "a debug record under a warn threshold writes nothing"
/// reliably: with a shared global, a parallel test raising the level makes the assertion pass or
/// fail depending on scheduling rather than on the code.
pub fn emit_with(threshold: Threshold, level: LogLevel, target: &str, message: &str) {
    if !threshold.admits(level) {
        return;
    }

    let clean = sanitize_sensitive_tokens(message);
    let (rule_id, _) = split_rule_id(&clean);

    if let Ok(mut guard) = FILE_SINK.lock() {
        if let Some(ref mut sink) = *guard {
            let record = DiagnosticRecord {
                timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
                level: level.as_str().to_ascii_uppercase(),
                target: target.to_string(),
                event: None,
                trace_id: trace_id().to_string(),
                pid: std::process::id(),
                edition: Edition::CURRENT.as_str().to_string(),
                subcommand: active_subcommand(),
                message: clean.clone(),
                rule_id: rule_id.map(str::to_string),
                attributes: None,
            };
            if let Ok(json_line) = serde_json::to_string(&record) {
                let _ = sink.append_line(&json_line);
            }
        }
    }

    if is_diagnostic_mode() || level >= LogLevel::Warn {
        eprintln!("taxis[{}] {target}: {clean}", level.as_str());
    }
}

/// Records an explicit structured audit event to the file sink and terminal (if diagnostic mode is active).
///
/// Unlike [`emit`], this entry point is *not* gated by the severity threshold. The two serve
/// different purposes and conflating them was a mistake worth naming: [`emit`] carries ambient
/// narration whose volume the operator chooses, while this function records a decision the system
/// made — a rejection, a bypass, a governance outcome. Suppressing those under `--log-level off`
/// would let verbosity silently erase the audit trail, leaving a reader unable to tell "nothing
/// happened" apart from "it happened and was hidden". Terminal echo is still gated by diagnostic
/// mode, so the default run stays quiet while the durable record stays complete.
pub fn record_event(
    level: LogLevel,
    target: &str,
    event: &str,
    message: &str,
    rule_id: Option<&str>,
    attributes: Option<serde_json::Value>,
) {
    let clean = sanitize_sensitive_tokens(message);
    let effective_rule = rule_id.or_else(|| split_rule_id(&clean).0);

    if let Ok(mut guard) = FILE_SINK.lock() {
        if let Some(ref mut sink) = *guard {
            let record = DiagnosticRecord {
                timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true),
                level: level.as_str().to_ascii_uppercase(),
                target: target.to_string(),
                event: Some(event.to_string()),
                trace_id: trace_id().to_string(),
                pid: std::process::id(),
                edition: Edition::CURRENT.as_str().to_string(),
                subcommand: active_subcommand(),
                message: clean.clone(),
                rule_id: effective_rule.map(str::to_string),
                attributes,
            };
            if let Ok(json_line) = serde_json::to_string(&record) {
                let _ = sink.append_line(&json_line);
            }
        }
    }

    if is_diagnostic_mode() {
        if let Some(r) = effective_rule {
            eprintln!(
                "taxis[{}] {target} [{event}] [{r}]: {clean}",
                level.as_str()
            );
        } else {
            eprintln!("taxis[{}] {target} [{event}]: {clean}", level.as_str());
        }
    }
}

/// Emits a trace record when the threshold allows it.
#[macro_export]
macro_rules! diag_trace {
    ($target:expr, $($arg:tt)*) => {
        if $crate::diagnostics::enabled($crate::diagnostics::LogLevel::Trace) {
            $crate::diagnostics::emit(
                $crate::diagnostics::LogLevel::Trace,
                $target,
                &format!($($arg)*),
            );
        }
    };
}

/// Emits a debug record when the threshold allows it.
#[macro_export]
macro_rules! diag_debug {
    ($target:expr, $($arg:tt)*) => {
        if $crate::diagnostics::enabled($crate::diagnostics::LogLevel::Debug) {
            $crate::diagnostics::emit(
                $crate::diagnostics::LogLevel::Debug,
                $target,
                &format!($($arg)*),
            );
        }
    };
}

/// Emits an info record when the threshold allows it.
#[macro_export]
macro_rules! diag_info {
    ($target:expr, $($arg:tt)*) => {
        if $crate::diagnostics::enabled($crate::diagnostics::LogLevel::Info) {
            $crate::diagnostics::emit(
                $crate::diagnostics::LogLevel::Info,
                $target,
                &format!($($arg)*),
            );
        }
    };
}

/// Emits a warning record when the threshold allows it.
#[macro_export]
macro_rules! diag_warn {
    ($target:expr, $($arg:tt)*) => {
        if $crate::diagnostics::enabled($crate::diagnostics::LogLevel::Warn) {
            $crate::diagnostics::emit(
                $crate::diagnostics::LogLevel::Warn,
                $target,
                &format!($($arg)*),
            );
        }
    };
}

/// Emits an error record when the threshold allows it.
#[macro_export]
macro_rules! diag_error {
    ($target:expr, $($arg:tt)*) => {
        if $crate::diagnostics::enabled($crate::diagnostics::LogLevel::Error) {
            $crate::diagnostics::emit(
                $crate::diagnostics::LogLevel::Error,
                $target,
                &format!($($arg)*),
            );
        }
    };
}

/// Guard that serialises tests which mutate the process-wide threshold.
///
/// Process-wide state and parallel tests do not mix: while one test holds the threshold at `Debug`,
/// another asserting "a debug record under a warning threshold is rejected" reads the raised value
/// and fails. The lock is exported rather than declared in each test file so the exclusion is
/// genuinely process-wide; a per-file lock, which is what existed before, only serialises the tests
/// that happen to live in the same file.
///
/// It is a normal function rather than `#[cfg(test)]` because the integration suites live in other
/// crates and cannot see an item gated to this crate's own tests.
pub fn threshold_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: Mutex<()> = Mutex::new(());
    // A poisoned lock means another test panicked while holding it. The state it protected is a
    // single atomic, so recovering is safe and refusing to run would turn one failure into many.
    GUARD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_names_round_trip() {
        for name in ["trace", "debug", "info", "warn", "error", "off"] {
            let parsed = LogLevel::parse_str(name).expect("every documented name must parse");
            assert_eq!(parsed.as_str(), name);
        }
    }

    #[test]
    fn unknown_level_name_is_rejected() {
        assert!(LogLevel::parse_str("verbose").is_none());
        assert!(LogLevel::parse_str("").is_none());
    }

    #[test]
    fn a_threshold_value_gates_lower_severities() {
        // Asserted on the value, not on the process global. This is the property the global
        // threshold has; testing it through the global is what made the assertion depend on
        // whichever other test happened to run at the same time.
        let threshold = Threshold::at(LogLevel::Info);
        assert!(!threshold.admits(LogLevel::Trace));
        assert!(!threshold.admits(LogLevel::Debug));
        assert!(threshold.admits(LogLevel::Info));
        assert!(threshold.admits(LogLevel::Error));
    }

    #[test]
    fn an_off_threshold_admits_nothing() {
        let threshold = Threshold::at(LogLevel::Off);
        for level in [
            LogLevel::Trace,
            LogLevel::Debug,
            LogLevel::Info,
            LogLevel::Warn,
            LogLevel::Error,
        ] {
            assert!(
                !threshold.admits(level),
                "{level:?} must be silent under off"
            );
        }
    }

    #[test]
    fn the_process_global_still_reports_what_was_set() {
        // The global remains part of the contract, so one test pins it — behind the process-wide
        // guard, which is what makes the pin stable while other tests run in parallel.
        let _guard = threshold_guard();
        let previous = set_level(LogLevel::Debug);
        assert_eq!(level(), LogLevel::Debug);
        assert_eq!(current_threshold(), Threshold::at(LogLevel::Debug));
        assert!(enabled(LogLevel::Debug));
        set_level(previous);
    }
}
