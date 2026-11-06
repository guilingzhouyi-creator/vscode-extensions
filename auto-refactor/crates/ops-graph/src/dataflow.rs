//! Module: Native Acceleration Kernel — Intra-procedural Dataflow Analysis
//! Crate: ops-graph
//! Architecture Role: Bit-parallel intra-procedural forward and backward dataflow equations solver.

use crate::{IndexedGraph, BITS_PER_U64_WORD, MAX_DATAFLOW_ITERATIONS};
use std::collections::{BTreeSet, HashMap};

/// Result of intra-procedural dataflow equation analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataflowResult {
    pub in_sets: HashMap<String, Vec<String>>,
    pub out_sets: HashMap<String, Vec<String>>,
    pub iterations: usize,
}

/// Configuration parameter object for dataflow equations solver.
#[derive(Debug, Clone)]
pub struct DataflowConfig<'a> {
    pub entry: &'a str,
    pub nodes: &'a [String],
    pub edges: &'a [Vec<String>],
    pub forward: bool,
    pub gen_map: &'a HashMap<String, Vec<String>>,
    pub kill_map: &'a HashMap<String, Vec<String>>,
}

/// Helper for executing a single forward dataflow node convergence step over 64-bit word bitsets.
fn step_forward_dataflow_bits(
    node_idx: usize,
    words_per_node: usize,
    preds: &[usize],
    gen_words: &[u64],
    kill_words: &[u64],
    in_words: &mut [u64],
    out_words: &mut [u64],
) -> bool {
    let base = node_idx * words_per_node;
    let mut changed = false;

    for w in 0..words_per_node {
        let mut new_in_word = 0u64;
        for &p in preds {
            new_in_word |= out_words[p * words_per_node + w];
        }
        if in_words[base + w] != new_in_word {
            in_words[base + w] = new_in_word;
            changed = true;
        }
        let new_out_word = gen_words[base + w] | (new_in_word & !kill_words[base + w]);
        if out_words[base + w] != new_out_word {
            out_words[base + w] = new_out_word;
            changed = true;
        }
    }

    changed
}

/// Helper for executing a single backward dataflow node convergence step over 64-bit word bitsets.
fn step_backward_dataflow_bits(
    node_idx: usize,
    words_per_node: usize,
    succs: &[usize],
    gen_words: &[u64],
    kill_words: &[u64],
    in_words: &mut [u64],
    out_words: &mut [u64],
) -> bool {
    let base = node_idx * words_per_node;
    let mut changed = false;

    for w in 0..words_per_node {
        let mut new_out_word = 0u64;
        for &s in succs {
            new_out_word |= in_words[s * words_per_node + w];
        }
        if out_words[base + w] != new_out_word {
            out_words[base + w] = new_out_word;
            changed = true;
        }
        let new_in_word = gen_words[base + w] | (new_out_word & !kill_words[base + w]);
        if in_words[base + w] != new_in_word {
            in_words[base + w] = new_in_word;
            changed = true;
        }
    }

    changed
}

/// Solves intra-procedural forward or backward dataflow equations using backward-compatible signature.
pub fn solve_dataflow(
    entry: &str,
    nodes: &[String],
    edges: &[Vec<String>],
    forward: bool,
    gen_map: &HashMap<String, Vec<String>>,
    kill_map: &HashMap<String, Vec<String>>,
) -> DataflowResult {
    let config = DataflowConfig {
        entry,
        nodes,
        edges,
        forward,
        gen_map,
        kill_map,
    };
    solve_dataflow_configured(&config)
}

fn decode_bitset_row(row_words: &[u64], fact_names: &[String]) -> Vec<String> {
    let mut facts = Vec::new();
    for (w_idx, &word) in row_words.iter().enumerate() {
        let mut bits = word;
        while bits != 0 {
            let bit_pos = bits.trailing_zeros() as usize;
            let fact_id = w_idx * BITS_PER_U64_WORD + bit_pos;
            if let Some(name) = fact_names.get(fact_id) {
                facts.push(name.clone());
            }
            bits &= bits - 1;
        }
    }
    facts
}

/// Solves intra-procedural forward or backward dataflow equations using structured config object.
pub fn solve_dataflow_configured(config: &DataflowConfig<'_>) -> DataflowResult {
    let graph = IndexedGraph::build(config.entry, config.nodes, config.edges);
    let total = graph.all_node_names.len();
    let all_node_names = &graph.all_node_names;
    let succs = &graph.succs;
    let preds = &graph.preds;

    let mut unique_facts: BTreeSet<&str> = BTreeSet::new();
    for facts in config.gen_map.values() {
        for f in facts {
            unique_facts.insert(f.as_str());
        }
    }
    for facts in config.kill_map.values() {
        for f in facts {
            unique_facts.insert(f.as_str());
        }
    }

    let fact_names: Vec<String> = unique_facts.iter().map(|&s| s.to_string()).collect();
    let fact_to_id: HashMap<&str, usize> = unique_facts
        .into_iter()
        .enumerate()
        .map(|(id, name)| (name, id))
        .collect();

    let words_per_node = fact_names.len().div_ceil(BITS_PER_U64_WORD).max(1);
    let buf_len = total * words_per_node;
    let mut in_words = vec![0u64; buf_len];
    let mut out_words = vec![0u64; buf_len];
    let mut gen_words = vec![0u64; buf_len];
    let mut kill_words = vec![0u64; buf_len];

    for (i, name) in all_node_names.iter().enumerate() {
        let base = i * words_per_node;
        if let Some(facts) = config.gen_map.get(name) {
            for f in facts {
                if let Some(&fid) = fact_to_id.get(f.as_str()) {
                    gen_words[base + fid / BITS_PER_U64_WORD] |= 1u64 << (fid % BITS_PER_U64_WORD);
                }
            }
        }
        if let Some(facts) = config.kill_map.get(name) {
            for f in facts {
                if let Some(&fid) = fact_to_id.get(f.as_str()) {
                    kill_words[base + fid / BITS_PER_U64_WORD] |= 1u64 << (fid % BITS_PER_U64_WORD);
                }
            }
        }
    }

    let mut iterations = 0;
    let mut changed = true;

    while changed && iterations < MAX_DATAFLOW_ITERATIONS {
        changed = false;
        iterations += 1;

        for i in 0..total {
            let node_changed = if config.forward {
                step_forward_dataflow_bits(
                    i,
                    words_per_node,
                    &preds[i],
                    &gen_words,
                    &kill_words,
                    &mut in_words,
                    &mut out_words,
                )
            } else {
                step_backward_dataflow_bits(
                    i,
                    words_per_node,
                    &succs[i],
                    &gen_words,
                    &kill_words,
                    &mut in_words,
                    &mut out_words,
                )
            };
            if node_changed {
                changed = true;
            }
        }
    }

    let mut in_map = HashMap::with_capacity(total);
    let mut out_map = HashMap::with_capacity(total);
    for (i, name) in all_node_names.iter().enumerate() {
        let base = i * words_per_node;
        let in_slice = &in_words[base..base + words_per_node];
        let out_slice = &out_words[base..base + words_per_node];
        in_map.insert(name.clone(), decode_bitset_row(in_slice, &fact_names));
        out_map.insert(name.clone(), decode_bitset_row(out_slice, &fact_names));
    }

    DataflowResult {
        in_sets: in_map,
        out_sets: out_map,
        iterations,
    }
}
