//! Module: fg-storage — Synthetic History Writer
//! File Path: crates/fg-storage/src/synth_write.rs
//! Architecture Role: Writes the commits and blobs a specification describes and reports what was
//!   actually stored, so history window measurements run against deterministic loose objects.
//! Dependencies & Triggers: Consumed by the history-window benchmark and its integration test.
//! Responsibilities: Write a linear history of commits, trees, and blobs straight into a loose
//!   object store, and report the byte totals a measurement needs.
//! Exit Semantics & Design Rationale:
//!   - Objects are written through [`OdbStore`], never by spawning `git`. A subprocess would put its
//!     own startup, fork, and index behaviour inside every measurement, which is exactly the cost
//!     the benchmark is trying to isolate.
//!   - Every byte is derived from the seed with a fixed SplitMix64 stream. Re-running with the same
//!     spec must produce byte-identical objects, otherwise a recorded baseline describes a workload
//!     nobody can reproduce.
//!   - The reported totals are measured from what was written, not computed from the spec. A spec
//!     field can be satisfied only approximately once churn reuses blobs, and a benchmark that
//!     trusts the request instead of the result measures its own optimism.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-STO-001`: Storage layer crash safety guard
//! - `TST-DEN-001`: Deterministic test isolation and offline reproducibility
//! - `FGT-PRF-001`: Zero transient heap allocation on hot paths

use std::path::Path;

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, Oid};
use fg_core::traits::OdbStore;
use fg_object::{GitTree, GitTreeEntry};

use super::synth_spec::{SynthRepo, SynthRepoSpec, SynthRepoStats};
use crate::loose::LooseOdb;

/// Object type name blob objects are written with.
pub const BLOB_TYPE: &str = "blob";

/// Object type name commit objects are written with.
pub const COMMIT_TYPE: &str = "commit";

/// Object type name tree objects are written with.
pub const TREE_TYPE: &str = "tree";

/// Tree fan-out: files are spread over this many leading directories.
///
/// A single flat directory would make every tree object nearly identical and undersell the tree
/// cost, so paths carry one directory level the way a real source tree does.
pub const DIRECTORY_FANOUT: u32 = 8;

/// SplitMix64 generator, inlined so payload bytes never depend on a crate version.
struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    const fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn fill(&mut self, buffer: &mut [u8]) {
        let mut cursor = 0;
        while cursor < buffer.len() {
            let word = self.next_u64().to_le_bytes();
            let take = (buffer.len() - cursor).min(word.len());
            buffer[cursor..cursor + take].copy_from_slice(&word[..take]);
            cursor += take;
        }
    }
}

struct SynthCommitBuffers {
    slot_blobs: Vec<Oid>,
    dir_trees: Vec<Oid>,
    dir_dirty: Vec<bool>,
    payload_buf: Vec<u8>,
    written: std::collections::HashSet<Oid>,
    blobs: u64,
    trees: u64,
    payload_bytes: u64,
}

fn write_commit_blobs(
    odb: &LooseOdb,
    spec: SynthRepoSpec,
    commit_index: u32,
    rng: &mut SplitMix64,
    state: &mut SynthCommitBuffers,
) -> FractalResult<()> {
    let full_tree = commit_index == 0;
    let churn_batch = spec.churn_batch();
    let batch = if full_tree {
        spec.working_tree_files
    } else {
        churn_batch.min(spec.working_tree_files)
    };
    let first_touched = if full_tree {
        0
    } else {
        (commit_index as u64 * u64::from(churn_batch) % u64::from(spec.working_tree_files)) as u32
    };
    for offset in 0..batch {
        let slot = (first_touched + offset) % spec.working_tree_files;
        rng.fill(&mut state.payload_buf);
        let blob_oid = odb.write_object(BLOB_TYPE, &state.payload_buf)?;
        state.slot_blobs[slot as usize] = blob_oid;
        state.dir_dirty[(slot % DIRECTORY_FANOUT) as usize] = true;
        if state.written.insert(blob_oid) {
            state.blobs += 1;
            state.payload_bytes += state.payload_buf.len() as u64;
        }
    }
    Ok(())
}

