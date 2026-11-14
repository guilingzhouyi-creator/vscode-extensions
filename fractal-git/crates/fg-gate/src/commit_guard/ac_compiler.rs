//! Module: fg-gate — Byte Aho-Corasick DFA Compiler
//! File Path: crates/fg-gate/src/commit_guard/ac_compiler.rs
//! Architecture Role: Compiles literal keyword tables into complete transition-table DFAs
//!   with dictionary suffix links for zero-allocation single-pass scanning.
//! Dependencies & Triggers: Standard library only; consumed by `commit_guard::ac_matcher`.
//! Responsibilities: Trie insertion, BFS failure-link completion, and CJK script tagging.
//! Exit Semantics & Design Rationale: Pure infallible compilation bounded to compile time.
//!
//! Domain Governance Rules: FGT-PRF-001 (zero scan-loop allocation), FGT-ERR-001, CMT-DOC-001.

use std::collections::VecDeque;

pub(crate) const OUT_NONE: u32 = u32::MAX;
pub(crate) const ROOT_STATE: usize = 0;

/// Metadata associated with one compiled literal pattern.
#[derive(Clone, Copy)]
pub(crate) struct PatternMeta {
    /// Original caller slice index (used to preserve priority order).
    pub(crate) index: usize,
    /// Exact UTF-8 byte length of the compiled pattern.
    pub(crate) byte_len: usize,
    /// Whether the pattern contains any CJK Unified Ideograph (`U+3400..=U+9FFF`).
    pub(crate) has_cjk: bool,
}

/// Transition-complete DFA buffers produced by `compile_dfa`.
pub(crate) struct CompiledDfa {
    pub(crate) next_state: Vec<[u32; 256]>,
    pub(crate) out_head: Vec<u32>,
    pub(crate) out_nodes: Vec<(u32, u32)>,
    pub(crate) dict_link: Vec<u32>,
    pub(crate) patterns: Vec<PatternMeta>,
}

/// Returns whether `text` contains any CJK character (`U+3400..=U+9FFF`).
pub(crate) fn pattern_has_cjk(text: &str) -> bool {
    text.chars().any(|character| {
        let code = character as u32;
        (0x3400..=0x9FFF).contains(&code)
    })
}

fn insert_pattern(
    next_state: &mut Vec<[u32; 256]>,
    out_head: &mut Vec<u32>,
    out_nodes: &mut Vec<(u32, u32)>,
    dict_link: &mut Vec<u32>,
    pattern_bytes: &[u8],
    pattern_idx: usize,
) {
    let mut state = ROOT_STATE;
    for &byte in pattern_bytes {
        let existing = next_state[state][byte as usize];
        if existing == 0 {
            let created = next_state.len() as u32;
            next_state.push([0u32; 256]);
            out_head.push(OUT_NONE);
            dict_link.push(OUT_NONE);
            next_state[state][byte as usize] = created;
            state = created as usize;
        } else {
            state = existing as usize;
        }
    }
    let node_idx = out_nodes.len() as u32;
    out_nodes.push((pattern_idx as u32, out_head[state]));
    out_head[state] = node_idx;
}

fn link_suffix_output(
    child: usize,
    fail_state: usize,
    out_head: &mut [u32],
    dict_link: &mut [u32],
) {
    if out_head[child] == OUT_NONE {
        out_head[child] = out_head[fail_state];
        dict_link[child] = dict_link[fail_state];
    } else if out_head[fail_state] != OUT_NONE {
        dict_link[child] = fail_state as u32;
    } else {
        dict_link[child] = dict_link[fail_state];
    }
}

fn complete_dfa_failures(
    next_state: &mut [[u32; 256]],
    out_head: &mut [u32],
    dict_link: &mut [u32],
) {
    let state_count = next_state.len();
    let mut fail = vec![0u32; state_count];
    let mut queue = VecDeque::with_capacity(state_count);

    for &child in &next_state[ROOT_STATE] {
        if child != 0 {
            fail[child as usize] = 0;
            queue.push_back(child);
        }
    }

    while let Some(current) = queue.pop_front() {
        let cur_idx = current as usize;
        let fail_idx = fail[cur_idx] as usize;
        let fail_row = next_state[fail_idx];
        for (dst, &fail_target) in next_state[cur_idx].iter_mut().zip(fail_row.iter()) {
            let child = *dst;
            if child != 0 {
                let child_idx = child as usize;
                fail[child_idx] = fail_target;
                link_suffix_output(child_idx, fail_target as usize, out_head, dict_link);
                queue.push_back(child);
            } else {
                *dst = fail_target;
            }
        }
    }
}

/// Builds a transition-complete byte DFA from `(slice_index, literal_text)` entries.
pub(crate) fn compile_dfa<'a, I>(entries: I, estimated_states: usize) -> CompiledDfa
where
    I: IntoIterator<Item = (usize, &'a str)>,
{
    let cap = estimated_states.max(4);
    let mut next_state = Vec::with_capacity(cap);
    let mut out_head = Vec::with_capacity(cap);
    let mut dict_link = Vec::with_capacity(cap);
    let mut out_nodes = Vec::with_capacity(64);
    let mut patterns = Vec::with_capacity(64);

    next_state.push([0u32; 256]);
    out_head.push(OUT_NONE);
    dict_link.push(OUT_NONE);

    for (index, literal) in entries {
        if literal.is_empty() {
            continue;
        }
        let pat_id = patterns.len();
        patterns.push(PatternMeta {
            index,
            byte_len: literal.len(),
            has_cjk: pattern_has_cjk(literal),
        });
        insert_pattern(
            &mut next_state,
            &mut out_head,
            &mut out_nodes,
            &mut dict_link,
            literal.as_bytes(),
            pat_id,
        );
    }

    complete_dfa_failures(&mut next_state, &mut out_head, &mut dict_link);
    CompiledDfa {
        next_state,
        out_head,
        out_nodes,
        dict_link,
        patterns,
    }
}
