---
name: rust-engineering
description: >-
  【触发：Rust/Cargo/unsafe/无锁/Clippy/编写Rust/panic】编写或重构 Rust 代码时必须触发。全面贯彻 Type-State 状态机、零瞬态堆分配(FGT-PRF-001)、thiserror 强类型错误、// SAFETY: 严格证明及 Clippy 零容忍门禁。
---

# rust-engineering — Rust 工业级高级编程风格与资深系统工程规范

本技能确立全工作区 Rust 代码库（`fractal-git` 10 大微 Crate 与 `auto-refactor` 原生内核 6 大 Crate：`auto-refactor-core`、`ops-diff`、`ops-graph`、`ops-pattern`、`ops-mask`、`ops-clone`）的**八大资深系统工程支柱**与 **Rust 专属规则矩阵**（涵盖 `FGT-*`、`RSM-*` 与 `STDLIB-*` 规则族），指导 Agent 跳出语法搬运思维，以资深系统级 Rust 架构师标准编写零成本抽象、零瞬态分配与编译期状态闭合代码。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 分形版本控制内核（链上第 2 步）；自动重构内核（链上第 2 步） |
| **前置** | [fractal-git-dev](../fractal-git-dev/SKILL.md)、[auto-refactor-dev](../auto-refactor-dev/SKILL.md) |
| **接续** | [state-concurrency-and-crash-recovery](../state-concurrency-and-crash-recovery/SKILL.md)、[algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md) |
| **并行支援** | [coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md)、[debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md) |
| **领域链** | 分形版本控制内核：fractal-git-dev → rust-engineering → state-concurrency-and-crash-recovery → algorithmic-operator-engineering → test-benchmark-engineering；其余领域链见 `docs/skill-catalog.md` |

**何时联动**：新增或修改 taxis 子命令 → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis 输出与 git 逐字节不一致 → `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

1. **`fractal-git` (Taxis) 10 大微 Crate 与 CLI 研发**：开发 `fg-core`、`fg-object`、`fg-pools`、`fg-index`、`fg-storage`、`fg-algorithms`、`fg-topology`、`fg-transport`、`fg-gate`、`fg-native` 及 `src/bin/taxis`；
2. **`auto-refactor` 原生算子内核开发**：编写或优化词法扫描、SWAR 位并行 Myers Diff、AST 模式匹配、克隆检测与 N-API 桥接；
3. **Rust 代码重构与静态审查**：消除 `unwrap`/`panic!`、热路径堆分配、锁争用、深层 `if let` 嵌套、裸 `as` 强转或补齐 `// SAFETY:` 证明。

---

## 二、 资深工业级 Rust 八大编程范式与系统级规则闭环

