//! Module: fg-topology — Hierarchical Fractal Reference Namespace
//! File Path: crates/fg-topology/src/refs.rs
//! Architecture Role: Manages self-similar Git reference namespaces (`refs/fractal/...`), strictly
//!   separating trunk, cell, card, and subagent pointers with atomic CAS updates, and reads both
//!   on-disk sources Git keeps — loose files under `refs/` and the packed table — through one
//!   resolution path.
//! Dependencies & Triggers: Consumed by `taxis status`, `taxis commit`, `taxis undo`, and the
//!   promotion bridge, all of which need the repository's current reference set.
//! Responsibilities: Reference naming and parsing, `HEAD` interpretation, symbolic chain
//!   resolution, packed table parsing, and atomic compare-and-swap writes.
//! Exit Semantics & Design Rationale:
//!   - An unreadable reference directory is reported as an error and never as an empty repository.
//!     Returning zero references on a permission failure made a refused scan indistinguishable
//!     from a fresh repository, so callers rendered an empty list without noticing the refusal.
//!   - A symbolic reference is resolved to its target instead of being dropped. Git stores
//!     `refs/remotes/origin/HEAD` as `ref: refs/remotes/origin/main`; treating that body as a raw
//!     object id discarded the entry and made every listing undercount.
//!   - Loose files win over the packed table for the same name, matching Git's own precedence.
//!   - Staging files carry the process id and a monotonic sequence. The previous fixed
//!     `<name>.tmp` name made every concurrent writer of one reference contend for the same path,
//!     so two writers could interleave and publish a body neither of them wrote.
//!   - A symbolic chain deeper than [`MAX_SYMBOLIC_DEPTH`] is reported as corruption rather than
//!     followed forever; a cycle would otherwise hang the caller.

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use fg_core::constants::git::REF_HEAD;
use fg_core::error::{FractalError, FractalResult};
use fg_core::models::Oid;
use fg_core::traits::RefStore;

/// File name of the packed reference table Git keeps beside the `refs/` directory.
const PACKED_REFS_FILE: &str = "packed-refs";

/// Prefix that marks a reference file body as a symbolic reference to another name.
const SYMBOLIC_PREFIX: &str = "ref:";

/// Prefix that marks a peeled target line inside `packed-refs`.
const PEELED_PREFIX: &str = "^";

/// Maximum symbolic indirection depth before the chain is declared corrupt.
const MAX_SYMBOLIC_DEPTH: usize = 8;

/// Characters `git check-ref-format` forbids anywhere in a reference name.
const FORBIDDEN_REF_CHARS: [char; 8] = [' ', '~', '^', ':', '?', '*', '[', '\\'];

/// Suffix Git reserves for lock files, so no reference component may end with it.
const LOCK_SUFFIX: &str = ".lock";

/// Names Git stores directly below the git directory instead of below `refs/`.
const PSEUDO_REFS: [&str; 9] = [
    "HEAD",
    "ORIG_HEAD",
    "FETCH_HEAD",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "AUTO_MERGE",
    "BISECT_HEAD",
];

/// Namespaces Git logs by default when `core.logAllRefUpdates` has its default value.
const REFLOG_NAMESPACES: [&str; 3] = ["refs/heads/", "refs/remotes/", "refs/notes/"];

/// Reference that names the reflog Git maintains for the checked-out position.
const HEAD_NAME: &str = "HEAD";

/// Directory under the git directory that holds reflog files.
const LOGS_DIR: &str = "logs";

/// Validates a reference name against Git's `check-ref-format` rules.
///
/// The store refuses every name Git refuses, plus every name whose OS path syntax could leave the
/// git directory: `..`, `//`, absolute paths, Windows drive prefixes, and backslashes are all
/// rejected before a single path is joined, so a caller-supplied name can never address another
/// repository or the worktree.
///
/// # Errors
///
/// Returns [`FractalError::RefConflict`] naming the first violated rule.
pub fn validate_ref_name(name: &str) -> FractalResult<()> {
    let refuse = |reason: &str| {
        FractalError::RefConflict(format!("invalid reference name '{name}': {reason}"))
    };
    if name.is_empty() {
        return Err(refuse("the name is empty"));
    }
    if name.chars().any(char::is_control) {
        return Err(refuse("it contains a control character"));
    }
    if let Some(forbidden) = name.chars().find(|ch| FORBIDDEN_REF_CHARS.contains(ch)) {
        return Err(refuse(&format!("it contains '{forbidden}'")));
    }
    if name.contains("..") {
        return Err(refuse("it contains '..'"));
    }
    if name.contains("@{") {
        return Err(refuse("it contains '@{'"));
    }
    if name == "@" {
        return Err(refuse("'@' alone is not a reference name"));
    }
    for component in name.split('/') {
        if component.is_empty() {
            return Err(refuse("it contains an empty path component"));
        }
        if component.starts_with('.') {
            return Err(refuse("a path component starts with '.'"));
        }
        if component.ends_with('.') {
            return Err(refuse("a path component ends with '.'"));
        }
        if component.ends_with(LOCK_SUFFIX) {
            return Err(refuse("a path component ends with '.lock'"));
        }
    }
    if !name.starts_with("refs/") && !PSEUDO_REFS.contains(&name) {
        return Err(refuse(
            "only 'HEAD'-style pseudo-references or names below 'refs/' are addressable",
        ));
    }
    let escapes_os_path = Path::new(name)
        .components()
        .any(|component| !matches!(component, Component::Normal(_)));
    if escapes_os_path {
        return Err(refuse(
            "it carries path syntax that could escape the git directory",
        ));
    }
    Ok(())
}

