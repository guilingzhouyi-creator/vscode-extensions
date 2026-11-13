# Seven-Domain Refactoring Patterns & Modern Python Idioms (`PYM-*`)

Reference patterns across naming, typed errors, discriminated unions, minimal exports, DI, testability, and the <!-- METRICS:BEGIN rule-family-pym -->**13 条**<!-- METRICS:END rule-family-pym --> modern Python rules (`PYM-*`).

---

## 1. Core Refactoring Patterns

1. **Naming (`NAM-*`)**: Use `computeXxx`/`deriveXxx` for pure transforms, `applyXxx`/`persistXxx` for effects, `is/has/can` for booleans, and `ruleByFamily` for maps (ban `data`, `res`, `tmp`, `handleData`). Complete renames atomically across declarations, call sites, docs, and tests.
2. **Three-Tier Failure Model (`ERR-*` / `RSM-*`)**: Classify errors as `ValidationError` (recoverable input), `InfrastructureError` (I/O with bounded retries `NUM-BND-001` + idempotency `UUID-REENTRANT-001`), and `InvariantError` (fail fast). Include action, subject, expected, actual, and location (`ERR-MSG-001`).
3. **Exhaustive Narrowing (`TSM-*`)**: Validate untrusted boundaries (`JSON.parse`, env, IPC) once with schemas; consume variants via `switch` + `assertNever(x: never)`; forbid scattered `as` casts and `!`.
4. **Minimal Surface & Dependency Inversion (`DEP-*` / `MOD-*`)**: Ban `export *` and test-only exports; infrastructure (L1) implements interfaces defined by domain (L2) and wired at entry (L4). Never import L2 from L1 (`DEP-INV-001`) or mask cycles with dynamic `import()` (`DEP-LAZ-001` / `import-cycle`).

---

## 2. Modern Python Idioms (`PYM` 13 Rules)

| Concern | Forbidden Legacy Form | Compliant Modern Form | Rule ID |
| :--- | :--- | :--- | :--- |
| **Generics & Unions** | `typing.{List,Dict,Optional,Union}` | `list[int]`, `dict[str, int]`, `X \| None` | `PYM-GENERIC-001`, `PYM-UNION-001` |
| **Abstract Containers** | `from typing import Iterable, Mapping` | `from collections.abc import Iterable, Sequence, Mapping` | `PYM-ABC-001` |
| **Files & Paths** | `f = open(p); f.close()`, `os.path.*` | `with open(p, encoding="utf-8") as f:`, `pathlib.Path` | `PYM-OPEN-001`, `PYM-PATH-001` |
| **UTC & Async I/O** | `datetime.timezone.utc`, blocking `sleep`/`requests` | `datetime.UTC`, `await asyncio.sleep()` / async client | `PYM-DATETIME-001`, `PYM-ASYNC-001` |
| **Defaults & Shadowing** | `def f(items=[])`, naming vars `list`/`id`/`type` | `items: list[str] \| None = None`, non-builtin names | `PYM-DEFAULT-001`, `PYM-SHADOW-001` |
| **Exceptions & Strings** | Bare `raise ValueError(...)`, `%` formatting | `raise CatalogError(...) from err`, `f"{name}: {count}"` | `PYM-RAISE-001`, `PYM-FSTRING-001` |
| **Dataclasses & Imports** | Unslotted `@dataclass`, unsorted imports | `@dataclass(slots=True, frozen=True)`, stdlib/3p/local groups | `PYM-SLOTS-001`, `PYM-IMPORT-001` |
