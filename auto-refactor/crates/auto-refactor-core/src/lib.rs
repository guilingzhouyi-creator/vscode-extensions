use napi_derive::napi;
use std::collections::HashMap;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

#[napi]
pub const VERSION: &str = "0.4.0-rust-native";

#[napi(object)]
pub struct NativeDiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<String>,
}

impl From<ops_diff::DiffHunk> for NativeDiffHunk {
    fn from(hunk: ops_diff::DiffHunk) -> Self {
        Self {
            old_start: hunk.old_start,
            old_lines: hunk.old_lines,
            new_start: hunk.new_start,
            new_lines: hunk.new_lines,
            lines: hunk.lines,
        }
    }
}

#[napi(object)]
pub struct NativeGraphAnalysis {
    pub cycles: Vec<Vec<String>>,
    pub topological_order: Vec<String>,
    pub strongly_connected_components: Vec<Vec<String>>,
    pub is_acyclic: bool,
}

impl From<ops_graph::GraphAnalysis> for NativeGraphAnalysis {
    fn from(analysis: ops_graph::GraphAnalysis) -> Self {
        Self {
            cycles: analysis.cycles,
            topological_order: analysis.topological_order,
            strongly_connected_components: analysis.strongly_connected_components,
            is_acyclic: analysis.is_acyclic,
        }
    }
}

#[napi(object)]
pub struct NativePatternMatch {
    pub pattern: String,
    pub line: u32,
    pub column: u32,
    pub match_text: String,
}

impl From<ops_pattern::PatternMatch> for NativePatternMatch {
    fn from(matched: ops_pattern::PatternMatch) -> Self {
        Self {
            pattern: matched.pattern,
            line: matched.line,
            column: matched.column,
            match_text: matched.match_text,
        }
    }
}

#[napi(object)]
pub struct NativeMaskConfig {
    pub line_comment: String,
    pub block_comment_open: Option<String>,
    pub block_comment_close: Option<String>,
    pub quote_chars: String,
    pub multiline_templates: Option<bool>,
    pub regex_literals: Option<bool>,
}

#[napi(object)]
pub struct NativeMaskedSource {
    pub raw: Vec<String>,
    pub masked: Vec<String>,
    pub lines: u32,
    pub non_blank_lines: u32,
}

impl From<NativeMaskConfig> for ops_mask::MaskConfig {
    fn from(config: NativeMaskConfig) -> Self {
        let block_comment = match (config.block_comment_open, config.block_comment_close) {
            (Some(open_delim), Some(close_delim))
                if !open_delim.is_empty() && !close_delim.is_empty() =>
            {
                Some((open_delim, close_delim))
            }
            _ => None,
        };
        Self {
            line_comment: config.line_comment,
            block_comment,
            quote_chars: config.quote_chars,
            multiline_templates: config.multiline_templates.unwrap_or(false),
            regex_literals: config.regex_literals.unwrap_or(false),
        }
    }
}

impl From<ops_mask::MaskResult> for NativeMaskedSource {
    fn from(result: ops_mask::MaskResult) -> Self {
        Self {
            raw: result.raw,
            masked: result.masked,
            lines: result.lines,
            non_blank_lines: result.non_blank_lines,
        }
    }
}

#[napi]
pub fn compute_histogram_diff(old_content: String, new_content: String) -> Vec<NativeDiffHunk> {
    ops_diff::run_histogram_diff(&old_content, &new_content)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi]
pub fn analyze_dependency_graph(edges: Vec<Vec<String>>) -> NativeGraphAnalysis {
    ops_graph::run_analyze_dependency_graph(&edges).into()
}

#[napi]
pub fn fast_pattern_match(source_text: String, patterns: Vec<String>) -> Vec<NativePatternMatch> {
    ops_pattern::run_fast_pattern_match(&source_text, &patterns)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi]
pub fn mask_source_code(content: String, config: NativeMaskConfig) -> NativeMaskedSource {
    let mask_config: ops_mask::MaskConfig = config.into();
    ops_mask::mask_source_code(&content, &mask_config).into()
}

#[napi(js_name = "maskSourceCodeCompact")]
pub fn mask_source_code_compact(content: String, config: NativeMaskConfig) -> String {
    let mask_config: ops_mask::MaskConfig = config.into();
    ops_mask::mask_source_code_compact(&content, &mask_config)
}

#[napi(object)]
pub struct NativeCloneBlock {
    pub start_line: u32,
    pub original_line: u32,
    pub line_span: u32,
}

