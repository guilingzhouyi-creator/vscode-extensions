//! Module: Native Acceleration Kernel — Dependency Graph Analysis
//! Crate: ops-graph
//! Architecture Role: Tarjan SCC cycle detection and Kahn topological sorting
//! for modular architecture rules and dependency graph traversal.

use std::collections::{BTreeSet, HashMap, HashSet};

/// Maximum fixed-point iterations permitted for dataflow convergence.
pub const MAX_DATAFLOW_ITERATIONS: usize = 500;

/// Number of bits per 64-bit word utilized in bit-parallel operations.
pub const BITS_PER_U64_WORD: usize = 64;

/// Result of graph analysis containing detected cycles, topological order, and SCCs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphAnalysis {
    pub cycles: Vec<Vec<String>>,
    pub topological_order: Vec<String>,
    pub strongly_connected_components: Vec<Vec<String>>,
    pub is_acyclic: bool,
}

struct TarjanState<'a> {
    adjacency: &'a HashMap<String, HashSet<String>>,
    index_counter: usize,
    indices: HashMap<String, usize>,
    lowlinks: HashMap<String, usize>,
    on_stack: HashSet<String>,
    stack: Vec<String>,
    sccs: Vec<Vec<String>>,
    cycles: Vec<Vec<String>>,
}

impl<'a> TarjanState<'a> {
    fn new(adjacency: &'a HashMap<String, HashSet<String>>) -> Self {
        Self {
            adjacency,
            index_counter: 0,
            indices: HashMap::new(),
            lowlinks: HashMap::new(),
            on_stack: HashSet::new(),
            stack: Vec::new(),
            sccs: Vec::new(),
            cycles: Vec::new(),
        }
    }

    fn connect_neighbor(&mut self, node: &str, neighbor: &str) {
        if !self.indices.contains_key(neighbor) {
            self.strong_connect(neighbor);
            let n_low = self.lowlinks.get(neighbor).copied().unwrap_or(0);
            if let Some(curr_low) = self.lowlinks.get_mut(node) {
                *curr_low = (*curr_low).min(n_low);
            }
        } else if self.on_stack.contains(neighbor) {
            let n_idx = self.indices.get(neighbor).copied().unwrap_or(0);
            if let Some(curr_low) = self.lowlinks.get_mut(node) {
                *curr_low = (*curr_low).min(n_idx);
            }
        }
    }

    fn pop_scc_component(&mut self, node: &str) {
        let mut scc = Vec::new();
        while let Some(w) = self.stack.pop() {
            self.on_stack.remove(&w);
            let is_node = w == node;
            scc.push(w);
            if is_node {
                break;
            }
        }
        self.sccs.push(scc.clone());

        if scc.len() > 1 {
            self.cycles.push(scc);
        } else if let Some(single) = scc.first() {
            if let Some(neighbors) = self.adjacency.get(single) {
                if neighbors.contains(single) {
                    self.cycles.push(vec![single.clone(), single.clone()]);
                }
            }
        }
    }

    fn strong_connect(&mut self, node: &str) {
        self.indices.insert(node.to_string(), self.index_counter);
        self.lowlinks.insert(node.to_string(), self.index_counter);
        self.index_counter += 1;
        self.stack.push(node.to_string());
        self.on_stack.insert(node.to_string());

        if let Some(neighbors) = self.adjacency.get(node) {
            for neighbor in neighbors {
                self.connect_neighbor(node, neighbor);
            }
        }

        let is_root = self.lowlinks.get(node) == self.indices.get(node);
        if is_root {
            self.pop_scc_component(node);
        }
    }
}

pub fn run_analyze_dependency_graph(edges: &[Vec<String>]) -> GraphAnalysis {
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
    let mut tarjan = TarjanState::new(&adjacency);
    for node in &all_nodes {
        if !tarjan.indices.contains_key(node) {
            tarjan.strong_connect(node);
        }
    }
    let cycles = tarjan.cycles;
    let sccs = tarjan.sccs;

    // 2. Kahn's Topological Sort
    let topological_order = kahn_topological_sort(&adjacency, &in_degree, &all_nodes);

    let is_acyclic = cycles.is_empty();

    GraphAnalysis {
        cycles,
        topological_order,
        strongly_connected_components: sccs,
        is_acyclic,
    }
}

