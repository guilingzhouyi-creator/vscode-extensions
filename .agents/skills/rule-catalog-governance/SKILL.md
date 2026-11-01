---
name: rule-catalog-governance
description: >-
  【触发：新增规则/修改规则/SSOT/规则目录/规则登记/规则漂移/命名拓扑】增删改规则 ID、治理跨项目规则元数据或维护单源规则目录时触发。看守 3-3-3 命名拓扑与 RCFG-RULE-DRIFT 防虚构闭包。
---

# rule-catalog-governance — 全仓单源规则目录与元数据一致性治理

本技能规范了工作区静态分析与审查规则的单源聚合机制（Single Source of Truth, SSOT）、标准 3-3-3 命名拓扑公理、权威 <!-- METRICS:BEGIN glossary-count -->**113 项**<!-- METRICS:END glossary-count -->三字母映射词典、三阶双轨别名等价网络、底层完备诊断与表现层语义去重双层解耦公理、跨项目规则族命名空间边界、四大受控项目与全局门禁规范注册流程与规则防虚构门禁（`RCFG-RULE-DRIFT`）。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 生成自 `scripts/common/skill-registry.json`，禁止手改；完整联动卡片见 `docs/skill-catalog.md`。

- **链路**：[skill-governance](../skill-governance/SKILL.md) → **本技能** → [docs-archive-governance](../docs-archive-governance/SKILL.md)；并行支援 `coding-craft`、`constraint-driven-development`、`complexity-budget`、`debugging-and-error-recovery`。
- **领域**：技能与规则元治理（链上第 2 步）；另 3 个领域支援
- **协作专员**：原型 `skill-governance`：`skill-construct`、`skill-review`、`skill-refactor`
- **何时联动**：新增规则标识并闭合登记 → `rule-catalog-governance` + `skill-governance` + `gate-governance`；新增分析器或规则 → `auto-refactor-dev` + `rule-catalog-governance` + `test-benchmark-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

在以下任一开发或治理场景中，必须激活本技能：
1. **新增、修改或弃用静态分析/审查规则**（涉及 `auto-refactor`、`workspace-timing`、`WebGames`、`fractal-git` 或 `global-tooling`）；
2. **在 Git 提交说明（Commit Message）中引用规则 ID**；
3. **维护度量评估系统与评分算法**（CAI 自研率、质量置信度区间估算）；
4. **执行全仓单源规则目录同步更新与校验**（`scripts/common/generate-rule-catalog.js`）；
5. **排查 `RCFG-RULE-DRIFT`（规则未登记或虚构代号）门禁阻断**。

---

## 二、 全仓单源规则目录架构 (`rule-catalog.json`)

工作区维护全局唯一的规则真源注册表，任何规则必须在注册表中登记后方可在代码、配置、分析报告或提交说明中生效：
- **SSOT 文件路径**：`scripts/common/rule-catalog.json`
- **生成与聚合脚本**：`scripts/common/generate-rule-catalog.js`
- **纳管规模与形态**：跨五大规则域聚合 <!-- METRICS:BEGIN rule-total -->**516 条规则**<!-- METRICS:END rule-total -->（计数以 `scripts/common/rule-catalog.json` 为准），结构元数据如下：
  ```json
  {
    "schema": "workspace-rule-catalog/v1",
    "totalRules": "<generated>",
    "counts": {
      "autoRefactor": 375,
      "workspaceTiming": 49,
      "webGames": 50,
      "fractalGit": 24,
      "globalTooling": 18
    },
    "rules": [
      {
        "id": "ARCH-FAC-001",
        "project": "auto-refactor",
        "family": "ARCH",
        "severity": "error",
        "summary": "Facade carries too little substance or exports mutable state.",
        "canonical": true
      }
    ]
  }
  ```

### 摘要客观化与逐条可辨识契约

`summary` 是规则库唯一被 agent 与门禁共同读取的语义字段，因此三条契约缺一不可：

1. **英文客观底座**：所有 `summary` 一律英文客观陈述「判据 + 为何重要」，严禁中文、严禁把来源路径或 `(source: …)` 之类包裹文本塞进摘要，严禁 `[documentation-defined; not enforced]` 这类手写状态后缀。中文只允许存在于 `sourceRef`（真实路径事实）与表现层双语字典。
2. **逐条可辨识**：同一 checker 下的每条规则必须拥有专属摘要，严禁多规则共用一个标题（历史上 `DOC-CL-*` 与 `DOC-RD-*` 两组规则曾整体共用同一中文标题，导致规则目录无法回答任何单条规则在检查什么）。来源侧通过 `ruleTitles`（workspace-timing `checkers[]`）或逐条 `title`（WebGames 规则源）提供，生成器负责投影。
3. **强制状态结构化**：未落地强制的规则必须携带布尔 `enforced: false` 并由生成器投影进目录；「只在文档里存在」这一事实必须可被机器读取，不得退化为散文后缀。

| 来源 | 逐条标签字段 | 强制状态字段 |
| :--- | :--- | :--- |
| `rules-review-rules` (`workspace-timing`) | `checkers[].ruleTitles.<ruleId>` | —（该域以 checker `enabled` 表达） |
| `rule-sources/webgames-rules.json` | `rules[].title` | `rules[].enforced` |
| `commit-msg-forbidden-terms.json` | `rules[].title`（终端本地化）+ `rules[].summary`（英文客观摘要） | — |
| `rule-sources/{fractal-git,global}-rules.json` | `rules[].summary` 逐条独立 | — |

### 规则分布矩阵
1. **`autoRefactor` (<!-- METRICS:BEGIN rule-auto-refactor -->**375 条规则**<!-- METRICS:END rule-auto-refactor -->)**：涵盖 <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->与四层金字塔体系，通用多语言代码重构、AST 语法树、Rust 双轨算子、双轨体积预算（`VOL-`）、物理卫生（`HYG-`）与架构质量模型；
2. **`workspaceTiming` (<!-- METRICS:BEGIN rule-workspace-timing -->**49 条规则**<!-- METRICS:END rule-workspace-timing -->)**：11 个主题族分治 VS Code 扩展审查（编译、测试、lint、分层依赖、硬编码、脚本库、文档发布、审查配置、资源拓扑、测试预算、重构门槛），每条规则另带 `layer` 字段标注其所属的 `L0`~`L5` 执行层；
3. **`webGames` (<!-- METRICS:BEGIN rule-webgames -->**50 条规则**<!-- METRICS:END rule-webgames -->)**：涵盖 Godot 游戏工程的资产与艺术工单规格（`ART-`）、运行时治理（`GOV-`）、高性能脚本契约（`ADV-`）与资源配置审查规则（`RES-`）；
4. **`fractalGit` (<!-- METRICS:BEGIN rule-fractal-git -->**24 条规则**<!-- METRICS:END rule-fractal-git -->)**：涵盖 10 大内核子系统分层拓扑、无锁 CAS、循环零堆分配、类型状态机与 `// SAFETY:` 证明契约（`FGT-*`）；
5. **`globalTooling` (<!-- METRICS:BEGIN rule-global-tooling -->**18 条规则**<!-- METRICS:END rule-global-tooling -->)**：涵盖提交规范与禁词风格拦截（`CMG-STY-001`~`008`, `CMG-PRJ-001`）、单源规则计数闭包（`RCFG-COUNTS-001`）以及跨平台脚本工程化、沙箱边界、门禁步骤状态闭包与文档数字同步守卫（`GUARD-BASE-001`, `GUARD-CHAIN-001`, `GUARD-DOC-001`, `GUARD-ISO-001`, `GUARD-JAIL-001`, `GUARD-ORD-001`, `GUARD-SHELL-001`, `GUARD-STEP-001`）；

