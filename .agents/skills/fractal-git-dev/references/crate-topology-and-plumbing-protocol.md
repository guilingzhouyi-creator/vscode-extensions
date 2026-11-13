# Taxis 10-Crate Topology, Multi-Hash Plumbing & CCD v2 Protocol

Engineering specification for `fractal-git` crate boundaries, Git Plumbing wire/disk framing, and CCD v2 poset conflict resolution.

---

## 1. Ten-Crate Responsibility & Boundary Matrix (`FGT-TOP-001` / `FGT-DEP-001`)

1. **`fg-core`**: Variable multi-hash `Oid` (`Sha1(20)` / `Sha256(32)` / `Sm3(32)` lossless serialization, zero `unsafe`), typed `FractalError`, and SSOT `constants/` (`37` `FGT-*` rules); zero file I/O or locks.
2. **`fg-object`**: Zero-copy Blob/Tree/Commit/Tag codec; sort `Tree` entries with implicit trailing `0x2F` (`/`) on directories.
3. **`fg-pools`**: Epoch-counted `BufferPool`, `WorktreePool` (monotonic `epoch`, `Path::components` traversal guards, idempotent `SandboxPool::release`), and upfront size-checked `ByteLruCache` (`FGT-PRF-001`).
4. **`fg-index`**: Big-endian `.git/index` (`DIRC` v2/v3) binary codec and lock-free `InMemoryIndexTree`.
5. **`fg-storage`**: Atomic loose ODB (`temp -> fsync -> rename`), windowed `PackWindowReader` with `checked_add` (`FGT-STO-001`), WAL, TIPSE, and decoupled `projection/{refs,index,export,import,tests}.rs`.
6. **`fg-algorithms`**: 64-bit SWAR line scan, Myers/Histogram diff, Kirsch-Mitzenmacher Bloom filters, 5D `eloc_5d`, and CCD v2 poset operators (`FGT-ALG-001`).
7. **`fg-topology`**: Commit DAG reachability, `refs/fractal/*` hierarchy, and Cell virtual worktree topology.
8. **`fg-transport`**: Binary pkt-line/sideband codec and Smart v2 negotiation parser (`test_multihash_and_transport.rs`).
9. **`fg-gate`**: `37`-rule kernel gate verifier (TKCV/IKCE, `git_hook/{config,shell,process}.rs`, zero panics, 3-part `// SAFETY:`, `FGT-GAT-001`).
10. **`fg-native`**: FFI/N-API `cdylib` boundary wrapped in `std::panic::catch_unwind`, TAXC container codecs, and `NativeContainerContract` (`FGT-BRG-001`).

---

## 2. Git Plumbing Binary Framing (`FGT-OBJ-001` / `FGT-IDX-001`)

- **Loose Object**: $\text{ZlibDeflate}(\text{ASCII}(\text{kind}) \parallel \texttt{0x20} \parallel \text{ASCII}(\text{len}) \parallel \texttt{0x00} \parallel \text{payload})$, hashed over uncompressed bytes, atomically renamed into `.git/objects/<hex[0..2]>/<hex[2..]>`.
- **Tree Entry**: $\text{ASCII}(\text{octal\_mode}) \parallel \texttt{0x20} \parallel \text{name} \parallel \texttt{0x00} \parallel \text{raw\_oid}$, using unpadded octal modes (`100644`, `100755`, `40000`).

---

## 3. Three-Tier CCD v2 Conflict Funnel (`FGT-COR-001`)

1. **L1 Bloom Filter ($< 5\mu\text{s}$)**: Bitwise intersect 256-bit path filters ($B_A \mathbin{\&} B_B == 0 \implies$ disjoint $O(1)$ tree merge).
2. **L2 Poset Homomorphism**: Compare diff intervals $[l_i, r_i)$ vs common ancestor $S_0$; strictly non-overlapping edits with $\ge 2$-line margin commute ($\Delta_A \circ \Delta_B = \Delta_B \circ \Delta_A$) and auto-merge.
3. **L3A Escalation**: Abort speculative merge on touching/overlapping hunks and emit structured ancestor-anchored conflict slices.
