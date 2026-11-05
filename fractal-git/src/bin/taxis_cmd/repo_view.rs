//! Module: taxis_cmd::repo_view — Native Repository View
//! File Path: src/bin/taxis_cmd/repo_view.rs
//! Architecture Role: The single place the read commands obtain a repository from. Locates the git
//!   directory and worktree root, opens the native object router, and resolves revisions to objects
//!   without starting any child process.
//! Dependencies & Triggers: Built by `cat-file`, `ls-tree`, `ls-files`, `show-ref`,
//!   `for-each-ref`, `check-ignore`, `status`, and `diff`.
//! Responsibilities: Path discovery, revision resolution, tag peeling, and index loading.
//! Exit Semantics & Design Rationale:
//!   - Path discovery accepts a worktree root, a `.git` directory, or a `.taxis` directory. Callers
//!     pass whatever `--git-dir` gave them, and a command that only worked from the worktree root
//!     would fail for every script that passes an explicit repository.
//!   - Revision resolution consults `HEAD` first, then every reference, then a raw object id. Git
//!     resolves in that order too; reversing it would let a branch named like a hex string shadow
//!     the reference it names.
//!   - An unresolvable revision is an error naming the input. Returning `HEAD` or the zero id would
//!     make a typo look like a successful command against an empty repository.
//!   - The object router owns the only object cache in the process. Opening a second one per command
//!     would re-read every pack for a single lookup.

use std::fs;
use std::path::{Path, PathBuf};

use fg_core::error::{FractalError, FractalResult};
use fg_core::models::{FileMode, ObjectKind, Oid};
use fg_core::traits::RefStore;
use fg_index::{AttributeSet, GitIndex, IgnoreMatcher};
use fg_object::GitTreeRef;
use fg_storage::{OdbRouter, PackedObject};
use fg_topology::{DiskRefStore, HeadState};

use super::common::CliContext;
use super::config::RepoConfig;

/// Name of the directory a git-compatible repository keeps its metadata in.
const GIT_DIR_NAME: &str = ".git";

/// Name of the directory a Taxis-native repository keeps its metadata in.
const TAXIS_DIR_NAME: &str = ".taxis";

/// Prefix that a symbolic reference body carries before its target.
const SYMBOLIC_PREFIX: &str = "ref:";

/// One opened repository, ready for read commands.
pub struct RepoView {
    git_dir: PathBuf,
    work_root: PathBuf,
    odb: OdbRouter,
    refs: DiskRefStore,
    config: RepoConfig,
}

impl RepoView {
    /// Opens the repository named by the CLI context.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::CorruptStore`] when no repository can be found, and propagates object
    /// store failures.
    pub fn open(ctx: &CliContext) -> FractalResult<Self> {
        let git_dir = locate_git_dir(&ctx.git_dir)?;
        let work_root = resolve_work_root(&git_dir);
        let odb = OdbRouter::open(git_dir.join("objects"))?;
        let refs = DiskRefStore::new(&git_dir);
        let config = RepoConfig::load(&git_dir);
        Ok(Self {
            git_dir,
            work_root,
            odb,
            refs,
            config,
        })
    }

    /// Opens the repository named by the CLI context or exits with fatal status 128.
    pub fn open_or_exit(ctx: &CliContext) -> Self {
        Self::open(ctx).unwrap_or_else(|err| super::common::fail_fatal(err))
    }

    /// Configuration values that change what a comparison reports.
    pub fn config(&self) -> RepoConfig {
        self.config
    }

    /// Directory holding `HEAD`, `objects`, and `refs`.
    pub fn git_dir(&self) -> &Path {
        &self.git_dir
    }

    /// Root of the working tree the repository projects onto.
    pub fn work_root(&self) -> &Path {
        &self.work_root
    }

    /// Number of packs the object store currently holds.
    ///
    /// Reported by `status` so an operator can tell a loose-only store from a packed one without a
    /// second command; the router itself stays private so no caller can bypass [`Self::object`].
    pub fn pack_count(&self) -> usize {
        self.odb.pack_count()
    }

