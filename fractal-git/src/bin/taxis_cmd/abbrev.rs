//! Module: taxis_cmd::abbrev — Object Id Abbreviation Width
//! File Path: src/bin/taxis_cmd/abbrev.rs
//! Architecture Role: Derives the hex width Git prints for an abbreviated object id, so `log` and
//!   `diff` agree with `git log --abbrev-commit` and the `index` lines of `git diff` on the same
//!   repository.
//! Dependencies & Triggers: Called by `log_cmd` for every abbreviated id and by `diff_cmd` for the
//!   two ids on each `index` line.
//! Responsibilities: Map an object count to a width using Git's own formula, and cut an id to it.
//! Exit Semantics & Design Rationale:
//!   - The width is a function of the object count, not a constant. Git sizes the abbreviation from
//!     the birthday bound: a store with `2^len` objects expects a collision at `2^(len/2)`, and each
//!     hex character carries four bits, so the width is `ceil(len / 2)`. Hard-coding one width makes
//!     every `index` line differ on a repository whose object count crosses a power of four, which
//!     is most of them at some point in their history.
//!   - Only the *approximate* count feeds the formula, matching `ODB_COUNT_OBJECTS_APPROXIMATE`.
//!     Git skips loose objects under that flag, so a store whose loose objects have not been packed
//!     still reports the packed count. Counting them here would shift the width by one exactly on
//!     the repositories that have not been repacked.
//!   - The floor is seven, Git's `FALLBACK_DEFAULT_ABBREV`. A tiny repository could derive a
//!     two-character width from its object count, and two characters are not a usable identifier:
//!     the floor is what makes the abbreviation short *and* unambiguous in practice.

use fg_core::models::Oid;

/// Shortest abbreviation Git will print, from `FALLBACK_DEFAULT_ABBREV` in `object-name.h`.
const FALLBACK_DEFAULT_ABBREV: usize = 7;

/// Longest abbreviation: a full SHA-1 in hex.
const FULL_HEX_WIDTH: usize = 40;

/// Returns the width Git uses to abbreviate an id in a repository holding `object_count` objects.
///
/// The derivation mirrors `odb_find_abbrev_len` in `odb.c`:
///
/// ```text
/// len = msb(count) + 1     // highest set bit, plus one for the remaining bits
/// len = ceil(len / 2)      // two hex characters per byte, rounded up
/// len = max(len, 7)        // fallback floor for small stores
/// len = min(len, 40)       // a full id is the ceiling
/// ```
///
/// # Examples
///
/// A store with 25,000 objects derives eight characters, which is what `git log --abbrev-commit`
/// prints in this workspace's repository.
pub fn abbreviation_width(object_count: usize) -> usize {
    let bits = match object_count {
        0 => 0,
        count => (usize::BITS - count.leading_zeros()) as usize,
    };
    let width = bits.div_ceil(2).max(FALLBACK_DEFAULT_ABBREV);
    width.min(FULL_HEX_WIDTH)
}

/// Renders `oid` abbreviated to `width` hex characters.
///
/// A width at or above the full id length returns the whole id; the caller has already clamped it,
/// and clamping again here would silently accept a width the caller meant literally.
pub fn abbreviate(oid: &Oid, width: usize) -> String {
    oid.to_hex().chars().take(width).collect()
}

/// Cuts an already-rendered hex id to `width` characters.
///
/// `diff` hashes the two sides itself rather than holding `Oid` values, because a side that does not
/// exist has no id at all and is rendered as zeros. Cutting the string keeps that caller from having
/// to invent an `Oid` for a file that is absent.
pub fn abbreviate_hex(hex: &str, width: usize) -> &str {
    match hex.char_indices().nth(width) {
        Some((cut, _)) => &hex[..cut],
        None => hex,
    }
}

#[cfg(test)]
mod tests {
    use super::{abbreviate, abbreviation_width};
    use fg_core::models::Oid;

    #[test]
    fn a_small_store_falls_back_to_seven() {
        // 8,285 objects (the packed probe repository) derives 7: msb(8285) = 13, ceil(14/2) = 7.
        assert_eq!(abbreviation_width(8_285), 7);
        assert_eq!(abbreviation_width(1), 7);
        assert_eq!(abbreviation_width(0), 7);
    }

    #[test]
    fn a_large_store_widens_by_one_per_power_of_four() {
        // 21,098 packed objects: msb = 14, ceil(15/2) = 8. This is the workspace repository.
        assert_eq!(abbreviation_width(21_098), 8);
        // 65,536 = 2^16: msb = 16, ceil(17/2) = 9.
        assert_eq!(abbreviation_width(65_536), 9);
        // 16,384 = 2^14: msb = 14, ceil(15/2) = 8.
        assert_eq!(abbreviation_width(16_384), 8);
    }

    #[test]
    fn the_width_never_exceeds_a_full_id() {
        // `usize::MAX` has 64 significant bits, so the formula derives 32 characters — half of the
        // 40-character id, which is Git's own answer for the largest possible count. The clamp to 40
        // is a guard, not a reachable value: 64-bit counts cannot produce a width above 32.
        assert_eq!(abbreviation_width(usize::MAX), 32);
        assert!(abbreviation_width(usize::MAX) <= 40);
    }

    #[test]
    fn an_id_is_cut_to_the_requested_width() {
        let oid = Oid::from_bytes([0xab; 20]);
        assert_eq!(abbreviate(&oid, 7).len(), 7);
        assert_eq!(abbreviate(&oid, 8), "abababab");
        assert_eq!(abbreviate(&oid, 40).len(), 40);
    }
}
