//! Module: fg-native — WKTR Section Codec
//! File Path: crates/fg-native/src/sections/worktree_registry.rs
//! Architecture Role: Encodes the worktree registry — every allocated worktree with its scope
//!   projection, path jail, and storage tier — as a record stream keyed by path.
//! Dependencies & Triggers: Written by `taxis worktree add` / `remove`; read by every command that
//!   resolves the current worktree and by `taxis doctor`.
//! Responsibilities: Round-trip worktree path, mode, scope list, full-checkout marker, and tier with
//!   strong typing for every field.
//! Exit Semantics & Design Rationale:
//!   - Records are strictly ascending by path so a lookup is a binary search, and the order is
//!     re-verified on decode.
//!   - Scope lists are stored as a `u16`-counted array of `u16`-prefixed strings. An untyped
//!     value tree would make a malformed entry indistinguishable from a valid one until the path
//!     jail is consulted, which is far too late.
//!   - `is_full` and the scope list are cross-checked on decode: a full checkout that also lists
//!     scopes is contradictory, and picking one interpretation silently would either over-grant or
//!     over-restrict filesystem access.
//!   - The mode and tier are closed discriminant sets; an unknown value is reported with the byte
//!     attached rather than defaulted, because defaulting a tier to `Full` would materialize an
//!     entire repository for a worktree that asked for a sparse view.

use crate::codec::{FieldReader, FieldWriter};
use crate::constants::MAX_RECORD_COUNT;
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "WKTR";

/// How a worktree's files are stored on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeMode {
    /// Virtual worktree: the view exists only in memory, nothing is materialized.
    Virtual = 0,
    /// Copy-on-write worktree: files are shared until first write.
    Cow = 1,
    /// Sparse worktree: only paths inside the projection exist on disk.
    Sparse = 2,
    /// Full worktree: every tracked path is materialized.
    Full = 3,
}

impl WorktreeMode {
    /// Every mode this build understands, in ascending on-disk order.
    pub const ALL: [Self; 4] = [Self::Virtual, Self::Cow, Self::Sparse, Self::Full];

    /// Returns the on-disk discriminant.
    pub const fn to_u8(self) -> u8 {
        self as u8
    }

    /// Decodes the on-disk discriminant.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownDiscriminant`] naming `worktree_mode` for an unknown value.
    pub const fn from_u8(value: u8) -> NativeResult<Self> {
        match value {
            0 => Ok(Self::Virtual),
            1 => Ok(Self::Cow),
            2 => Ok(Self::Sparse),
            3 => Ok(Self::Full),
            other => Err(NativeError::UnknownDiscriminant {
                field: "worktree_mode",
                value: other,
            }),
        }
    }

    /// Reports whether this mode writes real file content.
    pub const fn materializes_files(self) -> bool {
        !matches!(self, Self::Virtual)
    }
}

/// Storage tier a worktree's content is served from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeTier {
    /// Hot tier: resident in the local object store.
    Hot = 0,
    /// Warm tier: local but not preloaded.
    Warm = 1,
    /// Cold tier: remote-backed, fetched on demand.
    Cold = 2,
}

impl WorktreeTier {
    /// Every tier this build understands, in ascending on-disk order.
    pub const ALL: [Self; 3] = [Self::Hot, Self::Warm, Self::Cold];

    /// Returns the on-disk discriminant.
    pub const fn to_u8(self) -> u8 {
        self as u8
    }

    /// Decodes the on-disk discriminant.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::UnknownWorktreeTier`] for an unknown value.
    pub const fn from_u8(value: u8) -> NativeResult<Self> {
        match value {
            0 => Ok(Self::Hot),
            1 => Ok(Self::Warm),
            2 => Ok(Self::Cold),
            other => Err(NativeError::UnknownWorktreeTier { tier: other }),
        }
    }
}

/// One registered worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeRecord {
    /// Worktree path relative to the repository root; the empty string means the main worktree.
    pub path: String,
    /// How the worktree's files are stored.
    pub mode: WorktreeMode,
    /// Permitted write prefixes; empty with `is_full = true` means unrestricted.
    pub scopes: Vec<String>,
    /// Whether this worktree checks out the full universe.
    pub is_full: bool,
    /// Storage tier serving the content.
    pub tier: WorktreeTier,
}

