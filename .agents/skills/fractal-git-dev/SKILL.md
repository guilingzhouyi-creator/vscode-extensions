---
name: fractal-git-dev
description: >-
  【触发：taxis/版本控制内核/CAS/偏序集/实现子命令/字节等价/FGT规则】开发或修改 fractal-git (Taxis) 模块时必须使用。看守 10 大内核子系统分层拓扑、Git Plumbing 二进制等价、偏序集冲突检测与 CAS 无锁索引树。
---

# fractal-git-dev — Taxis 分形 Git 高性能版本控制内核开发规范

本技能是 `fractal-git/`（Taxis 分形版本控制内核）的专属架构与研发规范，确立了 10 大内核子系统严格单向拓扑、Git Plumbing 二进制协议 100% 字节等价、偏序集同态交换冲突检测（CCD v2）、Cell 虚拟工作树无锁 CAS 快照物化、世代戳复用池（`fg-pools`）与 Rust $\leftrightarrow$ TypeScript 门面桥接标准。

> 通用 Rust 语言级范式（Type-State、`thiserror`、`// SAFETY:` 证明）请同步遵循 [rust-engineering](../rust-engineering/SKILL.md)。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：— → **本技能** → [rust-engineering](../rust-engineering/SKILL.md)；并行支援 `algorithmic-operator-engineering`、`coding-craft`、`complexity-budget`、`constraint-driven-development`。
- **领域**：分形版本控制内核（领域入口）
- **协作专员**：原型 `git-kernel`：`fg-construct`、`fg-review`、`fg-refactor`、`fg-explore`
- **何时联动**：新增或修改 taxis 子命令 → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis 输出与 git 逐字节不一致 → `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

在以下任一研发或审查场景中，必须激活本技能：
1. **修改或新增 `fractal-git/crates/` 下的 10 大内核子系统源码**；
2. **实现或优化 Git Plumbing 协议与存储算子**（Loose Object、DIRC 索引、Packfile、Tree Diff、Commit Graph）；
3. **开发多智能体 Cell 虚拟工作树、并发暂存区或偏序集同态冲突检测（CCD v2）**；
4. **维护 `fractal-git/src/bin/` 原生命令层（`taxis` CLI）或 `fractal-git/ts/` TypeScript 门面层**；
5. **排查 `fractal-git` 专属门禁（<!-- METRICS:BEGIN rule-fractal-git -->**37 条规则**<!-- METRICS:END rule-fractal-git -->，`FGT-*`）与 Scion 对标基准回归**。

---

## 二、 10 大内核子系统四层单向拓扑契约 (`FGT-TOP-001` / `FGT-DEP-001`)

`fractal-git` 严禁单体紧耦合设计，全内核拆分为职责正交的 10 个内核子系统，依赖箭头必须严格自上而下，零循环依赖：

| 拓扑层级 | 内核子系统名称 | 核心职责与领域边界 | 允许依赖的下层 Crate |
| :--- | :--- | :--- | :--- |
| **Layer 0: 领域原语层** | `fg-core` | OID 哈希原语、强类型错误枚举、全局 SSOT 常量（`constants/`）、类型状态标记 | 零内部 Crate 依赖（纯底座） |
| **Layer 1: 对象与池化层** | `fg-object`, `fg-pools` | Git 四大对象（Blob/Tree/Commit/Tag）零拷贝解析；世代戳 `BufferPool` / `WorktreePool` | `fg-core` |
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
- **门面实质承载 (`FGT-FAC-001` / `FGT-BRG-001`)**：每个内核子系统的 `lib.rs` 及 `fractal-git/ts/` TypeScript 门面必须承载实质协议转换、参数校验或错误映射，严禁 $\le 3$ 行纯透传跳板。

### 5. 双专属自动化区域、内核形式化验证与密码学独立审计链 (`FGT-GAT-001`)
- **双自动化区域与检疫隔离 (`FGT-BYP-001` / `FGT-QRN-001`)**：高频测试走 Direct-Bypass SSD 内存测试缓存区，`<20ms` 物理回收，绝不向 Git ODB 写入未验证碎片；触发高危违规的快照强制打入 `refs/fractal/quarantine/*` 物理隔离区，提交走预审区（Pre-Review Zone）；
- **TKCV 形式化推导验证 (`FGT-VRF-001`)**：在内核层执行 5 维代码不变式静态抽象推导（单次 $<5\text{ms}$），刚性拦截虚构代码；
- **商密原语与两层 5D ELOC 差分准入总督 (`FGT-COR-001` / `FGT-GAT-001`)**：
  - `fg-core::crypto` 原生实现 GB/T 32918.4 SM3 256 位哈希与 RFC 2104 标准 `hmac_sm3`；
  - `fg-algorithms::diff::eloc_5d` 提供纯 Rust 零瞬态堆分配 5D 黎曼有效代码评估与 `FloatPrecisionExt` 确定性截断；
  - `fg-gate::diff_bounds` 部署两层解耦双向钳制总督（`SingleFile5dBounds`、`CommitBatchTotals`、`DiffBoundsGovernor`），联动 `admission.rs` 贝叶斯 Jeffreys 后验动态准入门槛；
  - `taxis gate-slice` 子命令实现毫秒级暂存切片审查与结构化 JSON 违规信封输出。
- **预测试影响面切片守卫 (`FGT-IMPACT-001`)**：改动路径到预测试目标的映射单一登记于 `scripts/common/impact-slice-map.js`，切片只允许收窄被触发的目标集合、严禁把已识别路径放宽到登记集之外；未识别的 crate 路径必须回落到全量目标，杜绝以「未匹配」为名漏测；
- **IKCE 隐藏微变异盲测评估 (`FGT-MUT-001` / `FGT-TAU-001`)**：纯内存注入微变异体，强制要求测试击杀率 $K \ge 60\%$，刚性粉碎空断言与恒真式；
- **防篡改独立审计链与四级时间折叠 (`FGT-AUD-001` / `FGT-PYR-001`)**：独立维护 `refs/fractal/telemetry/*` HMAC 单向哈希链与四级时间折叠汇总，施加 OS 底层防护（Win32 只读锁 + Linux `chattr +a` 仅追加属性）。

### 6. 真实物理时钟基准与异步投影管道规范 (`FGT-PRF-001` / `FGT-TRN-001`)
- **真实时钟物理基准**：对全量 Git 克隆、Worktree 开辟与局部脏索引更新建立确定性真实时钟基准测量，明确 CoW reflink / 偏序集计算与后台异步投影管道（Async Projection Worker）的职责边界；
- **异步投影事务状态**：脏快照更新仅写入轻量 Dirty Ledger，重型物理拓扑物化与 Tree Diff 委托给后台 worker，杜绝主进程事件循环卡顿。

### 7. 去夸张化技术文档契约 (`DOC-TRM-001` / `CMG-STY-002`)
- 严格禁止在模块文档、README 或对外介绍中使用“绝对零锁”、“彻底终结”、“100% 毫无延迟”等绝对化词汇；
- 技术文档必须严格对照源码数据结构（如 CAS 乐观自旋重试阈值、偏序集剪枝条件与内存容量上限）陈述客观事实。

---

## 三·B、 内核提交信息契约规则族 (`FGT-MSG-*`)

`fg-gate::commit_guard` 拥有自己的规则族，不再引用 `auto-refactor` 或 `global-tooling` 的
`GUARD-MSG-*` / `CMG-*`，避免跨项目规则归属漂移。

| 规则 | 守护目标 |
| :--- | :--- |
| `FGT-MSG-001` | 标题形状、字数（Unicode 字符口径）、句号、`!` 破坏标记、零宽字符、Emoji、冒号分隔 |
| `FGT-MSG-002` | 语义区块槽位与双语别名、空行分割、重复区块、拓扑序、ASCII 括号与连字符列表 |
| `FGT-MSG-003` | 正文与逐区块实质字数（Why 15 / Fixed 12 / Verification 12、条目 8） |
| `FGT-MSG-004` | 词汇契约：词边界匹配、代码块与 URL 掩码、白名单消减、祈使语气与零人称 |
| `FGT-MSG-005` | 未决标记（TODO/FIXME/TBD/待补充）与模板尖括号残留 |
| `FGT-MSG-006` | 空壳区块与清单条目下限 |
| `FGT-MSG-007` | 项目归属槽位存在性、精确枚举匹配、项目专名漂移 |
| `FGT-MSG-008` | 批次代号（phaseN / sprint N / wN / pass N） |
| `FGT-MSG-009` | 合并提交结构豁免：以提交对象父数为证据，不以首行文本为依据 |
| `FGT-MSG-010` | 声明锚点：`[Verification]` 必须引用 diff 新增行中的符号名或测试名 |
| `FGT-MSG-011` | 策略档位守卫：命令行选择器只能收紧，永不放宽仓库声明下限 |
| `FGT-MSG-012` | 规则标识反虚构：消息引用的规则 ID 必须已登记 |

**策略下限单源**：`fractal-git/commit-policy.json` 声明仓库级 `floor`，其变更随版本控制评审；
`.git/config` 只允许把档位调高。真正的例外必须走 `--bypass-message-guard --reason "<理由>"`
并落入遥测审计链，禁止用 `--policy` 隐式旁路。

**覆盖面契约**：`commit` 与 `merge --message` 走全量校验；`rebase reword` 走全量（唯一凭空写入
新消息的路径）；`cherry-pick` / `revert` / `stash` 的继承或合成消息只查未决标记，避免历史重写被
新规则误杀。

---

## 四、 本地预审与全量验证命令

```powershell
# 1. 验证 10 大内核子系统拓扑单向性与零循环依赖
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

- [crate-topology-and-plumbing-protocol.md](references/crate-topology-and-plumbing-protocol.md)：10 大内核子系统依赖矩阵、Git Plumbing 二进制帧格式、CCD v2 偏序集同态数学模型与三层冲突仲裁指南；
- [cell-cas-transaction-skeleton.rs](templates/cell-cas-transaction-skeleton.rs)：Cell 虚拟工作树无锁 CAS 快照晋升、世代号防 ABA 与事务原子回滚标准 Rust 样板。
