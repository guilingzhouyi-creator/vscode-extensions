# auto-refactor 自身规则审查清单与收紧成本

> 语料：`src/**/*.ts` + `scripts/*.js`，179 个文件，7630 条命中
> （error 51 / warning 1373 / info 6206，其中 6641 条带书面抑制理由）
> 命令可复现：
> `node dist/index.js scan --root . --config auto-refactor.config.json --include "src/**/*.ts,scripts/*.js" --format json --out r.json --baseline-granularity grouped --no-cache --no-daemon`

---

## 0. 结论摘要

| 项 | 结果 |
| :--- | :--- |
| 发现并修复的**确定型缺陷** | 1 个：路径豁免用子串匹配，对相对路径永不生效 |
| 该缺陷的直接代价 | `GOV-DBG-001` **472 条**误报（全部落在本仓库自己的 `scripts/*.js`） |
| 发现并修复的**误报类别** | 2 个：`HYG-DED-001` 方法链续行判死代码（−5）、`HYG-STB-002` 无词汇表判据（−4） |
| 新增共享原语 | `pathScope.ts`（目录归属）、`markerScope.ts`（清单 vs 应用标签） |
| 新增常驻棘轮 | `validate-marker-scope.js`，**双方向** 10/10（6 负样本 + 4 正样本） |
| 收紧棘轮到 warning 级的成本 | **89 条**未抑制的新增命中 |
| 规范化状态 | 常量类三趟检查（6078 / 442 / 127）**已按书面策略处置**，非遗漏 |

---

## 1. 一个确定性缺陷：路径豁免对相对路径永不生效

四条规则的语料豁免写成 `path.includes('/scripts/')`。本引擎产出的是**仓库相对路径**
（`scripts/bench.js`），**没有前导斜杠**，因此这些守卫是**永不生效的死代码**——看起来
正确，实际从不触发。

| 文件 | 原写法 | 后果 |
| :--- | :--- | :--- |
| `rules/debugLogging.ts` | `includes('/scripts/')` 等 5 项 | `GOV-DBG-001` 对自身脚本报 **472** 条 |
| `rules/sanitization.ts` | `includes('/tests/')`、`/test/`、`/benchmarks/` | 相对路径语料豁免失效 |
| `rules/exceptionSafety.ts` | `includes('/tests/')` | Rust 测试文件豁免失效 |
| `rules/fileStructure.ts` | `includes('/tests/')` **与** `startsWith('tests/')` 并存 | 同一意图写了两遍——第二行正是为补救第一行的失效 |

> `fileStructure.ts` 里两种写法并存，本身就是这个缺陷的**现场证据**。

**修法**：新建 `src/core/governance/pathScope.ts`，按**路径分段**判定归属，而不是子串。

```ts
pathHasSegment('scripts/a.js', 'scripts')      // true   ← 相对路径也认
pathHasSegment('/repo/scripts/a.js', 'scripts') // true
pathHasSegment('myscripts/a.js', 'scripts')     // false  ← 子串匹配会误判为 true
```

**实测**：`GOV-DBG-001` **472 → 0**，总量 8076 → 7604（delta 恰好 −472，无旁溢）。

---

## 2. 两类误报，以及一条被我上一轮漏掉的同类

### 2.1 `HYG-DED-001`：行首点号的方法链被判死代码（`−5`）

终止语句判定只看**上一行如何结尾**，不认**下一行以 `.` 开头**：

```ts
return filePath        // 以 'p' 结尾 → 判定为终止语句
    .replace(/\\/g, '/')  // ← 被报为「不可达代码」
```

**修法**：把 `.` 开头的行纳入续行集合。实测 26 → 21。

### 2.2 `HYG-STB-002`：没有词汇表判据（`−4`）

我上一轮只给 `GOV-SAN-001` 加了「标记词紧邻 `/` 即属清单条目」的判据，**同一个误报类别在
`hygiene` 分析器里仍然存在**。后果：规则自己的消息文案（`… / WIP marker …`）被自己抓到。

修法不是复制一份，而是把判据提到共享模块 `src/core/governance/markerScope.ts`，两边共用。