fn rebuild_dirty_leaf_trees(odb: &LooseOdb, state: &mut SynthCommitBuffers) -> FractalResult<u64> {
    let mut current_leaf_bytes: u64 = 0;
    for dir in 0..DIRECTORY_FANOUT {
        if !state.dir_dirty[dir as usize] {
            current_leaf_bytes += odb
                .read_object(&state.dir_trees[dir as usize])
                .map(|raw| raw.len() as u64)
                .unwrap_or(0);
            continue;
        }
        let (oid, bytes) = write_leaf_tree(odb, &state.slot_blobs, dir)?;
        state.dir_trees[dir as usize] = oid;
        state.dir_dirty[dir as usize] = false;
        current_leaf_bytes += bytes;
        if state.written.insert(oid) {
            state.trees += 1;
            state.payload_bytes += bytes;
        }
    }
    Ok(current_leaf_bytes)
}

/// Writes a synthetic repository under `root`.
///
/// The history is linear: each commit has exactly one parent. A linear shape keeps the measurement
/// focused on "how much does the tail of one history cost", which is the question a bounded window
/// answers; fan-out would add reachability structure whose cost belongs to a different benchmark.
///
/// # Errors
///
/// Propagates a rejected spec, an object-store failure, or a failed index build.
pub fn generate(root: &Path, spec: SynthRepoSpec) -> FractalResult<SynthRepo> {
    spec.validate()?;
    std::fs::create_dir_all(root).map_err(FractalError::Io)?;

    let odb = LooseOdb::without_cache(root);
    let mut rng = SplitMix64::new(spec.seed);
    let mut state = SynthCommitBuffers {
        slot_blobs: vec![Oid::ZERO; spec.working_tree_files as usize],
        dir_trees: vec![Oid::ZERO; DIRECTORY_FANOUT as usize],
        dir_dirty: vec![true; DIRECTORY_FANOUT as usize],
        payload_buf: vec![0u8; spec.bytes_per_file as usize],
        written: std::collections::HashSet::new(),
        blobs: 0,
        trees: 0,
        payload_bytes: 0,
    };

    let mut source_tree: Oid = Oid::ZERO;
    let mut root_tree: Oid = Oid::ZERO;
    let mut final_checkout_bytes: u64 = 0;
    let mut parent: Option<Oid> = None;
    let mut head = Oid::ZERO;

    for commit_index in 0..spec.commits {
        write_commit_blobs(&odb, spec, commit_index, &mut rng, &mut state)?;
        let leaf_bytes = rebuild_dirty_leaf_trees(&odb, &mut state)?;

        let (source_oid, source_bytes) = write_source_tree(&odb, &state.dir_trees)?;
        if source_oid != source_tree {
            if state.written.insert(source_oid) {
                state.trees += 1;
                state.payload_bytes += source_bytes;
            }
            source_tree = source_oid;
        }
        let (root_oid, root_bytes) = write_root_tree(&odb, source_tree)?;
        if root_oid != root_tree {
            if state.written.insert(root_oid) {
                state.trees += 1;
                state.payload_bytes += root_bytes;
            }
            root_tree = root_oid;
        }

        let payload = commit_payload(root_tree, parent, commit_index, spec.seed);
        let commit_oid = odb.write_object(COMMIT_TYPE, &payload)?;
        if state.written.insert(commit_oid) {
            state.payload_bytes += payload.len() as u64;
        }

        if commit_index + 1 == spec.commits {
            let blob_at_head: u64 = state
                .slot_blobs
                .iter()
                .map(|blob| payload_len(&odb, blob))
                .sum();
            final_checkout_bytes =
                blob_at_head + leaf_bytes + source_bytes + root_bytes + payload.len() as u64;
        }

        head = commit_oid;
        parent = Some(commit_oid);
    }

    let mut distinct_working_blobs: std::collections::HashSet<Oid> =
        std::collections::HashSet::new();
    let mut working_tree_bytes: u64 = 0;
    for blob in &state.slot_blobs {
        if distinct_working_blobs.insert(*blob) {
            working_tree_bytes += payload_len(&odb, blob);
        }
    }
    let stats = SynthRepoStats {
        commits: spec.commits,
        blobs: state.blobs,
        trees: state.trees,
        payload_bytes: state.payload_bytes,
        working_tree_bytes,
        final_checkout_bytes,
    };

    Ok(SynthRepo {
        root: root.to_path_buf(),
        head,
        stats,
    })
}