---

## 三、 标准 3-3-3 命名拓扑公理与权威词典

工作区所有通用规则统一遵循「标准 3-3-3 命名拓扑公理」，杜绝随意缩写与序号断层：
$$\text{Family (3 字母)} - \text{Topic (3 字母)} - \text{Sequence (3 位数字)}$$

- **Family**：核心分析器或业务治理域（如 `ARCH`、`PRF`、`SIM`、`SEC`、`NAM`，少数平台脚本为 2 字母如 `SH`, `PS`, `UI`）；
- **Topic**：权威 3 字母大写缩写（如 `FAC` 门面、`MEM` 内存、`TOK` 凭证、`ARG` 参数）；
- **Sequence**：3 位定长递增数字，自 `001` 起始单调递增（全仓仅 5 项历史规则因双生背景从 `002` 起始：`ARCH-DEC-002`, `ARCH-DSP-002`, `GOV-RTC-002`, `NAM-JRG-002`, `SIM-FLAT-002`）；
- **权威三字母词典**：在 `auto-refactor/src/core/rules/topic-catalog.ts` 中单源收录 <!-- METRICS:BEGIN glossary-count -->**113 项**<!-- METRICS:END glossary-count -->映射，通过 `normalizeTopicCode` 与 `toCanonicalRuleId` 强制将 4+ 字母历史形归一化为标准 3 字母；该目录同时登记 <!-- METRICS:BEGIN topic-count -->**33 个**<!-- METRICS:END topic-count -->规范主题族，是 Topic 段的取值来源。

