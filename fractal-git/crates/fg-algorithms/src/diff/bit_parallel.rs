//! Module: fg-algorithms::diff::bit_parallel — 64-Bit Register-Level Bit-Parallel Myers/LCS
//! File Path: crates/fg-algorithms/src/diff/bit_parallel.rs
//! Architecture Role: Pure algorithmic operator computing exact edit distance and alignment
//!   for sequences of length <= 64 lines using Gene Myers' 1999 & Crochemore's 2001
//!   bit-vector recurrence.
//! Dependencies & Triggers: Consumed by DiffEngine / PatchGenerator when
//!   max(lines_A, lines_B) <= 64.
//! Responsibilities: Computes optimal Myers/LCS changed flags in O((M * N) / 64) with zero heap
//!   allocation in the core matching loop, eliminating branch mispredictions.
//! Exit Semantics & Design Rationale:
//!   - Stack allocated `[u64; 64]` table for column bitmasks (at most 512 bytes on stack).
//!   - Hardware POPCNT instruction computes exact LCS cell scores in O(1) clock cycles.
//!   - Backtracking traces the optimal edit path, returning exact `(Vec<bool>, Vec<bool>)`
//!     identifying deleted and added line positions.
//!
//! Domain Governance Rules: FGT-ALG-001 (bit-parallel alignment), FGT-COR-001, FGT-PRF-001.

/// Maximum line count supported by the single-word 64-bit parallel register engine.
pub const BIT_PARALLEL_MAX_LINES: usize = 64;

/// Stack-allocated open-addressing lookup table for 64-bit pattern equality bitmasks (Peq).
/// Stores up to 64 distinct symbol hashes with at most 50% load factor in 128 slots.
#[derive(Debug)]
struct PeqTable {
    keys: [u32; 128],
    masks: [u64; 128],
    occupied: [u64; 2],
}

impl PeqTable {
    #[inline(always)]
    fn new() -> Self {
        Self {
            keys: [0u32; 128],
            masks: [0u64; 128],
            occupied: [0u64; 2],
        }
    }

    #[inline(always)]
    fn insert(&mut self, hash: u32, row_bit: u64) {
        let mut slot = (hash as usize) & 127;
        loop {
            let word_idx = slot / 64;
            let bit = 1u64 << (slot % 64);
            if (self.occupied[word_idx] & bit) == 0 {
                self.occupied[word_idx] |= bit;
                self.keys[slot] = hash;
                self.masks[slot] = row_bit;
                return;
            }
            if self.keys[slot] == hash {
                self.masks[slot] |= row_bit;
                return;
            }
            slot = (slot + 1) & 127;
        }
    }

    #[inline(always)]
    fn get(&self, hash: u32) -> u64 {
        let mut slot = (hash as usize) & 127;
        loop {
            let word_idx = slot / 64;
            let bit = 1u64 << (slot % 64);
            if (self.occupied[word_idx] & bit) == 0 {
                return 0;
            }
            if self.keys[slot] == hash {
                return self.masks[slot];
            }
            slot = (slot + 1) & 127;
        }
    }
}

/// Reusable scratch state for bit-parallel diff, avoiding per-invocation heap allocations.
#[derive(Debug, Default, Clone)]
pub struct BitParallelDiffState {
    pub old_changed: Vec<bool>,
    pub new_changed: Vec<bool>,
}

impl BitParallelDiffState {
    /// Creates a new scratch buffer with pre-allocated capacity for bit-parallel diffing.
    pub fn new() -> Self {
        Self {
            old_changed: Vec::with_capacity(BIT_PARALLEL_MAX_LINES),
            new_changed: Vec::with_capacity(BIT_PARALLEL_MAX_LINES),
        }
    }

    /// Resets internal scratch buffers for new input lengths without dropping allocated capacity.
    pub fn reset(&mut self, old_count: usize, new_count: usize) {
        self.old_changed.clear();
        self.old_changed.resize(old_count, false);
        self.new_changed.clear();
        self.new_changed.resize(new_count, false);
    }
}

/// Computes the longest common subsequence alignment into reusable buffers.
pub fn bit_parallel_diff_with_state(
    old_hashes: &[u32],
    new_hashes: &[u32],
    state: &mut BitParallelDiffState,
) {
    let old_count = old_hashes.len();
    let new_count = new_hashes.len();

    if old_count == 0
        || new_count == 0
        || old_count > BIT_PARALLEL_MAX_LINES
        || new_count > BIT_PARALLEL_MAX_LINES
    {
        state.old_changed.clear();
        state.old_changed.resize(old_count, true);
        state.new_changed.clear();
        state.new_changed.resize(new_count, true);
        return;
    }

    let column_bitmasks = compute_column_bitmasks(old_hashes, new_hashes);
    state.reset(old_count, new_count);

    backtrack_alignment_path(
        &column_bitmasks,
        old_hashes,
        new_hashes,
        &mut state.old_changed,
        &mut state.new_changed,
    );
}