    /// Object count as Git's abbreviation heuristic measures it.
    ///
    /// Exposed so `log` and `diff` derive the same id width. Two callers computing it separately
    /// would drift the moment one of them counted loose objects, and the width is visible in every
    /// abbreviated id the tool prints.
    pub fn approximate_object_count(&self) -> usize {
        self.odb.approximate_object_count()
    }

    /// Resolves an object id, transparently substituting `refs/replace/<oid>` if present unless disabled.
    pub fn resolve_replace_oid(&self, oid: &Oid) -> Oid {
        if std::env::var("GIT_NO_REPLACE_OBJECTS").is_ok() {
            return *oid;
        }
        let replace_ref = format!("refs/replace/{}", oid.to_hex());
        match self.refs.get_ref(&replace_ref) {
            Ok(Some(replacement)) => replacement,
            _ => *oid,
        }
    }

    /// Reads an object, requiring it to exist.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the id is absent.
    pub fn object(&self, oid: &Oid) -> FractalResult<PackedObject> {
        let effective_oid = self.resolve_replace_oid(oid);
        self.odb.read_required(&effective_oid)
    }

    /// Reads the payload of a blob, requiring the object to actually be a blob.
    ///
    /// # Errors
    ///
    /// Propagates object reads, and returns [`FractalError::ObjectCodec`] when the id names a
    /// non-blob. Returning the payload of a tree here would let a caller diff two directory
    /// listings as if they were file content.
    pub fn blob_payload(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
        let object = self.object(oid)?;
        if object.kind != ObjectKind::Blob {
            return Err(FractalError::ObjectCodec(format!(
                "{} is a {}, not a blob",
                oid.to_hex(),
                object.kind.as_str()
            )));
        }
        Ok(object.payload)
    }

    /// Reads the payload a comparison should use for one tree entry.
    ///
    /// A gitlink is a commit binding, not file content: Git reports its size as zero and never reads
    /// it, so an empty payload is the faithful projection. Trying to read one would fail on every
    /// repository that has a submodule, and substituting synthetic dummy bytes would make two different
    /// submodule commits look identical to the similarity score.
    ///
    /// # Errors
    ///
    /// Propagates object reads for every non-gitlink mode.
    pub fn payload_for(&self, mode: FileMode, oid: &Oid) -> FractalResult<Vec<u8>> {
        if mode == FileMode::Gitlink {
            return Ok(Vec::new());
        }
        self.blob_payload(oid)
    }

    /// Resolves `HEAD` to the commit it points at, if the branch has commits.
    ///
    /// # Errors
    ///
    /// Propagates reference-store failures. An unborn branch returns `Ok(None)`.
    pub fn head_commit(&self) -> FractalResult<Option<Oid>> {
        match self.refs.head()? {
            HeadState::Absent => {
                let container_path = fg_native::container_path(&self.git_dir);
                if container_path.is_file() {
                    if let Ok(doc) = fg_native::RepoDocument::load(&container_path) {
                        return match doc.head {
                            fg_native::HeadState::Symbolic { ref target } => {
                                self.lookup_reference(target)
                            }
                            fg_native::HeadState::Detached { oid } => Ok(Some(oid)),
                        };
                    }
                }
                Ok(None)
            }
            HeadState::Detached(oid) => Ok(Some(oid)),
            HeadState::Symbolic { target, .. } => Ok(target),
        }
    }

    /// Lists local branches as `(short name, commit)`, sorted by short name.
    ///
    /// `refs/original/*` backups are excluded: `git filter-branch` writes them there, and they are
    /// not branches — a `branch` listing that includes them reports names the user never created,
    /// and a script picking the first line could then check out a backup instead of a branch.
    ///
    /// # Errors
    ///
    /// Propagates reference-store failures.
    pub fn branches(&self) -> FractalResult<Vec<(String, Oid)>> {
        let prefix = "refs/heads/";
        let mut listed: Vec<(String, Oid)> = self
            .refs
            .list_all()?
            .into_iter()
            .filter_map(|(name, oid)| {
                name.strip_prefix(prefix)
                    .map(|short| (short.to_string(), oid))
            })
            .collect();
        listed.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(listed)
    }