/// Computes deterministic topological order with cycle-node preservation via Kahn's algorithm.
fn kahn_topological_sort(
    adjacency: &HashMap<String, HashSet<String>>,
    in_degree: &HashMap<String, usize>,
    all_nodes: &BTreeSet<String>,
) -> Vec<String> {
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
    for node in all_nodes {
        if !topological_order.contains(node) {
            topological_order.push(node.clone());
        }
    }

    topological_order
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DominatorTreeResult {
    pub entry: String,
    pub reachable_nodes: Vec<String>,
    pub idom: HashMap<String, String>,
    pub dominance_frontiers: HashMap<String, Vec<String>>,
    pub loop_headers: Vec<String>,
    pub back_edges: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataflowResult {
    pub in_sets: HashMap<String, Vec<String>>,
    pub out_sets: HashMap<String, Vec<String>>,
    pub iterations: usize,
}

fn intersect_idom(mut b1: usize, mut b2: usize, doms: &[usize], rpo_index: &[usize]) -> usize {
    while b1 != b2 {
        while rpo_index[b1] > rpo_index[b2] {
            b1 = doms[b1];
        }
        while rpo_index[b2] > rpo_index[b1] {
            b2 = doms[b2];
        }
    }
    b1
}

fn node_dominates(doms: &[usize], mut u: usize, v: usize) -> bool {
    if u == v {
        return true;
    }
    while u != doms[u] && u != usize::MAX {
        u = doms[u];
        if u == v {
            return true;
        }
    }
    false
}

struct IndexedGraph {
    all_node_names: Vec<String>,
    name_to_id: HashMap<String, usize>,
    succs: Vec<Vec<usize>>,
    preds: Vec<Vec<usize>>,
}

impl IndexedGraph {
    fn build(entry: &str, nodes: &[String], edges: &[Vec<String>]) -> Self {
        let mut node_set: BTreeSet<String> = BTreeSet::new();
        node_set.insert(entry.to_string());
        for n in nodes {
            node_set.insert(n.clone());
        }
        for edge in edges {
            if edge.len() >= 2 {
                node_set.insert(edge[0].clone());
                node_set.insert(edge[1].clone());
            }
        }

        let all_node_names: Vec<String> = node_set.into_iter().collect();
        let name_to_id: HashMap<String, usize> = all_node_names
            .iter()
            .enumerate()
            .map(|(idx, name)| (name.clone(), idx))
            .collect();

        let total = all_node_names.len();
        let mut succs: Vec<Vec<usize>> = vec![Vec::new(); total];
        let mut preds: Vec<Vec<usize>> = vec![Vec::new(); total];

        for edge in edges {
            if edge.len() >= 2 {
                if let (Some(&u), Some(&v)) = (name_to_id.get(&edge[0]), name_to_id.get(&edge[1])) {
                    succs[u].push(v);
                    preds[v].push(u);
                }
            }
        }

        Self {
            all_node_names,
            name_to_id,
            succs,
            preds,
        }
    }
}

fn compute_rpo(entry_id: usize, succs: &[Vec<usize>], total: usize) -> (Vec<usize>, Vec<usize>) {
    let mut visited = vec![false; total];
    let mut post_order = Vec::with_capacity(total);

    fn dfs_rpo(
        node: usize,
        succs: &[Vec<usize>],
        visited: &mut [bool],
        post_order: &mut Vec<usize>,
    ) {
        visited[node] = true;
        for &nxt in &succs[node] {
            if !visited[nxt] {
                dfs_rpo(nxt, succs, visited, post_order);
            }
        }
        post_order.push(node);
    }

    dfs_rpo(entry_id, succs, &mut visited, &mut post_order);
    let mut rpo = post_order;
    rpo.reverse();

    let mut rpo_index = vec![usize::MAX; total];
    for (idx, &node) in rpo.iter().enumerate() {
        rpo_index[node] = idx;
    }
    (rpo, rpo_index)
}

fn compute_immediate_dominators(
    entry_id: usize,
    rpo: &[usize],
    rpo_index: &[usize],
    preds: &[Vec<usize>],
    total: usize,
) -> Vec<usize> {
    let mut doms = vec![usize::MAX; total];
    doms[entry_id] = entry_id;

    let mut changed = true;
    while changed {
        changed = false;
        for &b in &rpo[1..] {
            let mut new_idom = usize::MAX;
            for &p in &preds[b] {
                if doms[p] != usize::MAX {
                    new_idom = p;
                    break;
                }
            }

            if new_idom != usize::MAX {
                for &p in &preds[b] {
                    if p != new_idom && doms[p] != usize::MAX {
                        new_idom = intersect_idom(p, new_idom, &doms, rpo_index);
                    }
                }

                if doms[b] != new_idom {
                    doms[b] = new_idom;
                    changed = true;
                }
            }
        }
    }
    doms
}

fn compute_dominance_frontiers(
    rpo: &[usize],
    preds: &[Vec<usize>],
    doms: &[usize],
    total: usize,
) -> Vec<BTreeSet<usize>> {
    let mut df: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); total];
    for &b in rpo {
        if preds[b].len() >= 2 {
            for &p in &preds[b] {
                let mut runner = p;
                while runner != doms[b] && runner != usize::MAX {
                    df[runner].insert(b);
                    if runner == doms[runner] {
                        break;
                    }
                    runner = doms[runner];
                }
            }
        }
    }
    df
}

