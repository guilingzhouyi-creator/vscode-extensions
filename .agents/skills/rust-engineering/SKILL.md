---
name: rust-engineering
description: >-
  【触发：unwrap/build/panic/leak/Rust/Cargo/Clippy/unsafe】Enforce Type-State, thiserror errors, zero panics/loop alloc, 3-part // SAFETY: proofs, and Clippy -D warnings.
---

# rust-engineering — Production Rust Systems Engineering & Zero-Cost Abstraction Contract

Governs `fractal-git` (10 crates) and `auto-refactor/crates` native crates across 8 pillars (`FGT-*`, `RSM-*`, `STDLIB-*`).

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[taxis-daemon-and-agent-control](../taxis-daemon-and-agent-control/SKILL.md)、[praxis-vfs-and-trajectory-learning](../praxis-vfs-and-trajectory-learning/SKILL.md) → **本技能** → [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：Fractal-Git Kernel（链上第 3 步）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：Add or update taxis CLI subcommands and plumbing → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；Enrich thin crate facades and eliminate trampolines → `fractal-git-dev` + `facade-discipline` + `rust-engineering`
<!-- SKILL-LINKS:END -->

## 1. Eight Pillars of Production Rust Engineering

| Pillar | Mandatory Contract | Blocked Anti-Patterns | Rules |
| :--- | :--- | :--- | :--- |
| **1. Type-State & Sealed** | `PhantomData<S>` + consuming `promote(self) -> T<Next>`; `#[repr(transparent)]` Newtypes; `private::Sealed`; `#[non_exhaustive]`, `#[must_use]` | Bool/string state flags, raw ID mixing, stale handle reuse | `FGT-COR-001`, `FGT-TRN-001` |
| **2. Typed Errors & 0 Panic** | `#[derive(Debug, thiserror::Error)]` (`#[source]`/`#[from]`), `?`, FFI `std::panic::catch_unwind` | Prod `unwrap`/`expect`/`panic!`/`todo!`/`unimplemented!`/`unreachable!`, `String` errs, `try!`/`extern crate`/`#[macro_use]` | `FGT-ERR-001`, `RSM-PNC-001`, `RSM-UNWRAP-001`, `RSM-EXP-001`, `RSM-TRY-001`, `RSM-EXTERN-001`, `RSM-MACRO-001`, `STDLIB-PANIC-001` |
| **3. Borrow & 0 Loop Alloc** | `&str`/`&[u8]`/`&[T]`/`AsRef<Path>`, `Cow<'_, str>`, `BufferPool` RAII `.clear()`, descending field alignment | `&String`/`&Vec<T>`, `.clone()` for cmp/len, loop `Vec::new()`/`format!`/`.to_string()`/`.to_owned()` | `FGT-PRF-001`, `FGT-POL-001`, `RSM-STR-001`, `RSM-CLONE-001`, `STDLIB-ALLOC-001` |
| **4. `let-else` & Combinators** | `let Some(x) = expr else { ... };`, merged `A { id, .. } \| B { id, .. }`, `.iter().find()`/`.any()`, `format!("{a}:{b}")` | Deep `if let` ($\text{Depth}>4$), manual search loops, positional `format!` | `RSM-ELSE-001`, `RSM-FIND-001`, `RSM-FORMAT-001`, `FGT-GAT-001` |
| **5. Safe Casts & Recursion** | `TryFrom`/`saturating_*`/`checked_*`, constant-time digest eq, explicit stack or `max_depth`, `#[cfg]` fallback | Narrowing `as`, short-circuit hash eq, unbounded recursion, bare `#[cfg]` | `RSM-CAST-001`, `STDLIB-CONST-001`, `STDLIB-RECURSION-001`, `STDLIB-PORT-001` |
| **6. Lock-Free CAS & Async** | `AtomicU64`/`AtomicPtr` + epoch `compare_exchange(AcqRel, Acquire)`; drop `MutexGuard` before `.await` | Hot `Mutex`/`RwLock`, ABA-unsafe CAS, `MutexGuard` across `.await` | `FGT-LCK-001`, `FGT-CAS-001`, `FGT-IDX-001`, `RSM-LOCK-001` |
| **7. 3-Part `// SAFETY:`** | Minimal `unsafe` blocks; `// SAFETY:` proving ① non-null & alignment, ② lifetime & aliasing, ③ bounds | Whole-fn `unsafe`, missing/tautological `// SAFETY:` | `FGT-SAF-001`, `RSM-SAF-001`, `STDLIB-UNSAFE-001` |
| **8. SSOT, Docs & Clippy** | `fg-core::constants`, `pub` `///` (`# Errors`, `# Safety`, `# Examples`), substantive facades (`FGT-FAC-001`) | Unregistered rules, missing `///`, $\le 3$-line trampoline `lib.rs`, blanket `#[allow]` | `RCFG-RULE-DRIFT`, `FGT-FAC-001`, `FGT-DEP-001`, `FGT-TOP-001`, `FGT-OBJ-001`, `FGT-STO-001`, `FGT-ALG-001`, `FGT-BRG-001` |

---

## 2. Verification & JIT Assets

```powershell
node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js
node fractal-git/scripts/common/check-zero-alloc-boundary.js
cargo fmt --all --manifest-path fractal-git/Cargo.toml -- --check && cargo clippy --workspace --all-targets --manifest-path fractal-git/Cargo.toml -- -D warnings && cargo test --workspace --manifest-path fractal-git/Cargo.toml
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [rust-advanced-patterns.md](references/rust-advanced-patterns.md): Type-State/Sealed/Newtype, `BufferPool`, SWAR/BCE, CAS orderings, `RSM-*` rewrites & FFI `catch_unwind`.
- [type-state-zero-alloc-pattern.rs](templates/type-state-zero-alloc-pattern.rs): `#[repr(transparent)]`, Sealed Trait, Type-State, `#[must_use]`, `thiserror` & 3-part `// SAFETY:` scaffold.
- [validate-rust-conformance.js](scripts/validate-rust-conformance.js): Static Rust conformance guard with `runSelfProbes()`.
- [fractal-git-dev](../fractal-git-dev/SKILL.md) · [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md): 10-crate topology & hot-path operator patterns.