impl WorktreeRecord {
    /// Creates a sparse worktree record with an explicit scope list.
    pub fn sparse(path: impl Into<String>, scopes: Vec<String>) -> Self {
        Self {
            path: path.into(),
            mode: WorktreeMode::Sparse,
            scopes,
            is_full: false,
            tier: WorktreeTier::Hot,
        }
    }

    /// Creates a full-checkout worktree record.
    pub fn full(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            mode: WorktreeMode::Full,
            scopes: Vec::new(),
            is_full: true,
            tier: WorktreeTier::Hot,
        }
    }

    /// Reports whether writes to `relative_path` are permitted by this record's projection.
    ///
    /// A full worktree permits everything; a sparse worktree permits only paths under one of its
    /// scopes. A sparse worktree with no scopes permits nothing, which is the safe reading: an
    /// empty scope list is far more likely to be a truncated record than an intentional grant.
    pub fn permits(&self, relative_path: &str) -> bool {
        if self.is_full {
            return true;
        }
        self.scopes
            .iter()
            .any(|scope| fg_core::path_matches_scope(relative_path, scope))
    }
}

/// Ordered worktree registry with binary-search lookup by path.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WktrSection {
    records: Vec<WorktreeRecord>,
}

impl WktrSection {
    /// Creates an empty registry.
    pub const fn new() -> Self {
        Self {
            records: Vec::new(),
        }
    }

    /// Returns the number of registered worktrees.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Reports whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Returns the records in ascending path order.
    pub fn records(&self) -> &[WorktreeRecord] {
        &self.records
    }

    /// Inserts or replaces a worktree record, preserving ascending order.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::InvalidPath`] when a scope is not a safe worktree-relative prefix,
    /// [`NativeError::WorktreeScopeConflict`] when a full checkout also lists scopes, and
    /// [`NativeError::CountExceeded`] at the record ceiling.
    pub fn upsert(&mut self, record: WorktreeRecord) -> NativeResult<()> {
        validate_record(&record)?;

        match self
            .records
            .binary_search_by(|existing| existing.path.cmp(&record.path))
        {
            Ok(position) => {
                self.records[position] = record;
                Ok(())
            }
            Err(position) => {
                if self.records.len() >= MAX_RECORD_COUNT {
                    return Err(NativeError::CountExceeded {
                        field: "worktrees",
                        declared: self.records.len() + 1,
                        ceiling: MAX_RECORD_COUNT,
                    });
                }
                self.records.insert(position, record);
                Ok(())
            }
        }
    }

    /// Looks up a worktree by exact path.
    pub fn get(&self, path: &str) -> Option<&WorktreeRecord> {
        self.records
            .binary_search_by(|existing| existing.path.as_str().cmp(path))
            .ok()
            .map(|position| &self.records[position])
    }

    /// Returns the first record that permits writing `relative_path`.
    ///
    /// Ordered lookup matters: two nested worktrees can both claim a path, and the caller needs a
    /// deterministic answer rather than whichever record happens to be found first.
    pub fn find_owner(&self, relative_path: &str) -> Option<&WorktreeRecord> {
        self.records
            .iter()
            .filter(|record| record.permits(relative_path))
            .max_by_key(|record| record.scopes.iter().map(String::len).max().unwrap_or(0))
    }

    /// Serializes the section payload.
    ///
    /// Layout: `u32` record count, then one variable-length record per worktree.
    ///
    /// # Errors
    ///
    /// Propagates record validation and string-encoding failures.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        if self.records.len() > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "worktrees",
                declared: self.records.len(),
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut writer = FieldWriter::with_capacity(4 + self.records.len() * 64);
        writer.write_u32(self.records.len() as u32);

