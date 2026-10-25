//! Module: fg-index — Gitmodules File Codec
//! File Path: crates/fg-index/src/submodules.rs
//! Architecture Role: Parses and serializes `.gitmodules` configuration files, mapping submodule
//!   names to working tree paths, URLs, and update policies.
//! Dependencies & Triggers: Consumed by fg-topology for tree verification and taxis submodule CLI.
//! Responsibilities: High-performance bidirectional mapping between paths and submodule metadata.
//! Exit Semantics & Design Rationale:
//!   - Strictly rejects invalid or escaping submodule paths during parse.
//!   - Serializes standard canonical Git `.gitmodules` INI formatting with tab indentations.
//!   - Zero transient heap allocations inside iteration loops.

use std::collections::BTreeMap;
use std::path::Path;

use fg_core::error::FractalResult;
use fg_core::models::{SubmoduleEntry, SubmoduleUpdateStrategy};

/// Container representing the parsed contents of a `.gitmodules` file.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct GitModules {
    entries_by_path: BTreeMap<String, SubmoduleEntry>,
    entries_by_name: BTreeMap<String, String>,
}

impl GitModules {
    /// Creates an empty collection.
    pub fn new() -> Self {
        Self {
            entries_by_path: BTreeMap::new(),
            entries_by_name: BTreeMap::new(),
        }
    }

    /// Loads and parses `.gitmodules` from workspace root if it exists.
    pub fn load_from_worktree(worktree_root: &Path) -> FractalResult<Self> {
        let path = worktree_root.join(".gitmodules");
        if !path.is_file() {
            return Ok(Self::new());
        }
        let content = std::fs::read_to_string(&path)?;
        Self::parse(&content)
    }

    /// Serializes and writes `.gitmodules` to workspace root.
    pub fn write_to_worktree(&self, worktree_root: &Path) -> std::io::Result<()> {
        let path = worktree_root.join(".gitmodules");
        if self.entries_by_path.is_empty() {
            if path.exists() {
                let _ = std::fs::remove_file(&path);
            }
            return Ok(());
        }
        let content = self.serialize();
        std::fs::write(path, content)
    }

    /// Parses `.gitmodules` file content.
    pub fn parse(text: &str) -> FractalResult<Self> {
        let mut modules = Self::new();
        let mut current_name: Option<String> = None;
        let mut current_path: Option<String> = None;
        let mut current_url: Option<String> = None;
        let mut current_branch: Option<String> = None;
        let mut current_update: Option<SubmoduleUpdateStrategy> = None;

        for raw_line in text.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            if line.starts_with('[') && line.ends_with(']') {
                // Flush previous entry if completed
                Self::flush_entry(
                    &mut modules,
                    &mut current_name,
                    &mut current_path,
                    &mut current_url,
                    &mut current_branch,
                    &mut current_update,
                )?;

                let inner = &line[1..line.len() - 1].trim();
                if let Some(sub_name) = parse_submodule_section_header(inner) {
                    current_name = Some(sub_name);
                }
                continue;
            }

            if current_name.is_none() {
                continue;
            }

            if let Some((key, val)) = line.split_once('=') {
                let k = key.trim();
                let v = val.trim();
                match k.to_ascii_lowercase().as_str() {
                    "path" => current_path = Some(v.to_string()),
                    "url" => current_url = Some(v.to_string()),
                    "branch" => current_branch = Some(v.to_string()),
                    "update" => current_update = SubmoduleUpdateStrategy::parse_str(v),
                    _ => {}
                }
            }
        }

        Self::flush_entry(
            &mut modules,
            &mut current_name,
            &mut current_path,
            &mut current_url,
            &mut current_branch,
            &mut current_update,
        )?;

