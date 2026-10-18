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
