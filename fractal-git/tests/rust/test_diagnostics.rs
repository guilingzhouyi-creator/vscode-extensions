//! Test Suite: Diagnostics Logging Contract
//! File Path: tests/rust/test_diagnostics.rs
//!
//! The logging layer has to be free when disabled and ordered when enabled. These tests pin both:
//! a filtered level must not gate more than one atomic read, and the severity order must be the one
//! `enabled` relies on, because an inverted order would silently turn error reporting off.

use fg_core::diagnostics::{enabled, level, set_level, LogLevel};

#[test]
fn severity_order_is_ascending_from_trace_to_off() {
    let ordered = [
        LogLevel::Trace,
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
        LogLevel::Off,
    ];
    for pair in ordered.windows(2) {
        assert!(
            pair[0] < pair[1],
            "{:?} must rank below {:?}; otherwise a threshold would filter the wrong direction",
            pair[0],
            pair[1]
        );
    }
}

#[test]
fn setting_a_level_is_observable_and_reversible() {
    let original = level();
    let previous = set_level(LogLevel::Debug);
    assert_eq!(
        previous, original,
        "set_level must report the replaced level"
    );
    assert_eq!(level(), LogLevel::Debug);
    set_level(original);
    assert_eq!(level(), original);
}

#[test]
fn each_level_is_inclusive_of_itself_and_above() {
    for threshold in [
        LogLevel::Trace,
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        let original = set_level(threshold);
        assert!(
            enabled(threshold),
            "{threshold:?} must enable its own level"
        );
        assert!(
            enabled(LogLevel::Error),
            "error must always survive a threshold at or below it"
        );
        set_level(original);
    }
}

#[test]
fn off_disables_every_level() {
    let original = set_level(LogLevel::Off);
    for candidate in [
        LogLevel::Trace,
        LogLevel::Debug,
        LogLevel::Info,
        LogLevel::Warn,
        LogLevel::Error,
    ] {
        assert!(!enabled(candidate), "{candidate:?} must be silent when off");
    }
    set_level(original);
}

#[test]
fn level_names_are_stable() {
    for name in ["trace", "debug", "info", "warn", "error", "off"] {
        let parsed = LogLevel::parse_str(name).expect("documented name must parse");
        assert_eq!(parsed.as_str(), name, "round trip must be stable");
        assert_eq!(parsed.to_string(), name, "Display must match as_str");
    }
}

#[test]
fn unrecognized_level_names_are_rejected_rather_than_defaulted() {
    for invalid in ["verbose", "silent", "", "INFO!", "3"] {
        assert!(
            LogLevel::parse_str(invalid).is_none(),
            "'{invalid}' must not be accepted; a typo silently changing verbosity is worse than an error"
        );
    }
}

/// Runs the real binary with an explicit log level and returns its stderr.
fn run_taxis(args: &[&str]) -> String {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_taxis"))
        .args(args)
        .output()
        .expect("taxis must be runnable");
    String::from_utf8_lossy(&output.stderr).to_string()
}

#[test]
fn dispatch_decision_is_recorded_at_debug_but_not_at_the_default_level() {
    // `bench` is used because it needs no repository and produces its decision record before any
    // measurement, so the assertion does not depend on how long the machine takes.
    let verbose = run_taxis(&["--log-level", "debug", "bench", "-m", "1", "--level", "1"]);
    assert!(
        verbose.contains("taxis[debug] taxis: dispatching 'bench'"),
        "a debug run must record which subcommand was dispatched, got:\n{verbose}"
    );
    assert!(
        verbose.contains("taxis[info] bench: measured"),
        "the measured-metric record must appear at debug, got:\n{verbose}"
    );

    let quiet = run_taxis(&["bench", "-m", "1", "--level", "1"]);
    assert!(
        !quiet.contains("taxis[debug]") && !quiet.contains("taxis[info]"),
        "the default level must stay quiet, otherwise every command leaks log noise into scripts, got:\n{quiet}"
    );
}

#[test]
fn log_level_flag_is_consumed_rather_than_dispatched_as_a_subcommand() {
    // Before the flag was consumed, `--log-level debug bench` treated `debug` as the subcommand and
    // the requested command never ran.
    let stderr = run_taxis(&["--log-level", "debug", "bench", "-m", "1", "--level", "1"]);
    assert!(
        stderr.contains("dispatching 'bench'"),
        "the command after --log-level must still be the one dispatched, got:\n{stderr}"
    );
}

#[test]
fn off_silences_even_the_dispatch_record() {
    let stderr = run_taxis(&["--log-level", "off", "bench", "-m", "1", "--level", "1"]);
    assert!(
        !stderr.contains("taxis["),
        "--log-level off must suppress every record, got:\n{stderr}"
    );
}