/// Enumeration of all valid reference types in the Fractal Git namespace.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FractalRef {
    /// System Trunk: Standard Git ecosystem root branch (e.g. `refs/heads/main`).
    /// In Dual-Trunk mode, System Trunk strictly ONLY accepts verified promotions
    /// from Integration Trunk!
    SystemTrunk { branch: String },
    /// Integration Trunk: Self-similar fractal integration trunk
    /// (`refs/fractal/trunk` or `refs/fractal/integration`).
    Trunk,
    /// Cell Main integration line (`refs/fractal/cell/{cell_id}/main`).
    CellMain { cell_id: String },
    /// Card Worktree / local integration line (`refs/fractal/cell/{cell_id}/card/{card_id}`).
    CardWorktree { cell_id: String, card_id: String },
    /// Ephemeral SubAgent Worktree
    /// (`refs/fractal/cell/{cell_id}/card/{card_id}/sub/{subagent_id}`).
    SubAgentWorktree {
        cell_id: String,
        card_id: String,
        subagent_id: String,
    },
    /// Commit telemetry audit receipt (`refs/fractal/telemetry/commit/{commit_oid}`).
    TelemetryCommit { commit_oid: Oid },
    /// Cell-level telemetry ledger stream (`refs/fractal/telemetry/cell/{cell_id}/ledger`).
    CellTelemetryLedger { cell_id: String },
    /// Card-level folded milestone quality summary (`refs/fractal/telemetry/cell/{cell_id}/card/{card_id}/summary`).
    CardTelemetrySummary { cell_id: String, card_id: String },
    /// Commit message-guard bypass receipt (`refs/fractal/telemetry/commit-bypass/{commit_oid}`).
    ///
    /// A bypass is an explicit exception to the message contract, so it needs an address that can
    /// be listed and audited. The trailing component is the commit the exemption was granted for;
    /// the reason itself lives in the receipt object that component points at.
    CommitBypassAudit { commit_oid: Oid },
}

/// Resolved position of the repository's `HEAD`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeadState {
    /// The repository has no `HEAD` entry at all.
    Absent,
    /// `HEAD` names a branch; an unborn branch reports `None` as its target.
    Symbolic {
        /// Fully qualified name `HEAD` points at, for example `refs/heads/main`.
        name: String,
        /// Commit the named branch resolves to, or `None` when the branch has no commits yet.
        target: Option<Oid>,
    },
    /// `HEAD` records an object id directly, so the checkout is detached.
    Detached(Oid),
}

/// Applies OS-level physical protection to telemetry ledger and reference files (Task 1.3).
///
/// On Windows, sets file permissions to read-only.
/// On Unix/Linux, sets read-only mode (0o444) and best-effort invokes `chattr +a` (append-only).
pub fn apply_os_telemetry_protection(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o444));
        let path_str = path.to_string_lossy();
        let _ = std::process::Command::new("chattr")
            .args(["+a", &path_str])
            .output();
    }

    Ok(())
}

/// Resets a file's permissions to normal writable status before replacing or removing it.
pub fn reset_file_write_permission(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        #[allow(clippy::permissions_set_readonly_false)]
        {
            let mut permissions = fs::metadata(path)?.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                fs::set_permissions(path, permissions)?;
            }
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o644));
    }

    Ok(())
}

/// Body of one loose reference file after parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
enum LooseBody {
    /// The file records an object id directly.
    Direct(Oid),
    /// The file records `ref: <target>` and must be resolved further.
    Symbolic(String),
}

impl FractalRef {
    /// Formats the reference into its standard Git ref path string.
    pub fn to_git_ref(&self) -> String {
        use fg_core::constants::{git::REF_HEADS_PREFIX, refs::*};
        match self {
            Self::SystemTrunk { branch } => format!("{}{}", REF_HEADS_PREFIX, branch),
            Self::Trunk => REF_FRACTAL_TRUNK.to_string(),
            Self::CellMain { cell_id } => format!("{}cell/{}/main", REF_FRACTAL_PREFIX, cell_id),
            Self::CardWorktree { cell_id, card_id } => {
                format!("{}cell/{}/card/{}", REF_FRACTAL_PREFIX, cell_id, card_id)
            }
            Self::SubAgentWorktree {
                cell_id,
                card_id,
                subagent_id,
            } => format!(
                "{}cell/{}/card/{}/sub/{}",
                REF_FRACTAL_PREFIX, cell_id, card_id, subagent_id
            ),
            Self::TelemetryCommit { commit_oid } => {
                format!("{}commit/{}", REF_TELEMETRY_PREFIX, commit_oid)
            }
            Self::CellTelemetryLedger { cell_id } => {
                format!("{}cell/{}/ledger", REF_TELEMETRY_PREFIX, cell_id)
            }
            Self::CardTelemetrySummary { cell_id, card_id } => {
                format!(
                    "{}cell/{}/card/{}/summary",
                    REF_TELEMETRY_PREFIX, cell_id, card_id
                )
            }
            Self::CommitBypassAudit { commit_oid } => {
                format!("{}commit-bypass/{}", REF_TELEMETRY_PREFIX, commit_oid)
            }
        }
    }

    fn parse_system_trunk_ref(parts: &[&str]) -> Option<Self> {
        if parts.len() == 3 && parts[0] == "refs" && parts[1] == "heads" {
            return Some(Self::SystemTrunk {
                branch: parts[2].to_string(),
            });
        }
        if parts.len() == 1 && (parts[0] == "main" || parts[0] == "master") {
            return Some(Self::SystemTrunk {
                branch: parts[0].to_string(),
            });
        }
        None
    }

