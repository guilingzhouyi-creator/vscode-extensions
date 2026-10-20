//! Module: fg-object — Zero-Copy Borrowed Git Object Codecs
//! File Path: crates/fg-object/src/borrowed.rs
//! Architecture Role: High-throughput zero-copy borrowed Git object views (GitCommitRef,
//!   GitTreeRef, GitTreeIter) aligned with gitoxide's memory-efficiency principles.
//!   Eliminates heap allocation when reading and parsing objects in hot DAG traversal paths.

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{AgentCommitMeta, Oid};
use std::str;

use crate::tree::FileMode;

/// Inline parent list storing up to 2 parent OIDs with zero heap allocation.
/// Falls back to dynamic vector only for octopus merges with 3+ parents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmallParentList {
    inline_parents: [Oid; 2],
    count: u8,
    extra_parents: Option<Vec<Oid>>,
}

impl Default for SmallParentList {
    fn default() -> Self {
        Self::new()
    }
}

impl SmallParentList {
    /// Creates an empty small parent list.
    pub const fn new() -> Self {
        Self {
            inline_parents: [Oid::ZERO, Oid::ZERO],
            count: 0,
            extra_parents: None,
        }
    }

    /// Appends a parent commit OID to the list.
    pub fn push(&mut self, parent_oid: Oid) {
        if self.count < 2 {
            self.inline_parents[self.count as usize] = parent_oid;
            self.count += 1;
        } else if let Some(ref mut extra) = self.extra_parents {
            extra.push(parent_oid);
            self.count = self.count.saturating_add(1);
        } else {
            let mut extra = Vec::with_capacity(4);
            extra.push(self.inline_parents[0]);
            extra.push(self.inline_parents[1]);
            extra.push(parent_oid);
            self.extra_parents = Some(extra);
            self.count = 3;
        }
    }

    /// Returns the number of parent commits.
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.count as usize
    }

    /// Returns true if the commit has zero parents (root commit).
    #[inline(always)]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Returns the parent OIDs as a contiguous slice.
    pub fn as_slice(&self) -> &[Oid] {
        if let Some(ref extra) = self.extra_parents {
            extra.as_slice()
        } else {
            &self.inline_parents[..self.count as usize]
        }
    }

    /// Returns the first parent OID if present.
    #[inline(always)]
    pub fn first(&self) -> Option<&Oid> {
        self.as_slice().first()
    }
}

/// Zero-copy borrowed view of a Git commit object.
#[derive(Debug, Clone, PartialEq)]
pub struct GitCommitRef<'a> {
    tree_oid: Oid,
    parents: SmallParentList,
    author: &'a str,
    committer: &'a str,
    message: &'a str,
    agent_meta: Option<AgentCommitMeta>,
}

impl<'a> GitCommitRef<'a> {
    /// Parses a Git commit payload byte slice without heap-allocating headers or message.
    pub fn parse(payload: &'a [u8]) -> FractalResult<Self> {
        let text = str::from_utf8(payload)
            .map_err(|utf_err| FractalError::ObjectCodec(utf_err.to_string()))?;

        let mut tree_oid_opt: Option<Oid> = None;
        let mut parents = SmallParentList::new();
        let mut author_str = "";
        let mut committer_str = "";
        let mut body_start_idx = text.len();

        let mut current_idx = 0;
        for line in text.split_inclusive('\n') {
            let line_end = current_idx + line.len();
            let trimmed = line.trim_end_matches(['\r', '\n']);

            if trimmed.is_empty() {
                body_start_idx = line_end;
                break;
            }

            if let Some(tree_hex) = trimmed.strip_prefix("tree ") {
                tree_oid_opt = Some(Oid::from_hex(tree_hex.trim())?);
            } else if let Some(parent_hex) = trimmed.strip_prefix("parent ") {
                parents.push(Oid::from_hex(parent_hex.trim())?);
            } else if let Some(author_val) = trimmed.strip_prefix("author ") {
                author_str = author_val;
            } else if let Some(committer_val) = trimmed.strip_prefix("committer ") {
                committer_str = committer_val;
            }

            current_idx = line_end;
        }

        let tree_oid = tree_oid_opt.ok_or_else(|| {
            FractalError::ObjectCodec("Missing required 'tree' header in commit".into())
        })?;

        let full_body = if body_start_idx < text.len() {
            &text[body_start_idx..]
        } else {
            ""
        };

        // Extract Praxis-Agent-Meta JSON trailer if embedded
        let (message, agent_meta) = if let Some(trailer_idx) = full_body.find("Praxis-Agent-Meta: ")
        {
            let user_msg = full_body[..trailer_idx].trim_end();
            let meta_json = full_body[trailer_idx + 19..].trim();
            let parsed_meta = serde_json::from_str::<AgentCommitMeta>(meta_json).ok();
            (user_msg, parsed_meta)
        } else {
            (full_body, None)
        };

        Ok(Self {
            tree_oid,
            parents,
            author: author_str,
            committer: committer_str,
            message,
            agent_meta,
        })
    }

