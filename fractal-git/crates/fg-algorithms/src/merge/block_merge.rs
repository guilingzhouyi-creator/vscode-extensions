//! Module: fg-algorithms — Semantic Block & Import Set Union Three-Way Merge
//! File Path: crates/fg-algorithms/src/merge/block_merge.rs
//! Architecture Role: AST-adjacent semantic block-level three-way merge operator, reconciling
//!   independent, non-overlapping code block modifications and automatically deduplicating
//!   concurrent header import/use statements across parallel SubAgent branches.
//! Dependencies & Triggers: Dispatched by Taxis merge, rebase, and cherry-pick when line-level
//!   text merge encounters false or adjacent conflicts on the same file.
//! Responsibilities: Detect and unite header import declarations, isolate top-level declaration
//!   blocks (functions, structs, traits), reconcile disjoint block mutations, and localize conflict
//!   markers strictly to truly conflicting blocks.
//! Exit Semantics & Design Rationale:
//!   - Returns `BlockMergeResult` containing `is_clean: bool`, conflict counts, and merged bytes.
//!   - Concurrent independent additions to the import block merge via set-union deduplication.
//!   - Non-overlapping edits to distinct top-level functions or types merge with 100% commutativity.
//!   - When blocks conflict internally, conflict delimiters are localized to that single block
//!     instead of failing the entire file.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-ALG-001`: Algorithmic three-way tree and block equivalence guard
//! - `FGT-PRF-001`: Pure algorithmic computation with minimal allocation

use std::collections::{BTreeMap, BTreeSet};

use super::text_merge::{TextMergeResult, TextThreeWayMerge};

/// Result of a semantic block-level 3-way merge operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockMergeResult {
    /// True if all differences were resolved cleanly without conflicts.
    pub is_clean: bool,
    /// Number of conflict chunks encountered.
    pub conflict_count: usize,
    /// Number of distinct semantic blocks reconciled.
    pub resolved_blocks_count: usize,
    /// Number of concurrent import statements deduplicated.
    pub deduplicated_imports_count: usize,
    /// Merged payload bytes.
    pub content: Vec<u8>,
}

/// Semantic block-level three-way merge operator.
pub struct BlockThreeWayMerge;

impl BlockThreeWayMerge {
    /// Performs three-way merge with semantic import set-union and top-level block decomposition.
    pub fn merge(
        base: &[u8],
        ours: &[u8],
        theirs: &[u8],
        ours_label: &str,
        theirs_label: &str,
    ) -> BlockMergeResult {
        // Fast paths: identical buffers
        if ours == theirs {
            return BlockMergeResult {
                is_clean: true,
                conflict_count: 0,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: ours.to_vec(),
            };
        }
        if ours == base {
            return BlockMergeResult {
                is_clean: true,
                conflict_count: 0,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: theirs.to_vec(),
            };
        }
        if theirs == base {
            return BlockMergeResult {
                is_clean: true,
                conflict_count: 0,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: ours.to_vec(),
            };
        }

        // Try standard line-level merge first
        let line_merge = TextThreeWayMerge::merge(base, ours, theirs, ours_label, theirs_label);
        if line_merge.is_clean {
            return BlockMergeResult {
                is_clean: true,
                conflict_count: 0,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: line_merge.content,
            };
        }

        // Check UTF-8 validity before semantic decomposition
        let (base_str, ours_str, theirs_str) = match (
            std::str::from_utf8(base),
            std::str::from_utf8(ours),
            std::str::from_utf8(theirs),
        ) {
            (Ok(b), Ok(o), Ok(t)) => (b, o, t),
            _ => {
                return BlockMergeResult {
                    is_clean: false,
                    conflict_count: line_merge.conflict_count,
                    resolved_blocks_count: 0,
                    deduplicated_imports_count: 0,
                    content: line_merge.content,
                };
            }
        };

        Self::merge_utf8(
            base_str,
            ours_str,
            theirs_str,
            ours_label,
            theirs_label,
            line_merge,
        )
    }

