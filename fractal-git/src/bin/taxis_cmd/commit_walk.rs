//! Module: taxis_cmd::commit_walk — Native Commit DAG Traversal
//! File Path: src/bin/taxis_cmd/commit_walk.rs
//! Architecture Role: Walks the commit DAG straight from the object store, producing the telemetry
//!   nodes `rev-list` counts and the ancestry order `log` would print.
//! Dependencies & Triggers: Consumed by `rev-list`; replaces a former `git log` subprocess call.
//! Responsibilities: Parent extraction, author-mailbox classification, and a bounded date-ordered
//!   traversal with cycle detection.
//! Exit Semantics & Design Rationale:
//!   - Traversal starts at the given tips with a visited set and lists a commit only once every
//!     child reachable from those tips has been listed, breaking ties by committer date, which is
//!     what git log --date-order promises. A commit graph is not guaranteed acyclic by its bytes
//!     alone: a forged or hand-edited repository can name a child as its own ancestor, so the walk
//!     keeps a visited set and lists any cycle-blocked commits in discovery order.
//!   - A commit that cannot be read is an error, not a skipped node. Skipping it would under-count
//!     history and make the anti-inflation model report a smaller repository than exists.
//!   - Classification matches what the previous `git log --format` bridge derived: an agent mailbox
//!     suffix or an in-body agent trailer marks a micro-commit, and two or more parents marks a
//!     promotion merge. Keeping the definition identical means the counts are comparable across the
//!     change rather than merely plausible.

use std::collections::{BinaryHeap, HashMap, HashSet, VecDeque};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fractal_git::TelemetryCommitNode;

use super::repo_view::RepoView;

/// Suffix that marks an autonomous agent mailbox rather than a human identity.
const AGENT_MAILBOX_SUFFIX: &str = ".praxis.local";

/// Trailer emitted by agent-authored commits inside the commit message body.
const AGENT_META_TRAILER: &str = "Praxis-Agent-Meta:";

/// Ceiling on how many commits one traversal may visit.
///
/// A repository larger than this is not something this build claims to handle; refusing is better
/// than an unbounded walk that appears to hang.
pub const MAX_WALK_COMMITS: usize = 1_000_000;

/// One commit's classification, derived from its own payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitRecord {
    /// Commit object id.
    pub oid: Oid,
    /// Tree the commit names.
    pub tree: Oid,
    /// Parent commit ids in the order the payload lists them.
    pub parents: Vec<Oid>,
    /// Author mailbox as written in the payload.
    pub author_mailbox: String,
    /// Author name as written in the payload.
    pub author_name: String,
    /// Author timestamp, seconds since the Unix epoch.
    pub author_time: i64,
    /// Author timezone offset in minutes east of UTC, as recorded.
    pub author_offset_minutes: i32,
    /// Committer name as written in the payload.
    pub committer_name: String,
    /// Committer mailbox as written in the payload.
    pub committer_mailbox: String,
    /// Committer timestamp, seconds since the Unix epoch.
    pub committer_time: i64,
    /// Committer timezone offset in minutes east of UTC, as recorded.
    pub committer_offset_minutes: i32,
    /// Message body after the blank separator line.
    pub message: String,
}

impl CommitRecord {
    /// Reports whether the commit was authored by an autonomous agent.
    pub fn is_agent_authored(&self) -> bool {
        self.author_mailbox.ends_with(AGENT_MAILBOX_SUFFIX)
            || self.message.contains(AGENT_META_TRAILER)
    }

    /// Returns the first line of the message, which is the subject.
    pub fn subject(&self) -> &str {
        self.message.lines().next().unwrap_or("")
    }

    /// Projects this record onto the telemetry node the counter consumes.
    pub fn to_telemetry_node(&self) -> TelemetryCommitNode {
        let agent = self.is_agent_authored();
        TelemetryCommitNode {
            oid: self.oid,
            parent_oids: self.parents.clone(),
            is_human_signed: !agent,
            is_promotion_merge: self.parents.len() >= 2,
            is_agent_micro_commit: agent,
        }
    }
}

/// One identified person and the time they acted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    /// Display name.
    pub name: String,
    /// Mailbox without the angle brackets.
    pub mailbox: String,
    /// Seconds since the Unix epoch.
    pub time: i64,
    /// Timezone offset in minutes east of UTC.
    pub offset_minutes: i32,
}