/// Computes the longest common subsequence alignment between `old_hashes` and `new_hashes`
/// using 64-bit register-level bit-parallel recurrence.
///
/// Both input sequences must have length <= 64.
/// Returns `(old_changed, new_changed)` where true denotes a changed (unmatched) line.
pub fn bit_parallel_diff(old_hashes: &[u32], new_hashes: &[u32]) -> (Vec<bool>, Vec<bool>) {
    let mut state = BitParallelDiffState::new();
    bit_parallel_diff_with_state(old_hashes, new_hashes, &mut state);
    (state.old_changed, state.new_changed)
}

fn compute_column_bitmasks(
    old_hashes: &[u32],
    new_hashes: &[u32],
) -> [u64; BIT_PARALLEL_MAX_LINES] {
    let mut peq = PeqTable::new();
    for (row_index, &old_hash) in old_hashes.iter().enumerate() {
        peq.insert(old_hash, 1u64 << row_index);
    }

    let mut column_bitmasks = [0u64; BIT_PARALLEL_MAX_LINES];
    let mut vertical_vector = 0u64;

    for (column_index, &new_hash) in new_hashes.iter().enumerate() {
        let pattern_match_mask = peq.get(new_hash);
        let equality_or_vertical = pattern_match_mask | vertical_vector;
        let borrow_diff =
            (equality_or_vertical.wrapping_sub((vertical_vector << 1) | 1)) ^ equality_or_vertical;
        vertical_vector = equality_or_vertical & borrow_diff;
        column_bitmasks[column_index] = vertical_vector;
    }

    column_bitmasks
}

fn try_diagonal_step(
    idx_old: &mut usize,
    idx_new: &mut usize,
    column_bitmasks: &[u64; BIT_PARALLEL_MAX_LINES],
    old_hashes: &[u32],
    new_hashes: &[u32],
) -> bool {
    if old_hashes[*idx_old - 1] != new_hashes[*idx_new - 1] {
        return false;
    }

    let current_score = lcs_score(column_bitmasks[*idx_new - 1], *idx_old);
    let prev_score = if *idx_old > 1 && *idx_new > 1 {
        lcs_score(column_bitmasks[*idx_new - 2], *idx_old - 1)
    } else {
        0
    };

    if current_score == prev_score + 1 {
        *idx_old -= 1;
        *idx_new -= 1;
        true
    } else {
        false
    }
}

fn step_backtrack(
    idx_old: &mut usize,
    idx_new: &mut usize,
    column_bitmasks: &[u64; BIT_PARALLEL_MAX_LINES],
    old_hashes: &[u32],
    new_hashes: &[u32],
    old_changed: &mut [bool],
    new_changed: &mut [bool],
) {
    if try_diagonal_step(idx_old, idx_new, column_bitmasks, old_hashes, new_hashes) {
        return;
    }

    let score_up = lcs_score(column_bitmasks[*idx_new - 1], *idx_old - 1);
    let score_left = if *idx_new > 1 {
        lcs_score(column_bitmasks[*idx_new - 2], *idx_old)
    } else {
        0
    };

    if score_up >= score_left {
        old_changed[*idx_old - 1] = true;
        *idx_old -= 1;
    } else {
        new_changed[*idx_new - 1] = true;
        *idx_new -= 1;
    }
}

fn backtrack_alignment_path(
    column_bitmasks: &[u64; BIT_PARALLEL_MAX_LINES],
    old_hashes: &[u32],
    new_hashes: &[u32],
    old_changed: &mut [bool],
    new_changed: &mut [bool],
) {
    let mut idx_old = old_hashes.len();
    let mut idx_new = new_hashes.len();

    while idx_old > 0 && idx_new > 0 {
        step_backtrack(
            &mut idx_old,
            &mut idx_new,
            column_bitmasks,
            old_hashes,
            new_hashes,
            old_changed,
            new_changed,
        );
    }

    while idx_old > 0 {
        old_changed[idx_old - 1] = true;
        idx_old -= 1;
    }

    while idx_new > 0 {
        new_changed[idx_new - 1] = true;
        idx_new -= 1;
    }
}

