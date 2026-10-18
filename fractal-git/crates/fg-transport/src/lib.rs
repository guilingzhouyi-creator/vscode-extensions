//! Module: fg-transport — Wire Transport and Agent IPC Facade
//! File Path: crates/fg-transport/src/lib.rs
//! Architecture Role: Communication transport subsystem for Fractal Git, containing
//!   standard Git pkt-line wire protocol, Smart Protocol v2 handler, and local Agent IPC.

pub mod ipc;
pub mod packetline;
pub mod smart_protocol;

pub use ipc::{IpcCodec, IpcMessage};
pub use packetline::{PacketLine, PKT_DELIM, PKT_FLUSH};
pub use smart_protocol::ProtocolV2Handler;
