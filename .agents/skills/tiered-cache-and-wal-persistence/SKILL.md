---
name: tiered-cache-and-wal-persistence
description: >-
  【触发：WAL/L1L2缓存/拓扑失效/指纹校验/异步刷盘/缓存设计/缓存丢失】设计或维护多级增量缓存(L1/L2/L3)、12 因子复合指纹、拓扑反向依赖失效或 WAL 预写日志原子落盘时触发。防御内存溢出与断电半写损坏。
---

# tiered-cache-and-wal-persistence — Multi-Tier Incremental Cache, DAG Invalidation & WAL Checkpointing

Governs multi-tier incremental caching (`L1` stat fingerprints, `L2` graded results, `L3` path forward index), cryptographic `engineDigest` invalidation, DAG `dependedBy` reverse-closure invalidation (`TopologyCacheManager`), append-only WAL journals (`cache-l1-wal`, `cache-l1-journal`), background worker checkpointing (`cache-l1-checkpoint-worker`), and `SyncIoBarrier` atomic persistence.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 3 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：优化稀疏 MoE 路由与多语言惰性投影 → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Three-Tier Cache Architecture & Four-Grade OOM Protection

1. **Physical Separation (`fingerprints.jsonl` / `results.jsonl` / `paths.jsonl`)**:
   - **L1 (`fingerprints.jsonl`)**: Stores `{ t: 'f', p, m: mtimeMs, s: size, i: ino }`. Matching `fs.statSync(filePath)` against L1 bypasses file reads and SHA-256 hashing completely.
   - **L2 (`results.jsonl`)**: Stores `{ t: 'r', k: cacheKey, p, issues, metric, ts }` for context-free single-file issues only. Cross-file cycle checks, baseline ratcheting, and 10D scoring execute post-merge in `reportFinalizer.ts` to guarantee 100% cold/warm byte parity (`validate-postscan-parity`).
   - **L3 (`paths.jsonl`)**: Maps normalized path `pk` to latest `cacheKey` `k` for $O(1)$ hash-free warm lookups.
2. **Four-Grade Dynamic L2 Loader (`l2LoadLevel` in `cache.ts`)**:
   With $\text{LoadRatio} = \operatorname{stat}(\texttt{results.jsonl}).\text{size} / \text{maxL2LoadBytes}$ (default $64\text{ MiB}$):
   - `full` ($\le 0.7$): Load all L2 issues and metrics;
   - `hot` ($0.7 < \text{Ratio} \le 1.0$): Load only entries active within 7 days or containing `severity === 'error'`;
   - `metadata` ($1.0 < \text{Ratio} \le 2.0$): Load keys and metrics only ($> 85\%$ heap savings);
   - `disabled` ($> 2.0$): Skip L2 deserialization with `Logger.warn` to prevent OOM.

---

## 2. Cryptographic `engineDigest` & DAG Reverse-Closure Invalidation

1. **Composite L2 Key & `engineDigest` (`cache-key.ts`)**:
   $$\text{L2Key} = \texttt{"v1:"} + \operatorname{sha256Hex}\big(\operatorname{canonicalJson}(\text{FingerprintPayload})\big) + \texttt{":"} + \operatorname{sha256Hex}(\text{fileRawBytes})$$
   `FingerprintPayload.engineDigest` hashes all compiled modules under `dist/analyzers` and `dist/core/ast` sorted by relative path, guaranteeing zero-command automatic invalidation whenever any analyzer or AST adapter changes.
2. **DAG `dependedBy` Subtree Invalidation (`TopologyCacheManager`)**:
   - **Private Implementation Edit (`signatureChanged === false`)**: Evicts only `changedFile` from L1/L2 topology caches, preserving downstream caller cache hits.
   - **Public Signature Mutation (`signatureChanged === true`)**: Walks `dependedBy` reverse edges via `collectTransitiveDependents` to evict the entire affected downstream subgraph.

---

## 3. Append-Only WAL Journal, Background Worker Checkpointing & Atomic Flush

1. **L1 WAL Journal & Worker Checkpointing (`cache-l1-wal.ts`, `cache-l1-journal.ts`, `cache-l1-checkpoint-worker.ts`)**:
   - High-frequency L1 fingerprint updates append to a lightweight WAL journal without blocking the scan loop (`PRF-IO-001`).
   - When the WAL reaches the compaction threshold, `cache-l1-checkpoint-worker` merges WAL records into the base snapshot off-thread and truncates the journal atomically.
2. **PID-Salted Atomic Rename & `SyncIoBarrier` (`cache-persistence.ts` / `GOV-PRF-004` / `FGT-STO-001`)**:
   - Route synchronous persistence through `SyncIoBarrier`.
   - Write full serialized payloads to `${file}.tmp-${process.pid}-${randomHex}`, verify non-zero bytes, and call `fs.renameSync(stagingPath, file)` with `cleanupStagingFile` in `catch` so concurrent processes never collide or produce 0-byte torn files.

---

## 4. Verification Commands & JIT Assets

```bash
cd auto-refactor && npm run build && npm test
npx vitest run tests/unit/cache-flush-concurrency.test.ts tests/unit/scanner/cache-persistence.test.ts
```

- [multi-tier-cache-and-dag-invalidation.md](references/multi-tier-cache-and-dag-invalidation.md): 12-factor `FingerprintPayload` specification, `l2LoadLevel` state machine, and `TopologyCacheManager` DAG invalidation proofs.
- [wal-journal-and-atomic-checkpoint.md](references/wal-journal-and-atomic-checkpoint.md): WAL append/compaction protocol, concurrent flush serialization, and POSIX/NTFS atomic rename invariants.
- [atomic-wal-checkpoint-skeleton.ts](templates/atomic-wal-checkpoint-skeleton.ts): Reusable TypeScript template for append-only WAL journaling and PID-salted atomic checkpoint compaction.
