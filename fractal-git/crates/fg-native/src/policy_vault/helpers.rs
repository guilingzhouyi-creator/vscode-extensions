//! Module: fg-native — Policy Vault Container & Path Helpers
//! File Path: crates/fg-native/src/policy_vault/helpers.rs
//! Architecture Role: Helper utilities reading `repo.txc` / `.taxis-policy.seal`
//!   repository IDs, resolving worktree `commondir`, hiding vault files, and reading timestamps.
//! Dependencies & Triggers: Uses `fg_core::models::{verify_seal_record, POLICY_REPO_ID_LEN}` and
//!   `crate::{ContainerView, MetaSection, SectionTag, hide_path}`.
//! Responsibilities: Keep filesystem inspection, permission hardening, and lexical normalization
//!   decoupled from the vault state machine in `store.rs`.

use std::path::{Component, Path, PathBuf};

use fg_core::models::{verify_seal_record, POLICY_REPO_ID_LEN};

use crate::container::ContainerView;
use crate::repo_layout::hide_path;
use crate::section_tag::SectionTag;
use crate::sections::MetaSection;

pub(super) fn read_container_repo_id(
    container_path: &Path,
) -> Result<Option<[u8; POLICY_REPO_ID_LEN]>, String> {
    if !container_path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(container_path)
        .map_err(|read_err| format!("read container '{}': {read_err}", container_path.display()))?;
    let view = ContainerView::parse(&bytes)
        .map_err(|parse_err| format!("parse container META: {parse_err}"))?;
    let meta_payload = view
        .payload(SectionTag::Meta)
        .map_err(|sec_err| format!("extract container META section: {sec_err}"))?;
    let meta = MetaSection::decode(meta_payload)
        .map_err(|decode_err| format!("decode container META: {decode_err}"))?;
    Ok(Some(meta.repo_id))
}

pub(super) fn read_verified_seal(
    seal_path: &Path,
) -> Result<Option<[u8; POLICY_REPO_ID_LEN]>, String> {
    if !seal_path.is_file() {
        return Ok(None);
    }
    let bytes = std::fs::read(seal_path)
        .map_err(|read_err| format!("read policy seal '{}': {read_err}", seal_path.display()))?;
    verify_seal_record(&bytes)
        .map(Some)
        .map_err(|verify_err| verify_err.to_string())
}

pub(super) fn restrict_and_hide_file(path: &Path) {
    let _ = hide_path(path);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

pub(super) fn current_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => i64::try_from(elapsed.as_secs()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

pub(super) fn normalize_lexical_path(input_path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in input_path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}
