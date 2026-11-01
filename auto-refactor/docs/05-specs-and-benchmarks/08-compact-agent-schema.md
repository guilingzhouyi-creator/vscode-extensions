# 智能体原生审查架构契约 (Agent Audit Schema v1.0 - AAS)

> **适用版本**：`auto-refactor` v0.4.0 及以上  
> **入口命令**：`auto-refactor scan --format aas`（别名 `--format compact` 已收敛至 AAS）  
> **核心模块**：[`aas-types.ts`](../../src/core/reporting/aas-types.ts) · [`aas-reporter.ts`](../../src/core/reporting/aas-reporter.ts)

---

## 一、 为什么需要智能体原生审查契约

在智能体主导的持续工程治理中，传统基于冗余 JSON 的审查结果存在严重痛点：
1. **Token 浪费严重**：数千个文件的全量 `ScanReport` 会重复携带成千上万次绝对文件路径、冗长的 JSDoc 模板与重复的上下文结构，单次审查倾倒消耗 50k~200k+ Tokens（数 MB），极易撑爆或污染模型注意力窗口。
2. **缺乏代码定位能力**：早期的纯数组向量（如已退役的 CAS v3 数组元组）虽压缩了体积，但完全剥离了代码上下文，模型必须进行二次读盘和行号对齐，大幅增加了交互延迟与幻觉风险。
3. **缺乏拓扑修复次序**：扁平的问题列表无法反映软件架构底层的单向依赖拓扑，导致智能体容易颠倒次序（如在修改底层契约前先去修高层业务，引发瀑布式级联报错）。

**AAS v1.0 (Agent Audit Schema)** 确立为全工作区智能体审查交互的唯一原生标准：
- **按文件聚合（File-Grouped）**：消除成千上万条重复路径字符串，以文件为单元聚合所有缺陷。
- **架构依赖拓扑严格排序（L1 $\to$ L5）**：缺陷文件按系统分层自底向上精准排序，指导智能体顺应单向依赖顺序开展修复。
- **内联高密度代码锚点（Code Anchor）**：自动提取违规点前后 1~2 行精准代码切片并标注 `> ` 指针，模型无需二次读盘即可直击缺陷核心。
- **结构化修复配方（Remediation Recipe）与定向复验指令**：每条缺陷内联可落盘的修复动作（`fix: { action, patch, template }`）与局部单测复验命令（`verify`）。
- **Token 大幅削减**：相比原始 Verbose 报告削减 **70% ~ 92%** 体积，将数十万 Token 的报告脱水至十余 KB 级别。

| 载体 | 典型体积 | 结构形态 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `json` (ScanReport) | 数百 KB ~ 数 MB | 完整 AST 对象树与逐条扣分审计链 | 离线离场归档、全量复盘 |
| `agent` (Markdown) | 数十 ~ 上百 KB | 渲染后的 Markdown 格式人类可读清单 | 人类审查交割、PR 描述 |
| **`aas` (AAS v1.0)** | **十余 KB ~ 百余 KB** | **拓扑排序、文件聚合、内联代码锚点与配方** | **智能体上下文注入、门禁前置判定、跨会话基线对比** |

---

## 二、 AAS v1.0 顶层结构约定

### 2.1 顶层信封规范

```json
{
  "schema": "aas-v1",
  "tool": "auto-refactor",
  "version": "0.4.0",
  "timestamp": "2026-10-25T19:40:00.000Z",
  "root": ".",
  "verdict": "WARN",
  "health": {
    "score": 99.19,
    "grade": "A+",
    "cai": 77.98,
    "counts": {
      "files": 755,
      "total": 3963,
      "errors": 0,
      "warns": 634,
      "info": 3329,
      "suppressed": 130
    },
    "tensorSummary": {
      "compositeDensity": 0.884,
      "tspr": 0.621,
      "por": 0.384,
      "columnDensity": 42.1,
      "spatialDensity": 0.812,
      "mahalanobisDistance": 1.15
    }
  },
  "defaultVerify": "npm test",
  "dimensions": {
    "arch": 98.22,
    "sem": 98.46,
    "sec": 99.79,
    "perf": 99.58,
    "std": 83.29,
    "mod": 98.49,
    "maint": 93.28,
    "doc": 99.98,
    "dup": 95.11,
    "debt": 100.0
  },
  "bottlenecks": [
    { "rule": "CMT-LNG-001", "dim": "std", "loss": 12.5, "count": 140 }
  ],
  "topology": {
    "L1_CONTRACT": ["src/core/cfg/types.ts"],
    "L2_INFRA": ["src/core/algorithms/hash.ts"],
    "L3_CONFIG": ["src/core/config/config-tuning.ts"],
    "L4_BUSINESS": ["src/analyzers/naming.ts"],
    "L5_GOVERNANCE": ["scripts/validate-self-audit.js"]
  },
  "files": {
    "src/core/cfg/types.ts": [
      {
        "line": 76,
        "col": 5,
        "rule": "HYG-CLN-001",
        "sev": "WARN",
        "msg": "Code clone detected: Block of 6 consecutive statements is highly duplicated with line 59",
        "anchor": "  59: function parseNode(node: AstNode): void {\n> 76: function parseNodeFallback(node: AstNode): void {",
        "fix": {
          "action": "sanitize_hygiene",
          "template": "Extract shared logic into a private helper function"
        },
        "verify": "npm test -- tests/unit/cfg.test.ts"
      }
    ]
  },
  "truncated": 0
}
```

