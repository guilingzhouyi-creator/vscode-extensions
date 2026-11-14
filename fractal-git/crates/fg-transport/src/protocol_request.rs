//! Module: fg-transport — Git Smart Protocol v2 Request Parser
//! File Path: crates/fg-transport/src/protocol_request.rs
//! Architecture Role: Strongly-typed parser for Git wire protocol v2 client command envelopes.
//! Dependencies & Triggers: Consumed by Smart Protocol handlers and transport remotes.
//! Responsibilities: Parse packet-line streams into structured commands (`ls-refs`, `fetch`).
//! Exit Semantics & Design Rationale: Stream-based parsing with strict protocol validation.
//!
//! Domain Governance Rules: FGT-TRN-001 (smart wire protocol), FGT-COR-001.

use crate::packetline::PacketLine;
use fg_core::error::{FractalError, FractalResult};

/// Parsed Git Smart Protocol v2 client command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmartV2Command {
    /// Reference listing command (`ls-refs`).
    LsRefs {
        symrefs: bool,
        peel: bool,
        prefixes: Vec<String>,
    },
    /// Object negotiation and download command (`fetch`).
    Fetch {
        wants: Vec<String>,
        haves: Vec<String>,
        done: bool,
        shallow: Vec<String>,
        deepen: Option<u32>,
    },
    /// Generic or sovereign extension command.
    Custom {
        name: String,
        arguments: Vec<String>,
    },
}

/// Parsed Git Smart Protocol v2 request envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmartV2Request {
    pub command: SmartV2Command,
    pub agent: Option<String>,
    pub capabilities: Vec<String>,
}

impl SmartV2Request {
    /// Parses a raw client Smart Protocol v2 request stream.
    pub fn parse(bytes: &[u8]) -> FractalResult<Self> {
        let lines = PacketLine::decode(bytes)?;
        if lines.is_empty() {
            return Err(FractalError::ObjectCodec(
                "Empty Smart Protocol v2 request".to_owned(),
            ));
        }

        let mut command_name = String::new();
        let mut agent = None;
        let mut capabilities = Vec::new();
        let mut args = Vec::new();

        for line in lines {
            let trimmed = line.trim();
            if let Some(cmd) = trimmed.strip_prefix("command=") {
                command_name = cmd.to_owned();
            } else if let Some(ag) = trimmed.strip_prefix("agent=") {
                agent = Some(ag.to_owned());
            } else if trimmed.contains('=') && command_name.is_empty() {
                capabilities.push(trimmed.to_owned());
            } else {
                args.push(trimmed.to_owned());
            }
        }

        if command_name.is_empty() {
            return Err(FractalError::ObjectCodec(
                "Missing 'command=' in Smart Protocol v2 request".to_owned(),
            ));
        }

        let command = match command_name.as_str() {
            "ls-refs" => {
                let mut symrefs = false;
                let mut peel = false;
                let mut prefixes = Vec::new();
                for arg in args {
                    if arg == "symrefs" {
                        symrefs = true;
                    } else if arg == "peel" {
                        peel = true;
                    } else if let Some(prefix) = arg.strip_prefix("ref-prefix ") {
                        prefixes.push(prefix.to_owned());
                    }
                }
                SmartV2Command::LsRefs {
                    symrefs,
                    peel,
                    prefixes,
                }
            }
            "fetch" => {
                let mut wants = Vec::new();
                let mut haves = Vec::new();
                let mut shallow = Vec::new();
                let mut done = false;
                let mut deepen = None;
                for arg in args {
                    if let Some(oid) = arg.strip_prefix("want ") {
                        wants.push(oid.to_owned());
                    } else if let Some(oid) = arg.strip_prefix("have ") {
                        haves.push(oid.to_owned());
                    } else if let Some(oid) = arg.strip_prefix("shallow ") {
                        shallow.push(oid.to_owned());
                    } else if let Some(depth_str) = arg.strip_prefix("deepen ") {
                        deepen = depth_str.parse().ok();
                    } else if arg == "done" {
                        done = true;
                    }
                }
                SmartV2Command::Fetch {
                    wants,
                    haves,
                    done,
                    shallow,
                    deepen,
                }
            }
            custom => SmartV2Command::Custom {
                name: custom.to_owned(),
                arguments: args,
            },
        };

        Ok(Self {
            command,
            agent,
            capabilities,
        })
    }
}
