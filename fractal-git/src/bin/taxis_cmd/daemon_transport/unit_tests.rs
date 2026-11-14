//! Module: taxis_cmd::daemon_transport — Unit Tests
//! File Path: src/bin/taxis_cmd/daemon_transport/unit_tests.rs
//! Architecture Role: Verifies Token-TCP HelloAuth verification and stale sentinel cleanup.
//! Dependencies & Triggers: Tests `read_authenticated_request`, `probe_daemon_alive`, and pause APIs.
//! Responsibilities: Guarantee constant-time rejection and crash-safe metadata cleanup.
//! Exit Semantics & Design Rationale: Uses ephemeral loopback TCP port drops without races.

#[cfg(test)]
mod tests {
    use std::net::TcpListener;

    use fractal_git::{IpcCodec, IpcMessage};

    use super::super::auth::generate_session_token_hex;
    use super::super::*;

    #[test]
    fn token_auth_rejects_mismatched_and_missing_hello() {
        let valid_token = generate_session_token_hex();
        let req_frame = IpcCodec::encode(&IpcMessage::QueryAuditStatus).expect("encode");

        let mut cursor_unauth = std::io::Cursor::new(req_frame.clone());
        assert!(read_authenticated_request(&mut cursor_unauth, &valid_token, true).is_err());

        let bad_hello = IpcCodec::encode(&IpcMessage::HelloAuth {
            token: String::from("wrong-token"),
        })
        .expect("encode bad");
        let mut combined_bad = Vec::new();
        combined_bad.extend_from_slice(&bad_hello);
        combined_bad.extend_from_slice(&req_frame);
        let mut cursor_bad = std::io::Cursor::new(combined_bad);
        assert!(read_authenticated_request(&mut cursor_bad, &valid_token, true).is_err());

        let good_hello = IpcCodec::encode(&IpcMessage::HelloAuth {
            token: valid_token.clone(),
        })
        .expect("encode good");
        let mut combined_good = Vec::new();
        combined_good.extend_from_slice(&good_hello);
        combined_good.extend_from_slice(&req_frame);
        let mut cursor_good = std::io::Cursor::new(combined_good);
        let decoded = read_authenticated_request(&mut cursor_good, &valid_token, true)
            .expect("decode auth")
            .expect("message");
        assert_eq!(decoded, IpcMessage::QueryAuditStatus);
    }

    #[test]
    fn stale_daemon_probe_returns_none_and_cleanup_removes_orphans() {
        let dir = tempfile::tempdir().expect("tempdir");
        let git_dir = dir.path().join(".git");
        let runtime_dir = resolve_taxis_runtime_dir(&git_dir);
        std::fs::create_dir_all(&runtime_dir).expect("mkdir");
        let dead_listener = TcpListener::bind("127.0.0.1:0").expect("ephemeral bind");
        let dead_addr = dead_listener.local_addr().expect("addr").to_string();
        drop(dead_listener);

        let stale_meta = DaemonRuntimeMeta {
            pid: 999_999,
            transport: String::from("tcp"),
            endpoint: dead_addr,
            token_hex: generate_session_token_hex(),
            manages_async_audit: true,
            started_at_ms: 1,
        };
        std::fs::write(
            runtime_dir.join(DAEMON_META_FILENAME),
            serde_json::to_vec(&stale_meta).expect("json"),
        )
        .expect("write stale meta");
        std::fs::write(runtime_dir.join(DAEMON_STOP_FILENAME), b"stop\n").expect("stop sentinel");

        assert!(probe_daemon_alive(&git_dir).is_none());
        cleanup_stale_daemon_files(&git_dir);
        assert!(!runtime_dir.join(DAEMON_META_FILENAME).exists());
        assert!(!runtime_dir.join(DAEMON_STOP_FILENAME).exists());

        set_audit_paused(&git_dir, true).expect("pause");
        assert!(is_audit_paused(&git_dir));
        set_audit_paused(&git_dir, false).expect("resume");
        assert!(!is_audit_paused(&git_dir));
    }
}