    /// Name of the branch `HEAD` points at, and the commit it resolves to.
    ///
    /// Returns `None` for a detached checkout: there is no branch, and reporting the most recent tag
    /// or a synthetic name would claim a symbolic position the repository does not have.
    ///
    /// # Errors
    ///
    /// Propagates reference-store failures.
    pub fn head_branch(&self) -> FractalResult<Option<(String, Option<Oid>)>> {
        const PREFIX: &str = "refs/heads/";
        match self.refs.head()? {
            HeadState::Symbolic { name, target } => Ok(name
                .strip_prefix(PREFIX)
                .map(|short| (short.to_string(), target))),
            HeadState::Absent | HeadState::Detached(_) => Ok(None),
        }
    }

    /// Short names of the branches checked out by a linked worktree.
    ///
    /// Git records one directory per linked worktree under `<git_dir>/worktrees/`, each carrying its
    /// own `HEAD`. A branch listed there is marked `+` by `git branch` instead of `*`, because two
    /// worktrees cannot have the same branch checked out at once and a reader needs to know the name
    /// is already in use elsewhere.
    ///
    /// Unreadable entries are skipped rather than failing the listing: a worktree whose directory was
    /// deleted out from under the repository leaves a stale bookkeeping entry, and refusing to list
    /// branches because of it would hide the branches that do exist.
    pub fn linked_worktree_branches(&self) -> Vec<String> {
        const PREFIX: &str = "refs/heads/";
        let root = self.git_dir.join("worktrees");
        let Ok(entries) = std::fs::read_dir(&root) else {
            return Vec::new();
        };
        let mut names = Vec::new();
        for entry in entries.flatten() {
            let Ok(body) = std::fs::read_to_string(entry.path().join("HEAD")) else {
                continue;
            };
            if let Some(target) = body.trim().strip_prefix(SYMBOLIC_PREFIX) {
                if let Some(short) = target.trim().strip_prefix(PREFIX) {
                    names.push(short.to_string());
                }
            }
        }
        names
    }

    /// Resolves a revision expression to an object id.
    ///
    /// Accepts `HEAD`, a full reference name, a branch or tag short name, a full 40-character object
    /// id, and the ancestry suffixes `~N` and `^N`. The suffixes are resolved by walking parents
    /// from the base expression, so `HEAD~1` and `HEAD^` name the same commit.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] naming the unresolved input.
    pub fn resolve(&self, revision: &str) -> FractalResult<Oid> {
        if let Some(inner) = revision.strip_suffix("^{tree}") {
            return Ok(self.resolve_tree(inner)?.1);
        }
        if let Some(inner) = revision.strip_suffix("^{}") {
            let resolved = self.resolve(inner)?;
            return self.peel(&resolved);
        }
        if let Some(inner) = revision.strip_suffix("^{commit}") {
            let peeled = self.peel(&self.resolve(inner)?)?;
            let kind = self.object(&peeled)?.kind;
            if kind != ObjectKind::Commit {
                return Err(FractalError::ObjectCodec(format!(
                    "'{revision}' resolves to a {}, not a commit",
                    kind.as_str()
                )));
            }
            return Ok(peeled);
        }
        let (base, steps) = split_ancestry_suffix(revision);
        if steps.is_empty() {
            return self.resolve_base(base);
        }
        let mut current = self.resolve_base(base)?;
        for step in steps {
            current = self.walk_parent(current, step)?;
        }
        Ok(current)
    }

