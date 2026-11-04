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
- **默认紧凑序列化**：`toAasJson` 不传 `pretty` 时输出单行 JSON；需要人读时传 `pretty: true` 或 CLI 加 `--pretty`。缩进在主链路上是纯开销（实测 500 条缺陷时占 49.6% 字节），因此不能作为默认。

| 载体 | 典型体积 | 结构形态 | 适用场景 |
| :--- | :--- | :--- | :--- |
| `json` (ScanReport) | 数百 KB ~ 数 MB | 完整 AST 对象树与逐条扣分审计链 | 离线离场归档、全量复盘 |
| `agent` (Markdown) | 数十 ~ 上百 KB | 渲染后的 Markdown 格式人类可读清单 | 人类审查交割、PR 描述 |
| **`aas` (AAS v1.0)** | **百余 KB（默认紧凑）** | **拓扑排序、文件聚合、内联代码锚点与配方** | **智能体上下文注入、门禁前置判定、跨会话基线对比** |

### 1.1 Token 削减的度量口径（务必区分三个来源）

同一份 `--root src` 扫描（612 文件 / 1805 findings / 500 条缺陷上限）逐项实测：

| 环节 | 实测值 | 说明 |
| :--- | :--- | :--- |
| 原始 issue JSON（minified） | 302,610 B | 完整性基线 |
| AAS 字段投影（丢 `actionable`/`detail`/`suggestion`） | −52.4% | 体量主因，与压缩算子无关 |
| `compressDiagnosticSentence` 句子压缩 | −2.66% | 仅在 34 条模式命中时生效 |
| pretty → 紧凑序列化 | −33.1% | 仅影响缩进，不影响信息 |
| **合计（默认紧凑输出）** | **142 KB / 302 KB** | 端到端 −53% |

因此文档与门禁**不得**用单一「≥70%」数字自证：70% 只在使用宽字段 mock 报告时才成立。`validate-aas-reporter.js` 的棘轮已改为对默认紧凑输出计量，并额外断言「默认必须紧凑」。

### 1.2 修复配方的占位符禁令

分析器在无法推断领域词时会回退到 `EXTRACTED_STRING` / `EXTRACTED_NUMBER`。这两类名字分两层处理（判据单源在 [`placeholder-names.ts`](../../src/utils/placeholder-names.ts)）：

| 层 | 判据 | 行为 |
| :--- | :--- | :--- |
| 分析器 | `isContentlessName` | 兜底命名**不生成 `patch`**，且 `safeToAutomate: false`；issue 本身仍上报，`suggestion` 保留为提示 |
| 报告层 | `isPlaceholderPatchText` | 兜底名、位置名、焊接名的 `patch` / `template` 均被丢弃，且不再输出 `safeToAutomate` |

三条不变量由门禁看守（`validate-agent-actionable` + `validate-aas-reporter` Test 17）：

1. 兜底命名的 issue **不得携带 `patch`**，也不得 `safeToAutomate: true`（实测 220 条兜底命名 / 0 违规）。
2. 任何进入产物的 `patch.replacementText` **不得含 `EXTRACTED_*`**（实测 967 条有效补丁 / 0 泄漏）。
3. 合法的 `…_TEXT` 领域名（`DIALOG_TEXT`、`UNCONDITIONAL_TEXT`、`TYPESCRIPT_TEXT`）**必须保留**补丁——焊接判定必须以**字面量为参照**，不能以长度判定（见 §1.4）。

> `patch` 被丢弃时**不**输出 `safeToAutomate: false`：该字段描述的是「存在一个可自动化的补丁」，无补丁时输出 false 会让消费方误以为补丁存在但被判定不安全。

### 1.3 建议命名的可读性契约

`ConstantsAnalyzer` 生成建议名时**按词拼接下划线**（`USER_NOT_FOUND_TEXT`），不再做无分隔焊接（`USERNOTFOUND_TEXT`）。同时：