    /// Access the root tree OID.
    #[inline(always)]
    pub fn tree_oid(&self) -> &Oid {
        &self.tree_oid
    }

    /// Access the small parent list.
    #[inline(always)]
    pub fn parents(&self) -> &SmallParentList {
        &self.parents
    }

    /// Access the raw author header slice.
    #[inline(always)]
    pub fn author(&self) -> &'a str {
        self.author
    }

    /// Access the raw committer header slice.
    #[inline(always)]
    pub fn committer(&self) -> &'a str {
        self.committer
    }

    /// Access the commit message slice.
    #[inline(always)]
    pub fn message(&self) -> &'a str {
        self.message
    }

    /// Access structured AgentCommitMeta if present.
    #[inline(always)]
    pub fn agent_meta(&self) -> Option<&AgentCommitMeta> {
        self.agent_meta.as_ref()
    }
}

/// Zero-copy borrowed view of a single tree entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GitTreeEntryRef<'a> {
    pub mode: FileMode,
    pub name: &'a str,
    pub oid: Oid,
}

/// Streaming zero-allocation iterator over Git tree entries.
pub struct GitTreeIter<'a> {
    remaining_bytes: &'a [u8],
}

impl<'a> Iterator for GitTreeIter<'a> {
    type Item = FractalResult<GitTreeEntryRef<'a>>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining_bytes.is_empty() {
            return None;
        }

        // Find space separator after file mode: "<mode> <name>\0<20-byte-oid>"
        let space_idx = match self
            .remaining_bytes
            .iter()
            .position(|&byte_val| byte_val == b' ')
        {
            Some(idx) => idx,
            None => {
                return Some(Err(FractalError::ObjectCodec(
                    "Malformed tree entry: missing space after mode".into(),
                )));
            }
        };

        let mode_bytes = &self.remaining_bytes[..space_idx];
        let mode = match mode_bytes {
            b"100644" => FileMode::RegularFile,
            b"100755" => FileMode::ExecutableFile,
            b"40000" | b"040000" => FileMode::Directory,
            b"120000" => FileMode::Symlink,
            other => {
                return Some(Err(FractalError::ObjectCodec(format!(
                    "Unsupported file mode in tree entry: {:?}",
                    String::from_utf8_lossy(other)
                ))));
            }
        };

        let after_space = &self.remaining_bytes[space_idx + 1..];
        let null_idx = match after_space.iter().position(|&byte_val| byte_val == 0) {
            Some(idx) => idx,
            None => {
                return Some(Err(FractalError::ObjectCodec(
                    "Malformed tree entry: missing null byte terminator".into(),
                )));
            }
        };

        let name_bytes = &after_space[..null_idx];
        let name_str = match str::from_utf8(name_bytes) {
            Ok(valid_str) => valid_str,
            Err(utf_err) => {
                return Some(Err(FractalError::ObjectCodec(format!(
                    "Invalid UTF-8 in entry name: {}",
                    utf_err
                ))));
            }
        };

        let after_null = &after_space[null_idx + 1..];
        if after_null.len() < 20 {
            return Some(Err(FractalError::ObjectCodec(
                "Truncated tree entry: insufficient bytes for 20-byte OID".into(),
            )));
        }

        let mut oid_bytes = [0u8; 20];
        oid_bytes.copy_from_slice(&after_null[..20]);
        let entry_oid = Oid::from_bytes(oid_bytes);

        self.remaining_bytes = &after_null[20..];
        Some(Ok(GitTreeEntryRef {
            mode,
            name: name_str,
            oid: entry_oid,
        }))
    }
}

/// Zero-copy borrowed view of a canonical Git tree object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GitTreeRef<'a> {
    payload: &'a [u8],
}

impl<'a> GitTreeRef<'a> {
    /// Creates a borrowed tree view over raw tree entry bytes.
    #[inline(always)]
    pub fn from_bytes(payload: &'a [u8]) -> Self {
        Self { payload }
    }

