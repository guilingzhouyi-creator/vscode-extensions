---
name: fractal-git-dev
description: >-
  fractal-git (Taxis) 分形版本控制内核、10 微 Crate 分层拓扑与无锁 CAS 开发规范。指导 Agent 维护
  Git Plumbing 二进制等价性 (FGT-ALG-001)、偏序集同态冲突检测 (CCD v2)、无锁索引树 (FGT-LCK-001) 与双端门面。
---

# fractal-git-dev — Taxis 分形 Git 高性能版本控制内核开发规范

本技能是 `fractal-git/`（Taxis 分形版本控制内核）的专属架构与研发规范，确立了 10 大微 Crate 严格单向拓扑、Git Plumbing 二进制协议 100% 字节等价、偏序集同态交换冲突检测（CCD v2）、Cell 虚拟工作树无锁 CAS 快照物化、时代戳复用池（`fg-pools`）与 Rust $\leftrightarrow$ TypeScript 门面桥接标准。

> 通用 Rust 语言级范式（Type-State、`thiserror`、`// SAFETY:` 证明）请同步遵循 [rust-engineering](../rust-engineering/SKILL.md)。

---

## 一、 适用场景与触发条件

在以下任一研发或审查场景中，必须激活本技能：
1. **修改或新增 `fractal-git/crates/` 下的 10 大微 Crate 源码**；
2. **实现或优化 Git Plumbing 协议与存储算子**（Loose Object、DIRC 索引、Packfile、Tree Diff、Commit Graph）；
3. **开发多智能体 Cell 虚拟工作树、并发暂存区或偏序集同态冲突检测（CCD v2）**；
4. **维护 `fractal-git/src/bin/` 原生命令层（`taxis` CLI）或 `fractal-git/ts/` TypeScript 门面层**；
5. **排查 `fractal-git` 专属门禁（<!-- METRICS:BEGIN rule-fractal-git -->**17 条规则**<!-- METRICS:END rule-fractal-git -->，`FGT-*`）与 Scion 对标基准回归**。

---

## 二、 10 大微 Crate 四层单向拓扑契约 (`FGT-TOP-001` / `FGT-DEP-001`)

`fractal-git` 严禁单体大泥球设计，全内核拆分为职责正交的 10 个微 Crate，依赖箭头必须严格自上而下，零循环依赖：

| 拓扑层级 | 微 Crate 名称 | 核心职责与领域边界 | 允许依赖的下层 Crate |
| :--- | :--- | :--- | :--- |
| **Layer 0: 领域原语层** | `fg-core` | OID 哈希原语、强类型错误枚举、全局 SSOT 常量（`constants/`）、类型状态标记 | 零内部 Crate 依赖（纯底座） |
| **Layer 1: 对象与池化层** | `fg-object`, `fg-pools` | Git 四大对象（Blob/Tree/Commit/Tag）零拷贝解析；时代戳 `BufferPool` / `WorktreePool` | `fg-core` |
| **Layer 2: 索引、存储与算法** | `fg-index`, `fg-storage`, `fg-algorithms` | 无锁内存索引树与 DIRC 编解码；原子 CAS 落盘存储；SWAR 行差分、Kirsch-Mitzenmacher 双哈希布隆过滤器与 CCD v2 | `fg-core`, `fg-object`, `fg-pools` |
| **Layer 3: 拓扑、传输与门面** | `fg-topology`, `fg-transport`, `fg-gate`, `fg-native` | 引用图与 Cell 分叉拓扑；协议传输封装；Taxis 内核门禁自检（`FGT-GAT-001`）；N-API / CLI 桥接门面（`FGT-BRG-001`） | Layer 0 ~ Layer 2 |

- **拓扑守卫**：任何 `Cargo.toml` 依赖变更必须通过 `node fractal-git/scripts/common/validate-crate-topology.js` 验证零逆向跨层与零环路。

---

## 三、 核心内核公理与四大架构不变量