- 命名派生单源在 [`name-integrity.ts`](../../src/core/naming/name-integrity.ts)：非字母数字串先分词，每段再经共享语素切分器（`splitIdentifierTokens`）二次切分，因此字面量里**已有的驼峰/缩写标识符**（`'architectureConsistency'`、`'URLSearchParams'`）会拆成独立词，而不是当成一个词焊接。
- 相邻重复词折叠（`'context.Context'` → `CONTEXT_TEXT`，而非 `CONTEXT_CONTEXT_TEXT`）。
- 无寄存器变化的整段（`I18N`、`L3A`）不得再被切碎，否则会切开合法词元。
- 单字符词被过滤（`'\n'` 曾被拼成 `N_TEXT`），双字符词保留（`'CN'` → `CN_TEXT`，国家码是真实领域词）。
- 命名改动会改变 `detail.suggestedName`，从而影响等价基线；`scripts/baselines/*.json` 需用 `validate-equivalence.js --update` 重捕，重捕后必须逐字段确认**只**有 `detail` / `suggestion` / `actionable` 变化且无 issue 增删。

### 1.4 焊接判定必须对照字面量

焊接（weld）指两个及以上的字面量词被压进同一个标识符词。判据**不能**依赖长度：

| 名称 | 长度 | 字面量 | 是否焊接 |
| :--- | ---: | :--- | :--- |
| `UNCONDITIONAL` | 13 | `'unconditional'` | 否（整词） |
| `MAINTAINABILITY` | 15 | `'maintainability'` | 否（整词） |
| `INVALIDNAME` | 11 | `'invalid name'` | **是**（`invalid` + `name`） |
| `HIGHCOMPLEXITY` | 14 | `'high complexity'` | **是** |
| `ARCHITECTUREANALYZERSEGMENTCACHES` | 33 | `'architecture analyzer segment caches'` | **是** |

`isWeldName(name, literal)` 把标识符还原成词序列，要求它是字面量词序列的**有序子序列**。长度判定曾把阈值设为 8，在真实语料上误伤 **120 条合法补丁**（`CONSTANTS_TEXT`、`WORKSPACE_TEXT` 等），因为它们与 `INVALIDNAME` 长度相近却语义完整。

三条边界条件：

1. **数字类不参与**：`CONST_47` 是按数值取的位置名，只有字符串派生的 `_TEXT` 家族才可能焊接。
2. **位置名单独拦截**：`CONST_<数字>_TEXT` 由独立判据拒绝，无需字面量即可识别。
3. **字面量无词时判为不焊接**：`'2'`、`'/'`、`'#'` 提取不出任何词，此时问题**不可判定**；把它当焊接会静默剥离所有数字与标点 finding 的补丁。

实测（`src/` 全量 1825 findings）：焊接残留 **0**，补丁 **967** 条，占位符泄漏 **0**。

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

