//! Module: fg-algorithms::diff::stat_layout — Unified Diff Stat Layout & Path Formatter
//! File Path: crates/fg-algorithms/src/diff/stat_layout.rs
//! Architecture Role: Pure formatting algorithms for Git `--stat` histograms, scaled bar charts,
//!   path name component truncation, and rename abbreviation (`pprint_rename`).
//! Dependencies & Triggers: Consumed by Taxis CLI diff, show, and log porcelain formatters.
//! Responsibilities: Measures column widths across file changes, computes proportional ASCII
//!   graphs with single-character reserve invariant, abbreviates rename paths at component boundaries,
//!   and truncates wide paths with leading ellipses.
//! Exit Semantics & Design Rationale:
//!   - Byte-level parity with Git's `show_stats` and `pprint_rename` in `diff.c`.
//!   - Pure computation decoupled from file systems or CLI data structures.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-OBJ-001`: Git plumbing byte parity and formatting reproducibility guard
//! - `FGT-PRF-001`: Pure algorithmic computation with minimal allocation

/// The column widths one `--stat` block uses, derived from every row at once.
///
/// Git sizes the three columns from the whole file set, not per row (`show_stats` in `diff.c`): the
/// name column is the longest name, the number column is the width of the largest change count, and
/// the bar is scaled against that same maximum so bars are comparable across rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StatLayout {
    /// Width of the change-count field.
    pub number_width: usize,
    /// Width of the bar field; a change count is scaled into it.
    pub graph_width: usize,
    /// Width of the path field, before truncation.
    pub name_width: usize,
    /// Largest change count in the block, which the bar is scaled against.
    pub max_change: usize,
}

impl StatLayout {
    /// Measures the widths Git's `show_stats` would choose given the maximum change count,
    /// longest name length, and target terminal columns.
    pub fn measure_entries(max_change: usize, max_name: usize, columns: usize) -> Self {
        let width = columns.max(16 + 6 + decimal_width(max_change));
        let number_width = decimal_width(max_change);
        let mut graph_width = max_change;
        let mut name_width = max_name;
        if name_width + number_width + 6 + graph_width > width {
            let ceiling = width * 3 / 8;
            if graph_width + number_width + 6 > ceiling {
                graph_width = ceiling.saturating_sub(number_width + 6).max(6);
            }
            let remaining = width - number_width - 6;
            if name_width > remaining.saturating_sub(graph_width) {
                name_width = remaining.saturating_sub(graph_width);
            } else {
                graph_width = remaining - name_width;
            }
        }
        Self {
            number_width,
            graph_width,
            name_width,
            max_change,
        }
    }
}

/// Number of decimal digits a count needs, with zero counted as one digit.
pub fn decimal_width(value: usize) -> usize {
    match value {
        0 => 1,
        other => (other.ilog10() as usize) + 1,
    }
}

/// Scales a change count into the bar field, matching `scale_linear` in `diff.c`.
///
/// The formula is `1 + count * (width - 1) / max`, not a rounded proportion: it reserves one column
/// so any change at all prints at least one character.
pub fn scale_linear(count: usize, width: usize, max_change: usize) -> usize {
    if count == 0 || max_change == 0 {
        return 0;
    }
    1 + count * (width.saturating_sub(1)) / max_change
}

/// Builds the `+`/`-` bar for one row.
///
/// When both sides changed, the total is scaled first and then split, so a row with one addition and
/// one deletion still shows both characters — Git's `if (total < 2 && add && del) total = 2` guard.
pub fn stat_graph(added: usize, removed: usize, layout: StatLayout) -> String {
    if layout.graph_width > layout.max_change {
        return format!("{}{}", "+".repeat(added), "-".repeat(removed));
    }
    let total = added + removed;
    let mut scaled = scale_linear(total, layout.graph_width, layout.max_change);
    if scaled < 2 && added > 0 && removed > 0 {
        scaled = 2;
    }
    let (plus, minus) = match added < removed {
        true => {
            let plus = scale_linear(added, layout.graph_width, layout.max_change);
            (plus, scaled.saturating_sub(plus))
        }
        false => {
            let minus = scale_linear(removed, layout.graph_width, layout.max_change);
            (scaled.saturating_sub(minus), minus)
        }
    };
    format!("{}{}", "+".repeat(plus), "-".repeat(minus))
}

