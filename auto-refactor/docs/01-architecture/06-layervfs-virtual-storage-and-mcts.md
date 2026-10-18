# 06 LayerVFS 虚拟分叉文件系统、沙箱物理投影与 MCTS 探索树架构规范

> **模块定位**：`src/core/praxis/vfs/`  
> **设计目标**：为 Praxis 团队与多智能体（Multi-Agent）代码演化提供毫秒级虚拟文件系统分叉、CAS 块级去重存储、受控沙箱物理投影与基于蒙特卡洛树搜索（MCTS）的重构方案锦标赛探索引擎。

---

## 1. 架构动机与第一性原理 (Architectural Rationale)

在传统多 Agent 并发代码生成与重构探索中，主要面临三大瓶颈：
1. **物理工作区拷贝开销高昂**：为每个 Agent 创建物理工作区副本（`git worktree` 或文件物理拷贝）在大型代码库中耗时数百毫秒至数秒，引发磁盘 I/O 剧烈颠簸；
2. **状态分支与原子回退繁重**：探索失败时的清理与回退依赖 Git 索引锁与暂存区重置，多并发 Agent 容易发生锁争用；
3. **盲目单线演化缺乏竞争优胜**：代码重构方案通常单线推进，无法在短时间内生成多种变体并依据客观静态 AST 指标与物理测试进行多臂老虎机（Multi-Armed Bandit）择优。

`auto-refactor` 借鉴内容分块（FastCDC）、内容寻址存储（CAS）与虚拟分形思想，在 `src/core/praxis/vfs/` 构建了 **LayerVFS 与 MCTS 探索体系**：
- **微秒级分叉（Fork < 3ms）**：基于 Merkle 虚拟目录树，仅复制根指针引用，不变数据块零拷贝；
- **原子闪回（Rollback < 1ms）**：快照通过不可变 CAS 根哈希固化，回滚仅需替换当前工作区根引用；
- **沙箱隔离投影（Zero Leakage Sandbox）**：仅在执行物理编译或单元测试时将虚拟状态投影至临时物理目录，并在作用域结束时自动析构；
- **MCTS 重构探索锦标赛**：结合 UCT 树搜索算法与客观质量模型，对多 Agent 生成的代码候选方案进行并发评估与自适应择优。

---

## 2. 核心模块与拓扑架构 (Core Modules Topology)

```
src/core/praxis/vfs/
├── fastcdc.ts                # FastCDC 动态内容感知切块算法 (Gear Hash)
├── types.ts                  # CAS 块、虚拟节点、快照与沙箱数据契约
├── sqlite-vfs-storage.ts      # SQLite WAL CAS 块与 Merkle 树持久化引擎
├── projection-engine.ts      # 沙箱物理投影、生命周期析构与受控运行器
├── managed-workspace.ts      # 虚拟工作区分叉、文件读写与快照管理门面
├── mcts-engine.ts            # MCTS 重构探索锦标赛与 UCT 评估决策引擎
└── index.ts                  # 领域统一导出门面
```

---

## 3. FastCDC 动态切块算法 (`fastcdc.ts`)

为了在文件内容变动时实现最大程度的块复用，避免固定大小切块（Fixed-Size Chunking）产生的雪崩重算效应，LayerVFS 实现了 **FastCDC (Fast Content-Defined Chunking)** 算法：

### 3.1 核心参数配置
- **最小块大小（`MIN_SIZE`）**：2 KB（2048 字节）
- **目标平均块大小（`AVG_SIZE`）**：8 KB（8192 字节）
- **最大块大小（`MAX_SIZE`）**：32 KB（32768 字节）
- **跳步优化**：利用 Gear Hash 滚动哈希状态机，在达到 `MIN_SIZE` 之前直接跳步扫描，跳过静态掩码计算，使得切块吞吐量超过 1.2 GB/s。

### 3.2 判定掩码机制
```typescript
// 基于 Gear 表查找的滚动哈希
let fingerprint = 0;
for (let i = offset + MIN_SIZE; i < limit; i++) {
    fingerprint = (fingerprint << 1) + GEAR_TABLE[buffer[i]];
    if ((fingerprint & MASK) === 0) {
        // 触发动态切块边界点
        return i;
    }
}
```

---