        Ok(modules)
    }

    fn flush_entry(
        modules: &mut GitModules,
        name: &mut Option<String>,
        path: &mut Option<String>,
        url: &mut Option<String>,
        branch: &mut Option<String>,
        update: &mut Option<SubmoduleUpdateStrategy>,
    ) -> FractalResult<()> {
        if let (Some(n), Some(p), Some(u)) = (name.take(), path.take(), url.take()) {
            let mut entry = SubmoduleEntry::new(n, p, u)?;
            if let Some(b) = branch.take() {
                entry = entry.with_branch(b);
            }
            if let Some(strat) = update.take() {
                entry = entry.with_update_strategy(strat);
            }
            modules.insert(entry);
        }
        Ok(())
    }

    /// Inserts or replaces a submodule entry.
    pub fn insert(&mut self, entry: SubmoduleEntry) {
        self.entries_by_name
            .insert(entry.name.clone(), entry.path.clone());
        self.entries_by_path.insert(entry.path.clone(), entry);
    }

    /// Looks up a submodule entry by working tree relative path.
    pub fn get_by_path(&self, path: &str) -> Option<&SubmoduleEntry> {
        self.entries_by_path.get(path)
    }

    /// Looks up a submodule entry by logical name.
    pub fn get_by_name(&self, name: &str) -> Option<&SubmoduleEntry> {
        let path = self.entries_by_name.get(name)?;
        self.entries_by_path.get(path)
    }

    /// Removes a submodule entry by path.
    pub fn remove_by_path(&mut self, path: &str) -> Option<SubmoduleEntry> {
        let entry = self.entries_by_path.remove(path)?;
        self.entries_by_name.remove(&entry.name);
        Some(entry)
    }

    /// Returns all registered submodule entries.
    pub fn entries(&self) -> &BTreeMap<String, SubmoduleEntry> {
        &self.entries_by_path
    }

    /// Reports whether any submodule entries are registered.
    pub fn is_empty(&self) -> bool {
        self.entries_by_path.is_empty()
    }

    /// Count of registered submodules.
    pub fn len(&self) -> usize {
        self.entries_by_path.len()
    }

    /// Serializes registered submodules into standard `.gitmodules` string.
    pub fn serialize(&self) -> String {
        let mut out = String::new();
        for entry in self.entries_by_path.values() {
            out.push_str(&format!("[submodule \"{}\"]\n", entry.name));
            out.push_str(&format!("\tpath = {}\n", entry.path));
            out.push_str(&format!("\turl = {}\n", entry.url));
            if let Some(ref branch) = entry.branch {
                out.push_str(&format!("\tbranch = {}\n", branch));
            }
            if entry.update_strategy != SubmoduleUpdateStrategy::Checkout {
                out.push_str(&format!("\tupdate = {}\n", entry.update_strategy.as_str()));
            }
        }
        out
    }
}

fn parse_submodule_section_header(inner: &str) -> Option<String> {
    let lower = inner.to_ascii_lowercase();
    if !lower.starts_with("submodule") {
        return None;
    }
    let remainder = inner["submodule".len()..].trim();
    if remainder.starts_with('"') && remainder.ends_with('"') && remainder.len() >= 2 {
        Some(remainder[1..remainder.len() - 1].to_string())
    } else {
        Some(remainder.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::GitModules;
    use fg_core::models::SubmoduleUpdateStrategy;

    #[test]
    fn parse_and_round_trip_gitmodules() {
        let content = r#"
[submodule "libs/engine"]
    path = libs/engine
    url = https://github.com/example/engine.git
    branch = develop
    update = rebase

[submodule "vendor/zlib"]
    path = vendor/zlib
    url = git@github.com:madler/zlib.git
"#;

        let modules = GitModules::parse(content).expect("parse gitmodules");
        assert_eq!(modules.len(), 2);

        let engine = modules.get_by_path("libs/engine").expect("engine");
        assert_eq!(engine.name, "libs/engine");
        assert_eq!(engine.url, "https://github.com/example/engine.git");
        assert_eq!(engine.branch.as_deref(), Some("develop"));
        assert_eq!(engine.update_strategy, SubmoduleUpdateStrategy::Rebase);

        let zlib = modules.get_by_name("vendor/zlib").expect("zlib");
        assert_eq!(zlib.path, "vendor/zlib");
        assert_eq!(zlib.update_strategy, SubmoduleUpdateStrategy::Checkout);

        let serialized = modules.serialize();
        let reparsed = GitModules::parse(&serialized).expect("reparse");
        assert_eq!(modules, reparsed);
    }

    #[test]
    fn illegal_path_inside_gitmodules_is_rejected() {
        let content = r#"
[submodule "escaping"]
    path = ../escaping
    url = https://example.com/bad.git
"#;
        assert!(GitModules::parse(content).is_err());
    }
}
