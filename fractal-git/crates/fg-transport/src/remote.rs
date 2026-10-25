//! Module: fg-transport::remote — Remote Transport Abstractions and In-Memory Loopback Stubs
//! File Path: crates/fg-transport/src/remote.rs
//! Architecture Role: Pluggable remote communication interface for pushing and fetching refs and objects
//!   across network boundaries or in-memory agent-to-agent loopback channels.
//! Dependencies & Triggers: Consumed by Taxis network sync adapters and multi-agent simulation harnesses.
//! Responsibilities: Define RemoteTransport trait, implement MockTransport for deterministic unit testing,
//!   and LoopbackTransport for zero-network in-process repository synchronization.
//! Exit Semantics & Design Rationale:
//!   - Extensible architecture foundation for distributed protocols (SSH, HTTPS, Custom IPC) without taking heavy network dependencies.
//!   - LoopbackTransport enables multi-agent in-process test fixtures.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-TRN-001`: Transport abstraction and deterministic loopback parity

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;

/// Reference advertisement entry sent by a remote during discovery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRef {
    pub name: String,
    pub target: Oid,
}

/// Pluggable remote communication interface for network and in-memory transports.
pub trait RemoteTransport: Send + Sync {
    /// Remote identifier or URL (e.g. `origin` or `https://github.com/foo/bar.git`).
    fn url(&self) -> &str;

    /// Discovers advertised references from the remote endpoint.
    fn list_refs(&self) -> FractalResult<Vec<RemoteRef>>;

    /// Pushes local reference updates and pack payload to the remote endpoint.
    ///
    /// Updates are tuples of `(ref_name, new_oid, expected_old_oid)` where `expected_old_oid`
    /// enforces atomic Compare-And-Swap (CAS) semantics.
    fn push(
        &mut self,
        updates: &[(String, Oid, Option<Oid>)],
        pack_payload: Option<&[u8]>,
    ) -> FractalResult<Vec<(String, Result<(), String>)>>;

    /// Fetches remote references and downloads the corresponding pack payload.
    fn fetch(&mut self, wants: &[Oid], haves: &[Oid]) -> FractalResult<Vec<u8>>;
}

/// Deterministic mock transport for unit testing.
pub struct MockTransport {
    url: String,
    advertised_refs: Vec<RemoteRef>,
    fetch_payload: Vec<u8>,
    pub recorded_pushes: Vec<(String, Oid, Option<Oid>)>,
}

impl MockTransport {
    /// Creates a new mock transport instance with the specified remote URL.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            advertised_refs: Vec::new(),
            fetch_payload: Vec::new(),
            recorded_pushes: Vec::new(),
        }
    }

    /// Sets the advertised references returned by `list_refs`.
    pub fn with_refs(mut self, refs: Vec<RemoteRef>) -> Self {
        self.advertised_refs = refs;
        self
    }

    /// Sets the mock payload returned by `fetch`.
    pub fn with_fetch_payload(mut self, payload: Vec<u8>) -> Self {
        self.fetch_payload = payload;
        self
    }
}

impl RemoteTransport for MockTransport {
    fn url(&self) -> &str {
        &self.url
    }

    fn list_refs(&self) -> FractalResult<Vec<RemoteRef>> {
        Ok(self.advertised_refs.clone())
    }

    fn push(
        &mut self,
        updates: &[(String, Oid, Option<Oid>)],
        _pack_payload: Option<&[u8]>,
    ) -> FractalResult<Vec<(String, Result<(), String>)>> {
        let mut results = Vec::new();
        for update in updates {
            self.recorded_pushes.push(update.clone());
            results.push((update.0.clone(), Ok(())));
        }
        Ok(results)
    }

    fn fetch(&mut self, _wants: &[Oid], _haves: &[Oid]) -> FractalResult<Vec<u8>> {
        Ok(self.fetch_payload.clone())
    }
}

/// Thread-safe in-memory loopback transport for multi-agent simulation without network sockets.
#[derive(Clone)]
pub struct LoopbackTransport {
    url: String,
    remote_refs: Arc<Mutex<HashMap<String, Oid>>>,
    stored_pack: Arc<Mutex<Vec<u8>>>,
}

impl LoopbackTransport {
    /// Creates a new in-memory loopback transport endpoint with an empty reference table.
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            remote_refs: Arc::new(Mutex::new(HashMap::new())),
            stored_pack: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Sets an initial reference mapping in the loopback state.
    pub fn set_ref(&self, name: &str, oid: Oid) {
        if let Ok(mut lock) = self.remote_refs.lock() {
            lock.insert(name.to_string(), oid);
        }
    }

    /// Retrieves current reference state in the loopback storage.
    pub fn get_ref(&self, name: &str) -> Option<Oid> {
        self.remote_refs.lock().ok()?.get(name).copied()
    }
}

impl RemoteTransport for LoopbackTransport {
    fn url(&self) -> &str {
        &self.url
    }

    fn list_refs(&self) -> FractalResult<Vec<RemoteRef>> {
        let lock = self.remote_refs.lock().map_err(|lock_error| {
            FractalError::CorruptStore(format!("lock error: {lock_error}"))
        })?;

        let mut ref_list: Vec<RemoteRef> = lock
            .iter()
            .map(|(name, &target)| RemoteRef {
                name: name.clone(),
                target,
            })
            .collect();
        ref_list.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(ref_list)
    }

    fn push(
        &mut self,
        updates: &[(String, Oid, Option<Oid>)],
        pack_payload: Option<&[u8]>,
    ) -> FractalResult<Vec<(String, Result<(), String>)>> {
        let mut lock = self.remote_refs.lock().map_err(|lock_error| {
            FractalError::CorruptStore(format!("lock error: {lock_error}"))
        })?;

        let mut results = Vec::new();

        for (name, new_oid, expected_old) in updates {
            let current = lock.get(name).copied();

            if let Some(expected) = expected_old {
                if current != Some(*expected) {
                    results.push((
                        name.clone(),
                        Err(format!(
                            "non-fast-forward: expected {:?}, got {:?}",
                            expected, current
                        )),
                    ));
                    continue;
                }
            }

            lock.insert(name.clone(), *new_oid);
            results.push((name.clone(), Ok(())));
        }

        if let Some(payload) = pack_payload {
            if let Ok(mut pack_lock) = self.stored_pack.lock() {
                pack_lock.clear();
                pack_lock.extend_from_slice(payload);
            }
        }

        Ok(results)
    }

    fn fetch(&mut self, _wants: &[Oid], _haves: &[Oid]) -> FractalResult<Vec<u8>> {
        let lock = self.stored_pack.lock().map_err(|lock_error| {
            FractalError::CorruptStore(format!("lock error: {lock_error}"))
        })?;
        Ok(lock.clone())
    }
}
