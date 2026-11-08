---
name: rust-engineering
description: >-
  【触发：Rust/Cargo/unsafe/无锁/Clippy/编写Rust/panic】编写或重构 Rust 代码时必须触发。全面贯彻 Type-State 状态机、零瞬态堆分配(FGT-PRF-001)、thiserror 强类型错误、// SAFETY: 严格证明及 Clippy 零容忍门禁。
---

# rust-engineering — Production Rust Systems Engineering & Zero-Cost Abstraction Contract

Governs all workspace Rust crates (`fractal-git` 10 kernel crates and `auto-refactor/crates` native operator crates) across 8 systems engineering pillars and the `FGT-*`, `RSM-*`, and `STDLIB-*` rule families.

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[fractal-git-dev](../fractal-git-dev/SKILL.md)、[praxis-vfs-and-trajectory-learning](../praxis-vfs-and-trajectory-learning/SKILL.md) → **本技能** → [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)；并行支援 `coding-craft`、`complexity-budget`、`constraint-driven-development`、`debugging-and-error-recovery`。
- **领域**：分形版本控制内核（链上第 2 步）；其余 1 条领域链见 `docs/skill-catalog.md`
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：新增或修改 taxis 子命令 → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；精简模块导出面与消除空门面 → `fractal-git-dev` + `facade-discipline` + `rust-engineering`
<!-- SKILL-LINKS:END -->

## 1. Eight Pillars of Production Rust Systems Engineering

| Pillar | Mandatory Engineering Contract | Blocked Anti-Patterns | Catalog Rules |
| :--- | :--- | :--- | :--- |
| **1. Type-State, Newtype & Sealed Traits** | Encode state transitions via `PhantomData<S>` + consuming `fn promote(self) -> T<Next>`; wrap domain IDs in `#[repr(transparent)]` Newtypes; seal closed traits via `private::Sealed`; annotate public enums `#[non_exhaustive]` and pure/fallible fns `#[must_use]` | Boolean/string state flags, raw integer ID mixing, reusable stale handles after state transition | `FGT-COR-001`, `FGT-TRN-001` |
| **2. Typed Error Hierarchy & Zero Panic** | Per-subsystem `#[derive(Debug, thiserror::Error)]` enums preserving `#[source]`/`#[from]`; propagate with `?`; isolate FFI/N-API boundaries with `std::panic::catch_unwind` | Production `unwrap()`/`expect()`/`panic!`/`todo!`/`unimplemented!`/`unreachable!`, `String` errors, legacy `try!`/`extern crate`/`#[macro_use]` | `FGT-ERR-001`, `RSM-PNC-001`, `RSM-UNWRAP-001`, `RSM-EXP-001`, `RSM-TRY-001`, `RSM-EXTERN-001`, `RSM-MACRO-001`, `STDLIB-PANIC-001` |
| **3. Borrowed Signatures & Zero Loop Alloc** | Accept `&str`, `&[u8]`, `&[T]`, `AsRef<Path>`; use `Cow<'_, str>` for conditional escaping; borrow/return loop buffers from `BufferPool` RAII guards with `.clear()`; order struct fields by descending alignment | `&String`/`&Vec<T>` params, `.clone()` for comparison/length, loop-body `Vec::new()`/`format!`/`.to_string()`/`.to_owned()` | `FGT-PRF-001`, `FGT-POL-001`, `RSM-STR-001`, `RSM-CLONE-001`, `STDLIB-ALLOC-001` |
| **4. `let-else` Guards & Combinators** | Flatten early returns via `let Some(x) = expr else { return ...; }`; merge isomorphic enum arms `A { id, .. } \| B { id, .. }`; use `.iter().find()`/`.any()`; inline format captures `format!("{a}:{b}")` | Deep `if let` ladders ($\text{Depth}>4$), manual `for` search loops, positional `format!("{}{}", a, b)` | `RSM-ELSE-001`, `RSM-FIND-001`, `RSM-FORMAT-001`, `FGT-GAT-001` |
| **5. Checked Casts, Constant-Time & Bounded Recursion** | Use `TryFrom::try_from`, `saturating_*`, or `checked_*` for narrowing/signedness conversions; constant-time digest comparison; explicit stack or `max_depth` on DAG/tree walks; fallback arm for every `#[cfg]` | Bare narrowing `as` casts, short-circuit hash comparison, unbounded recursion, `#[cfg]` without fallback | `RSM-CAST-001`, `STDLIB-CONST-001`, `STDLIB-RECURSION-001`, `STDLIB-PORT-001` |
| **6. Lock-Free CAS Epoch & Async Lock Discipline** | Use `AtomicU64`/`AtomicPtr` + epoch counter `compare_exchange(Ordering::AcqRel, Ordering::Acquire)` on index/staging hot paths; drop synchronous `MutexGuard` in an inner block before `.await` | Coarse `Mutex`/`RwLock` on hot paths, CAS without ABA epoch, holding `MutexGuard` across `.await` | `FGT-LCK-001`, `FGT-CAS-001`, `FGT-IDX-001`, `RSM-LOCK-001` |
| **7. Minimal `unsafe` & 3-Part `// SAFETY:` Proof** | Restrict `unsafe` blocks to minimal primitive operations; precede every `unsafe` block and `unsafe fn` with a `// SAFETY:` proof covering: ① non-null & alignment, ② lifetime & aliasing exclusivity, ③ in-bounds offset/length | Marking entire functions `unsafe` needlessly, missing or tautological `// SAFETY:` comments | `FGT-SAF-001`, `RSM-SAF-001`, `STDLIB-UNSAFE-001` |
| **8. Single-Source Constants, Rustdoc & Clippy `-D warnings`** | Centralize constants in `fg-core::constants`; document `pub` items with `///` (`# Errors`, `# Safety`, `# Examples`); ensure substantive crate facades (`FGT-FAC-001` floor) | Unregistered rule IDs, undocumented `pub` APIs, $\le 3$-line trampoline `lib.rs`, blanket `#[allow(...)]` | `RCFG-RULE-DRIFT`, `FGT-FAC-001`, `FGT-DEP-001`, `FGT-TOP-001`, `FGT-OBJ-001`, `FGT-STO-001`, `FGT-ALG-001`, `FGT-BRG-001` |

---

## 2. Verification Commands

```powershell
node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js
node fractal-git/scripts/common/check-zero-alloc-boundary.js
cargo fmt --all --manifest-path fractal-git/Cargo.toml -- --check
cargo clippy --workspace --all-targets --manifest-path fractal-git/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path fractal-git/Cargo.toml
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

---

## 3. JIT References, Templates & Companion Scripts

- [rust-advanced-patterns.md](references/rust-advanced-patterns.md): Type-State + Sealed Trait + Newtype, RAII buffer pools, SWAR/BCE bounds-check elimination, CAS memory orderings, `RSM-*` rewrites, and FFI `catch_unwind`.
- [type-state-zero-alloc-pattern.rs](templates/type-state-zero-alloc-pattern.rs): Production template with `#[repr(transparent)]`, Sealed Trait, Type-State, `#[must_use]`, `thiserror`, and 3-part `// SAFETY:` proofs.
- [validate-rust-conformance.js](scripts/validate-rust-conformance.js): Static Rust conformance guard with built-in `runSelfProbes()`.
- [fractal-git-dev](../fractal-git-dev/SKILL.md) · [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md): Taxis 10-crate topology and first-principles operator patterns.