    /// Returns a zero-allocation streaming iterator over all tree entries.
    #[inline(always)]
    pub fn iter(&self) -> GitTreeIter<'a> {
        GitTreeIter {
            remaining_bytes: self.payload,
        }
    }

    /// Finds a single named entry within the tree using linear streaming scan.
    pub fn find_entry(&self, target_name: &str) -> FractalResult<Option<GitTreeEntryRef<'a>>> {
        for entry_res in self.iter() {
            let entry = entry_res?;
            if entry.name == target_name {
                return Ok(Some(entry));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::{FileMode, GitTree, GitTreeEntry};

    #[test]
    fn test_small_parent_list_inline_and_extra() {
        let mut list = SmallParentList::new();
        assert!(list.is_empty());
        assert_eq!(list.len(), 0);

        let parent_one = Oid::from_bytes([1u8; 20]);
        list.push(parent_one);
        assert_eq!(list.len(), 1);
        assert_eq!(list.as_slice(), &[parent_one]);
        assert_eq!(list.first(), Some(&parent_one));

        let parent_two = Oid::from_bytes([2u8; 20]);
        list.push(parent_two);
        assert_eq!(list.len(), 2);
        assert_eq!(list.as_slice(), &[parent_one, parent_two]);

        // 3rd parent triggers extra allocation
        let parent_three = Oid::from_bytes([3u8; 20]);
        list.push(parent_three);
        assert_eq!(list.len(), 3);
        assert_eq!(list.as_slice(), &[parent_one, parent_two, parent_three]);
    }

    #[test]
    fn test_git_commit_ref_zero_copy_parsing() {
        let commit_raw = concat!(
            "tree 1111111111111111111111111111111111111111\n",
            "parent 2222222222222222222222222222222222222222\n",
            "author Linus Torvalds <torvalds@kernel.org> 1112911993 -0700\n",
            "committer Linus Torvalds <torvalds@kernel.org> 1112911993 -0700\n",
            "\n",
            "Initial commit of Linux\n",
            "\n",
            "Praxis-Agent-Meta: {\"card_context\":{\"card_id\":\"card-01\",\"cell_id\":",
            "\"cell-core\",\"agent_uid\":\"agent-007\",\"role\":\"engineer\"},",
            "\"quality_score\":98.5,\"gate_status\":\"PASS\",\"timestamp_ms\":1700000000000}\n"
        );

        let parsed = GitCommitRef::parse(commit_raw.as_bytes()).expect("Valid commit parse");
        assert_eq!(
            parsed.tree_oid().to_hex(),
            "1111111111111111111111111111111111111111"
        );
        assert_eq!(parsed.parents().len(), 1);
        assert_eq!(
            parsed.parents().as_slice()[0].to_hex(),
            "2222222222222222222222222222222222222222"
        );
        assert!(parsed.author().contains("Linus Torvalds"));
        assert!(parsed.committer().contains("torvalds@kernel.org"));
        assert_eq!(parsed.message(), "Initial commit of Linux");

        let meta = parsed.agent_meta().expect("Agent meta should be parsed");
        assert_eq!(meta.card_context.agent_uid, "agent-007");
        assert_eq!(meta.gate_status, "PASS");
        assert_eq!(meta.quality_score, 98.5);
    }

    #[test]
    fn test_git_tree_ref_zero_copy_iteration() {
        let entry_one = GitTreeEntry::new(
            FileMode::RegularFile,
            "README.md",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        );
        let entry_two = GitTreeEntry::new(
            FileMode::Directory,
            "src",
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        );
        let tree = GitTree::new(vec![entry_one, entry_two]);
        let raw_object = tree.to_raw_object();

        // Extract payload after null terminator in loose object: "tree <size>\0<entries>"
        let null_pos = raw_object.iter().position(|&b| b == 0).unwrap();
        let payload = &raw_object[null_pos + 1..];

        let tree_ref = GitTreeRef::from_bytes(payload);
        let parsed_entries: Vec<GitTreeEntryRef> =
            tree_ref.iter().map(|res| res.unwrap()).collect();

        assert_eq!(parsed_entries.len(), 2);
        assert_eq!(parsed_entries[0].name, "README.md");
        assert_eq!(parsed_entries[0].mode, FileMode::RegularFile);
        assert_eq!(
            parsed_entries[0].oid.to_hex(),
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );

        assert_eq!(parsed_entries[1].name, "src");
        assert_eq!(parsed_entries[1].mode, FileMode::Directory);
        assert_eq!(
            parsed_entries[1].oid.to_hex(),
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        );

        let found = tree_ref
            .find_entry("README.md")
            .unwrap()
            .expect("README.md found");
        assert_eq!(found.name, "README.md");
        assert_eq!(tree_ref.find_entry("nonexistent.txt").unwrap(), None);
    }
}