        for record in &self.records {
            validate_record(record)?;
            writer.write_string("worktree_path", &record.path)?;
            writer.write_u8(record.mode.to_u8());
            writer.write_u16(record.scopes.len() as u16);
            for scope in &record.scopes {
                writer.write_string("worktree_scope", scope)?;
            }
            writer.write_u8(u8::from(record.is_full));
            writer.write_u8(record.tier.to_u8());
        }
        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] for an implausible count,
    /// [`NativeError::SectionTableUnsorted`] when paths are not strictly ascending,
    /// [`NativeError::UnknownDiscriminant`] for an unknown mode or full marker,
    /// [`NativeError::UnknownWorktreeTier`] for an unknown tier,
    /// [`NativeError::WorktreeScopeConflict`] for a contradictory projection, and field-level
    /// errors for a truncated payload.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let declared = reader.read_u32("worktree_count")? as usize;
        if declared > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "worktrees",
                declared,
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut records: Vec<WorktreeRecord> = Vec::with_capacity(declared.min(64));

        for _ in 0..declared {
            let path = reader.read_string("worktree_path")?;
            if let Some(previous) = records.last() {
                if previous.path.as_str() >= path.as_str() {
                    return Err(NativeError::SectionTableUnsorted {
                        tag: SECTION_TAG,
                        previous: "worktree path",
                    });
                }
            }

            let mode = WorktreeMode::from_u8(reader.read_u8("worktree_mode")?)?;

            let scope_count = reader.read_u16("worktree_scope_count")? as usize;
            let mut scopes = Vec::with_capacity(scope_count.min(64));
            for _ in 0..scope_count {
                scopes.push(reader.read_string("worktree_scope")?);
            }

            let is_full = match reader.read_u8("worktree_is_full")? {
                0 => false,
                1 => true,
                other => {
                    return Err(NativeError::UnknownDiscriminant {
                        field: "worktree_is_full",
                        value: other,
                    })
                }
            };
            let tier = WorktreeTier::from_u8(reader.read_u8("worktree_tier")?)?;

            let record = WorktreeRecord {
                path,
                mode,
                scopes,
                is_full,
                tier,
            };
            validate_record(&record)?;
            records.push(record);
        }

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(Self { records })
    }
}

