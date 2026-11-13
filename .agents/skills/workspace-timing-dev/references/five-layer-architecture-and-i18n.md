# `workspace-timing` Five-Layer Architecture, `[DELTA]` Replay & Time Conservation

Reference for the 5-layer unidirectional boundary, 3-tier crash recovery flow, and FIFO session folding conservation in `workspace-timing/`.

---

## 1. Three-Tier Crash Recovery & `[DELTA]` Replay

```text
[L1: In-Memory RingBuffer] ---> [L2: Append-Only Journal ([DELTA] NDJSON)] ---> [L3: stagingUri Atomic Rename]
```

1. **Canonical Domain Names**: Use `stagingUri` (never `tmpPath`/`tempUri`), `segmentedSessions` (never `splitSessions`), and `[DELTA]` Journal prefix.
2. **Startup Replay & Time Conservation**: On activation, load latest checkpoint snapshot, replay deduplicated monotonic `[DELTA]` lines, write compacted snapshot, and truncate Journal. When daily segments exceed `20`, fold older entries FIFO into `dailyTotals` while conserving total tracked time:
   $$\sum_{s \in \text{Sessions}_{\text{raw}}} \text{duration}(s) \equiv \sum_{s \in \text{segmentedSessions}_{\text{active}}} \text{duration}(s) + \sum_{d \in \text{dailyTotals}} \text{dailyTotals}[d]$$

---

## 2. L0–L5 Layered Audit Contract (`scripts/config/review-rules.json`)

| Layer | Key Rules | Enforced Boundary |
| :---: | :--- | :--- |
| **L0** | `L0-COMPILE` / `L0-TEST` | Clean TS compile (`declaration: false`) & 100% passing suite |
| **L1** | `L1-LINT` / `L1-*` | Snapshot guards, crash-safe writes & static quality baseline |
| **L2** | `LAY-CYCLE` / `LAY-IMPORT` | Unidirectional 5 layers, zero cycles, isolated host API |
| **L3** | `HC-UI-STRING` / `HC-ABS-PATH` | 100% bilingual `zh-CN`/`en` parity, zero hardcoded UI strings/paths |
| **L4 / L5** | `TB-REGRESSION` / `ARF-THRESHOLDS` | Suite timing ratchet & zero High/Critical debt regression |