    /// Reconciles UTF-8 source files using import set union and top-level block decomposition.
    fn merge_utf8(
        base: &str,
        ours: &str,
        theirs: &str,
        ours_label: &str,
        theirs_label: &str,
        fallback: TextMergeResult,
    ) -> BlockMergeResult {
        let (base_header, base_imports, base_body) = Self::split_imports_and_body(base);
        let (_ours_header, ours_imports, ours_body) = Self::split_imports_and_body(ours);
        let (_theirs_header, theirs_imports, theirs_body) = Self::split_imports_and_body(theirs);

        // If neither branch touched imports, fallback to line merge directly
        if ours_imports.is_empty() && theirs_imports.is_empty() && base_imports.is_empty() {
            return Self::merge_body_blocks(base, ours, theirs, ours_label, theirs_label, fallback);
        }

        // 1. Reconcile header imports via 3-way Set Union
        let (merged_imports, dedupe_count) =
            Self::reconcile_imports(&base_imports, &ours_imports, &theirs_imports);

        // 2. Reconcile remaining body
        let body_merge = Self::merge_body_blocks(
            &base_body,
            &ours_body,
            &theirs_body,
            ours_label,
            theirs_label,
            fallback.clone(),
        );

        // If body merge still has conflicts and didn't improve, fallback
        if !body_merge.is_clean && body_merge.conflict_count >= fallback.conflict_count {
            return BlockMergeResult {
                is_clean: false,
                conflict_count: fallback.conflict_count,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: fallback.content,
            };
        }

        // 3. Assemble unified document
        let mut result_buf = Vec::new();
        if !base_header.is_empty() {
            result_buf.extend_from_slice(base_header.as_bytes());
            if !base_header.ends_with('\n') {
                result_buf.push(b'\n');
            }
        }

        for import_line in &merged_imports {
            result_buf.extend_from_slice(import_line.as_bytes());
            result_buf.push(b'\n');
        }

        if !merged_imports.is_empty() && !body_merge.content.is_empty() {
            result_buf.push(b'\n');
        }

        result_buf.extend_from_slice(&body_merge.content);

        BlockMergeResult {
            is_clean: body_merge.is_clean,
            conflict_count: body_merge.conflict_count,
            resolved_blocks_count: body_merge.resolved_blocks_count + 1,
            deduplicated_imports_count: dedupe_count,
            content: result_buf,
        }
    }

    /// Splits a source file into (module_doc/header, import_lines, remaining_body).
    fn split_imports_and_body(text: &str) -> (String, Vec<String>, String) {
        let mut header_lines = Vec::new();
        let mut import_lines = Vec::new();
        let mut body_lines = Vec::new();
        let mut in_imports = false;
        let mut imports_finished = false;

        for line in text.lines() {
            let trimmed = line.trim();

            if !imports_finished && Self::is_import_line(trimmed) {
                in_imports = true;
                import_lines.push(line.to_string());
                continue;
            }

            if in_imports {
                if trimmed.is_empty() {
                    // Blank lines within import section allowed
                    continue;
                }
                // First non-import, non-blank line marks the start of the body
                imports_finished = true;
                body_lines.push(line);
            } else if !imports_finished
                && (trimmed.starts_with("//!") || trimmed.starts_with("/*") || trimmed.is_empty())
            {
                header_lines.push(line);
            } else {
                imports_finished = true;
                body_lines.push(line);
            }
        }

        let header = header_lines.join("\n");
        let body = body_lines.join("\n");
        (header, import_lines, body)
    }

    /// Detects whether a line represents an import/use statement in Rust, TS, Python, Go.
    fn is_import_line(line: &str) -> bool {
        line.starts_with("use ")
            || line.starts_with("pub use ")
            || line.starts_with("import ")
            || line.starts_with("export * from ")
            || (line.starts_with("from ") && line.contains(" import "))
            || line.starts_with("extern crate ")
    }

