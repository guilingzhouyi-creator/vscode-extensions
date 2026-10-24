//! Unit Test: Self-Hosted Server Protocol & IPC Frames
//! File Path: tests/rust/test_self_hosted_ipc.rs

use fractal_git::server::{IpcCodec, IpcMessage, PacketLine};

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
    // "000eversion 2\n" -> 14 bytes (0x000e)
    assert_eq!(&raw[..4], b"000e");

    let lines = PacketLine::decode(&raw).expect("Packet line decode should succeed");
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0], "version 2");
}

#[test]
fn test_git_packet_line_control_packets_are_not_panics() {
    // A delimiter packet is legal wire input and must not be treated as a negative payload slice.
    let mut stream = PacketLine::delim();
    stream.extend_from_slice(&PacketLine::encode_line("after-delim\n"));
    let lines = PacketLine::decode(&stream).expect("delimiter packets must decode cleanly");
    assert_eq!(lines, vec!["after-delim".to_string()]);

    // 0003 is reserved by the protocol; it must surface as an error, not as a panic.
    let reserved = PacketLine::decode(b"0003").expect_err("reserved length must be rejected");
    assert!(reserved.to_string().contains("0003"));

    // A frame that announces more bytes than the buffer holds stays a descriptive error.
    let truncated = PacketLine::decode(b"0010abc").expect_err("truncated frame must be rejected");
    assert!(truncated.to_string().contains("Truncated"));
}