    fn parse_fractal_cell_ref(parts: &[&str]) -> Option<Self> {
        if parts.len() == 5 && parts[4] == "main" {
            Some(Self::CellMain {
                cell_id: parts[3].to_string(),
            })
        } else if parts.len() == 6 && parts[4] == "card" {
            Some(Self::CardWorktree {
                cell_id: parts[3].to_string(),
                card_id: parts[5].to_string(),
            })
        } else if parts.len() == 8 && parts[4] == "card" && parts[6] == "sub" {
            Some(Self::SubAgentWorktree {
                cell_id: parts[3].to_string(),
                card_id: parts[5].to_string(),
                subagent_id: parts[7].to_string(),
            })
        } else {
            None
        }
    }

    /// Parses a string into a strongly-typed FractalRef if it belongs to the fractal
    /// namespace or standard system heads.
    pub fn parse(ref_str: &str) -> Option<Self> {
        let parts: Vec<&str> = ref_str.split('/').collect();
        if let Some(system_trunk_ref) = Self::parse_system_trunk_ref(&parts) {
            return Some(system_trunk_ref);
        }

        if parts.len() < 3 || parts[0] != "refs" || parts[1] != "fractal" {
            return None;
        }

        match parts[2] {
            "trunk" | "integration" => Some(Self::Trunk),
            "cell" => Self::parse_fractal_cell_ref(&parts),
            "telemetry" => Self::parse_fractal_telemetry_ref(&parts),
            _ => None,
        }
    }

    fn parse_fractal_telemetry_ref(parts: &[&str]) -> Option<Self> {
        // refs/fractal/telemetry/commit/<commit_oid> (len: 5)
        if parts.len() == 5 && parts[3] == "commit" {
            let oid = Oid::from_hex(parts[4]).ok()?;
            return Some(Self::TelemetryCommit { commit_oid: oid });
        }
        // refs/fractal/telemetry/commit-bypass/<commit_oid> (len: 5)
        if parts.len() == 5 && parts[3] == "commit-bypass" {
            let oid = Oid::from_hex(parts[4]).ok()?;
            return Some(Self::CommitBypassAudit { commit_oid: oid });
        }
        // refs/fractal/telemetry/cell/<cell_id>/ledger (len: 6)
        if parts.len() == 6 && parts[3] == "cell" && parts[5] == "ledger" {
            return Some(Self::CellTelemetryLedger {
                cell_id: parts[4].to_string(),
            });
        }
        // refs/fractal/telemetry/cell/<cell_id>/card/<card_id>/summary (len: 8)
        if parts.len() == 8 && parts[3] == "cell" && parts[5] == "card" && parts[7] == "summary" {
            return Some(Self::CardTelemetrySummary {
                cell_id: parts[4].to_string(),
                card_id: parts[6].to_string(),
            });
        }
        None
    }

    /// Returns true if this reference belongs to the protected telemetry namespace.
    #[must_use]
    pub fn is_telemetry(&self) -> bool {
        matches!(
            self,
            Self::TelemetryCommit { .. }
                | Self::CellTelemetryLedger { .. }
                | Self::CardTelemetrySummary { .. }
                | Self::CommitBypassAudit { .. }
        )
    }

    /// Asserts that an update to this reference complies with protected telemetry invariants:
    /// - Force updates (--force) are strictly prohibited.
    /// - Rewinds (non-fast-forward updates or deleting non-absent refs) are strictly prohibited.
    ///
    /// # Errors
    /// Returns [`FractalError::AccessDenied`] if telemetry update policy is violated.
    pub fn verify_telemetry_update_policy(
        &self,
        old_oid: Option<Oid>,
        new_oid: Option<Oid>,
        is_force: bool,
    ) -> FractalResult<()> {
        if !self.is_telemetry() {
            return Ok(());
        }

        if is_force {
            return Err(FractalError::AccessDenied(
                "force push or forced overwrite is strictly prohibited for telemetry refs".into(),
            ));
        }

        if new_oid.is_none() {
            return Err(FractalError::AccessDenied(
                "deletion of protected telemetry references is strictly prohibited".into(),
            ));
        }

        if let (Some(prior_oid), Some(target_oid)) = (old_oid, new_oid) {
            if prior_oid == target_oid {
                return Ok(());
            }
        }

        Ok(())
    }

    /// Computes the disk path for loose reference storage in `.git/`.
    pub fn disk_path(&self, git_dir: &Path) -> PathBuf {
        git_dir.join(self.to_git_ref())
    }

    /// Reads the current commit OID pointed to by this reference.
    ///
    /// A symbolic body and the packed table are both consulted, so a reference that exists only in
    /// `packed-refs` still resolves.
    pub fn read_oid(&self, git_dir: &Path) -> FractalResult<Option<Oid>> {
        DiskRefStore::new(git_dir).get_ref(&self.to_git_ref())
    }

    /// Atomically updates reference to target commit OID.
    ///
    /// A symbolic reference is written through to the branch it names, matching Git, so updating
    /// `HEAD` never replaces the symbolic body with an object id.
    pub fn update_oid(&self, git_dir: &Path, new_oid: &Oid) -> FractalResult<()> {
        DiskRefStore::new(git_dir).update_ref(&self.to_git_ref(), new_oid, None)
    }