/// Enforces the worktree record's internal consistency.
///
/// # Errors
///
/// Returns [`NativeError::WorktreeScopeConflict`] when a full checkout lists scopes, and
/// [`NativeError::InvalidPath`] when a scope is absolute, escapes the root, or uses a backslash.
fn validate_record(record: &WorktreeRecord) -> NativeResult<()> {
    if record.is_full && !record.scopes.is_empty() {
        return Err(NativeError::WorktreeScopeConflict);
    }
    if record.path.contains('\\') {
        return Err(NativeError::InvalidPath {
            reason: "worktree path uses a backslash separator",
        });
    }

    for scope in &record.scopes {
        if scope.is_empty() {
            return Err(NativeError::InvalidPath {
                reason: "scope is empty",
            });
        }
        if scope.starts_with('/') || scope.contains('\\') {
            return Err(NativeError::InvalidPath {
                reason: "scope is absolute or uses a backslash",
            });
        }
        for component in scope.trim_end_matches('/').split('/') {
            if component == ".." {
                return Err(NativeError::InvalidPath {
                    reason: "scope escapes the worktree root",
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{WktrSection, WorktreeMode, WorktreeRecord, WorktreeTier};
    use crate::error::NativeError;

    fn sparse(path: &str, scopes: &[&str]) -> WorktreeRecord {
        WorktreeRecord::sparse(
            path,
            scopes.iter().map(|scope| (*scope).to_owned()).collect(),
        )
    }

    #[test]
    fn mode_byte_round_trips_for_every_variant() {
        for mode in WorktreeMode::ALL {
            assert_eq!(WorktreeMode::from_u8(mode.to_u8()).expect("decode"), mode);
        }
    }

    #[test]
    fn tier_byte_round_trips_for_every_variant() {
        for tier in WorktreeTier::ALL {
            assert_eq!(WorktreeTier::from_u8(tier.to_u8()).expect("decode"), tier);
        }
    }

    #[test]
    fn rejects_unknown_mode_and_tier() {
        assert!(matches!(
            WorktreeMode::from_u8(9).expect_err("unknown mode"),
            NativeError::UnknownDiscriminant {
                field: "worktree_mode",
                value: 9
            }
        ));
        assert!(matches!(
            WorktreeTier::from_u8(9).expect_err("unknown tier"),
            NativeError::UnknownWorktreeTier { tier: 9 }
        ));
    }

    #[test]
    fn virtual_mode_materializes_nothing() {
        for mode in WorktreeMode::ALL {
            assert_eq!(mode.materializes_files(), mode != WorktreeMode::Virtual);
        }
    }

    #[test]
    fn round_trip_preserves_records_and_order() {
        let mut registry = WktrSection::new();
        registry
            .upsert(sparse("vendor-agent", &["auto-refactor/src/"]))
            .expect("upsert");
        registry.upsert(WorktreeRecord::full("")).expect("upsert");
        registry
            .upsert(sparse("docs-agent", &["docs/"]))
            .expect("upsert");

        let decoded = WktrSection::decode(&registry.encode().expect("encode")).expect("decode");
        assert_eq!(decoded, registry);

        let paths: Vec<&str> = decoded.records().iter().map(|r| r.path.as_str()).collect();
        assert_eq!(paths, vec!["", "docs-agent", "vendor-agent"]);
    }

    #[test]
    fn full_checkout_permits_every_path() {
        let record = WorktreeRecord::full("");
        assert!(record.permits("any/path.txt"));
        assert!(record.permits(""));
    }

    #[test]
    fn sparse_checkout_permits_only_its_scopes() {
        let record = sparse("agent", &["auto-refactor/src/"]);
        assert!(record.permits("auto-refactor/src/core/scanner.ts"));
        assert!(!record.permits("workspace-timing/src/extension.ts"));
    }

    #[test]
    fn sparse_checkout_without_scopes_permits_nothing() {
        // An empty scope list is far more likely to be a truncated record than an intentional
        // grant, so it must deny rather than allow everything.
        let record = sparse("agent", &[]);
        assert!(!record.permits("anything.txt"));
    }

    #[test]
    fn find_owner_prefers_the_most_specific_scope() {
        let mut registry = WktrSection::new();
        registry.upsert(WorktreeRecord::full("")).expect("upsert");
        registry
            .upsert(sparse("narrow", &["auto-refactor/src/analyzers/"]))
            .expect("upsert");

        let owner = registry
            .find_owner("auto-refactor/src/analyzers/hygiene.ts")
            .expect("owner");
        assert_eq!(owner.path, "narrow");
    }

    #[test]
    fn rejects_full_checkout_with_scopes() {
        let mut registry = WktrSection::new();
        let mut contradictory = WorktreeRecord::full("");
        contradictory.scopes = vec!["src/".to_owned()];
        assert!(matches!(
            registry
                .upsert(contradictory)
                .expect_err("contradiction must fail"),
            NativeError::WorktreeScopeConflict
        ));
    }

    #[test]
    fn rejects_escaping_scope() {
        let mut registry = WktrSection::new();
        for bad in ["../outside/", "/absolute/", "a\\b/", ""] {
            assert!(
                registry.upsert(sparse("agent", &[bad])).is_err(),
                "scope {bad} should be rejected"
            );
        }
    }

    #[test]
    fn empty_registry_round_trips() {
        let empty = WktrSection::new();
        let encoded = empty.encode().expect("encode");
        assert_eq!(encoded, vec![0u8, 0, 0, 0]);
        assert!(WktrSection::decode(&encoded).expect("decode").is_empty());
    }

    #[test]
    fn upsert_replaces_same_path() {
        let mut registry = WktrSection::new();
        registry.upsert(sparse("agent", &["src/"])).expect("insert");
        registry
            .upsert(sparse("agent", &["docs/"]))
            .expect("replace");
        assert_eq!(registry.len(), 1);
        assert_eq!(
            registry.get("agent").map(|r| r.scopes.clone()),
            Some(vec!["docs/".to_owned()])
        );
    }

    #[test]
    fn rejects_unsorted_stream() {
        let mut registry = WktrSection::new();
        registry.upsert(sparse("z", &["src/"])).expect("upsert");
        registry.upsert(sparse("a", &["src/"])).expect("upsert");

        let mut payload = Vec::new();
        payload.extend_from_slice(&2u32.to_le_bytes());
        for record in registry.records().iter().rev() {
            let single = {
                let mut one = WktrSection::new();
                one.upsert(record.clone()).expect("clone record");
                one.encode().expect("encode one")
            };
            payload.extend_from_slice(&single[4..]);
        }

        assert!(matches!(
            WktrSection::decode(&payload).expect_err("unsorted must fail"),
            NativeError::SectionTableUnsorted { tag: "WKTR", .. }
        ));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut registry = WktrSection::new();
        registry.upsert(WorktreeRecord::full("")).expect("upsert");
        let mut payload = registry.encode().expect("encode");
        payload.push(0x00);
        assert!(matches!(
            WktrSection::decode(&payload).expect_err("trailing byte must fail"),
            NativeError::TruncatedRecord { tag: "WKTR", .. }
        ));
    }
}