| 支柱域 | 资深 Rust 工程刚性契约 | 严禁反模式（命中即阻断） | 绑定 SSOT 规则族 |
| :--- | :--- | :--- | :--- |
| **1. Type-State、Newtype 与 Sealed Trait** | 状态机以 `PhantomData<S>` + 消耗性转移 `fn promote(self) -> T<Next>` 编码进类型系统；领域 ID 用 `#[repr(transparent)]` Newtype；闭集特征用 `private::Sealed`；公开枚举加 `#[non_exhaustive]`，可失败/纯函数加 `#[must_use]` | 用布尔/字符串表示生命周期状态、原始整数混用 ID、状态迁移后旧句柄仍可调用 | `FGT-COR-001`、`FGT-TRN-001` |
| **2. 强类型错误拓扑与零 Panic** | 每个微 Crate 用 `#[derive(Debug, thiserror::Error)]` 建独立错误枚举并保留 `#[source]`/`#[from]`；通过 `?` 传播；FFI/N-API 边界强制 `std::panic::catch_unwind` 隔离 | 生产路径裸 `unwrap()`/`expect()`/`panic!`/`todo!`/`unimplemented!`/`unreachable!`、退化为 `String` 错误、废弃 `try!`/`extern crate`/`#[macro_use]` | `FGT-ERR-001`、`RSM-PNC-001`、`RSM-UNWRAP-001`、`RSM-EXP-001`、`RSM-TRY-001`、`RSM-EXTERN-001`、`RSM-MACRO-001`、`STDLIB-PANIC-001` |
| **3. 借用签名与热路径零堆分配** | 形参一律用 `&str`、`&[u8]`、`&[T]`、`AsRef<Path>`；条件转义用 `Cow<'_, str>`；循环体缓冲区经 `BufferPool` RAII 守卫借还并 `clear()` 复用容量；高频结构体按对齐降序排列字段（SoA/DoD） | 函数签名写 `&String`/`&Vec<T>`、仅为比较/求长调用 `.clone()`、循环内 `Vec::new()`/`format!`/`.to_string()`/`.to_owned()` | `FGT-PRF-001`、`FGT-POL-001`、`RSM-STR-001`、`RSM-CLONE-001`、`STDLIB-ALLOC-001` |
| **4. 卫语句 `let-else` 与组合子平铺** | 单分支解构早退强制用 `let Some(x) = expr else { return ...; }`；同构枚举分支用 `A { id, .. } \| B { id, .. }` 合流；查找过滤用 `.iter().find()`/`.any()`；格式化用内联捕获 `format!("{a}:{b}")` | 深层 `if let` 阶梯致 $\text{Depth}>4$、手写 `for` 早退查找循环、位置占位符 `format!("{}{}", a, b)` | `RSM-ELSE-001`、`RSM-FIND-001`、`RSM-FORMAT-001`、`FGT-GAT-001` |
| **5. 数值安全、恒定时间与有界递归** | 窄化或跨符号转换用 `TryFrom::try_from`、`saturating_*` 或 `checked_*`；哈希/令牌校验用常量时间比较；树/DAG 遍历用显式栈或带 `max_depth` 守卫；`#[cfg]` 必带非目标平台回退 | 裸 `as` 数值截断强转、短路比较泄露哈希时序、无界深递归、缺失 fallback 的平台 `#[cfg]` | `RSM-CAST-001`、`STDLIB-CONST-001`、`STDLIB-RECURSION-001`、`STDLIB-PORT-001` |
| **6. 无锁 CAS 世代防 ABA 与异步锁纪律** | 内存索引与暂存热路径用 `AtomicU64`/`AtomicPtr` + 世代号（Epoch）`compare_exchange(Ordering::AcqRel, Ordering::Acquire)`；`async fn` 必须在 `.await` 前通过块作用域显式释放同步锁守卫 | 热路径持阻塞 `Mutex`/`RwLock`、CAS 循环无世代号防 ABA、跨 `.await` 持有 `MutexGuard` | `FGT-LCK-001`、`FGT-CAS-001`、`FGT-IDX-001`、`RSM-LOCK-001` |
| **7. `unsafe` 最小化与三段式证明** | 仅单条底层原语入 `unsafe` 块；每处 `unsafe` 块与 `unsafe fn` 前必须附 `// SAFETY:` 证明：① 指针非空与对齐；② 生命周期与独占无并发别名；③ 偏移与长度在分配边界内 | 大函数整体标 `unsafe`、缺失 `// SAFETY:` 注释、复述函数名充当伪证明 | `FGT-SAF-001`、`RSM-SAF-001`、`STDLIB-UNSAFE-001` |
| **8. 常量单源、Rustdoc 与 Clippy 零告警** | 协议常数与规则 ID 收敛于 `fg-core::constants`；对外 `pub` 项 100% 附 `///` Rustdoc（含 `# Errors`/`# Safety`/`# Examples`）；门面实质承载 | 硬编码未登记伪规则 ID、公共项缺 `///` 文档、门面 $\le 3$ 行空壳转发、滥用 `#[allow(...)]` | `RCFG-RULE-DRIFT`、`FGT-FAC-001`、`FGT-DEP-001`、`FGT-TOP-001`、`FGT-OBJ-001`、`FGT-STO-001`、`FGT-ALG-001`、`FGT-BRG-001` |

---

## 三、 本地预审与门禁验证命令

```powershell
# 1. 运行伴生静态合规守卫（零 Panic、// SAFETY:、零 &String 形参、SSOT 规则闭包与自证探针）
node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js

# 2. 运行 fractal-git 零分配与 Rustdoc/命名边界扫描
node fractal-git/scripts/common/check-zero-alloc-boundary.js

# 3. 运行 rustfmt 格式检查、Clippy 零警告门禁与全量测试
cargo fmt --all --manifest-path fractal-git/Cargo.toml -- --check
cargo clippy --workspace --all-targets --manifest-path fractal-git/Cargo.toml -- -D warnings
cargo test --workspace --manifest-path fractal-git/Cargo.toml

# 4. 运行 Taxis 专属全套门禁审计
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

---

## 四、 关联深水区参考、实操样板与伴生脚本

- [rust-advanced-patterns.md](references/rust-advanced-patterns.md)：Type-State + Sealed Trait + Newtype、RAII 复用池、SWAR/BCE 边界检查消除、CAS 内存序、`RSM-*` 现代改写范式与 FFI `catch_unwind` 实战图谱；
- [type-state-zero-alloc-pattern.rs](templates/type-state-zero-alloc-pattern.rs)：集成 `#[repr(transparent)]` Newtype、Sealed Trait、Type-State、`#[must_use]`、`thiserror` 与 `// SAFETY:` 三段式证明的工业级样板；
- [validate-rust-conformance.js](scripts/validate-rust-conformance.js)：内置 `runSelfProbes()` 自证探针的 Rust 静态合规校验器（覆盖 `fractal-git` 与 `auto-refactor/crates`）；
- [fractal-git-dev](../fractal-git-dev/SKILL.md) · [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)：Taxis 10 微 Crate 拓扑与算法第一性原理突破规范。
