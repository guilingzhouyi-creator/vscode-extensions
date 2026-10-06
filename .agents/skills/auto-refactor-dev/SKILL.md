---
name: auto-refactor-dev
description: >-
  auto-refactor 静态分析重构引擎、Rust+TS 双轨内核与多智能体治理开发规范。指导 Agent 在
  auto-refactor 项目中维护 27 分析器与 304 条规则体系、保证 Rust 算子与纯 TS 桥接 100% 字节等价、
  落实项目中立性护栏、基线自审报告复用机制、生产命名规范化与三平面质量度量演化。
---

# auto-refactor-dev — 静态重构引擎与双轨算子开发规范

本技能规范了 `auto-refactor/` 静态代码分析与治理引擎的核心架构原则、双轨算子等价性约束、27 分析器与 304 条规则治理体系、基线自审报告复用、生产命名规范以及质量度量标准。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新增或修改静态代码分析器**（27 个分析器，`src/analyzers/*.ts`）；
2. **注册或调整规则元数据**（304 条内置规则，`src/core/rules/` 与 `dimensionRuleTable.ts`）；
3. **开发 Rust N-API 原生算子或更新纯 TS Shim 回退实现**（`crates/` 与 `src/core/native/`）；
4. **调整 AST 局部切片或 Sparse MoE 路由器**（`src/core/ast/`、`src/core/router/`）；
5. **维护质量模型、基线自审复用、演化轨迹账本或 Praxis 交付子系统**。

---

## 二、 六层技术架构与 Rust+TS 双轨内核等价性

`auto-refactor` 采用 TypeScript 调度编排与 Rust N-API 原生算子内核结合的双轨架构：
- **L1 原生算子层**：`crates/auto-refactor-core` 与 `crates/ops-{diff,graph,pattern,mask,clone}`；
- **L2 语法与语义层**：`NormalizedNode` 统一语法树与 `SemanticGraph` 跨语言（8 种语言）图底座；
- **L3 规则与分析器**：27 个分析器与 304 条规则金字塔治理体系；
- **L4 调度与快轨**：Sparse MoE 变更熵密门禁路由器与 `<10ms` AST 切片快轨；
- **L5 质量度量平面**：静态（10 支柱）+ 动态证据 + 演化（CAI 指数）；
- **L6 Praxis 交付层**：多 Agent 冲突仲裁、轨迹配方学习与级联回滚。

### 刚性等价性铁律：
Rust 原生算子（64-bit SWAR 向量化扫描、Bit-Parallel Myers 差分、Tarjan SCC / 支配树、词法脱敏状态机、MinHash+LSH）与纯 TypeScript 回退实现（`src/core/native/*-shim.ts`）在输出数据结构、行号平移、哈希值以及错误边界上必须保持 **100% 语义与字节等价**，受 `validate-native-parity.js` 与 `validate-equivalence.js` 持续看守。

---

## 三、 四层规则金字塔与分析器开发纪律 (27 分析器 · 304 规则)

1. **规则金字塔分层**：
   - Layer 1（通用基础）：格式、命名、注释、死代码；
   - Layer 2（工程架构）：分层依赖、门面承载、不可变封装；
   - Layer 3（语言进阶）：TS 现代特性、Python 生成器、Rust 借用安全；
   - Layer 4（演化自治）：代码自治度（CAI）、重构收益判定（ROI）、防刷分去抖。
2. **规范命名与单源登记**：
   - 规则 ID 必须遵循 Canonical 格式 `FAMILY-TOPIC-NNN`（如 `ARCH-FAC-001`、`GATE-AST-001`、`ADV-PRF-002`、`CPX-SPACE-001`）；
   - 新增规则必须在 `src/core/rules/` 导出，同步登记至 `src/core/scoring/dimensionRuleTable.ts` 确定扣分维度与权重，并在 `scripts/common/rule-catalog.json` 单一真源中完备登记；
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

## 五、 基线自审报告复用机制

为了消除重复全仓 AST 扫描带来的性能损耗，建立基线自审报告复用标准：
1. **消除无谓重复开销**：全仓全量自审（`runSelfAudit()`）涉及 27 个分析器与 304 条规则遍历，完整执行耗时约 14s。在常规门禁与增量校验时，禁止重复运行全量 `runSelfAudit()`；
2. **基线报告快照复用**：
   - 优先读取已生成的基线自审报告快照（`.refactor-cache/baseline-self-audit.json`）；
   - 校验流程仅需对暂存区增量文件执行 AST 局部切片比对与差分分析，将增量审计时间压缩在 100ms 以内；
