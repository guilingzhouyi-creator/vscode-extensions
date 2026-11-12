//! Unit Test: Self-Hosted Server Protocol & IPC Frames
//! File Path: tests/rust/test_self_hosted_ipc.rs

use std::io::Write;
use std::process::{Command, Stdio};

use fractal_git::server::{
    validate_ipc_frame_bounds, validate_packetline_bounds, validate_protocol_version, IpcCodec,
    IpcDaemonReceipt, IpcMessage, IpcStageEntry, PacketLine, IPC_PROTOCOL_VERSION,
    MAX_IPC_FRAME_PAYLOAD_BYTES, MAX_PKT_LINE_BYTES,
};

#[test]
fn test_ipc_codec_roundtrip() {
    let msg = IpcMessage::Ping {
        timestamp_ms: 1700000000123,
    };

    let frame = IpcCodec::encode(&msg).expect("Encoding should succeed");
    assert!(frame.len() > 4);

    let (decoded, consumed) = IpcCodec::decode(&frame)
        .expect("Decoding should succeed")
        .expect("Frame should be complete");

    assert_eq!(consumed, frame.len());
    assert_eq!(decoded, msg);
}

#[test]
fn test_git_packet_line_encode_decode() {
    let raw = PacketLine::encode_line("version 2\n");
    assert_eq!(&raw[..4], b"000e");

    let lines = PacketLine::decode(&raw).expect("Packet line decode should succeed");
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0], "version 2");
}

#[test]
fn test_git_packet_line_control_packets_are_not_panics() {
    let mut stream = PacketLine::delim();
    stream.extend_from_slice(&PacketLine::encode_line("after-delim\n"));
    let lines = PacketLine::decode(&stream).expect("delimiter packets must decode cleanly");
    assert_eq!(lines, vec!["after-delim".to_string()]);

    let reserved = PacketLine::decode(b"0003").expect_err("reserved length must be rejected");
    assert!(reserved.to_string().contains("0003"));

    let truncated = PacketLine::decode(b"0010abc").expect_err("truncated frame must be rejected");
    assert!(truncated.to_string().contains("Truncated"));
}

#[test]
fn test_transport_facade_and_stream_codec() {
    assert_eq!(validate_ipc_frame_bounds(64).expect("valid"), 64);
    assert!(validate_ipc_frame_bounds(0).is_err());
    assert!(validate_ipc_frame_bounds(MAX_IPC_FRAME_PAYLOAD_BYTES + 1).is_err());
    assert_eq!(
        validate_protocol_version(IPC_PROTOCOL_VERSION).expect("v1"),
        1
    );
    assert!(validate_protocol_version(0).is_err());
    assert!(validate_packetline_bounds(3).is_err());
    assert!(validate_packetline_bounds(MAX_PKT_LINE_BYTES + 1).is_err());

    let frames = vec![
        IpcMessage::Status {
            scope_prefix: Some("src".to_owned()),
        },
        IpcMessage::DiffSlice {
            scope_prefix: Some("src".to_owned()),
            base_oid: None,
            head_oid: None,
        },
    ];
    let mut wire = Vec::new();
    for msg in &frames {
        wire.extend_from_slice(&IpcCodec::encode(msg).expect("encode"));
    }
    let (decoded, consumed) = IpcCodec::decode_stream(&wire).expect("decode stream");
    assert_eq!((decoded, consumed), (frames, wire.len()));
}

#[test]
fn test_taxis_daemon_cli_hot_session_and_once_pipe() {
    let temp = tempfile::tempdir().expect("tempdir");
    let git_dir = temp.path().join(".git");
    std::fs::create_dir_all(&git_dir).expect("create .git");
    std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").expect("write HEAD");
    let taxis_bin = env!("CARGO_BIN_EXE_taxis");

    let probe_out = Command::new(taxis_bin)
        .args(["--git-dir", &git_dir.to_string_lossy(), "--json", "daemon"])
        .output()
        .expect("probe");
    assert!(probe_out.status.success());

    let batch = vec![
        IpcMessage::Ping { timestamp_ms: 1000 },
        IpcMessage::Stage {
            entries: vec![IpcStageEntry {
                path: "src/lib.rs".to_owned(),
                mode: "100644".to_owned(),
                content: Some("pub fn value() -> u32 { 7 }\n".to_owned()),
                oid: None,
            }],
        },
        IpcMessage::Status {
            scope_prefix: Some("src".to_owned()),
        },
        IpcMessage::DiffSlice {
            scope_prefix: Some("src".to_owned()),
            base_oid: None,
            head_oid: None,
        },
        IpcMessage::Commit {
            target_ref: "refs/fractal/cell/cell-ipc/card/card-ipc".to_owned(),
            parent_oids: Vec::new(),
            entries: Vec::new(),
            message: "feat(ipc): daemon commit\n".to_owned(),
            author_name: "Daemon Agent".to_owned(),
            author_email: "daemon@taxis.local".to_owned(),
            timestamp_sec: Some(1_700_000_000),
            tz_offset: Some("+0000".to_owned()),
        },
    ];
    let req_json = serde_json::to_string(&batch).expect("json");
    let batch_out = Command::new(taxis_bin)
        .args([
            "--git-dir",
            &git_dir.to_string_lossy(),
            "daemon",
            "--request",
            &req_json,
        ])
        .output()
        .expect("batch");
    assert!(batch_out.status.success());
    let receipts: Vec<IpcDaemonReceipt> =
        serde_json::from_slice(&batch_out.stdout).expect("receipts");
    assert_eq!(receipts.len(), 5);
    assert!(!receipts[0].cache_hit && receipts[1].cache_hit);
    assert_eq!(receipts[2].entries, vec!["src/lib.rs".to_owned()]);
    assert!(receipts[3].detail.contains("src/lib.rs"));
    let commit_oid = receipts[4].commit_oid.as_deref().expect("commit oid");
    let ref_disk =
        std::fs::read_to_string(git_dir.join("refs/fractal/cell/cell-ipc/card/card-ipc"))
            .expect("ref");
    assert_eq!(ref_disk.trim(), commit_oid);

    let frame = IpcCodec::encode(&IpcMessage::Ping { timestamp_ms: 42 }).expect("encode");
    let mut child = Command::new(taxis_bin)
        .args(["--git-dir", &git_dir.to_string_lossy(), "daemon", "--once"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(&frame)
        .expect("write");
    let once_out = child.wait_with_output().expect("wait");
    assert!(once_out.status.success());
    let (decoded, _) = IpcCodec::decode(&once_out.stdout)
        .expect("decode")
        .expect("frame");
    assert!(
        matches!(decoded, IpcMessage::DaemonReceipt { receipt } if receipt.ok && receipt.command == "ping")
    );
}
