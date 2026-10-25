//! Module: fg-topology — Persistent Controlled Project Lease Storage & Auto-Discovery
//! File Path: crates/fg-topology/src/project_store.rs
//! Architecture Role: Manages persistent atomic disk storage for active project leases, hierarchical
//!   TTL verification, and opportunistic marker-based project auto-discovery.
//! Dependencies & Triggers: Consumed by Taxis CLI project commands, gate validation, and commit handlers.
//! Responsibilities: Load/save project lease cache, atomic rename writes, sweep/evict, and project sniffing.
//! Exit Semantics & Design Rationale:
//!   - Atomic write via staging file prevents corrupt partial JSON reads during concurrent operations.
//!   - Zero destruction: eviction only removes in-memory and index state, never touching source files.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard
//! - `FGT-STO-001`: Storage layer crash safety guard

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{
    LeaseStatus, ProjectLease, ProjectLeaseCache, RegistrationOrigin,
    DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD, DEFAULT_PROJECT_MASTER_TTL_SECONDS,
};

/// Subdirectory name under repository directory holding active project leases.
pub const PROJECTS_DIR: &str = "projects";

/// Primary state file name recording active project leases.
pub const PROJECTS_CACHE_FILE: &str = "active_projects.json";

/// Known project marker files inspected during opportunistic auto-discovery.
const PROJECT_MARKERS: &[&str] = &[
    "Cargo.toml",
    "package.json",
    "project.godot",
    "pyproject.toml",
    "CMakeLists.txt",
];

/// Filesystem storage driver for controlled project leases and auto-discovery.
#[derive(Debug, Clone)]
pub struct DiskProjectStore {
    base_dir: PathBuf,
    cache_file_path: PathBuf,
}

impl DiskProjectStore {
    /// Creates a store instance rooted at the provided repository git directory.
    pub fn new(git_dir: impl AsRef<Path>) -> Self {
        let base_dir = git_dir.as_ref().join(PROJECTS_DIR);
        let cache_file_path = base_dir.join(PROJECTS_CACHE_FILE);
        Self {
            base_dir,
            cache_file_path,
        }
    }

    /// Loads active project leases, optionally sniffing workspace root to discover unmapped projects.
    pub fn load_or_discover(
        &self,
        workspace_root: Option<&Path>,
        now_secs: u64,
    ) -> FractalResult<ProjectLeaseCache> {
        let mut cache = if self.cache_file_path.is_file() {
            let file_bytes = fs::read(&self.cache_file_path).map_err(FractalError::Io)?;
            serde_json::from_slice::<ProjectLeaseCache>(&file_bytes).map_err(FractalError::Json)?
        } else {
            ProjectLeaseCache::new()
        };

        // Update status for any expired leases
        for lease in cache.leases.values_mut() {
            if lease.is_expired(now_secs) && lease.status == LeaseStatus::Active {
                lease.freeze();
            }
        }

        // Opportunistic sniffing if workspace root is supplied
        if let Some(ws_root) = workspace_root {
            let discovered = self.sniff_workspace_projects(ws_root, now_secs);
            let mut newly_added = false;
            for candidate in discovered {
                if !cache.leases.contains_key(&candidate.id) {
                    cache.register(candidate);
                    newly_added = true;
                }
            }

            if newly_added {
                self.save(&cache)?;
            }
        }

        Ok(cache)
    }

    /// Atomically persists the project lease cache to disk using a unique staging file.
    pub fn save(&self, cache: &ProjectLeaseCache) -> FractalResult<()> {
        if !self.base_dir.exists() {
            fs::create_dir_all(&self.base_dir).map_err(FractalError::Io)?;
        }

        let serialized_bytes = serde_json::to_vec_pretty(cache).map_err(FractalError::Json)?;
        let temporary_path = self.base_dir.join(format!(
            "{}.tmp.{}",
            PROJECTS_CACHE_FILE,
            std::process::id()
        ));

        fs::write(&temporary_path, &serialized_bytes).map_err(FractalError::Io)?;
        fs::rename(&temporary_path, &self.cache_file_path).map_err(FractalError::Io)?;

        Ok(())
    }

