use napi_derive::napi;
use std::collections::{BTreeSet, HashMap, HashSet};

#[napi(object)]
pub struct NativeGraphAnalysis {
    pub cycles: Vec<Vec<String>>,
    pub topological_order: Vec<String>,
    pub strongly_connected_components: Vec<Vec<String>>,
    pub is_acyclic: bool,
}

pub fn run_analyze_dependency_graph(edges: &[Vec<String>]) -> NativeGraphAnalysis {
    let mut adjacency: HashMap<String, HashSet<String>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let mut all_nodes: BTreeSet<String> = BTreeSet::new();

    for edge in edges {
        if edge.len() >= 2 {
            let from = &edge[0];
            let to = &edge[1];

            all_nodes.insert(from.clone());
            all_nodes.insert(to.clone());

            let neighbors = adjacency.entry(from.clone()).or_default();
            if neighbors.insert(to.clone()) {
                *in_degree.entry(to.clone()).or_insert(0) += 1;
            }
            in_degree.entry(from.clone()).or_insert(0);
        }
    }

    // 1. Tarjan's Strongly Connected Components (SCC)
    let mut index_counter = 0usize;
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut lowlinks: HashMap<String, usize> = HashMap::new();
    let mut on_stack: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = Vec::new();
    let mut sccs: Vec<Vec<String>> = Vec::new();
    let mut cycles: Vec<Vec<String>> = Vec::new();

    fn strong_connect(
        node: &str,
        adjacency: &HashMap<String, HashSet<String>>,
        index_counter: &mut usize,
        indices: &mut HashMap<String, usize>,
        lowlinks: &mut HashMap<String, usize>,
        on_stack: &mut HashSet<String>,
        stack: &mut Vec<String>,
        sccs: &mut Vec<Vec<String>>,
        cycles: &mut Vec<Vec<String>>,
    ) {
        indices.insert(node.to_string(), *index_counter);
        lowlinks.insert(node.to_string(), *index_counter);
        *index_counter += 1;
        stack.push(node.to_string());
        on_stack.insert(node.to_string());

        if let Some(neighbors) = adjacency.get(node) {
            for neighbor in neighbors {
                if !indices.contains_key(neighbor) {
                    strong_connect(
                        neighbor,
                        adjacency,
                        index_counter,
                        indices,
                        lowlinks,
                        on_stack,
                        stack,
                        sccs,
                        cycles,
                    );
                    let n_low = lowlinks[neighbor];
                    let curr_low = lowlinks.get_mut(node).unwrap();
                    *curr_low = (*curr_low).min(n_low);
                } else if on_stack.contains(neighbor) {
                    let n_idx = indices[neighbor];
                    let curr_low = lowlinks.get_mut(node).unwrap();
                    *curr_low = (*curr_low).min(n_idx);
                }
            }
        }

        if lowlinks[node] == indices[node] {
            let mut scc = Vec::new();
            while let Some(w) = stack.pop() {
                on_stack.remove(&w);
                scc.push(w.clone());
                if w == node {
                    break;
                }
            }
            sccs.push(scc.clone());

            if scc.len() > 1 {
                cycles.push(scc);
            } else if let Some(single) = scc.first() {
                if let Some(neighbors) = adjacency.get(single) {
                    if neighbors.contains(single) {
                        cycles.push(vec![single.clone(), single.clone()]);
                    }
                }
            }
        }
    }

    for node in &all_nodes {
        if !indices.contains_key(node) {
            strong_connect(
                node,
                &adjacency,
                &mut index_counter,
                &mut indices,
                &mut lowlinks,
                &mut on_stack,
                &mut stack,
                &mut sccs,
                &mut cycles,
            );
        }
    }

    // 2. Kahn's Topological Sort
    let mut in_degree_copy = in_degree.clone();
    let mut queue: BTreeSet<String> = BTreeSet::new();
    for (node, &deg) in &in_degree_copy {
        if deg == 0 {
            queue.insert(node.clone());
        }
    }

    let mut topological_order = Vec::new();
    while let Some(current) = queue.pop_first() {
        topological_order.push(current.clone());

        if let Some(neighbors) = adjacency.get(&current) {
            for next in neighbors {
                if let Some(deg) = in_degree_copy.get_mut(next) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        queue.insert(next.clone());
                    }
                }
            }
        }
    }

    // Append any unvisited nodes from cycles to ensure total coverage
    for node in &all_nodes {
        if !topological_order.contains(node) {
            topological_order.push(node.clone());
        }
    }

    let is_acyclic = cycles.is_empty();

    NativeGraphAnalysis {
        cycles,
        topological_order,
        strongly_connected_components: sccs,
        is_acyclic,
    }
}
