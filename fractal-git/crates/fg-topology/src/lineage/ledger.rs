//! Module: fg-topology — Cryptographic Lineage Ledger Store
//! File Path: crates/fg-topology/src/lineage/ledger.rs
//! Architecture Role: Repository-scoped reader/writer persisting authenticated binary TXLN
//!   transition receipts and telemetry tip markers across worktrees.
//! Dependencies & Triggers: Uses `super::{codec, types}`, `fg_core`, and `fg_native`.
//! Responsibilities: Open ledgers via `commondir`, sign & sync transition records, verify
//!   all stored frames, and answer lineage ancestor queries fail-closed.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use fg_core::crypto::hmac_sm3;
use fg_core::error::FractalResult;
use fg_native::policy_vault::PolicyVaultStore;

use super::codec::{decode_and_verify_frame, derive_lineage_mac_key, encode_receipt_body};
use super::{
    FractalLineageReceipt, LineageEventKind, LineageRecordParams, LINEAGE_MAGIC, LINEAGE_REL_PATH,
    LINEAGE_TELEMETRY_PREFIX, LINEAGE_VERSION,
};

/// Repository-scoped controller reading and appending authenticated binary lineage logs.
pub struct LineageLedger {
    common_dir: PathBuf,
    ledger_path: PathBuf,
    mac_key: [u8; 32],
}

impl LineageLedger {
    /// Opens or prepares the binary lineage ledger for `repo_or_git_dir`.
    #[must_use]
    pub fn open(repo_or_git_dir: &Path) -> Self {
        let common_dir = PolicyVaultStore::resolve_common_repo_dir(repo_or_git_dir);
        let ledger_path = common_dir.join(LINEAGE_REL_PATH);
        let mac_key = derive_lineage_mac_key(&common_dir);
        Self { common_dir, ledger_path, mac_key }
    }

    /// Returns the on-disk binary lineage ledger path.
    #[must_use]
    pub fn ledger_path(&self) -> &Path {
        &self.ledger_path
    }

    /// Signs and appends one lineage receipt into the binary `TXLN` journal.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError`] when string lengths exceed `u16` bounds or disk I/O fails.
    pub fn record(&self, params: &LineageRecordParams<'_>) -> FractalResult<FractalLineageReceipt> {
        let timestamp_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let body = encode_receipt_body(params, timestamp_secs)?;
        let hmac_tag = hmac_sm3(&self.mac_key, &body);

        if let Some(parent_dir) = self.ledger_path.parent() {
            fs::create_dir_all(parent_dir)?;
        }
        let mut frame = Vec::with_capacity(4 + 2 + body.len() + 32);
        frame.extend_from_slice(&LINEAGE_MAGIC);
        frame.extend_from_slice(&LINEAGE_VERSION.to_le_bytes());
        frame.extend_from_slice(&body);
        frame.extend_from_slice(&hmac_tag);

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.ledger_path)?;
        file.write_all(&frame)?;
        file.sync_data()?;

        Ok(FractalLineageReceipt {
            event_kind: params.event_kind,
            cell_id: params.cell_id.to_owned(),
            source_ref: params.source_ref.to_owned(),
            target_ref: params.target_ref.to_owned(),
            commit_oid_hex: params.commit_oid_hex.to_owned(),
            parent_oid_hex: params.parent_oid_hex.to_owned(),
            timestamp_secs,
            hmac_tag,
        })
    }

    /// Best-effort helper appending a lineage receipt and updating telemetry tip marker.
    pub fn record_best_effort(repo_or_git_dir: &Path, params: &LineageRecordParams<'_>) {
        let ledger = Self::open(repo_or_git_dir);
        if let Ok(receipt) = ledger.record(params) {
            if !receipt.commit_oid_hex.is_empty() && !receipt.cell_id.is_empty() {
                let telemetry_ref = ledger
                    .common_dir
                    .join(format!("{LINEAGE_TELEMETRY_PREFIX}{}", receipt.cell_id));
                if let Some(parent) = telemetry_ref.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&telemetry_ref, format!("{}\n", receipt.commit_oid_hex));
            }
        }
    }

    /// Reads and cryptographically authenticates every entry in the binary lineage ledger.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::AuthProofInvalid`] or [`FractalError::CorruptStore`] on any
    /// truncated frame, magic mismatch, or `HMAC-SM3` forgery.
    pub fn verify_all(&self) -> FractalResult<Vec<FractalLineageReceipt>> {
        if !self.ledger_path.is_file() {
            return Ok(Vec::new());
        }
        let raw = fs::read(&self.ledger_path)?;
        let mut receipts = Vec::new();
        let mut cursor = 0usize;
        while cursor < raw.len() {
            let receipt = decode_and_verify_frame(&raw, &mut cursor, &self.mac_key)?;
            receipts.push(receipt);
        }
        Ok(receipts)
    }

    /// Returns `true` when `branch_name` has at least one verified `Fork`/`Merge`/`Migrate` receipt.
    ///
    /// # Errors
    ///
    /// Propagates ledger corruption or MAC forgery errors fail-closed.
    pub fn has_verified_lineage_for(&self, branch_name: &str) -> FractalResult<bool> {
        let receipts = self.verify_all()?;
        Ok(receipts.iter().any(|entry| {
            (entry.source_ref == branch_name || entry.target_ref == branch_name)
                && matches!(
                    entry.event_kind,
                    LineageEventKind::Fork | LineageEventKind::Merge | LineageEventKind::Migrate
                )
        }))
    }
}
