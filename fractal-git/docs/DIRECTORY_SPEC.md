# Fractal Git 目录职责规范与全域扩展指引 (Directory Specification)

> **模块定位**：`fractal-git` 全域内核子系统与上层编排物理目录职责总规与单向依赖指针  
> **设计架构**：深度对标 GitHub 官方 `gitoxide (gix-*)` 模块化子系统架构与 Agent 原生双自动化提交区域（Direct-Bypass 测试缓存 + 内核验证预审区）  
> **设计原则**：严格高内聚、零循环依赖、明确单一职责、算法/池/索引正交解耦、纯接口抽象与策略物理隔离

---

## 1. 内核分层子系统矩阵 (Kernel Subsystem Matrix)

| 目录路径 | 角色定位 | 核心职责与设计边界 | 允许依赖 | 严禁反向依赖 |
| :--- | :---: | :--- | :--- | :--- |
| **`crates/fg-core/`** | 领域核心基石 | 纯原子数据模型（`Oid`, `GitSignature`, `PraxisCardContext`, `AgentCommitMeta`、审计数据结构 `TelemetryEntry`, `AuditStatus`）与核心抽象 Trait（`OdbStore`, `RefStore`, `GateVerifier`, `WorktreeReclaimer`）。零业务依赖。 | 基础错误与序列化库 | 严禁依赖任何具体存储、算法或上层 Crate |
| **`crates/fg-object/`** | Git 原生对象模型 | 纯 Git 对象编解码（`GitBlob`, `GitTree`, `GitCommit`, `FileMode`）与规范二进制排序（目录尾斜杠规则）。纯数学与数据算子。 | `fg-core`, `sha1`, `flate2` | 严禁依赖拓扑、网络、存储引擎或进程调用 |
| **`crates/fg-index/`** | 索引区与无锁虚拟树 | 消除 `.git/index.lock` 锁争用的无锁内存索引（`InMemoryIndexTree`）、规范四阶段冲突槽（`Stage 0..3`、`ConflictStageSlot`）与目录树生成回调。 | `fg-core`, `fg-object` | 严禁依赖底层物理 I/O、网络传输或业务调度 |
| **`crates/fg-algorithms/`** | 纯算法与数学算子库 | 对标 `git/xdiff`：FastCDC 变长分块滚动哈希、三方合并（`ThreeWayMerge`，快进检测与冲突判定）、内存树差分（`TreeDiff`）、Unified Diff 补丁生成（`PatchGenerator`）、DAG 拓扑排序与祖先可达性剪枝（`DagWalker`）、SpacePlan 离散磁盘水位推演算法、以及分层树状归约算法（`HierarchicalRollupFolder`）。 | `fg-core`, `sha1` | 严禁包含物理文件读写或业务状态 |
| **`crates/fg-pools/`** | 资源池与分配管控 | 热路径循环内零堆分配约束：树节点与缓冲对象复用池（`RecyclePool`）、64KB 压缩页面缓冲池（`PageBufferPool`）、预热虚拟工作区沙箱槽位池（`SandboxPool`, `WorktreePool`）、以及 Direct-Bypass 极速自动化测试内存缓存池（`DirectBypassPool`，支持 `<20ms` 物理回收）。 | `fg-core`, `fg-object`, `parking_lot` | 严禁侵入策略守卫、业务调度或传输协议 |
| **`crates/fg-native/`** | Taxis 原生二进制真身 | TAXC 分节容器（Header / Section Table / CRC32C / 8 字节对齐）、七类原生节（`META`/`HEAD`/`REFS`/`INDX`/`OPLG`/`PROM`/`WKTR`）、仓库布局（`RepoLayout`、守卫文件、隐藏属性）、Windows junction 与仓库标识（`repo_id` / store 路径）。**不持有任何 git 格式知识**，可脱离兼容投影独立验证。 | `fg-core`, `sha1`, `getrandom` | 严禁依赖对象编解码、传输协议或 CLI 交互 |
| **`crates/fg-storage/`** | 真实不可变存储底座 | 松散对象存储（`LooseOdb` 原子写入 `.git/objects/`）、不可变 CAS 块后端（`CasBackend`）、崩溃安全事务预写日志（`WalJournal`）、LayerVFS 快照向 Git 对象的原子物化器（`CasToGitMaterializer`）、以及 TIPSE 原位存储解压与微分型包重打包（`in_place`, `repack_repository_low_disk`）。 | `fg-core`, `fg-object`, `fg-index`, `fg-algorithms` | 严禁依赖传输层协议或 CLI 交互 |
| **`crates/fg-topology/`** | 自相似分形拓扑与审计链 | 自相似四层引用系统（`refs/fractal/{dept}/{cell}/{card}/{agent}`）、合并合法性断言器（`TopologyVerifier`，严守 SubAgent 仅合入父级 Card 铁律）、工作树生命周期状态机（`WorktreeStateMachine`，含 `Quarantined` 检疫态）、Path Jail 沙箱隔离契约、以及密码学防篡改遥测审计哈希链（`AuditHashChain`，支持 Win32 ACL 与 Linux `chattr +a` 操作系统级只读/仅追加物理加固）。 | `fg-core`, `fg-native`, `serde`, `chrono` | 严禁直接依赖物理存储或对象编码实现 |
| **`crates/fg-transport/`** | 自托管传输协议栈 | 内部 Agent 零拷贝本地 IPC（`IpcMessage`, `IpcCodec` 4 字节帧协议）与标准 Git Smart Protocol v2（`PacketLine` 4 字节 Hex 流式编解码、`ls-refs`, `fetch` 协商）。 | `fg-core`, `fg-object`, `fg-topology` | 严禁侵入存储物理层与代码审查逻辑 |
| **`crates/fg-gate/`** | 预审门禁与内核验证器 | 协议层门禁拦截（`PreReceiveGuard`）、微秒级物理卫生与冲突标记守卫（`ConflictGuard`）、工作树与配额守卫（`QuotaGovernor`）、TKCV 内核抽象推导验证器（`KernelAstVerifier`，5 维不变式）、IKCE 内核微变异击杀率验证引擎（`KernelCanaryEngine`，击杀率 $K\ge 60\%$）、贝叶斯动态信用控制器（`AgentCreditController`，Jeffreys Beta(0.5, 0.5) 评级）、以及全自动审计钩子（`AutoAuditHook`）。 | `fg-core`, `fg-object`, `fg-topology` | 严禁依赖传输层实现细节或物理存储底层 |
| **`src/lib.rs` (根)** | 统一门面 (Facade) | 工作区根 Rust 门面，统摄并平铺导出全量 10 大内核子系统，提供高人机工学的一站式 SDK 接口。 | 全量 `crates/fg-*` | — |
| **`src/bench/`** | 基准性能评测套件 | TB-REGRESSION 微基准测试套件与单串行端到端（E2E）克隆 vs 渐进投影评测流水线（`src/bench/e2e/`）。 | `fg-core`, `fg-storage`, `fg-algorithms`, `fg-index`, `fg-topology` | 严禁在基准热路径引入非受控 I/O 干扰 |
| **`src/bin/taxis.rs`** | 原生 CLI 与 Git 兼容引擎 | Taxis 原生命令行二进制入口（下设 `taxis_cmd/` 78 个模块化子命令分发器，支持 `bench/st/ci/br/di/co/check/gc/serve/quality/quarantine` 等指令、JSON 输出与基准自动校验）。 | 全量 `crates/fg-*`, `serde_json` | 严禁反向被底层内核子系统依赖 |
| **`ts/`** | TypeScript 编排与客户端 | 工业化五层分工：`client/` (Praxis Agent SDK 客户端)、`vfs/` (LayerVFS 虚拟文件系统适配器)、`tui/` (一体两面终端渲染器)、`orchestration/` (多 Agent 候选变体评估与择优晋级器)、`cli/` (终端命令)。 | 顶层契约与原生桥 | 严禁在门面外泄露低级指针 |
| **`scripts/`** | 工程构建与自测脚本 | 跨平台工程构建（`build.ps1` CRLF / `build.sh` LF `set -euo pipefail`）、自测流水线与门禁检查脚本。 | 外部编译器工具链 | 严禁硬编码规范化完整路径或 Windows 盘符 |
| **`tests/`** | 双轨集成与基准测试 | Rust 内核子系统集成测试套件（`tests/rust/`）与 TypeScript 仿真测试（`tests/ts/`）。 | 被测项目各模块 | 严禁生产代码反向依赖测试夹具 |