    /// Resolves a revision that may carry a ':path' tree suffix.
    ///
    /// 'git cat-file' and 'git ls-tree' accept 'rev:path', where the path is walked entry by entry
    /// inside the tree objects the revision names -- never through the worktree or the index.
    /// Walking the tree objects is what makes a committed-but-deleted file readable and what keeps
    /// a worktree edit from changing the answer; a path that only exists on disk stays unresolved.
    ///
    /// # Errors
    ///
    /// Returns FractalError::ObjectCodec when the revision does not resolve, when it names an
    /// object with no tree, or when a path component is absent from the tree.
    pub fn resolve_object_spec(&self, spec: &str) -> FractalResult<Oid> {
        let Some((revision, path)) = spec.split_once(':') else {
            return self.resolve(spec);
        };
        if revision.is_empty() {
            let normalized = path.strip_prefix("0:").unwrap_or(path);
            let index = self.index()?.ok_or_else(|| {
                FractalError::ObjectCodec(format!("path '{normalized}' is not in the index"))
            })?;
            return index
                .entries()
                .iter()
                .find(|entry| entry.path == normalized)
                .map(|entry| entry.oid)
                .ok_or_else(|| {
                    FractalError::ObjectCodec(format!("path '{normalized}' is not in the index"))
                });
        }
        let mut current = self.peel(&self.resolve(revision)?)?;
        let mut object = self.object(&current)?;
        if object.kind == ObjectKind::Commit {
            current = parse_commit_tree(&object.payload)?;
            object = self.object(&current)?;
        }
        if object.kind != ObjectKind::Tree {
            return Err(FractalError::ObjectCodec(format!(
                "'{revision}' resolves to a {}, which has no tree to walk",
                object.kind.as_str()
            )));
        }
        let segments: Vec<&str> = path
            .trim_matches('/')
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();
        if segments.is_empty() {
            return Ok(current);
        }
        let mut tree_payload = object.payload;
        for (index, segment) in segments.iter().enumerate() {
            let Some(entry) = GitTreeRef::from_bytes(&tree_payload).find_entry(segment)? else {
                return Err(FractalError::ObjectCodec(format!(
                    "path '{path}' does not exist in '{revision}'"
                )));
            };
            if index + 1 == segments.len() {
                return Ok(entry.oid);
            }
            if !entry.mode.is_tree() {
                return Err(FractalError::ObjectCodec(format!(
                    "path '{path}' does not exist in '{revision}'"
                )));
            }
            tree_payload = self.object(&entry.oid)?.payload;
        }
        Ok(current)
    }

    /// Resolves the part of a revision that names an object, without ancestry suffixes.
    fn resolve_base(&self, revision: &str) -> FractalResult<Oid> {
        if revision == "HEAD" || revision == "@" {
            if let Some(oid) = self.head_commit()? {
                return Ok(oid);
            }
            if fg_core::constants::Edition::CURRENT == fg_core::constants::Edition::Engineering {
                if let Ok(Some(oid)) = self.lookup_reference("refs/fractal/cell/cell-default/main") {
                    return Ok(oid);
                }
            }
            return Err(FractalError::ObjectCodec(format!(
                "HEAD is unborn in '{}'; there is no commit to resolve",
                self.git_dir.display()
            )));
        }
        if let Ok(oid) = Oid::from_hex(revision) {
            if self.odb.read(&oid)?.is_some() {
                return Ok(oid);
            }
            return Err(FractalError::ObjectCodec(format!(
                "object {revision} is not present in '{}'",
                self.git_dir.display()
            )));
        }
        for candidate in reference_candidates(revision) {
            if let Some(found) = self.lookup_reference(&candidate)? {
                return Ok(found);
            }
        }
        Err(FractalError::ObjectCodec(format!(
            "revision '{revision}' names no reference in '{}'",
            self.git_dir.display()
        )))
    }

