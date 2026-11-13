# {Topic Title} Deep Architecture & Implementation Reference

## 1. Context & Design Motivation

Explain the root constraint, failure hazard, or scaling bottleneck addressed by this specification.

## 2. Core Algorithm & Invariant Bounds

State formal preconditions, time/space complexity bounds, and state-transition invariants.

## 3. Anti-Patterns & Refactoring Targets

| Anti-Pattern | Failure Risk | Compliant Alternative |
| :--- | :--- | :--- |
| `<anti-pattern>` | Leak, race, or silent corruption | Bounded state machine / pure transform |

## 4. Cross-Platform Portability

Document Windows (`pwsh`) and Linux/macOS (`bash`) semantic differences and fail-closed guards.