## 4. CAS 内容寻址与 SQLite WAL 存储模型 (`sqlite-vfs-storage.ts`)

LayerVFS 采用 Node 24 原生 `node:sqlite`（零外部 npm C++ 插件依赖），以 WAL（Write-Ahead Logging）持久化存储 CAS 数据块与 Merkle 目录拓扑。

### 4.1 四张核心关系表
1. **`vfs_chunks`**：存储物理分块数据
   - `hash TEXT PRIMARY KEY`：SHA-256 内容摘要
   - `size INTEGER`：块字节长度
   - `data BLOB`：未压缩或压缩分块二进制
2. **`vfs_nodes`**：Merkle 虚拟文件系统节点
   - `id TEXT PRIMARY KEY`：UUID 或确定性路径哈希
   - `type TEXT`：`file` | `dir`
   - `chunk_hashes TEXT`：JSON 序列化的分块哈希数组（文件节点专属）
   - `children TEXT`：JSON 序列化的子节点键值对（目录节点专属）
   - `size INTEGER`：文件总长度
   - `mtime_ms INTEGER`：毫秒级逻辑修改时间戳
3. **`vfs_workspaces`**：虚拟工作区工作树
   - `id TEXT PRIMARY KEY`：工作区唯一标识
   - `parent_id TEXT`：分叉父工作区 ID
   - `root_node_id TEXT`：指向当前根目录节点的引用
   - `created_at_ms INTEGER`：创建时间
4. **`vfs_snapshots`**：命名快照记录
   - `id TEXT PRIMARY KEY`：快照 ID
   - `workspace_id TEXT`：所属工作区 ID
   - `root_node_id TEXT`：快照时刻冻结的 Merkle 根节点 ID
   - `name TEXT`：快照别名
   - `created_at_ms INTEGER`：固化时间

### 4.2 零拷贝分叉与原子回滚
- **`forkWorkspace(parentWorkspaceId, newWorkspaceId)`**：
  在 `vfs_workspaces` 中插入新行，其 `root_node_id` 直接指向父工作区的当前 `root_node_id`。物理数据完全复用，耗时仅涉及一条单主键 INSERT 语句（耗时 $\le 3\text{ms}$）。
- **`revertWorkspace(workspaceId, snapshotId)`**：
  读取 `vfs_snapshots` 中固化的 `root_node_id`，一条 UPDATE 语句原子置换 `vfs_workspaces.root_node_id`。所有写写冲突与未提交变动在 1ms 内瞬间丢弃，达到 $O(1)$ 复杂度原子闪回。

---

## 5. 沙箱物理投影与生命周期隔离 (`projection-engine.ts`)

为了支持物理测试（如 `npm test`、编译器验证与原生算子执行），LayerVFS 提供了受控物理投影引擎：

```
                ┌─────────────────────────┐
                │   LayerVFS (SQLite WAL) │
                └────────────┬────────────┘
                             │ projectWorkspace()
                             ▼
                ┌─────────────────────────┐
                │   系统 Temp 物理投影     │
                │   praxis-sandbox-XXXXX  │
                └────────────┬────────────┘
                             │ runInSandbox()
                             ▼
                ┌─────────────────────────┐
                │   子进程受控执行环境    │
                │   (cwd Locked / 30s)    │
                └────────────┬────────────┘
                             │ cleanOnClose()
                             ▼
                ┌─────────────────────────┐
                │   物理目录无残留清理    │
                └─────────────────────────┘
```

### 5.1 投影关键特性
1. **全异步零阻塞 I/O（`GOV-PRF-004`）**：
   全面基于 `fs.promises.mkdtemp`、`fs.promises.mkdir` 与 `fs.promises.writeFile`，杜绝一切 `*Sync` 阻塞 I/O，保障 IPC 守护进程与异步并发调度吞吐；
2. **工作目录绝对锁定（`CWD Jail`）**：
   受控执行器 `runInSandbox(command, options)` 强制将子进程执行目录 `cwd` 锚定在当前沙箱临时根目录下，严禁向外逃逸；
3. **超时强杀退出码契约**：
   提供受控的超时守卫机制（默认 30,000ms）。子进程超时未退出时，发送 `SIGKILL` 终止，并统一映射至 POSIX 标准超时退出码 `124`；