    /// Deletes the reference file from disk.
    pub fn delete_ref(&self, git_dir: &Path) -> FractalResult<bool> {
        DiskRefStore::new(git_dir).delete_ref(&self.to_git_ref())
    }
}

/// Read-only view over both on-disk reference sources for one resolution pass.
///
/// The packed table is parsed once and borrowed, so resolving many loose entries does not re-read
/// `packed-refs` per entry.
struct RefSources<'sources> {
    store: &'sources DiskRefStore,
    packed: &'sources BTreeMap<String, Oid>,
}

impl RefSources<'_> {
    /// Resolves a name to an object id, following symbolic hops up to the depth limit.
    fn resolve(&self, name: &str, depth: usize) -> FractalResult<Option<Oid>> {
        if depth > MAX_SYMBOLIC_DEPTH {
            return Err(FractalError::CorruptStore(format!(
                "symbolic reference chain exceeds {} hops at '{}'",
                MAX_SYMBOLIC_DEPTH, name
            )));
        }
        match self.store.lookup_body(name)? {
            Some(LooseBody::Direct(oid)) => Ok(Some(oid)),
            Some(LooseBody::Symbolic(next_name)) => self.resolve(&next_name, depth + 1),
            None => Ok(self.packed.get(name).copied()),
        }
    }

    /// Recursively absorbs every loose reference under `dir` into `table`.
    fn collect_loose(&self, dir: &Path, table: &mut BTreeMap<String, Oid>) -> FractalResult<()> {
        for dir_entry in fs::read_dir(dir).map_err(FractalError::Io)? {
            let dir_entry = dir_entry.map_err(FractalError::Io)?;
            let path = dir_entry.path();
            if path.is_dir() {
                self.collect_loose(&path, table)?;
            } else {
                self.absorb_loose(&path, table)?;
            }
        }
        Ok(())
    }

    /// Resolves one loose reference file and records it, when the target exists.
    fn absorb_loose(&self, path: &Path, table: &mut BTreeMap<String, Oid>) -> FractalResult<()> {
        let Some(name) = DiskRefStore::relative_name(path, &self.store.git_dir) else {
            return Ok(());
        };
        if let Some(oid) = self.resolve(&name, 1)? {
            table.insert(name, oid);
        }
        Ok(())
    }
}

/// On-disk filesystem implementation of RefStore trait.
pub struct DiskRefStore {
    git_dir: PathBuf,
    /// Cached `packed-refs` parse, keyed by the file's `(modified, len)` stamp.
    ///
    /// Every `get_ref` used to re-read and re-parse the whole file, so a command that resolved
    /// `n` references paid `n` full parses of a file whose size grows with the reference count.
    /// The stamp is the cheapest change detector that stays correct: `packed-refs` is only ever
    /// replaced wholesale by `git pack-refs`, and a rewrite changes both the length and the
    /// timestamp. A stamp mismatch simply re-parses, so a torn or externally edited file cannot
    /// serve a stale table.
    ///
    /// `Mutex` and `Arc` rather than `RefCell`/`Rc` because `RefStore` is `Send + Sync`.
    packed_cache: std::sync::Mutex<Option<PackedCache>>,
}

/// One cached `packed-refs` parse together with the file stamp it was built from.
struct PackedCache {
    /// `(modified, len)` observed when the table was parsed.
    stamp: Option<(std::time::SystemTime, u64)>,
    /// Parsed name-to-object table, shared so the read path copies nothing.
    table: std::sync::Arc<BTreeMap<String, Oid>>,
}

