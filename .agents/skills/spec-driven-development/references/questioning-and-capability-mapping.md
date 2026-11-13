# Reverse Smart Questioning, Design Checklist & Five-Layer Capability Mapping

Reference combining Reverse ESR questioning, domain interrogation dimensions, and 5-layer unidirectional capability mapping.

---

## 1. Reverse Smart Questioning Protocol

| Principle | Agent Internalization |
| :--- | :--- |
| **Solve X, not brittle Y** | When requests prescribe fragile/layer-breaking mechanics (Y), uncover goal (X) and propose clean options |
| **Symptoms over guesses** | Collect 4-tuple: environment, trigger input, expected behavior, exact failure trace |
| **Minimal Reproducible Example** | Confirm edge cases with smallest deterministic fixture before implementation |
| **Single-point questioning** | Ask one blocking decision per turn with 2–3 choices and a `(Recommended)` option |

---

## 2. Core Design Interrogation Axes

1. **Surface & Intrusiveness**: Direct API / CLI / daemon IPC / UI affordance; non-blocking updates vs modal interruptions; never steal editor focus in background tasks.
2. **Storage & Scope**: Global vs workspace isolation; retention/eviction TTL; crash-safe atomic write (`.tmp -> rename`) + Append-Only Journal replay.
3. **Scale & Budget**: Monorepo caps (`>50,000` files -> honor `.gitignore`), `O(1)` short-circuits, pooled loop allocations (`ADV-PRF-002`).

---

## 3. Five-Layer Unidirectional Capability Topology

Upper layers may depend downward only; reverse imports violate `DEP-INV-001`:

| Layer | Role | `workspace-timing` | `WebGames` / `fractal-git` |
| :---: | :--- | :--- | :--- |
| **L1** | **Shared / Contract**: Types, constants, i18n keys, typed errors | `shared/` | `fg-core` / `config/domains/` |
| **L2** | **Persistence / Storage**: File I/O, RingBuffer, Journal, CAS ODB | `storage/` | `fg-storage` / disk repositories |
| **L3** | **Core / Engine**: Pure algorithms, state machines, offline-testable | `engine/` | `fg-algorithms` / headless domain solvers |
| **L4** | **Application / Controller**: Lifecycle hooks, debouncing, async drain | `controller/` | `taxis_cmd` / session coordinators |
| **L5** | **Interface / Presentation**: CLI, Webview panels, one-way HUD snapshots | `ui/` | `frontend/views/` (`apply_snapshot` only) |
