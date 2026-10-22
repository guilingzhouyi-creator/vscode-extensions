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
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

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

/// Monotonic counter making atomic-write staging names unique within one process.
static STAGING_COUNTER: AtomicU64 = AtomicU64::new(0);

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
        if let Some(sys) = Self::parse_system_trunk_ref(&parts) {
            return Some(sys);
        }

        if parts.len() < 3 || parts[0] != "refs" || parts[1] != "fractal" {
            return None;
        }

        match parts[2] {
            "trunk" | "integration" => Some(Self::Trunk),
            "cell" => Self::parse_fractal_cell_ref(&parts),
            _ => None,
        }
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
        for entry in fs::read_dir(dir).map_err(FractalError::Io)? {
            let entry = entry.map_err(FractalError::Io)?;
            let path = entry.path();
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
}

impl DiskRefStore {
    /// Constructs a filesystem-backed Git reference store targeting the given repository path.
    pub fn new(git_dir: impl Into<PathBuf>) -> Self {
        Self {
            git_dir: git_dir.into(),
        }
    }

    /// Lists every reference the repository currently has, loose and packed alike.
    ///
    /// Symbolic references are resolved to their targets; an entry whose target is missing is
    /// omitted, because reporting a name with no object would misrepresent the repository. A
    /// directory that cannot be read is an error rather than an empty result.
    pub fn list_all(&self) -> FractalResult<Vec<(String, Oid)>> {
        let packed = self.packed_table()?;
        let mut table = packed.clone();
        let refs_dir = self.git_dir.join("refs");
        let view = RefSources {
            store: self,
            packed: &packed,
        };
        match fs::metadata(&refs_dir) {
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
    fn lookup_body(&self, ref_name: &str) -> FractalResult<Option<LooseBody>> {
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
        let Some(body) = Self::read_body(&self.git_dir.join(PACKED_REFS_FILE))? else {
            return Ok(BTreeMap::new());
        };
        let mut table = BTreeMap::new();
        for line in body.lines() {
            Self::absorb_packed_line(line, &mut table);
        }
        Ok(table)
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

    /// Builds a staging path unique to this process and call, so writers never share one file.
    fn staging_path(path: &Path) -> PathBuf {
        let sequence = STAGING_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut staging = path.as_os_str().to_owned();
        staging.push(format!(".{}-{}.tmp", std::process::id(), sequence));
        PathBuf::from(staging)
    }
}

impl RefStore for DiskRefStore {
    fn get_ref(&self, ref_name: &str) -> FractalResult<Option<Oid>> {
        self.resolve_name(ref_name)
    }

    fn update_ref(
        &self,
        ref_name: &str,
        new_oid: &Oid,
        expected_old: Option<&Oid>,
    ) -> FractalResult<()> {
        let target_name = self.write_target(ref_name)?;
        if let Some(expected) = expected_old {
            let current = self.resolve_name(&target_name)?;
            if current.as_ref() != Some(expected) {
                return Err(FractalError::RefConflict(format!(
                    "CAS ref update conflict on {}: expected {:?}, got {:?}",
                    target_name, expected, current
                )));
            }
        }

        let path = self.git_dir.join(&target_name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let staging = Self::staging_path(&path);
        fs::write(&staging, format!("{}\n", new_oid.to_hex()))?;
        if let Err(rename_err) = fs::rename(&staging, &path) {
            let _ = fs::remove_file(&staging);
            return Err(FractalError::Io(rename_err));
        }
        Ok(())
    }

    fn delete_ref(&self, ref_name: &str) -> FractalResult<bool> {
        let path = self.git_dir.join(ref_name);
        if path.is_file() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
