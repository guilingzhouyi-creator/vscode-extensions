//! Module: fg-transport — Wire Transport and Agent IPC Facade
//! File Path: crates/fg-transport/src/lib.rs
//! Architecture Role: Communication transport subsystem for Fractal Git, containing
//!   standard Git pkt-line wire protocol, Smart Protocol v2 handler, and local Agent IPC.
//! Dependencies & Triggers: Consumed by Taxis CLI daemon and local Agent IPC runners.
//! Responsibilities: Wire packet-line codecs, Git Smart Protocol v2 framing, and IPC messages.
//! Exit Semantics & Design Rationale: Stream-based framing with deterministic error boundaries.
//!
//! Domain Governance Rules: FGT-TRN-001 (transport subsystem facade), FGT-COR-001.

pub mod ipc;
pub mod packetline;
pub mod remote;
pub mod smart_protocol;

pub use ipc::{IpcCodec, IpcMessage};
pub use packetline::{PacketLine, PKT_DELIM, PKT_FLUSH};
pub use remote::{LoopbackTransport, MockTransport, RemoteRef, RemoteTransport};
pub use smart_protocol::ProtocolV2Handler;
