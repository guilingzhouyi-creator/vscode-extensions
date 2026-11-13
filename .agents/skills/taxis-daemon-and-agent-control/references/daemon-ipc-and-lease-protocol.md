# Taxis Daemon IPC, Agent Leases, Quarantine & Binary Parity Protocol

Reference spec for `fractal-git` runtime IPC, multi-agent safety isolation, `fg-gate` live hooks, and `taxis` vs `git` differential verification.

---

## 1. Persistent `taxis daemon` IPC & TAXC Caching

- **Transport**: Named Pipe on Windows (`\\.\pipe\taxis-<repo-hash>`), Unix domain socket off Windows (`<repo-dir>/daemon.sock`).
- **Session State**: Holds hot `ContainerView` readers, `PolicyVaultStore` floors, and the latest `InMemoryIndexTree` revision so high-frequency `status` / `gate-slice` / `hash-object` calls skip disk re-indexing.
- **Safety Boundaries**: Every IPC frame validates magic header + declared length <= frame cap prior to heap allocation; malformed or truncated frames close the stream and reset scratch state (`FGT-BRG-001`).

## 2. Blackboard Leases & Quarantine Replay (`FGT-QRN-001` / `FGT-TRN-001`)

| Operation | Required Check | Failure Behavior |
| :--- | :--- | :--- |
| `stage` / `commit` / `merge` | Active lease in `DiskBlackboardStore` matches caller agent & non-overlapping path slice | Abort before ODB/Index mutation with conflicting owner metadata |
| `worktree add` | Resolve explicit target `Commit` / `Tree` OID; sanitize `WorktreePool` scratch components (`..` banned) | Never clone dirty workspace; bump monotonic `epoch` on release |
| `quarantine isolate` | Serialize violating diff to `.taxis/quarantine/<id>.patch`, detach ref under `refs/fractal/quarantine/*` | Atomic write (`temp -> fsync -> rename`) + `PROM` rejection record |
| `quarantine restore` | Re-apply recorded `.patch` onto clean worktree/index and mark restored state | Abort cleanly if working tree diverged; zero partial index mutation |

## 3. Kernel Commit Guard (`FGT-MSG-001` ~ `FGT-MSG-012`) & `gate-slice`

- **Policy Floor**: `fractal-git/commit-policy.json` acts as non-weakening floor (`FGT-MSG-011`); rejects uppercase `FEAT(...)` bypasses, backtick-masked forbidden words, English 1st-person/gerunds, missing `Why`/`Verification` bounds (`FGT-MSG-003`), missing diff symbol/test citations (`FGT-MSG-010`), and unregistered rule IDs (`FGT-MSG-012`).
- **Incremental `gate-slice` (`FGT-GAT-001`)**: Computes line deltas strictly between Git `Index` and `HEAD` (not full disk files), probes AST refactor witnesses, and applies unified `diff-bounds-contract.json` (`eloc_5d` + Jeffreys prior).

## 4. Real `taxis` vs `git` Binary Parity (`validate-git-parity.js`)

1. Binary resolution searches `--taxis-bin`, `TAXIS_BIN`, `CARGO_TARGET_DIR`, or builds on `--build-taxis`. Missing binaries with explicit flags or `--require-taxis` **fail closed** (exit 1; silent skip forbidden).
2. Parity suite executes identical operations in isolated twin repos (`git` baseline vs `taxis.exe`), comparing:
   - Canonical OID hex output for `blob`, `tree` (trailing `/` directory sort order), `commit`, and `tag`;
   - Zlib-decompressed loose object bytes (`<type> <size>\0<payload>`);
   - Reference inspection (`git cat-file -p`, `git ls-tree`, `git fsck --strict --full`).
3. CLI harness (`tests/rust/support/cli_harness.rs`) uses `OnceLock` baseline bare/dev templates for fast isolated test repo cloning without mutating shared fixtures.