### 1. Git Plumbing 协议 100% 字节等价 (`FGT-ALG-001` / `FGT-OBJ-001`)
- **对象序列化等价**：Loose Object 的 `<type> <size>\0<payload>` 头部封装、SHA-1/SHA-256 摘要计算及 Zlib 压缩流必须与官方 Git 产出字节级等价；
- **Tree 条目排序契约**：Tree 对象内部条目必须严格按 Git 规范（目录名末尾视作隐式 `/` 参与字节序比较）排序，严禁使用普通字典序导致 `git fsck` 校验失败；
- **DIRC 索引二进制布局 (`FGT-IDX-001`)**：`fg-index` 读写 `.git/index` 必须严格遵守网络字节序（Big-Endian）、8 字节对齐填充与尾部校验和不变式。

### 2. Cell 虚拟工作树与无锁 CAS 快照物化 (`FGT-LCK-001` / `FGT-CAS-001` / `FGT-TRN-001`)
- **热路径零阻塞锁 (`FGT-LCK-001`)**：在多智能体并发 Cell 暂存与虚拟索引树读取路径中，严禁使用粗粒度阻塞 `Mutex` / `RwLock`；
- **CAS 原子晋升 (`FGT-CAS-001`)**：虚拟工作树状态流转采用不可变快照 + `AtomicU64` / 原子指针 Compare-And-Swap 循环物化；ABA 风险必须通过单调递增的世代号（Epoch Generation Counter）消除；
- **事务原子回滚 (`FGT-TRN-001`)**：跨引用更新与快照落盘必须具备显式事务边界（`Staging -> Validated -> Committed`），任一步骤失败必须无残留回滚暂存文件（`FGT-STO-001`）。

### 3. 偏序集同态冲突检测 (CCD v2) 与三层升级仲裁 (`FGT-COR-001` / `FGT-POL-001`)
- **第一层（L1 快速布隆过滤）**：利用 Kirsch-Mitzenmacher 双哈希布隆过滤器（$h_i(x) = (h_1(x) + i \cdot h_2(x)) \bmod m$）在 $O(1)$ 时间内判定两 Cell 改动路径集是否正交；
- **第二层（L2 偏序集同态合并）**：对交集文件执行基于操作偏序集（Poset Homomorphism）的块级交换律验证，可交换 Hunk 自动无损融合；
- **第三层（L3A 语义冲突阻断）**：当检出不可交换的重叠修改或跨模块契约破坏时，立即终止自动合并并输出精确冲突切片供上层仲裁。

### 4. 热路径零瞬态堆分配与双端门面等价 (`FGT-PRF-001` / `FGT-FAC-001` / `FGT-BRG-001`)
- **池化借还闭环 (`FGT-PRF-001`)**：对象解压、差分扫描与树遍历严禁在循环内分配临时 `Vec<u8>` 或 `String`，一律从 `fg-pools` 借用并在 Drop 时自动归还清空容量；
- **门面实质承载 (`FGT-FAC-001` / `FGT-BRG-001`)**：每个微 Crate 的 `lib.rs` 及 `fractal-git/ts/` TypeScript 门面必须承载实质协议转换、参数校验或错误映射，严禁 $\le 3$ 行纯透传跳板。

---

## 四、 本地预审与全量验证命令

```powershell
# 1. 验证 10 微 Crate 拓扑单向性与零循环依赖
node fractal-git/scripts/common/validate-crate-topology.js

# 2. 运行 Rust 零 Panic、// SAFETY: 证明与 SSOT 规则引用核验
node .agents/skills/rust-engineering/scripts/validate-rust-conformance.js

# 3. 运行 Cargo Clippy 零警告门禁与全工作区单元测试
cargo clippy --manifest-path fractal-git/Cargo.toml --all-targets -- -D warnings
cargo test --workspace --manifest-path fractal-git/Cargo.toml

# 4. 执行 Taxis 专属全套门禁审计 (含 Plumbing 等价性与基准棘轮)
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

---

## 五、 关联深水区参考与实操样板

- [crate-topology-and-plumbing-protocol.md](references/crate-topology-and-plumbing-protocol.md)：10 微 Crate 依赖矩阵、Git Plumbing 二进制帧格式、CCD v2 偏序集同态数学模型与三层冲突仲裁指南；
- [cell-cas-transaction-skeleton.rs](templates/cell-cas-transaction-skeleton.rs)：Cell 虚拟工作树无锁 CAS 快照晋升、世代号防 ABA 与事务原子回滚标准 Rust 样板。
