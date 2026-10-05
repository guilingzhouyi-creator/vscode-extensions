---
name: auto-refactor-dev
description: >-
  auto-refactor 静态分析重构引擎、Rust+TS 双轨内核与多智能体治理开发规范。指导 Agent 在
  auto-refactor 项目中开发分析器与规则、保证 Rust 算子与纯 TS 桥接 100% 字节等价、
  落实项目中立性护栏、零孤儿测试注册以及三平面质量度量演化。
---

# auto-refactor-dev — 静态重构引擎与双轨算子开发规范

本技能规范了 `auto-refactor/` 静态代码分析与治理引擎的核心架构原则、双轨算子等价性约束、分析器扩展规范及质量度量标准。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改静态代码分析器**（`src/analyzers/*.ts`）；
2. **注册或调整规则元数据**（`src/core/rules/` 与 `dimensionRuleTable.ts`）；
3. **开发 Rust N-API 原生算子或更新纯 TS Shim 回退实现**（`crates/` 与 `src/core/native/`）；
4. **调整 AST 局部切片或 Sparse MoE 路由器**（`src/core/ast/`、`src/core/router/`）；
5. **维护质量模型、演化轨迹账本或 Praxis 交付子系统**。

---

## 二、 六层技术架构与 Rust+TS 双轨内核等价性

`auto-refactor` 采用 TypeScript 调度编排与 Rust N-API 原生算子内核结合的双轨架构：
- **L1 原生算子层**：`crates/auto-refactor-core` 与 `crates/ops-{diff,graph,pattern,mask,clone}`；
- **L2 语法与语义层**：`NormalizedNode` 统一语法树与 `SemanticGraph` 跨语言（8 种语言）图底座；
- **L3 规则与分析器**：26 个分析器包与规则金字塔；
- **L4 调度与快轨**：Sparse MoE 变更熵密门禁路由器与 `<10ms` AST 切片快轨；
- **L5 质量度量平面**：静态（10 支柱）+ 动态证据 + 演化（CAI 指数）；
- **L6 Praxis 交付层**：多 Agent 冲突仲裁、轨迹配方学习与级联回滚。

### 刚性等价性铁律：
Rust 原生算子（64-bit SWAR、Bit-Parallel Myers 差分、Tarjan SCC、词法脱敏状态机、MinHash+LSH）与纯 TypeScript 回退实现（`src/core/native/*-shim.ts`）在输出数据结构、行号平移、哈希值以及错误边界上必须保持 **100% 语义与字节等价**，受 `validate-native-parity.js` 与 `validate-equivalence.js` 持续看守。

---

## 三、 四层规则金字塔与分析器开发纪律

1. **规则金字塔分层**：
   - Layer 1（通用基础）：格式、命名、注释、死代码；
   - Layer 2（工程架构）：分层依赖、门面承载、不可变封装；
   - Layer 3（语言进阶）：TS 现代特性、Python 生成器、Rust 借用安全；
   - Layer 4（演化自治）：代码自治度（CAI）、重构收益判定（ROI）、防刷分去抖。
2. **规范命名与单源登记**：
   - 规则 ID 必须遵循 Canonical 格式 `FAMILY-TOPIC-NNN`（如 `ARCH-FAC-001`、`GATE-AST-001`、`ADV-PRF-002`）；
   - 新增规则必须在 `src/core/rules/` 的模块字典中登记并 export，同步登记至 `src/core/scoring/dimensionRuleTable.ts` 确定扣分维度与权重；
3. **单分析器扣分预算红线**：
   - 单个分析器单次 Finding 扣分轴数上限严格受限：$$\text{AxesPerFinding} \le 4$$ 严禁单一违规向全维度大面积滥扣分。

---

## 四、 项目中立性守卫与零孤儿单测契约

1. **项目中立性守卫 (`validate-project-neutrality.js`)**：
   - `auto-refactor` 定位为通用多语言分析与治理引擎，分析器代码中严禁写入特定业务仓库路径（如硬编码某个业务子项目名或专属目录路径）；
   - 若需针对特定框架（如 Godot 或 VS Code 扩展）进行分析，必须通过探测标准配置标记（如 `project.godot` 或 `vscode` 依赖）进行通用架构特征推断（Archetype Context）。
2. **测试防孤儿纳管契约**：
   - 新增验证脚本（`scripts/validate-*.js`）必须在 `scripts/test-parallel.js` 或串行测试列表中显式登记；
   - 运行全量测试时，未纳管脚本将被 `validate-suite-manifest.js` 判定为孤儿脚本并一票阻断。

---

## 五、 三平面质量模型与长期演化账本

1. **静态度量平面**：十维质量模型（格式纯净度、类型健全度、架构拓扑度、认知复杂度等），采用倒数型密度饱和曲线与短板加权模型；
2. **演化自治指数 (CAI)**：长期度量 Agent 独立提交的通过率、回归率与重构良品率；
3. **分层滚动持久化**：
   - 质量轨迹持久化存储至 `.refactor-trajectory/`，采用紧凑 NDJSON 格式（单条记录 $<350\text{B}$）；
   - 长期总空间预算约束在 $\le 2\text{MB}$，自动按周/月进行滚动压缩与归档。

---

## 六、 专属构建、测试与门禁命令矩阵

在 `auto-refactor` 目录中作业时，遵循以下执行步骤：

```bash
# 进入项目目录
cd auto-refactor

# 1. 编译 TypeScript 源码至 dist/
npm run build

# 2. 运行本地轻量快速门禁（语法、命名、跳板与中立性检查）
npm run gate

# 3. 运行全量自测套件（140+ 专项校验套件并发执行）
npm test

# 4. 执行多维基准性能评测
npm run benchmark
```