/// Parses an `author` or `committer` header value: `Name <mailbox> <seconds> <±HHMM>`.
///
/// The name may itself contain angle brackets, so the mailbox is delimited by the *last* `<` rather
/// than the first. Splitting on the first one truncates a name like `A <bot> Runner` and silently
/// attributes the commit to a different mailbox.
fn parse_signature(value: &str) -> Signature {
    let trimmed = value.trim();
    let (name, rest) = match trimmed.rfind('<') {
        Some(open) => (trimmed[..open].trim(), &trimmed[open + 1..]),
        None => (trimmed, ""),
    };
    let (mailbox, tail) = match rest.find('>') {
        Some(close) => (&rest[..close], rest[close + 1..].trim()),
        None => (rest, ""),
    };
    let mut fields = tail.split_whitespace();
    let time = fields
        .next()
        .and_then(|text| text.parse::<i64>().ok())
        .unwrap_or(0);
    let offset_minutes = fields.next().map(parse_offset).unwrap_or(0);
    Signature {
        name: name.to_string(),
        mailbox: mailbox.trim().to_string(),
        time,
        offset_minutes,
    }
}

/// Converts a `+HHMM` / `-HHMM` zone into minutes east of UTC.
fn parse_offset(text: &str) -> i32 {
    let bytes = text.as_bytes();
    if bytes.len() < 5 {
        return 0;
    }
    let sign = if bytes[0] == b'-' { -1 } else { 1 };
    let digits = &text[1..];
    let hours: i32 = digits[..2].parse().unwrap_or(0);
    let minutes: i32 = digits[2..4].parse().unwrap_or(0);
    sign * (hours * 60 + minutes)
}

/// Parses a commit payload into a record.
///
/// # Errors
///
/// Returns [`FractalError::ObjectCodec`] when the payload is not UTF-8, has no `tree` header, or
/// carries a malformed `parent` or `author` line.
pub fn parse_commit_record(oid: Oid, payload: &[u8]) -> FractalResult<CommitRecord> {
    let text = std::str::from_utf8(payload).map_err(|utf_err| {
        FractalError::ObjectCodec(format!("commit payload is not UTF-8: {utf_err}"))
    })?;

    let mut tree: Option<Oid> = None;
    let mut parents: Vec<Oid> = Vec::new();
    let mut author = Signature {
        name: String::new(),
        mailbox: String::new(),
        time: 0,
        offset_minutes: 0,
    };
    let mut committer = author.clone();
    let mut body_offset = text.len();

    for (offset, line) in line_offsets(text) {
        if line.is_empty() {
            body_offset = offset + 1;
            break;
        }
        if let Some(value) = line.strip_prefix("tree ") {
            tree = Some(Oid::from_hex(value.trim())?);
            continue;
        }
        if let Some(value) = line.strip_prefix("parent ") {
            parents.push(Oid::from_hex(value.trim())?);
            continue;
        }
        if let Some(value) = line.strip_prefix("author ") {
            author = parse_signature(value);
            continue;
        }
        if let Some(value) = line.strip_prefix("committer ") {
            committer = parse_signature(value);
        }
    }

    let tree = tree.ok_or_else(|| {
        FractalError::ObjectCodec(format!("commit {} has no 'tree' header", oid.to_hex()))
    })?;
    Ok(CommitRecord {
        oid,
        tree,
        parents,
        author_name: author.name,
        author_mailbox: author.mailbox,
        author_time: author.time,
        author_offset_minutes: author.offset_minutes,
        committer_name: committer.name,
        committer_mailbox: committer.mailbox,
        committer_time: committer.time,
        committer_offset_minutes: committer.offset_minutes,
        message: text[body_offset..].to_string(),
    })
}

/// Yields `(byte offset, line)` pairs for every header line.
fn line_offsets(text: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut offset = 0usize;
    text.split('\n').map(move |line| {
        let current = offset;
        offset += line.len() + 1;
        (current, line.trim_end_matches('\r'))
    })
}

