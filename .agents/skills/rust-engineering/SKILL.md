---
name: rust-engineering
description: >-
  Rust 工业级高级编程风格、零成本抽象与强制系统工程规范。指导 Agent 在 fractal-git (Taxis) 及 auto-refactor 原生内核中
  贯彻 Type-State 编译期状态机、零瞬态堆分配复用池 (FGT-PRF-001)、强类型 thiserror 错误拓扑 (FGT-ERR-001)、
  无锁并发与 CAS (FGT-LCK-001)、// SAFETY: 不变式证明 (FGT-SAF-001)、领域常量集中化及 Clippy 零容忍门禁。
---

# rust-engineering — Rust 工业级高级编程风格与系统工程规范

本技能确立了全工作区 Rust 代码库（包括 `fractal-git` 9 大微 Crate 矩阵与 `auto-refactor` 原生内核 `ops-clone`）的高级编程范式、内存安全契约、零瞬态堆分配复用池与工业级门禁标准。指导 Agent 突破语法级编写思维，内化资深系统级软件工程师的高级工程风格与防线意识。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **`fractal-git` (Taxis) 核心与微 Crate 开发**：设计或重构对象存储（`fg-object`）、无锁内存树（`fg-index`）、拓扑与引用（`fg-topology`）、门禁守卫（`fg-gate`）、复用池（`fg-pools`）、存储引擎（`fg-storage`）与算法引擎（`fg-algorithms`）；
2. **`auto-refactor` 原生内核与算子突破**：编写或加速基于 Rust 的词法扫描、AST 转换、Myers Diff SWAR 位并行算子与 N-API 原生导出；
3. **Rust 模块接口与错误处理设计**：定义跨模块公开 API、定义强类型领域错误、重构裸字符串常数或消除运行时 Panic 隐患；
4. **并发控制与无锁数据结构设计**：涉及原子变量（Atomic）、CAS 快照物化、并发无锁索引或线程局部复用池。

---