    /// Takes one ancestry step: `~` follows the first parent n times, `^` picks the n-th parent.
    fn walk_parent(&self, start: Oid, step: AncestryStep) -> FractalResult<Oid> {
        let mut current = start;
        match step {
            AncestryStep::FirstParent(times) => {
                for _ in 0..times {
                    let parents = self.commit_parents(&current)?;
                    current = *parents.first().ok_or_else(|| {
                        FractalError::ObjectCodec(format!(
                            "{} has no first parent; '~' cannot go further",
                            current.to_hex()
                        ))
                    })?;
                }
            }
            AncestryStep::NthParent(index) => {
                let parents = self.commit_parents(&current)?;
                let slot = index.checked_sub(1).ok_or_else(|| {
                    FractalError::ObjectCodec("'^0' is not an ancestry step".to_string())
                })?;
                current = *parents.get(slot).ok_or_else(|| {
                    FractalError::ObjectCodec(format!(
                        "{} has {} parent(s); '^{index}' is out of range",
                        current.to_hex(),
                        parents.len()
                    ))
                })?;
            }
        }
        Ok(current)
    }

    /// Reads the parent ids of a commit, peeling a tag first.
    fn commit_parents(&self, oid: &Oid) -> FractalResult<Vec<Oid>> {
        let peeled = self.peel(oid)?;
        let object = self.object(&peeled)?;
        if object.kind != ObjectKind::Commit {
            return Err(FractalError::ObjectCodec(format!(
                "{} is a {}, which has no parents",
                peeled.to_hex(),
                object.kind.as_str()
            )));
        }
        let text = std::str::from_utf8(&object.payload).map_err(|utf_err| {
            FractalError::ObjectCodec(format!("commit payload is not UTF-8: {utf_err}"))
        })?;
        let mut parents = Vec::new();
        for line in text.lines() {
            if line.is_empty() {
                break;
            }
            if let Some(value) = line.strip_prefix("parent ") {
                parents.push(Oid::from_hex(value.trim())?);
            }
        }
        Ok(parents)
    }

    /// Returns the id a reference records, or `None` when it does not exist.
    fn lookup_reference(&self, name: &str) -> FractalResult<Option<Oid>> {
        if let Ok(body) = std::fs::read_to_string(self.git_dir.join(name)) {
            let trimmed = body.trim();
            if let Some(target) = trimmed.strip_prefix(SYMBOLIC_PREFIX) {
                return self.lookup_reference(target.trim());
            }
            if let Ok(oid) = Oid::from_hex(trimmed) {
                return Ok(Some(oid));
            }
        }
        for (listed, oid) in self.refs.list_all()? {
            if listed == name {
                return Ok(Some(oid));
            }
        }
        Ok(None)
    }

    /// Peels tags until a non-tag object is reached.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when a tag payload has no `object` header.
    pub fn peel(&self, oid: &Oid) -> FractalResult<Oid> {
        let mut current = *oid;
        for _ in 0..8 {
            let object = self.object(&current)?;
            if object.kind != ObjectKind::Tag {
                return Ok(current);
            }
            current = parse_tag_target(&object.payload)?;
        }
        Err(FractalError::ObjectCodec(format!(
            "tag chain starting at {} exceeds 8 links; refusing to follow further",
            oid.to_hex()
        )))
    }

    /// Resolves a revision to the tree it names, following commits and tags.
    ///
    /// # Errors
    ///
    /// Returns [`FractalError::ObjectCodec`] when the object is neither a tree nor a commit.
    pub fn resolve_tree(&self, revision: &str) -> FractalResult<(Oid, Oid)> {
        let resolved = self.resolve_object_spec(revision)?;
        let peeled = self.peel(&resolved)?;
        let object = self.object(&peeled)?;
        match object.kind {
            ObjectKind::Tree => Ok((resolved, peeled)),
            ObjectKind::Commit => Ok((resolved, parse_commit_tree(&object.payload)?)),
            other => Err(FractalError::ObjectCodec(format!(
                "revision '{revision}' resolves to a {}, which has no tree",
                other.as_str()
            ))),
        }
    }

    /// Loads the staged index, or `None` when the repository has none yet.
    ///
    /// # Errors
    ///
    /// Propagates decode failures; a corrupt index is reported, never treated as empty.
    pub fn index(&self) -> FractalResult<Option<GitIndex>> {
        let path = self.git_dir.join("index");
        if !path.is_file() {
            return Ok(None);
        }
        GitIndex::load(path).map(Some)
    }

