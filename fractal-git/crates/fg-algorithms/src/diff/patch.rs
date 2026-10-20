//! Module: fg-algorithms — Myers Unified Diff & Patch Generator
//! File Path: crates/fg-algorithms/src/diff/patch.rs
//! Architecture Role: Computes optimal unified diff patches between file versions using
//!   hash-tokenized Myers diff with common-prefix/suffix pruning and adaptive linear fallback.
//! Dependencies & Triggers: Consumed by gate verifiers, commit guards, and CLI diff handlers.
//! Responsibilities: Produces accurate Context, Addition, and Deletion hunks with minimal
//!   edit script distance.
//! Exit Semantics & Design Rationale:
//!   - Pre-tokenizes lines with 64-bit FNV-1a hashes to compare integers instead of strings.
//!   - O(N) common prefix and suffix pruning eliminates overhead for common edits.
//!   - Fallback Threshold: If N * M > 2,000,000 or N + M > 1,500, degrades to chunked linear scan
//!     to prevent quadratic blowup.

/// A line in a diff hunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchLine {
    Context(String),
    Addition(String),
    Deletion(String),
}

/// A contiguous hunk of line differences.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<PatchLine>,
}

/// A complete unified diff patch for a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedPatch {
    pub file_path: String,
    pub hunks: Vec<PatchHunk>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EditOp {
    Context,
    Addition,
    Deletion,
}

/// Reusable scratch buffer for Myers diff to eliminate repeated vector allocations.
#[derive(Debug, Default)]
pub struct MyersScratch {
    pub v_diagonals: Vec<isize>,
    pub next_v_diagonals: Vec<isize>,
    pub trace_compact: Vec<isize>,
}

impl MyersScratch {
    pub fn new() -> Self {
        Self {
            v_diagonals: Vec::with_capacity(256),
            next_v_diagonals: Vec::with_capacity(256),
            trace_compact: Vec::with_capacity(1024),
        }
    }

    pub fn clear(&mut self) {
        self.v_diagonals.clear();
        self.next_v_diagonals.clear();
        self.trace_compact.clear();
    }
}

/// Algorithm generator for unified diff patches.
pub struct PatchGenerator;

impl PatchGenerator {
    /// Generates a unified patch comparing old and new text with Myers shortest edit script.
    pub fn generate_patch(file_path: &str, old_text: &str, new_text: &str) -> UnifiedPatch {
        let old_lines: Vec<&str> = old_text.lines().collect();
        let new_lines: Vec<&str> = new_text.lines().collect();

        if old_lines.is_empty() && new_lines.is_empty() {
            return UnifiedPatch {
                file_path: file_path.to_string(),
                hunks: Vec::new(),
            };
        }

        // Fast-path: Identical content short-circuit
        if old_text == new_text {
            let hunk_lines: Vec<PatchLine> = old_lines
                .iter()
                .map(|line_slice| PatchLine::Context(line_slice.to_string()))
                .collect();
            let hunk = PatchHunk {
                old_start: 1,
                old_count: old_lines.len(),
                new_start: 1,
                new_count: new_lines.len(),
                lines: hunk_lines,
            };
            return UnifiedPatch {
                file_path: file_path.to_string(),
                hunks: vec![hunk],
            };
        }

        let old_hashes: Vec<u64> = old_lines
            .iter()
            .map(|line_slice| Self::fnv1a(line_slice))
            .collect();
        let new_hashes: Vec<u64> = new_lines
            .iter()
            .map(|line_slice| Self::fnv1a(line_slice))
            .collect();

        // 1. SWAR 4-wide 64-bit parallel word alignment for common prefix trimming
        let prefix_len = Self::swar_trim_prefix(&old_hashes, &new_hashes);

        // 2. SWAR 4-wide 64-bit parallel word alignment for common suffix trimming
        let suffix_len = Self::swar_trim_suffix(&old_hashes, &new_hashes, prefix_len);

        let mid_old_hashes = &old_hashes[prefix_len..old_hashes.len() - suffix_len];
        let mid_new_hashes = &new_hashes[prefix_len..new_hashes.len() - suffix_len];

        // 3. Myers Diff on middle slice (with threshold protection)
        let mid_edits = Self::compute_myers_middle(mid_old_hashes, mid_new_hashes);

        // 4. Reconstruct full patch lines
        let mut hunk_lines = Vec::with_capacity(old_lines.len() + new_lines.len());

        for line in &old_lines[..prefix_len] {
            hunk_lines.push(PatchLine::Context(line.to_string()));
        }

        let mut old_mid_idx = prefix_len;
        let mut new_mid_idx = prefix_len;

        for edit in mid_edits {
            match edit {
                EditOp::Context => {
                    hunk_lines.push(PatchLine::Context(old_lines[old_mid_idx].to_string()));
                    old_mid_idx += 1;
                    new_mid_idx += 1;
                }
                EditOp::Deletion => {
                    hunk_lines.push(PatchLine::Deletion(old_lines[old_mid_idx].to_string()));
                    old_mid_idx += 1;
                }
                EditOp::Addition => {
                    hunk_lines.push(PatchLine::Addition(new_lines[new_mid_idx].to_string()));
                    new_mid_idx += 1;
                }
            }
        }

        for line in &old_lines[old_lines.len() - suffix_len..] {
            hunk_lines.push(PatchLine::Context(line.to_string()));
        }

        let hunk = PatchHunk {
            old_start: 1,
            old_count: old_lines.len(),
            new_start: 1,
            new_count: new_lines.len(),
            lines: hunk_lines,
        };

        UnifiedPatch {
            file_path: file_path.to_string(),
            hunks: vec![hunk],
        }
    }