---

## 2. 单向依赖拓扑流向图 (Kernel Subsystems Dependency Flow)

系统内部严格执行**单向无环依赖（DAG）**，底层为纯模型、纯算法与纯索引，中层为物理池与存储，顶层为拓扑与传输，门面层为 TypeScript 编排：

```mermaid
flowchart TD
  subgraph TS_LAYER["TypeScript 编排与人机交互层"]
    CLIENT["ts/client/ (Praxis Agent SDK)"]
    VFS["ts/vfs/ (LayerVFS 适配器)"]
    TUI["ts/tui/ (一体两面终端图谱渲染)"]
    ORCH["ts/orchestration/ (多 Agent 变体评估)"]
    CLI["ts/cli/ (终端命令)"]
    TS_FACADE["ts/index.ts (统一 TS 门面)"]
    CLIENT --> TS_FACADE
    VFS --> TS_FACADE
    TUI --> CLI --> ORCH --> TS_FACADE
  end

  subgraph ROOT_RUST["Rust 统一工作区门面 (Root Facade)"]
    ROOT_LIB["fractal-git/src/lib.rs"]
  end

  subgraph LAYER_TOP["L3: 协议、门禁、验证器与拓扑层"]
    TRANSPORT["fg-transport (Smart Protocol v2 / IPC)"]
    GATE["fg-gate (TKCV / IKCE / Credit / Conflict Guard / Quota)"]
    TOPOLOGY["fg-topology (分形引用 / 状态机 / 审计链 / Path Jail)"]
  end

  subgraph LAYER_STORAGE["L2: 存储与并发池层"]
    STORAGE["fg-storage (Loose ODB / CAS Backend / WAL Journal)"]
    NATIVE["fg-native (TAXC Container / Native Sections / Repo Layout)"]
    POOLS["fg-pools (RecyclePool / DirectBypassPool / SandboxPool)"]
  end

  subgraph LAYER_LEAF["L1: 内存索引、纯算法、对象模型与领域核心 (Plumbing)"]
    INDEX["fg-index (InMemoryIndexTree / ConflictStageSlot)"]
    ALGO["fg-algorithms (FastCDC / ThreeWayMerge / TreeDiff / Math)"]
    OBJECT["fg-object (Blob / Tree / Commit / FileMode)"]
    CORE["fg-core (Oid / Signatures / TelemetryEntry / Context / Traits)"]
  end

  TS_FACADE ==> ROOT_LIB
  ROOT_LIB ==> TRANSPORT
  ROOT_LIB ==> GATE
  ROOT_LIB ==> STORAGE
  ROOT_LIB ==> NATIVE
  ROOT_LIB ==> TOPOLOGY
  ROOT_LIB ==> INDEX

  TRANSPORT --> GATE --> TOPOLOGY
  TRANSPORT --> OBJECT
  GATE --> OBJECT
  GATE --> TOPOLOGY

  STORAGE --> INDEX
  STORAGE --> POOLS
  STORAGE --> ALGO
  STORAGE --> OBJECT
  STORAGE --> CORE

  NATIVE --> CORE

  INDEX --> OBJECT
  INDEX --> CORE

  POOLS --> OBJECT
  POOLS --> CORE

  TOPOLOGY --> CORE
  ALGO --> CORE
  OBJECT --> CORE
```

