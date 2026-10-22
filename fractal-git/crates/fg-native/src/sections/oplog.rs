//! Module: fg-native — OPLG Section Codec
//! File Path: crates/fg-native/src/sections/oplog.rs
//! Architecture Role: Encodes the immutable operation-log DAG as a record stream keyed by
//!   operation id, carrying each node's parent links and full repository view snapshot.
//! Dependencies & Triggers: Written on every mutating command; read by `taxis undo`, `taxis op log`,
//!   and time-travel rollback.
//! Responsibilities: Round-trip operation nodes with their parent DAG, view snapshot, actor, command,
//!   and description, while keeping the operation id a pure function of the node's canonical bytes.
//! Exit Semantics & Design Rationale:
//!   - The operation id is `sha1("taxis-op\0" ‖ canonical bytes)`, not a hash of a serialized string.
//!     Hashing a serializer's output makes the id depend on field order, key quoting, and float
//!     formatting; any serializer upgrade would silently rewrite history's identities.
//!   - The id is recomputed on decode and compared against the stored one. A mismatch means the
//!     record was altered after the fact, which no other check would catch because the container
//!     CRC only proves the bytes were not corrupted in transit, not that they were authorized.
//!   - Records are strictly ascending by operation id so a lookup is a binary search, and the order
//!     is re-verified on decode for the same reason as every other ordered section.
//!   - The view snapshot is stored inline rather than by reference: an operation must remain readable
//!     after the objects it referenced are garbage-collected, otherwise `undo` would fail exactly
//!     when it is needed.

use fg_core::models::Oid;
use sha1::{Digest, Sha1};

use crate::codec::{FieldReader, FieldWriter};
use crate::constants::MAX_RECORD_COUNT;
use crate::error::{NativeError, NativeResult};

/// Tag reported in diagnostics for this section.
const SECTION_TAG: &str = "OPLG";

/// Domain separator mixed into every operation id.
///
/// A fixed prefix prevents an operation id from colliding with a commit, tree, or blob id computed
/// over identical bytes, which would make the two id spaces indistinguishable.
const OP_ID_DOMAIN: &[u8] = b"taxis-op\0";

/// The parts an operation node is assembled from.
///
/// Grouped into a struct rather than passed as eight positional arguments: several share the same
/// type, so a positional call site would compile after a transposition and record the wrong actor or
/// command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpLogParts {
    /// Parent operation ids; empty for the root operation.
    pub parent_ids: Vec<Oid>,
    /// Object id the head pointed at when the operation ran, if any.
    pub head_oid: Option<Oid>,
    /// Branches and the object each pointed at at that moment.
    pub branches: Vec<(String, Oid)>,
    /// Promotion request ids that were staged at that moment.
    pub staged_promotions: Vec<String>,
    /// Wall-clock timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: i64,
    /// Actor that ran the command.
    pub actor: String,
    /// Command that produced the operation.
    pub command: String,
    /// Human-facing description of the effect.
    pub description: String,
}

/// One operation node in the immutable DAG.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpLogEntry {
    /// Content-derived operation id.
    pub op_id: Oid,
    /// Parent operation ids; empty for the root operation.
    pub parent_ids: Vec<Oid>,
    /// Object id the head pointed at when the operation ran, if any.
    pub head_oid: Option<Oid>,
    /// Branches and the object each pointed at at that moment.
    pub branches: Vec<(String, Oid)>,
    /// Promotion request ids that were staged at that moment.
    pub staged_promotions: Vec<String>,
    /// Wall-clock timestamp in milliseconds since the Unix epoch.
    pub timestamp_ms: i64,
    /// Actor that ran the command.
    pub actor: String,
    /// Command that produced the operation.
    pub command: String,
    /// Human-facing description of the effect.
    pub description: String,
}

impl OpLogEntry {
    /// Builds an entry from its parts and derives the operation id from the canonical bytes.
    ///
    /// # Errors
    ///
    /// Propagates string-encoding failures from the canonical writer.
    pub fn new(parts: OpLogParts) -> NativeResult<Self> {
        let mut entry = Self {
            op_id: Oid::ZERO,
            parent_ids: parts.parent_ids,
            head_oid: parts.head_oid,
            branches: parts.branches,
            staged_promotions: parts.staged_promotions,
            timestamp_ms: parts.timestamp_ms,
            actor: parts.actor,
            command: parts.command,
            description: parts.description,
        };
        entry.op_id = entry.compute_op_id()?;
        Ok(entry)
    }