/// Shortens a name that does not fit, keeping its tail behind a `...` marker.
///
/// Git drops leading characters until the remainder fits and then retreats to the next `/`, so the
/// shortened name always starts at a path component boundary.
pub fn truncate_stat_name(name: &str, name_width: usize) -> String {
    let length = name.chars().count();
    if length <= name_width {
        return name.to_string();
    }
    let keep = name_width.saturating_sub(3);
    let trimmed: String = name.chars().skip(length - keep).collect();
    match trimmed.find('/') {
        Some(slash) => format!("...{}", &trimmed[slash..]),
        None => format!("...{trimmed}"),
    }
}

/// Abbreviates a rename to `pfx{old => new}sfx`, matching Git's `pprint_rename`.
///
/// The prefix only counts up to a separator, and the suffix likewise, so the braces always enclose
/// whole path components.
pub fn pprint_rename(old: &str, new: &str) -> String {
    let old_bytes = old.as_bytes();
    let new_bytes = new.as_bytes();
    let mut prefix = 0usize;
    let mut cursor = 0usize;
    while cursor < old_bytes.len()
        && cursor < new_bytes.len()
        && old_bytes[cursor] == new_bytes[cursor]
    {
        if old_bytes[cursor] == b'/' {
            prefix = cursor + 1;
        }
        cursor += 1;
    }
    let suffix = shared_suffix_len(old_bytes, new_bytes, prefix);
    let old_middle = old_bytes.len().saturating_sub(prefix + suffix);
    let new_middle = new_bytes.len().saturating_sub(prefix + suffix);
    let mut rendered = String::with_capacity(old.len() + new.len() + 7);
    if prefix + suffix > 0 {
        rendered.push_str(&old[..prefix]);
        rendered.push('{');
    }
    rendered.push_str(&old[prefix..prefix + old_middle]);
    rendered.push_str(" => ");
    rendered.push_str(&new[prefix..prefix + new_middle]);
    if prefix + suffix > 0 {
        rendered.push('}');
        rendered.push_str(&old[old.len() - suffix..]);
    }
    rendered
}

/// Returns the length of the shared path-component suffix, in bytes.
pub fn shared_suffix_len(old: &[u8], new: &[u8], prefix: usize) -> usize {
    let adjust = usize::from(prefix > 0);
    let floor = prefix.saturating_sub(adjust);
    let mut suffix = 0usize;
    let mut back = 0usize;
    while floor + back < old.len() && floor + back < new.len() {
        let byte = old[old.len() - 1 - back];
        if byte != new[new.len() - 1 - back] {
            break;
        }
        if byte == b'/' {
            suffix = back + 1;
        }
        back += 1;
    }
    suffix
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decimal_width() {
        assert_eq!(decimal_width(0), 1);
        assert_eq!(decimal_width(9), 1);
        assert_eq!(decimal_width(10), 2);
        assert_eq!(decimal_width(999), 3);
        assert_eq!(decimal_width(1000), 4);
    }

    #[test]
    fn test_pprint_rename() {
        assert_eq!(
            pprint_rename("src/old_name.rs", "src/new_name.rs"),
            "src/{old_name.rs => new_name.rs}"
        );
        assert_eq!(
            pprint_rename("lib/core/util.rs", "lib/common/util.rs"),
            "lib/{core => common}/util.rs"
        );
        assert_eq!(pprint_rename("old.txt", "new.txt"), "old.txt => new.txt");
    }

    #[test]
    fn test_truncate_stat_name() {
        let name = "crates/fg-algorithms/src/diff/patch.rs";
        let truncated = truncate_stat_name(name, 20);
        assert!(truncated.starts_with(".../"));
        assert!(truncated.len() <= 20);
    }

    #[test]
    fn test_stat_graph_small_changes() {
        let layout = StatLayout {
            number_width: 2,
            graph_width: 10,
            name_width: 20,
            max_change: 20,
        };
        let bar = stat_graph(1, 1, layout);
        assert_eq!(bar, "+-");
    }
}