    #[inline]
    fn walk_snake(
        mut x_coord: usize,
        mut y_coord: usize,
        old: &[u64],
        new: &[u64],
    ) -> (usize, usize) {
        while x_coord < old.len() && y_coord < new.len() && old[x_coord] == new[y_coord] {
            x_coord += 1;
            y_coord += 1;
        }
        (x_coord, y_coord)
    }

    #[inline]
    fn select_branch_x(
        search_depth: usize,
        diagonal_k: isize,
        depth_isize: isize,
        v_diagonals: &[isize],
        idx: usize,
    ) -> isize {
        if search_depth == 0 {
            0
        } else if diagonal_k == -depth_isize
            || (diagonal_k != depth_isize && v_diagonals[idx - 1] < v_diagonals[idx + 1])
        {
            v_diagonals[idx + 1]
        } else {
            v_diagonals[idx - 1] + 1
        }
    }

    fn compute_myers_middle(old: &[u64], new: &[u64]) -> Vec<EditOp> {
        let mut scratch = MyersScratch::new();
        Self::compute_myers_middle_with_scratch(old, new, &mut scratch)
    }

    fn compute_myers_middle_with_scratch(
        old: &[u64],
        new: &[u64],
        scratch: &mut MyersScratch,
    ) -> Vec<EditOp> {
        let old_len = old.len();
        let new_len = new.len();

        if old_len == 0 && new_len == 0 {
            return Vec::new();
        }
        if old_len == 0 {
            return vec![EditOp::Addition; new_len];
        }
        if new_len == 0 {
            return vec![EditOp::Deletion; old_len];
        }

        // Adaptive Fallback Threshold: If N * M > 2,000,000 or N + M > 1,500,
        // fallback to linear zip.
        if old_len * new_len > 2_000_000 || old_len + new_len > 1_500 {
            return Self::linear_fallback(old, new);
        }

        let max = old_len + new_len;
        let v_size = 2 * max + 1;
        let offset = max as isize;

        scratch.clear();
        if scratch.v_diagonals.len() < v_size {
            scratch.v_diagonals.resize(v_size, 0);
            scratch.next_v_diagonals.resize(v_size, 0);
        } else {
            scratch.v_diagonals[..v_size].fill(0);
            scratch.next_v_diagonals[..v_size].fill(0);
        }

        let mut found_depth = 0;
        let mut found_k = 0;

        'outer: for search_depth in 0..=max {
            scratch.next_v_diagonals[..v_size].copy_from_slice(&scratch.v_diagonals[..v_size]);
            let depth_isize = search_depth as isize;

            for diagonal_k in (-depth_isize..=depth_isize).step_by(2) {
                let idx = (diagonal_k + offset) as usize;
                let x_start = Self::select_branch_x(
                    search_depth,
                    diagonal_k,
                    depth_isize,
                    &scratch.v_diagonals,
                    idx,
                );
                let y_start = x_start - diagonal_k;

                let (x_end, y_end) = Self::walk_snake(x_start as usize, y_start as usize, old, new);
                scratch.next_v_diagonals[idx] = x_end as isize;

                if x_end >= old_len && y_end >= new_len {
                    // Record active diagonals for the terminal step into compact triangular trace
                    for k_rec in (-depth_isize..=depth_isize).step_by(2) {
                        scratch
                            .trace_compact
                            .push(scratch.next_v_diagonals[(k_rec + offset) as usize]);
                    }
                    found_depth = search_depth;
                    found_k = diagonal_k;
                    break 'outer;
                }
            }

            // Record active diagonals for step search_depth into compact triangular trace
            for k_rec in (-depth_isize..=depth_isize).step_by(2) {
                scratch
                    .trace_compact
                    .push(scratch.next_v_diagonals[(k_rec + offset) as usize]);
            }
            scratch.v_diagonals[..v_size].copy_from_slice(&scratch.next_v_diagonals[..v_size]);
        }