    /// Touches a specific project by id to record recent activity and reset dormant counter.
    pub fn touch_project(&self, project_id: &str, now_secs: u64) -> FractalResult<()> {
        let mut cache = self.load_or_discover(None, now_secs)?;
        cache.touch(project_id, now_secs)?;
        self.save(&cache)
    }

    /// Renews and unfreezes a project lease, setting a new master TTL if provided.
    pub fn renew_project(
        &self,
        project_id: &str,
        now_secs: u64,
        ttl_seconds: Option<u64>,
    ) -> FractalResult<()> {
        let mut cache = self.load_or_discover(None, now_secs)?;
        cache.renew(project_id, now_secs, ttl_seconds)?;
        self.save(&cache)
    }

    /// Explicitly unregisters and evicts a project lease from the active cache.
    pub fn unregister_project(&self, project_id: &str, now_secs: u64) -> FractalResult<bool> {
        let mut cache = self.load_or_discover(None, now_secs)?;
        let removed_entry = cache.leases.remove(project_id);
        if removed_entry.is_some() {
            self.save(&cache)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Sweeps active projects and evicts long-dormant frozen leases, returning evicted IDs.
    pub fn sweep_evictions(
        &self,
        now_secs: u64,
        dormant_threshold: Option<u32>,
    ) -> FractalResult<Vec<String>> {
        let mut cache = self.load_or_discover(None, now_secs)?;
        let threshold = dormant_threshold.unwrap_or(DEFAULT_EVICTION_DORMANT_CYCLE_THRESHOLD);
        let evicted = cache.sweep_and_evict(now_secs, threshold);
        if !evicted.is_empty() {
            self.save(&cache)?;
        }
        Ok(evicted)
    }

    /// Scans the workspace directory tree for directories containing project marker files.
    pub fn sniff_workspace_projects(
        &self,
        workspace_root: &Path,
        now_secs: u64,
    ) -> Vec<ProjectLease> {
        let mut discovered = Vec::new();
        let read_dir_entries = match fs::read_dir(workspace_root) {
            Ok(entries) => entries,
            Err(_) => return discovered,
        };

        for dir_entry in read_dir_entries.flatten() {
            let entry_path = dir_entry.path();
            if !entry_path.is_dir() {
                continue;
            }

            let dir_name = match entry_path.file_name().and_then(|name| name.to_str()) {
                Some(name) => name,
                None => continue,
            };

            // Skip hidden, metadata, build, and transient directories
            if dir_name.starts_with('.')
                || dir_name == "node_modules"
                || dir_name == "target"
                || dir_name == "dist"
                || dir_name == "out"
                || dir_name == "tmp"
            {
                continue;
            }

            // Inspect for project marker files
            let has_marker = PROJECT_MARKERS
                .iter()
                .any(|marker| entry_path.join(marker).is_file());

            if has_marker {
                let project_lease = ProjectLease::new(
                    dir_name,
                    dir_name,
                    DEFAULT_PROJECT_MASTER_TTL_SECONDS,
                    RegistrationOrigin::AutoDiscovered,
                    now_secs,
                );
                discovered.push(project_lease);
            }
        }

        // Always register workspace root governance if scripts/ or docs/ exists
        let has_governance = workspace_root.join("scripts").is_dir()
            || workspace_root.join("docs").is_dir()
            || workspace_root.join(".agents").is_dir();

        if has_governance {
            let mut gov_lease = ProjectLease::new(
                "governance",
                ".",
                DEFAULT_PROJECT_MASTER_TTL_SECONDS,
                RegistrationOrigin::AutoDiscovered,
                now_secs,
            );
            gov_lease.path_jails = vec![
                "scripts/**".to_string(),
                ".agents/**".to_string(),
                "docs/**".to_string(),
                ".githooks/**".to_string(),
                "package.json".to_string(),
                "Cargo.toml".to_string(),
            ];
            discovered.push(gov_lease);
        }

        discovered
    }

    /// Resolves which controlled projects own a set of modified file paths.
    pub fn resolve_affected_projects(
        &self,
        cache: &ProjectLeaseCache,
        modified_files: &[&str],
    ) -> Vec<String> {
        let mut affected = Vec::new();
        for file_path in modified_files {
            if let Some(owning_project) = cache.find_by_path(file_path) {
                if !affected.contains(&owning_project.id) {
                    affected.push(owning_project.id.clone());
                }
            }
        }
        affected
    }
}