## 二、 工业级 Rust 七大高级编程范式 (Seven Industrial Rust Paradigms)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   Rust 工业级高级系统工程七大支柱                       │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Type-State 模式 : 将状态机与生命周期编码进类型系统，编译期杜绝非法流转│
│ 2. 错误拓扑分类    : 强类型 enum + thiserror，零无故 unwrap/expect/panic │
│ 3. 零瞬态堆分配    : 借用切片优先，with_capacity 预分配，时代戳复用池   │
│ 4. 无锁并发与 CAS  : 拒绝粗粒度阻塞 Mutex，采用 CAS 快照物化与无锁树   │
│ 5. Unsafe 形式证明 : 最小化 unsafe 作用域，强制每块携带 // SAFETY: 证明│
│ 6. 领域切片常量化  : 严禁裸写伪规则与状态标签，收敛于 constants/ 模块   │
│ 7. 接口契约完备性  : 对外 API 100% Rustdoc 契约，Clippy -D warnings 零容忍│
└────────────────────────────────────────────────────────────────────────┘
```

### 1. 类型状态模式（Type-State Pattern & Zero-Cost State Machine）
- **编译期非法状态拦截**：领域实体的生命周期（如工作区 `Worktree<Uninitialized>` $\to$ `Worktree<Active>`，提案 `Promotion<Staged>` $\to$ `Promotion<Committed>`）必须利用零大小类型（ZST, Zero-Sized Types）与所有权消耗机制建模；
- **所有权消耗转移**：状态流转函数必须声明为 `pub fn promote(self) -> Promotion<Committed>` 消耗 `self`，杜绝调用后旧状态被非法复用；
- **零运行时开销**：通过 `std::marker::PhantomData` 实现标记，编译产物完全擦除状态标记开销，达成零成本抽象。

### 2. 强类型错误拓扑与故障隔离哲学 (`FGT-ERR-001` / `FGT-COR-001`)
- **零生产运行时 Panic 铁律**：除单元测试断言外，生产路径严禁使用 `unwrap()`、`expect()`、`panic!()`、`todo!()` 或 `unimplemented!()`；
- **强类型枚举分类表达**：每个微 Crate 必须在 `error.rs` 中采用 `thiserror::Error` 显式派生具体的领域错误枚举，严禁粗暴退化为 `Box<dyn std::error::Error>` 或 `String`；
- **清晰向上传播**：函数返回值一律包装为 `Result<T, CrateError>`，通过 `?` 运算符优雅向上传播；
- **FFI 与边界故障隔离**：跨 N-API / C-ABI / IPC 守护进程调用边界，必须通过 `std::panic::catch_unwind` 捕获异常，将其转换为明确的错误码返回，严禁让 Rust Panic 跨越外部 ABI 边界导致宿主进程崩溃。

### 3. 热路径零瞬态堆分配与面向数据内存布局 (`FGT-PRF-001` / `FGT-POL-001`)
- **借用切片优先**：公共函数与热路径形参优先采用 `&str`、`&[u8]`、`&[T]` 借用切片，禁止无谓将只读输入转换为具名所有权容器 `String` 或 `Vec<T>`；
- **避免隐式与无谓 Clone**：禁止在循环中无节制调用 `.clone()` 绕过借用检查器；通过生命周期标注或不可变借用传递数据；
- **容量前置预留与原位复用**：已知大小或批量的容器必须使用 `Vec::with_capacity(n)` 或 `String::with_capacity(n)`；
- **复用池与时代戳复位**：跨高频事务生命周期的临时缓冲区，统一经由 `BufferPool`、`WorktreePool` 借用，并由 `buffer.clear()` 归还复用，禁止循环内反复触发系统级内存分配器（`malloc/free`）；
- **缓存亲和紧凑布局**：数据密集型结构体遵循面向数据设计（DoD / SoA），字段按字节对齐从大到小排列（如 `u64 -> u32 -> u16 -> u8`），消除编译器填充（Padding）浪费。

### 4. 并发无锁控制与不可变快照 (`FGT-LCK-001` / `FGT-IDX-001` / `FGT-CAS-001`)
- **消除粗粒度阻塞锁**：在虚拟暂存区和内存索引树中，严禁在热路径长时间持有标准库阻塞 `Mutex`；
- **无锁原子与 CAS 物化**：优先使用 `AtomicU64`、`AtomicBool` 或基于 Compare-And-Swap (CAS) 的无锁原子操作；
- **只读快照物化**：读操作基于不可变数据快照无锁并发读取，写操作通过原子指针置换（Atomic Pointer Swap）发布，保障读写零阻塞互锁。

### 5. `unsafe` 最小化与形式化安全证明 (`FGT-SAF-001`)
- **作用域最小化**：严禁将整个函数或大代码块包裹在 `unsafe` 中；仅将执行底层硬件原语、位转换或裸指针调用的单行语句置于 `unsafe` 块中；
- **强制 `// SAFETY:` 注释证明**：**每一个** `unsafe` 块首行必须紧跟严格的 `// SAFETY:` 注释，详尽证明以下三项不变式：
  1. *有效性证明*：指针来源受控、非空且有效对齐；
  2. *生命周期证明*：所引用的内存区域在解引用期间绝不会被释放或并发修改；
  3. *边界与类型证明*：切片长度或内存字节严格在分配边界之内。

### 6. 领域切片常量集中化与单源防漂移 (`RCFG-RULE-DRIFT`)
- **严禁裸写伪规则与状态标签**：严禁在代码、日志、错误文案中硬编码未在工作区 `rule-catalog.json` 登记的伪规则 ID（如已废弃的 `GUARD-MSG-001` 或 `L3-CONFLICT`）；
- **常量目录收敛于 `constants/`**：Git 协议常数、引用命名空间、性能基准指标、合规规则与终端状态标签（`CliTag`），必须统一定义在 `crates/fg-core/src/constants/` 下，暴露强类型常量供全仓引用；
- **双端镜像等价**：TS 绑定层通过不可变冻结字典（如 `fractal-git/ts/constants.ts`）镜像映射，确保全技术栈常量单源一致。

