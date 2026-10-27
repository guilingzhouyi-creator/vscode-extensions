---
name: auto-refactor-dev
description: >-
  【触发：auto重构/分析器/内核/Praxis/重构引擎/双轨等价/流水线】开发、修改或测试 auto-refactor 项目代码时必须使用。看守 Rust 与 TS 双轨 100% 字节等价、四阶段流水线拓扑、Diff 引擎与暂存落盘规范。
---

# auto-refactor-dev — 静态重构引擎、双轨算子与 Praxis SDK 开发规范

本技能规范了 `auto-refactor/` 的六层架构、Rust+TS 双轨 100% 字节等价、<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->内置分析器四阶段流水线（Stage 0~3）、<!-- METRICS:BEGIN rule-auto-refactor -->**374 条规则**<!-- METRICS:END rule-auto-refactor -->治理体系（<!-- METRICS:BEGIN test-suite-count -->**180 套**<!-- METRICS:END test-suite-count -->测试）、Praxis 客户端 SDK 与一体两面三层拓扑 Diff 引擎。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 自动重构内核（领域入口） |
| **前置** | —（作为领域入口，无前置） |
| **接续** | [rust-engineering](../rust-engineering/SKILL.md) |
| **并行支援** | [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[coding-craft](../coding-craft/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[constraint-driven-development](../constraint-driven-development/SKILL.md) |
| **领域链** | 自动重构内核：auto-refactor-dev → rust-engineering → algorithmic-operator-engineering → telemetry-statistical-modeling → test-benchmark-engineering |

**何时联动**：新增分析器或规则 → `auto-refactor-dev` + `rule-catalog-governance` + `test-benchmark-engineering`；Rust 与 TypeScript 输出字节不等价 → `auto-refactor-dev` + `rust-engineering` + `debugging-and-error-recovery`
<!-- SKILL-LINKS:END -->

## 一、 六层架构、Rust+TS 双轨等价性与项目中立公理

1. **六层架构**：L1 原生算子（`crates/ops-{diff,graph,pattern,mask,clone}`）$\to$ L2 统一语法树与 8 语言 `SemanticGraph` $\to$ L3（<!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->分析器与 <!-- METRICS:BEGIN rule-auto-refactor -->**374 条规则**<!-- METRICS:END rule-auto-refactor -->）$\to$ L4 Sparse MoE 路由器与 `<10ms` AST 切片 $\to$ L5 10 支柱质量与 CAI 2.0 演化平面 $\to$ L6 Praxis 交付层；
2. **Rust+TS 100% 字节等价铁律**：Rust N-API 算子与 `src/core/native/*-shim.ts` 在 JSON 键序、UTF-8/LF 行列偏移、支配树排序与 4 位浮点精度上必须 100% 等价（由 `validate-native-parity.js` 与 `validate-equivalence.js` 看守）；
3. **项目中立性刚性公理 (`validate-project-neutrality.js`)**：核心分析器与规则严禁硬编码外部特定业务路径（如 `WebGames/` 或 `workspace-timing/` 私有模块名），框架规则仅能通过标准配置指纹（`project.godot`、`package.json`、`go.mod`）推断 `Archetype Context`。

---

## 二、 四阶段分析器流水线拓扑 (Stage 0 ~ Stage 3)

`analyzer-registry.ts`、`config/config.ts`、`router/sparseRuleRouter.ts` 三位一体按 Stage 0~3 单调有序装配：

| 流水线阶段 | 分析器名称 (`AnalyzerId`) | 阶段特征与核心职责 |
| :--- | :--- | :--- |
| **Stage 0: 物理底线与紧急安全** | `hygiene`, `shell-lint`, `shell-safety`, `large-file`, `secrets`, `security` | 字节流毫秒级短路；空文件/换行、Shell 污点删除守卫、双轨体积、密钥与注入拦截 |
| **Stage 1: 词法符号与文档** | `comments`, `naming`, `constants`, `docs`, `production-hygiene` | 词法 Token 状态机；六字段注释/ECR、命名风格、魔法常量、JSDoc 同步与调试残留 |
| **Stage 2: 单文件 AST 与现代化** | `simplify`, `complexity`, `stdlib`, `ts-modern`, `python-modern`, `rust-modern`, `gdscript-modern`, `go-modern`, `frontend` | 单文件 AST 与控制流图（`<10ms` 切片）；平铺逻辑、$\text{CC}\le 15 / \text{Depth}\le 4$、多语言现代惯用法 |
| **Stage 3: 全工程语义图拓扑** | `performance`, `architecture`, `data-architecture`, `dependency-layout`, `dependency-graph`, `gate-architecture`, `gdscript-game`, `vscode-extension`, `client-exposure`, `test-modernity`, `governance` | 跨文件 `SemanticGraph`（Tarjan SCC / 支配树）；循环零分配、门面承载、依赖环、目录隔离、单源规则核验 |

- **规则登记**：遵循 `FAMILY-TOPIC-NNN`，同步注册于 `src/core/rules/`、`dimensionRuleTable.ts`（单 Finding 扣分维度 $\text{AxesPerFinding} \le 4$）与 `scripts/common/rule-catalog.json`；所有 `scripts/validate-*.js` 必须在 `scripts/test-parallel.js`（<!-- METRICS:BEGIN test-suite-count -->**180 套**<!-- METRICS:END test-suite-count -->测试）显式纳管（`validate-suite-manifest.js`）。

---

## 三、 Praxis SDK、一体两面 Diff、守护进程与热路径 12 范式

1. **Praxis SDK 与一体两面三层拓扑 Diff**：`createPraxisClient` 提供 `reviewWorkspace` / `reviewFile` / `reviewDiff` / `evaluateMergeGate`，生成机器面（`DiffAgentFace`）与人类面（`DiffHumanFace`）对称的三层 Diff（L1 构建单元 $\to$ L2 反向依赖闭包 $\to$ L3 冲突/破坏风险 `shouldEscalateToL3A`），并在 `semantic-correlation.ts` 中基于并查集对 11 组重叠规则聚类选举主卡片（`electPrimaryCard`）；
2. **守护进程与暂存落盘契约**：常驻守护进程严禁阻塞 `*Sync` I/O（`PRF-IO-001`），同步 I/O 经 `*IoBarrier` 封装且同步方法物理排在 `async` 之前；IPC 指令顶部常量聚类（`NAM-LEN-002`）；时间戳统一以 `*Ms` 结尾并采用 `Brand<T, B>` 名义烙印；落盘区分 `stagingPath` 与 `compactStagingPath` 并执行原子 `rename`；
3. **热路径与避免重复开销**：通过 MoE 稀疏路由、三级拓扑缓存、Worker 双缓冲 + Transferable `ArrayBuffer` 零拷贝、单趟 AST 磁带融合及 12 项内存范式（单指针队列 `queue[head++]`、显式栈三色 DFS、`nodesByFile` 倒排索引、`cachedLines`、`charCodeAt` 首字符 $O(1)$ 分发、紧凑 `ActiveHook[]`）消除冗余计算。

---

## 四、 验证命令与关联资产

```bash
cd auto-refactor && npm run build && npm run gate && npm test && node scripts/bench-hot-paths.js
```

- [praxis-client-and-diff-topology.md](references/praxis-client-and-diff-topology.md)：Praxis SDK 接口、一体两面三层 Diff、表现层并查集去重与 Rust+TS 字节等价矩阵；
- [type-level-engineering-and-caching.md](references/type-level-engineering-and-caching.md)：名义量纲烙印（`Brand<T, B>`）、四重避免重复开销架构与热路径 12 项内存治理范式；
- [analyzer-boilerplate.ts](templates/analyzer-boilerplate.ts) / [validate-suite-boilerplate.js](templates/validate-suite-boilerplate.js)：静态分析器与专项回归测试套件标准样板。
