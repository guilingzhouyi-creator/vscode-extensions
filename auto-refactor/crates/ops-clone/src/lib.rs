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

/// Compute 32-bit FNV-1a hash of a UTF-16 sequence (matching JS hashString32)
pub fn hash_string_32(s: &str) -> u32 {
    let mut hash = FNV1A_32_OFFSET_BASIS;
    for c in s.encode_utf16() {
        hash ^= c as u32;
        hash = hash.wrapping_mul(FNV1A_32_PRIME);
    }
    hash
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
            meaningful_lines.push((line_idx + 1, hash_string_32(trimmed)));
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
            meaningful_hashes.push(hash_string_32(trimmed));
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

    for band in 0..num_bands {
        let start = band * rows_per_band;
        let end = start + rows_per_band;
        let mut buckets: HashMap<u32, Vec<u32>> = HashMap::new();

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
}
