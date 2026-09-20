# 系统架构总览 (System Architecture Overview)

> **所属模块**：`01-architecture`  
> **核心源码**：`src/core/scanner/`, `src/core/pipeline/dualTrackPipeline.ts`, `src/core/router/sparseRuleRouter.ts`, `src/api.ts`, `src/index.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 系统定位与核心设计哲学

`auto-refactor` 是一个**高性能、声明式、项目无关且面向 CI/CD 与 IDE 的自动化代码审查与静态质量分析引擎**。其核心哲学是：

1. **确定性与零黑话（Determinism & Clean Terminology）**：严格遵循单一真源，不依赖随机性，不使用任何临时批次黑话标记；
2. **零堆分配与高承压（Zero Transient Heap Allocation）**：核心遍历与高频规则扫描采用单例复用与不可变切片，拒绝热路径临时对象膨胀；
3. **分层稀疏计算（Sparse MoE Execution）**：通过 AST 切片与特征提取器（CED），在前台极速跳过无需激活的重型分析器；
4. **多语言大一统拓扑（Universal Multi-Language Semantic IR）**：通过 `NormalizedNode` 抹平 TypeScript、Python、Rust、GDScript 与 Markdown 的语法树差异。

```
                       【auto-refactor 系统全景架构】
  ┌── 入口层 (CLI / API / Daemon IPC) ─────────────────────────────────────┐
  │     auto-refactor scan       scanWarm()       scanDiff() / scanDiffDelta│
  └── (入参分发: CLI / API / IPC) ────┬────────────────────────────────────┘
                                      ▼
  ┌── DualTrack Pipeline 非对称双轨执行流水线 ──────────────────────────────┐
  │  ┌───────────────────────────────┐  ┌────────────────────────────────┐ │
  │  │ FastTrack 前台快轨 (< 15ms)    │  │ DeepTrack 后台深轨 (全量图分析)│ │
  │  │ • Sparse MoE CED 稀疏条件路由  │  │ • 全量 AST 依赖图与反向调用链   │ │
  │  │ • 纯字面量突变绕过 70% 分析器  │  │ • 跨文件语义切片自审闭包       │ │
  │  │ • 投机性预判与即时响应反馈    │  │ • 深度复杂度与架构环路检测     │ │
  │  └───────────────────────────────┘  └────────────────────────────────┘ │
  └── (路由决策: FastTrack / DeepTrack) ──┬────────────────────────────────┘
                                          ▼
  ┌── 核心调度与增量缓存 (Scanner Engine) ─────────────────────────────────┐
  │  • L1 内存缓存 (毫秒级 mtime+size 判定)   • L2 磁盘持久缓存 (ContentHash)│
  │  • 非对称探针 (CacheProbe 流水线)        • 内存自愈看守 (RSS Self-Healing)│
  │  • 多核并发 Worker 调度池 (WorkerPool)   • AST 语义切片提取器与自审门禁  │
  └── (缓存复用与多核并发分发) ───────────┬────────────────────────────────┘
                                          ▼
  ┌── 多语言语法解析与 AST 适配层 (Adapters) ──────────────────────────────┐
  │  • TypeScript 适配器 (TS API)            • Rust oxc-parser 极速流式解析│
  │  • Python (Tree-Sitter Python)           • Rust (Tree-Sitter Rust)     │
  │  • GDScript (Godot 语法适配)             • Markdown (文档规范解析器)   │
  │  • 零物化懒投影机制 (NodeProjector)      • 64-bit SWAR / SIMD 向量加速 │
  └── (归一化 NormalizedNode 投影) ───────┬────────────────────────────────┘
                                          ▼
  ┌── 四层规则金字塔 (Four-Layer Rule Pyramid) ───────────────────────────┐
  │  • Layer 1: 全域安全与凭据扫描 (Security / Secrets)                    │
  │  • Layer 2: 领域原型与架构约束 (Architecture / Dependency Graph)       │
  │  • Layer 3: 工业级工程与全域治理 (Governance 22 类 / Hygiene / Comments)│
  │  • Layer 4: 项目定制与多维评分 (10 战略质量维度 / 门禁阈值 / 声明式策略) │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心执行模式 (Execution Modes)

引擎根据环境入参和上下文智能决策最优执行路径：

| 模式 | 触发机制 | 架构特性与延迟指标 |
| :--- | :--- | :--- |
| **冷扫描 (Cold Scan)** | 首次启动或显式传递 `cache: false` | 全量遍历与 AST 解析，输出全量基准报告，建立 L1/L2 缓存基线。 |
| **热扫描 (Warm Scan)** | 默认开启 `cache: true` | 通过 L1 `mtime+size` 与 L2 `ContentHash` 双重校验，跳过未修改文件，毫秒级响应。 |
| **Diff 增量扫描 (Diff Scan)** | 调用 `scanDiff()` / `scanDiffDelta()` | 接收 Git Diff 补丁，行级增量子树复用（`reuseSubtree`），精准判定受影响范围。 |
| **DualTrack 非对称扫描** | 调用 `scanAsymmetric()` | 前台 FastTrack（Sparse MoE 稀疏激活）$<15\text{ms}$ 返回投机结论，后台异步完成 DeepTrack 深度校验。 |
| **Daemon 守护进程** | `--daemon` 或连接 IPC 管道 | 预热 Node.js 虚拟机、V8 JIT 及 Native 模块，通过 NDJSON 管道实现 $<10\text{ms}$ 极致响应。 |

---

## 3. 并发调度与 Worker 线程池

* **自适应并发度**：默认并发数为 `os.cpus().length`，支持通过 CLI 参数 `--workers` 或配置文件自由调控。
* **分块流式派发（Chunked Batching）**：主调度器根据文件大小与 AST 复杂度动态计算加权批次，避免 Worker 饥饿或单核过载。
* **Native 模块按需懒装载**：Worker 线程内部对重型 Native 解析库（`oxc-parser`、`tree-sitter`）执行延迟装载，降低基础内存占用。

---

## 4. 内存自愈与稳定性保障 (RSS Self-Healing)

在大规模项目（成千上万文件）持续扫描或长周期守护进程运行场景下，V8 堆内存容易出现碎片化膨胀。系统内置严格的内存自愈契约：

* **常驻内存监控**：主进程周期性采样 RSS（Resident Set Size）；
* **自动驱逐与回收**：当 RSS 超过配置的安全阈值（默认 512MB）时，系统自动释放空闲 Worker 进程池并清空 AST 子树缓存，主动触发强制垃圾回收，杜绝进程 OOM。

---

## 5. 跨模块治理与演化感知

系统深度整合 Praxis 与智能体工程规范：
* **多 Agent 协同治理 (`GOV-AGN-001`)**：检测多智能体并发改动造成的循环依赖、分层倒置或公共契约漂移；
* **AST 切片增量自审 (`GOV-SLC-001`)**：毫秒级捕获破坏性函数签名漂移与副作用扩散；
* **重构轨迹配方学习 (`GOV-TRJ-001`)**：追踪 Bad $\to$ Good 演进轨迹，拦截循环修改震荡与反模式复燃。