### 2.3 顺带修掉原判据的一个漏洞

原判据要求 `/` **紧邻**标记词，因此 `jargon / WIP marker`（斜杠两侧带空格）判不出来。
放宽为「允许空格」时必须排除注释起始符——否则 `// wip: fix` 会被当成清单条目而**自我消音**。

| 样本 | 期望 | 实测 |
| :--- | :--- | :--- |
| `// wip: remove before release` | 仍上报 | 仍上报 ✅ |
| `//WIP fix this` | 仍上报 | 仍上报 ✅ |
| `// p1 cleanup` / `// still wip` / `* wip handling` / `/* wip */` | 仍上报 | 仍上报 ✅ |
| `pN/stN/phase N/wip` | 豁免 | 豁免 ✅ |
| `jargon / WIP marker` | 豁免 | 豁免 ✅ |
| `// p1/stN/phase 2/wip` / `wip/p2/st3` | 豁免 | 豁免 ✅ |

**负样本（前 6 条）比正样本更重要**：它们正是后人"修"误报时最想放宽的地方。已固化为
`scripts/validate-marker-scope.js` 常驻检查并接入 `npm test`。

---

## 3. 自身命中完整清单

| 级别 | 规则 | 总数 | 已抑制 | 新增 |
| :--- | :--- | ---: | ---: | ---: |
| error | `complexity/high-complexity` | 135 | 0 | 11 |
| error | `large-file/large-file` | 43 | 0 | 5 |
| error | `secrets/secret-detected` | 3 | 3 | 0 |
| error | `governance/GOV-EXC-001` | 2 | 2 | 0 |
| warning | `constants/magic-number` | 442 | 439 | 30 |
| warning | `governance/GOV-LOG-001` | 182 | 0 | 17 |
| warning | `simplify/SIM-LONG-001` | 132 | 0 | 14 |
| warning | `constants/duplicate-literal` | 127 | 112 | 29 |
| warning | `governance/GOV-TYP-003` | 111 | 0 | 6 |
| warning | `governance/GOV-PRF-004` | 80 | 0 | 4 |
| warning | `hygiene/HYG-CLN-001` | 46 | 0 | 4 |
| warning | `performance/PRF-IO-001` | 26 | 0 | 1 |
| warning | `hygiene/HYG-STB-002` | 25 | 7 | 7 |
| warning | `governance/GOV-PRF-001` | 22 | 0 | 5 |
| warning | `hygiene/HYG-DED-001` | 21 | 0 | 0 |
| warning | `performance/PRF-ALG-001` | 10 | 0 | 2 |
| warning | `governance/GOV-SAN-001` | 9 | 0 | 0 |
| warning | 其余 5 条规则 | 8 | 0 | 2 |
| info | `constants/hardcoded-string` | 6078 | 6078 | 851 |
| info | `governance/GOV-PRF-002` | 99 | 0 | 8 |
| info | `performance/PRF-MEM-001` | 17 | 0 | 6 |
| info | `hygiene/HYG-STB-001` | 11 | 0 | 1 |
| info | `governance/GOV-FIL-002` | 1 | 0 | 0 |
| | **合计** | **7630** | **6641** | **1003** |

---

## 4. 收紧：把棘轮从 error 提到 warning 的成本

当前 `gate:self` 只拦**新增且 ≥ error**。提到 warning 级，需清零的新增命中为
**137 条，其中 48 条已被现有策略抑制，真实成本 89 条**：

| 规则 | 新增 | 已抑制 | **需清理** |
| :--- | ---: | ---: | ---: |
| `constants/magic-number` | 30 | 27 | **3** |
| `constants/duplicate-literal` | 29 | 14 | **15** |
| `governance/GOV-LOG-001` | 17 | 0 | **17** |
| `simplify/SIM-LONG-001` | 14 | 0 | **14** |
| `complexity/high-complexity` | 11 | 0 | **11** |
| `governance/GOV-TYP-003` | 6 | 0 | **6** |
| `governance/GOV-PRF-001` | 5 | 0 | **5** |
| `large-file/large-file` | 5 | 0 | **5** |
| `hygiene/HYG-CLN-001` | 4 | 0 | **4** |
| `governance/GOV-PRF-004` | 4 | 0 | **4** |
| `performance/PRF-ALG-001` | 2 | 0 | **2** |
| `CMP-CAL-001` / `CMP-EXP-001` / `PRF-IO-001` | 3 | 0 | **3** |