---

## 四、 三阶双轨别名等价网络与平滑演进

为兼顾 3-3-3 规范演进与历史基线、行内抑制注释 100% 兼容，`auto-refactor/src/core/rules/aliases.ts` 提供三阶等价网络：
1. **一阶（精确字符串全等）**：`left === right` 直接命中；
2. **二阶（历史 Legacy 映射）**：通过 `LEGACY_RULE_ALIASES` 兼容旧版 kebab-case 规则名：
   ```typescript
   // 历史别名映射示范
   'high-complexity': 'CPX-CYC-001',
   'large-file': 'BIG-SIZE-001'
   ```
3. **三阶（3-3-3 规范形态等价）**：通过 `toCanonicalRuleId` 互认 4+ 字母历史形与 3 字母规范形：
   ```typescript
   // 规范主题归一化等价示范（DISP 历史形映射至 DSP 三字母主题）
   normalizeTopicCode('DISP') === 'DSP';
   ```

---

## 五、 底层完备诊断与表现层语义去重双层解耦公理

针对度量证据完整性与人类审查认知负荷的矛盾，实行双层解耦：
1. **扫描底座 100% 完备无损发射 (Stage 0~3)**：分析器遍历 AST 与符号图时必须保持完备发射，严禁在扫描底座私自过滤丢弃 Issue，确保质量模型证据链完整；
2. **表现层并查集语义聚合 (`semantic-correlation.ts`)**：呈现给 IDE 诊断卡片时，使用并查集对同文件同行的 11 组重叠规则族聚类，按严重级别权重（`block > warn > info > pass`）选举主卡片，次级规则收拢至 `correlatedRules` 数组，彻底消除刷屏认知疲劳。

---

## 六、 跨项目规则族前缀命名空间规范

严格划分五大项目域的规则族前缀边界，杜绝跨项目命名踩踏与误杀：

