//! Module: fg-native — REFS Section Codec
//! File Path: crates/fg-native/src/sections/refs.rs
//! Architecture Role: Encodes the repository's reference table as a strictly sorted record stream
//!   supporting binary search by name.
//! Dependencies & Triggers: Consumed by every revision-resolving command; written by `commit`,
//!   `branch`, and `git-import`.
//! Responsibilities: Round-trip an ordered name to object-id table with optional peeled targets.
//! Exit Semantics & Design Rationale:
//!   - Records are written in strictly ascending name order and that order is re-verified on
//!     decode: binary search over unsorted records would return wrong answers silently, which is
//!     worse than refusing to load.
//!   - Duplicate names are rejected for the same reason; a repository with two entries for one ref
//!     has no defined resolution order.
//!   - Peeled ids are stored as an explicit presence byte rather than an all-zero sentinel, because
//!     an annotated tag can legitimately peel to a value that would otherwise be confused with
//!     absence.

use fg_core::models::Oid;

use crate::codec::{FieldReader, FieldWriter};
use crate::constants::MAX_RECORD_COUNT;
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "REFS";

/// Presence marker for an absent peeled target.
const PEELED_ABSENT: u8 = 0;

/// Presence marker for a present peeled target.
const PEELED_PRESENT: u8 = 1;

/// One reference entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefRecord {
    /// Fully qualified reference name, for example `refs/heads/main`.
    pub name: String,
    /// Object the reference currently points at.
    pub oid: Oid,
    /// Peeled commit id for annotated tags; `None` for ordinary references.
    pub peeled: Option<Oid>,
}

/// Ordered reference table with binary-search lookup.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RefsSection {
    records: Vec<RefRecord>,
}

impl RefsSection {
    /// Creates an empty table.
    pub const fn new() -> Self {
        Self {
            records: Vec::new(),
        }
    }

    /// Returns the number of references.
    pub fn len(&self) -> usize {
        self.records.len()
    }

    /// Reports whether the table holds no references.
    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    /// Returns the records in ascending name order.
    pub fn records(&self) -> &[RefRecord] {
        &self.records
    }

    /// Inserts or replaces a reference, preserving ascending order.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] when the table is already at the record ceiling.
    pub fn upsert(&mut self, record: RefRecord) -> NativeResult<()> {
        match self
            .records
            .binary_search_by(|existing| existing.name.cmp(&record.name))
        {
            Ok(position) => {
                self.records[position] = record;
                Ok(())
            }
            Err(position) => {
                if self.records.len() >= MAX_RECORD_COUNT {
                    return Err(NativeError::CountExceeded {
                        field: "refs",
                        declared: self.records.len() + 1,
                        ceiling: MAX_RECORD_COUNT,
                    });
                }
                self.records.insert(position, record);
                Ok(())
            }
        }
    }

    /// Looks up a reference by exact name.
    pub fn get(&self, name: &str) -> Option<&RefRecord> {
        self.records
            .binary_search_by(|existing| existing.name.as_str().cmp(name))
            .ok()
            .map(|position| &self.records[position])
    }

    /// Serializes the section payload.
    ///
    /// Layout: `u32` record count, then one variable-length record per reference.
    ///
    /// # Errors
    ///
    /// Propagates string-field encoding failures and [`NativeError::CountExceeded`] when the record
    /// count exceeds the ceiling.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        if self.records.len() > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "refs",
                declared: self.records.len(),
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut writer = FieldWriter::with_capacity(4 + self.records.len() * 48);
        writer.write_u32(self.records.len() as u32);

        for record in &self.records {
            writer.write_string("ref_name", &record.name)?;
            writer.write_oid(&record.oid);
            match &record.peeled {
                Some(peeled) => {
                    writer.write_u8(PEELED_PRESENT);
                    writer.write_oid(peeled);
                }
                None => writer.write_u8(PEELED_ABSENT),
            }
        }

        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] for an implausible record count,
    /// [`NativeError::SectionTableUnsorted`] when names are not strictly ascending,
    /// [`NativeError::UnknownDiscriminant`] for an unknown peeled marker, and field-level errors for
    /// a truncated payload.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let declared = reader.read_u32("ref_count")? as usize;

        if declared > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "refs",
                declared,
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut records: Vec<RefRecord> = Vec::with_capacity(declared.min(1024));

        for _ in 0..declared {
            let name = reader.read_string("ref_name")?;

            if let Some(previous) = records.last() {
                if previous.name.as_str() >= name.as_str() {
                    return Err(NativeError::SectionTableUnsorted {
                        tag: SECTION_TAG,
                        previous: leak_tag(&previous.name),
                    });
                }
            }

            let oid = reader.read_oid("ref_oid")?;
            let peeled = match reader.read_u8("peeled_marker")? {
                PEELED_PRESENT => Some(reader.read_oid("peeled_oid")?),
                PEELED_ABSENT => None,
                other => {
                    return Err(NativeError::UnknownDiscriminant {
                        field: "peeled_marker",
                        value: other,
                    })
                }
            };

            records.push(RefRecord { name, oid, peeled });
        }

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(Self { records })
    }
}