    /// Reconciles three sets of import declarations:
    /// Merged = Base ∩ (Ours ∪ Theirs) ∪ (Ours \ Base) ∪ (Theirs \ Base)
    fn reconcile_imports(
        base: &[String],
        ours: &[String],
        theirs: &[String],
    ) -> (Vec<String>, usize) {
        let base_set: BTreeSet<String> = base.iter().cloned().collect();
        let ours_set: BTreeSet<String> = ours.iter().cloned().collect();
        let theirs_set: BTreeSet<String> = theirs.iter().cloned().collect();

        let mut merged = BTreeSet::new();

        // 1. Keep base imports that were NOT removed by either branch
        for imp in &base_set {
            if ours_set.contains(imp) && theirs_set.contains(imp) {
                merged.insert(imp.clone());
            }
        }

        // 2. Add imports newly introduced by ours
        for imp in &ours_set {
            if !base_set.contains(imp) {
                merged.insert(imp.clone());
            }
        }

        // 3. Add imports newly introduced by theirs
        for imp in &theirs_set {
            if !base_set.contains(imp) {
                merged.insert(imp.clone());
            }
        }

        let original_total = ours.len() + theirs.len();
        let dedupe_count = original_total.saturating_sub(merged.len());
        (merged.into_iter().collect(), dedupe_count)
    }

    /// Decomposes the body into top-level semantic declaration blocks and merges disjoint blocks.
    fn merge_body_blocks(
        base: &str,
        ours: &str,
        theirs: &str,
        ours_label: &str,
        theirs_label: &str,
        fallback: TextMergeResult,
    ) -> BlockMergeResult {
        let base_blocks = Self::extract_top_level_blocks(base);
        let ours_blocks = Self::extract_top_level_blocks(ours);
        let theirs_blocks = Self::extract_top_level_blocks(theirs);

        // If decomposition yielded zero or only 1 block, fall back to line merge
        if base_blocks.len() <= 1 && ours_blocks.len() <= 1 && theirs_blocks.len() <= 1 {
            let text_merge_result = TextThreeWayMerge::merge(
                base.as_bytes(),
                ours.as_bytes(),
                theirs.as_bytes(),
                ours_label,
                theirs_label,
            );
            return BlockMergeResult {
                is_clean: text_merge_result.is_clean,
                conflict_count: text_merge_result.conflict_count,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: text_merge_result.content,
            };
        }

        let mut all_block_keys: BTreeSet<String> = BTreeSet::new();
        for k in base_blocks
            .keys()
            .chain(ours_blocks.keys())
            .chain(theirs_blocks.keys())
        {
            all_block_keys.insert(k.clone());
        }

        let mut merged_blocks = Vec::new();
        let mut conflict_count = 0;
        let mut resolved_count = 0;

        for key in &all_block_keys {
            let b_val = base_blocks.get(key).map(|s| s.as_str());
            let o_val = ours_blocks.get(key).map(|s| s.as_str());
            let t_val = theirs_blocks.get(key).map(|s| s.as_str());

            match (b_val, o_val, t_val) {
                // Both unchanged or identical
                (_, Some(o), Some(t)) if o == t => {
                    merged_blocks.push(o.to_string());
                    resolved_count += 1;
                }
                // Unchanged in ours, modified in theirs
                (Some(b), Some(o), Some(t)) if o == b => {
                    merged_blocks.push(t.to_string());
                    resolved_count += 1;
                }
                // Unchanged in theirs, modified in ours
                (Some(b), Some(o), Some(t)) if t == b => {
                    merged_blocks.push(o.to_string());
                    resolved_count += 1;
                }
                // Added only in ours
                (None, Some(o), None) => {
                    merged_blocks.push(o.to_string());
                    resolved_count += 1;
                }
                // Added only in theirs
                (None, None, Some(t)) => {
                    merged_blocks.push(t.to_string());
                    resolved_count += 1;
                }
                // Deleted in ours, unchanged in theirs
                (Some(b), None, Some(t)) if t == b => {
                    // Clean deletion by ours
                    resolved_count += 1;
                }
                // Deleted in theirs, unchanged in ours
                (Some(b), Some(o), None) if o == b => {
                    // Clean deletion by theirs
                    resolved_count += 1;
                }
                // Both modified the same block differently: run localized text merge on this block!
                (b_opt, Some(o), Some(t)) => {
                    let b_bytes = b_opt.unwrap_or("").as_bytes();
                    let block_res = TextThreeWayMerge::merge(
                        b_bytes,
                        o.as_bytes(),
                        t.as_bytes(),
                        ours_label,
                        theirs_label,
                    );
                    if !block_res.is_clean {
                        conflict_count += block_res.conflict_count;
                    } else {
                        resolved_count += 1;
                    }
                    merged_blocks.push(String::from_utf8_lossy(&block_res.content).to_string());
                }
                // Other complex delete/modify conflicts
                (Some(b), o_opt, t_opt) => {
                    let o_bytes = o_opt.unwrap_or("").as_bytes();
                    let t_bytes = t_opt.unwrap_or("").as_bytes();
                    let block_res = TextThreeWayMerge::merge(
                        b.as_bytes(),
                        o_bytes,
                        t_bytes,
                        ours_label,
                        theirs_label,
                    );
                    if !block_res.is_clean {
                        conflict_count += block_res.conflict_count;
                    }
                    merged_blocks.push(String::from_utf8_lossy(&block_res.content).to_string());
                }
                (None, None, None) => {}
            }
        }

        // If block merge produced no improvement over fallback, return fallback
        if conflict_count >= fallback.conflict_count && !fallback.is_clean {
            return BlockMergeResult {
                is_clean: false,
                conflict_count: fallback.conflict_count,
                resolved_blocks_count: 0,
                deduplicated_imports_count: 0,
                content: fallback.content,
            };
        }

        let content = merged_blocks.join("\n\n").into_bytes();
        BlockMergeResult {
            is_clean: conflict_count == 0,
            conflict_count,
            resolved_blocks_count: resolved_count,
            deduplicated_imports_count: 0,
            content,
        }
    }

