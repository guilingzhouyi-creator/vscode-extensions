# Feature Specification & Decision Record: [Module / Feature Name]

## 1. Scope, Problem Statement & Decisions
- **Problem & Value**: Concise summary of the constraint solved and measurable deliverable.
- **Boundaries**:
  - **In Scope**: Explicitly included interfaces and workflows.
  - **Out of Scope**: Deferred items and excluded surfaces.
- **Decision Log**:
  | # | Decision Axis | Options Considered | Locked Choice |
  | :--- | :--- | :--- | :--- |
  | 1 | Surface & intrusiveness | A. Non-blocking status update (Recommended) / B. Modal dialog | Adopt A |
  | 2 | State & crash recovery | A. Append-only workspace Journal (Recommended) / B. Memory only | Adopt A |

## 2. Architecture & Five-Layer Placement
- **Subsystem**: `auto-refactor` | `workspace-timing` | `WebGames` | `fractal-git` | `scripts`
- **Layer**: L1 Contract / L2 Storage / L3 Core / L4 Controller / L5 Interface
- **Dependency Boundary**: Downstream interfaces consumed and minimal exported symbol set (plus activation events/i18n keys if host-facing).

## 3. Data Model & Interface Contracts
```typescript
export interface FeatureTaskPayload {
  readonly id: string;
  readonly timestampMs: number;
  readonly intervalMs: number;
}
```

## 4. Negative Space, Recovery & Resource Budgets
- **Degenerate short-circuits**: Fast paths for empty input, `>1500`-line files, and timeouts.
- **Atomic writes & teardown**: Staging (`.tmp -> rename`) plus symmetric `flush()`/`dispose()`.
- **Complexity & memory**: $\text{CC} \le 15$, $\text{Depth} \le 4$, zero loop heap allocs (`CPX-SPACE-001`).

## 5. Falsifiable Acceptance Matrix
| Case ID | Class | Preconditions (Fixed Clock/Seed) | Expected Assertion |
| :--- | :--- | :--- | :--- |
| TC-SPEC-001 | Nominal | Valid input payload | Deterministic transition matching contract |
| TC-SPEC-002 | Boundary | Empty / out-of-range / truncated tail | Clean rejection or tail healing; deterministic error |
| TC-SPEC-003 | Fault / Replay | I/O timeout or crash replay | Idempotent recovery with zero uncaught throws |