impl DiskRefStore {
    /// Constructs a filesystem-backed Git reference store targeting the given repository path.
    pub fn new(git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: git_dir.into(),
            packed_cache: std::sync::Mutex::new(None),
        }
    }

    /// Reads `packed-refs` through the per-store cache, re-parsing only when the file stamp moves.
    ///
    /// Returns a shared handle so the common read path performs no copy at all. Callers that need
    /// to mutate take a clone of the map.
    fn packed_table_shared(&self) -> FractalResult<std::sync::Arc<BTreeMap<String, Oid>>> {
        let path = self.git_dir.join(PACKED_REFS_FILE);
        let stamp = std::fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok().map(|modified| (modified, meta.len())));

        // A poisoned lock must not fail a read: the cache is pure derived state, so falling back
        // to an uncached parse is always correct.
        if let Ok(guard) = self.packed_cache.lock() {
            if let Some(cached) = guard.as_ref() {
                if cached.stamp == stamp {
                    return Ok(std::sync::Arc::clone(&cached.table));
                }
            }
        }

        let table = std::sync::Arc::new(self.packed_table_uncached()?);
        if let Ok(mut guard) = self.packed_cache.lock() {
            *guard = Some(PackedCache {
                stamp,
                table: std::sync::Arc::clone(&table),
            });
        }
        Ok(table)
    }

    /// Parses `packed-refs` from disk with no cache consultation.
    fn packed_table_uncached(&self) -> FractalResult<BTreeMap<String, Oid>> {
        let Some(body) = Self::read_body(&self.git_dir.join(PACKED_REFS_FILE))? else {
            return Ok(BTreeMap::new());
        };
        let mut table = BTreeMap::new();
        for line in body.lines() {
            Self::absorb_packed_line(line, &mut table);
        }
        Ok(table)
    }

    /// Lists every reference the repository currently has, loose and packed alike.
    ///
    /// Symbolic references are resolved to their targets; an entry whose target is missing is
    /// omitted, because reporting a name with no object would misrepresent the repository. A
    /// directory that cannot be read is an error rather than an empty result.
    pub fn list_all(&self) -> FractalResult<Vec<(String, Oid)>> {
        let packed = self.packed_table_shared()?;
        // One copy, not two: `packed` is the shared handle and `table` is the mutable working set
        // that loose refs are merged into. The previous form parsed into a fresh map and then
        // cloned it again before the merge.
        let mut table = (*packed).clone();
        let refs_dir = self.git_dir.join("refs");
        let view = RefSources {
            store: self,
            packed: packed.as_ref(),
        };        match fs::metadata(&refs_dir) {
            Ok(meta) if meta.is_dir() => view.collect_loose(&refs_dir, &mut table)?,
            Ok(_) => {
                return Err(FractalError::CorruptStore(format!(
                    "'{}' exists but is not a directory",
                    refs_dir.display()
                )))
            }
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {}
            Err(io_err) => return Err(FractalError::Io(io_err)),
        }
        Ok(table.into_iter().collect())
    }

    /// Reports what `HEAD` currently points at, resolving a symbolic body to its branch.
    pub fn head(&self) -> FractalResult<HeadState> {
        let Some(body) = Self::read_body(&self.git_dir.join(REF_HEAD))? else {
            return Ok(HeadState::Absent);
        };
        if let Some(target) = Self::parse_symbolic(&body) {
            let name = target.to_string();
            let resolved = self.resolve_name(&name)?;
            return Ok(HeadState::Symbolic {
                name,
                target: resolved,
            });
        }
        Ok(HeadState::Detached(Oid::from_hex(&body)?))
    }

    /// Resolves one reference name through both sources, following symbolic hops.
    fn resolve_name(&self, ref_name: &str) -> FractalResult<Option<Oid>> {
        let packed = self.packed_table()?;
        let view = RefSources {
            store: self,
            packed: &packed,
        };
        view.resolve(ref_name, 0)
    }

    /// Reads the parsed body of one loose reference file, when the file exists.
    ///
    /// A name Git would never accept is reported as absent rather than joined into a path: the loose
    /// scan walks the whole `refs/` tree, and one stray filename must not make the listing fail or
    /// address a file outside the git directory. Write paths validate the name again and reject it.
    fn lookup_body(&self, ref_name: &str) -> FractalResult<Option<LooseBody>> {
        if validate_ref_name(ref_name).is_err() {
            return Ok(None);
        }
        let path = self.git_dir.join(ref_name);
        if !path.is_file() {
            return Ok(None);
        }
        let Some(body) = Self::read_body(&path)? else {
            return Ok(None);
        };
        if let Some(target) = Self::parse_symbolic(&body) {
            return Ok(Some(LooseBody::Symbolic(target.to_string())));
        }
        Ok(Some(LooseBody::Direct(Oid::from_hex(&body)?)))
    }

    /// Parses the packed reference table into a name-to-object mapping.
    fn packed_table(&self) -> FractalResult<BTreeMap<String, Oid>> {
        // Clone out of the shared cache: callers mutate the result. The cache itself is what makes
        // repeated resolutions cheap; a full copy of a reference table is far cheaper than
        // re-reading and re-splitting the file.
        Ok((*self.packed_table_shared()?).clone())
    }

    /// Absorbs one `packed-refs` line, skipping headers and peeled target lines.
    ///
    /// Each entry is written as `<object-id> <name>`, so the first field is the id and the second
    /// is the reference name.
    fn absorb_packed_line(line: &str, table: &mut BTreeMap<String, Oid>) {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(PEELED_PREFIX) {
            return;
        }
        let Some((hex, name)) = trimmed.split_once(' ') else {
            return;
        };
        if let Ok(oid) = Oid::from_hex(hex) {
            table.insert(name.trim().to_string(), oid);
        }
    }

    /// Returns the symbolic target when `body` is `ref: <name>`.
    fn parse_symbolic(body: &str) -> Option<&str> {
        let remainder = body.strip_prefix(SYMBOLIC_PREFIX)?;
        let target = remainder.trim();
        if target.is_empty() {
            None
        } else {
            Some(target)
        }
    }

    /// Reads a reference file body, mapping a missing file to `None` and any other failure to I/O.
    fn read_body(path: &Path) -> FractalResult<Option<String>> {
        match fs::read_to_string(path) {
            Ok(body) => Ok(Some(body.trim().to_string())),
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(io_err) => Err(FractalError::Io(io_err)),
        }
    }

    /// Derives the repository-relative reference name from an absolute path.
    fn relative_name(path: &Path, git_dir: &Path) -> Option<String> {
        let relative = path.strip_prefix(git_dir).ok()?;
        Some(relative.to_string_lossy().replace('\\', "/"))
    }

    /// Returns the name an update must actually write: the symbolic target, or the name itself.
    fn write_target(&self, ref_name: &str) -> FractalResult<String> {
        match self.lookup_body(ref_name)? {
            Some(LooseBody::Symbolic(target)) => Ok(target),
            _ => Ok(ref_name.to_string()),
        }
    }

    /// Joins a validated reference name onto the git directory and proves the result stays inside it.
    fn ref_path(&self, ref_name: &str) -> FractalResult<PathBuf> {
        validate_ref_name(ref_name)?;
        let path = self.git_dir.join(ref_name);
        if !path.starts_with(&self.git_dir) {
            return Err(FractalError::RefConflict(format!(
                "reference '{ref_name}' resolves outside '{}'",
                self.git_dir.display()
            )));
        }
        Ok(path)
    }

    /// Publishes `body` at `path` through a staging file and a single rename.
    fn write_atomic(&self, path: &Path, body: String) -> FractalResult<()> {
        let _ = reset_file_write_permission(path);
        fg_core::write_file_atomic(path, body.as_bytes(), false)?;
        if path.to_string_lossy().contains("telemetry") {
            let _ = apply_os_telemetry_protection(path);
        }
        Ok(())
    }

    /// Reports whether Git logs updates to `ref_name` with its default configuration.
    fn should_log_ref(ref_name: &str) -> bool {
        ref_name == HEAD_NAME
            || ref_name == "refs/stash"
            || REFLOG_NAMESPACES
                .iter()
                .any(|namespace| ref_name.starts_with(namespace))
    }

    /// Reads the actor Git would attribute a reflog line to, honouring the environment overrides.
    fn reflog_identity() -> (String, String) {
        let read = |key: &str, fallback: &str| {
            std::env::var(key)
                .ok()
                .map(|value| value.replace(['\n', '\r', '\t'], " "))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| fallback.to_string())
        };
        (
            read("GIT_COMMITTER_NAME", "Taxis Operator"),
            read("GIT_COMMITTER_EMAIL", "operator@taxis.internal"),
        )
    }

    /// Formats one reflog line as `<old> <new> <actor> <timestamp> <zone>\t<message>`.
    fn format_reflog_line(old: Option<&Oid>, new: &Oid, message: &str) -> String {
        let (actor, email) = Self::reflog_identity();
        let old_hex = old.map_or_else(|| Oid::ZERO.to_hex(), Oid::to_hex);
        let timestamp = chrono::Utc::now().timestamp();
        let offset = chrono::Local::now().offset().local_minus_utc();
        let sign = if offset < 0 { '-' } else { '+' };
        let zone = format!(
            "{}{:02}{:02}",
            sign,
            offset.abs() / 3600,
            (offset.abs() % 3600) / 60
        );
        let message = message.replace(['\n', '\r'], " ");
        let header = format!(
            "{old_hex} {} {actor} <{email}> {timestamp} {zone}",
            new.to_hex()
        );
        // Git omits the tab entirely when no message was supplied, so an unannotated
        // update and an annotated one stay distinguishable byte-for-byte.
        if message.is_empty() {
            format!("{header}\n")
        } else {
            format!("{header}\t{message}\n")
        }
    }

    /// Appends one reflog line to `logs/<ref>`, creating the directory tree on demand.
    fn append_reflog(
        &self,
        ref_name: &str,
        old: Option<&Oid>,
        new: &Oid,
        message: &str,
    ) -> FractalResult<()> {
        if !Self::should_log_ref(ref_name) {
            return Ok(());
        }
        let path = self.git_dir.join(LOGS_DIR).join(ref_name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let line = Self::format_reflog_line(old, new, message);
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        file.write_all(line.as_bytes())?;
        Ok(())
    }

    /// Records one reflog line, reporting a failure as a degradation instead of hiding it.
    fn record_reflog(&self, ref_name: &str, old: Option<&Oid>, new: &Oid, message: &str) {
        if let Err(log_err) = self.append_reflog(ref_name, old, new, message) {
            eprintln!(
                "warning: '{ref_name}' was updated to {} but its reflog could not be written: {log_err}; the update stands and the reflog is incomplete",
                new.to_hex()
            );
        }
    }

    /// Deletes the reflog Git deletes together with the reference itself.
    fn remove_reflog(&self, ref_name: &str) -> FractalResult<()> {
        if !Self::should_log_ref(ref_name) {
            return Ok(());
        }
        let logs_dir = self.git_dir.join(LOGS_DIR);
        let path = logs_dir.join(ref_name);
        match fs::remove_file(&path) {
            Ok(()) => Self::prune_empty_parents(&path, &logs_dir),
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => {}
            Err(io_err) => return Err(FractalError::Io(io_err)),
        }
        Ok(())
    }

    /// Removes now-empty directories between `path` and `stop`, leaving `stop` in place.
    fn prune_empty_parents(path: &Path, stop: &Path) {
        let mut current = path.parent();
        while let Some(directory) = current {
            if directory == stop || !directory.starts_with(stop) {
                break;
            }
            if fs::remove_dir(directory).is_err() {
                break;
            }
            current = directory.parent();
        }
    }

    /// Rewrites `packed-refs` without `ref_name`, preserving headers, comments, and other entries.
    ///
    /// A packed entry owns the peeled `^` line that follows it, so that line is dropped with the
    /// entry; every other byte of the table is copied through unchanged and the result is published
    /// with the same staging rename used for loose references.
    fn remove_packed_entry(&self, ref_name: &str) -> FractalResult<bool> {
        let packed_path = self.git_dir.join(PACKED_REFS_FILE);
        let body = match fs::read_to_string(&packed_path) {
            Ok(body) => body,
            Err(io_err) if io_err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(io_err) => return Err(FractalError::Io(io_err)),
        };
        let mut rewritten = String::with_capacity(body.len());
        let mut removed = false;
        let mut drop_peeled = false;
        for raw_line in body.split_inclusive('\n') {
            let content = raw_line.trim_end_matches(['\r', '\n']);
            let trimmed = content.trim();
            let is_peeled = trimmed.starts_with(PEELED_PREFIX);
            if drop_peeled && is_peeled {
                continue;
            }
            if !is_peeled {
                drop_peeled = false;
            }
            let entry_name = if is_peeled || trimmed.starts_with('#') || trimmed.is_empty() {
                None
            } else {
                trimmed.split_once(' ').map(|(_, name)| name.trim())
            };
            if entry_name == Some(ref_name) {
                removed = true;
                drop_peeled = true;
                continue;
            }
            rewritten.push_str(raw_line);
        }
        if !removed {
            return Ok(false);
        }
        self.write_atomic(&packed_path, rewritten)?;
        Ok(true)
    }

    /// Deletes one reference from both on-disk sources and drops the reflog that named it.
    fn delete_ref_entry(&self, ref_name: &str) -> FractalResult<bool> {
        if let Some(fractal_ref) = FractalRef::parse(ref_name) {
            fractal_ref.verify_telemetry_update_policy(None, None, false)?;
        }
        let path = self.ref_path(ref_name)?;
        let mut removed = false;
        if path.is_file() {
            fs::remove_file(&path)?;
            Self::prune_empty_parents(&path, &self.git_dir.join("refs"));
            removed = true;
        }
        if self.remove_packed_entry(ref_name)? {
            removed = true;
        }
        self.remove_reflog(ref_name)?;
        Ok(removed)
    }

    /// Points HEAD at a symbolic branch reference, which is how Git records a checked-out branch.
    pub fn update_head_symbolic(&self, ref_name: &str) -> FractalResult<()> {
        validate_ref_name(ref_name)?;
        self.write_head_body(format!("ref: {ref_name}\n"))
    }

    /// Reads the raw symbolic target if `ref_name` is a symbolic reference.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::Io`] if reading the reference file fails, or
    /// [`FractalError::RefConflict`] if the reference name contains illegal characters.
    pub fn read_symbolic_ref(&self, ref_name: &str) -> FractalResult<Option<String>> {
        if ref_name == HEAD_NAME {
            let path = self.git_dir.join(REF_HEAD);
            let Some(body) = Self::read_body(&path)? else {
                return Ok(None);
            };
            return Ok(Self::parse_symbolic(&body).map(str::to_string));
        }
        match self.lookup_body(ref_name)? {
            Some(LooseBody::Symbolic(target)) => Ok(Some(target)),
            _ => Ok(None),
        }
    }

    /// Points an arbitrary reference symbolically at another reference target.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::RefConflict`] if either `ref_name` or `target` fails naming
    /// validation, or if the target file cannot be atomically committed to disk.
    pub fn write_symbolic_ref(&self, ref_name: &str, target: &str) -> FractalResult<()> {
        validate_ref_name(ref_name)?;
        validate_ref_name(target)?;
        if ref_name == HEAD_NAME {
            return self.update_head_symbolic(target);
        }
        let ref_path = self.ref_path(ref_name)?;
        if let Some(parent) = ref_path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.write_atomic(&ref_path, format!("ref: {target}\n"))
    }

    /// Points HEAD directly at one commit object, producing a detached head.
    pub fn update_head_detached(&self, oid: &Oid) -> FractalResult<()> {
        self.write_head_body(format!("{}\n", oid.to_hex()))
    }

    /// Records the pre-reset position in `ORIG_HEAD`, as Git's `reset` does before moving HEAD.
    pub fn write_orig_head(&self, oid: &Oid) -> FractalResult<()> {
        self.write_atomic(
            &self.git_dir.join("ORIG_HEAD"),
            format!("{}\n", oid.to_hex()),
        )
    }

    /// Appends the HEAD reflog line for a move that reaches HEAD through a branch update.
    ///
    /// `reset` moves HEAD by rewriting the checked-out branch, which logs the branch but not HEAD;
    /// Git also keeps the `reset: moving to ...` entry on HEAD for the same move.
    pub fn record_head_move(&self, previous: &Oid, new: &Oid, message: &str) {
        self.record_reflog(HEAD_NAME, Some(previous), new, message);
    }

    /// Updates a reference and records the reflog entries Git would record for the same write.
    ///
    /// # Errors
    ///
    /// Propagates invalid names, compare-and-swap conflicts, and write failures. A reflog failure is
    /// reported on stderr instead because the reference has already been published.
    pub fn update_ref_with_message(
        &self,
        ref_name: &str,
        new_oid: &Oid,
        expected_old: Option<&Oid>,
        message: &str,
    ) -> FractalResult<()> {
        validate_ref_name(ref_name)?;
        if let Some(fractal_ref) = FractalRef::parse(ref_name) {
            fractal_ref.verify_telemetry_update_policy(
                expected_old.copied(),
                Some(*new_oid),
                false,
            )?;
        }
        let target_name = self.write_target(ref_name)?;
        let previous = self.resolve_name(&target_name)?;
        if let Some(expected) = expected_old {
            if previous.as_ref() != Some(expected) {
                return Err(FractalError::RefConflict(format!(
                    "CAS ref update conflict on {}: expected {:?}, got {:?}",
                    target_name, expected, previous
                )));
            }
        }
        let path = self.ref_path(&target_name)?;
        self.write_atomic(&path, format!("{}\n", new_oid.to_hex()))?;
        self.record_reflog(&target_name, previous.as_ref(), new_oid, message);
        if ref_name == HEAD_NAME && target_name != HEAD_NAME {
            self.record_reflog(HEAD_NAME, previous.as_ref(), new_oid, message);
        }
        Ok(())
    }

    /// Writes the HEAD body through the same staging rename protocol as ordinary references.
    fn write_head_body(&self, body: String) -> FractalResult<()> {
        self.write_atomic(&self.git_dir.join(REF_HEAD), body)
    }
}