impl From<ops_clone::CloneBlock> for NativeCloneBlock {
    fn from(block: ops_clone::CloneBlock) -> Self {
        Self {
            start_line: block.start_line,
            original_line: block.original_line,
            line_span: block.line_span,
        }
    }
}

#[napi(object)]
pub struct NativeClonePair {
    pub file_a: u32,
    pub file_b: u32,
    pub similarity: f64,
}

impl From<ops_clone::ClonePair> for NativeClonePair {
    fn from(pair: ops_clone::ClonePair) -> Self {
        Self {
            file_a: pair.file_a,
            file_b: pair.file_b,
            similarity: pair.similarity,
        }
    }
}

#[napi]
pub fn count_duplicate_lines(content: String) -> u32 {
    ops_clone::count_duplicate_lines(&content)
}

#[napi]
pub fn detect_clone_blocks(content: String, min_clone_lines: u32) -> Vec<NativeCloneBlock> {
    ops_clone::detect_clone_blocks(&content, min_clone_lines)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi(js_name = "computeMinHash")]
pub fn compute_minhash(content: String, num_perm: Option<u32>) -> Vec<u32> {
    let num_permutations = num_perm.unwrap_or(64) as usize;
    ops_clone::compute_minhash(&content, num_permutations)
}

#[napi]
pub fn find_clone_pairs(signatures: Vec<Vec<u32>>, threshold: f64) -> Vec<NativeClonePair> {
    ops_clone::find_clone_pairs(&signatures, threshold)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi(object)]
pub struct NativeDominatorTreeResult {
    pub entry: String,
    pub reachable_nodes: Vec<String>,
    pub idom: HashMap<String, String>,
    pub dominance_frontiers: HashMap<String, Vec<String>>,
    pub loop_headers: Vec<String>,
    pub back_edges: Vec<Vec<String>>,
}

impl From<ops_graph::DominatorTreeResult> for NativeDominatorTreeResult {
    fn from(result: ops_graph::DominatorTreeResult) -> Self {
        Self {
            entry: result.entry,
            reachable_nodes: result.reachable_nodes,
            idom: result.idom,
            dominance_frontiers: result.dominance_frontiers,
            loop_headers: result.loop_headers,
            back_edges: result
                .back_edges
                .into_iter()
                .map(|(src_node, dst_node)| vec![src_node, dst_node])
                .collect(),
        }
    }
}

#[napi(object)]
pub struct NativeDataflowResult {
    pub in_sets: HashMap<String, Vec<String>>,
    pub out_sets: HashMap<String, Vec<String>>,
    pub iterations: u32,
}

impl From<ops_graph::DataflowResult> for NativeDataflowResult {
    fn from(result: ops_graph::DataflowResult) -> Self {
        Self {
            in_sets: result.in_sets,
            out_sets: result.out_sets,
            iterations: result.iterations as u32,
        }
    }
}

#[napi(js_name = "computeDominatorTree")]
pub fn compute_dominator_tree(
    entry: String,
    nodes: Vec<String>,
    edges: Vec<Vec<String>>,
) -> NativeDominatorTreeResult {
    ops_graph::compute_dominator_tree(&entry, &nodes, &edges).into()
}

#[napi(js_name = "solveDataflow")]
pub fn solve_dataflow(
    entry: String,
    nodes: Vec<String>,
    edges: Vec<Vec<String>>,
    forward: Option<bool>,
    gen_map: Option<HashMap<String, Vec<String>>>,
    kill_map: Option<HashMap<String, Vec<String>>>,
) -> NativeDataflowResult {
    let fwd = forward.unwrap_or(true);
    let gen = gen_map.unwrap_or_default();
    let kill = kill_map.unwrap_or_default();
    ops_graph::solve_dataflow(&entry, &nodes, &edges, fwd, &gen, &kill).into()
}

#[napi(js_name = "computeBitParallelDistance")]
pub fn compute_bit_parallel_distance(
    pattern: napi::bindgen_prelude::Uint32Array,
    text: napi::bindgen_prelude::Uint32Array,
) -> u32 {
    ops_diff::compute_bit_parallel_myers_distance(pattern.as_ref(), text.as_ref())
}

#[napi(js_name = "computeSimHash64")]
pub fn compute_simhash_64(tokens: Vec<String>) -> String {
    ops_clone::compute_simhash_64_hex(&tokens)
}

