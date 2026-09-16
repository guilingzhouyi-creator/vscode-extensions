# auto-refactor 自身规范化：三问实测与自规范棘轮

**语料**：本项目 `src`（128 个 `.ts` / ~40k 行）
**新增**：`scripts/validate-self-norms.js` + `npm run validate-self-norms`（已接入 `npm test` 链）

---

## 一、直接回答三问（全部基于实测）

### 1.1 常量化改造：**规则体已经做完，不需要改**

对 `src/core/governance/rules/` 全目录扫描"用作阈值的内联数值比较"（排除注释行与命名常量声明行）：

| 文件 | 命名常量数 | **内联阈值比较** |
| :--- | ---: | ---: |
| `compressionBounds.ts` | 7 | **0** |
| `sanitization.ts` | 6 | **0** |
| `debugLogging.ts` | 5 | **0** |
| `fileStructure.ts` | 3 | **0** |
| `codeLogic.ts` | 2 | **0** |
| `typeSystem.ts` | 2 | **0** |
| `exceptionSafety.ts` | 1 | **0** |
| `maintainability.ts` / `performance.ts` / `standardization.ts` | 0 | **0** |

**10 个规则文件、内联阈值比较总计 0 处。** 后三个文件"0 命名常量"不是缺陷——它们的阈值来自
`ctx.ctx.options`（配置源），比命名常量更符合"单一策略源"。

> 仓库级的 `magic-number` 分析器在本仓库自身报出 **120 条**（`gate:self` 显示 8077 条 issue 中的一部分），
> 但均在 **warning 级**、不阻断。若要推进"仓库级常量化"，那 120 条才是工作面；**规则体这一层无需动。**

### 1.2 底座英文标准：**代码位置已经成立，注释层是待决项**

用**掩码视图**逐字符判定位置（掩码视图中为空格 ⇒ 该字符位于注释或字符串内；否则位于**代码位置**）：

| 层 | 文件 | **代码位置非 ASCII** | 注释/字符串内非 ASCII |
| :--- | ---: | ---: | ---: |
| `core (other)` | 77 | **0** | **4,121** |
| `cli+daemon` | 7 | **0** | 195 |
| `root/other` | 5 | **0** | 245 |
| `governance/rules` | 10 | **0** | 135 |
| `analyzers` | 17 | **0** | 91 |
| `core/messages` | 12 | **0** | 54 |

**结论（两点必须分清）**：

1. **代码位置 100% ASCII**——标识符、关键字、语法在全部分层零违例。所以"底座英文标准"在
   **代码层面已经成立**，不需要改造。
2. **非 ASCII 全部位于注释/字符串**，其中 **4,121 字符（占全部非 ASCII 的 85%）集中在 `src/core/**`**。
   若你所指的"底座英文标准"包含**注释也必须英文**，则 `src/core/**` 的注释层是唯一工作面。
   ⚠️ 但这是一项**需要你拍板的取舍**：本项目的文档与规则消息（`summary` / `remediation` /
   `suggestion`）都是中文，`core` 的注释若单独英文化会造成**同仓库双语混排**。我**没有擅自改动**。

### 1.3 规范化自身：**可以，已交付棘轮**

把两条**已经满足但无人看守**的规范 + 一条**债务棘轮**固化进验证器。三态均可失败：

| 检查 | 当前状态 | 意义 |
| :--- | :--- | :--- |
| ① `src/**` 代码位置必须 ASCII-only | **PASS（0 违例）** | 把"底座英文"从事实变成**棘轮**：任何新增的非 ASCII 标识符立即失败 |
| ② 规则体不得出现内联数值阈值 | **PASS（0 违例）** | 防止阈值重新散落回各规则体 |
| ③ 规则不得新硬编码路径片段 | **PASS**（4 个既有文件记为债务） | **允许清单即债务清单**：新增即失败，缩减是唯一方向 |

**关键设计**：判定用**共享掩码原语**而非正则——"某字符在掩码视图中的位置是否为空"正是"散文 vs 代码"的
分界，也恰是这两条规范所讨论的区分。这使验证器与上一轮建立的词法规范**同源**，而不是又一套独立判据。

实测输出：

```
=== Self Norms: language and constant discipline ===
  [PASS] ASCII-only at code positions
  [PASS] no inline numeric thresholds in rules
  [PASS] no new hardcoded path fragments

  recorded path-fragment debt (4 files, shrink-only):
      src/core/governance/rules/debugLogging.ts — index.ts/cli.ts/scripts/samples exemptions
      src/core/governance/rules/exceptionSafety.ts — fixture path exemptions
      src/core/governance/rules/fileStructure.ts — layout conventions
      src/core/governance/rules/sanitization.ts — test/benchmark corpus conventions

ALL SELF NORM CHECKS PASSED SUCCESSFULLY!
```

---

## 二、剩余工作面（按证据排序）

| 优先级 | 项 | 依据 | 性质 |
| :--- | :--- | :--- | :--- |
| 1 | **把 4 个文件的路径豁免改为可配置 glob** | ③ 的债务清单；且仓库**已有先例**：`thresholds.blockingIoAllowPatterns` 由 PRF-IO-001 与 GOV-PRF-004 共用，属单一策略源 | 使用者可声明，而非规则作者硬编码 |
| 2 | 14 条规则的语言声明收窄 | 上一轮审计 §1.2；**需先补各语言夹具** | 声明诚实性 |
| 3 | 节点规则去 AST 化 + 惰性物化 | 上一轮审计 §2，上限 88.9 ms（扫描的 14.3%） | 性能，结构改动 |
| 4 | `src/core/**` 注释是否英文化 | §1.2 的 4,121 字符 | **需你拍板**（会造成双语混排） |
| 5 | 仓库级 120 条 `magic-number` | §1.1 | 与规则体无关的独立工作面 |

---

## 三、验证状态（如实）

**本轮通过**：`npm run lint`｜`npm run format:check`｜`npm run gate:comments`（strict ratchet PASS）｜
`npm run gate:self`（`newBlocking(error)=0`）｜`npm run validate-self-norms`（3/3 PASS）。

**仍未跑通**：完整 `npm run gate`。阻塞点与上一轮相同——`scripts/validate-diff-interface.js` 在其第 4 段
（CLI changed-set 模式）挂起，清空全部 node 进程后独立运行仍超时且无输出。
**因此本轮同样不能声称"全门禁通过"**；新验证器虽已接入 `npm test` 链，但该链当前无法端到端跑完。
