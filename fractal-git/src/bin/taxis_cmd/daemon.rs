//! Module: taxis_cmd::daemon — Protocol Daemon & IPC Handler
//! File Path: src/bin/taxis_cmd/daemon.rs
//! Architecture Role: Reports the live status of the in-process IPC codec and protocol handlers.
//! Dependencies & Triggers: Dispatched by `taxis daemon` / `taxis serve`.
//! Responsibilities: Probes IPC frame codec, PacketLine smart protocol v2, and CAS bus status.
//! Exit Semantics & Design Rationale:
//!   - Executes live round-trip encode/decode probes across transport layers.
//!   - Exits 0 if all protocol codecs round-trip successfully; exits 1 on failure.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TRN-001`: Network transport and framing guard

use fractal_git::{IpcCodec, IpcMessage, PacketLine};

use super::common::{print_json, CliContext};

/// Reports the live status of the in-process IPC codec and protocol handlers.
pub fn handle_daemon(ctx: &CliContext) {
    let ipc_round_trip_ok = probe_ipc_round_trip();
    let packetline_ok = probe_packetline_framing();

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

/// Encodes and decodes a probe IPC frame, confirming the codec round-trips.
fn probe_ipc_round_trip() -> bool {
    let probe = IpcMessage::Ping { timestamp_ms: 0 };
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