/// Directory segment names, kept as a single source so the incremental tree and any reader agree.
const SOURCE_DIR: &str = "src";

/// Returns the payload length of an object, excluding the `"<type> <len>\0"` header.
///
/// Every total in this module is in payload bytes, so the numbers can be compared with each other
/// and with the spec. Reading the header-inclusive length in one place and the payload length in
/// another made the history total silently understate itself by the sum of the headers.
fn payload_len(odb: &LooseOdb, oid: &Oid) -> u64 {
    odb.read_object(oid).map_or(0, |raw| {
        // A stored object always begins with `"<type> <len>\0"`. If the terminator is missing the
        // store is malformed; reporting the whole buffer is the conservative answer because it
        // overstates cost rather than hiding it.
        raw.iter()
            .position(|byte| *byte == 0)
            .map_or(raw.len() as u64, |nul| (raw.len() - nul - 1) as u64)
    })
}

/// Writes the leaf tree for one directory and returns its object id and serialized size.
///
/// Entries are named by file only; the containing directory name lives in its parent tree, which is
/// how Git stores a path. Naming the full path here would duplicate the directory into every entry.
///
/// # Errors
///
/// Propagates any object-store write failure.
pub fn write_leaf_tree(
    odb: &LooseOdb,
    slot_blobs: &[Oid],
    directory: u32,
) -> FractalResult<(Oid, u64)> {
    let mut entries: Vec<GitTreeEntry> = Vec::new();
    for (slot, blob) in slot_blobs.iter().enumerate() {
        if slot as u32 % DIRECTORY_FANOUT != directory {
            continue;
        }
        entries.push(GitTreeEntry::new(
            FileMode::RegularFile,
            format!("f{slot:06}.rs"),
            *blob,
        ));
    }
    let payload = GitTree::serialize_sorted_entries(&mut entries);
    let oid = odb.write_object(TREE_TYPE, &payload)?;
    Ok((oid, payload.len() as u64))
}

/// Writes the `src` tree over the directory object ids.
///
/// # Errors
///
/// Propagates any object-store write failure.
pub fn write_source_tree(odb: &LooseOdb, dir_trees: &[Oid]) -> FractalResult<(Oid, u64)> {
    let mut entries: Vec<GitTreeEntry> = Vec::new();
    for (dir, tree) in dir_trees.iter().enumerate() {
        entries.push(GitTreeEntry::new(
            FileMode::Directory,
            format!("d{dir}"),
            *tree,
        ));
    }
    let payload = GitTree::serialize_sorted_entries(&mut entries);
    let oid = odb.write_object(TREE_TYPE, &payload)?;
    Ok((oid, payload.len() as u64))
}

/// Writes the repository root tree, whose only entry is the `src` directory.
///
/// The root is kept as a separate level so the generated history has the same shape the canonical
/// index builder produces for `src/dN/fN.rs` paths; a flattened root would change every tree object
/// id and make the two builders disagree.
///
/// # Errors
///
/// Propagates any object-store write failure.
pub fn write_root_tree(odb: &LooseOdb, source_tree: Oid) -> FractalResult<(Oid, u64)> {
    let mut entries: Vec<GitTreeEntry> = vec![GitTreeEntry::new(
        FileMode::Directory,
        SOURCE_DIR,
        source_tree,
    )];
    let payload = GitTree::serialize_sorted_entries(&mut entries);
    let oid = odb.write_object(TREE_TYPE, &payload)?;
    Ok((oid, payload.len() as u64))
}

/// Renders a commit payload with a single optional parent.
#[must_use]
pub fn commit_payload(tree: Oid, parent: Option<Oid>, index: u32, seed: u64) -> Vec<u8> {
    let mut text = format!("tree {tree}\n");
    if let Some(parent) = parent {
        text.push_str(&format!("parent {parent}\n"));
    }
    let timestamp = 1_700_000_000u64 + u64::from(index);
    text.push_str(&format!(
        "author Synth <synth@example.invalid> {timestamp} +0000\n"
    ));
    text.push_str(&format!(
        "committer Synth <synth@example.invalid> {timestamp} +0000\n"
    ));
    text.push_str(&format!("\nsynthetic commit {index} seed {seed:016x}\n"));
    text.into_bytes()
}