| 项目领域 (`Project`) | 规则规模 | 权威合法规则族前缀 / 命名空间 | 治理范围与职责边界 |
| :--- | :---: | :--- | :--- |
| **`auto-refactor`** | 375 条 | <!-- METRICS:BEGIN analyzer-count -->**32 个**<!-- METRICS:END analyzer-count -->分析器覆盖的 <!-- METRICS:BEGIN rule-family-count -->**34 个规则族**<!-- METRICS:END rule-family-count -->：`ARCH`, `BIG`, `CMP`, `CMT`, `CONST`, `CPX`, `DAT`, `DEP`, `DOC`, `ENG`, `ERR`, `EXT`, `GDM`, `GOM`, `GOV`, `GUARD`, `HYG`, `MOD`, `NAM`, `NUM`, `PRF`, `PROD`, `PS`, `PYM`, `RSM`, `SEC`, `SH`, `SIM`, `STDLIB`, `TSM`, `TST`, `UI`, `VOL`, `VSC` 及 15 条 Legacy 别名 | 通用多语言代码重构、AST 语法树、Rust 双轨算子、复杂度与架构质量模型 |
| **`workspace-timing`** | 49 条 | 11 个主题族：`ARF`, `BLD`, `DOC`, `HC`, `LAY`, `LINT`, `RCFG`, `RES`, `SCR`, `TB`, `TST`；执行层由每条规则的 `layer` 字段（`L0`~`L5`）表达，不作族名前缀 | VS Code 扩展生命周期、分层存储安全、i18n 对齐、时间守恒与状态栏治理 |
| **`WebGames`** | 50 条 | Godot 专属契约：`ADV-`（高性能脚本与引擎约束）、`ART-`（艺术工单与资产规格）、`GOV-`、`PRF-`、`RES-`、`UUID-`、`SIM-` | Godot 4 游戏逻辑、节点树信号契约、文档双语归档与配置单源治理 |
| **`global-tooling`** | <!-- METRICS:BEGIN rule-global-tooling -->**18 条规则**<!-- METRICS:END rule-global-tooling --> | 通用门禁与治理族：`CMG-`（提交说明规范）、`GUARD-`（平台脚本、门禁步骤与文档数字守卫）、`RCFG-`（单源规则计数闭包） | 跨平台工作区门禁、提交说明防虚构、沙箱隔离与文档规模指标同步 |
| **`fractal-git`** | <!-- METRICS:BEGIN rule-fractal-git -->**24 条规则**<!-- METRICS:END rule-fractal-git --> | `FGT-` 项目命名空间下的主题族（ID 第二段即族名）：`ALG`, `AUD`, `BRG`, `BYP`, `CAS`, `COR`, `DEP`, `ERR`, `FAC`, `GAT`, `IDX`, `LCK`, `MUT`, `OBJ`, `POL`, `PRF`, `PYR`, `QRN`, `SAF`, `STO`, `TAU`, `TOP`, `TRN`, `VRF` | 10 大内核子系统拓扑、锁纪律与 CAS 正确性、内核形式化验证、微变异盲测评估、隔离检疫与独立审计链 |

---

## 七、 多域规则纳管与规范注册 SOP

向工作区新增或调整规则时，必须依项目标准流程注册，严禁未注册先引用：
1. **`auto-refactor` (375 规则体系)**：在 `src/core/rules/entries/` 定义规则对象；在 `dimensionRuleTable.ts` 绑定权重（遵守 `MAX_AXES_PER_FINDING <= 4`）；在 `tests/rules/` 编写专属测试；若涉原生算子保证 Rust 与 TS 100% 等价；
2. **`workspace-timing` (49 规则体系)**：在 `scripts/config/review-rules.json` 中为每个 checker 声明 `family`（主题族）与 `layer`（`L0`~`L5` 执行层）两个字段，二者都必须存在：`generate-rule-catalog.js` 缺 `family` 即抛错，杜绝以层号冒充族名；同一 checker 下的每条规则还必须在 `ruleTitles` 中给出专属英文短语，键集须与 `ruleIds` 完全相等；
3. **`WebGames` (50 规则体系)**：在 `scripts/common/rule-sources/webgames-rules.json` 规则源中登记，每条必须给出英文 `title`（≤ 60 字符）与 `summary`（判据 + 理由），并以 `enforced` 布尔标注是否已落地强制；`sourceRef` 单独承载真实来源路径；
4. **`fractal-git` (24 规则体系) 与 `global-tooling` (18 规则体系)**：分别在 `scripts/common/rule-sources/fractal-git-rules.json` 与 `scripts/common/rule-sources/global-rules.json` 规则源中登记；
5. **全仓同步触发与 `--check-only` 零漂移断言**：新增或修改规则后必须运行 `node scripts/common/generate-rule-catalog.js` 同步真源；在门禁与 CI 中运行 `node scripts/common/generate-rule-catalog.js --check-only` 阻断规则漂移。

---

## 八、 提交说明规则反虚构门禁 (`RCFG-RULE-DRIFT`)

`commit-msg-gate` 集成 `scripts/common/validate-commit-msg.js`：
1. **正则精准捕获**：自动提取形如 `[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}`、`L[0-5]-[A-Z0-9\-]+` 与 `RCFG-[A-Z\-]+` 的规则词条；
2. **白名单过滤**：豁免标准协议与编码常量（`UTF-8`, `SHA-256`, `RFC-7231`, `HTTP-2`, `IEEE-754` 等）；
3. **一票否决阻断**：捕获的规则词条若在 `rule-catalog.json` 中查无记录，立即以 `[REJECT] RCFG-RULE-DRIFT` 阻断提交。

