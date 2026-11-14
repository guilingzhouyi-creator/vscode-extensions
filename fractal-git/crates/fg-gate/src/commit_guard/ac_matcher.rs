//! Module: fg-gate — Deterministic Byte Aho-Corasick Multi-Pattern Matcher
//! File Path: crates/fg-gate/src/commit_guard/ac_matcher.rs
//! Architecture Role: Executes compiled byte DFAs for single-pass commit message scanning
//!   without per-term substring rescans.
//! Dependencies & Triggers: Uses `commit_guard::ac_compiler`; consumed by `commit_guard::lexicon`
//!   and `commit_guard::CommitMessageGuard` validation paths.
//! Responsibilities: Walk DFA state transitions and enforce UTF-8 / ASCII word boundaries.
//! Exit Semantics & Design Rationale: Never panics, performs zero allocations during scan loops,
//!   and matches `contains_whole_term` semantics bit-for-bit across ASCII and CJK inputs.
//!
//! Domain Governance Rules: FGT-PRF-001 (zero loop heap allocation), FGT-ERR-001, CMT-DOC-001.

use super::ac_compiler::{compile_dfa, CompiledDfa, PatternMeta, OUT_NONE, ROOT_STATE};

/// Complete byte-level Aho-Corasick DFA with suffix-linked multi-pattern outputs.
pub(crate) struct AcMatcher {
    dfa: CompiledDfa,
}

/// Checks `contains_whole_term` boundary rules for match span `[start, end)` in `haystack`.
pub(crate) fn has_whole_term_boundaries(
    haystack: &str,
    start: usize,
    end: usize,
    has_cjk: bool,
) -> bool {
    if !haystack.is_char_boundary(start) || !haystack.is_char_boundary(end) {
        return false;
    }
    if has_cjk {
        return true;
    }
    let bytes = haystack.as_bytes();
    let before_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
    let after_ok = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
    before_ok && after_ok
}

impl AcMatcher {
    /// Builds a complete DFA matcher from `(slice_index, literal_text)` entries.
    pub(crate) fn compile<'a, I>(entries: I, estimated_states: usize) -> Self
    where
        I: IntoIterator<Item = (usize, &'a str)>,
    {
        Self {
            dfa: compile_dfa(entries, estimated_states),
        }
    }

    fn visit_state_outputs<F: FnMut(PatternMeta, usize) -> bool>(
        &self,
        state: usize,
        end_offset: usize,
        callback: &mut F,
    ) -> bool {
        let mut cursor = self.dfa.out_head[state];
        while cursor != OUT_NONE {
            let (pat_id, next_node) = self.dfa.out_nodes[cursor as usize];
            if callback(self.dfa.patterns[pat_id as usize], end_offset) {
                return true;
            }
            cursor = next_node;
        }
        let mut dict_state = self.dfa.dict_link[state];
        while dict_state != OUT_NONE {
            let mut sub_cursor = self.dfa.out_head[dict_state as usize];
            while sub_cursor != OUT_NONE {
                let (pat_id, next_node) = self.dfa.out_nodes[sub_cursor as usize];
                if callback(self.dfa.patterns[pat_id as usize], end_offset) {
                    return true;
                }
                sub_cursor = next_node;
            }
            dict_state = self.dfa.dict_link[dict_state as usize];
        }
        false
    }

    /// Returns `true` if any compiled pattern occurs as a raw substring inside `bytes`.
    pub(crate) fn has_any_substring(&self, bytes: &[u8]) -> bool {
        if self.dfa.patterns.is_empty() {
            return false;
        }
        let mut state = ROOT_STATE;
        for &byte in bytes {
            state = self.dfa.next_state[state][byte as usize] as usize;
            if self.dfa.out_head[state] != OUT_NONE {
                return true;
            }
        }
        false
    }

    /// Collects the smallest original slice index matching whole-term boundary semantics in `haystack`.
    pub(crate) fn find_min_whole_term_index(&self, haystack: &str) -> Option<usize> {
        if self.dfa.patterns.is_empty() || haystack.is_empty() {
            return None;
        }
        let mut best: Option<usize> = None;
        let mut state = ROOT_STATE;
        for (idx, &byte) in haystack.as_bytes().iter().enumerate() {
            state = self.dfa.next_state[state][byte as usize] as usize;
            if self.dfa.out_head[state] == OUT_NONE {
                continue;
            }
            let end = idx + 1;
            self.visit_state_outputs(state, end, &mut |meta, match_end| {
                if best.is_some_and(|prev| meta.index >= prev) {
                    return false;
                }
                let start = match_end.saturating_sub(meta.byte_len);
                if has_whole_term_boundaries(haystack, start, match_end, meta.has_cjk) {
                    best = Some(meta.index);
                }
                false
            });
        }
        best
    }

    /// Marks `matched[meta.index] = true` for every whole-term match inside `haystack`.
    pub(crate) fn mark_whole_term_matches(&self, haystack: &str, matched: &mut [bool]) {
        if self.dfa.patterns.is_empty() || haystack.is_empty() {
            return;
        }
        let mut remaining = matched.len();
        let mut state = ROOT_STATE;
        for (idx, &byte) in haystack.as_bytes().iter().enumerate() {
            state = self.dfa.next_state[state][byte as usize] as usize;
            if self.dfa.out_head[state] == OUT_NONE {
                continue;
            }
            let end = idx + 1;
            let done = self.visit_state_outputs(state, end, &mut |meta, match_end| {
                if let Some(slot) = matched.get_mut(meta.index) {
                    if !*slot {
                        let start = match_end.saturating_sub(meta.byte_len);
                        if has_whole_term_boundaries(haystack, start, match_end, meta.has_cjk) {
                            *slot = true;
                            remaining = remaining.saturating_sub(1);
                            if remaining == 0 {
                                return true;
                            }
                        }
                    }
                }
                false
            });
            if done {
                return;
            }
        }
    }
}