#[napi(js_name = "calculateSimHashHammingSimilarity")]
pub fn calculate_simhash_hamming_similarity(hash_a: String, hash_b: String) -> f64 {
    let fingerprint_a = ops_clone::parse_u64_fingerprint(&hash_a);
    let fingerprint_b = ops_clone::parse_u64_fingerprint(&hash_b);
    ops_clone::calculate_simhash_hamming_similarity(fingerprint_a, fingerprint_b)
}

#[napi(js_name = "calculateTrigramCosineSimilarity")]
pub fn calculate_trigram_cosine_similarity(tokens_a: Vec<String>, tokens_b: Vec<String>) -> f64 {
    ops_clone::calculate_trigram_cosine_similarity(&tokens_a, &tokens_b)
}

#[napi(object)]
pub struct NativeTemporalCouplingPair {
    pub file_a: u32,
    pub file_b: u32,
    pub shared_commits: u32,
    pub commits_a: u32,
    pub commits_b: u32,
    pub jaccard_similarity: f64,
}

impl From<ops_clone::TemporalCouplingPair> for NativeTemporalCouplingPair {
    fn from(pair: ops_clone::TemporalCouplingPair) -> Self {
        Self {
            file_a: pair.file_a,
            file_b: pair.file_b,
            shared_commits: pair.shared_commits,
            commits_a: pair.commits_a,
            commits_b: pair.commits_b,
            jaccard_similarity: pair.jaccard_similarity,
        }
    }
}

#[napi(js_name = "computeTemporalCoupling")]
pub fn compute_temporal_coupling(
    changesets: Vec<Vec<u32>>,
    min_shared: u32,
    min_jaccard: f64,
) -> Vec<NativeTemporalCouplingPair> {
    ops_clone::compute_temporal_coupling(&changesets, min_shared, min_jaccard)
        .into_iter()
        .map(Into::into)
        .collect()
}

#[napi(object)]
pub struct NativeBumpyRoadResult {
    pub bumpy_score: f64,
    pub is_bumpy: bool,
    pub mean_depth: f64,
    pub variance_depth: f64,
    pub spikes_count: u32,
}

impl From<ops_pattern::BumpyRoadResult> for NativeBumpyRoadResult {
    fn from(result: ops_pattern::BumpyRoadResult) -> Self {
        Self {
            bumpy_score: result.bumpy_score,
            is_bumpy: result.is_bumpy,
            mean_depth: result.mean_depth,
            variance_depth: result.variance_depth,
            spikes_count: result.spikes_count,
        }
    }
}

#[napi(js_name = "evaluateBumpyRoad")]
pub fn evaluate_bumpy_road(
    lines: Vec<String>,
    start_line: u32,
    end_line: u32,
) -> NativeBumpyRoadResult {
    ops_pattern::evaluate_bumpy_road(&lines, start_line, end_line).into()
}

#[napi(js_name = "batchProbeTriggers")]
pub fn batch_probe_triggers(content: String, trigger_groups: Vec<Vec<String>>) -> Vec<bool> {
    ops_pattern::batch_probe_triggers(&content, &trigger_groups)
}

#[napi(object)]
pub struct NativeStatisticalMoments {
    pub mean: f64,
    pub variance: f64,
    pub standard_deviation: f64,
    pub count: u32,
}

impl From<ops_math::StatisticalMoments> for NativeStatisticalMoments {
    fn from(m: ops_math::StatisticalMoments) -> Self {
        Self {
            mean: m.mean,
            variance: m.variance,
            standard_deviation: m.standard_deviation,
            count: m.count as u32,
        }
    }
}

#[napi(object)]
pub struct NativeBraceBalance {
    pub opens: u32,
    pub closes: u32,
    pub delta: i32,
}

impl From<ops_pattern::BraceBalance> for NativeBraceBalance {
    fn from(b: ops_pattern::BraceBalance) -> Self {
        Self {
            opens: b.opens,
            closes: b.closes,
            delta: b.delta,
        }
    }
}

#[napi(js_name = "computeShannonEntropy")]
pub fn compute_shannon_entropy(text: String) -> f64 {
    ops_math::compute_shannon_entropy(&text)
}

#[napi(js_name = "computeStatisticalMoments")]
pub fn compute_statistical_moments(values: Vec<f64>) -> NativeStatisticalMoments {
    ops_math::compute_statistical_moments(&values).into()
}

#[napi(js_name = "calculatePopoviciuDispersionPenalty")]
pub fn calculate_popoviciu_dispersion_penalty(
    standard_deviation: f64,
    max_sigma: Option<f64>,
    gamma: Option<f64>,
) -> f64 {
    ops_math::calculate_popoviciu_dispersion_penalty(standard_deviation, max_sigma, gamma)
}