        // Backtrack edit operations using compact O(D^2) triangular trace
        Self::backtrack(&scratch.trace_compact, found_depth, found_k)
    }

    fn backtrack(trace: &[isize], search_depth: usize, diagonal_k: isize) -> Vec<EditOp> {
        let mut edits = Vec::new();
        let mut curr_k = diagonal_k;

        for step in (1..=search_depth).rev() {
            let prev_base = (step - 1) * step / 2;
            let curr_base = step * (step + 1) / 2;
            let depth_isize = step as isize;

            let prev_k_left = curr_k - 1;
            let prev_k_right = curr_k + 1;

            let (prev_k, is_addition) = if curr_k == -depth_isize {
                (prev_k_right, true)
            } else if curr_k == depth_isize {
                (prev_k_left, false)
            } else {
                let left_idx = prev_base + ((prev_k_left + (depth_isize - 1)) / 2) as usize;
                let right_idx = prev_base + ((prev_k_right + (depth_isize - 1)) / 2) as usize;
                let prev_left = trace[left_idx];
                let prev_right = trace[right_idx];
                if prev_left < prev_right {
                    (prev_k_right, true)
                } else {
                    (prev_k_left, false)
                }
            };

            let prev_idx = prev_base + ((prev_k + (depth_isize - 1)) / 2) as usize;
            let curr_idx = curr_base + ((curr_k + depth_isize) / 2) as usize;

            let prev_x = trace[prev_idx];
            let curr_x = trace[curr_idx];

            // 1. Diagonal matching segment at end of this step
            let end_match = if is_addition {
                curr_x - prev_x
            } else {
                curr_x - (prev_x + 1)
            };

            for _ in 0..end_match {
                edits.push(EditOp::Context);
            }

            // 2. The single addition or deletion step
            if is_addition {
                edits.push(EditOp::Addition);
            } else {
                edits.push(EditOp::Deletion);
            }

            curr_k = prev_k;
        }

        // Leading diagonal matches from (0, 0) in trace[0]
        if !trace.is_empty() {
            let start_match = trace[0] as usize;
            for _ in 0..start_match {
                edits.push(EditOp::Context);
            }
        }

        edits.reverse();
        edits
    }

    fn linear_fallback(old: &[u64], new: &[u64]) -> Vec<EditOp> {
        let mut edits = Vec::new();
        let mut i = 0;
        let mut j = 0;

        while i < old.len() || j < new.len() {
            if i < old.len() && j < new.len() && old[i] == new[j] {
                edits.push(EditOp::Context);
                i += 1;
                j += 1;
            } else {
                if i < old.len() {
                    edits.push(EditOp::Deletion);
                    i += 1;
                }
                if j < new.len() {
                    edits.push(EditOp::Addition);
                    j += 1;
                }
            }
        }

        edits
    }

    fn fnv1a(input_str: &str) -> u64 {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in input_str.bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    /// SWAR 4-wide 64-bit parallel word alignment for common prefix trimming.
    #[inline]
    pub fn swar_trim_prefix(left_hashes: &[u64], right_hashes: &[u64]) -> usize {
        let min_len = left_hashes.len().min(right_hashes.len());
        let mut i = 0;

        // 4-wide unrolled chunk comparison
        while i + 4 <= min_len {
            if [
                left_hashes[i],
                left_hashes[i + 1],
                left_hashes[i + 2],
                left_hashes[i + 3],
            ] == [
                right_hashes[i],
                right_hashes[i + 1],
                right_hashes[i + 2],
                right_hashes[i + 3],
            ] {
                i += 4;
            } else {
                break;
            }
        }

        // Scalar remainder
        while i < min_len && left_hashes[i] == right_hashes[i] {
            i += 1;
        }
        i
    }

    /// SWAR 4-wide 64-bit parallel word alignment for common suffix trimming.
    #[inline]
    pub fn swar_trim_suffix(left_hashes: &[u64], right_hashes: &[u64], prefix_len: usize) -> usize {
        let max_suffix = (left_hashes.len() - prefix_len).min(right_hashes.len() - prefix_len);
        let mut i = 0;

        // 4-wide unrolled chunk comparison from reverse end
        while i + 4 <= max_suffix {
            let a_idx = left_hashes.len() - 4 - i;
            let b_idx = right_hashes.len() - 4 - i;
            if [
                left_hashes[a_idx],
                left_hashes[a_idx + 1],
                left_hashes[a_idx + 2],
                left_hashes[a_idx + 3],
            ] == [
                right_hashes[b_idx],
                right_hashes[b_idx + 1],
                right_hashes[b_idx + 2],
                right_hashes[b_idx + 3],
            ] {
                i += 4;
            } else {
                break;
            }
        }

        // Scalar remainder
        while i < max_suffix
            && left_hashes[left_hashes.len() - 1 - i] == right_hashes[right_hashes.len() - 1 - i]
        {
            i += 1;
        }
        i
    }
}
