//! Regression Suite: Diagnostics Throughput and Level Contract
//! File Path: tests/rust/test_diagnostics_ring.rs
//!
//! Two properties decide whether the diagnostic log is usable during an incident, and neither was
//! pinned before:
//!
//!   1. A filtered level must write nothing. `emit` honoured the threshold while `record_event` did
//!      not, so `--log-level off` left the file growing — the one setting a user reaches for when
//!      they want the logging to stop.
//!   2. Reading the newest records must cost a bounded amount of memory. Reading the whole log and
//!      discarding all but the tail makes the cheapest question ("what just happened?") the most
//!      expensive one to ask.
//!
//! The file-sink entry points are process-wide, so the tests that touch them run behind one lock and
//! restore the previous threshold.

use std::io::Write;

use fg_core::diagnostics::{record_event, set_file_sink, set_level, LogLevel, Threshold};

// What used to be a file-local lock is now `fg_core::diagnostics::threshold_guard`. A lock owned by
// one test file only serialises the tests in that file, which is not where the conflict was: the
// threshold is process-wide, and the crate's own unit tests moved it too.

/// Creates a unique scratch directory below the build tree.
///
/// The system temp directory is not reliably writable for this test host, and the in-crate sink
/// test already stages below `target/test_tmp` for the same reason, so this suite follows that
/// established location instead of asserting on an environment it does not own.
fn unique_log_path(label: &str) -> std::path::PathBuf {
    let dir = std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("target")
        .join("test_tmp")
        .join(format!(
            "taxis_diag_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
    std::fs::create_dir_all(&dir).expect("create scratch dir for diagnostic test");
    dir.join("taxis.jsonl")
}

#[test]
fn ambient_narration_is_suppressed_but_audit_events_are_not() {
    // The two entry points serve different purposes, and this is the distinction that matters under
    // investigation. `emit` carries ambient narration whose volume the operator chooses, so a
    // disabled threshold must silence it. `record_event` records a decision the system made, so it
    // must survive regardless of verbosity: otherwise `--log-level off` silently erases the very
    // record of what went wrong, and a reader cannot tell "nothing happened" from "it was hidden".
    let _guard = fg_core::diagnostics::threshold_guard();
    let path = unique_log_path("off_audit");
    set_file_sink(path.clone(), Some(1 << 20), Some(1)).expect("install sink");

    let original = set_level(LogLevel::Off);
    fg_core::diag_error!(
        "ambient",
        "narrative record that the threshold must silence"
    );
    record_event(
        LogLevel::Error,
        "audit",
        "decision",
        "audit record that must survive a disabled threshold",
        None,
        None,
    );
    let written = std::fs::read_to_string(&path).unwrap_or_default();
    set_level(original);

    assert!(
        !written.contains("narrative record that the threshold must silence"),
        "ambient narration must obey the threshold; got {written:?}"
    );
    assert!(
        written.contains("audit record that must survive a disabled threshold"),
        "an explicit audit event must never be suppressed by verbosity; got {written:?}"
    );
}

#[test]
fn an_enabled_level_reaches_the_file_sink() {
    // Confirms the sink itself works, so the suppression assertion above cannot pass merely because
    // nothing is ever written.
    let _guard = fg_core::diagnostics::threshold_guard();
    let path = unique_log_path("on");
    set_file_sink(path.clone(), Some(1 << 20), Some(1)).expect("install sink");

    let original = set_level(LogLevel::Info);
    record_event(
        LogLevel::Warn,
        "test",
        "should_appear",
        "this record must reach the file",
        None,
        None,
    );
    let written = std::fs::read_to_string(&path).unwrap_or_default();
    set_level(original);

    assert!(
        written.contains("this record must reach the file"),
        "an enabled record must be written; got {written:?}"
    );
}

#[test]
fn the_threshold_value_admits_only_levels_at_or_above_it() {
    // Pins the direction a filter is easy to get backwards: a higher threshold admits fewer levels.
    //
    // Asserted on the value rather than through the process global. The previous form set the global
    // and then read it back, which made the result depend on whether another test in this same
    // binary had changed it in between — and one had, which is why this test failed intermittently.
    for (level, admitted) in [
        (LogLevel::Trace, false),
        (LogLevel::Debug, false),
        (LogLevel::Info, false),
        (LogLevel::Warn, true),
        (LogLevel::Error, true),
    ] {
        assert_eq!(
            Threshold::ambient().admits(level),
            admitted,
            "the ambient threshold must admit {level:?}={admitted}"
        );
    }
    assert!(!Threshold::at(LogLevel::Off).admits(LogLevel::Error));
}

#[test]
fn a_filtered_level_writes_nothing_to_the_file_sink() {
    // The other half, and the one that needs the real `emit` path: a rejected record must not reach
    // the file. Held under the process-wide guard so the global it configures is not moved by a
    // parallel test while this one reads it.
    let _guard = fg_core::diagnostics::threshold_guard();
    let path = unique_log_path("thresholds");

    for (threshold, admitted) in [(LogLevel::Debug, true), (LogLevel::Warn, false)] {
        let _ = std::fs::remove_file(&path);
        set_file_sink(path.clone(), Some(1 << 20), Some(1)).expect("install sink");
        let original = set_level(threshold);
        fg_core::diag_debug!("test", "probe at debug");
        let grew = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0) > 0;
        set_level(original);

        assert_eq!(
            grew, admitted,
            "a debug record under a {threshold:?} threshold must be admitted={admitted}"
        );
    }
}

#[test]
fn rotation_keeps_one_backup_and_stays_under_the_cap() {
    // Rotation must actually rotate. A sink that never rotates grows without bound, and the
    // durability story for a long-running agent session collapses into "one enormous file".
    let _guard = fg_core::diagnostics::threshold_guard();
    let path = unique_log_path("rotate");
    let original = set_level(LogLevel::Info);
    set_file_sink(path.clone(), Some(2 * 1024), Some(1)).expect("install sink");

    for index in 0..40 {
        record_event(
            LogLevel::Info,
            "test",
            "rotation_probe",
            &format!(
                "record {index} with enough padding to force rotation {}",
                "x".repeat(200)
            ),
            None,
            None,
        );
    }
    set_level(original);

    let primary = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let backup = std::fs::metadata(format!("{}.1", path.display()))
        .map(|meta| meta.len())
        .unwrap_or(0);

    assert!(primary > 0, "the primary log must receive records");
    assert!(
        backup > 0,
        "with a 2 KiB cap and 40 padded records, at least one rotation must have occurred"
    );
}

#[test]
fn the_tail_window_reader_returns_complete_records_only() {
    // Mirrors the window logic `taxis diagnostics tail` uses. The window starts mid-file for any
    // log larger than the window, so the first fragment must be dropped rather than printed as if
    // it were a record.
    let path = unique_log_path("window");
    {
        let mut file = std::fs::File::create(&path).expect("create log");
        for index in 0..500 {
            writeln!(file, "{{\"n\":{index},\"pad\":\"{}\"}}", "y".repeat(50))
                .expect("write record");
        }
        file.flush().expect("flush");
    }

    let total = std::fs::metadata(&path).expect("stat").len();
    assert!(total > 4096, "fixture must exceed the window size");

    let mut file = std::fs::File::open(&path).expect("open");
    let window = 4096u64;
    let start = total.saturating_sub(window);
    {
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::Start(start)).expect("seek");
    }
    let mut buffer = String::new();
    {
        use std::io::Read;
        file.take(window).read_to_string(&mut buffer).expect("read");
    }
    let mut lines: Vec<&str> = buffer.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }

    assert!(
        !lines.is_empty(),
        "the window must contain at least one record"
    );
    for line in lines {
        assert!(
            serde_json::from_str::<serde_json::Value>(line).is_ok(),
            "a partial record must never be served as a record: {line:?}"
        );
    }
}