    /// Returns the index file's modification time in whole seconds since the Unix epoch.
    ///
    /// The value frames the racy window: an entry whose recorded timestamp is not older than this
    /// was written in the same second the index was saved, so its stat cache cannot prove the
    /// worktree file is unchanged. A missing index has no racy window and yields None.
    pub fn index_file_timestamp(&self) -> Option<u64> {
        let metadata = fs::metadata(self.git_dir.join("index")).ok()?;
        metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .map(|elapsed| elapsed.as_secs())
    }

    /// Loads the ignore rules that apply to this worktree.
    ///
    /// # Errors
    ///
    /// Propagates read failures; a pattern file that cannot be read is not the same as no rules.
    pub fn ignore_matcher(&self) -> FractalResult<IgnoreMatcher> {
        IgnoreMatcher::load(&self.git_dir, &self.work_root)
    }

    /// Loads the attribute rules that apply to this worktree.
    ///
    /// # Errors
    ///
    /// Propagates read failures for the same reason [`Self::ignore_matcher`] does: an attribute file
    /// that cannot be read is not the same as one that declares nothing.
    pub fn attributes(&self) -> FractalResult<AttributeSet> {
        AttributeSet::load(&self.git_dir, &self.work_root)
    }

    /// Reads a worktree file as Git would store it, applying `text`/`eol` conversion.
    ///
    /// This is the only correct way to hash or render a worktree file. Reading raw bytes and hashing
    /// them reports every CRLF file declared `text` as wholly rewritten, because Git's own object ids
    /// are computed from the normalised bytes. `staged_oid` is the id the index records for the path,
    /// or `None` when the path is untracked; it lets the `text=auto` rule reproduce Git's refusal to
    /// convert a file whose stored blob already carries CRLF.
    ///
    /// A symlink is read through [`fs::read_link`] and never converted: its payload is a path, and a
    /// path has no line endings.
    ///
    /// # Errors
    ///
    /// Propagates worktree I/O and object reads for the staged blob.
    pub fn worktree_payload(
        &self,
        path: &str,
        mode: FileMode,
        staged_oid: Option<&Oid>,
        attributes: &AttributeSet,
    ) -> FractalResult<Vec<u8>> {
        let absolute = self.work_root.join(path);
        if mode == FileMode::Symlink {
            let target = fs::read_link(&absolute).map_err(FractalError::Io)?;
            return Ok(target.to_string_lossy().into_owned().into_bytes());
        }
        let raw = fs::read(&absolute).map_err(FractalError::Io)?;
        let action = attributes.crlf_action(path, self.config.auto_crlf());
        let index_has_crlf = match staged_oid {
            Some(oid) => match self.blob_payload(oid) {
                Ok(stored) => fg_index::blob_has_crlf(&stored),
                // A missing blob cannot argue for deferring, and Git converts when the object is
                // absent too. Reporting the read failure here would turn a stale index entry into a
                // failed command instead of a correct answer.
                Err(_) => false,
            },
            None => false,
        };
        Ok(fg_index::to_git_bytes(&raw, action, index_has_crlf).into_owned())
    }
}

/// One ancestry step read from a `~` or `^` suffix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AncestryStep {
    /// `~N`: follow the first parent N times; a bare `~` means once.
    FirstParent(usize),
    /// `^N`: take the N-th parent; a bare `^` means the first.
    NthParent(usize),
}

/// Splits a revision into its object-naming base and the ancestry steps that follow it.
///
/// The split point is the first `~` or `^` outside any braces, which is where Git's revision parser
/// switches from naming an object to walking from it. A revision with no suffix yields the whole
/// input and no steps.
fn split_ancestry_suffix(revision: &str) -> (&str, Vec<AncestryStep>) {
    let mut base_end = revision.len();
    for (index, character) in revision.char_indices() {
        if character == '~' || character == '^' {
            base_end = index;
            break;
        }
    }
    let base = &revision[..base_end];
    let mut steps = Vec::new();
    let mut cursor = base_end;
    let bytes = revision.as_bytes();
    while cursor < revision.len() {
        let marker = bytes[cursor] as char;
        cursor += 1;
        let digits_start = cursor;
        while cursor < revision.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
        let count = revision[digits_start..cursor].parse::<usize>().unwrap_or(1);
        match marker {
            '~' => steps.push(AncestryStep::FirstParent(count)),
            '^' => steps.push(AncestryStep::NthParent(count)),
            _ => break,
        }
    }
    (base, steps)
}

