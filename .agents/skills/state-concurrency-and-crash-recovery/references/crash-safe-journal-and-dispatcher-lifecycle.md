# Crash-Safe Atomic Persistence, Idempotent Journal Replay & Dispatcher Teardown

Cross-project patterns for atomic disk persistence, crash-safe RingBuffer + Journal recovery, and deadlock-free async coordinator draining.

---

## 1. Staging + Same-Volume Atomic Rename (`FGT-STO-001` / `DAT-RES-001`)

Direct `fs.writeFile(target, data)` opens with `O_TRUNC` and risks 0-byte corruption on crash mid-write. Always execute four atomic steps:
1. Serialize snapshot payload in memory.
2. Write full buffer + checksum to same-directory staging path (`stagingPath`) and verify `byteLength > 0`.
3. On validation error, unlink `stagingPath` and leave `targetPath` untouched.
4. Execute same-volume atomic `rename(stagingPath -> targetPath)` (cross-volume renames degrade to non-atomic copy+unlink).

---

## 2. RingBuffer + Append-Only Journal Replay (`UUID-REENTRANT-001`)

1. **Dual-write**: Attach monotonic `seqId` (or `checkpointId`) per mutation; append compact NDJSON line to `journalPath`, then advance fixed-slot `RingBuffer` cursor (`(writeCursor + 1) % capacity`) with zero array growth.
2. **Idempotent replay**: On startup read baseline `lastCommittedSeqId`; skip records with `entry.seqId <= lastCommittedSeqId`, and skip/warn on a single crash-truncated tail frame without losing prior valid entries.
3. **Compaction**: Truncate/reset Journal after atomic snapshot checkpoint succeeds (`VSC-MEM-001`).

---

## 3. Three-Stage Coordinator Lifecycle (`ADV-EVT-001` / `PRF-LEAK-001`)

Every background queue, worker pool, or flush timer implements `Active -> Draining -> Terminated`:
- `pump(): number`: Synchronously drains ready queue items in deterministic unit tests.
- `flush(): Promise<void>`: Transitions to `Draining` and awaits all in-flight I/O or worker tasks.
- `teardown(): Promise<void>`: Runs `flush()`, unbinds listeners (`off`), clears intervals, and locks state `Terminated` (subsequent `dispatch()` calls fail explicitly).