    /// Extracts top-level declaration blocks keyed by their canonical signature line.
    fn extract_top_level_blocks(text: &str) -> BTreeMap<String, String> {
        let mut blocks = BTreeMap::new();
        let mut current_key = String::new();
        let mut current_lines = Vec::new();

        for line in text.lines() {
            if Self::is_top_level_block_start(line) {
                if !current_key.is_empty() {
                    blocks.insert(current_key.clone(), current_lines.join("\n"));
                    current_lines.clear();
                }
                current_key = Self::canonical_block_key(line);
            }

            if current_key.is_empty() {
                // Preamble before any top-level block
                current_key = "__preamble__".to_string();
            }
            current_lines.push(line);
        }

        if !current_key.is_empty() && !current_lines.is_empty() {
            blocks.insert(current_key, current_lines.join("\n"));
        }

        blocks
    }

    /// Checks if a line starts a top-level code block at indentation 0.
    fn is_top_level_block_start(line: &str) -> bool {
        if line.starts_with(' ') || line.starts_with('\t') {
            return false;
        }
        let trimmed = line.trim_start();
        trimmed.starts_with("pub fn ")
            || trimmed.starts_with("fn ")
            || trimmed.starts_with("pub struct ")
            || trimmed.starts_with("struct ")
            || trimmed.starts_with("pub enum ")
            || trimmed.starts_with("enum ")
            || trimmed.starts_with("pub trait ")
            || trimmed.starts_with("trait ")
            || trimmed.starts_with("impl ")
            || trimmed.starts_with("pub type ")
            || trimmed.starts_with("type ")
            || trimmed.starts_with("export function ")
            || trimmed.starts_with("function ")
            || trimmed.starts_with("export class ")
            || trimmed.starts_with("class ")
            || trimmed.starts_with("export interface ")
            || trimmed.starts_with("interface ")
            || trimmed.starts_with("def ")
    }

    /// Normalizes a block signature into a stable dictionary key.
    fn canonical_block_key(line: &str) -> String {
        let clean = line.trim();
        // Truncate at opening brace or colon if present
        if let Some(pos) = clean.find('{') {
            clean[..pos].trim().to_string()
        } else if let Some(pos) = clean.find(':') {
            clean[..pos].trim().to_string()
        } else {
            clean.to_string()
        }
    }
}