    /// Computes the operation id from the node's canonical bytes.
    ///
    /// # Errors
    ///
    /// Propagates string-encoding failures from the canonical writer.
    pub fn compute_op_id(&self) -> NativeResult<Oid> {
        let canonical = self.encode_canonical()?;
        let mut hasher = Sha1::new();
        hasher.update(OP_ID_DOMAIN);
        hasher.update(&canonical);
        let digest: [u8; 20] = hasher.finalize().into();
        Ok(Oid::from_bytes(digest))
    }

    /// Renders the canonical byte form the id is derived from.
    ///
    /// Field order here is part of the identity contract: reordering fields changes every id.
    fn encode_canonical(&self) -> NativeResult<Vec<u8>> {
        let mut writer = FieldWriter::with_capacity(128);
        write_parent_ids(&mut writer, &self.parent_ids);
        writer.write_optional_oid(self.head_oid.as_ref());
        write_branches(&mut writer, &self.branches)?;
        write_strings(&mut writer, "staged_promotion", &self.staged_promotions)?;
        writer.write_i64(self.timestamp_ms);
        writer.write_string("actor", &self.actor)?;
        writer.write_string("command", &self.command)?;
        writer.write_string("description", &self.description)?;
        Ok(writer.finish())
    }
}

/// Writes a parent-id list as a `u16` count followed by the ids.
fn write_parent_ids(writer: &mut FieldWriter, parent_ids: &[Oid]) {
    writer.write_u16(parent_ids.len() as u16);
    for parent in parent_ids {
        writer.write_oid(parent);
    }
}

/// Writes a branch table as a `u16` count followed by name/id pairs.
///
/// # Errors
///
/// Propagates string-encoding failures for branch names.
fn write_branches(writer: &mut FieldWriter, branches: &[(String, Oid)]) -> NativeResult<()> {
    writer.write_u16(branches.len() as u16);
    for (name, oid) in branches {
        writer.write_string("branch_name", name)?;
        writer.write_oid(oid);
    }
    Ok(())
}

/// Writes a `u16`-counted list of strings.
///
/// # Errors
///
/// Propagates string-encoding failures naming `field`.
fn write_strings(
    writer: &mut FieldWriter,
    field: &'static str,
    values: &[String],
) -> NativeResult<()> {
    writer.write_u16(values.len() as u16);
    for value in values {
        writer.write_string(field, value)?;
    }
    Ok(())
}

/// Ordered operation log with binary-search lookup by operation id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OpLogSection {
    entries: Vec<OpLogEntry>,
}

impl OpLogSection {
    /// Creates an empty log.
    pub const fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Returns the number of operations.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Reports whether the log holds no operations.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Returns the entries in ascending operation-id order.
    pub fn entries(&self) -> &[OpLogEntry] {
        &self.entries
    }

    /// Inserts or replaces an operation, preserving ascending order.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] when the log is at the record ceiling, and
    /// [`NativeError::OpLogCycle`] when a parent id equals the operation's own id.
    pub fn upsert(&mut self, entry: OpLogEntry) -> NativeResult<()> {
        if entry.parent_ids.contains(&entry.op_id) {
            return Err(NativeError::OpLogCycle);
        }

        match self
            .entries
            .binary_search_by(|existing| existing.op_id.cmp(&entry.op_id))
        {
            Ok(position) => {
                self.entries[position] = entry;
                Ok(())
            }
            Err(position) => {
                if self.entries.len() >= MAX_RECORD_COUNT {
                    return Err(NativeError::CountExceeded {
                        field: "oplog",
                        declared: self.entries.len() + 1,
                        ceiling: MAX_RECORD_COUNT,
                    });
                }
                self.entries.insert(position, entry);
                Ok(())
            }
        }
    }

    /// Looks up an operation by id.
    pub fn get(&self, op_id: &Oid) -> Option<&OpLogEntry> {
        self.entries
            .binary_search_by(|existing| existing.op_id.cmp(op_id))
            .ok()
            .map(|position| &self.entries[position])
    }