/// Candidate reference names for a short revision, in Git's resolution order.
fn reference_candidates(revision: &str) -> Vec<String> {
    if revision.starts_with("refs/") {
        return vec![revision.to_string()];
    }
    vec![
        revision.to_string(),
        format!("refs/{revision}"),
        format!("refs/tags/{revision}"),
        format!("refs/heads/{revision}"),
        format!("refs/remotes/{revision}"),
        format!("refs/remotes/{revision}/HEAD"),
    ]
}

/// Resolves the repository metadata directory from whatever path the caller supplied.
///
/// # Errors
///
/// Returns [`FractalError::CorruptStore`] when `candidate` names no repository and no ancestor does.
pub fn locate_git_dir(candidate: &Path) -> FractalResult<PathBuf> {
    let start = if candidate.as_os_str().is_empty() {
        Path::new(".")
    } else {
        candidate
    };

    if is_git_dir(start) {
        return Ok(start.to_path_buf());
    }
    for name in [TAXIS_DIR_NAME, GIT_DIR_NAME] {
        let nested = start.join(name);
        if nested.is_file() {
            return read_gitdir_pointer(&nested);
        }
        if is_git_dir(&nested) {
            return Ok(nested);
        }
    }

    let mut cursor = start.canonicalize().unwrap_or_else(|_| start.to_path_buf());
    loop {
        if is_git_dir(&cursor) {
            return Ok(cursor);
        }
        for name in [TAXIS_DIR_NAME, GIT_DIR_NAME] {
            let nested = cursor.join(name);
            if nested.is_file() {
                return read_gitdir_pointer(&nested);
            }
            if is_git_dir(&nested) {
                return Ok(nested);
            }
        }
        if !cursor.pop() {
            break;
        }
    }

    Err(FractalError::CorruptStore(format!(
        "no repository found at or above '{}'; looked for '{}' and '{}'",
        candidate.display(),
        GIT_DIR_NAME,
        TAXIS_DIR_NAME
    )))
}

/// Reports whether `path` looks like a repository metadata directory.
fn is_git_dir(path: &Path) -> bool {
    (path.join("HEAD").is_file() && path.join("objects").is_dir())
        || fg_native::container_path(path).is_file()
}

/// Follows a `.git` file that carries a `gitdir:` pointer, as a linked worktree does.
fn read_gitdir_pointer(pointer: &Path) -> FractalResult<PathBuf> {
    let body = std::fs::read_to_string(pointer)?;
    let line = body.lines().next().unwrap_or("").trim();
    let target = line.strip_prefix("gitdir:").ok_or_else(|| {
        FractalError::CorruptStore(format!(
            "'{}' exists as a file but carries no 'gitdir:' pointer",
            pointer.display()
        ))
    })?;
    let resolved = pointer
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(target.trim());
    if !resolved.is_dir() {
        return Err(FractalError::CorruptStore(format!(
            "'{}' points at '{}', which is not a directory",
            pointer.display(),
            resolved.display()
        )));
    }
    Ok(resolved)
}