4. **生命周期析构（`cleanOnClose`）**：
   在会话结束或探索完成后，调用 `cleanOnClose()` 递归删除临时目录，实现全生命周期零物理残留（`HYG-CLT-001`）。

---

## 6. MCTS 探索树与重构锦标赛 (`mcts-engine.ts`)

当面对复杂的跨模块重构任务时，单一 Agent 生成的代码方案往往存在局部最优或引入隐藏退化。`MCTSEngine` 提供了一套蒙特卡洛树搜索与重构锦标赛机制：

### 6.1 UCT 节点选择策略
在 MCTS 树扩展与选择阶段，依据经典 UCT（Upper Confidence Bound 1 applied to Trees）公式选取最具探索价值的状态分支：
$$\text{UCT}(n) = \bar{X}_n + 2 C_p \sqrt{\frac{2 \ln N_p}{N_n}}$$
其中：
- $\bar{X}_n$：当前节点方案的平均综合评分；
- $N_p$：父节点的总访问次数；
- $N_n$：当前子节点的访问次数；
- $C_p$：探索权衡系数（默认配置为 $\frac{1}{\sqrt{2}} \approx 0.707$）。

### 6.2 综合质量启发式评估模型
对于每个 Agent 生成的候选重构分支，投影至隔离沙箱并运行物理验证命令（如 lint/test），结合 AST 结构收益计算综合得分 $S \in [0, 100]$：
$$S = \text{BaseScore} + w_1 \cdot \Delta \text{CC} + w_2 \cdot \Delta \text{Depth} - w_3 \cdot \Delta \text{Alloc} - \text{Penalty}_{\text{fail}}$$
- **圈复杂度改善量（$\Delta \text{CC}$）**：函数级 CC 降低奖励；
- **嵌套深度压缩量（$\Delta \text{Depth}$）**：消除深层嵌套奖励；
- **物理测试一票否决**：若验证命令退出码非 0，直接施加严厉惩罚并标记分支不可行。

### 6.3 探索流程状态机
1. **Fork**：为新候选策略分叉一个干净的虚拟工作区分支；
2. **Mutate**：Agent 应用 AST 重构算子或补丁变动；
3. **Evaluate**：投影至沙箱运行测试，计算质量得分；
4. **Backpropagate**：沿 MCTS 祖先节点回传评分并更新访问计数；
5. **Prune & Commit**：完成预定轮次探索后，挑选 UCT 最高分节点作为优胜方案合并至主分支，其余淘汰分支的临时工作区直接物理析构。

---

## 7. 开发者 SDK 门面调用范式 (`PraxisReviewClient`)

`PraxisReviewClient` 封装了全套 LayerVFS 与工作区管理能力：

```typescript
import { createPraxisClient } from "auto-refactor/praxis";

const client = createPraxisClient({ rootDir: process.cwd() });

// 1. 获取工作区管理器
const workspaceManager = client.getWorkspaceManager();

// 2. 创建或分叉隔离工作区
const baseWorkspace = await client.createWorkspace({
    workspaceId: "agent-session-root",
    sourceDir: "./src"
});

// 3. 微秒级分叉候选探索工作区
const candidateA = await baseWorkspace.fork("candidate-strategy-a");
await candidateA.writeFile("core/parser.ts", optimizedCode);
const snapshot = await candidateA.createSnapshot("pre-bench");

// 4. 沙箱物理投影与验证
const projection = await candidateA.project();
const testResult = await projection.run("npm test");
if (testResult.exitCode !== 0) {
    // 方案未通过，原子回滚至快照或放弃
    await client.revertWorkspace("candidate-strategy-a", snapshot.id);
}
await projection.cleanup();
```

---

## 8. 自动化测试与工程验收

LayerVFS 与 MCTS 体系拥有独立完备的自动化测试套件：
- `tests/praxis-vfs.test.ts`：FastCDC 切块边界、CAS 去重存储、工作区分叉、快照与回滚微秒级断言；
- `tests/praxis-mcts.test.ts`：MCTS 树构建、UCT 选择逻辑、沙箱投影执行与最优路径剪枝断言；
- `tests/praxis-client.test.ts`：Praxis 客户端 SDK 对接 LayerVFS 的端到端协同验证。

全量测试纳入 `npm test` 矩阵（157/157 独立测试套件 100% 绿色通行）。