3. **缓存失效与强制重建条件**：
   - 当检测到底层规则定义（`src/core/rules/`）、分析器实现（`src/analyzers/`）或原生算子（`crates/`）发生文件变更时，自动触发基线报告全量重建；
   - 允许显式传递 `--force-audit` 参数强制刷新基线报告。

---

## 六、 生产命名规范化与传输协议勘误

1. **暂存路径精确语义分流**：
   - `stagingPath`：指代存放完整未压缩构建或分析阶段产物的标准暂存目录；
   - `compactStagingPath`：指代执行了脱敏、去冗余与规格化折叠的紧凑暂存路径；
   - 严禁模糊使用 `tmp`、`stage`、`tempDir` 等含义不明的命名；
2. **高精度时间戳命名契约**：
   - 解析与测量阶段统一采用 `parseStartTimeMs`，显式标注操作语义与毫秒（Ms）物理单位；
   - 杜绝 `startTime`、`time`、`ts` 等缺乏时间量纲与语义上下文的缩写；
3. **PR50 传输协议勘误与契约加固**：
   - 跨 Worker / 跨进程消息通信严格对齐数据载荷字段结构，彻底纠正早期协议中有效载荷长度与状态解析的边界漂移；
   - 消息协议严格遵循不可变冻结，序列化与反序列化双端强制执行契约断言。

---

## 七、 三平面质量模型与长期演化账本

1. **静态度量平面**：十维质量模型（格式纯净度、类型健全度、架构拓扑度、认知复杂度等），采用倒数型密度饱和曲线与短板加权模型；
2. **演化自治指数 (CAI)**：长期度量 Agent 独立提交的通过率、回归率与重构良品率；
3. **分层滚动持久化**：
   - 质量轨迹持久化存储至 `.refactor-trajectory/`，采用紧凑 NDJSON 格式（单条记录 $<350\text{B}$）；
   - 长期总空间预算约束在 $\le 2\text{MB}$，自动按周/月进行滚动压缩与归档。

---

## 八、 自研率客观统计与贝叶斯数学模型规范 (CAI 2.0)

1. **从 0 客观统计原则**：
   - 符号调用统计必须从 0 累加，严禁对内部调用引入倍率乘数（如乘 2）或保底加分（如加 5）；
   - 外部 SDK 调用必须基于全局 AST 符号索引（`symbolIndex`）获取真实交叉调用点频次，杜绝简单正则粗暴匹配；
2. **主流严谨贝叶斯统计数学模型**：
   - 废除写死固定常数的误差区间（如 `margin = 2.5%`）；
   - 采用经典无信息 Jeffreys 先验 $\text{Beta}(0.5, 0.5)$ 的二项分布共轭后验推断：
     $$\alpha = 0.5 + k, \quad \beta = 0.5 + (n - k)$$
   - 基于后验方差 $\text{Var}(\theta) = \frac{\alpha \beta}{(\alpha+\beta)^2(\alpha+\beta+1)}$ 动态计算 95% 贝叶斯可信区间 $[ \mu - 1.96\sigma, \mu + 1.96\sigma ]$。

---

## 九、 静态分析器上下文感知与假告警抑制规范

1. **基于文件角色（FileRole）的语义免检**：
   - 测试套件（`test_suite`、`*.test.*`、`*.spec.*`）豁免字面量和魔法数字抽取规则，保护单测断言清晰度；
   - 国际化字典文件（`i18n`、`locales`、`zh-CN.json` 等）豁免硬编码字符串抽取，字典本身即常量真源；
2. **运行时调用上下文白名单**：
   - 日志打印（`console.*`、`logger.*`）与异常抛出（`new Error(...)`）入参字符串自动跳过常量提取；
   - 复杂分析器内部必须将大函数提取为高内聚辅助函数，确保圈复杂度 $\text{CC} \le 12$。

---

## 十、 专属构建、测试与门禁命令矩阵

在 `auto-refactor` 目录中作业时，遵循以下执行步骤：

```bash
# 进入项目目录
cd auto-refactor

# 1. 编译 TypeScript 源码至 dist/
npm run build

# 2. 运行本地轻量快速门禁（语法、命名、跳板与中立性检查）
npm run gate

# 3. 运行全量自测套件（140+ 专项校验套件并发执行，支持基线复用）
npm test

# 4. 执行多维基准性能评测
npm run benchmark
```