/// Walks every commit reachable from starts and returns them in Git's date order.
///
/// The walk implements what git log --date-order promises: no commit is listed before one of its
/// children, and among the commits that are free to be listed the newest committer timestamp wins,
/// with ties broken by discovery order. A plain breadth-first walk gets the first property but not
/// the second, so a merge side branch appeared in the wrong place; a plain newest-first queue gets
/// the second but can list a parent before a child whose date is older.
///
/// # Errors
///
/// Returns FractalError::ObjectCodec when a reachable commit is missing or is not a commit, and
/// refuses a traversal that exceeds MAX_WALK_COMMITS.
pub fn walk_commits(view: &RepoView, starts: &[Oid]) -> FractalResult<Vec<CommitRecord>> {
    let mut discovered: HashSet<Oid> = HashSet::new();
    let mut queue: VecDeque<Oid> = VecDeque::new();
    for start in starts {
        if discovered.insert(*start) {
            queue.push_back(*start);
        }
    }

    let mut records: HashMap<Oid, CommitRecord> = HashMap::new();
    let mut child_count: HashMap<Oid, usize> = HashMap::new();
    let mut discovery_order: Vec<Oid> = Vec::new();
    while let Some(oid) = queue.pop_front() {
        if records.len() >= MAX_WALK_COMMITS {
            return Err(FractalError::ObjectCodec(format!(
                "commit traversal exceeded {MAX_WALK_COMMITS} commits; refusing to continue"
            )));
        }
        let object = view.object(&oid)?;
        if object.kind != fg_core::models::ObjectKind::Commit {
            return Err(FractalError::ObjectCodec(format!(
                "{} is a {}, not a commit",
                oid.to_hex(),
                object.kind.as_str()
            )));
        }
        let record = parse_commit_record(oid, &object.payload)?;
        for parent in &record.parents {
            *child_count.entry(*parent).or_insert(0) += 1;
            if discovered.insert(*parent) {
                queue.push_back(*parent);
            }
        }
        discovery_order.push(oid);
        records.insert(oid, record);
    }

    let mut order = Vec::with_capacity(records.len());
    let mut ready: BinaryHeap<DateOrderKey> = BinaryHeap::new();
    let mut sequence = 0usize;
    for start in starts {
        if child_count.get(start).copied().unwrap_or(0) == 0 {
            enqueue_ready(*start, &records, &mut ready, &mut sequence);
        }
    }
    let mut emitted: HashSet<Oid> = HashSet::new();
    while let Some(key) = ready.pop() {
        if !emitted.insert(key.oid) {
            continue;
        }
        let Some(record) = records.get(&key.oid) else {
            continue;
        };
        let parents = record.parents.clone();
        order.push(record.clone());
        for parent in &parents {
            let remaining = child_count.entry(*parent).or_insert(0);
            *remaining = remaining.saturating_sub(1);
            if *remaining == 0 {
                enqueue_ready(*parent, &records, &mut ready, &mut sequence);
            }
        }
    }
    // A forged or hand-edited history can contain a cycle, which leaves those commits permanently
    // blocked. Listing them in discovery order keeps the walk total instead of dropping history.
    for oid in &discovery_order {
        if emitted.contains(oid) {
            continue;
        }
        if let Some(record) = records.get(oid) {
            order.push(record.clone());
        }
    }
    Ok(order)
}

/// Orders commits the way git log --date-order does: newest commit date first, then discovery order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DateOrderKey {
    committer_time: i64,
    sequence: usize,
    oid: Oid,
}

impl Ord for DateOrderKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.committer_time
            .cmp(&other.committer_time)
            .then_with(|| other.sequence.cmp(&self.sequence))
    }
}

impl PartialOrd for DateOrderKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Queues one commit for listing, remembering its discovery order as the tie breaker.
fn enqueue_ready(
    oid: Oid,
    records: &HashMap<Oid, CommitRecord>,
    ready: &mut BinaryHeap<DateOrderKey>,
    sequence: &mut usize,
) {
    let Some(record) = records.get(&oid) else {
        return;
    };
    ready.push(DateOrderKey {
        committer_time: record.committer_time,
        sequence: *sequence,
        oid,
    });
    *sequence += 1;
}

#[cfg(test)]
mod tests {
    use super::{parse_commit_record, parse_offset, parse_signature, CommitRecord};
    use fg_core::models::Oid;

    fn oid_of(seed: u8) -> Oid {
        Oid::from_bytes([seed; 20])
    }

    #[test]
    fn parses_a_root_commit_with_one_parent_list_entry() {
        let payload = concat!(
            "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n",
            "author Cell Agent <agent@cell.praxis.local> 1700000000 +0000\n",
            "committer Cell Agent <agent@cell.praxis.local> 1700000000 +0000\n",
            "\n",
            "feat: something\n"
        );
        let record = parse_commit_record(oid_of(1), payload.as_bytes()).expect("parse");
        assert_eq!(record.parents.len(), 0);
        assert_eq!(record.author_mailbox, "agent@cell.praxis.local");
        assert!(record.is_agent_authored());
        assert_eq!(record.message.trim(), "feat: something");
    }