---

## 三、 核心架构设计

### 3.1 架构分层自底向上拓扑优先级 (L1 $\to$ L5)

AAS v1.0 将所有文件按其架构依赖拓扑严格分级，并在 `files` 字典中自底向上排序：

1. **`L1_CONTRACT`**：类型定义、接口、常量 SSOT、基础协议。
2. **`L2_INFRA`**：算子、算法内核、AST 适配器、原生加速库。
3. **`L3_CONFIG`**：领域配置、规则目录映射、阈值级联。
4. **`L4_BUSINESS`**：分析器业务逻辑、检查器实现、门面聚合。
5. **`L5_GOVERNANCE`**：门禁脚本、文档、自审验证、元治理规则。

智能体必须严格按照 `L1 -> L2 -> L3 -> L4 -> L5` 的顺序执行修复，绝不可倒序操作。

### 3.2 高密度代码锚点（Code Anchor）

对于 `WARN` 与 `ERROR` 级缺陷，AAS 自动内联代码切片，格式为：
```text
  75: const prev = calculateHash(data);
> 76: const current = calculateHash(data);
  77: return prev === current;
```
- 带 `> ` 前缀的行即为违规行。
- 智能体直接利用上下文切片完成 AST 或文本修复，无需额外消耗 Tool Call 读盘。

### 3.3 5D 黎曼流形代码密度相空间张量

头部 `health.tensorSummary` 记录全工程在 5D 流形相空间中的坐标位置：
- $D_{\text{line}}$：行密度（有效代码行占物理行比例）。
- $D_{\text{col}}$：列密度（单行有效 Token 承载）。
- $D_{\text{reuse}}$：复用率（函数扇入与模块复用程度）。
- $D_{\text{shared}}$：接线率与领域集中度 ($\text{POR} \le 0.60, \text{TSPR} \ge 0.40$)。
- $D_{\text{payload}}$：语义有效载荷占比。
- **马氏距离 $D_{\text{mahalanobis}}$**：度量离理想引力解 $\mu_0$ 的距离，严防稀释与虚假重构。

---

## 四、 历史兼容层退役与单一协议收拢

在本次架构升级中，历史遗留的旧格式与兼容层已退役收拢：
1. **CAS v3.0 (`cas-v3`) 废弃**：
   - 仓内历史 `.cas.json` 侧车文件已清理，统一由 `*.aas.json` 承接。
   - `validate-sidecar-coverage.js` 门禁已切换为严格校验 AAS v1.0，检测到任何 `.cas.json` 即刻阻断。
2. **导出通道收拢**：
   - CLI 选项 `--format compact` 内部直接重定向至 `toAasJson`，双轨统一输出 `schema: "aas-v1"`。
3. **消除向后兼容包袱**：
   - 移除了冗余的历史别名（如 `recomputeSummary`、`byPosition`、`groupDuplicates`、`tokenizeIdentifier`）。
   - 治理文档与门禁措辞中清理过时陈述，确立 AAS v1.0 为全仓唯一的智能体审查交换协议。

---

## 五、 验证与自审守卫

```bash
# 验证 AAS 序列化与协议断言
node auto-refactor/scripts/validate-aas-reporter.js

# 验证全仓报告工件 100% 覆盖 AAS 侧车（禁止任何遗留 CAS）
node auto-refactor/scripts/validate-sidecar-coverage.js

# 验证系统自审基线与 AAS 报告生成
node auto-refactor/scripts/validate-self-audit.js
```