---

## 九、 文档规模数字真源渲染 (`GUARD-DOC-001`)

规则数、门禁步骤数、技能数、分析器数与脚本库规模随代码演进，任何写在散文里的字面量都会在下一次新增后静默过期。因此规模数字一律由脚本渲染：

1. **真源声明**：`scripts/common/doc-metrics.json` 为每个指标声明求值来源与渲染模板，指标 id 与求值器一一对应，未声明的指标直接失败而非跳过；
2. **区域渲染**：文档中形如 `<!-- METRICS:BEGIN rule-total -->…<!-- METRICS:END rule-total -->` 的区域由 `sync-doc-metrics.js --write` 就地重写，区域外文本永不被改动；
3. **口径强制**：每个模板自带口径前缀（`全工作区 SSOT 单源收录 …` / `auto-refactor 项目 …`），避免「auto-refactor 375 条规则」与「全仓 516 条规则」被读成互相矛盾；
4. **历史快照豁免**：记录某一提交时点结论的段落须加 `<!-- METRICS:IGNORE-HISTORICAL commit=<hash> -->`，缺提交号的豁免一律拒绝；
5. **计划态豁免**：记录尚未落地的目标规格（如 preset 扩张计划）须加 `<!-- METRICS:IGNORE-PLAN reason=<理由> -->`，与历史豁免并列但语义相反——前者是「还没到」，后者是「已经过去」，混用会让前瞻设计被误判为过期事实；
6. **块外裸数字**：`validate-docs-consistency.js` 从目录实时推导合法取值集合，块外出现的任何其他规模数字即阻断——判据是真源差量而非历史黑名单。

---

## 十、 客观度量求真与技术债务防反弹

- **客观统计零注水**：所有度量、自研率（CAI）与符号分析必须从 0 客观统计，基于 AST 真实符号索引追踪，严禁人工加分与注水；
- **统计模型委托**：度量置信度区间估算统一遵循经典贝叶斯后验模型，具体数学推导与参数约定收口至 [telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)；
- **零高危技术债务刚性基线**：全工作区 High/Critical 技术债务历史性归零（0 项），新增或调整规则严禁引入技术债务反弹。

---

## 十一、 常用命令与校验工具

```powershell
# 1. 扫描全工作区五大规则源并全量生成单源规则目录 (SSOT)
node scripts/common/generate-rule-catalog.js

# 2. 校验规则注册表与磁盘快照 100% 零漂移（CI 与门禁预审断言）
node scripts/common/generate-rule-catalog.js --check-only

# 3. 本地验证提交说明中的规则 ID 是否真实存在
node scripts/common/validate-commit-msg.js <path-to-commit-msg-file>

# 4. 渲染文档规模数字区域（显式写入），或只读比对漂移
node scripts/common/sync-doc-metrics.js --write
node scripts/common/sync-doc-metrics.js

# 5. 运行 pre-commit 门禁中的规则一致性校验 (SKILLS-SPEC-03)
pwsh -File scripts/ps1/pre-commit-gate.ps1

# 6. 执行全工作区快速审查中枢核验
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

---

## 十二、 参考资源与登记样板

| 资源 | 用途 |
| :--- | :--- |
| [rule-family-taxonomy.md](references/rule-family-taxonomy.md) | 家族前缀矩阵与 `[FAMILY]-[TOPIC]-[NNN]` 命名通式的完整分类学，新增规则前先在此定位归属 |
| [rule-declaration-boilerplate.json](templates/rule-declaration-boilerplate.json) | 规则元数据声明样板：id、title、severity、family、dimension 权重与示例消息的字段契约 |

> [!NOTE]
> 家族前缀不是规则 ID 前缀的同义词（如 `high-complexity` 归属 `CPX` 族却无 `CPX-` 前缀）。按族聚合规模时必须读 catalog 的 `family` 字段，而非切分 ID 字符串。