**热点文件**：`sparseRuleRouter.ts`(10)、`compressionBounds.ts`(9)、`dataFlow.ts`(7)、
`validate-data-flow.js`(6)、`incrementalMetrics.ts`(6)、`symbolIndex.ts`(6)、
`validate-self-norms.js`(5)、`config.ts`(4)、`projectProfiler.ts`(4)、`index.ts`(4)。

> 值得注意：`validate-self-norms.js` 自身占了 5 条——**棘轮本身也在给棘轮计数**。

**建议**：不要一次性收紧。按上表分桶，先拿下 3 条 `magic-number`（最小、最无争议），
再处理 `GOV-LOG-001` 的 17 条嵌套过深（结构性、收益最高），`SIM-LONG-001` 与
`high-complexity` 属于同一批重构，宜合并处理。

---

## 5. 规范化：已处置 vs 真工作面

**关键判断：最大的一桶不是遗漏，是策略。**

| 规则 | 策略（见 `auto-refactor.config.json` suppressions） |
| :--- | :--- |
| `hardcoded-string` 6078 | **全部**降级为 info，理由是"消息/规则描述密集的工具库，字面量多为报告文案" |
| `magic-number` 439/442 | 脚本目录按 glob 统一登记为"夹具数据"，产品代码仍逐条要求具名常量 |
| `duplicate-literal` 112/127 | 同上 |

即常量化三趟检查 **99% 已有书面处置**，剩余真工作面仅 **3 + 15 = 18 条**。

**路径豁免债务同步收缩**：`validate-self-norms.js` 的债务清单由 4 个文件降为 3 个，
`fileStructure.ts` 已完全泛化（移出清单）；检查本身也加固到能识别新的数组形式。

---

## 6. 验证状态

| 门禁 | 结果 |
| :--- | :--- |
| `build` / `lint` / `format:check` | PASS |
| `gate:comments` | PASS |
| `gate:self` | PASS（`newBlocking(error)=0`，files=179 issues=7630 suppressed=6641） |
| `validate-self-norms` | 3/3 PASS |
| `validate-marker-scope` | 10/10 PASS（新增） |
| `validate-governance` | **20/20** PASS |
| `validate-compression` / `validate-data-flow` | PASS |
| **完整 `npm test`（34 个套件）** | **PASS（exit 0，179 条 PASS / 0 条 FAIL）** |

### 6.1 前两轮阻塞的 `validate-diff-interface` 已解

此前两轮都报告"完整门禁跑不通，卡在 `validate-diff-interface.js`"。本轮完整 `npm test`
在 **2 分 4 秒**内跑完并退出 0，其中：

```
> auto-refactor@0.3.0 validate-diff-interface
 ALL DIFF INTERFACE CHECKS PASSED SUCCESSFULLY!
```

**归因修正**：上一轮我判断"补丁后隔离复测仍超时，精确阻塞点尚未定位"，并按此上报。
现在看，那个"隔离超时"更可能是**被 10 个残留 node 进程污染的测量环境**所致，而非脚本本身。
上一轮给它打的补丁（`-c commit.gpgsign=false` + `GIT_TERMINAL_PROMPT=0` + 20s timeout）
针对的是**另一处独立成立的环境脆弱性**（全局 GPG 签名在密钥环不可用时会阻塞等待口令），
那个问题真实存在且修复正确，但它**不是**当时挂起的原因。

> 方法教训：**隔离复测前必须先确认测量环境本身干净**，否则会把环境噪声当成被测对象的缺陷。

**未决**：
`vscode-extensions/.git` 状态异常（`git rev-parse` 报 not a git repository），待你自行核验；
本轮所有改动**均经内容核对存在于工作树**，未依赖 git。
