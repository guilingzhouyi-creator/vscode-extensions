//! Module: fg-native — Repository Identity and Store Location
//! File Path: crates/fg-native/src/repo_identity.rs
//! Architecture Role: Derives and validates the immutable repository identifier, and resolves the
//!   store directory that a release-mode layout points at.
//! Dependencies & Triggers: Called by `taxis init` (generates), `taxis doctor` (cross-checks the
//!   declared layout against the physical filesystem), and `taxis relocate` (moves between layouts).
//! Responsibilities: Generate a repository id from the operating system's random source, parse its
//!   hexadecimal spelling, and compute the store root and per-repository store directory.
//! Exit Semantics & Design Rationale:
//!   - The id is random, never derived from a path or from the first commit. A path-derived id
//!     changes when the workspace moves or is copied to another machine, which orphans the real
//!     data; a commit-derived id cannot exist for an empty repository.
//!   - Generation fails loudly when the operating system refuses random bytes. Substituting a
//!     timestamp or a counter would hand two repositories the same identity, and the collision
//!     would only appear when their stores resolved to the same directory.
//!   - The hex spelling is the only accepted textual form, lowercase and exactly 32 characters.
//!     Accepting uppercase or shorter forms would let two spellings name one store on a
//!     case-insensitive filesystem and two different stores on a case-sensitive one.
//!   - Store paths are computed from a caller-supplied home root rather than read from the
//!     environment here, so tests and `--home` overrides do not need to mutate process state.

use std::path::{Path, PathBuf};

use crate::error::{NativeError, NativeResult};
use crate::sections::meta::REPO_ID_LEN;

/// Directory name, under the home root, that holds every release-mode store.
pub const STORE_DIR_NAME: &str = ".taxis";

/// Directory name, under the store root, that holds one directory per repository.
pub const STORES_DIR_NAME: &str = "stores";

/// Length of the hexadecimal spelling of a repository id.
pub const REPO_ID_HEX_LEN: usize = REPO_ID_LEN * 2;

/// Fills `dest` with cryptographically strong bytes from the operating system's random source.
///
/// # Errors
///
/// Returns [`NativeError::RandomUnavailable`] when the platform random source cannot be read.
pub fn fill_random_bytes(dest: &mut [u8]) -> NativeResult<()> {
    getrandom::fill(dest).map_err(|random_err| NativeError::RandomUnavailable {
        reason: random_err.to_string(),
    })
}

/// Fills a fresh repository identifier from the operating system's random source.
///
/// # Errors
///
/// Returns [`NativeError::RandomUnavailable`] when the platform random source cannot be read.
pub fn generate_repo_id() -> NativeResult<[u8; REPO_ID_LEN]> {
    let mut repo_id = [0u8; REPO_ID_LEN];
    fill_random_bytes(&mut repo_id)?;
    Ok(repo_id)
}

/// Renders a repository id as its lowercase hexadecimal spelling.
pub fn repo_id_to_hex(repo_id: &[u8; REPO_ID_LEN]) -> String {
    fg_core::models::hex::encode_hex(repo_id)
}

/// Parses the lowercase hexadecimal spelling of a repository id.
///
/// # Errors
///
/// Returns [`NativeError::InvalidRepoIdHex`] when the text is not exactly 32 lowercase hexadecimal
/// characters. Uppercase is rejected rather than normalized: the store directory name is compared
/// byte for byte against this spelling, so accepting a second spelling would make the comparison
/// depend on the filesystem's case sensitivity.
pub fn repo_id_from_hex(hex: &str) -> NativeResult<[u8; REPO_ID_LEN]> {
    if hex.len() != REPO_ID_HEX_LEN {
        return Err(NativeError::InvalidRepoIdHex {
            reason: "expected exactly 32 hexadecimal characters",
        });
    }
    if !hex
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(NativeError::InvalidRepoIdHex {
            reason: "must contain only the lowercase characters 0-9 and a-f",
        });
    }
    fg_core::models::hex::decode_fixed_hex::<REPO_ID_LEN>(hex).map_err(|_| {
        NativeError::InvalidRepoIdHex {
            reason: "must contain only the lowercase characters 0-9 and a-f",
        }
    })
}

/// Returns the directory that holds every release-mode store: `<home>/.taxis/stores`.
pub fn store_root(home_root: &Path) -> PathBuf {
    home_root.join(STORE_DIR_NAME).join(STORES_DIR_NAME)
}

/// Returns the store directory for one repository: `<home>/.taxis/stores/<lowercase hex>`.
pub fn store_path(home_root: &Path, repo_id: &[u8; REPO_ID_LEN]) -> PathBuf {
    store_root(home_root).join(repo_id_to_hex(repo_id))
}

#[cfg(test)]
mod tests {
    use super::{
        generate_repo_id, repo_id_from_hex, repo_id_to_hex, store_path, store_root, REPO_ID_HEX_LEN,
    };
    use crate::error::NativeError;
    use std::path::Path;

    #[test]
    fn generated_ids_are_not_repeated() {
        // Two initializations must never share an identity: the store directory is the id.
        let first = generate_repo_id().expect("generate");
        let second = generate_repo_id().expect("generate");
        assert_ne!(first, second);
    }

    #[test]
    fn hex_round_trips() {
        let repo_id = generate_repo_id().expect("generate");
        let hex = repo_id_to_hex(&repo_id);
        assert_eq!(hex.len(), REPO_ID_HEX_LEN);
        assert_eq!(repo_id_from_hex(&hex).expect("parse"), repo_id);
    }

    #[test]
    fn hex_spelling_is_lowercase() {
        let mut repo_id = [0u8; super::REPO_ID_LEN];
        repo_id[0] = 0xAB;
        repo_id[15] = 0x0F;
        let hex = repo_id_to_hex(&repo_id);
        assert!(hex.starts_with("ab"));
        assert!(hex.ends_with("0f"));
    }

    #[test]
    fn uppercase_hex_is_rejected() {
        let uppercase = "AB".repeat(16);
        assert!(matches!(
            repo_id_from_hex(&uppercase),
            Err(NativeError::InvalidRepoIdHex { .. })
        ));
    }

    #[test]
    fn wrong_length_hex_is_rejected() {
        assert!(repo_id_from_hex("abc").is_err());
        assert!(repo_id_from_hex(&"0".repeat(33)).is_err());
    }

    #[test]
    fn store_path_is_the_lowercase_hex_under_the_store_root() {
        let home = Path::new("home");
        let mut repo_id = [0u8; super::REPO_ID_LEN];
        repo_id[0] = 0x12;
        repo_id[15] = 0x34;

        assert_eq!(
            store_root(home),
            Path::new("home").join(".taxis").join("stores")
        );
        let resolved = store_path(home, &repo_id);
        assert_eq!(
            resolved.parent(),
            Some(store_root(home).as_path()),
            "the store directory must sit directly under the store root"
        );
        assert_eq!(
            resolved.file_name().and_then(|name| name.to_str()),
            Some(repo_id_to_hex(&repo_id).as_str())
        );
    }
}
