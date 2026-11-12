//! Module: taxis_cmd::daemon — Protocol Daemon & IPC Handler
//! File Path: src/bin/taxis_cmd/daemon.rs
//! Architecture Role: Reports the live status of the in-process IPC codec and protocol handlers,
//!   and serves stateful Agent IPC requests against a warm in-memory `DaemonHotSession`.
//! Dependencies & Triggers: Dispatched by `taxis daemon` / `taxis serve`.
//! Responsibilities: Probes IPC frame codec, PacketLine smart protocol v2, and CAS bus status;
//!   executes `--request`, `--once`, and `--serve` loopback IPC sessions.
//! Exit Semantics & Design Rationale:
//!   - Executes live round-trip encode/decode probes across transport layers when invoked with no flags.
//!   - Exits 0 if all protocol codecs or IPC requests succeed; exits non-zero on failure.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TRN-001`: Network transport and framing guard

use std::io::{Read, Write};
use std::net::TcpListener;

use fractal_git::constants::cli::CliTag;
use fractal_git::server::{IpcDaemonReceipt, IpcStageEntry};
use fractal_git::{IpcCodec, IpcMessage, PacketLine};

use super::common::{fail_io, find_arg_value, print_json, reject, CliContext};

#[path = "daemon_runtime.rs"]
pub mod daemon_runtime;

pub use daemon_runtime::DaemonHotSession;

/// Dispatches `taxis daemon` / `taxis serve` across probe, `--request`, `--once`, and `--serve` modes.
pub fn handle_daemon(ctx: &CliContext) {
    if let Some(raw_request) = find_arg_value(&ctx.args, &["--request"]) {
        handle_daemon_request(ctx, raw_request);
        return;
    }
    if ctx.args.iter().any(|arg| arg == "--once") {
        handle_daemon_once(ctx);
        return;
    }
    if ctx.args.iter().any(|arg| arg == "--serve") {
        handle_daemon_serve(ctx);
        return;
    }
    handle_daemon_probe(ctx);
}

fn handle_daemon_probe(ctx: &CliContext) {
    let ipc_round_trip_ok = probe_ipc_round_trip();
    let packetline_ok = probe_packetline_framing();
    let _warm = DaemonHotSession::open(&ctx.git_dir).entry_count();

    if ctx.json_mode {
        let daemon_payload = serde_json::json!({
            "engine": "taxis",
            "operation": "daemon",
            "ipc_frame_codec": if ipc_round_trip_ok { "READY" } else { "FAIL" },
            "smart_protocol_v2": if packetline_ok { "READY" } else { "FAIL" },
            "cas_bus": "STANDBY"
        });
        print_json(&daemon_payload);
        if !(ipc_round_trip_ok && packetline_ok) {
            std::process::exit(1);
        }
        return;
    }

    println!("=== Taxis Native Protocol Daemon ===");
    println!("Supported Protocols:");
    println!(
        "  - IPC Frame (4-byte length prefix) : {}",
        if ipc_round_trip_ok { "READY" } else { "FAIL" }
    );
    println!(
        "  - Smart Protocol v2 (PacketLine)   : {}",
        if packetline_ok { "READY" } else { "FAIL" }
    );
    println!("  - taxis:// In-Memory CAS Bus       : STANDBY");

    if !(ipc_round_trip_ok && packetline_ok) {
        std::process::exit(1);
    }
}

fn handle_daemon_request(ctx: &CliContext, raw_request: &str) {
    let mut session = DaemonHotSession::open(&ctx.git_dir);
    if let Ok(batch) = serde_json::from_str::<Vec<IpcMessage>>(raw_request) {
        let receipts: Vec<IpcDaemonReceipt> =
            batch.iter().map(|msg| session.execute(msg)).collect();
        let all_ok = receipts.iter().all(|r| r.ok);
        print_json(&receipts);
        if !all_ok {
            std::process::exit(1);
        }
        return;
    }
    let single_msg: IpcMessage = serde_json::from_str(raw_request).unwrap_or_else(|err| {
        reject(
            CliTag::ERROR,
            format!("invalid daemon --request JSON: {err}"),
        )
    });
    let receipt = session.execute(&single_msg);
    print_json(&receipt);
    if !receipt.ok {
        std::process::exit(1);
    }
}

fn handle_daemon_once(ctx: &CliContext) {
    let mut input_bytes = Vec::new();
    if let Err(err) = std::io::stdin().read_to_end(&mut input_bytes) {
        fail_io("read daemon stdin frame", err);
    }
    let mut session = DaemonHotSession::open(&ctx.git_dir);
    let (decoded_list, _) = match IpcCodec::decode_stream(&input_bytes) {
        Ok(list) if !list.0.is_empty() => list,
        _ => match serde_json::from_slice::<IpcMessage>(&input_bytes) {
            Ok(single) => (vec![single], input_bytes.len()),
            Err(err) => reject(CliTag::ERROR, format!("invalid IPC frame on stdin: {err}")),
        },
    };
    let mut stdout = std::io::stdout();
    for msg in &decoded_list {
        let receipt = session.execute(msg);
        emit_receipt(&mut stdout, &receipt, ctx.json_mode);
    }
}

fn emit_receipt(stdout: &mut impl Write, receipt: &IpcDaemonReceipt, json_mode: bool) {
    if json_mode {
        print_json(receipt);
    } else if let Ok(encoded) = IpcCodec::encode(&IpcMessage::DaemonReceipt {
        receipt: receipt.clone(),
    }) {
        let _ = stdout.write_all(&encoded);
        let _ = stdout.flush();
    }
}

fn handle_daemon_serve(ctx: &CliContext) {
    let bind_addr = find_arg_value(&ctx.args, &["--addr"]).unwrap_or("127.0.0.1:0");
    let max_reqs = find_arg_value(&ctx.args, &["--max-requests"])
        .and_then(|val| val.parse::<usize>().ok())
        .unwrap_or(1);
    let listener = TcpListener::bind(bind_addr)
        .unwrap_or_else(|err| fail_io("bind daemon loopback listener", err));
    let mut session = DaemonHotSession::open(&ctx.git_dir);
    for _ in 0..max_reqs {
        serve_one_connection(&listener, &mut session);
    }
}

fn serve_one_connection(listener: &TcpListener, session: &mut DaemonHotSession) {
    if let Ok((mut stream, _)) = listener.accept() {
        let mut buf = Vec::new();
        let _ = stream.read_to_end(&mut buf);
        if let Ok(Some((msg, _))) = IpcCodec::decode(&buf) {
            let receipt = session.execute(&msg);
            emit_receipt(&mut stream, &receipt, false);
        }
    }
}

/// Encodes and decodes a probe IPC frame, confirming the codec round-trips.
fn probe_ipc_round_trip() -> bool {
    let probe = IpcMessage::Stage {
        entries: vec![IpcStageEntry {
            path: "probe.txt".to_owned(),
            mode: "100644".to_owned(),
            content: Some("probe".to_owned()),
            oid: None,
        }],
    };
    match IpcCodec::encode(&probe) {
        Ok(frame) => match IpcCodec::decode(&frame) {
            Ok(Some((decoded, consumed))) => decoded == probe && consumed == frame.len(),
            _ => false,
        },
        Err(_) => false,
    }
}

/// Encodes and decodes a probe packet-line frame, confirming the framing round-trips.
fn probe_packetline_framing() -> bool {
    let frame = PacketLine::encode_line("probe");
    match PacketLine::decode(&frame) {
        Ok(lines) => lines.len() == 1 && lines[0] == "probe",
        Err(_) => false,
    }
}