    #[test]
    fn parses_a_merge_commit_with_two_parents() {
        let first = oid_of(2).to_hex();
        let second = oid_of(3).to_hex();
        let payload = format!(
            "tree {tree}\nparent {first}\nparent {second}\nauthor N <n@example.test> 1 +0000\n\nmerge\n",
            tree = oid_of(4).to_hex()
        );
        let record = parse_commit_record(oid_of(5), payload.as_bytes()).expect("parse");
        assert_eq!(record.parents, vec![oid_of(2), oid_of(3)]);
        assert!(record.to_telemetry_node().is_promotion_merge);
    }

    #[test]
    fn a_human_commit_is_not_an_agent_micro_commit() {
        let payload = format!(
            "tree {tree}\nauthor H <h@example.test> 1 +0000\n\nplain\n",
            tree = oid_of(6).to_hex()
        );
        let record = parse_commit_record(oid_of(7), payload.as_bytes()).expect("parse");
        assert!(!record.is_agent_authored());
        assert!(record.to_telemetry_node().is_human_signed);
    }

    #[test]
    fn an_agent_trailer_marks_the_commit_as_agent_authored() {
        let payload = format!(
            "tree {tree}\nauthor H <h@example.test> 1 +0000\n\nbody\nPraxis-Agent-Meta: x\n",
            tree = oid_of(8).to_hex()
        );
        let record = parse_commit_record(oid_of(9), payload.as_bytes()).expect("parse");
        assert!(record.is_agent_authored());
    }

    #[test]
    fn rejects_a_commit_without_a_tree_header() {
        let payload = b"author H <h@example.test> 1 +0000\n\nbody\n";
        assert!(parse_commit_record(oid_of(10), payload).is_err());
    }

    #[test]
    fn parses_a_full_signature_with_time_and_zone() {
        let signature = parse_signature("Name Here <mail@example.test> 1700000000 +0800");
        assert_eq!(signature.name, "Name Here");
        assert_eq!(signature.mailbox, "mail@example.test");
        assert_eq!(signature.time, 1_700_000_000);
        assert_eq!(signature.offset_minutes, 480);
    }

    #[test]
    fn a_name_containing_brackets_keeps_its_full_text() {
        // The mailbox is delimited by the *last* '<', so a name with brackets is not truncated.
        let signature = parse_signature("A <bot> Runner <runner@example.test> 5 -0130");
        assert_eq!(signature.name, "A <bot> Runner");
        assert_eq!(signature.mailbox, "runner@example.test");
        assert_eq!(signature.offset_minutes, -90);
    }

    #[test]
    fn a_value_without_brackets_is_kept_trimmed() {
        let signature = parse_signature("  bare  ");
        assert_eq!(signature.name, "bare");
        assert_eq!(signature.mailbox, "");
        assert_eq!(signature.time, 0);
    }

    #[test]
    fn a_negative_offset_round_trips() {
        assert_eq!(parse_offset("-0730"), -450);
        assert_eq!(parse_offset("+0000"), 0);
        assert_eq!(parse_offset("bad"), 0);
    }

    #[test]
    fn the_subject_is_the_first_message_line() {
        let payload = format!(
            "tree {tree}\nauthor H <h@example.test> 1 +0000\n\nsubject line\n\nbody line\n",
            tree = oid_of(14).to_hex()
        );
        let record = parse_commit_record(oid_of(15), payload.as_bytes()).expect("parse");
        assert_eq!(record.subject(), "subject line");
    }

    #[test]
    fn a_record_projects_its_parents_verbatim() {
        let record = CommitRecord {
            oid: oid_of(11),
            tree: oid_of(12),
            parents: vec![oid_of(13)],
            author_name: "x".to_string(),
            author_mailbox: "x@example.test".to_string(),
            author_time: 0,
            author_offset_minutes: 0,
            committer_name: "x".to_string(),
            committer_mailbox: "x@example.test".to_string(),
            committer_time: 0,
            committer_offset_minutes: 0,
            message: String::new(),
        };
        assert_eq!(record.to_telemetry_node().parent_oids, vec![oid_of(13)]);
    }
}