fn detect_back_edges(
    edges: &[Vec<String>],
    name_to_id: &HashMap<String, usize>,
    doms: &[usize],
) -> (Vec<(String, String)>, Vec<String>) {
    let mut back_edges = Vec::new();
    let mut loop_headers_set = BTreeSet::new();

    for edge in edges {
        if edge.len() >= 2 {
            if let (Some(&u), Some(&v)) = (name_to_id.get(&edge[0]), name_to_id.get(&edge[1])) {
                if doms[u] != usize::MAX && doms[v] != usize::MAX && node_dominates(doms, u, v) {
                    back_edges.push((edge[0].clone(), edge[1].clone()));
                    loop_headers_set.insert(edge[1].clone());
                }
            }
        }
    }

    (back_edges, loop_headers_set.into_iter().collect())
}

pub fn compute_dominator_tree(
    entry: &str,
    nodes: &[String],
    edges: &[Vec<String>],
) -> DominatorTreeResult {
    let graph = IndexedGraph::build(entry, nodes, edges);
    let entry_id = *graph.name_to_id.get(entry).unwrap_or(&0);
    let total = graph.all_node_names.len();

    let (rpo, rpo_index) = compute_rpo(entry_id, &graph.succs, total);
    let doms = compute_immediate_dominators(entry_id, &rpo, &rpo_index, &graph.preds, total);
    let df = compute_dominance_frontiers(&rpo, &graph.preds, &doms, total);
    let (back_edges, loop_headers) = detect_back_edges(edges, &graph.name_to_id, &doms);

    let reachable_names: Vec<String> = rpo
        .iter()
        .map(|&idx| graph.all_node_names[idx].clone())
        .collect();
    let mut idom_map = HashMap::new();
    for &b in &rpo {
        if b != entry_id && doms[b] != usize::MAX {
            idom_map.insert(
                graph.all_node_names[b].clone(),
                graph.all_node_names[doms[b]].clone(),
            );
        }
    }

    let mut df_map = HashMap::new();
    for &b in &rpo {
        let targets: Vec<String> = df[b]
            .iter()
            .map(|&idx| graph.all_node_names[idx].clone())
            .collect();
        df_map.insert(graph.all_node_names[b].clone(), targets);
    }

    DominatorTreeResult {
        entry: entry.to_string(),
        reachable_nodes: reachable_names,
        idom: idom_map,
        dominance_frontiers: df_map,
        loop_headers,
        back_edges,
    }
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

/// Helper for executing a single forward dataflow node convergence step.
fn step_forward_dataflow_node(
    node_idx: usize,
    preds: &[usize],
    gen_set: &BTreeSet<String>,
    kill_set: &BTreeSet<String>,
    in_sets: &mut [BTreeSet<String>],
    out_sets: &mut [BTreeSet<String>],
) -> bool {
    let mut new_in = BTreeSet::new();
    for &p in preds {
        for val in &out_sets[p] {
            new_in.insert(val.clone());
        }
    }
    let in_changed = if new_in != in_sets[node_idx] {
        in_sets[node_idx] = new_in;
        true
    } else {
        false
    };

    let mut new_out = gen_set.clone();
    for val in in_sets[node_idx].iter() {
        if !kill_set.contains(val) {
            new_out.insert(val.clone());
        }
    }
    let out_changed = if new_out != out_sets[node_idx] {
        out_sets[node_idx] = new_out;
        true
    } else {
        false
    };
    in_changed || out_changed
}

/// Helper for executing a single backward dataflow node convergence step.
fn step_backward_dataflow_node(
    node_idx: usize,
    succs: &[usize],
    gen_set: &BTreeSet<String>,
    kill_set: &BTreeSet<String>,
    in_sets: &mut [BTreeSet<String>],
    out_sets: &mut [BTreeSet<String>],
) -> bool {
    let mut new_out = BTreeSet::new();
    for &s in succs {
        for val in &in_sets[s] {
            new_out.insert(val.clone());
        }
    }
    let out_changed = if new_out != out_sets[node_idx] {
        out_sets[node_idx] = new_out;
        true
    } else {
        false
    };

    let mut new_in = gen_set.clone();
    for val in out_sets[node_idx].iter() {
        if !kill_set.contains(val) {
            new_in.insert(val.clone());
        }
    }
    let in_changed = if new_in != in_sets[node_idx] {
        in_sets[node_idx] = new_in;
        true
    } else {
        false
    };
    out_changed || in_changed
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

/// Solves intra-procedural forward or backward dataflow equations using structured config object.
pub fn solve_dataflow_configured(config: &DataflowConfig<'_>) -> DataflowResult {
    let graph = IndexedGraph::build(config.entry, config.nodes, config.edges);
    let total = graph.all_node_names.len();
    let all_node_names = &graph.all_node_names;
    let succs = &graph.succs;
    let preds = &graph.preds;

    let mut in_sets: Vec<BTreeSet<String>> = vec![BTreeSet::new(); total];
    let mut out_sets: Vec<BTreeSet<String>> = vec![BTreeSet::new(); total];

    let gen_sets: Vec<BTreeSet<String>> = (0..total)
        .map(|i| {
            let name = &all_node_names[i];
            config
                .gen_map
                .get(name)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .collect()
        })
        .collect();

    let kill_sets: Vec<BTreeSet<String>> = (0..total)
        .map(|i| {
            let name = &all_node_names[i];
            config
                .kill_map
                .get(name)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .collect()
        })
        .collect();

    let mut iterations = 0;
    let mut changed = true;

    while changed && iterations < MAX_DATAFLOW_ITERATIONS {
        changed = false;
        iterations += 1;

        for i in 0..total {
            let node_changed = if config.forward {
                step_forward_dataflow_node(
                    i,
                    &preds[i],
                    &gen_sets[i],
                    &kill_sets[i],
                    &mut in_sets,
                    &mut out_sets,
                )
            } else {
                step_backward_dataflow_node(
                    i,
                    &succs[i],
                    &gen_sets[i],
                    &kill_sets[i],
                    &mut in_sets,
                    &mut out_sets,
                )
            };
            if node_changed {
                changed = true;
            }
        }
    }

    let mut in_map = HashMap::new();
    let mut out_map = HashMap::new();
    for i in 0..total {
        let name = all_node_names[i].clone();
        in_map.insert(name.clone(), in_sets[i].iter().cloned().collect());
        out_map.insert(name, out_sets[i].iter().cloned().collect());
    }

    DataflowResult {
        in_sets: in_map,
        out_sets: out_map,
        iterations,
    }
}

/// Computes transitive closure over a dense boolean adjacency matrix using Warshall's algorithm.
/// Operates on a flat row-major slice of size * size in-place with zero intermediate heap allocations.
pub fn compute_warshall_transitive_closure(matrix: &mut [u8], size: usize) {
    if size == 0 || matrix.len() < size * size {
        return;
    }

    for k in 0..size {
        let k_row = k * size;
        for i in 0..size {
            let i_row = i * size;
            if matrix[i_row + k] == 1 {
                for j in 0..size {
                    if matrix[i_row + j] == 0 && matrix[k_row + j] == 1 {
                        matrix[i_row + j] = 1;
                    }
                }
            }
        }
    }
}

/// Bit-parallel SWAR Warshall transitive closure utilizing 64-bit words for 64x parallel bit operations.
pub fn compute_bit_parallel_warshall(matrix: &mut [u64], words_per_row: usize, size: usize) {
    if size == 0 || words_per_row == 0 || matrix.len() < size * words_per_row {
        return;
    }

    for k in 0..size {
        let k_word_idx = k / BITS_PER_U64_WORD;
        let k_bit_mask = 1u64 << (k % BITS_PER_U64_WORD);
        let k_row = k * words_per_row;

        for i in 0..size {
            let i_row = i * words_per_row;
            if (matrix[i_row + k_word_idx] & k_bit_mask) != 0 {
                for w in 0..words_per_row {
                    matrix[i_row + w] |= matrix[k_row + w];
                }
            }
        }
    }
}

/// Computes forward reachable transitive closure from seeds using an allocation-thin pointer BFS queue.
pub fn compute_bfs_transitive_closure(
    seeds: &[String],
    adjacency: &HashMap<String, Vec<String>>,
    max_depth: usize,
) -> Vec<String> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut queue_nodes: Vec<String> = Vec::new();
    let mut queue_depths: Vec<usize> = Vec::new();

    for seed in seeds {
        if !visited.contains(seed) {
            visited.insert(seed.clone());
            queue_nodes.push(seed.clone());
            queue_depths.push(0);
        }
    }

    let mut head = 0usize;
    while head < queue_nodes.len() {
        let current_node = queue_nodes[head].clone();
        let current_depth = queue_depths[head];
        head += 1;

        if current_depth >= max_depth {
            continue;
        }

        if let Some(neighbors) = adjacency.get(&current_node) {
            for neighbor in neighbors {
                if !visited.contains(neighbor) {
                    visited.insert(neighbor.clone());
                    queue_nodes.push(neighbor.clone());
                    queue_depths.push(current_depth + 1);
                }
            }
        }
    }

    queue_nodes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_acyclic_graph() {
        let edges = vec![
            vec!["a".to_string(), "b".to_string()],
            vec!["b".to_string(), "c".to_string()],
        ];
        let analysis = run_analyze_dependency_graph(&edges);
        assert!(analysis.is_acyclic);
        assert_eq!(analysis.topological_order, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_cyclic_graph() {
        let edges = vec![
            vec!["a".to_string(), "b".to_string()],
            vec!["b".to_string(), "a".to_string()],
        ];
        let analysis = run_analyze_dependency_graph(&edges);
        assert!(!analysis.is_acyclic);
        assert_eq!(analysis.cycles.len(), 1);
    }

    #[test]
    fn test_dominator_diamond() {
        let edges = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["A".to_string(), "C".to_string()],
            vec!["B".to_string(), "D".to_string()],
            vec!["C".to_string(), "D".to_string()],
        ];
        let res = compute_dominator_tree("A", &[], &edges);
        assert_eq!(res.entry, "A");
        assert_eq!(res.idom.get("B").unwrap(), "A");
        assert_eq!(res.idom.get("C").unwrap(), "A");
        assert_eq!(res.idom.get("D").unwrap(), "A");

        let df_b = res.dominance_frontiers.get("B").unwrap();
        assert_eq!(df_b, &vec!["D".to_string()]);
        let df_c = res.dominance_frontiers.get("C").unwrap();
        assert_eq!(df_c, &vec!["D".to_string()]);
    }

    #[test]
    fn test_dominator_loop() {
        let edges = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["B".to_string(), "C".to_string()],
            vec!["C".to_string(), "B".to_string()],
            vec!["C".to_string(), "D".to_string()],
        ];
        let res = compute_dominator_tree("A", &[], &edges);
        assert_eq!(res.idom.get("B").unwrap(), "A");
        assert_eq!(res.idom.get("C").unwrap(), "B");
        assert_eq!(res.idom.get("D").unwrap(), "C");

        assert_eq!(res.loop_headers, vec!["B".to_string()]);
        assert_eq!(res.back_edges, vec![("C".to_string(), "B".to_string())]);
    }

    #[test]
    fn test_dataflow_fixed_point() {
        let edges = vec![
            vec!["n1".to_string(), "n2".to_string()],
            vec!["n2".to_string(), "n3".to_string()],
        ];
        let mut gen = HashMap::new();
        gen.insert("n1".to_string(), vec!["x".to_string()]);
        gen.insert("n2".to_string(), vec!["y".to_string()]);

        let mut kill = HashMap::new();
        kill.insert("n2".to_string(), vec!["x".to_string()]);

        let res = solve_dataflow("n1", &[], &edges, true, &gen, &kill);
        assert!(res.iterations >= 2);
        let out_n3 = res.out_sets.get("n3").unwrap();
        assert!(out_n3.contains(&"y".to_string()));
        assert!(!out_n3.contains(&"x".to_string()));
    }

    #[test]
    fn test_empty_graph() {
        let empty_analysis = run_analyze_dependency_graph(&[]);
        assert!(empty_analysis.is_acyclic);
        assert!(empty_analysis.cycles.is_empty());
        assert!(empty_analysis.topological_order.is_empty());
    }

    #[test]
    fn test_self_loop() {
        let edges = vec![vec!["A".to_string(), "A".to_string()]];
        let analysis = run_analyze_dependency_graph(&edges);
        assert!(!analysis.is_acyclic);
        assert_eq!(analysis.cycles.len(), 1);
        assert_eq!(analysis.cycles[0], vec!["A".to_string(), "A".to_string()]);
    }

    #[test]
    fn test_disconnected_components() {
        let edges = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["C".to_string(), "D".to_string()],
            vec!["E".to_string(), "F".to_string()],
            vec!["F".to_string(), "E".to_string()],
        ];
        let analysis = run_analyze_dependency_graph(&edges);
        assert!(!analysis.is_acyclic);
        assert_eq!(analysis.cycles.len(), 1);
        assert!(analysis.strongly_connected_components.len() >= 3);
    }

    #[test]
    fn test_backward_dataflow() {
        let edges = vec![
            vec!["entry".to_string(), "middle".to_string()],
            vec!["middle".to_string(), "exit".to_string()],
        ];
        let mut gen = HashMap::new();
        gen.insert("exit".to_string(), vec!["live_var".to_string()]);

        let res = solve_dataflow("entry", &[], &edges, false, &gen, &HashMap::new());
        assert!(res.iterations >= 2);
        let in_middle = res.in_sets.get("middle").unwrap();
        assert!(in_middle.contains(&"live_var".to_string()));
    }

    #[test]
    fn test_topological_sort_kahn() {
        let edges = vec![
            vec!["A".to_string(), "B".to_string()],
            vec!["B".to_string(), "C".to_string()],
            vec!["C".to_string(), "D".to_string()],
        ];
        let analysis = run_analyze_dependency_graph(&edges);
        assert!(analysis.is_acyclic);
        assert_eq!(analysis.topological_order, vec!["A", "B", "C", "D"]);
    }

    #[test]
    fn test_dominator_tree_deep_chain() {
        let edges = vec![
            vec!["N0".to_string(), "N1".to_string()],
            vec!["N1".to_string(), "N2".to_string()],
            vec!["N2".to_string(), "N3".to_string()],
            vec!["N3".to_string(), "N4".to_string()],
        ];
        let res = compute_dominator_tree("N0", &[], &edges);
        assert_eq!(res.idom.get("N1").unwrap(), "N0");
        assert_eq!(res.idom.get("N2").unwrap(), "N1");
        assert_eq!(res.idom.get("N3").unwrap(), "N2");
        assert_eq!(res.idom.get("N4").unwrap(), "N3");
        assert!(res.loop_headers.is_empty());
    }

    #[test]
    fn test_dataflow_multi_predecessor_union() {
        let edges = vec![
            vec!["P1".to_string(), "Merge".to_string()],
            vec!["P2".to_string(), "Merge".to_string()],
        ];
        let mut gen = HashMap::new();
        gen.insert("P1".to_string(), vec!["fact_from_p1".to_string()]);
        gen.insert("P2".to_string(), vec!["fact_from_p2".to_string()]);

        let res = solve_dataflow("P1", &[], &edges, true, &gen, &HashMap::new());
        let in_merge = res.in_sets.get("Merge").unwrap();
        assert!(in_merge.contains(&"fact_from_p1".to_string()));
        assert!(in_merge.contains(&"fact_from_p2".to_string()));
    }

    #[test]
    fn test_warshall_transitive_closure() {
        // 3 nodes: 0 -> 1, 1 -> 2
        let mut matrix = vec![
            1, 1, 0, // row 0
            0, 1, 1, // row 1
            0, 0, 1, // row 2
        ];
        compute_warshall_transitive_closure(&mut matrix, 3);
        // Indexed as `row * 3 + column` for readability against the row layout above. Clippy
        // rejects the literal multiplication (`erasing_op`/`identity_op`) because it folds to a
        // constant, so the stride is named here instead: the expression stays `row + column`
        // shaped while no longer tripping the fold.
        const STRIDE: usize = 3;
        let at = |row: usize, column: usize| matrix[row * STRIDE + column];
        // After closure: 0 should reach 2
        assert_eq!(at(0, 2), 1);
        assert_eq!(at(1, 2), 1);
        assert_eq!(at(2, 0), 0);
    }

    #[test]
    fn test_bit_parallel_warshall() {
        // 3 nodes packed into 1 u64 word per row
        let mut matrix = vec![
            (1 << 0) | (1 << 1), // 0 -> 0, 1
            (1 << 1) | (1 << 2), // 1 -> 1, 2
            (1 << 2),            // 2 -> 2
        ];
        compute_bit_parallel_warshall(&mut matrix, 1, 3);
        // 0 should reach 2
        assert_eq!(matrix[0] & (1 << 2), 1 << 2);
    }

    #[test]
    fn test_bfs_transitive_closure() {
        let mut adj = HashMap::new();
        adj.insert("A".to_string(), vec!["B".to_string()]);
        adj.insert("B".to_string(), vec!["C".to_string()]);
        adj.insert("C".to_string(), vec!["D".to_string()]);

        let reachable_all = compute_bfs_transitive_closure(&["A".to_string()], &adj, 10);
        assert_eq!(reachable_all, vec!["A", "B", "C", "D"]);

        let reachable_depth_1 = compute_bfs_transitive_closure(&["A".to_string()], &adj, 1);
        assert_eq!(reachable_depth_1, vec!["A", "B"]);
    }
}
