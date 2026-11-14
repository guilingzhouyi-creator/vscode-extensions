//! Integration Test: Multi-Hash OID Evolution and Transport Subsystem
//! Path: tests/rust/test_multihash_and_transport.rs

use fg_core::models::{HashAlgorithm, Oid, TypedOid};
use fg_transport::{
    validate_ipc_frame_bounds, validate_packetline_bounds, validate_protocol_version,
    IpcDaemonReceipt, IpcMessage, MockTransport, PacketLine, ProtocolV2Handler, RemoteRef,
    RemoteTransport, SmartV2Command,
};

#[test]
fn test_multihash_oid_lifecycle_and_zero_truncation() {
    let sha1_raw = [0x42u8; 20];
    let oid_sha1 = Oid::from_bytes(sha1_raw);
    assert_eq!(oid_sha1.algorithm(), HashAlgorithm::Sha1);
    assert_eq!(oid_sha1.as_bytes().len(), 20);
    assert_eq!(oid_sha1.to_hex().len(), 40);

    let sha256_raw = [0x7au8; 32];
    let oid_sha256 = Oid::from_sha256(sha256_raw);
    assert_eq!(oid_sha256.algorithm(), HashAlgorithm::Sha256);
    assert_eq!(oid_sha256.as_slice().len(), 32);
    assert_eq!(oid_sha256.to_hex().len(), 64);

    let sm3_raw = [0xa5u8; 32];
    let oid_sm3 = Oid::from_sm3(sm3_raw);
    assert_eq!(oid_sm3.algorithm(), HashAlgorithm::Sm3);
    assert_eq!(oid_sm3.as_slice().len(), 32);
    assert_eq!(oid_sm3.to_hex().len(), 64);

    // Assert zero-truncation: full 32 bytes preserved in digest
    assert_eq!(oid_sm3.as_slice(), &sm3_raw);
    assert_eq!(oid_sm3.as_bytes(), &sm3_raw[..20]);

    // TypedOid bidirectional conversion
    let typed = TypedOid::from(oid_sm3);
    assert_eq!(typed.algorithm(), HashAlgorithm::Sm3);
    let converted_back = Oid::from(typed);
    assert_eq!(converted_back, oid_sm3);
}

#[test]
fn test_smart_v2_request_parsing_and_binary_sideband() {
    // 1. LS-REFS command
    let mut ls_refs_buf = Vec::new();
    ls_refs_buf.extend_from_slice(&PacketLine::encode_line("command=ls-refs\n"));
    ls_refs_buf.extend_from_slice(&PacketLine::encode_line("agent=taxis/0.1.0\n"));
    ls_refs_buf.extend_from_slice(&PacketLine::delim());
    ls_refs_buf.extend_from_slice(&PacketLine::encode_line("symrefs\n"));
    ls_refs_buf.extend_from_slice(&PacketLine::encode_line("ref-prefix refs/heads/\n"));
    ls_refs_buf.extend_from_slice(&PacketLine::flush());

    let req = ProtocolV2Handler::parse_request(&ls_refs_buf).expect("parse ls-refs");
    assert_eq!(req.agent.as_deref(), Some("taxis/0.1.0"));
    match req.command {
        SmartV2Command::LsRefs {
            symrefs,
            prefixes,
            peel,
        } => {
            assert!(symrefs && !peel);
            assert_eq!(prefixes, vec!["refs/heads/"]);
        }
        _ => panic!("unexpected command variant"),
    }

    // 2. Fetch command
    let mut fetch_buf = Vec::new();
    fetch_buf.extend_from_slice(&PacketLine::encode_line("command=fetch\n"));
    fetch_buf.extend_from_slice(&PacketLine::delim());
    fetch_buf.extend_from_slice(&PacketLine::encode_line(
        "want 1111111111111111111111111111111111111111\n",
    ));
    fetch_buf.extend_from_slice(&PacketLine::encode_line(
        "have 2222222222222222222222222222222222222222\n",
    ));
    fetch_buf.extend_from_slice(&PacketLine::encode_line("done\n"));
    fetch_buf.extend_from_slice(&PacketLine::flush());

    let fetch_req = ProtocolV2Handler::parse_request(&fetch_buf).expect("parse fetch");
    match fetch_req.command {
        SmartV2Command::Fetch {
            wants, haves, done, ..
        } => {
            assert_eq!(wants.len(), 1);
            assert_eq!(haves.len(), 1);
            assert!(done);
        }
        _ => panic!("unexpected fetch variant"),
    }

    // 3. Binary sideband multiplexing
    let payload = b"packfile-binary-stream-payload";
    let sideband_packet = PacketLine::encode_sideband(1, payload);
    let decoded_frames = PacketLine::decode_binary(&sideband_packet).expect("decode sideband");
    assert_eq!(decoded_frames.len(), 1);
    assert_eq!(decoded_frames[0][0], 1);
    assert_eq!(&decoded_frames[0][1..], payload);
}

#[test]
fn test_transport_remote_mock_and_bounds() {
    let mut mock = MockTransport::new("mock://upstream")
        .with_refs(vec![RemoteRef {
            name: "refs/heads/main".to_string(),
            target: Oid::from_bytes([0x11; 20]),
        }])
        .with_fetch_payload(b"PACK_DATA".to_vec());

    assert_eq!(mock.url(), "mock://upstream");
    let refs = mock.list_refs().expect("list refs");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "refs/heads/main");

    let push_res = mock.push(
        &[(
            "refs/heads/main".to_string(),
            Oid::from_bytes([0x22; 20]),
            None,
        )],
        None,
    );
    assert!(push_res.is_ok());
    assert_eq!(mock.recorded_pushes.len(), 1);

    // Bounds checking
    assert!(validate_protocol_version(1).is_ok());
    assert!(validate_protocol_version(2).is_ok());
    assert!(validate_protocol_version(3).is_err());
    assert!(validate_packetline_bounds(100).is_ok());
    assert!(validate_packetline_bounds(3).is_err());
    assert!(validate_ipc_frame_bounds(1024).is_ok());
    assert!(validate_ipc_frame_bounds(0).is_err());
}

#[test]
fn test_ipc_serialization_roundtrip() {
    let msg = IpcMessage::Ping {
        timestamp_ms: 123456789,
    };
    let json = serde_json::to_string(&msg).expect("serialize ipc ping");
    let parsed: IpcMessage = serde_json::from_str(&json).expect("deserialize ipc ping");
    assert_eq!(parsed, msg);

    let receipt = IpcDaemonReceipt {
        command: "ping".into(),
        ok: true,
        latency_us: 42,
        cache_generation: 1,
        cache_hit: true,
        tree_oid: None,
        commit_oid: None,
        target_ref: None,
        entry_count: 0,
        entries: Vec::new(),
        detail: "pong".into(),
    };
    let receipt_json = serde_json::to_string(&receipt).expect("serialize receipt");
    let parsed_receipt: IpcDaemonReceipt =
        serde_json::from_str(&receipt_json).expect("deserialize receipt");
    assert_eq!(parsed_receipt, receipt);
}