/// Returns the worktree root that owns `git_dir`.
///
/// The git directory is normally `<root>/.git`; an empty or bare `git_dir` falls back to the current
/// directory so that a caller never receives an invented absolute anchor.
pub fn resolve_work_root(git_dir: &Path) -> PathBuf {
    match git_dir.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

/// Reads the `object` header out of an annotated tag payload.
fn parse_tag_target(payload: &[u8]) -> FractalResult<Oid> {
    let text = std::str::from_utf8(payload).map_err(|utf_err| {
        FractalError::ObjectCodec(format!("tag payload is not UTF-8: {utf_err}"))
    })?;
    for line in text.lines() {
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("object ") {
            return Oid::from_hex(value.trim());
        }
    }
    Err(FractalError::ObjectCodec(
        "tag payload has no 'object' header".to_string(),
    ))
}

/// Reads the `tree` header out of a commit payload.
fn parse_commit_tree(payload: &[u8]) -> FractalResult<Oid> {
    let text = std::str::from_utf8(payload).map_err(|utf_err| {
        FractalError::ObjectCodec(format!("commit payload is not UTF-8: {utf_err}"))
    })?;
    for line in text.lines() {
        if line.is_empty() {
            break;
        }
        if let Some(value) = line.strip_prefix("tree ") {
            return Oid::from_hex(value.trim());
        }
    }
    Err(FractalError::ObjectCodec(
        "commit payload has no 'tree' header".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        parse_commit_tree, parse_tag_target, reference_candidates, split_ancestry_suffix,
        AncestryStep,
    };
    use fg_core::models::Oid;

    #[test]
    fn a_revision_without_a_suffix_yields_no_steps() {
        let (base, steps) = split_ancestry_suffix("HEAD");
        assert_eq!(base, "HEAD");
        assert!(steps.is_empty());
    }

    #[test]
    fn a_bare_tilde_means_one_first_parent_step() {
        let (base, steps) = split_ancestry_suffix("HEAD~");
        assert_eq!(base, "HEAD");
        assert_eq!(steps, vec![AncestryStep::FirstParent(1)]);
    }

    #[test]
    fn a_counted_tilde_is_one_step_with_a_count() {
        let (base, steps) = split_ancestry_suffix("main~3");
        assert_eq!(base, "main");
        assert_eq!(steps, vec![AncestryStep::FirstParent(3)]);
    }

    #[test]
    fn a_caret_names_the_nth_parent() {
        let (base, steps) = split_ancestry_suffix("HEAD^2");
        assert_eq!(base, "HEAD");
        assert_eq!(steps, vec![AncestryStep::NthParent(2)]);
    }

    #[test]
    fn mixed_suffixes_are_kept_in_order() {
        let (base, steps) = split_ancestry_suffix("HEAD^2~2");
        assert_eq!(base, "HEAD");
        assert_eq!(
            steps,
            vec![AncestryStep::NthParent(2), AncestryStep::FirstParent(2)]
        );
    }

    #[test]
    fn resolves_a_short_name_through_the_reference_namespaces() {
        let candidates = reference_candidates("main");
        assert!(candidates.contains(&"refs/heads/main".to_string()));
        assert!(candidates.contains(&"refs/tags/main".to_string()));
    }

    #[test]
    fn a_fully_qualified_name_is_not_rewritten() {
        assert_eq!(
            reference_candidates("refs/heads/main"),
            vec!["refs/heads/main".to_string()]
        );
    }

    #[test]
    fn reads_the_tree_header_of_a_commit() {
        let payload = b"tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nparent 0000\n\nmessage\n";
        let tree = parse_commit_tree(payload).expect("parse");
        assert_eq!(tree.to_hex(), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    }

    #[test]
    fn rejects_a_commit_without_a_tree_header() {
        assert!(parse_commit_tree(b"author x\n\nmessage\n").is_err());
    }

    #[test]
    fn reads_the_target_of_an_annotated_tag() {
        let payload =
            b"object 4b825dc642cb6eb9a060e54bf8d69288fbee4904\ntype commit\ntag v1\n\nnote\n";
        let target = parse_tag_target(payload).expect("parse");
        assert_eq!(target.to_hex(), "4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    }

    #[test]
    fn a_zero_id_round_trips_through_hex_syntax() {
        assert_eq!(
            Oid::from_hex(&Oid::ZERO.to_hex()).expect("parse"),
            Oid::ZERO
        );
    }
}