> `fg-topology` 另有指向 `fg-native` 的依赖：操作日志、提拔账本与工作树注册表都以 `repo.txc` 的原生节持久化，容器原语归 `fg-native` 所有。

---

## 3. 后续扩展放置规范 (Extension & Contribution Guide)

为了防止未来代码库膨胀与碎片化，任何新增功能必须按照以下路由矩阵严格归位：

### 3.1 场景 A：新增算法算子（如 Myers Diff, 语义 AST 级冲突合并, 分层度量折叠汇总）
- **归属位置**：`crates/fg-algorithms/src/<category>/<algorithm_name>.rs`
- **契约要求**：必须为纯数学无状态函数，输入为只读切片或结构化引用，严禁包含任何文件系统 I/O 或全局锁。

### 3.2 场景 B：新增内存索引策略（如 冲突自动保留, 目录压缩树）
- **归属位置**：`crates/fg-index/src/<strategy_name>.rs`
- **契约要求**：必须保持无锁可变性，在内存中维护纯数据结构，通过回调输出给存储层，严禁耦合直接文件读写。

### 3.3 场景 C：新增高并发缓存与资源池（如 Direct-Bypass 测试缓存池, 预编译 AST 缓存）
- **归属位置**：`crates/fg-pools/src/<pool_name>.rs`
- **契约要求**：必须实现 `Resettable` 特征，提供 `acquire()` 与 `release()` 方法，确保高频循环中瞬态堆分配归零（`FGT-PRF-001`）。严禁塞入策略性配额代码。