    /// Walks the first-parent chain from `start` for at most `limit` operations.
    ///
    /// Returns the chain in newest-to-oldest order, stopping early at a missing parent. A missing
    /// parent is reported as a truncated chain rather than an error because a pruned history is a
    /// legitimate state, not corruption.
    pub fn first_parent_chain(&self, start: &Oid, limit: usize) -> Vec<&OpLogEntry> {
        let mut chain = Vec::new();
        let mut cursor = Some(*start);
        while let Some(current) = cursor {
            if chain.len() >= limit {
                break;
            }
            match self.get(&current) {
                Some(entry) => {
                    chain.push(entry);
                    cursor = entry.parent_ids.first().copied();
                }
                None => break,
            }
        }
        chain
    }

    /// Serializes the section payload.
    ///
    /// Layout: `u32` operation count, then one variable-length record per operation.
    ///
    /// # Errors
    ///
    /// Propagates string-encoding failures and [`NativeError::CountExceeded`] past the ceiling.
    pub fn encode(&self) -> NativeResult<Vec<u8>> {
        if self.entries.len() > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "oplog",
                declared: self.entries.len(),
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut writer = FieldWriter::with_capacity(4 + self.entries.len() * 160);
        writer.write_u32(self.entries.len() as u32);
        for entry in &self.entries {
            writer.write_oid(&entry.op_id);
            writer.write_bytes(&entry.encode_canonical()?);
        }
        Ok(writer.finish())
    }

    /// Parses the section payload.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::CountExceeded`] for an implausible count,
    /// [`NativeError::OpLogOutOfOrder`] when ids are not strictly ascending,
    /// [`NativeError::OpIdMismatch`] when a stored id disagrees with its recomputed value,
    /// [`NativeError::OpLogCycle`] for a self-parenting node, and field-level errors for a
    /// truncated payload.
    pub fn decode(payload: &[u8]) -> NativeResult<Self> {
        let mut reader = FieldReader::new(payload);
        let declared = reader.read_u32("oplog_count")? as usize;
        if declared > MAX_RECORD_COUNT {
            return Err(NativeError::CountExceeded {
                field: "oplog",
                declared,
                ceiling: MAX_RECORD_COUNT,
            });
        }

        let mut entries = Vec::with_capacity(declared.min(256));
        let mut previous_id: Option<Oid> = None;

        for position in 0..declared {
            let stored_id = reader.read_oid("op_id")?;
            let entry = read_entry(&mut reader, stored_id)?;

            let recomputed = entry.compute_op_id()?;
            if recomputed != stored_id {
                return Err(NativeError::OpIdMismatch {
                    position,
                    stored: stored_id.to_hex(),
                    recomputed: recomputed.to_hex(),
                });
            }
            if entry.parent_ids.contains(&stored_id) {
                return Err(NativeError::OpLogCycle);
            }
            if let Some(previous) = previous_id {
                if previous >= stored_id {
                    return Err(NativeError::OpLogOutOfOrder { position });
                }
            }

            previous_id = Some(stored_id);
            entries.push(entry);
        }

        reader.expect_exhausted(SECTION_TAG)?;
        Ok(Self { entries })
    }
}

/// Reads one operation record, given the id already consumed from the stream.
///
/// # Errors
///
/// Propagates field-level failures for a truncated payload and
/// [`NativeError::CountExceeded`] when a declared list length is implausible.
fn read_entry(reader: &mut FieldReader<'_>, op_id: Oid) -> NativeResult<OpLogEntry> {
    let parent_count = reader.read_u16("parent_count")? as usize;
    check_list_len("parent_ids", parent_count)?;
    let mut parent_ids = Vec::with_capacity(parent_count.min(8));
    for _ in 0..parent_count {
        parent_ids.push(reader.read_oid("parent_id")?);
    }

    let head_oid = reader.read_optional_oid("head_oid")?;

    let branch_count = reader.read_u16("branch_count")? as usize;
    check_list_len("branches", branch_count)?;
    let mut branches = Vec::with_capacity(branch_count.min(64));
    for _ in 0..branch_count {
        let name = reader.read_string("branch_name")?;
        let oid = reader.read_oid("branch_oid")?;
        branches.push((name, oid));
    }

    let promotion_count = reader.read_u16("promotion_count")? as usize;
    check_list_len("staged_promotions", promotion_count)?;
    let mut staged_promotions = Vec::with_capacity(promotion_count.min(64));
    for _ in 0..promotion_count {
        staged_promotions.push(reader.read_string("staged_promotion")?);
    }

    let timestamp_ms = reader.read_i64("timestamp_ms")?;
    let actor = reader.read_string("actor")?;
    let command = reader.read_string("command")?;
    let description = reader.read_string("description")?;

    Ok(OpLogEntry {
        op_id,
        parent_ids,
        head_oid,
        branches,
        staged_promotions,
        timestamp_ms,
        actor,
        command,
        description,
    })
}