### 7. 对外 API 完备性与 Clippy 零警告准则 (`FGT-GAT-001`)
- **标准 Trait 派生与实现**：核心数据结构优先派生 `Debug`, `Clone`, `PartialEq`, `Eq`，为领域标识实现 `Display`, `AsRef<[u8]>`, `From/Into`；
- **Rustdoc 契约完备性**：所有公共对外项（`pub fn`, `pub struct`, `pub enum`）必须提供规范的 Rustdoc：
  - 简明说明职责与参数语义；
  - 若函数返回 `Result`，必须包含 `# Errors` 说明所有可能的失败场景；
  - 若包含 panic 边界，必须包含 `# Panics`；
  - 若为 unsafe，必须包含 `# Safety`；
  - 提供可被 `cargo test --doc` 执行的 `# Examples` 代码块；
- **Clippy 零警告一票否决**：全仓强制在编译与门禁中启用 `cargo clippy --all-targets -- -D warnings`，严禁通过大范围滥用 `#[allow(...)]` 隐瞒代码坏味道。

---

## 三、 刚性工程红线与一票否决指标

| 刚性指标 | 一票否决阈值 / 红线禁令 | 权威规则指针 (SSOT) | 违规后果与处理动作 |
| :--- | :--- | :--- | :--- |
| **运行时 Panic** | 生产代码中出现裸 `unwrap()` / `expect()` / `panic!()` | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`FGT-ERR-001`) | 本地门禁与 CI 立即阻断，必须重构为 `Result<T, E>` |
| **裸 Unsafe 块** | `unsafe` 代码块缺失 `// SAFETY:` 形式证明注释 | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`FGT-SAF-001`) | 立即拦截，必须补齐指针有效性与生命周期证明 |
| **循环瞬态堆分配** | 扫描/遍历等热路径出现 `Vec::new` / `clone()` / 循环堆分配 | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`FGT-PRF-001`) | 阻断提交，重构为复用池借用或 `&[u8]` 切片 |
| **阻塞锁争用** | 在虚拟暂存区和内存索引并发路径持有长时间阻塞 Mutex | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`FGT-LCK-001`) | 阻断提交，重构为无锁树或 CAS 快照物化 |
| **未登记伪规则** | 发射或打印未在 `rule-catalog.json` 登记的规则 ID | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`RCFG-RULE-DRIFT`) | 门禁立即阻断，必须使用已登记规则或标准错误枚举 |
| **Clippy 警告** | `cargo clippy` 报告任何 warning | [rule-catalog.json](../../../scripts/common/rule-catalog.json) (`FGT-GAT-001`) | 门禁编译阻断，代码严禁合并 |

---

## 四、 常用验证与基准测试命令

```bash
# 1. 运行 Taxis 完整回归套件与单元测试 (46/46 测试)
cargo test --manifest-path fractal-git/Cargo.toml

# 2. 运行 Clippy 零警告静态门禁
cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings

# 3. 运行微观性能基准回归与 15% 容差棘轮守卫
cargo run --manifest-path fractal-git/Cargo.toml --bin taxis -- bench -m 5 --verify-baseline fractal-git/baselines/taxis-perf.baseline.json

# 4. 运行 Taxis 5 大专属门禁集成自审
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1

# 5. 运行全工作区六大子系统统一审查
pwsh -File scripts/ps1/audit-all.ps1
```

---

## 五、 关联深水区参考与实操样板

- [rust-advanced-patterns.md](references/rust-advanced-patterns.md)：Type-State 模式、无锁原子 CAS 内存序、BCE 边界检查消除与 FFI 异常隔离深水区实践图谱；
- [type-state-zero-alloc-pattern.rs](templates/type-state-zero-alloc-pattern.rs)：工业级 Rust 样板代码（含 Type-State 编译期流转、强类型 `thiserror` 枚举、`// SAFETY:` 形式证明与 `BufferPool` 零分配注入）；
- [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)：跨语言算法第一性原理突破与五步降维协议。