### 3.4 场景 D：新增存储底座（如 Packfile 索引读取, SQLite WAL 归档, S3 镜像）
- **归属位置**：`crates/fg-storage/src/backends/<backend_name>.rs`
- **契约要求**：必须实现 `fg-core::traits::OdbStore` 抽象 Trait，支持 `read_object`、`write_object` 与 `has_object`。

### 3.5 场景 E：新增自托管通信协议（如 WebSockets / gRPC / WebDAV）
- **归属位置**：`crates/fg-transport/src/<protocol_name>.rs`
- **契约要求**：必须通过 `crates/fg-gate/src/pre_receive.rs` 进行身份认证与权限校验，严禁绕过门禁直接修改引用。

### 3.6 场景 F：新增内核形式化不变式推导规则或盲测变异算子
- **归属位置**：
  - 形式化不变式：`crates/fg-gate/src/verifier/<invariant_name>.rs`
  - 微变异算子：`crates/fg-gate/src/canary/<mutation_operator>.rs`
- **契约要求**：不变式必须在只读 AST 上推导，单次增量执行 $<5\text{ms}$；变异算子必须保证纯内存操作，并在变异后能够被测试用例以 $K\ge 60\%$ 杀伤率捕获。

### 3.7 场景 G：新增安全策略、配额风控与检疫策略
- **归属位置**：`crates/fg-gate/src/<governor_name>.rs`
- **契约要求**：必须集中在 `fg-gate`，严禁与 `fg-pools` 混淆。触发违规隔离时需与 `fg-topology` 的状态机和检疫目录（`.taxis/quarantine/`）紧密联动。

### 3.8 场景 H：新增 CLI 命令与 Git 别名映射（如 taxis quality, taxis quarantine）
- **归属位置**：`src/bin/taxis.rs` 与 `src/bin/taxis_cmd/<subcommand>.rs`
- **契约要求**：必须在 `resolve_canonical_subcommand` 中注册标准别名，并在 `dispatch_command` 的分派表落入对应处理器，优先走分形 CAS 原生实现；尚未实现的 Git 子命令由 `reject_unimplemented` 明确拒绝并列出已实现集合，严禁静默转交系统 `git`，同时维持跨平台沙箱配置防御与 `--json` 机器格式输出支持。

### 3.9 场景 I：新增基准评测维度与性能回归模型
- **归属位置**：`src/bench/e2e/<dimension>.rs`
- **契约要求**：必须支持单串行环境隔离，避免在关键计时区触发不可控的 I/O 或操作系统调度噪声；所产出的度量指标必须提供对应的 `TB-REGRESSION` 单调性容差校验与冻结基准序列化支持。