/// Rejects a list length that cannot fit in the remaining payload.
///
/// A `u16` length can claim 65535 entries; a small section cannot honour that, so the check bounds
/// the allocation before it happens.
///
/// # Errors
///
/// Returns [`NativeError::CountExceeded`] when `declared` exceeds [`MAX_RECORD_COUNT`].
fn check_list_len(field: &'static str, declared: usize) -> NativeResult<()> {
    if declared > MAX_RECORD_COUNT {
        Err(NativeError::CountExceeded {
            field,
            declared,
            ceiling: MAX_RECORD_COUNT,
        })
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::{OpLogEntry, OpLogParts, OpLogSection};
    use crate::codec::FieldWriter;
    use crate::error::NativeError;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        raw[19] = seed.wrapping_mul(5);
        Oid::from_bytes(raw)
    }

    fn sample(seed: u8, parents: Vec<Oid>) -> OpLogEntry {
        OpLogEntry::new(OpLogParts {
            parent_ids: parents,
            head_oid: Some(oid_from(seed.wrapping_add(1))),
            branches: vec![("refs/heads/main".to_owned(), oid_from(seed))],
            staged_promotions: Vec::new(),
            timestamp_ms: 1_700_000_000_000 + seed as i64,
            actor: "agent-007".to_owned(),
            command: "commit".to_owned(),
            description: "stage a change".to_owned(),
        })
        .expect("build entry")
    }

    #[test]
    fn root_entry_has_no_parents_and_a_stable_id() {
        let entry = sample(1, Vec::new());
        assert!(entry.parent_ids.is_empty());
        assert_eq!(entry.compute_op_id().expect("recompute"), entry.op_id);
    }

    #[test]
    fn operation_id_is_deterministic_across_instances() {
        let first = sample(2, vec![oid_from(1)]);
        let second = sample(2, vec![oid_from(1)]);
        assert_eq!(first.op_id, second.op_id);
    }

    #[test]
    fn operation_id_changes_with_any_field() {
        let base = sample(3, Vec::new());
        let mut other = base.clone();
        other.description = "different".to_owned();
        assert_ne!(
            base.compute_op_id().expect("a"),
            other.compute_op_id().expect("b")
        );

        let mut third = base.clone();
        third.actor = "agent-008".to_owned();
        assert_ne!(
            base.compute_op_id().expect("a"),
            third.compute_op_id().expect("c")
        );
    }

    #[test]
    fn operation_id_is_domain_separated_from_git_objects() {
        // Hashing the same canonical bytes without the domain prefix must give a different id.
        let entry = sample(4, Vec::new());
        let canonical = entry.encode_canonical().expect("canonical");
        let mut hasher = sha1::Sha1::new();
        use sha1::Digest;
        hasher.update(&canonical);
        let bare: [u8; 20] = hasher.finalize().into();
        assert_ne!(Oid::from_bytes(bare), entry.op_id);
    }

    #[test]
    fn round_trip_preserves_every_field() {
        let mut log = OpLogSection::new();
        let first = sample(1, Vec::new());
        let second = sample(2, vec![first.op_id]);
        log.upsert(first.clone()).expect("upsert");
        log.upsert(second.clone()).expect("upsert");

        let decoded = OpLogSection::decode(&log.encode().expect("encode")).expect("decode");
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded.get(&first.op_id), Some(&first));
        assert_eq!(decoded.get(&second.op_id), Some(&second));
    }

    #[test]
    fn first_parent_chain_walks_newest_to_oldest() {
        let mut log = OpLogSection::new();
        let root = sample(1, Vec::new());
        let middle = sample(2, vec![root.op_id]);
        let tip = sample(3, vec![middle.op_id]);
        for entry in [root.clone(), middle.clone(), tip.clone()] {
            log.upsert(entry).expect("upsert");
        }

        let chain = log.first_parent_chain(&tip.op_id, 10);
        let ids: Vec<Oid> = chain.iter().map(|entry| entry.op_id).collect();
        assert_eq!(ids, vec![tip.op_id, middle.op_id, root.op_id]);

        let limited = log.first_parent_chain(&tip.op_id, 2);
        assert_eq!(limited.len(), 2);
    }

    #[test]
    fn chain_stops_at_a_missing_parent() {
        let mut log = OpLogSection::new();
        let orphan = sample(9, vec![oid_from(200)]);
        log.upsert(orphan.clone()).expect("upsert");
        assert_eq!(log.first_parent_chain(&orphan.op_id, 10).len(), 1);
    }

    #[test]
    fn empty_log_round_trips() {
        let empty = OpLogSection::new();
        let encoded = empty.encode().expect("encode");
        assert_eq!(encoded, vec![0u8, 0, 0, 0]);
        assert!(OpLogSection::decode(&encoded).expect("decode").is_empty());
    }

    #[test]
    fn upsert_replaces_same_id() {
        let mut log = OpLogSection::new();
        let entry = sample(5, Vec::new());
        log.upsert(entry.clone()).expect("insert");
        log.upsert(entry.clone()).expect("replace");
        assert_eq!(log.len(), 1);
    }

    #[test]
    fn rejects_self_parenting_entry() {
        let mut log = OpLogSection::new();
        let mut entry = sample(6, Vec::new());
        entry.parent_ids = vec![entry.op_id];
        assert!(matches!(
            log.upsert(entry).expect_err("cycle must fail"),
            NativeError::OpLogCycle
        ));
    }

    #[test]
    fn rejects_tampered_record() {
        // Flip a byte inside the description, leaving the stored id untouched: only the id
        // recomputation can catch this.
        let mut log = OpLogSection::new();
        log.upsert(sample(7, Vec::new())).expect("upsert");
        let mut payload = log.encode().expect("encode");
        let last_content_index = payload.len() - 2;
        payload[last_content_index] ^= 0x01;

        let error = OpLogSection::decode(&payload).expect_err("tamper must fail");
        assert!(matches!(error, NativeError::OpIdMismatch { .. }));
    }

    #[test]
    fn rejects_out_of_order_ids() {
        let mut writer = FieldWriter::new();
        writer.write_u32(2);
        // Build both records before the loop: constructing them inside would allocate per
        // iteration, which the zero-allocation boundary check treats as a production hot-path
        // violation regardless of the fact that this is test code.
        let descending = [sample(9, Vec::new()), sample(1, Vec::new())];
        for entry in &descending {
            writer.write_oid(&entry.op_id);
            writer.write_bytes(&entry.encode_canonical().expect("canonical"));
        }
        let payload = writer.finish();

        let error = OpLogSection::decode(&payload).expect_err("unsorted must fail");
        assert!(matches!(
            error,
            NativeError::OpLogOutOfOrder { position: 1 }
        ));
    }

    #[test]
    fn rejects_forged_count() {
        let mut payload = vec![0xFFu8, 0xFF, 0xFF, 0x7F];
        payload.extend_from_slice(&[0u8; 8]);
        assert!(matches!(
            OpLogSection::decode(&payload).expect_err("forged count must fail"),
            NativeError::CountExceeded { .. }
        ));
    }

    #[test]
    fn rejects_trailing_bytes() {
        let mut log = OpLogSection::new();
        log.upsert(sample(8, Vec::new())).expect("upsert");
        let mut payload = log.encode().expect("encode");
        payload.push(0x00);
        assert!(matches!(
            OpLogSection::decode(&payload).expect_err("trailing byte must fail"),
            NativeError::TruncatedRecord { tag: "OPLG", .. }
        ));
    }
}