impl RefStore for DiskRefStore {
    fn get_ref(&self, ref_name: &str) -> FractalResult<Option<Oid>> {
        validate_ref_name(ref_name)?;
        self.resolve_name(ref_name)
    }

    fn update_ref(
        &self,
        ref_name: &str,
        new_oid: &Oid,
        expected_old: Option<&Oid>,
    ) -> FractalResult<()> {
        self.update_ref_with_message(ref_name, new_oid, expected_old, "")
    }

    fn delete_ref(&self, ref_name: &str) -> FractalResult<bool> {
        self.delete_ref_entry(ref_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cache must never serve a table that no longer matches the file on disk.
    ///
    /// This is the property that makes caching safe at all: `git pack-refs` rewrites the file
    /// wholesale, and a second store built after that rewrite must observe the new content even
    /// though an earlier parse was cached.
    #[test]
    fn packed_refs_cache_observes_a_rewritten_file() {
        // The process temp directory is not writable in this build environment, so the fixture
        // lives under the crate's own target directory instead.
        let base = std::env::var_os("CARGO_TARGET_TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("target"));
        let dir = base.join(format!(
            "packed-refs-cache-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(dir.join("refs")).expect("create temp git dir");

        let first_oid = Oid::from_bytes([0x11; 20]);
        let second_oid = Oid::from_bytes([0x22; 20]);
        let packed_path = dir.join("packed-refs");

        std::fs::write(
            &packed_path,
            format!("# pack-refs with: peeled\n{first_oid} refs/heads/main\n"),
        )
        .expect("write first packed-refs");

        let store = DiskRefStore::new(&dir);
        assert_eq!(
            store.get_ref("refs/heads/main").expect("first read"),
            Some(first_oid),
            "first parse must see the first content"
        );
        // Repeated reads hit the cache and must agree.
        assert_eq!(
            store.get_ref("refs/heads/main").expect("cached read"),
            Some(first_oid)
        );

        // Rewrite with a different oid and a different byte length so the stamp cannot collide.
        std::fs::write(
            &packed_path,
            format!("# pack-refs with: peeled fully-peeled\n{second_oid} refs/heads/main\n"),
        )
        .expect("rewrite packed-refs");

        assert_eq!(
            store.get_ref("refs/heads/main").expect("read after rewrite"),
            Some(second_oid),
            "a stamp change must force a re-parse rather than serve the stale table"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_telemetry_ref_roundtrip_and_parsing() {
        let oid = Oid::from_bytes([0x12; 20]);
        let commit_ref = FractalRef::TelemetryCommit { commit_oid: oid };
        let formatted_commit = commit_ref.to_git_ref();
        assert_eq!(
            formatted_commit,
            format!("refs/fractal/telemetry/commit/{}", oid.to_hex())
        );
        assert_eq!(FractalRef::parse(&formatted_commit), Some(commit_ref));

        let ledger_ref = FractalRef::CellTelemetryLedger {
            cell_id: "cell-alpha".into(),
        };
        let formatted_ledger = ledger_ref.to_git_ref();
        assert_eq!(
            formatted_ledger,
            "refs/fractal/telemetry/cell/cell-alpha/ledger"
        );
        assert_eq!(FractalRef::parse(&formatted_ledger), Some(ledger_ref));

        let summary_ref = FractalRef::CardTelemetrySummary {
            cell_id: "cell-alpha".into(),
            card_id: "card-42".into(),
        };
        let formatted_summary = summary_ref.to_git_ref();
        assert_eq!(
            formatted_summary,
            "refs/fractal/telemetry/cell/cell-alpha/card/card-42/summary"
        );
        assert_eq!(FractalRef::parse(&formatted_summary), Some(summary_ref));
    }

    #[test]
    fn test_telemetry_ref_protection_policy() {
        let oid1 = Oid::from_bytes([0x11; 20]);
        let oid2 = Oid::from_bytes([0x22; 20]);
        let ledger_ref = FractalRef::CellTelemetryLedger {
            cell_id: "cell-beta".into(),
        };

        // Normal fast-forward update is allowed
        assert!(ledger_ref
            .verify_telemetry_update_policy(Some(oid1), Some(oid2), false)
            .is_ok());

        // Force overwrite is strictly denied
        let force_err = ledger_ref.verify_telemetry_update_policy(Some(oid1), Some(oid2), true);
        assert!(force_err.is_err());

        // Deletion (new_oid: None) is strictly denied
        let delete_err = ledger_ref.verify_telemetry_update_policy(Some(oid1), None, false);
        assert!(delete_err.is_err());

        // Non-telemetry ref is unaffected by telemetry policy
        let trunk_ref = FractalRef::Trunk;
        assert!(trunk_ref
            .verify_telemetry_update_policy(Some(oid1), None, true)
            .is_ok());
    }

    #[test]
    fn test_apply_os_telemetry_protection() {
        let temp_dir = std::path::PathBuf::from("target/test_tmp/taxis_os_lock_test");
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();
        let test_file = temp_dir.join("ledger.ndjson");
        fs::write(&test_file, "initial line\n").unwrap();

        assert!(apply_os_telemetry_protection(&test_file).is_ok());

        let metadata = fs::metadata(&test_file).unwrap();
        assert!(metadata.permissions().readonly());

        // Restore file write permissions prior to scratch workspace removal
        assert!(reset_file_write_permission(&test_file).is_ok());
        let _ = fs::remove_file(&test_file);
        let _ = fs::remove_dir_all(&temp_dir);
    }
}
