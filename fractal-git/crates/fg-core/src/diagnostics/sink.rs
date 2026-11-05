//! Module: fg-core::diagnostics::sink — Rotating File Log Sink
//! File Path: crates/fg-core/src/diagnostics/sink.rs
//! Architecture Role: Manages persistent JSONL log writing and automated size-capped file rotation.
//! Dependencies & Triggers: Consumed by fg-core::diagnostics.
//! Responsibilities: File append, disk quota protection, and rotation backup maintenance.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// Default maximum log file size before rotation: 5 MiB.
pub const DEFAULT_MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// Default maximum number of rotated backups retained.
pub const DEFAULT_MAX_BACKUPS: usize = 3;

/// Rotating file sink that appends lines to a log file and automatically
/// rotates old log files when the capacity ceiling is reached.
pub struct RotatingLogSink {
    file_path: PathBuf,
    max_bytes: u64,
    max_backups: usize,
    current_size: u64,
}

impl RotatingLogSink {
    /// Opens or creates the log file at `file_path`.
    pub fn open(
        file_path: PathBuf,
        max_bytes: Option<u64>,
        max_backups: Option<usize>,
    ) -> Result<Self, std::io::Error> {
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let current_size = fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            file_path,
            max_bytes: max_bytes.unwrap_or(DEFAULT_MAX_LOG_BYTES),
            max_backups: max_backups.unwrap_or(DEFAULT_MAX_BACKUPS),
            current_size,
        })
    }

    /// Rotates existing backup files when file size exceeds the ceiling.
    fn rotate_if_needed(&mut self, next_write_len: usize) -> Result<(), std::io::Error> {
        if self.current_size + (next_write_len as u64) <= self.max_bytes {
            return Ok(());
        }

        let base_str = self.file_path.to_string_lossy().to_string();
        for idx in (1..=self.max_backups).rev() {
            let current = PathBuf::from(format!("{base_str}.{idx}"));
            if idx == self.max_backups {
                if current.is_file() {
                    let _ = fs::remove_file(&current);
                }
            } else {
                let next = PathBuf::from(format!("{base_str}.{}", idx + 1));
                if current.is_file() {
                    let _ = fs::rename(&current, &next);
                }
            }
        }
        let backup_1 = PathBuf::from(format!("{base_str}.1"));
        if self.file_path.is_file() {
            let _ = fs::rename(&self.file_path, &backup_1);
        }
        self.current_size = 0;
        Ok(())
    }

    /// Appends one line to the log file.
    pub fn append_line(&mut self, line: &str) -> Result<(), std::io::Error> {
        let line_bytes_len = line.len() + 1;
        let _ = self.rotate_if_needed(line_bytes_len);

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)?;
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
        self.current_size += line_bytes_len as u64;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotating_file_sink_rotates_on_capacity_exceeded() {
        let base = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("target")
            .join("test_tmp");
        let _ = fs::create_dir_all(&base);
        let tmp = base.join(format!(
            "taxis_sink_test_{}_{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("create test tmp");
        let log_file = tmp.join("test.jsonl");

        let mut sink = RotatingLogSink::open(log_file.clone(), Some(80), Some(2))
            .expect("open rotating sink");

        sink.append_line("{\"msg\":\"first log line that takes some space 12345\"}")
            .expect("write 1");
        assert!(log_file.is_file());

        sink.append_line("{\"msg\":\"second log line that triggers rotation 67890\"}")
            .expect("write 2");

        let backup_1 = tmp.join("test.jsonl.1");
        assert!(backup_1.is_file(), "backup 1 must exist after rotation");

        let _ = fs::remove_dir_all(&tmp);
    }
}
