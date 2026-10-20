//! Module: Native Acceleration Kernel — MinHash, LSH & Clone Detection
//! Crate: ops-clone
//! Architecture Role: Rolling polynomial hash and LSH MinHash indexing for
//! sub-quadratic code clone detection and cross-file duplicate identification.

use std::collections::{HashMap, HashSet};

const FNV1A_32_PRIME: u32 = 0x01000193;
const FNV1A_32_OFFSET_BASIS: u32 = 0x811c9dc5;

pub const MINHASH_PERMUTATIONS: usize = 64;

/// 64 fixed deterministic (a, b) universal hash coefficients (a odd, coprime to 2^32)
pub const HASH_COEFFS: [(u32, u32); 64] = [
    (1103515245, 12345),
    (1664525, 1013904223),
    (22695477, 1),
    (69069, 5),
    (134775813, 1),
    (214013, 2531011),
    (16807, 0),
    (48271, 0),
    (65539, 0),
    (314159269, 271828183),
    (271828183, 314159269),
    (1234567891, 987654321),
    (987654321, 1234567891),
    (362436069, 521288629),
    (521288629, 362436069),
    (1588635695, 1111111111),
    (1111111111, 1588635695),
    (17711, 28657),
    (28657, 17711),
    (46368, 75025),
    (75025, 46368),
    (121393, 196418),
    (196418, 121393),
    (317811, 514229),
    (514229, 317811),
    (832040, 1346269),
    (1346269, 832040),
    (2178309, 3524578),
    (3524578, 2178309),
    (5702887, 9227465),
    (9227465, 5702887),
    (14930352, 24157817),
    (24157817, 14930352),
    (39088169, 63245986),
    (63245986, 39088169),
    (102334155, 165580141),
    (165580141, 102334155),
    (267914296, 433494437),
    (433494437, 267914296),
    (701408733, 1134903170),
    (1134903170, 701408733),
    (1836311903, 1969814873),
    (1969814873, 1836311903),
    (2042071191, 1374719261),
    (1374719261, 2042071191),
    (3416790453, 2748779069),
    (2748779069, 3416790453),
    (1867169421, 3928172901),
    (3928172901, 1867169421),
    (2491823901, 1928374191),
    (1928374191, 2491823901),
    (3918274191, 1029384751),
    (1029384751, 3918274191),
    (2938471921, 4019283741),
    (4019283741, 2938471921),
    (1938472911, 2039481721),
    (2039481721, 1938472911),
    (3049581921, 1928374651),
    (1928374651, 3049581921),
    (2938471021, 3928174651),
    (3928174651, 2938471021),
    (1827364519, 2938475619),
    (2938475619, 1827364519),
    (3847562911, 1928374653),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloneBlock {
    pub start_line: u32,
    pub original_line: u32,
    pub line_span: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClonePair {
    pub file_a: u32,
    pub file_b: u32,
    pub similarity: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TemporalCouplingPair {
    pub file_a: u32,
    pub file_b: u32,
    pub shared_commits: u32,
    pub commits_a: u32,
    pub commits_b: u32,
    pub jaccard_similarity: f64,
}

/// Compute 32-bit FNV-1a hash of a UTF-16 sequence (matching JS hashString32)
pub fn compute_string_hash_32(s: &str) -> u32 {
    let mut hash = FNV1A_32_OFFSET_BASIS;
    for c in s.encode_utf16() {
        hash ^= c as u32;
        hash = hash.wrapping_mul(FNV1A_32_PRIME);
    }
    hash
}

const FNV_OFFSET_BASIS_64: u64 = 0xcbf29ce484222325;
const FNV_PRIME_64: u64 = 0x100000001b3;

/// Compute 64-bit FNV-1a hash of a UTF-16 sequence matching JS fnv1a64
pub fn compute_string_hash_64(s: &str) -> u64 {
    let mut hash = FNV_OFFSET_BASIS_64;
    for code in s.encode_utf16() {
        hash ^= code as u64;
        hash = hash.wrapping_mul(FNV_PRIME_64);
    }
    hash
}

/// Compute 64-bit SimHash fingerprint from tokens
pub fn compute_simhash_64(tokens: &[String]) -> u64 {
    if tokens.is_empty() {
        return 0;
    }

    let mut weights = [0i32; 64];
    for token in tokens {
        let h = compute_string_hash_64(token);
        for (b, weight) in weights.iter_mut().enumerate() {
            let bit = (h >> b) & 1;
            if bit == 1 {
                *weight += 1;
            } else {
                *weight -= 1;
            }
        }
    }

    let mut fingerprint = 0u64;
    for (b, &weight) in weights.iter().enumerate() {
        if weight > 0 {
            fingerprint |= 1u64 << b;
        }
    }

    fingerprint
}

/// Compute SimHash-64 fingerprint and return as 16-character lowercase hex string
pub fn compute_simhash_64_hex(tokens: &[String]) -> String {
    format!("{:016x}", compute_simhash_64(tokens))
}

/// Calculate SimHash Hamming similarity via 64-bit hardware POPCNT instruction
pub fn calculate_simhash_hamming_similarity(hash_a: u64, hash_b: u64) -> f64 {
    let diff = hash_a ^ hash_b;
    if diff == 0 {
        return 1.0;
    }
    let distance = diff.count_ones();
    let sim = 1.0 - (distance as f64) / 64.0;
    let clamped = sim.clamp(0.0, 1.0);
    (clamped * 1e6).round() / 1e6
}

/// Parse hex string or decimal string into u64
pub fn parse_u64_fingerprint(s: &str) -> u64 {
    let trimmed = s.trim();
    if let Some(stripped) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u64::from_str_radix(stripped, 16).unwrap_or(0)
    } else {
        trimmed
            .parse::<u64>()
            .unwrap_or_else(|_| u64::from_str_radix(trimmed, 16).unwrap_or(0))
    }
}

/// Extract 3-gram sparse token frequency vector
pub fn extract_token_trigrams(tokens: &[String]) -> HashMap<String, u32> {
    let mut map = HashMap::new();
    if tokens.len() < 3 {
        return map;
    }
    for i in 0..(tokens.len() - 2) {
        let key = format!("{} {} {}", tokens[i], tokens[i + 1], tokens[i + 2]);
        *map.entry(key).or_insert(0) += 1;
    }
    map
}

/// Calculate cosine similarity between two token arrays using 3-gram feature vectors
pub fn calculate_trigram_cosine_similarity(tokens_a: &[String], tokens_b: &[String]) -> f64 {
    let map_a = extract_token_trigrams(tokens_a);
    let map_b = extract_token_trigrams(tokens_b);
    if map_a.is_empty() || map_b.is_empty() {
        return 0.0;
    }

    let (smaller, larger) = if map_a.len() <= map_b.len() {
        (&map_a, &map_b)
    } else {
        (&map_b, &map_a)
    };

    let mut dot_product = 0.0;
    for (k, &count_a) in smaller {
        if let Some(&count_b) = larger.get(k) {
            dot_product += (count_a as f64) * (count_b as f64);
        }
    }

    if dot_product <= 0.0 {
        return 0.0;
    }

    let mut sum_sq_a = 0.0;
    for &val in map_a.values() {
        sum_sq_a += (val as f64) * (val as f64);
    }

    let mut sum_sq_b = 0.0;
    for &val in map_b.values() {
        sum_sq_b += (val as f64) * (val as f64);
    }

    let denom = sum_sq_a.sqrt() * sum_sq_b.sqrt();
    if denom <= 0.0 {
        return 0.0;
    }

    let sim = dot_product / denom;
    let clamped = sim.clamp(0.0, 1.0);
    (clamped * 1e6).round() / 1e6
}

/// Counts duplicated non-blank lines in source content matching JS countDuplicateLines
pub fn count_duplicate_lines(content: &str) -> u32 {
    if content.is_empty() {
        return 0;
    }

    let mut counts: HashMap<u32, u32> = HashMap::new();
    let mut hash = FNV1A_32_OFFSET_BASIS;
    let mut is_blank = true;

    for code in content.encode_utf16() {
        if code == 10 {
            // '\n'
            if !is_blank {
                *counts.entry(hash).or_insert(0) += 1;
            }
            hash = FNV1A_32_OFFSET_BASIS;
            is_blank = true;
        } else {
            if code != 32 && code != 9 && code != 13 {
                // Not ' ', '\t', '\r'
                is_blank = false;
            }
            hash ^= code as u32;
            hash = hash.wrapping_mul(FNV1A_32_PRIME);
        }
    }

    if !is_blank {
        *counts.entry(hash).or_insert(0) += 1;
    }

    let mut duplicated = 0u32;
    for &count in counts.values() {
        if count > 1 {
            duplicated += count - 1;
        }
    }

    duplicated
}

/// Detects intra-file duplicate code blocks matching HYG-CLN-001 in hygiene.ts
pub fn detect_clone_blocks(content: &str, min_clone_lines: u32) -> Vec<CloneBlock> {
    let mut meaningful_lines: Vec<(usize, u32)> = Vec::new();

    for (line_idx, raw_slice) in content.split('\n').enumerate() {
        let line = raw_slice.strip_suffix('\r').unwrap_or(raw_slice);
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && !trimmed.starts_with("//")
            && !trimmed.starts_with('#')
            && trimmed != "{"
            && trimmed != "}"
        {
            meaningful_lines.push((line_idx + 1, compute_string_hash_32(trimmed)));
        }
    }

    let min_k = min_clone_lines as usize;
    if meaningful_lines.len() < min_k * 2 {
        return Vec::new();
    }

    let total = meaningful_lines.len();
    let mut block_map: HashMap<i32, usize> = HashMap::new();
    let mut clones = Vec::new();

    for i in 0..=(total.saturating_sub(min_k)) {
        let mut h: i32 = 0;
        for k in 0..min_k {
            let line_hash = meaningful_lines[i + k].1 as i32;
            h = h.wrapping_mul(31).wrapping_add(line_hash);
        }

        if let Some(&prev_idx) = block_map.get(&h) {
            if i >= prev_idx + min_k {
                let actual_start_line = meaningful_lines[i].0 as u32;
                let original_line = meaningful_lines[prev_idx].0 as u32;
                clones.push(CloneBlock {
                    start_line: actual_start_line,
                    original_line,
                    line_span: min_clone_lines,
                });
                break;
            }
        } else {
            block_map.insert(h, i);
        }
    }

    clones
}

/// Computes a 64-dimension MinHash signature vector for a source file
pub fn compute_minhash(content: &str, num_perm: usize) -> Vec<u32> {
    let num_hashes = num_perm.min(MINHASH_PERMUTATIONS);
    let mut signature = vec![u32::MAX; num_hashes];

    let mut meaningful_hashes: Vec<u32> = Vec::new();
    for raw_slice in content.split('\n') {
        let line = raw_slice.strip_suffix('\r').unwrap_or(raw_slice);
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && !trimmed.starts_with("//")
            && !trimmed.starts_with('#')
            && trimmed != "{"
            && trimmed != "}"
        {
            meaningful_hashes.push(compute_string_hash_32(trimmed));
        }
    }

    if meaningful_hashes.is_empty() {
        return signature;
    }

    // Generate shingles: k=3 rolling shingles if >= 3 lines, else individual lines
    let mut shingles: Vec<u32> = Vec::new();
    if meaningful_hashes.len() >= 3 {
        for i in 0..=meaningful_hashes.len() - 3 {
            let shingle = meaningful_hashes[i]
                .wrapping_mul(961)
                .wrapping_add(meaningful_hashes[i + 1].wrapping_mul(31))
                .wrapping_add(meaningful_hashes[i + 2]);
            shingles.push(shingle);
        }
    } else {
        shingles.extend(meaningful_hashes);
    }

    for &shingle in &shingles {
        for k in 0..num_hashes {
            let (a, b) = HASH_COEFFS[k];
            let hash_val = a.wrapping_mul(shingle).wrapping_add(b);
            if hash_val < signature[k] {
                signature[k] = hash_val;
            }
        }
    }

    signature
}

/// Locality Sensitive Hashing (LSH) candidate pair detection across file signatures
pub fn find_clone_pairs(signatures: &[Vec<u32>], threshold: f64) -> Vec<ClonePair> {
    let n = signatures.len();
    if n < 2 {
        return Vec::new();
    }

    let num_hashes = signatures[0].len();
    let num_bands = 16usize;
    let rows_per_band = num_hashes / num_bands;
    if rows_per_band == 0 {
        return Vec::new();
    }

    // 1. Group file indices into LSH buckets per band
    let mut candidates: HashSet<(u32, u32)> = HashSet::new();
    let mut buckets: HashMap<u32, Vec<u32>> = HashMap::new();

    for band in 0..num_bands {
        let start = band * rows_per_band;
        let end = start + rows_per_band;

        for (file_idx, sig) in signatures.iter().enumerate() {
            if sig.len() < end {
                continue;
            }
            let mut band_hash = FNV1A_32_OFFSET_BASIS;
            for &val in &sig[start..end] {
                band_hash ^= val;
                band_hash = band_hash.wrapping_mul(FNV1A_32_PRIME);
            }
            buckets.entry(band_hash).or_default().push(file_idx as u32);
        }

        for bucket in buckets.values() {
            if bucket.len() >= 2 {
                for i in 0..bucket.len() {
                    for j in (i + 1)..bucket.len() {
                        let a = bucket[i].min(bucket[j]);
                        let b = bucket[i].max(bucket[j]);
                        candidates.insert((a, b));
                    }
                }
            }
        }
        buckets.clear();
    }

    // 2. Verify candidate pairs against similarity threshold
    let mut pairs = Vec::new();
    for (a, b) in candidates {
        let sig_a = &signatures[a as usize];
        let sig_b = &signatures[b as usize];
        let total = sig_a.len().min(sig_b.len());
        if total == 0 {
            continue;
        }

        let mut matches = 0usize;
        for i in 0..total {
            if sig_a[i] == sig_b[i] {
                matches += 1;
            }
        }

        let similarity = matches as f64 / total as f64;
        if similarity >= threshold {
            pairs.push(ClonePair {
                file_a: a,
                file_b: b,
                similarity,
            });
        }
    }

    pairs.sort_by(|p1, p2| {
        p2.similarity
            .partial_cmp(&p1.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    pairs
}

/// Compute pairwise co-change frequencies and Jaccard similarity between files
/// from commit changesets.
///
/// Changesets is a slice of file ID vectors.
/// Each inner vector contains file IDs changed in a commit.
/// Only file pairs with shared commits >= `min_shared` and Jaccard similarity >= `min_jaccard`
/// are returned, sorted descending by Jaccard similarity, then descending by shared commits,
/// then ascending by file_a, then ascending by file_b.
pub fn compute_temporal_coupling(
    changesets: &[Vec<u32>],
    min_shared: u32,
    min_jaccard: f64,
) -> Vec<TemporalCouplingPair> {
    if changesets.is_empty() {
        return Vec::new();
    }
    let (file_commit_counts, pair_shared_counts) = accumulate_changeset_frequencies(changesets);
    filter_and_sort_temporal_pairs(
        &file_commit_counts,
        pair_shared_counts,
        min_shared,
        min_jaccard,
    )
}

fn accumulate_changeset_frequencies(
    changesets: &[Vec<u32>],
) -> (HashMap<u32, u32>, HashMap<(u32, u32), u32>) {
    let mut file_commit_counts: HashMap<u32, u32> = HashMap::new();
    let mut pair_shared_counts: HashMap<(u32, u32), u32> = HashMap::new();

    for cs in changesets {
        if cs.is_empty() {
            continue;
        }

        let mut unique = cs.clone();
        unique.sort_unstable();
        unique.dedup();

        if unique.len() == 1 {
            *file_commit_counts.entry(unique[0]).or_insert(0) += 1;
            continue;
        }

        for &file_id in &unique {
            *file_commit_counts.entry(file_id).or_insert(0) += 1;
        }

        let len = unique.len();
        for i in 0..len {
            let file_a = unique[i];
            for &file_b in unique.iter().skip(i + 1) {
                *pair_shared_counts.entry((file_a, file_b)).or_insert(0) += 1;
            }
        }
    }

    (file_commit_counts, pair_shared_counts)
}

fn filter_and_sort_temporal_pairs(
    file_commit_counts: &HashMap<u32, u32>,
    pair_shared_counts: HashMap<(u32, u32), u32>,
    min_shared: u32,
    min_jaccard: f64,
) -> Vec<TemporalCouplingPair> {
    let mut pairs = Vec::new();
    for ((file_a, file_b), shared_commits) in pair_shared_counts {
        if shared_commits < min_shared {
            continue;
        }

        let commits_a = *file_commit_counts.get(&file_a).unwrap_or(&0);
        let commits_b = *file_commit_counts.get(&file_b).unwrap_or(&0);
        let union_count = commits_a + commits_b - shared_commits;
        if union_count == 0 {
            continue;
        }

        let jaccard = (shared_commits as f64) / (union_count as f64);
        let jaccard_rounded = (jaccard * 10000.0).round() / 10000.0;
        if jaccard_rounded < min_jaccard {
            continue;
        }

        pairs.push(TemporalCouplingPair {
            file_a,
            file_b,
            shared_commits,
            commits_a,
            commits_b,
            jaccard_similarity: jaccard_rounded,
        });
    }

    pairs.sort_by(|a, b| {
        b.jaccard_similarity
            .partial_cmp(&a.jaccard_similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.shared_commits.cmp(&a.shared_commits))
            .then_with(|| a.file_a.cmp(&b.file_a))
            .then_with(|| a.file_b.cmp(&b.file_b))
    });

    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_duplicate_lines() {
        let code = "const a = 1;\nconst b = 2;\nconst a = 1;\n\nconst a = 1;\n";
        assert_eq!(count_duplicate_lines(code), 2);
    }

    #[test]
    fn test_detect_clone_blocks() {
        let mut lines = Vec::new();
        for i in 0..6 {
            lines.push(format!("    do_action_{}();", i));
        }
        lines.push("    intermediate_call();".to_string());
        for i in 0..6 {
            lines.push(format!("    do_action_{}();", i));
        }
        let code = lines.join("\n");
        let clones = detect_clone_blocks(&code, 6);
        assert_eq!(clones.len(), 1);
        assert_eq!(clones[0].original_line, 1);
        assert_eq!(clones[0].start_line, 8);
        assert_eq!(clones[0].line_span, 6);
    }

    #[test]
    fn test_minhash_and_lsh_pairs() {
        let code_a = "fn foo() {\n    let x = 1;\n    let y = 2;\n    let z = x + y;\n}\n";
        let code_b = "fn foo() {\n    let x = 1;\n    let y = 2;\n    let z = x + y;\n}\n";
        let code_c = "fn bar() {\n    let name = \"hello\";\n    println!(\"{}\", name);\n}\n";

        let sig_a = compute_minhash(code_a, 64);
        let sig_b = compute_minhash(code_b, 64);
        let sig_c = compute_minhash(code_c, 64);

        assert_eq!(sig_a, sig_b);

        let pairs = find_clone_pairs(&[sig_a, sig_b, sig_c], 0.8);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].file_a, 0);
        assert_eq!(pairs[0].file_b, 1);
        assert!((pairs[0].similarity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_empty_and_trivial_clone() {
        assert_eq!(count_duplicate_lines(""), 0);
        assert_eq!(count_duplicate_lines("   \n\n\t\n"), 0);
        assert!(detect_clone_blocks("", 3).is_empty());
        assert!(detect_clone_blocks("const a = 1;", 3).is_empty());

        let sig = compute_minhash("", 64);
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn test_lsh_threshold_filtering() {
        let mut lines_base = Vec::new();
        for i in 0..20 {
            lines_base.push(format!("    let var_{} = compute_val({});", i, i));
        }
        let mut lines_similar = lines_base.clone();
        lines_similar[10] = "    let var_10 = compute_val_modified(10);".to_string();

        let code_base = lines_base.join("\n");
        let code_similar = lines_similar.join("\n");
        let code_diff = "class UnrelatedClass {\n    private id = 1;\n}\n";

        let sig_1 = compute_minhash(&code_base, 64);
        let sig_2 = compute_minhash(&code_similar, 64);
        let sig_3 = compute_minhash(code_diff, 64);

        let high_thresh = find_clone_pairs(&[sig_1.clone(), sig_2.clone(), sig_3.clone()], 0.99);
        assert!(high_thresh.is_empty());

        let med_thresh = find_clone_pairs(&[sig_1, sig_2, sig_3], 0.6);
        assert_eq!(med_thresh.len(), 1);
    }

    #[test]
    fn test_minhash_permutation_counts() {
        let code = "const tokenA = 100;\nconst tokenB = 200;\n";
        assert_eq!(compute_minhash(code, 16).len(), 16);
        assert_eq!(compute_minhash(code, 32).len(), 32);
        assert_eq!(compute_minhash(code, 64).len(), 64);
    }

    #[test]
    fn test_clone_blocks_min_span_boundary() {
        let code = "a();\nb();\nc();\nx();\na();\nb();\nc();\n";
        let clones_3 = detect_clone_blocks(code, 3);
        assert_eq!(clones_3.len(), 1);

        let clones_4 = detect_clone_blocks(code, 4);
        assert!(clones_4.is_empty());
    }

    #[test]
    fn test_lsh_empty_and_single_signature() {
        assert!(find_clone_pairs(&[], 0.8).is_empty());
        let single_sig = vec![1, 2, 3, 4];
        assert!(find_clone_pairs(&[single_sig], 0.8).is_empty());
    }

    #[test]
    fn test_detect_clone_blocks_overlapping_prevention() {
        let code = "x();\nx();\nx();\nx();\nx();\nx();\n";
        let clones = detect_clone_blocks(code, 3);
        assert!(!clones.is_empty());
        for clone in &clones {
            assert!(clone.start_line >= clone.original_line + clone.line_span);
        }
    }

    #[test]
    fn test_simhash_64_and_hamming_similarity() {
        let tokens_a: Vec<String> = vec![
            "function", "add", "(", "a", ",", "b", ")", "{", "return", "a", "+", "b", ";", "}",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let tokens_b: Vec<String> = vec![
            "function", "sum", "(", "a", ",", "b", ")", "{", "return", "a", "+", "b", ";", "}",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let h_a_hex = compute_simhash_64_hex(&tokens_a);
        let h_b_hex = compute_simhash_64_hex(&tokens_b);
        assert_eq!(h_a_hex, "af63f44c86018c8c");
        assert_eq!(h_b_hex, "af63b44c86018c88");

        let h_a = compute_simhash_64(&tokens_a);
        let h_b = compute_simhash_64(&tokens_b);
        let sim = calculate_simhash_hamming_similarity(h_a, h_b);
        assert_eq!(sim, 0.96875);

        let trigram_cos_sim = calculate_trigram_cosine_similarity(&tokens_a, &tokens_b);
        assert_eq!(trigram_cos_sim, 0.833333);
    }

    #[test]
    fn test_temporal_coupling() {
        let changesets = vec![
            vec![1, 2, 3],
            vec![1, 2],
            vec![1, 2, 4],
            vec![3, 4],
            vec![5],
        ];

        // 1 & 2 appear together in 3 commits: [1,2,3], [1,2], [1,2,4]
        // 1 appears in 3 commits.
        // 2 appears in 3 commits.
        // union(1, 2) = 3 + 3 - 3 = 3.
        // Jaccard(1, 2) = 3 / 3 = 1.0.
        // 1 & 3 appear in 1 commit ([1,2,3]).
        // 3 appears in 2 commits ([1,2,3], [3,4]).
        // union(1, 3) = 3 + 2 - 1 = 4. Jaccard = 1/4 = 0.25.

        let pairs = compute_temporal_coupling(&changesets, 2, 0.5);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].file_a, 1);
        assert_eq!(pairs[0].file_b, 2);
        assert_eq!(pairs[0].shared_commits, 3);
        assert_eq!(pairs[0].commits_a, 3);
        assert_eq!(pairs[0].commits_b, 3);
        assert!((pairs[0].jaccard_similarity - 1.0).abs() < 1e-4);

        // With min_shared = 1, min_jaccard = 0.2
        let all_pairs = compute_temporal_coupling(&changesets, 1, 0.2);
        assert!(all_pairs.len() >= 3);
        assert_eq!(all_pairs[0].file_a, 1);
        assert_eq!(all_pairs[0].file_b, 2);
    }
}