#[napi(js_name = "countBracesDetailed")]
pub fn count_braces_detailed(line: String) -> NativeBraceBalance {
    ops_pattern::count_braces_detailed(&line).into()
}

#[napi(js_name = "computeWarshallTransitiveClosure")]
pub fn compute_warshall_transitive_closure(
    mut matrix: napi::bindgen_prelude::Uint8Array,
    size: u32,
) -> napi::bindgen_prelude::Uint8Array {
    ops_graph::compute_warshall_transitive_closure(matrix.as_mut(), size as usize);
    matrix
}

#[napi(js_name = "computeVectorDotProduct")]
pub fn compute_vector_dot_product(a: Vec<f64>, b: Vec<f64>) -> f64 {
    ops_vector::dot_product(&a, &b)
}

#[napi(js_name = "computeVectorCosineSimilarity")]
pub fn compute_vector_cosine_similarity(a: Vec<f64>, b: Vec<f64>) -> f64 {
    ops_vector::cosine_similarity(&a, &b)
}

#[napi(js_name = "computeVectorEuclideanDistance")]
pub fn compute_vector_euclidean_distance(a: Vec<f64>, b: Vec<f64>) -> f64 {
    ops_vector::euclidean_distance(&a, &b)
}

#[napi(object)]
pub struct NativeScopeInput {
    pub parent: Option<i32>,
    pub kind: u8,
    pub start_line: u32,
    pub end_line: u32,
}

#[napi(object)]
pub struct NativeBindingInput {
    pub scope_id: u32,
    pub name: String,
    pub kind: u8,
    pub line: u32,
}

#[napi(object)]
pub struct NativeShadowingResult {
    pub symbol: String,
    pub inner_scope_id: u32,
    pub inner_line: u32,
    pub outer_scope_id: u32,
    pub outer_line: u32,
    pub binding_kind: u8,
}

#[napi(js_name = "analyzeScopeShadowing")]
pub fn analyze_scope_shadowing(
    scopes: Vec<NativeScopeInput>,
    bindings: Vec<NativeBindingInput>,
) -> Vec<NativeShadowingResult> {
    let mut arena = ops_scope::FlatScopeArena::with_capacity(scopes.len(), bindings.len());
    for s in scopes {
        let parent_id = match s.parent {
            Some(p) if p >= 0 => Some(p as u32),
            _ => None,
        };
        arena.add_scope(
            parent_id,
            ops_scope::ScopeKind::from_u8(s.kind),
            s.start_line,
            s.end_line,
        );
    }
    for b in bindings {
        arena.add_binding(
            b.scope_id,
            &b.name,
            ops_scope::BindingKind::from_u8(b.kind),
            b.line,
        );
    }
    arena
        .detect_all_shadowing()
        .into_iter()
        .map(|d| NativeShadowingResult {
            symbol: d.symbol,
            inner_scope_id: d.inner_scope_id,
            inner_line: d.inner_line,
            outer_scope_id: d.outer_scope_id,
            outer_line: d.outer_line,
            binding_kind: d.binding_kind,
        })
        .collect()
}

#[napi(object)]
pub struct NativeSecretScanOptions {
    pub scan_entropy: Option<bool>,
    pub min_entropy_len: Option<u32>,
    pub entropy_threshold: Option<f64>,
    pub max_findings: Option<u32>,
}

#[napi(object)]
pub struct NativeSecretFinding {
    pub rule: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
    pub message: String,
    pub preview: String,
    pub entropy: f64,
}

#[napi(js_name = "scanSecretsNative")]
pub fn scan_secrets_native(
    source_text: String,
    options: Option<NativeSecretScanOptions>,
) -> Vec<NativeSecretFinding> {
    let opts = match options {
        Some(o) => ops_pattern::SecretScanOptions {
            scan_entropy: o.scan_entropy.unwrap_or(false),
            min_entropy_len: o.min_entropy_len.unwrap_or(24) as usize,
            entropy_threshold: o.entropy_threshold.unwrap_or(4.2),
            max_findings: o.max_findings.unwrap_or(50) as usize,
        },
        None => ops_pattern::SecretScanOptions::default(),
    };
    ops_pattern::scan_secrets_native(&source_text, &opts)
        .into_iter()
        .map(|f| NativeSecretFinding {
            rule: f.rule,
            kind: f.kind,
            line: f.line,
            column: f.column,
            message: f.message,
            preview: f.preview,
            entropy: f.entropy,
        })
        .collect()
}