/// Maps a reference name onto a static diagnostic label.
///
/// The error variant carries `&'static str` so that a failure can be reported without allocating;
/// reference names are therefore bucketed into their namespace rather than echoed verbatim.
fn leak_tag(name: &str) -> &'static str {
    if name.starts_with("refs/heads/") {
        "refs/heads/*"
    } else if name.starts_with("refs/tags/") {
        "refs/tags/*"
    } else if name.starts_with("refs/remotes/") {
        "refs/remotes/*"
    } else if name.starts_with("refs/fractal/") {
        "refs/fractal/*"
    } else {
        "refs/*"
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::{RefRecord, RefsSection};
    use crate::error::NativeError;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        Oid::from_bytes(raw)
    }

    fn record(name: &str, seed: u8) -> RefRecord {
        RefRecord {
            name: name.to_owned(),
            oid: oid_from(seed),
            peeled: None,
        }
    }

    fn sample_table() -> RefsSection {
        let mut table = RefsSection::new();
        table
            .upsert(record("refs/heads/main", 0x01))
            .expect("upsert");
        table
            .upsert(record("refs/heads/feature", 0x02))
            .expect("upsert");
        table
            .upsert(record("refs/tags/v1.0.0", 0x03))
            .expect("upsert");
        table
    }

    #[test]
    fn round_trip_preserves_order_and_values() {
        let original = sample_table();
        let encoded = original.encode().expect("encode");
        let decoded = RefsSection::decode(&encoded).expect("decode");
        assert_eq!(decoded, original);

        let names: Vec<&str> = decoded.records().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["refs/heads/feature", "refs/heads/main", "refs/tags/v1.0.0"]
        );
    }

    #[test]
    fn upsert_keeps_ascending_order() {
        let mut table = RefsSection::new();
        table.upsert(record("refs/heads/z", 0x01)).expect("upsert");
        table.upsert(record("refs/heads/a", 0x02)).expect("upsert");
        table.upsert(record("refs/heads/m", 0x03)).expect("upsert");

        let names: Vec<&str> = table.records().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["refs/heads/a", "refs/heads/m", "refs/heads/z"]);
    }

    #[test]
    fn upsert_replaces_existing_entry() {
        let mut table = RefsSection::new();
        table
            .upsert(record("refs/heads/main", 0x01))
            .expect("upsert");
        table
            .upsert(record("refs/heads/main", 0x09))
            .expect("replace");

        assert_eq!(table.len(), 1);
        let found = table.get("refs/heads/main").expect("present");
        assert_eq!(found.oid, oid_from(0x09));
    }

    #[test]
    fn binary_search_finds_every_entry() {
        let table = sample_table();
        assert!(table.get("refs/heads/main").is_some());
        assert!(table.get("refs/heads/feature").is_some());
        assert!(table.get("refs/tags/v1.0.0").is_some());
        assert!(table.get("refs/heads/missing").is_none());
    }

    #[test]
    fn peeled_target_round_trips() {
        let mut table = RefsSection::new();
        table
            .upsert(RefRecord {
                name: "refs/tags/annotated".to_owned(),
                oid: oid_from(0x0A),
                peeled: Some(oid_from(0x0B)),
            })
            .expect("upsert");

        let encoded = table.encode().expect("encode");
        let decoded = RefsSection::decode(&encoded).expect("decode");
        let found = decoded.get("refs/tags/annotated").expect("present");
        assert_eq!(found.peeled, Some(oid_from(0x0B)));
    }

    #[test]
    fn empty_table_round_trips() {
        let empty = RefsSection::new();
        let encoded = empty.encode().expect("encode");
        assert_eq!(encoded, vec![0u8, 0, 0, 0]);
        let decoded = RefsSection::decode(&encoded).expect("decode");
        assert!(decoded.is_empty());
    }

    #[test]
    fn rejects_unsorted_stream() {
        let mut writer = crate::codec::FieldWriter::new();
        writer.write_u32(2);
        writer
            .write_string("ref_name", "refs/heads/z")
            .expect("write");
        writer.write_oid(&oid_from(0x01));
        writer.write_u8(0);
        writer
            .write_string("ref_name", "refs/heads/a")
            .expect("write");
        writer.write_oid(&oid_from(0x02));
        writer.write_u8(0);
        let payload = writer.finish();

        let error = RefsSection::decode(&payload).expect_err("unsorted must fail");
        assert!(matches!(
            error,
            NativeError::SectionTableUnsorted { tag: "REFS", .. }
        ));
    }

    #[test]
    fn rejects_duplicate_names() {
        let mut writer = crate::codec::FieldWriter::new();
        writer.write_u32(2);
        for _ in 0..2 {
            writer
                .write_string("ref_name", "refs/heads/main")
                .expect("write");
            writer.write_oid(&oid_from(0x01));
            writer.write_u8(0);
        }
        let payload = writer.finish();

        let error = RefsSection::decode(&payload).expect_err("duplicate must fail");
        assert!(matches!(error, NativeError::SectionTableUnsorted { .. }));
    }

    #[test]
    fn rejects_unknown_peeled_marker() {
        let mut writer = crate::codec::FieldWriter::new();
        writer.write_u32(1);
        writer
            .write_string("ref_name", "refs/heads/main")
            .expect("write");
        writer.write_oid(&oid_from(0x01));
        writer.write_u8(7);
        let payload = writer.finish();

        let error = RefsSection::decode(&payload).expect_err("bad marker must fail");
        assert!(matches!(
            error,
            NativeError::UnknownDiscriminant {
                field: "peeled_marker",
                value: 7
            }
        ));
    }

    #[test]
    fn rejects_forged_record_count() {
        let mut payload = vec![0xFFu8, 0xFF, 0xFF, 0x7F];
        payload.extend_from_slice(&[0u8; 8]);
        let error = RefsSection::decode(&payload).expect_err("forged count must fail");
        assert!(matches!(error, NativeError::CountExceeded { .. }));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut payload = sample_table().encode().expect("encode");
        payload.push(0x00);
        let error = RefsSection::decode(&payload).expect_err("trailing byte must fail");
        assert!(matches!(
            error,
            NativeError::TruncatedRecord {
                tag: "REFS",
                remaining: 1
            }
        ));
    }
}