# 验证重复路径读取预算（每文件读取 ≤ 3.00×），带钩子实跑一次生产扫描
node auto-refactor/scripts/validate-redundant-reads.js
```

---

## 五、 冷扫描与增量扫描的耗时归属

一次 `scan` 的墙钟分三段：扫描本体（`done in Nms` 日志）、后处理管线、报告落盘。实测 616 文件 / 1825 findings 的归属如下（增量扫描一列已完成 §7 的改造）：

| 阶段 | 冷扫描（改造前 → 后） | 增量扫描（L1 命中 616/616） |
| :--- | ---: | ---: |
| 扫描本体 | ~1.7 s → ~1.1 s | **~0.05 s** |
| 后处理管线 | ~1.9 s → **~1.5 s** | ~1.5 s → **~0.9 s** |
| 报告渲染 + 落盘 | < 100 ms | < 100 ms |

结论：**扫描本体在增量模式下已不是瓶颈，后处理管线才是**。它不区分冷热，每次都全量重算——直到 §7 为派生评分建立内容寻址 memo 为止。

### 5.1 已消除的重复计算

| 位置 | 缺陷 | 处置 | 实测收益 |
| :--- | :--- | :--- | ---: |
| `evaluateFileQuality` | 每文件调用 `computeEffectiveCodeDensity`，随即 `detectScoreGaming` 内部**又调一次**同一函数；该函数会对整文件分词 | 计算结果作为可选入参传给 `detectScoreGaming` | `scoreFileQuality` 759 → **462 ms**（−39%） |
| `detectScoreGaming` | 同上，重复分词 | 复用调用方结果 | 381 → **178 ms**（−53%） |
| `mineRepositoryHistoryBatch` | 已有 `batchCache` 字段但**从不读取**，每次都重新执行三条 `git` 子进程 | 缓存键改为 (cwd, commit 上限, HEAD)；HEAD 变更自动失效 | 冷挖掘 583 → **456 ms**；同进程复算 583 → **72 ms** |
| `synthesizeNativeGovernance` | 616 个文件用无界 `Promise.all` 并发读 | 改为有界并发（16） | tail 2512 → **2337 ms** |
| `collectTrajectoryScannedFiles` | 逐文件串行 `readFile` | 改为有界并发（16） | 仅 `--record-trajectory` 生效 |
| `buildAasAnchorFileMap` | 手写车道循环 | 复用统一的 `pMap` | 去重实现，无行为变化 |

累计：冷扫描墙钟 **5780 → 4617 ms（−20%）**，后处理段 **2512 → 1660 ms（−34%）**。

### 5.2 Git 子进程开销

`git` 每次启动约 80 ms（Windows 实测）。旧实现三处探测串行执行：

- `rev-parse --is-inside-work-tree` → 判定是否仓库
- `rev-parse --show-toplevel` → 取仓库根
- `rev-parse HEAD` → 缓存校验

前两者问的是同一件事。合并为 **一次** `rev-parse --show-toplevel HEAD` 后，探测开销 240 → 80 ms。`git log` 本身仍是主要成本（约 1.6 s，1374 个文件的历史），且无法在不改变语义的前提下削减。

### 5.3 未采取的优化及原因

| 候选项 | 上限收益 | 未做原因 |
| :--- | ---: | :--- |
| AAS 图例折叠（`rule/sev/tier/conf/verify` → 顶层索引） | −19.8%（29 KB） | 需改已文档化的 §2.1 契约与 `validate-aas-reporter` Test 2 的字段断言，属产品决策 |
| `tokenizeCode` 内部优化 | 290 ms | 正则词法器改写风险高，且已被复用后只剩一次 |
| 增量模式跳过`enrichEvolutionAndCoverage` | ~550 ms | 缓存未持久化评分与演化字段，跳过会使冷热结果不等价 |

> [!IMPORTANT]
> 增量扫描（L1 全命中）目前仍需 ~1.5 s 后处理，根因是**缓存只存 issue、不存评分**。该缺口已由 [§7.2](#72-已消除governance-逐文件评分的重复计算) 的内容寻址 memo 补齐：热扫描降至 **1.52 s**，冷扫描的评分重算节省 **612 ms**。

---
## 六、 重复路径扫描与过度扫描审计

审计方法：以 CommonJS 预加载钩子包裹 `fs.readFileSync` / `fs.promises.readFile`，记录一次**生产模式**（默认 worker）扫描中的每一次读取，再按绝对路径归并计数。钩子必须是 CJS——从 ESM 脚本替换 `fs` 会得到不同的模块实例，扫描照常运行但记录为空。

### 6.1 改造前的读取放大

| 指标 | 数值 |
| :--- | ---: |
| 被读取的 src 文件 | 618 |
| 读取调用总数 | 2470 |
| **每文件读取次数** | **4.00×** |
| 冗余调用 | 1852 |
| 冗余字节 | 23.2 MB |

四个来源，全部指向同一批源文件：

| 来源 | 文件数 | 说明 |
| :--- | ---: | :--- |
| `autonomy-scorer.readSourceFileContent` | 1234 | **同一函数被调用两次** |
| `post-scan-enrichment.readOptionalTextAsync` | 617 | governance 评分需要源文本 |
| `worker-scheduler.readTask` | 556 | 扫描器本体读取（必要） |
| `worker-scheduler.processSingleHybridFile` | 61 | 扫描器 hybrid 启动（必要） |

### 6.2 已消除：autonomy 的重复计算

`buildScanReport` 已用扫描器的符号索引算过一遍 autonomy，`refreshQualityScores` 又用**同一个**符号索引重算一遍。两次输入相同、结果相同，但第二次要逐文件重读 import 前导。

改造后 `refreshQualityScores` 复用 `report.autonomy`，仅在 slice 扫描未产出该字段时才回算。守卫逻辑抽到 `applyAutonomyScore`，避免给 `refreshQualityScores` 增加分支（该函数复杂度曾因此从 15 升到 16）。

结果：**4.00× → 3.00×**，冗余调用 1852 → 1234，冗余字节 23.2 → 15.5 MB。

### 6.3 已消除：autonomy 读取的 syscall 放大

`readSourceFileContent` 原本每文件四次同步系统调用（`statSync` + `openSync` + `readSync` + `closeSync`）。改为一次 `readFileSync` 后按上限截断，输出逐字节相同：

| 读法 | 616 文件耗时 |
| :--- | ---: |
| 4 次 syscall | 187 ms |
| 1 次 `readFileSync` | **148 ms（−21%）** |

### 6.4 无法消除的部分及原因

| 候选项 | 结论 |
| :--- | :--- |
| governance 复用扫描器已读文本 | **仅 `--workers 1` 有效**。生产模式内容在 worker 线程内，主线程拿不到。实测把 403 个评分目标（6.3 MB）跨线程回传需 **61 ms**，而有界重读只需 **48 ms**——传输比重读更慢，故不实施。 |
| 扫描器本体读取 | 不可消除：分析必须读文件。 |
| 缓存状态文件重复读 | 5.5 KB × 2，属噪声。 |

> [!NOTE]
> `contentByPath` 通道仍然保留并已接线：`--workers 1`（诊断/单线程模式）下 governance 评分耗时从 841 ms 降到 632 ms，且结果逐字段相同。它在库调用方复用同一 Scanner 实例时同样生效。

### 6.5 门禁

`scripts/validate-redundant-reads.js` 固定执行一次带读取钩子的生产扫描，断言每文件读取次数不超过 **3.00×**。该门禁已注册进 `npm test` 的自审顺序通道。

门禁自身经过证伪：把预算临时调为 2.50× 时正确报错 `3.00x per file exceeds the 2.50x budget`。

---

## 七、 增量扫描的后处理成本归属

增量扫描把扫描本体压到了极低：命中全部 L1 时 `done in 47ms`。但整条命令仍要 ~2.0 s，差额全部落在后处理。用临时埋点（插桩后 `--restore`）逐段实测，热路径（`cache l1=617 l2=0 analyzed=0/617`）的归属是：

| 阶段 | 热扫描耗时 | 性质 |
| :--- | ---: | :--- |
| 扫描本体（worker 池） | 47 ~ 52 ms | 已命中缓存，只剩 I/O |
| `refreshQualityScores` 内的 `synthesizeNativeGovernance` | **559 ms** | 逐文件评分 |
| `enrichEvolutionAndCoverage` | **421 ms** | `git log` 子进程 + 耦合分析 |
| 其余全部（含 `finalizeBaseline`） | < 35 ms | — |
| **进程外开销**（Node 启动 + 模块装配） | **~570 ms** | 与扫描无关 |

两个占比最大的阶段，CPU 采样给出的子项拆分是决定性的：

| 阶段 | 子项实测 | 说明 |
| :--- | ---: | :--- |
| `synthesizeNativeGovernance` | 读文件 51 ms / **`scoreFileQuality` 549 ms** / 聚合 4 ms | 瓶颈是评分本身，不是 I/O |
| `evaluateFileQuality` 子树 | `computeEffectiveCodeDensity` ≈ 230 ms · `detectScoreGaming` ≈ 120 ms · 函数抽取 ≈ 50 ms | 纯计算，无缓存则每次都付 |

**结论：增量扫描的剩余成本不是"重复路径扫描"，而是"随扫描重算的派生评分"。** 缓存只存 issue 与 metric，不存评分，因此 `shouldRefreshQualityScores` 在热扫描下恒为真——扫描越便宜，后处理的固定占比越高。

### 7.1 已消除：git 历史挖掘的跨进程重复

`GitHistoryMiner` 原本只有实例级内存缓存。CLI 每次运行都是新进程，缓存永远不命中，于是每次扫描都要付一次 `git log`：

| 场景（1,374 文件历史） | 耗时 |
| :--- | ---: |
| 冷挖掘（`git log` 子进程） | 404 ms |
| 命中内存缓存 | 59 ms |
| **命中磁盘缓存** | **75 ~ 81 ms** |

新增 [`git-history-cache.ts`](../../src/core/evolution/git-history-cache.ts)，按 `(topLevel, HEAD, commitLimit)` 三元组持久化到 `<scanRoot>/.auto-refactor-cache/git-history-cache.json`。任何一次提交都会移动 HEAD，因此陈旧载荷永不命中；`commitLimit` 参与键，避免 100 条的批次被用来回答 2000 条的请求。

严格 A/B（7 次取中位数，其余条件固定）：

| 条件 | 中位墙钟 |
| :--- | ---: |
| 有磁盘载荷 | **1,884 ms** |
| 每次删除载荷 | 2,166 ms |

**净收益 282 ms（−13%）**。`--no-cache` 会同时停用该层，语义与 L1/L2 一致。

### 7.2 已消除：governance 逐文件评分的重复计算

`scoreFileQuality` 是 `(content, issues, domain, module)` 的纯函数：同样的输入永远给出同样的八柱与复合分。既然如此，重复扫描同一棵树时没有任何理由重算。

新增 [`score-memo.ts`](../../src/core/scoring/score-memo.ts)，键 = `sha256(content ‖ canonical(issues))` 前 20 位十六进制。两个输入都参与：文本变了要重算，文本没变但 findings 变了同样要重算。

| 指标（405 个评分文件 / 6.3 MB） | 实测 |
| :--- | ---: |
| 读取 + 哈希 + issues 归一化（建键） | 143 ms |
| `scoreFileQuality` 重算 | 538 ms |
| **净收益** | **395 ms** |

严格隔离验证（同样的冷缓存状态，只切换 memo 是否存在）：

| 条件 | 墙钟 | 复用率 |
| :--- | ---: | :--- |
| 冷缓存 + 有 memo | **3,220 ms** | 619/619 |
| 冷缓存 + 无 memo | 3,832 ms | 0 |
| 热缓存 + 有 memo | **1,520 ms** | 619/619 |

**净省 612 ms（−16%）**，热扫描稳定在 ~1.52 s（改造前 2.07 ~ 2.18 s）。

正确性不是靠推理断言的，是逐字段比对出来的：`fileQualityScores` 619 条记录的 `compositeScore` 与 `eightPillars` **全部一致（差异 0）**，两次相邻热扫描的稳定字段差异同样为 **0**。

两处必须说明的边界：

- memo 载荷**不做上限静默丢弃**，而是超过 8,192 条时从最旧条目开始裁剪。键按内容寻址，编辑过的文件会留下旧条目，长期 checkout 会单调增长；拒绝写入会让缓存永久失效，裁剪最多只多付一次重算。
- `report.autonomy` 在冷扫描与热扫描之间存在差异（`compositeAutonomyIndex` 86.41 vs 95.26）。这**不是 memo 引起的**，而是热缓存不物化符号索引的既有行为（`symbolIndex.builtFrom` 分别为 `projection` 与 `materialized`）。同理，`qualityScore.quant` 的 `qsr` / `sortino` 每次都从 rolling 采样账本重算而变动。这两项属于既有语义，不在本轮改造范围。

### 7.3 `--no-cache` 的统一语义

上述两层都受 `config.cacheEnabled` 控制。共享的历史 miner 通过 `setDiskCacheEnabled()` 在每次扫描时同步该标志，因此 `--no-cache` 的含义是"本次运行完全不读也不写任何派生缓存"，而不会因为进程内已有空闲 miner 就绕过。

### 7.4 仍存在的成本及原因

| 候选项 | 结论 |
| :--- | :--- |
| 进程启动 + 模块装配 ~570 ms | 与扫描内容无关，属 CLI 固定成本；降低需要拆分入口或延迟加载，超出本轮范围。 |
| success 路径仍需读全部评分文件建键 | 键必须覆盖文本，否则改一个字符就会命中陈旧评分。143 ms 是正确性的价格。 |
| `evaluateFileQuality` 首次计算的 549 ms | 冷扫描无从避免；只有 memo 能消除重复。 |
| `tokenizeCode` 约 115 ms | 词法器本身可优化，但属高风险改动（正则语义必须逐字节等价）。 |
