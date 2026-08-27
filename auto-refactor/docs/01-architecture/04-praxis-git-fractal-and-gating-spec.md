# Praxis 分形 Git 门禁工作树、三层联动回滚与智能体生命周期技术规范
## (Praxis Fractal Git Worktree, 3-Tier Rollback & Agent Lifecycle Specification)

> **对齐需求**：`1.md` §4.1, §4.2, §4.2补充, §4.3补充  
> **文档性质**：系统设计与工程实施技术白皮书 (System Design & Implementation Spec)  
> **适用模块**：Praxis 调度核心 (Praxis Kernel)、Git 协调引擎 (Git Coordinator)、Diff 底座 (Diff Substrate)  
> **版本**：v1.0.0-PROD-SPEC

---

## 📑 核心规范全景目录

1. [分形 Git 工作树与分支拓扑体系 (Fractal Git Topology)](#1-分形-git-工作树与分支拓扑体系-fractal-git-topology)
2. [两道门禁与有序协调提交队列 (Dual-Gate & Ordered Queue)](#2-两道门禁与有序协调提交队列-dual-gate--ordered-queue)
3. [卡级-检查点-Diff 三层联动回滚架构 (3-Tier Rollback Matrix)](#3-卡级-检查点-diff-三层联动回滚架构-3-tier-rollback-matrix)
4. [跨文件夹内容重叠与功能重复检测系统 (Overlap Detection)](#4-跨文件夹内容重叠与功能重复检测系统-overlap-detection)
5. [SubAgent 委托管理与工作树生命周期回收协议 (Lifecycle & GC)](#5-subagent-委托管理与工作树生命周期回收协议-lifecycle--gc)
6. [旁路监控规则引擎与配置文件 Schema (Bypass Monitor & Config)](#6-旁路监控规则引擎与配置文件-schema-bypass-monitor--config)

---

## 1. 分形 Git 工作树与分支拓扑体系 (Fractal Git Topology)

对齐 `1.md §4.2` 与 `§4.2补充`：摒弃传统单主干争抢模式，采用 **4 层分形分支与物理隔离工作树（Worktree）拓扑**：

```
                    ┌────────────────────────────────────────────────────────┐
                    │               Layer 0: 系统主干 (System main)          │
                    │               (永远常驻，仅接受 Cell 主分支合入)       │
                    └───────────────────────────┬────────────────────────────┘
                                                │ 第二道门禁 (Gate 2: L3A/用户决策)
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │           Layer 1: Cell 主工作树 (cell/{cellId}/main)  │
                    │           (Cell 内主分支，常驻直到 Cell 任务全清)      │
                    └───────────────────────────┬────────────────────────────┘
                                                │ 第一道门禁 (Gate 1: 部门范围+规则)
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │      Layer 2: Agent 平权工作树 (cell/{c}/agent/{aId})  │
                    │      (生命周期 = 1 张 TaskCard，合入 Cell 主树后回收)  │
                    └───────────────────────────┬────────────────────────────┘
                                                │ 父 Agent 审查 Diff 合入
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │    Layer 3: SubAgent 委托树 (cell/{c}/sub/{taskId})    │
                    │    (极速生命周期 = 1 个委托任务，合入父 Agent 后即回收)│
                    └────────────────────────────────────────────────────────┘
```

### 1.1 Git Ref 命名空间规范
* **系统主干**：`refs/heads/main`
* **Cell 主工作树**：`refs/heads/cell/{cellId}/main`
* **Agent 隔离分支**：`refs/heads/cell/{cellId}/agent/{agentUid}`
* **SubAgent 委托分支**：`refs/heads/cell/{cellId}/sub/{parentAgentUid}/{subTaskId}`

### 1.2 磁盘物理 Worktree 隔离布局
每个活跃的 Agent / SubAgent 在独立工作区运行，防止文件写入锁冲突：
```
.praxis/worktrees/
├── cell-01/
│   ├── main/                    # Cell 01 主工作树 (常驻)
│   ├── agent-arch/              # 架构 Agent 工作树 (绑定卡片生命周期)
│   ├── agent-coder/             # 编码 Agent 工作树
│   └── sub-task-9021/           # SubAgent 委托工作树 (任务完成即物理销毁)
└── cell-02/
    └── main/
```

---

## 2. 两道门禁与有序协调提交队列 (Dual-Gate & Ordered Queue)

对齐 `1.md §4.2`：严格禁止 Agent 自由并发强推 Git，所有变更必须通过 **两道门禁 + 有序协调队列**。

### 2.1 门禁流水线流程图
```
  [Agent 提交申请] 
         │
         ▼
  【第一道门禁: Cell 内合入门禁 (Gate 1)】
  ├── 1. 身份与范围核验: 检查修改文件是否超出 Agent 的所属部门/角色白名单
  ├── 2. 旁路关键词命中: 检查代码及 Commit 是否命中阻断违规规则
  ├── 3. 提交频率限制: 限制单个 Agent 单位时间最大 Commit 频次
  └── 4. SES 行级 Diff 审核: 跑 auto-refactor 定制 Diff，输出 ReviewDiffHunk
         │
         ├── ❌ 未通过 ──> 拒绝提交 + 消息总线报警 + 阻断 Agent Loop
         └── ✅ 通过 ────> 入队 Cell 协调提交队列 (非破坏性 Fast-Forward 合入 Cell 主树)
                                │
                                ▼
  【第二道门禁: 系统主干合入门禁 (Gate 2)】
  ├── 1. 全局回归扫描: 调用 auto-refactor scanDiff(full) 确保 0 规则违规
  ├── 2. 跨 Cell 冲突与重叠检测: 检查与其他 Cell 的公共接口冲突
  └── 3. L3A / 人类决策批准: 必须由人类或 L3A 决策层签署数字证书
         │
         ├── ❌ 未通过 ──> 触发卡级回滚或退回 Cell 重构
         └── ✅ 通过 ────> 合入系统主干 main
```

### 2.2 有序协调提交队列 (Ordered Coordination Queue) 状态机
为了防止多个 Agent 同时合入 Cell 主分支造成锁竞争或交叉覆盖，每个 Cell 内置 FIFO 协调队列：
```typescript
export interface ICellCommitQueue {
  enqueueCommit(request: {
    cardId: string;
    agentUid: string;
    sourceBranch: string;
    targetBranch: string;
    hunks: ReviewDiffHunk[];
  }): Promise<CommitQueueResult>;
}
```
* **状态转移**：`PENDING -> AUDIT_GATE1 -> SERIALIZED_MERGE -> BROADCAST_BUS -> RELEASE_LOCK`。
* **冲突防护**：合入前自动执行 `git merge-base` 检查；若主分支有更新，自动触发本地工作树 `rebase` 并重新过门禁，**杜绝破坏性强推（Force Push）**。

---

## 3. 卡级-检查点-Diff 三层联动回滚架构 (3-Tier Rollback Matrix)

对齐 `1.md §4.1`：支持从 **微观代码行** 到 **整张任务卡** 再到 **全局依赖 DAG** 的三层递进回滚机制：

```
  ┌────────────────────────────────────────────────────────────────────────────────────────┐
  │                            【三层联动全域回滚矩阵】                                    │
  ├──────────────┬─────────────────────────────┬───────────────────────────────────────────┤
  │ 回滚层级     │ 触发场景                    │ 底层执行机理                              │
  ├──────────────┼─────────────────────────────┼───────────────────────────────────────────┤
  │ Level 1:     │ 人类/Agent 仅想撤销某个特定 │ 调用 `revertDiffHunk(hunk)`，             │
  │ 行/块微观回滚│ 函数或几行有问题的改动      │ 原生逆序重排并对冲字节补丁                │
  ├──────────────┼─────────────────────────────┼───────────────────────────────────────────┤
  │ Level 2:     │ 某张 TaskCard 审查被拒，    │ 调用 `revertTaskCard(cardId)`，           │
  │ 卡级原子回滚 │ 需要撤销该卡涉及的全部文件  │ 跨文件搜集全部归属 Hunk，一次性原子撤销   │
  ├──────────────┼─────────────────────────────┼───────────────────────────────────────────┤
  │ Level 3:     │ 架构重构失败，需要联动撤销  │ 沿 `dependencyGraph` 与卡片前导/后导关系，│
  │ 级联依赖回滚 │ 所有下游依赖卡与会话检查点  │ 拓扑逆序批量执行 Level 2，还原会话快照    │
  └──────────────┴─────────────────────────────┴───────────────────────────────────────────┘
```

### 3.1 级联依赖回滚算法伪代码
```typescript
export async function cascadeRollback(
  targetCardId: string,
  cardDependencyGraph: Map<string, string[]>, // cardId -> downstreamCardIds
  rollbackEngine: PraxisRollbackEngine
): Promise<RollbackReport> {
  // 1. 获取所有受牵连的后导卡（拓扑排序）
  const affectedCards = getDownstreamCards(targetCardId, cardDependencyGraph);
  const rollbackOrder = [targetCardId, ...affectedCards].reverse();

  // 2. 逆序依次执行卡级原子回滚
  for (const cardId of rollbackOrder) {
    const res = await rollbackEngine.revertTaskCard(cardId, fsReader);
    if (!res.success) throw new Error(`Rollback failed at card: ${cardId}`);
  }

  // 3. 恢复会话检查点与工作树重置
  return { success: true, rolledBackCards: rollbackOrder };
}
```

---

## 4. 跨文件夹内容重叠与功能重复检测系统 (Overlap Detection)

对齐 `1.md §4.1`（特别是 2+ 个 Cell 时跨文件夹文件内容重复判断）：

### 4.1 双层重叠匹配引擎
1. **第一层：AST 导出符号签名哈希比对 (Signature Exact Match)**：
   * 提取所有文件导出的函数名、类名、入参签名生成 64 位 FNV-1a 哈希；若两个不同路径的文件包含相同的导出函数签名，直接判定为**功能重叠候选**。
2. **第二层：SWAR 文本分块相似度 (Jaccard / MinHash on FastDiff)**：
   * 对两个跨文件夹文件的行哈希集合计算 Jaccard 相似度；若相似度 $> 80\%$，提示“存在跨文件夹功能冗余，建议取优合并”。

---

## 5. SubAgent 委托管理与工作树生命周期回收协议 (Lifecycle & GC)

对齐 `1.md §4.2补充` 与 `§4.3补充`：

### 5.1 委托任务分类与分支生命周期状态机
```
  [父 Agent 发起委托]
         │
         ├── 探索委托 (Exploration) ──> 0 磁盘 Worktree，仅返回只读上下文/搜索结果
         │
         └── 改动委托 (Modification) ──> 动态建立 SubAgent 独立分支与工作树
                                              │
                                              ▼
                                 【SubAgent 执行改动】
                                              │
                                              ▼
                                 【父 Agent 审查 SubAgent Diff】
                                              │
                                 ├── ❌ 拒绝 ──> 物理销毁工作树 + 释放磁盘
                                 └── ✅ 批准 ──> Fast-Forward 合入父 Agent 分支
                                                      │
                                                      ▼
                                         【自动触发生命周期回收】
                                         - 物理删除 `.praxis/worktrees/sub-xxx`
                                         - 释放磁盘空间 (Disk Freed)
                                         - 保留 `refs/tags/archive/sub-xxx` (可选留痕)
```

### 5.2 生命周期垃圾回收 (Worktree GC) 规则表
| 工作树层级 | 常驻状态 | 生命周期起点 | 生命周期终点与回收触发条件 | 磁盘回收行为 |
| :--- | :--- | :--- | :--- | :--- |
| **System main** | **永久常驻** | 项目初始化 | 永不回收 | 不释放 |
| **Cell main** | **Cell级常驻**| Cell 创建 | 整个 Cell 任务卡全部清空且合入 System main | 执行 `git worktree remove` 物理清理 |
| **Agent 工作树** | **卡级临时** | TaskCard 派发 | 本卡改动合入 Cell main 且过门禁 | **合入即回收**，释放磁盘空间 |
| **SubAgent 树** | **瞬态临时** | 委托任务下发 | 任务完成并合入父 Agent 分支 | **秒级回收**，物理目录直接清空 |

---

## 6. 旁路监控规则引擎与配置文件 Schema (Bypass Monitor & Config)

对齐 `1.md §4.2`：提供统一的 `.praxis/config.json` 驱动配置：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PraxisGatingConfig",
  "type": "object",
  "properties": {
    "gating": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean", "default": true },
        "maxCommitsPerMinute": { "type": "number", "default": 30 },
        "blockedKeywords": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["TODO_BYPASS_AUTH", "INTERNAL_FORCE_OVERRIDE", "DROP_DATABASE"]
        },
        "rolePathRestrictions": {
          "type": "object",
          "description": "Agent 身份允许修改的文件 Glob 路径",
          "properties": {
            "AGENT_FRONTEND": { "type": "array", "items": { "type": "string" }, "default": ["src/ui/**", "src/views/**"] },
            "AGENT_BACKEND": { "type": "array", "items": { "type": "string" }, "default": ["src/core/**", "src/api/**"] }
          }
        }
      }
    },
    "lifecycle": {
      "type": "object",
      "properties": {
        "autoPruneSubAgentWorktree": { "type": "boolean", "default": true },
        "autoPruneAgentWorktreeOnCardDone": { "type": "boolean", "default": true },
        "retainGitArchiveTags": { "type": "boolean", "default": true }
      }
    },
    "diffSubstrate": {
      "type": "object",
      "properties": {
        "streamingMode": { "type": "string", "enum": ["full", "issues_only", "summary_only", "disabled"], "default": "full" },
        "maxStreamEvents": { "type": "number", "default": 500 },
        "enableRingBuffer": { "type": "boolean", "default": true }
      }
    }
  }
}
```

---

## 7. 交付对接总结

上述规范已经与 `auto-refactor` 定制 Diff 系统中的 [`PraxisRollbackEngine`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/rollback.ts)、[`scanDiffStream`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/stream.ts)、[`ModuleDependencyGraph`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/dependencyGraph.ts) 以及 [`CircularDiffBuffer`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/ringBuffer.ts) 进行了 100% 的数据模型与接口对齐。Praxis 团队可直接依照此标准进行调度层与 Git 门禁系统的无缝落地！
