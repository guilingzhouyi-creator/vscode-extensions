use std::collections::{BTreeSet, HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphAnalysis {
    pub cycles: Vec<Vec<String>>,
    pub topological_order: Vec<String>,
    pub strongly_connected_components: Vec<Vec<String>>,
    pub is_acyclic: bool,
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

    GraphAnalysis {
        cycles,
        topological_order,
        strongly_connected_components: sccs,
        is_acyclic,
    }
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

pub fn compute_dominator_tree(
    entry: &str,
    nodes: &[String],
    edges: &[Vec<String>],
) -> DominatorTreeResult {
    // 1. Collect all node names and assign indices
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

    let entry_id = *name_to_id.get(entry).unwrap_or(&0);
    let total_all = all_node_names.len();

    let mut succs: Vec<Vec<usize>> = vec![Vec::new(); total_all];
    let mut preds: Vec<Vec<usize>> = vec![Vec::new(); total_all];

    for edge in edges {
        if edge.len() >= 2 {
            if let (Some(&u), Some(&v)) = (name_to_id.get(&edge[0]), name_to_id.get(&edge[1])) {
                succs[u].push(v);
                preds[v].push(u);
            }
        }
    }

    // 2. DFS from entry to discover reachable nodes and compute RPO
    let mut visited = vec![false; total_all];
    let mut post_order = Vec::with_capacity(total_all);

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

    dfs_rpo(entry_id, &succs, &mut visited, &mut post_order);

    let mut rpo = post_order;
    rpo.reverse();

    let _reachable_count = rpo.len();
    let mut rpo_index = vec![usize::MAX; total_all];
    for (idx, &node) in rpo.iter().enumerate() {
        rpo_index[node] = idx;
    }

    // 3. Cooper-Harvey-Kennedy Iterative Dominator computation
    let mut doms = vec![usize::MAX; total_all];
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
                        new_idom = intersect_idom(p, new_idom, &doms, &rpo_index);
                    }
                }

                if doms[b] != new_idom {
                    doms[b] = new_idom;
                    changed = true;
                }
            }
        }
    }

    // 4. Dominance Frontiers (DF)
    let mut df: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); total_all];
    for &b in &rpo {
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

    // 5. Back-edges & Loop Headers
    let mut back_edges = Vec::new();
    let mut loop_headers_set = BTreeSet::new();

    for edge in edges {
        if edge.len() >= 2 {
            if let (Some(&u), Some(&v)) = (name_to_id.get(&edge[0]), name_to_id.get(&edge[1])) {
                if doms[u] != usize::MAX && doms[v] != usize::MAX {
                    if node_dominates(&doms, u, v) {
                        back_edges.push((edge[0].clone(), edge[1].clone()));
                        loop_headers_set.insert(edge[1].clone());
                    }
                }
            }
        }
    }

    // Convert results to name maps
    let reachable_names: Vec<String> = rpo.iter().map(|&idx| all_node_names[idx].clone()).collect();
    let mut idom_map = HashMap::new();
    for &b in &rpo {
        if b != entry_id && doms[b] != usize::MAX {
            idom_map.insert(all_node_names[b].clone(), all_node_names[doms[b]].clone());
        }
    }

    let mut df_map = HashMap::new();
    for &b in &rpo {
        let targets: Vec<String> = df[b].iter().map(|&idx| all_node_names[idx].clone()).collect();
        df_map.insert(all_node_names[b].clone(), targets);
    }

    DominatorTreeResult {
        entry: entry.to_string(),
        reachable_nodes: reachable_names,
        idom: idom_map,
        dominance_frontiers: df_map,
        loop_headers: loop_headers_set.into_iter().collect(),
        back_edges,
    }
}

pub fn solve_dataflow(
    entry: &str,
    nodes: &[String],
    edges: &[Vec<String>],
    forward: bool,
    gen_map: &HashMap<String, Vec<String>>,
    kill_map: &HashMap<String, Vec<String>>,
) -> DataflowResult {
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

    let mut in_sets: Vec<BTreeSet<String>> = vec![BTreeSet::new(); total];
    let mut out_sets: Vec<BTreeSet<String>> = vec![BTreeSet::new(); total];

    let gen_sets: Vec<BTreeSet<String>> = (0..total)
        .map(|i| {
            let name = &all_node_names[i];
            gen_map
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
            kill_map
                .get(name)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .collect()
        })
        .collect();

    let mut iterations = 0;
    let mut changed = true;

    while changed && iterations < 500 {
        changed = false;
        iterations += 1;

        for i in 0..total {
            if forward {
                // In[i] = Union over p in Preds[i] of Out[p]
                let mut new_in = BTreeSet::new();
                for &p in &preds[i] {
                    for val in &out_sets[p] {
                        new_in.insert(val.clone());
                    }
                }
                if new_in != in_sets[i] {
                    in_sets[i] = new_in;
                    changed = true;
                }

                // Out[i] = Gen[i] Union (In[i] \ Kill[i])
                let mut new_out = gen_sets[i].clone();
                for val in &in_sets[i] {
                    if !kill_sets[i].contains(val) {
                        new_out.insert(val.clone());
                    }
                }
                if new_out != out_sets[i] {
                    out_sets[i] = new_out;
                    changed = true;
                }
            } else {
                // Backward analysis: Out[i] = Union over s in Succs[i] of In[s]
                let mut new_out = BTreeSet::new();
                for &s in &succs[i] {
                    for val in &in_sets[s] {
                        new_out.insert(val.clone());
                    }
                }
                if new_out != out_sets[i] {
                    out_sets[i] = new_out;
                    changed = true;
                }

                // In[i] = Gen[i] Union (Out[i] \ Kill[i])
                let mut new_in = gen_sets[i].clone();
                for val in &out_sets[i] {
                    if !kill_sets[i].contains(val) {
                        new_in.insert(val.clone());
                    }
                }
                if new_in != in_sets[i] {
                    in_sets[i] = new_in;
                    changed = true;
                }
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
}
