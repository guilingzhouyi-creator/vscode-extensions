---
name: tiered-cache-and-wal-persistence
description: >-
  【触发：cache/flush/torn/oom/WAL/ARC2/L1L2/DAG】Govern L1/L2/L3 caches, ARC2 tail truncation, DAG invalidation, checkpointSync fallbacks, and PID-salted atomic WAL.
---

# tiered-cache-and-wal-persistence — Multi-Tier Incremental Cache, DAG Invalidation & WAL Checkpointing

Governs `L1`/`L2`/`L3` caches, `engineDigest` & `TopologyCacheManager` DAG invalidation, append-only WAL journals (`cache-l1-wal`, `cache-l1-journal`, `cache-l1-checkpoint-worker`), and `SyncIoBarrier` atomic persistence.

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：无（通用方法论） → **本技能** → 无（通用方法论）；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：另 3 个领域支援
- **协作专员**：不委派（主循环内加载；仅上下文污染/真并行/工具面过载时按准入判据委派）
- **何时联动**：Optimize 5-tier Sparse MoE routing and lazy AST projection → `sparse-moe-and-ast-routing` + `algorithmic-operator-engineering` + `tiered-cache-and-wal-persistence`
<!-- SKILL-LINKS:END -->

## 1. Three-Tier Cache & Four-Grade OOM Protection

| Tier / Level | Store / Ratio ($\text{size}/\text{maxL2LoadBytes}$, $64\text{ MiB}$) | Contract & Behavior |
| :--- | :--- | :--- |
| **L1** | `fingerprints.jsonl` | `{ t:'f', p, m:mtimeMs, s:size, i:ino }` — `statSync` hit skips reads & SHA-256 |
| **L2** | `results.jsonl` | `{ t:'r', k:cacheKey, p, issues, metric, ts }` — single-file only; cross-file/10D runs in `reportFinalizer.ts` (`validate-postscan-parity`) |
| **L3** | `paths.jsonl` | Maps normalized `pk` $\to$ `cacheKey` `k` for $O(1)$ hash-free warm lookup |
| **`l2LoadLevel`** | `full` ($\le 0.7$) / `hot` ($\le 1.0$) / `metadata` ($\le 2.0$) / `disabled` ($>2.0$) | All entries $\to$ 7d/`error` only $\to$ keys+metrics only ($>85\%$ heap saved) $\to$ skip with `Logger.warn` |

## 2. `engineDigest` & DAG Reverse-Closure Invalidation

- **Composite Key (`cache-key.ts`)**: $\text{L2Key} = \texttt{"v1:"} + \operatorname{sha256Hex}(\operatorname{canonicalJson}(\text{FingerprintPayload})) + \texttt{":"} + \operatorname{sha256Hex}(\text{fileRawBytes})$; `engineDigest` hashes sorted `dist/analyzers` + `dist/core/ast` modules for zero-command invalidation.
- **DAG `dependedBy` (`TopologyCacheManager`)**: Private edit (`signatureChanged === false`) evicts only `changedFile`; public mutation (`true`) evicts `collectTransitiveDependents` subtree.

## 3. WAL Journals, Backpressure & Atomic Persistence

1. **ARC2 & L1 WAL (`cache-arc2.ts`, `cache-arc2-io.ts`, `cache-l1-journal.ts`)**: `loadArc2L2Container` auto-truncates torn `l2-delta.arwal` tails before append; `flushArc2L2Async` commits `l2-store.arc` + delta cleanup atomically. `flushL1Async` falls back to inline `checkpointSync` on `workerUnavailable` or `WAL_BACKPRESSURE_BYTES`; probes reset `workerUnavailable`.
2. **Daemon & RSS Guard (`server.ts`, `scanHandler.ts`)**: Cap `processIncomingChunk` (16M/32M), honor socket `drain`, call `WorkerPool.rssGuard()` on idle & `handleAsymmetricScan`, expose `lastFlushError`.
3. **PID-Salted Atomic Rename (`cache-persistence.ts` / `GOV-PRF-004` / `FGT-STO-001`)**: Route sync writes via `SyncIoBarrier`; write `${file}.tmp-${process.pid}-${randomHex}`, assert non-zero bytes, `fs.renameSync(stagingPath, file)` with `cleanupStagingFile` in `catch`.

## 4. Verification & JIT Assets

```bash
cd auto-refactor && npm run build && npx vitest run tests/unit/cache-flush-concurrency.test.ts tests/unit/scanner/cache-persistence.test.ts
```

- [multi-tier-cache-and-dag-invalidation.md](references/multi-tier-cache-and-dag-invalidation.md): 12-factor `FingerprintPayload`, `l2LoadLevel` FSM & `TopologyCacheManager` proofs.
- [wal-journal-and-atomic-checkpoint.md](references/wal-journal-and-atomic-checkpoint.md): WAL compaction, flush serialization & POSIX/NTFS atomic rename invariants.
- [atomic-wal-checkpoint-skeleton.ts](templates/atomic-wal-checkpoint-skeleton.ts): Append-only WAL & PID-salted atomic checkpoint scaffold.