/// Computes LCS(row_index, col) score from the vertical delta bitmask using hardware POPCNT.
#[inline(always)]
fn lcs_score(column_vertical_mask: u64, row_index: usize) -> usize {
    if row_index == 0 {
        0
    } else if row_index >= BIT_PARALLEL_MAX_LINES {
        column_vertical_mask.count_ones() as usize
    } else {
        let mask = (1u64 << row_index) - 1;
        (column_vertical_mask & mask).count_ones() as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SIZE_5: usize = 5;
    const TEST_HASH_10: u32 = 10;
    const TEST_HASH_20: u32 = 20;
    const TEST_HASH_30: u32 = 30;
    const TEST_HASH_40: u32 = 40;
    const TEST_HASH_50: u32 = 50;

    const TEST_100: u32 = 100;
    const TEST_101: u32 = 101;
    const TEST_102: u32 = 102;
    const TEST_103: u32 = 103;
    const TEST_104: u32 = 104;
    const TEST_999: u32 = 999;
    const TEST_888: u32 = 888;

    const MUTATED_VAL_1: u32 = 9999;
    const MUTATED_VAL_2: u32 = 8888;
    const MUTATED_IDX_1: usize = 10;
    const MUTATED_IDX_2: usize = 63;
    const OVER_CAPACITY_COUNT: usize = 65;

    #[test]
    fn test_bit_parallel_empty() {
        let (old, new) = bit_parallel_diff(&[], &[]);
        assert!(old.is_empty());
        assert!(new.is_empty());

        let (old, new) = bit_parallel_diff(&[1, 2], &[]);
        assert_eq!(old, vec![true, true]);
        assert!(new.is_empty());

        let (old, new) = bit_parallel_diff(&[], &[3, 4]);
        assert!(old.is_empty());
        assert_eq!(new, vec![true, true]);
    }

    #[test]
    fn test_bit_parallel_identical() {
        let hashes = vec![
            TEST_HASH_10,
            TEST_HASH_20,
            TEST_HASH_30,
            TEST_HASH_40,
            TEST_HASH_50,
        ];
        let (old, new) = bit_parallel_diff(&hashes, &hashes);
        assert_eq!(old, vec![false; TEST_SIZE_5]);
        assert_eq!(new, vec![false; TEST_SIZE_5]);
    }

    const VAL_1: u32 = 1;
    const VAL_2: u32 = 2;
    const VAL_3: u32 = 3;
    const VAL_4: u32 = 4;

    #[test]
    fn test_bit_parallel_insert_delete_replace() {
        let a = vec![VAL_1, VAL_2, VAL_3];
        let b = vec![VAL_2, VAL_3, VAL_4];
        let (old, new) = bit_parallel_diff(&a, &b);
        assert_eq!(old, vec![true, false, false]);
        assert_eq!(new, vec![false, false, true]);
    }

    #[test]
    fn test_bit_parallel_alternating_edits() {
        let a = vec![TEST_100, TEST_101, TEST_102, TEST_103, TEST_104];
        let b = vec![TEST_100, TEST_999, TEST_102, TEST_888, TEST_104];
        let (old, new) = bit_parallel_diff(&a, &b);
        assert_eq!(old, vec![false, true, false, true, false]);
        assert_eq!(new, vec![false, true, false, true, false]);
    }

    #[test]
    fn test_bit_parallel_up_to_64_lines() {
        let a: Vec<u32> = (0..BIT_PARALLEL_MAX_LINES as u32).collect();
        let mut b = a.clone();
        b[MUTATED_IDX_1] = MUTATED_VAL_1;
        b[MUTATED_IDX_2] = MUTATED_VAL_2;

        let (old, new) = bit_parallel_diff(&a, &b);
        assert_eq!(old.len(), BIT_PARALLEL_MAX_LINES);
        assert_eq!(new.len(), BIT_PARALLEL_MAX_LINES);
        assert!(old[MUTATED_IDX_1] && new[MUTATED_IDX_1]);
        assert!(old[MUTATED_IDX_2] && new[MUTATED_IDX_2]);
        assert!(!old[0] && !new[0]);
    }

    #[test]
    fn test_bit_parallel_exceeding_64_lines_graceful() {
        let a: Vec<u32> = (0..OVER_CAPACITY_COUNT as u32).collect();
        let b: Vec<u32> = (0..OVER_CAPACITY_COUNT as u32).collect();
        let (old, new) = bit_parallel_diff(&a, &b);
        assert_eq!(old.len(), OVER_CAPACITY_COUNT);
        assert_eq!(new.len(), OVER_CAPACITY_COUNT);
    }
}
