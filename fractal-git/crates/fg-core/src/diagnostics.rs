//! Module: fg-core — Structured Diagnostic Logging
//! File Path: crates/fg-core/src/diagnostics.rs
//! Architecture Role: Emits structured, level-filtered diagnostics to stderr without adding a
//!   logging dependency to the kernel's lowest layer.
//! Dependencies \u0026 Triggers: Used by any subsystem that needs to explain what it decided. Configured
//!   once at CLI start-up from `--log-level` or `TAXIS_LOG`.
//! Responsibilities: Hold the process-wide severity threshold, format one record per event, and stay
//!   allocation-free when the event is filtered out.
//! Exit Semantics \u0026 Design Rationale: Diagnostics go to stderr and never to stdout, because stdout
//!   carries machine-readable command output and a stray log line would corrupt a JSON consumer.
//!   A disabled level costs one atomic load and no formatting, so a hot path can call `trace!`
//!   freely; formatting a message that is then discarded is the usual reason logging becomes the
//!   thing everyone turns off.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::sync::atomic::{AtomicU8, Ordering};

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

/// Process-wide severity threshold.
///
/// Defaults to `Warn` so a normal command stays quiet, and so enabling detail is a deliberate act
/// rather than an accident.
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
///
/// The flag wins so a single invocation can raise detail without changing the environment, which is
/// what a developer debugging one command actually wants.
pub fn configure(flag: Option<&str>) {
    let selected = flag.and_then(LogLevel::parse_str).or_else(|| {
        std::env::var("TAXIS_LOG")
            .ok()
            .and_then(|value| LogLevel::parse_str(&value))
    });
    if let Some(chosen) = selected {
        set_level(chosen);
    }
}

/// Whether a record at `level` would be emitted, checked before any formatting happens.
pub fn enabled(level: LogLevel) -> bool {
    level.rank() >= THRESHOLD.load(Ordering::Relaxed)
}

/// Writes one diagnostic record to stderr.
///
/// Kept as a free function taking a pre-rendered message so the macros below can guard the
/// formatting call behind [`enabled`].
pub fn emit(level: LogLevel, target: &str, message: &str) {
    eprintln!(
        "taxis[{}] {target}: {message}",
        level.as_str(),
        target = target,
        message = message
    );
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
    fn threshold_gates_lower_severities() {
        let previous = set_level(LogLevel::Info);
        assert!(!enabled(LogLevel::Trace));
        assert!(!enabled(LogLevel::Debug));
        assert!(enabled(LogLevel::Info));
        assert!(enabled(LogLevel::Error));
        set_level(previous);
    }

    #[test]
    fn off_silences_everything() {
        let previous = set_level(LogLevel::Off);
        for level in [
            LogLevel::Trace,
            LogLevel::Debug,
            LogLevel::Info,
            LogLevel::Warn,
            LogLevel::Error,
        ] {
            assert!(
                !enabled(level),
                "{level:?} must be silent when logging is off"
            );
        }
        set_level(previous);
    }
}
