# 01. 四层规则金字塔、30 个内置分析器与 325 条全量规则字典

> **所属层级**：L4 规则引擎与内置分析器 (`docs/04-analyzers-and-rules/`)  
> **对应代码真源**：`src/core/rules/registry.ts`、`src/core/rules/entries/*.ts`、`src/core/analyzer-registry.ts`、`src/analyzers/*.ts`

---

## 1. 四层规则金字塔与双轨文案架构

`auto-refactor` 将全部 **325 条内置规则**（含 **310 条规范化 `FAMILY-TOPIC-NNN` 规则**与 **15 条向后兼容别名规则**）统一收拢于 `src/core/rules/registry.ts` 单一真源注册表中，并由 `npm run validate-rules-registry` 门禁在每次构建时强制校验「发射集 = 注册集 = 文档覆盖集（325/325）」。在工作区全域单源规则目录快照（`scripts/common/rule-catalog.json`）中，活跃规则规模保持 **410 条全仓 SSOT 活跃规则**。

### 1.1 四层规则金字塔拓扑

| 金字塔层级 | 规则数量 | 包含规则族前缀 | 核心守护边界 |
| :--- | :---: | :--- | :--- |
| **Layer 1：全域安全与卫生底线** | 49 条 | `SEC` / `HYG` / `ERR` / `CMT` / `DOC` / `SIM` | 凭证防泄露、注入防御、错误吞没拦截、代码物理卫生、注释质量 (ECD-C) 与文档结构完整性 |
| **Layer 2：语言族现代化与标准库** | 98 条 | `TSM` / `PYM` / `RSM` / `GOM` / `GDM` / `SH` / `PS` (`SHL`) / `STDLIB` (`STD`) / `UI` / `PROD` | TypeScript、Python、Rust、Go、GDScript、Shell、PowerShell 现代语法惯用法、标准库手写轮子替换与前端工程现代化 |
| **Layer 3：架构拓扑、治理、数据与性能** | 141 条 | `ARCH` / `GOV` / `DAT` / `PRF` / `DEP` / `NAM` / `CONST` / `CPX` / `GATE` / `CMP` / `NUM` | 分层单向依赖、架构防腐、多 Agent 协作防冲突 (`GOV-AGN-001`)、切片破坏防范 (`GOV-SLC-001`)、轨迹回归检验 (`GOV-TRJ-001`)、N+1 数据库查询阻断与热循环零分配 |
| **Layer 4：领域专精、测试现代性与历史兼容** | 37 条 | `GDM` (`gdscript-game`) / `VSC` / `TST` / `SEC` (`client-exposure`) + 15 条 Legacy Aliases | Godot 4 游戏引擎运行态契约、VS Code 扩展清单与事件规范、测试有效覆盖深度与历史规则平滑迁移过渡窗口 |

### 1.2 双轨文案分层契约（Dual-Track Wording Architecture）

- **机读/执行轨（Machine & Agent Track）**：位于 `src/core/messages/`、`src/core/rules/entries/` 与 `src/core/guidance/`，底层规则注册表（`RULE_REGISTRY`）与内核诊断统一为 **100% 国际工业英文标准**（涵盖所有 `summary` 与 `remediation` 规范元数据），输出高 Token 密度、确定性的 SARIF 2.1.0 诊断载荷与 CAPP 智能体修复提示词，并作为工作区单源规则目录（`scripts/common/rule-catalog.json`，410 条全仓 SSOT）的唯一真源底座。
- **人读/呈现轨（Human & Presentation Track）**：由 **Praxis 表现层**（`src/core/praxis/presentation/`）与 `PraxisI18nProvider` 独占承载，采用模块化领域分包双语字典（`zh-cn/` 与 `en/`），面向人类工程师与 IDE 富文本诊断卡片（`PraxisDiagnosticCard`）提供完整、专业、细粒度的人机可读本地化转译与交互式修复指引。

### 1.3 标准 3-3-3 命名拓扑公理、权威三字母映射与三阶双轨别名等价网络

规则标识符严格遵循 `FAMILY-TOPIC-NNN` 三段式结构（`RULE_ID_PATTERN`），其中：
- **`FAMILY`**：规则族前缀（2~6 位大写字母，对应 30 个受控领域族）；
- **`TOPIC`**：领域主题码（标准 3 位大写字母，存量历史包含部分 4~9 位扩展主题码），单源登记于 `src/core/rules/topic-catalog.ts` 的 `CANONICAL_TOPIC_CATALOG` 词典中；
- **`NNN`**：三位定长十进制整数序列（`001` ~ `999`）。

#### 1.3.1 标准 3-3-3 拓扑规划愿景（Standard 3-3-3 Topology Vision）
为了在 CLI 控制台日志、富文本诊断卡片与 SARIF 输出中保持高度一致的定长等宽排版、提升机器正则匹配效率并消除视觉参差，引擎确立了 **标准 3-3-3 定长拓扑规范愿景**（`^[A-Z]{3}-[A-Z]{3}-\d{3}$`）：
- **规则族段（Family, 3 位字母）**：如 `NAM`、`CMT`、`SIM`、`HYG`、`PRF`、`SEC`、`GDM`、`DOC`、`ERR`、`TST` 等核心领域族；
- **主题码段（Topic, 3 位字母）**：严格采用定长 3 字母权威标准主题码（如 `JRG`、`DOC`、`FLT`、`DSP`、`BLT`、`POL` 等）；
- **数字序号段（Sequence, 3 位数字）**：三位零填充十进制序号（`001` ~ `999`）。

纯函数 `isStandard333RuleId(ruleId)` 作为全库统一的拓扑判据，以零额外开销实现对规则 ID 是否满足标准 3-3-3 拓扑的确定性断言。

#### 1.3.2 权威三字母映射机制（CANONICAL_3LETTER_GLOSSARY）
当前规则库处于现代化规范演进阶段，存量规则中尚存部分因历史演进保留的非 3 字母主题码（例如 `ARGS`、`FLAT`、`DISP`、`RECURSION`、`DATETIME`、`ONREADY` 等）。为保障分类学平滑收敛，引擎建立了以下刚性机制：
1. **单一真源映射词典**：`src/core/rules/topic-catalog.ts` 声明并冻结包含 104+ 项（注册 107 项）的 `CANONICAL_3LETTER_GLOSSARY`，为全部存量非标主题码预先分配确切的 3 字母权威映射（如 `FLAT -> FLT`、`DISP -> DSP`、`RECURSION -> REC`、`DATETIME -> DTT`、`ONREADY -> RDY`、`CONNECT -> CNT`、`WRAP -> WRP`、`CAST -> CST`、`ELSE -> ELS`、`FIND -> FND`、`LOCK -> LCK` 等）；
2. **门禁 100% 覆盖率断言**：门禁脚本 `scripts/validate-rules-registry.js` 新增 `validateTopicGlossaryCoverage()` 校验环节，通过纯函数 `auditNonStandardTopicCoverage(RULE_REGISTRY)` 强制断言：所有已注册的 canonical 规则中长度 != 3 的主题码，必须在 `CANONICAL_3LETTER_GLOSSARY` 中保持 100% 完备映射（`missingGlossaryEntries === []`），杜绝任何未经收敛规划的非标主题逃逸入库；
3. **单源投影工具**：提供 `toCanonicalRuleId()` 与 `normalizeTopicCode()` 纯函数，确保多源输入与历史 ID 能够单向确定性投影为规范三字母形态。

#### 1.3.3 三阶双轨别名等价网络（areAliasForms）
规则 ID 是工程配置、基线压制清单（Baseline Ratchet）以及存量 SARIF 报告的持久化契约锚点。引擎通过 `src/core/rules/aliases.ts` 中的 `areAliasForms(left, right)` 实现了 **三阶双轨别名等价网络**：
1. **阶一：字面精确等价**：若 `left === right`，直接判定匹配（O(1) 短路）；
2. **阶二：历史别名规范映射等价**：基于 `LEGACY_RULE_ALIASES` 字典，若 `canonicalRuleId(left) === canonicalRuleId(right)`，判定为同一规则的现代与历史标识（15 条存量别名平滑支持）；
3. **阶三：标准 3 字母拓扑归一化等价**：通过 `toCanonicalRuleId(left) === toCanonicalRuleId(right)`，将非标多字母主题码投影为标准 3-3-3 拓扑形式后断言等价。

该网络使得消费方无论在基线配置中使用历史旧名称（如 `clean-layer-violation`）、存量扩展名称还是最新 3-3-3 规范名称，引擎均能透明互认，达成「零静默破坏」的平滑演进。

#### 1.3.4 编号序列连续性公理（Sequence Continuity Invariant）
1. **默认单调自增起点**：除受控豁免外，所有规则族的主题序列必须严格以 `001` 作为首条规则，且同一 `FAMILY-TOPIC` 内部必须连续递增，严禁存在序列空洞（如出现 `001`、`003` 跳跃）；
2. **历史特例单源锁定（Historical Sequence Anomalies）**：全库目前锁定唯 5 处由于跨域配对或主题码演进由 `002` 起跳的历史特例，已全量记录于 `HISTORICAL_SEQUENCE_ANOMALIES` 中，并由门禁脚本 `validate-rules-registry.js` 常态化严格校验：
   - `ARCH-DEC-002`：解耦规则跨域配对（与命名解耦 `NAM-DEC-001` 配对，区分 AST 解析器解耦与符号命名解耦）；
   - `ARCH-DSP-002`：分发器演进配对（与 4 字母前身主题码 `ARCH-DISP-001` 单行透传跳板规则配对，专指分发器控制流复杂度）；
   - `GOV-RTC-002`：基线路径重命名追踪诊断规则，与引擎单调棘轮门禁协同保障；
   - `NAM-JRG-002`：变量黑话标记规则，历史版本中变量级黑话校验收敛至代码卫生规则 `HYG-STB-002`；
   - `SIM-FLAT-002`：深层嵌套控制流扁平化阈值规则，与浅层前置卫语句规则 `SIM-GUARD-001` 互补协同。

---

## 2. 四阶段分析器流水线拓扑与装配矩阵（共 30 个）

注册于 `src/core/analyzer-registry.ts` 的 30 个内置分析器统一按四阶段流水线拓扑编排装配，具备严格的阶段依赖与短路熔断机制：

### 2.1 四阶段流水线装配与短路机制

| 流水线阶段 | 分析器清单（共 30 个） | 阶段核心职责与装配目标 | 短路与跳过机制 (Short-circuit Rationale) |
| :--- | :--- | :--- | :--- |
| **Stage 0：物理底线与紧急安全** (5) | `hygiene`, `shell-lint`, `large-file`, `secrets`, `security` | 文件系统物理完整性校验、0 字节占位文件拦截、高熵敏感凭证扫描、代码注入漏洞防御与巨型大文件物理尺寸审查 | **致命阻断与快速熔断**：若文件物理尺寸超出预算，短路跳过后续高开销 AST 解析避免 OOM；命中高危硬编码凭证或恶意代码注入时快速标记阻断。 |
| **Stage 1：文本规范、词法符号与文档** (5) | `comments`, `naming`, `constants`, `docs`, `production-hygiene` | 注释质量 (ECD-C)、命名契约与工程黑话、常量单一真源与局部遮蔽、Markdown 结构与死链、生产路径调试语句残留 | **纯文本/脱敏快路径**：直接面向脱敏文本与分词流操作，无需构建重量级语义图；对非目标文件（如非 Markdown 文档）短路跳过文档分析。 |
| **Stage 2：单文件语法 AST、控制流与语言现代化** (9) | `simplify`, `complexity`, `stdlib`, `ts-modern`, `python-modern`, `rust-modern`, `gdscript-modern`, `go-modern`, `frontend` | 单文件 AST 规范化节点 (`NormalizedNode`)、控制流图 (`ControlFlowGraph`) 圈复杂度度量、各语言现代语法惯用法与标准库手写轮子替换 | **稀疏路由 (Sparse MoE Router) 剪枝**：基于差异语义分类 (`DiffSemanticCategory`) 与文件类型，仅激活相关语言分析器，跳过 80%~95% 不相关规则遍历。 |
| **Stage 3：领域架构契约、数据流与全工程拓扑** (11) | `performance`, `architecture`, `data-architecture`, `dependency-layout`, `dependency-graph`, `gate-architecture`, `gdscript-game`, `vscode-extension`, `client-exposure`, `test-modernity`, `governance` | 跨文件依赖图 (`DependencyGraph`) 环路检测、Clean/DDD 架构分层守卫、数据流与 N+1 查询拦截、多 Agent 协作防漂移、游戏引擎与扩展专精契约 | **拓扑缓存增量收敛**：依赖 Stage 0~2 提炼的符号与图事实；当模块导出与架构边界未变更时，通过 `TopologyCacheManager` 命中 L2 缓存，跳过全图重计算。 |

---

## 3. 全量 325 条内置规则权威字典（由门禁自动核验）

### Layer 1 — 全域安全、密钥与卫生底线层 (Universal Safety & Hygiene)

| 规则 ID | 所属分析器 | 规则族 | 默认级别 | 适用语言 | 规则中文摘要 (`summary`) | 修复与重构指引 (`remediation`) |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `CMT-BAN-001` | <a id="cmt-ban-001"></a>`comments` | `CMT` | `warning` | `all` | 不足 150 行的小文件使用 `═` 文件级横幅。 | `standard` 及以上 |
| `CMT-CON-001` | <a id="cmt-con-001"></a>`comments` | `CMT` | `warning` | `all` | 异步导出方法未注明并发调度假设、可重入性或幂等语义。 | `strict` |
| `CMT-DOC-001` | <a id="cmt-doc-001"></a>`comments` | `CMT` | `warning` | `all` | 核心公开导出符号缺少功能描述、参数或返回值 Docstring/JSDoc 说明。 | `standard` 及以上 |
| `CMT-DOC-002` | <a id="cmt-doc-002"></a>`comments` | `CMT` | `warning` | `all` | 机械无意义冗余注释 (注释文本仅重复函数名或符号名)。 | `standard` 及以上 |
| `CMT-HDR-001` | <a id="cmt-hdr-001"></a>`comments` | `CMT` | `warning` | `all` | 源码文件顶部缺少文件层级职责与设计意图注释。 | `basic` 及以上 |
| `CMT-HDR-002` | <a id="cmt-hdr-002"></a>`comments` | `CMT` | `warning` | `all` | 规范严格六字段题头契约缺失六字段之一 (模块归属、文件路径、架构定位、依赖与触发、职责说明、退出语义与设计依据)。 | `strict` |
| `CMT-HDR-003` | <a id="cmt-hdr-003"></a>`comments` | `CMT` | `warning` | `all` | 题头声明路径与物理文件路径失真不一致。 | `strict` |
| `CMT-INT-001` | <a id="cmt-int-001"></a>`comments` | `CMT` | `warning` | `all` | 注释声称的职责特征（如纯函数、无副作用、并发安全）与 AST 实际数据流/副作用特征矛盾。 | 修正注释使其真实反映实现行为，或重构代码消除未声明的副作用与竞态条件。 |
| `CMT-LNG-001` | <a id="cmt-lng-001"></a>`comments` | `CMT` | `warning` | `all` | 注释书写语言显著偏离项目或代码域的主导规范（例如英文主导库中突兀插入中文注释）。 | 将注释语言对齐项目推荐规范，保持代码域内部风格一致性。 |
| `CMT-LNG-002` | <a id="cmt-lng-002"></a>`comments` | `CMT` | `warning` | `all` | 单个文件内部中英文注释无序交错混杂（中文与英文占比均较高且缺乏分层规律）。 | 统一单文件内的注释语言规范，避免局部多语言风格碎片化。 |
| `CMT-MOJI-001` | <a id="cmt-moji-001"></a>`comments` | `CMT` | `warning` | `all` | 编码损坏（U+FFFD 替换符、UTF-8 被按 Latin-1 解码的 `Ã`+高位字节、Windows-1252 智能引号乱码）。跨语言通用。 | `basic` 及以上 |
| `CMT-SEP-001` | <a id="cmt-sep-001"></a>`comments` | `CMT` | `warning` | `all` | 同一文件混用短标题分隔（`── 标题 ──`）与长串分隔（`──── 标题`）；纯分隔线豁免。 | `standard` 及以上 |
| `CMT-TRM-001` | <a id="cmt-trm-001"></a>`comments` | `CMT` | `warning` | `all` | 注释或文档中包含临时敷衍口吻、过度肯定吹嘘、情绪化贬损或非客观元叙事用语。 | 使用求真客观的技术事实陈述，说明具体技术范围、实现机制与设计不变量。 |
| `CMT-VMD-001` | <a id="cmt-vmd-001"></a>`comments` | `CMT` | `warning` | `all` | 有效注释密度过低或存在逐行直译代码名的注水现象（未解释设计原因与边界不变量）。 | 减少重复代码名的冗余直译，重点补充“为什么这样设计”与“哪些边界不能破坏”。 |
| `CMT-WID-001` | <a id="cmt-wid-001"></a>`comments` | `CMT` | `warning` | `all` | 注释/docstring 物理行宽超过 100 列；工具指令行（`noqa`/`type: ignore`/`eslint-disable`/`@ts-expect-error` 等）以及 `comments.options.directiveTokens` 声明的项目自有指令豁免。 | `standard` 及以上 |
| `DOC-DUP-001` | <a id="doc-dup-001"></a>`docs` | `DOC` | `warning` | `markdown` | 同一文档内正文行重复（≥24 字符）。 | 收敛为单一章节 + 指针，避免副本漂移。 |
| `DOC-FEN-001` | <a id="doc-fen-001"></a>`docs` | `DOC` | `error` | `markdown` | Markdown 代码围栏未闭合。 | 补上闭合围栏，避免后续章节被吞进代码块。 |
| `DOC-LNK-001` | <a id="doc-lnk-001"></a>`docs` | `DOC` | `warning` | `markdown` | 反引号路径或相对链接指向不存在的文件。 | 更新为现路径，或在行内标注已废止/示例。 |
| `DOC-TRM-001` | <a id="doc-trm-001"></a>`docs` | `DOC` | `warning` | `markdown` | 文档正文包含宣传性修辞、夸大承诺或非规范工单批次黑话。 | 秉承纯粹技术事实原则，客观陈述功能特性与边界规范。 |
| `ERR-PRP-001` | <a id="err-prp-001"></a>`hygiene` | `ERR` | `warning` | `all` | 错误码跨声明重复抛出（分类法冲突）或沿调用链向上传播过多跳数。 | 统一错误分类法，使用具名错误类型并在边界层显式捕获转换。 |
| `HYG-BLT-001` | <a id="hyg-blt-001"></a>`hygiene` | `HYG` | `warning` | `python` | 局部变量/参数遮蔽 Python 内建名（docstring 示例与类体协议字段豁免）。 | 重命名绑定（加领域限定词），避免掩盖内建语义。 |
| `HYG-CLN-001` | <a id="hyg-cln-001"></a>`hygiene` | `HYG` | `warning` | `all` | 抽象提炼共享通用函数或工具类。 | 基于 32-bit 滚动多项式哈希检测到连续多行代码完全重复 (Copy-Paste)。 |
| `HYG-DED-001` | <a id="hyg-ded-001"></a>`hygiene` | `HYG` | `warning` | `all` | 清理冗余死代码，重构控制流分支。 | 终结控制流 (`return/throw/break/raise/exit`) 之后存在不可达死代码。 |
| `HYG-EMP-001` | <a id="hyg-emp-001"></a>`hygiene` | `HYG` | `error` | `all` | 源码、脚本或配置目录中存在物理 0 字节、仅含空白注释或缺乏有效 AST 语义载荷的虚空占位文件。 | 完善该文件的实际业务实现与导出定义，或直接从仓库中物理删除无效的占位文件。 |
| `HYG-EXC-001` | <a id="hyg-exc-001"></a>`hygiene` | `HYG` | `warning` | `python` | except 变量命名不是 exc。 | 统一命名为 exc，让错误处理读起来一致。 |
| `HYG-NAM-001` | <a id="hyg-nam-001"></a>`hygiene` | `HYG` | `warning` | `all` | 对齐各语言官方主流工程命名契约。 | 命名风格失真 (TS/JS 源码非 kebab-case，GDScript/Python/Rust 非 snake_case)。 |
| `HYG-SGL-001` | <a id="hyg-sgl-001"></a>`hygiene` | `HYG` | `warning` | `python` | 单字母绑定（仅 i/j/k/_ 放行）。 | 使用描述性命名。 |
| `HYG-STB-001` | <a id="hyg-stb-001"></a>`hygiene` | `HYG` | `warning` | `all` | 闭环开发任务，清理临时桩。 | 代码或注释中残留 `TODO`, `FIXME`, `XXX`, `HACK` 等临时未决桩标记。 |
| `HYG-STB-002` | <a id="hyg-stb-002"></a>`hygiene` | `HYG` | `warning` | `all` | 使用中立、长效的业务领域术语替换临时工单代号。 | 全域代码与注释中泄漏临时施工工单黑话 (`pXX`, `phaseXX`, `stXX`, `wip`)。词汇表可用 `hygiene.options.jargonPatterns`（正则源数组）替换为**项目自有**词表，避免项目词被误判或被整条规则静音。 |
| `HYG-WRAP-001` | <a id="hyg-wrap-001"></a>`hygiene` | `HYG` | `warning` | `all` | Vacuous passthrough wrapper functions forwarding arguments directly without added value degrade effective code density. | 直接调用被封装的目标方法，或在封装层补充必要的数据校验、状态转换与上下文日志。 |
| `HYG-WRAP-002` | <a id="hyg-wrap-002"></a>`hygiene` | `HYG` | `info` | `all` | Redundant zero-argument forwarding wrappers trivially delegating to inner targets without validation, transformation, or abstraction. | 若无多态或抽象解耦必要，直接暴露被委托方或内联调用；若确需封装，请补充守卫逻辑、状态转换或上下文日志。 |
| `SEC-LEAK-001` | <a id="sec-leak-001"></a>`security` | `SEC` | `warning` | `all` | 日志/异常中输出敏感数据（密码、令牌、个人标识）。 | 脱敏后再记录，或只记录标识符与哈希。 |
| `SEC-VUL-001` | <a id="sec-vul-001"></a>`security` | `SEC` | `error` | `all` | 任意动态代码执行（eval/exec/Function 构造）。 | 改为显式分支或查表；确需动态求值时使用受限解析器。 |
| `SEC-VUL-002` | <a id="sec-vul-002"></a>`security` | `SEC` | `error` | `all` | 命令注入：拼接外部输入后交给 shell/子进程执行。 | 使用参数数组形式（execFile/spawn 无 shell）并对输入做白名单校验。 |
| `SEC-VUL-003` | <a id="sec-vul-003"></a>`security` | `SEC` | `warning` | `all` | 原型污染：给对象原型写入来自外部的键。 | 拒绝 __proto__/constructor/prototype 键，或改用 Map 承载外部数据。 |
| `SEC-VUL-004` | <a id="sec-vul-004"></a>`security` | `SEC` | `warning` | `all` | 不安全随机数：用 Math.random 生成安全敏感值。 | 改用 crypto.randomUUID/randomBytes 等密码学安全随机源。 |
| `SEC-VUL-005` | <a id="sec-vul-005"></a>`security` | `SEC` | `warning` | `all` | 弱哈希：md5/sha1 用于完整性或口令场景。 | 改用 sha256 及以上；口令使用 bcrypt/argon2 等加盐慢哈希。 |
| `SEC-VUL-006` | <a id="sec-vul-006"></a>`security` | `SEC` | `warning` | `all` | 路径穿越：用外部输入拼接文件路径。 | 规范化后校验是否仍位于允许的根目录内，并拒绝 .. 片段。 |
| `SIM-ARGS-001` | <a id="sim-args-001"></a>`simplify` | `SIM` | `warning` | `all` | 单个函数入参超过 4 个（默认阈值 4），导致调用方参数传递脆弱且难以扩展。 | 将离散参数重构封装为强类型参数对象（ParameterObject 或 Options 结构体）。 |
| `SIM-BOOL-001` | <a id="sim-bool-001"></a>`simplify` | `SIM` | `info` | `typescript, javascript` | 冗余的布尔字面量显式比对。 | 简化为直接条件判断或布尔否定。 |
| `SIM-COMC-001` | <a id="sim-comc-001"></a>`simplify` | `SIM` | `warning` | `all` | 直接删除（历史在 git 里）或恢复为真实代码 | 连续 ≥ `commentedCodeMinLines`（默认 3）行「代码形状」注释。关键字锚定（`def`/`function`/`return`/`if`/`import`… 或 `NAME =` 形式），散文注释不会命中。 |
| `SIM-ELSE-001` | <a id="sim-else-001"></a>`simplify` | `SIM` | `info` | `typescript, javascript` | 提前终止语句之后存在冗余 else 分支。 | 移除冗余 else 并平铺后续主体逻辑。 |
| `SIM-EMPTY-001` | <a id="sim-empty-001"></a>`simplify` | `SIM` | `warning` | `all` | 实现函数体、显式抛「未实现」异常，或删除声明 | 函数体只剩 `pass`/`...`（跳过前置 docstring）或空 `{}`。 |
| `SIM-FLAT-002` | <a id="sim-flat-002"></a>`simplify` | `SIM` | `warning` | `all` | 深层嵌套的条件分支与 AST 访问流应使用卫语句（Guard Clause）提前返回或短路扁平化，控制嵌套深度 ≤ 3。 | 将深层嵌套的 if/else 重构为反向条件的前置卫语句（提前 return/continue/break），保持主逻辑扁平清晰。 |
| `SIM-GUARD-001` | <a id="sim-guard-001"></a>`simplify` | `SIM` | `info` | `typescript, javascript` | 倒置的前置守卫条件导致深层嵌套。 | 反转条件提取提前返回的 Guard Clause。 |
| `SIM-IMM-001` | <a id="sim-imm-001"></a>`simplify` | `SIM` | `info` | `all` | 通过三元表达式折叠消除未初始化的局部可变绑定，提纯为不可变 const | 将 let x; if (c) { x = a; } else { x = b; } 提纯为 const x = c ? a : b;，消除可变状态生命周期。 |
| `SIM-LONG-001` | <a id="sim-long-001"></a>`simplify` | `SIM` | `warning` | `all` | 抽取内聚步骤为具名 helper，让顶层流程只剩意图序列 | 函数物理跨度超过 `thresholds.maxFunctionLines`（默认 60）。跨度取适配器物化的起止行，覆盖 TS/JS/Python/Rust/GDScript。 |
| `SIM-PRNT-001` | <a id="sim-prnt-001"></a>`simplify` | `SIM` | `warning` | `all` | 改用结构化 logger 或删除；调试输出绕过日志级别并泄漏到生产 stdout | 非豁免路径出现调试输出（`print`/`pprint`/`breakpoint`/`console.log`/`println!`/`dbg!` 等）。默认豁免 `**/cli/**`、`**/scripts/**`、`**/tests/**`、`**/bench/**`、`*.test.*`、`*.spec.*`，可用 `printAllowPatterns` 覆盖。 |
| `SIM-TRN-001` | <a id="sim-trn-001"></a>`simplify` | `SIM` | `info` | `all` | 冗长且无副作用的 if-else 分支可折叠为浅层单行三元表达式 | 双分支为同变量单一赋值或纯返回值时，在无副作用、单层深度且行长 ≤ 80 字符的前提下折叠为三元表达式，降低控制流复杂度。 |

### Layer 2 — 语言族惯用法与现代化演进层 (Language-Family Modernization)

| 规则 ID | 所属分析器 | 规则族 | 默认级别 | 适用语言 | 规则中文摘要 (`summary`) | 修复与重构指引 (`remediation`) |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `GDM-BAR-001` | <a id="gdm-bar-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层直接离散操作裸 ProgressBar 实例，破坏 KStatusBar 标准交互与平滑动画规范。 | 改用 KStatusBar 标准化组件，统一进度条生命周期、平滑补间动效与样式契约。 |
| `GDM-BND-001` | <a id="gdm-bnd-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层视图直接耦合后端领域单例或跨层订阅 EventBus 全局业务事件。 | 表现层仅通过 BaseScreen.apply_snapshot() 单向接收数据，用户操作经由显式回调或 UI 意图派发。 |
| `GDM-CONNECT-001` | <a id="gdm-connect-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 Godot 3 connect 签名（方法名以字符串传入）。 | 改用信号 connect(Callable) 形式。 |
| `GDM-DEB-001` | <a id="gdm-deb-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 高频业务按钮裸连信号，缺少防抖机制或 loading 状态互斥控制。 | 改用 KButton 原子组件或接入 debounced_pressed 信号以防连击重复提交。 |
| `GDM-EXPORT-001` | <a id="gdm-export-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 Godot 3 的 export 语句。 | 改用 @export 注解并保留类型声明。 |
| `GDM-EXT-001` | <a id="gdm-ext-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层主视图控制器未继承 BaseScreen 或 BaseModal 基类。 | 主视图控制器应继承 BaseScreen（全屏视图）或 BaseModal（模态弹窗），接入标准生命周期与快照装配契约。 |
| `GDM-FSM-001` | <a id="gdm-fsm-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 有限状态机私有状态变量被就地直接赋值，破坏状态迁移守卫与进出钩子。 | 必须通过 fsm.transition_to(target_state, payload) 方法触发合法状态流转。 |
| `GDM-I18N-001` | <a id="gdm-i18n-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层 UI 文本未通过 UIIntermediary / 国际化键名绑定，存在裸字符串硬编码。 | UI 文本必须采用 tr(KEY) 或通过 UIIntermediary 进行响应式国际化绑定。 |
| `GDM-LOC-001` | <a id="gdm-loc-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层视图脚本行数超出物理预算上限（LOC <= 450 行）。 | 将复杂子组件、列表项渲染、数据转换器或伴生逻辑拆分为独立组件或伴生控制器。 |
| `GDM-NOD-001` | <a id="gdm-nod-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 视图层脚本中出现飘移的相对节点路径（如 get_parent()、find_child() 或长跨级相对索引）。 | 节点引用应使用显式 @onready %UniqueNode 或类型化依赖注入，禁止易脆弱的相对层级寻址。 |
| `GDM-ONREADY-001` | <a id="gdm-onready-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 onready 关键字。 | 改用 @onready 注解。 |
| `GDM-POOL-001` | <a id="gdm-pool-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 Pool*Array 类型。 | 改用 Packed*Array 系列类型。 |
| `GDM-POOL-002` | <a id="gdm-pool-002"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 对象池 reset_state 未调用基类重置方法破坏契约。 | 在 reset_state() 内部添加 super.reset_state() 调用以确保父类状态正确清理。 |
| `GDM-RES-001` | <a id="gdm-res-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | UI 布局脚本中硬编码固定分辨率或绝对像素尺寸，破坏多端响应式适配。 | 改用 Anchors Preset 锚点系统、自适应容器或 DesignTokens 相对尺寸基准。 |
| `GDM-RPC-001` | <a id="gdm-rpc-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 remote/master/puppet/slave 函数修饰符。 | 改用 @rpc 注解。 |
| `GDM-TOK-001` | <a id="gdm-tok-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层视图硬编码 Color(...) 字面量或裸色值，破坏 DesignTokens 单一真源。 | 从 DesignTokens 获取语义化色彩常量（如 DesignTokens.COLOR_*），确保主题与多端视觉统一。 |
| `GDM-TOOL-001` | <a id="gdm-tool-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用裸 tool 关键字。 | 改用首行 @tool 注解。 |
| `GDM-UNI-001` | <a id="gdm-uni-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 表现层视图就地修改只读 Snapshot DTO 属性，破坏 CQRS 单向数据流与单一真源。 | 视图应将快照视为不可变只读数据，通过派发 Command 意图或调用领域边界服务请求变更。 |
| `GDM-VRT-001` | <a id="gdm-vrt-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 长列表场景全量就地实例化节点，未接入 KVirtualList 虚拟化滚动与对象池复用。 | 长列表容器应接入 KVirtualList 配合对象池池化复用（ADV-POOL-001），禁止无界瞬态节点创建。 |
| `GDM-WEAK-001` | <a id="gdm-weak-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 动态观察者或全局管理器强引用持有 Node 实例，未采用 weakref 防内存泄漏。 | 使用 weakref(node) 包装动态注册对象并在派发时校验 get_ref() 是否存活。 |
| `GDM-YIELD-001` | <a id="gdm-yield-001"></a>`gdscript-modern` | `GDM` | `warning` | `gdscript` | 使用 Godot 3 的 yield 协程写法。 | 改用 await 表达式。 |
| `GOM-CTX-001` | <a id="gom-ctx-001"></a>`go-modern` | `GOM` | `warning` | `go` | context.Context 不是函数的首个形参。 | 将 ctx context.Context 移动到第一个形参位置。 |
| `GOM-ERR-001` | <a id="gom-err-001"></a>`go-modern` | `GOM` | `warning` | `go` | 使用 _ 静默丢弃错误返回值。 | 显式检查错误或说明忽略理由。 |
| `GOM-STYLE-001` | <a id="gom-style-001"></a>`go-modern` | `GOM` | `info` | `go` | 方法接收器命名不符合 Go 惯例。 | 使用 1-2 字母短名且与类型保持一致。 |
| `GOM-STYLE-002` | <a id="gom-style-002"></a>`go-modern` | `GOM` | `info` | `go` | 错误变量未以 err 开头。 | 将变量重命名为以 err 开头。 |
| `GOM-STYLE-003` | <a id="gom-style-003"></a>`go-modern` | `GOM` | `info` | `go` | 导出包注释或包命名不符合规范。 | 添加规范包注释或修正包名。 |
| `PROD-HYG-001` | <a id="prod-hyg-001"></a>`production-hygiene` | `PROD` | `error` | `all` | 生产构建产物包含调试输出、未决标记或绝对路径。 | 配置打包构建工具移除 console、注释与源码绝对路径。 |
| `PROD-HYG-002` | <a id="prod-hyg-002"></a>`production-hygiene` | `PROD` | `error` | `all` | 生产环境暴露 Source Map 或 sourceMappingURL 指令。 | 关闭公共 Source Map 或仅上传至内部私有崩溃追踪服务。 |
| `PROD-HYG-003` | <a id="prod-hyg-003"></a>`production-hygiene` | `PROD` | `error` | `all` | 敏感后端环境变量泄露至客户端代码包。 | 确保密钥留在服务端，前端仅使用公开环境变量前缀。 |
| `PS-ALIAS-001` | <a id="ps-alias-001"></a>`shell-lint` | `PS` | `info` | `powershell` | PowerShell 脚本使用了不推荐的命令别名。 | 替换为规范的 Cmdlet 全称。 |
| `PS-CMDLET-001` | <a id="ps-cmdlet-001"></a>`shell-lint` | `PS` | `info` | `powershell` | 函数命名不符合 Verb-Noun 动名词规范。 | 使用标准审批动词与名词重构函数名。 |
| `PS-DOC-001` | <a id="ps-doc-001"></a>`shell-lint` | `PS` | `warning` | `powershell` | PowerShell 脚本缺少标准帮助文档注释块（.SYNOPSIS / .DESCRIPTION）。 | 在脚本头部编写标准帮助注释块（<# .SYNOPSIS ... #>）。 |
| `PS-ERROR-001` | <a id="ps-error-001"></a>`shell-lint` | `PS` | `warning` | `powershell` | PowerShell 中存在空 catch 或未捕获的错误。 | 补充错误捕获处理与告警日志。 |
| `PS-PARAM-001` | <a id="ps-param-001"></a>`shell-lint` | `PS` | `info` | `powershell` | 参数块缺失 [CmdletBinding()] 或参数未声明强类型。 | 添加 [CmdletBinding()] 并为参数声明类型。 |
| `PS-SAFE-001` | <a id="ps-safe-001"></a>`shell-lint` | `PS` | `warning` | `powershell` | 非交互式或无终端环境下裸用 Read-Host 阻塞执行。 | 增加交互式宿主守卫（$Host.UI）或改用参数传递输入。 |
| `PS-SEC-001` | <a id="ps-sec-001"></a>`shell-lint` | `PS` | `error` | `powershell` | 使用 Invoke-Expression (iex) 动态执行不可信变量，存在代码注入隐患。 | 避免使用 Invoke-Expression，改用参数化 Cmdlet 或 call operator (&)。 |
| `PS-TRAP-001` | <a id="ps-trap-001"></a>`shell-lint` | `PS` | `warning` | `powershell` | 申请受控系统资源（FileStream/Mutex 等）后缺少 try-finally 释放保护。 | 使用 try/finally 块或 Dispose() 确保异常路径下资源可靠释放。 |
| `PS-VERB-001` | <a id="ps-verb-001"></a>`shell-lint` | `PS` | `info` | `powershell` | 使用了未批准的 PowerShell 动词。 | 改用 Get-Verb 批准的标准动词。 |
| `PYM-ABC-001` | <a id="pym-abc-001"></a>`python-modern` | `PYM` | `error` | `python` | 从 typing 导入 collections.abc 抽象类型。 | 改从 collections.abc 导入。 |
| `PYM-ASYNC-001` | <a id="pym-async-001"></a>`python-modern` | `PYM` | `error` | `python` | async 函数内阻塞调用或未 await 的同步 ORM 调用。 | 改用 async 等价物（asyncio/httpx/异步仓储）。 |
| `PYM-DATETIME-001` | <a id="pym-datetime-001"></a>`python-modern` | `PYM` | `error` | `python` | timezone.utc 用法。 | 改用 datetime.UTC（PEP 615）。 |
| `PYM-DEFAULT-001` | <a id="pym-default-001"></a>`python-modern` | `PYM` | `warning` | `python` | 可变默认参数（=[]/={}/=set()）。 | 改用 None 哨兵，在函数体内构造。 |
| `PYM-FSTRING-001` | <a id="pym-fstring-001"></a>`python-modern` | `PYM` | `warning` | `python` | % 格式化字符串。 | 改写为 f-string。 |
| `PYM-GENERIC-001` | <a id="pym-generic-001"></a>`python-modern` | `PYM` | `error` | `python` | 旧式容器泛型 List/Dict/Set/Tuple/Type[...]。 | 改用内置泛型 list[...] 等（PEP 585）。 |
| `PYM-IMPORT-001` | <a id="pym-import-001"></a>`python-modern` | `PYM` | `warning` | `python` | 模块级 import 未按三段式分组或段内未按字典序（函数内惰性导入不参与）。 | 按 PEP 8 分组并段内排序。 |
| `PYM-OPEN-001` | <a id="pym-open-001"></a>`python-modern` | `PYM` | `warning` | `python` | open() 未处于 with 块内。 | 包进 with open(...) as handle:。 |
| `PYM-PATH-001` | <a id="pym-path-001"></a>`python-modern` | `PYM` | `warning` | `python` | os.path 用法。 | 迁移到 pathlib.Path（Path(...) / name）。 |
| `PYM-RAISE-001` | <a id="pym-raise-001"></a>`python-modern` | `PYM` | `warning` | `python` | except 块内 raise X 缺少 from，异常链丢失。 | 写 raise X from exc，或裸 raise 原样上抛。 |
| `PYM-SHADOW-001` | <a id="pym-shadow-001"></a>`python-modern` | `PYM` | `warning` | `python` | 变量或参数遮蔽了 Python 核心内置标识符。 | 重命名变量以避免与内置函数或类型发生命名冲突。 |
| `PYM-SLOTS-001` | <a id="pym-slots-001"></a>`python-modern` | `PYM` | `warning` | `python` | 无继承的 @dataclass 未声明 slots=True。 | 加 slots=True；确需 __dict__ 时显式 slots=False。 |
| `PYM-UNION-001` | <a id="pym-union-001"></a>`python-modern` | `PYM` | `error` | `python` | 注解或类型别名位置使用 Optional[...]/Union[...]。 | 改用 PEP 604 写法 X \| None。 |
| `RSM-CAST-001` | <a id="rsm-cast-001"></a>`rust-modern` | `RSM` | `info` | `rust` | 易引起静默溢出或数值截断的裸 as 强转。 | 改用 TryFrom/try_into() 显式处理溢出或使用 From/from()。 |
| `RSM-CLONE-001` | <a id="rsm-clone-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | clone() 结果只用于比较或取长度。 | 改为借用比较，避免不可见复制。 |
| `RSM-ELSE-001` | <a id="rsm-else-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | if let ... else { return/break; } 单分支提前退出。 | 迁移至 Rust 1.65+ 的扁平 let ... else 语法。 |
| `RSM-EXTERN-001` | <a id="rsm-extern-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 使用 extern crate 声明。 | 2018 edition 起删除，直接按路径 use 依赖。 |
| `RSM-FIND-001` | <a id="rsm-find-001"></a>`rust-modern` | `RSM` | `info` | `rust` | 手动 for 循环遍历查找后立即 return 的模式。 | 改用迭代器内置惯用法 .find() / .any() / .position()。 |
| `RSM-FORMAT-001` | <a id="rsm-format-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 格式化宏使用位置参数 {}。 | 改用内联捕获 "{value}"，由编译器校验名称。 |
| `RSM-LOCK-001` | <a id="rsm-lock-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | async fn 作用域内持有同步锁守卫跨 .await 挂起。 | 缩窄锁作用域在 await 前释放，或改用 tokio::sync::Mutex。 |
| `RSM-MACRO-001` | <a id="rsm-macro-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 使用 #[macro_use] 文本导入宏。 | 显式 use 目标宏，保留可追溯来源。 |
| `RSM-STR-001` | <a id="rsm-str-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 签名使用 &String 参数。 | 改用 &str（或 impl AsRef<str>）。 |
| `RSM-TRY-001` | <a id="rsm-try-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 使用 try! 宏。 | 改用 ? 运算符，可嵌入更大的表达式。 |
| `RSM-UNWRAP-001` | <a id="rsm-unwrap-001"></a>`rust-modern` | `RSM` | `warning` | `rust` | 对可失败结果调用 unwrap()。 | 改用 ? 传播，或用 expect 说明不变式。 |
| `SH-ARRAY-001` | <a id="sh-array-001"></a>`shell-lint` | `SH` | `info` | `shell` | 使用 $* 代替了 "$@" 导致单词分割失效。 | 使用 "$@" 保持各个位置参数的独立性。 |
| `SH-CMD-001` | <a id="sh-cmd-001"></a>`shell-lint` | `SH` | `info` | `shell` | 使用了已过时的反引号命令替换语法。 | 改用现代标准的 $(...) 命令替换语法。 |
| `SH-COND-001` | <a id="sh-cond-001"></a>`shell-lint` | `SH` | `warning` | `shell` | Bash 脚本在复合条件或正则匹配中使用脆弱的单中括号 [ ... ] 语法。 | 在 Bash 脚本中改用标准的 [[ ... ]] 双中括号测试语法，或遵循严格 POSIX 测试规范。 |
| `SH-DEPR-001` | <a id="sh-depr-001"></a>`shell-lint` | `SH` | `info` | `shell` | 使用了单中括号 [ 或旧式废弃测试语法。 | 在 Bash 脚本中改用现代标准的 [[ 测试语法。 |
| `SH-DOC-001` | <a id="sh-doc-001"></a>`shell-lint` | `SH` | `warning` | `shell` | Shell 脚本头部缺少模块与职责元数据说明注释。 | 在脚本头部添加包含模块、描述与退出语义的规范注释。 |
| `SH-ECHO-001` | <a id="sh-echo-001"></a>`shell-lint` | `SH` | `info` | `shell` | 使用了不可移植的 echo -e / echo -n。 | 改用 POSIX 标准统一的 printf 命令。 |
| `SH-EOL-001` | <a id="sh-eol-001"></a>`shell-lint` | `SH` | `error` | `shell` | Shell 脚本包含 Windows CRLF 换行符，在 Linux 运行期引发语法解析崩溃。 | 严格采用 LF (0x0A) 换行符保存 Shell 脚本。 |
| `SH-ERR-001` | <a id="sh-err-001"></a>`shell-lint` | `SH` | `warning` | `shell` | 关键命令执行后未进行错误退出码判定。 | 通过 \|\| exit 或 set -e 强化错误退出机制。 |
| `SH-EXIT-001` | <a id="sh-exit-001"></a>`shell-lint` | `SH` | `warning` | `shell` | set -e 模式下裸调预期可能失败的命令，引发脚本意外熔断。 | 采用 command \|\| status=$? 或 if 判定安全捕获退出码。 |
| `SH-INIT-001` | <a id="sh-init-001"></a>`shell-lint` | `SH` | `warning` | `shell` | Shell 脚本头部未声明 set -euo pipefail 严格模式。 | 在脚本开头声明 set -euo pipefail 提升鲁棒性。 |
| `SH-QUOTE-001` | <a id="sh-quote-001"></a>`shell-lint` | `SH` | `warning` | `shell` | 参数展开未加双引号保护存在单词拆分与通配隐患。 | 对变量引用使用 "$var" 进行双引号保护。 |
| `SH-READ-001` | <a id="sh-read-001"></a>`shell-lint` | `SH` | `info` | `shell` | read 命令未携带 -r 参数导致反斜杠被转义篡改。 | 使用 read -r 读取原始输入文本。 |
| `SH-SAFE-001` | <a id="sh-safe-001"></a>`shell-lint` | `SH` | `warning` | `shell` | read 命令缺少超时 (-t) 或终端守护，CI 环境下易导致死锁。 | 为交互式读取添加超时或增加 [ -t 0 ] 终端判断。 |
| `SH-SEC-001` | <a id="sh-sec-001"></a>`shell-lint` | `SH` | `error` | `shell` | 使用 eval 拼接变量执行动态指令，存在任意命令注入高危漏洞。 | 消除 eval 动态拼接，改用函数、数组或直接参数化调用。 |
| `SH-TRAP-001` | <a id="sh-trap-001"></a>`shell-lint` | `SH` | `warning` | `shell` | 创建临时文件/目录后缺少 EXIT 陷阱清理，导致磁盘垃圾残留。 | 声明 trap 'rm -rf "$tmp"' EXIT 确保退出时清理临时文件。 |
| `STDLIB-ALLOC-001` | <a id="stdlib-alloc-001"></a>`stdlib` | `STDLIB` | `error` | `all` | 裸机与 no_std 系统运行环境下隐式堆逃逸与动态重分配静态拦截。 | 在 no_std / core 作用域下使用固定容量栈缓冲、借用切片或预分配内存池，避免裸调 Box::new / malloc。 |
| `STDLIB-CONST-001` | <a id="stdlib-const-001"></a>`stdlib` | `STDLIB` | `warning` | `all` | 标准库密码学与哈希敏感比较严禁分支时间泄漏，强制常量时间恒定延迟比对。 | 使用恒定时间累加比对（如 constant_time_eq / subtle::ConstantTimeEq），严禁在字节不匹配时提前 return false。 |
| `STDLIB-PANIC-001` | <a id="stdlib-panic-001"></a>`stdlib` | `STDLIB` | `warning` | `all` | 系统标准库公开接口严禁逃逸裸 panic/unwrap/abort，强制 Result/Option 或有界 error 返回。 | 对可能失败的公开 API 采用 Result<T, E> 或显式 error code 表达错误，内部调用使用 match 或 ? 操作符解包。 |
| `STDLIB-PORT-001` | <a id="stdlib-port-001"></a>`stdlib` | `STDLIB` | `warning` | `all` | 底层平台条件编译 #[cfg(...)] 缺少未知平台或未支持目标架构时的 fallback 阻断。 | 在特定操作系统/目标平台条件编译块末尾添加 compile_error! 或通用软实现作为兜底后备。 |
| `STDLIB-RECURSION-001` | <a id="stdlib-recursion-001"></a>`stdlib` | `STDLIB` | `warning` | `all` | 底层核心算法无界深层递归缺乏显式栈深检查或上限防卫。 | 为递归算法引入显式 depth 计数限制，或改用显式工作栈与迭代平铺展开循环。 |
| `STDLIB-UNSAFE-001` | <a id="stdlib-unsafe-001"></a>`stdlib` | `STDLIB` | `error` | `all` | Rust/C++ 底层 unsafe 块强制附带 SAFETY: 契约证明，缺失即阻断。 | 在每个 unsafe 块或函数前编写 SAFETY: 契约注释，明确记录调用者必须保证的前置条件与内存安全不变量。 |
| `TSM-ANY-001` | <a id="tsm-any-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 显式 any 关闭了该值的类型检查。 | 改用 unknown 加收窄，或精确的泛型/联合类型。 |
| `TSM-ARGS-001` | <a id="tsm-args-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 使用 arguments 对象。 | 改用剩余参数（...args），可被类型系统检查。 |
| `TSM-CTOR-001` | <a id="tsm-ctor-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 用 new 调用 Array/Object/String/Number/Boolean 包装构造器。 | 改用字面量或 String()/Number()/Boolean() 原始转换。 |
| `TSM-DISP-001` | <a id="tsm-disp-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | VS Code 监听器或 Disposable 对象未注册至 subscriptions 容器。 | 使用 context.subscriptions.push(...) 或生命周期容器管理 Disposable 以防泄露。 |
| `TSM-INCLUDES-001` | <a id="tsm-includes-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | indexOf 与 -1/0 比较来判断成员存在。 | 改用 includes(value)。 |
| `TSM-REPLACE-001` | <a id="tsm-replace-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 字符串模式 replace 只替换首个匹配。 | 需要全量替换时改用 replaceAll。 |
| `TSM-REQUIRE-001` | <a id="tsm-require-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | ESM 模块内混用 CommonJS require() 调用。 | 改为 import 绑定，保持单一模块体系。 |
| `TSM-SPREAD-001` | <a id="tsm-spread-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 用 Object.assign({}, …) 做浅合并。 | 改用对象展开 { ...source }。 |
| `TSM-SUBSTR-001` | <a id="tsm-substr-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 使用已弃用的 String.prototype.substr。 | 改用 slice(start, start + length)。 |
| `TSM-TYPE-001` | <a id="tsm-type-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 具名导入仅用于类型位置。 | 改为 import type { … }，让绑定在编译期被擦除。 |
| `TSM-VAR-001` | <a id="tsm-var-001"></a>`ts-modern` | `TSM` | `warning` | `typescript, javascript` | 使用 var 声明（函数作用域、存在变量提升）。 | 改用 const；需要重新赋值时用 let。 |
| `UI-ENG-001` | <a id="ui-eng-001"></a>`frontend` | `UI` | `warning` | `all` | HTML 语义结构不当或交互元素缺失无障碍属性。 | 为图片补全 alt，为表单补全 label，为自定义控件指定 role。 |
| `UI-ENG-002` | <a id="ui-eng-002"></a>`frontend` | `UI` | `warning` | `all` | DOM 层级深度超过 12 或 CSS 动画使用了重排属性。 | 扁平化 DOM 层次，动效改用 transform 与 opacity 合成属性。 |
| `UI-ENG-003` | <a id="ui-eng-003"></a>`frontend` | `UI` | `warning` | `all` | 组件 Props 超过 10 个或存在复杂重复 DOM 模板。 | 拆分为单一职责微组件，提升组件复用率。 |
| `UI-ENG-004` | <a id="ui-eng-004"></a>`frontend` | `UI` | `info` | `all` | 前端 Hook 或事件回调函数命名不符合规范。 | 自定义 Hook 以 use 开头，事件回调以 on 或 handle 开头。 |

### Layer 3 — 架构拓扑、工程治理、数据与性能层 (Architecture, Governance, Data & Performance)

| 规则 ID | 所属分析器 | 规则族 | 默认级别 | 适用语言 | 规则中文摘要 (`summary`) | 修复与重构指引 (`remediation`) |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `ARCH-ABS-001` | <a id="arch-abs-001"></a>`architecture` | `ARCH` | `warning` | `all` | 过度抽象与非必要间接层：为少量共性引入跨层深层转发跳板、跨域依赖反转或循环依赖。 | 消除负收益间接跳板与人为抽象，容许领域隔离的局部正当实现。 |
| `ARCH-BLR-001` | <a id="arch-blr-001"></a>`architecture` | `ARCH` | `warning` | `all` | 文件边界失衡：单文件内多个高复杂度函数缺乏语义关联，职责异常聚合。 | 按语义与状态边界将文件拆分为高内聚的独立领域模块。 |
| `ARCH-BND-001` | <a id="arch-bnd-001"></a>`architecture` | `ARCH` | `warning` | `all` | 跨业务域内部穿透：绕过公共导出 Facade 契约直接访问非公开内部实现。 | 通过模块顶层公共导出 API 访问，禁止直接引用 /internal/ 或 /private/。 |
| `ARCH-CFG-001` | <a id="arch-cfg-001"></a>`architecture` | `ARCH` | `info` | `all` | 环境配置泄漏：纯领域业务模型内部直接读取环境变量或底层磁盘配置。 | 将环境配置提升到应用装配层解析，并以强类型参数注入领域对象。 |
| `ARCH-CFG-002` | <a id="arch-cfg-002"></a>`architecture` | `ARCH` | `warning` | `all` | 声明的配置项在全库代码中从未参与任何决策、控制流或计算（死配置）。 | 移除无用死配置项或补充对应业务开关/策略引用。 |
| `ARCH-CFG-003` | <a id="arch-cfg-003"></a>`architecture` | `ARCH` | `warning` | `all` | 同一配置项在多处重复定义，破坏配置单一真源。 | 收敛重复配置到单一配置表或继承层级中。 |
| `ARCH-CFG-004` | <a id="arch-cfg-004"></a>`architecture` | `ARCH` | `warning` | `all` | 隐式配置散落：业务代码中散落硬编码环境变量读取或隐式调优参数。 | 将散落的环境变量与调优参数提取至统一配置对象并通过参数注入。 |
| `ARCH-CFG-005` | <a id="arch-cfg-005"></a>`architecture` | `ARCH` | `warning` | `all` | 配置访问散落：未通过统一配置层或注册表，跨层无序散落访问配置。 | 建立统一配置访问层或注册表，集中收口配置读取。 |
| `ARCH-CFG-006` | <a id="arch-cfg-006"></a>`architecture` | `ARCH` | `warning` | `all` | 配置业务强耦合：领域模型直接绑定具体配置文件物理格式或磁盘解析。 | 通过接口或类型化策略对象解耦，由外层装配并注入领域核心。 |
| `ARCH-CFG-007` | <a id="arch-cfg-007"></a>`architecture` | `ARCH` | `info` | `all` | 配置过度抽象：简单静态配置引入多重不必要间接封装与透传层。 | 按项目规模裁剪冗余封装，平铺轻量配置访问。 |
| `ARCH-CFG-008` | <a id="arch-cfg-008"></a>`architecture` | `ARCH` | `warning` | `all` | 配置表根目录平铺蔓延反模式：超过阈值的大量配置平铺于根目录，缺乏领域同构分层。 | 建立领域同构目录（如 config/domains/<域>/core.json），统一分域收拢并消除根目录平铺散落。 |
| `ARCH-CFG-009` | <a id="arch-cfg-009"></a>`architecture` | `ARCH` | `warning` | `all` | 配置子表路由契约违规：未登记的子表配置脱离主核心路由契约，缺乏点分泛化路由与热重载看守。 | 将子表登记至主配置表并接入点分路由与细粒度热重载守卫。 |
| `ARCH-DEC-002` | <a id="arch-dec-002"></a>`architecture` | `ARCH` | `warning` | `all` | 多语言 AST 解析与适配器逻辑必须独立解耦为适配器模块，分析器主体严禁混杂语法树构造细节或深耦合特定语言适配器实现。 | 将多语言 AST 构造逻辑抽取至 `src/core/semantic/adapters/` 独立适配器，分析器仅面向 `NormalizedNode` 或多态接口。 |
| `ARCH-DIR-001` | <a id="arch-dir-001"></a>`architecture` | `ARCH` | `warning` | `all` | 倒置依赖，在领域层定义接口契约，由外层实现。 | 核心逆流：领域层 (Domain) 反向依赖外层应用层/基础设施/接口层。 |
| `ARCH-DIR-002` | <a id="arch-dir-002"></a>`architecture` | `ARCH` | `warning` | `all` | 引入用例服务 (Application Service) 统筹业务流。 | 越层穿透：接口层控制器绕过应用层直接直连基础设施实现。 |
| `ARCH-DIR-003` | <a id="arch-dir-003"></a>`architecture` | `ARCH` | `error` | `all` | 形式分层假象：目录结构表面隔离，但调用关系与数据流发生逆向越层。 | 调整调用依赖流向，由内层领域定义契约接口并交由基础设施层实现。 |
| `ARCH-DISP-001` | <a id="arch-disp-001"></a>`architecture` | `ARCH` | `warning` | `all` | Monolithic dispatchers with excessive branches (> 8) tightly couple domain logic, violating the Open-Closed Principle. | 重构为基于字典/Map 的查表分发 (Table-Driven) 或策略模式 (Strategy Pattern)，解耦各分支业务逻辑。 |
| `ARCH-DSP-002` | <a id="arch-dsp-002"></a>`architecture` | `ARCH` | `warning` | `all` | Dispatcher closure fragmentation: Object literal defines excessive inline function closures (>= 15), causing closure explosion and function inflation. | 重构为按职责正交划分的 switch 分发函数（单函数圈复杂度 <= 10）或顶层具名处理函数，消除闭包碎片化。 |
| `ARCH-FAC-001` | <a id="arch-fac-001"></a>`architecture` | `ARCH` | `warning` | `all` | 门面层实质性承载缺失：门面/网关模块缺乏领域编排、模式自验或不可变性冻结，退化为无意义转发层。 | 实现实质性编排、不可变冻结与模式自验，或消除空壳转发门面包装。 |
| `ARCH-GLB-001` | <a id="arch-glb-001"></a>`architecture` | `ARCH` | `warning` | `all` | 隐式全局可变状态：模块间通过顶层全局变量或单例产生隐式强耦合。 | 重构为依赖注入或按需创建实例，消除共享可变静态单例。 |
| `ARCH-HDL-001` | <a id="arch-hdl-001"></a>`architecture` | `ARCH` | `error` | `all` | 无头架构违规：核心业务逻辑或计算模块直接绑定 UI/IDE 视图框架。 | 解除核心计算与展示框架依赖，保持无头独立执行与测试能力。 |
| `ARCH-LEAK-001` | <a id="arch-leak-001"></a>`architecture` | `ARCH` | `warning` | `all` | 领域模型使用 POJO/原生实体，隔离外部框架专有类型。 | 职责泄漏：纯领域模型直接引用或泄漏外部框架库 (Express/Vue/Godot/ORM)。 |
| `ARCH-LEAK-002` | <a id="arch-leak-002"></a>`architecture` | `ARCH` | `warning` | `all` | 分层越界：外层实现被内层直接反向引用（Clean/DDD 层序反转）。 | 把依赖改回单向（内层定义接口、外层实现），或把该文件移入正确层。 |
| `ARCH-ROL-001` | <a id="arch-rol-001"></a>`architecture` | `ARCH` | `warning` | `all` | 文件本体角色失衡与伪共享库：文件承担过多易变状态或高耦合业务逻辑，却被跨域频繁引用作为共享库。 | 剥离核心领域状态，明确稳定输入输出边界，构建真正低耦合的共享库。 |
| `ARCH-ROL-002` | <a id="arch-rol-002"></a>`architecture` | `ARCH` | `warning` | `all` | 业务模块承载无界公共能力：领域业务模块内部私自承载与导出通用基础设施或公共计算能力。 | 将通用能力下沉至对应共享层或基础设施层，确保领域模块职责专注单一。 |
| `ARCH-SKL-001` | <a id="arch-skl-001"></a>`architecture` | `ARCH` | `info` | `all` | 策略骨架复用候选：检测到具有同构前置校验与收尾步骤的复杂流程。 | 提取公共执行骨架（模板方法/高阶函数编排），将差异步骤作为策略注入。 |
| `ARCH-TMP-001` | <a id="arch-tmp-001"></a>`architecture` | `ARCH` | `warning` | `all` | 巨石视图/模板渲染器未解耦：单函数规模超标且包含深度 HTML/SVG/DSL 模板字符串拼接，缺少局部组件化。 | 拆解为领域正交的局部组件（Header/Card/Graph Partials），由结构化 ViewModel 驱动渲染。 |
| `ARCH-UTL-001` | <a id="arch-utl-001"></a>`architecture` | `ARCH` | `warning` | `all` | 高异构耦合工具库反模式：检测到承担混杂多域职责的通用工具模块。 | 按四分流治理原则重构：纯算子进入算法库、常量进入常量库、规则进入策略库、通用转换进入基础层。 |
| `CMP-CAL-001` | <a id="cmp-cal-001"></a>`governance` | `CMP` | `warning` | `typescript, javascript` | Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions. | 降低回调嵌套深度：改用 async/await、Promise 链扁平化或抽取具名顶层函数。 |
| `CMP-DEN-001` | <a id="cmp-den-001"></a>`governance` | `CMP` | `warning` | `typescript, javascript` | Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity. | 降低认知密度：添加适当空白与具名中间常量，拆分高密度算式或位运算组合。 |
| `CMP-EXP-001` | <a id="cmp-exp-001"></a>`governance` | `CMP` | `warning` | `typescript, javascript` | Giant expressions with deeply nested ternaries or unbounded logical chains create cognitive overload and obscure branching logic. | 将巨型嵌套三元或长逻辑链拆分为具名中间变量或 if-else 分支。 |
| `CMP-LIN-001` | <a id="cmp-lin-001"></a>`governance` | `CMP` | `warning` | `typescript, javascript` | Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability. | 将单行内的多个语句或副作用拆分为独立代码行，遵循单行单一语义原则。 |
| `CONST-CLU-001` | <a id="const-clu-001"></a>`constants` | `CONST` | `warning` | `all` | 同调用域内存在未抽取的同源硬编码字面量（状态码/协议值/路径/事件名），应一揽子打包抽取。 | 结合临近代码域聚类建议，将同一语义族的同源字面量一并抽离为常量，避免遗留散乱硬编码。 |
| `CONST-DRF-001` | <a id="const-drf-001"></a>`constants` | `CONST` | `warning` | `all` | 跨文件同源语义常量存在命名分裂或数值微小漂移，必须建立单一真源（SSOT）。 | 将多文件维护的同源常量统一定义在领域或协议共享常量库中，并消除数值或命名漂移。 |
| `CONST-LAY-001` | <a id="const-lay-001"></a>`constants` | `CONST` | `warning` | `all` | 模块级稳定常量在依赖区后必须进入首个正式代码声明域，严禁散落在函数内部、文件中段或业务逻辑之间。 | 将模块级常量统一定义在文件导入声明（import/require）之后、任何函数/类声明之前的常量区。 |
| `CONST-LIB-001` | <a id="const-lib-001"></a>`constants` | `CONST` | `warning` | `all` | 大规模常量散落于业务代码文件中，缺乏集中分层的常量库目录结构。 | 根据 Agent 建议的目录拓扑与分片模块，在 constants/ 集中归档并提供统一 index.ts 导出。 |
| `CONST-OWN-001` | <a id="const-own-001"></a>`constants` | `CONST` | `warning` | `all` | 共享常量所有权分层错误，严禁塞入全局大杂烩 constants 文件或藏匿在底层私有模块。 | 按照所有权四层模型，分流至 Module-Private、Domain-Shared、Protocol-Shared 或 System-Config。 |
| `CONST-SCP-001` | <a id="const-scp-001"></a>`constants` | `CONST` | `warning` | `all` | 单函数局部不变量、延迟初始化值或受限生命周期资源禁止滥用扩大作用域提升至顶层。 | 保持局部不变量在单函数或局部代码块内部的作用域范围，避免盲目提升至文件全局。 |
| `CONST-SCP-002` | <a id="const-scp-002"></a>`constants` | `CONST` | `info` | `all` | 单函数体内散落的多处同类局部硬编码应在函数头部统一定义为局部常量。 | 在当前函数头部集中声明局部 const 常量并替换函数内部各处的散落字面量。 |
| `CPX-AMP-001` | <a id="cpx-amp-001"></a>`complexity` | `CPX` | `warning` | `all` | 复杂度放大陷阱：在迭代或热点调用链中隐式嵌套阻塞 I/O 或序列化。 | 将 I/O 与序列化批量汇聚在循环外部执行。 |
| `CPX-BUD-001` | <a id="cpx-bud-001"></a>`complexity` | `CPX` | `warning` | `all` | 超出弹性复杂度预算：综合语言、角色、代码域与清晰度测算的预算超标。 | 根据角色与职责拆分函数，或将多重嵌套扁平化为策略表/状态机。 |
| `CPX-HOP-001` | <a id="cpx-hop-001"></a>`complexity` | `CPX` | `warning` | `all` | 机械式拆分投机：通过制造大量单行薄转发包装函数人为压低复杂度。 | 消除无意义的透传转发包装，聚焦于语义重用与领域内聚。 |
| `CPX-JST-001` | <a id="cpx-jst-001"></a>`complexity` | `CPX` | `warning` | `all` | 非必要设计失控复杂度：高复杂度来自无序嵌套和职责堆积，缺乏算法/状态机证明。 | 梳理核心职责，解离混合流程并分离副作用。 |
| `CPX-NEST-001` | <a id="cpx-nest-001"></a>`complexity` | `CPX` | `warning` | `all` | 失控深层控制流嵌套：控制流嵌套层级超出该上下文类型的弹性预算（业务代码>3层，状态机/解析器>5层）。 | 利用提前返回（Guard Clauses）扁平化控制流，或将复杂分支独立为子状态处理函数。 |
| `CPX-NEST-002` | <a id="cpx-nest-002"></a>`complexity` | `CPX` | `warning` | `all` | 深层长跨度控制流跳跃：在深层嵌套（>=4层）且距函数头超长跨度处执行非结构化控制流逃逸（return/break/throw）。 | 利用局部卫语句提前校验，或将深层长跨度闭环提取为纯函数子算子以缩短认知跳跃距离。 |
| `CPX-REC-001` | <a id="cpx-rec-001"></a>`complexity` | `CPX` | `error` | `all` | 跨函数/跨文件无终止保障的递归或互递归调用链。 | 引入显式深度累加参数与终止保护，或改写为迭代工作列表。 |
| `CPX-RED-001` | <a id="cpx-red-001"></a>`complexity` | `CPX` | `warning` | `all` | 分布式冗余复杂度超标：跨多个文件存在高度相似的算法流程、计算或校验逻辑，累积形成隐性系统复杂度。 | 评估逻辑共性并依据领域边界进行抽离，或消除局部开发复制。 |
| `CPX-SPACE-001` | <a id="cpx-space-001"></a>`complexity` | `CPX` | `warning` | `all` | 热点循环内无界瞬态内存分配与重复全量物化。 | 将对象/缓冲区分配提升到循环外，循环内执行就地重置与复用。 |
| `CPX-STM-001` | <a id="cpx-stm-001"></a>`complexity` | `CPX` | `info` | `all` | 状态机分派结构规范：状态机多层分支内存在过长单分支逻辑（>30 LOC），降低了分派骨架的清晰度。 | 将状态机单分支过长逻辑提取为独立动作处理器，保留纯粹的状态转移分派骨架。 |
| `CPX-TIME-001` | <a id="cpx-time-001"></a>`complexity` | `CPX` | `warning` | `all` | 跨函数/跨文件无界多项式时间复杂度：嵌套迭代调用链引发高开销。 | 将内层数据预先构建为 Map/Set 索引，降低复合复杂度至 O(N)。 |
| `DAT-DEF-001` | <a id="dat-def-001"></a>`data-architecture` | `DAT` | `info` | `all` | 受信内部领域边界内的冗余重复防御性校验。 | 在信任边界执行一次性完整校验，内部领域对象依托不可变类型保证。 |
| `DAT-LAY-001` | <a id="dat-lay-001"></a>`data-architecture` | `DAT` | `warning` | `all` | 数据访问抽象泄漏：业务核心直接操纵持久化驱动或底层存储细节。 | 将存储驱动调用封装在仓储接口实现内，领域层仅依赖仓储契约。 |
| `DAT-NPL-001` | <a id="dat-npl-001"></a>`data-architecture` | `DAT` | `error` | `all` | 迭代与映射上下文中的 N+1 查询与重复存储调用。 | 将循环内查询提升至外层使用批量 IN 查询或 DataLoader 批量加载。 |
| `DAT-QRY-001` | <a id="dat-qry-001"></a>`data-architecture` | `DAT` | `warning` | `all` | 在线请求链路中的无界数据读取或全表内存过滤。 | 增加游标分页或 Limit/Offset 条件，强制限制单次读取上限。 |
| `DAT-RES-001` | <a id="dat-res-001"></a>`data-architecture` | `DAT` | `warning` | `all` | 资源注册表双向映射不一致或悬空资产：资源登记中心存在空路径、悬空引用或双向映射断裂。 | 确保资源中心双向对称登记，修复或移除悬空资源路径与孤儿资产。 |
| `DAT-SER-001` | <a id="dat-ser-001"></a>`data-architecture` | `DAT` | `info` | `all` | 跨层调用链中的重复序列化与反序列化转换。 | 在内部调用链路传递强类型原生对象，仅在网络边界执行序列化。 |
| `DEP-INV-001` | <a id="dep-inv-001"></a>`dependency-layout` | `DEP` | `error` | `all` | 依赖倒置违规：底层基础设施或公共模块反向依赖高层业务模块。 | 解除反向依赖，通过控制反转或事件总线进行解耦。 |
| `DEP-LAZ-001` | <a id="dep-laz-001"></a>`dependency-layout` | `DEP` | `warning` | `all` | 未提供审计声明或合规理由的函数内部临时导入。 | 将导入提升至文件顶部，或添加 @lazy/@optional 注释标注意图。 |
| `DEP-ORD-001` | <a id="dep-ord-001"></a>`dependency-layout` | `DEP` | `info` | `all` | 文件布局与导入分组不符合当前语言现代化工程规范。 | 调整导入顺序为 Stdlib -> ThirdParty -> InternalShared -> Local。 |
| `DEP-RES-001` | <a id="dep-res-001"></a>`dependency-layout` | `DEP` | `warning` | `all` | 业务逻辑中散落硬编码的未纳管外部 URL、文件路径或连接串。 | 将外部资源地址统一抽取至配置文件或服务资源注册中心。 |
| `DEP-WLD-001` | <a id="dep-wld-001"></a>`dependency-layout` | `DEP` | `warning` | `all` | 使用通配符导入破坏显式依赖跟踪与树摇优化。 | 改用显式具名导入 (Named Imports)，明确模块依赖面。 |
| `GATE-AST-001` | <a id="gate-ast-001"></a>`gate-architecture` | `GATE` | `error` | `all` | 预提交门禁缺少暂存区 AST 局部切片复杂度与嵌套深度刚性预算检查（CC <= 15, Depth <= 4）。 | 在 pre-commit 钩子中配置 validate-staged-slice 切片看守，阻断超标改动。 |
| `GATE-BUDGET-001` | <a id="gate-budget-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 预提交门禁运行无界全量回归耗时超标，未实施暂存区分层过滤。 | 实施分层门禁：预提交专注增量暂存切片审查（< 2s），全量回归递延至预推送。 |
| `GATE-ERR-001` | <a id="gate-err-001"></a>`gate-architecture` | `GATE` | `error` | `all` | 门禁执行脚本缺失严格错误终止控制标志，存在命令静默失败隐患。 | Shell 脚本声明 set -euo pipefail，PowerShell 声明 $ErrorActionPreference = 'Stop'。 |
| `GATE-FAC-001` | <a id="gate-fac-001"></a>`gate-architecture` | `GATE` | `error` | `all` | 门禁流水线缺少门面层实质承载（ELOC >= 15）与空包跳板静态审查。 | 接入 validate-facade-discipline 看守，强制门面层实质承载并消除虚空转发层。 |
| `GATE-HOOK-001` | <a id="gate-hook-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 仓库缺失本地左移 Git Hooks 拦截防线，缺陷反馈过度后置。 | 配置 .githooks 或 .husky 激活本地左移防御，提交前拦截低级卫生与回归缺陷。 |
| `GATE-HYG-001` | <a id="gate-hyg-001"></a>`gate-architecture` | `GATE` | `error` | `all` | 预提交门禁缺少 0 字节物理空文件与换行符卫生看守。 | 在 pre-commit 门禁中加入零空文件与换行符契约（CRLF/LF）检查。 |
| `GATE-ISO-001` | <a id="gate-iso-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 双层门禁边界不同构，远端 CI 关键检查未在本地钩子中对等镜像。 | 确保本地门禁脚本镜像覆盖远端 CI 关键步骤，实现双层防御同构性。 |
| `GATE-MSG-001` | <a id="gate-msg-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 门禁系统缺少提交信息 Conventional 规范与零黑话结构化正文校验。 | 配置 commit-msg 门禁校验 Conventional 格式、结构化正文区块与零临时黑话。 |
| `GATE-MSG-002` | <a id="gate-msg-002"></a>`gate-architecture` | `GATE` | `error` | `all` | 提交信息门禁未接入单源词汇约束表（commit-msg-forbidden-terms.json）。 | 接入双语词表看守，阻断敷衍用语、过度肯定/否定及元风格标语。 |
| `GATE-MSG-003` | <a id="gate-msg-003"></a>`gate-architecture` | `GATE` | `error` | `all` | 多项目工作区提交信息门禁缺少所属项目格式区校验（[Project: <subproject>]），或单项目未自适应静默。 | 在 commit-msg 门禁中基于工作区拓扑探针配置自适应多项目格式区守卫，单项目自动静默，多项目强制校验。 |
| `GATE-PAIR-001` | <a id="gate-pair-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 跨平台门禁脚本缺少双平台镜像配对实现（.ps1 与 .sh 未成对出现）。 | 为关键门禁脚本提供对称的 PowerShell (pwsh) 与 Bash 双平台镜像实现，杜绝跨平台单点盲区。 |
| `GATE-PROC-001` | <a id="gate-proc-001"></a>`gate-architecture` | `GATE` | `error` | `all` | PowerShell 门禁脚本使用交互式提示而缺少输出重定向非交互守卫。 | 增加 [Environment]::UserInteractive -and -not [Console]::IsOutputRedirected 守卫，杜绝子进程死锁。 |
| `GATE-ROUTE-001` | <a id="gate-route-001"></a>`gate-architecture` | `GATE` | `error` | `all` | Git 钩子直接裸调脆弱环境或 Windows PS 5.1，缺少跨平台路由保护。 | 采用跨平台 pwsh 优先并优雅降级至 bash 的双执行器路由，禁止裸调 powershell.exe。 |
| `GATE-SSOT-001` | <a id="gate-ssot-001"></a>`gate-architecture` | `GATE` | `warning` | `all` | 门禁引用规则目录校验但缺少单源注册表文件或未登记对应规则。 | 建立并维护单一真源规则目录（如 rule-catalog.json），门禁依据单源校验。 |
| `GATE-SYS-001` | <a id="gate-sys-001"></a>`gate-architecture` | `GATE` | `error` | `all` | 仓库完全缺失门禁防御系统（无任何本地 Git 钩子且无远端 CI 流水线）。 | 接入标准化双层门禁脚手架（pre-commit, commit-msg, pre-push 及 CI 工作流）。 |
| `GOV-AGN-001` | <a id="gov-agn-001"></a>`governance` | `GOV` | `error` | `all` | Concurrent modifications by multiple agents produce architectural boundary breaches, cross-module dependency cycles, or contract incompatibilities. | 协调并行 Agent 的架构边界与修改职责，消解跨模块并发循环依赖并维护单向分层契约。 |
| `GOV-ARC-001` | <a id="gov-arc-001"></a>`governance` | `GOV` | `warning` | `all` | Historical dossier nomenclature leaks into production sources, tests, or commit headers outside the archived directory white-list. | 历史施工批次代号仅在归档白名单目录中受物理豁免，面向用户的文档、代码与提交信息统一使用纯粹产品特性与功能价值表述。 |
| `GOV-BLS-001` | <a id="gov-bls-001"></a>`governance` | `GOV` | `warning` | `all` | Cross-tier monolithic change blast radius breaches atomic staging boundaries across docs, contracts, config, domains, and tooling. | 按架构依赖拓扑（文档 -> 核心抽象 -> 基础设施 -> 配置表 -> 业务实现 -> 质量重构）拆分为多批次原子提交。 |
| `GOV-DAT-001` | <a id="gov-dat-001"></a>`governance` | `GOV` | `info` | `all` | Functions declaring excessive discrete scalar parameters (>= 5) exhibit Data Clumps smell; parameters should be aggregated into a named Context or Options interface. | 将离散参数群聚合为强类型的结构化上下文模型（如 Context 或 Options 接口对象），提高契约内聚性。 |
| `GOV-DBG-001` | <a id="gov-dbg-001"></a>`governance` | `GOV` | `warning` | `all` | Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput. | 删除调试输出，或改用结构化日志并按级别输出。 |
| `GOV-EXC-001` | <a id="gov-exc-001"></a>`governance` | `GOV` | `error` | `typescript, javascript, python` | Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow. | 处理/记录/显式重抛；确属 best-effort 时在 catch 内写明理由标记。 |
| `GOV-EXC-002` | <a id="gov-exc-002"></a>`governance` | `GOV` | `warning` | `rust` | Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None. | 避免裸 unwrap/expect，改为显式错误分支或 Result/Option 传播。 |
| `GOV-EXC-003` | <a id="gov-exc-003"></a>`governance` | `GOV` | `error` | `typescript, javascript, python` | Pseudo-catch blocks containing only dummy non-handling statements (void 0, dead assignment) silently swallow exceptions without logging or documented rationale. | 在 catch/except 块中补充结构化日志、错误重抛或在注释中显式标注 rationale 标记（如 best-effort, expected）。 |
| `GOV-FIL-001` | <a id="gov-fil-001"></a>`governance` | `GOV` | `warning` | `all` | Inconsistent file naming causes cross-platform casing issues and impairs modular discovery. | 按语言命名契约重命名文件（kebab-case 或 snake_case）。 |
| `GOV-FIL-002` | <a id="gov-fil-002"></a>`governance` | `GOV` | `info` | `all` | Substantial production modules must declare their architectural role and responsibility boundary. | 修正文件头声明路径，或补齐缺失的头部字段。 |
| `GOV-GAM-001` | <a id="gov-gam-001"></a>`governance` | `GOV` | `warning` | `all` | Anti-gaming violation: artificial function splitting, tautological test padding, or empty boilerplate gaming quality metrics. | 保持业务内聚并编写有实质断言的真实测试用例，杜绝空样板与假测试。 |
| `GOV-LOG-001` | <a id="gov-log-001"></a>`governance` | `GOV` | `warning` | `all` | Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk. | 降低嵌套：卫语句早返回、抽取子步骤或扁平化分支。 |
| `GOV-LOG-002` | <a id="gov-log-002"></a>`governance` | `GOV` | `info` | `all` | Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection. | 去掉直通式包装，让调用方直达目标或合并职责。 |
| `GOV-MNT-001` | <a id="gov-mnt-001"></a>`governance` | `GOV` | `warning` | `all` | Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred. | 收敛继承层级：组合优先，或抽公共能力为独立模块。 |
| `GOV-MNT-002` | <a id="gov-mnt-002"></a>`governance` | `GOV` | `error` | `all` | Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling. | 反转依赖：内层定义端口/接口，由外层实现。 |
| `GOV-MSG-001` | <a id="gov-msg-001"></a>`governance` | `GOV` | `warning` | `all` | 底层诊断消息与修复建议必须统一采用标准英文并由常量字典集中管控，严禁在分析器发射点硬编码内联或非 ASCII 文本。 | 将内联错误提示提取至 `src/core/messages/` 集中常量池，并确保文案符合英语工业技术标准。 |
| `GOV-PRF-001` | <a id="gov-prf-001"></a>`governance` | `GOV` | `warning` | `all` | Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties. | 循环不变量外提，把不变计算移出循环体。 |
| `GOV-PRF-002` | <a id="gov-prf-002"></a>`governance` | `GOV` | `info` | `all` | Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N). | 用 Set/Map 承载查找，消除循环内线性扫描。 |
| `GOV-PRF-003` | <a id="gov-prf-003"></a>`governance` | `GOV` | `error` | `typescript, javascript` | Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot). | 定时器延时常量具名或走集中配置，避免绕过统一钳制。 |
| `GOV-PRF-004` | <a id="gov-prf-004"></a>`governance` | `GOV` | `warning` | `typescript, javascript` | Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers). | 改用异步 IO；进程式 CLI 路径可用 blockingIoAllowPatterns 声明豁免。 |
| `GOV-PRF-005` | <a id="gov-prf-005"></a>`governance` | `GOV` | `info` | `all` | Calling array linear lookups (.includes / .indexOf) inside loops creates quadratic O(N*M) overhead; pre-indexing into a Set hoisted outside the loop optimizes membership tests to O(1). | 在循环前将只读数组提升为 Set 预建索引（const set = new Set(arr)），循环内改用 set.has() 进行 O(1) 检索。 |
| `GOV-RTC-002` | <a id="gov-rtc-002"></a>`governance` | `GOV` | `warning` | `all` | Baseline debt entries must track physical file rename operations without artificial inflation or false positive churn. Monotonic downward ratchets must remap prior baselines to new paths upon refactoring. | 在基线更新与门禁收敛中应用重命名路径规范化映射 (pathRemap)，确保文件重构后既有基线连续继承，严禁因重命名引发基线虚增或债务逃逸。 |
| `GOV-RUL-001` | <a id="gov-rul-001"></a>`governance` | `GOV` | `error` | `all` | Static review rule identifier drift or hallucination: mentioned rule ID is not registered in the single-source rule catalog. | 核对单源规则注册表，使用已登记的规范化规则 ID，禁止臆造虚构不存在的规则代号。 |
| `GOV-SAN-001` | <a id="gov-san-001"></a>`governance` | `GOV` | `warning` | `all` | Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift. | 移除临时工单/批次黑话，改用长效领域术语。 |
| `GOV-SAN-002` | <a id="gov-san-002"></a>`governance` | `GOV` | `warning` | `all` | 客观技术文案守卫：文本包含宣传性吹嘘、绝对化定性、情绪化贬损或工程流程黑话。 | 替换宣传口号与绝对定性表述为客观技术事实与可重现验证信息。 |
| `GOV-SLC-001` | <a id="gov-slc-001"></a>`governance` | `GOV` | `error` | `all` | AST slice mutation introduces breaking signature drift or uncontained side-effects propagating across external call chains. | 确保切片改动向后兼容，或同步重构受影响调用链上的全部外部调用者。 |
| `GOV-STD-001` | <a id="gov-std-001"></a>`governance` | `GOV` | `warning` | `all` | Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead. | 直接 return 布尔表达式，去掉 if/else 包装。 |
| `GOV-STD-002` | <a id="gov-std-002"></a>`governance` | `GOV` | `warning` | `all` | Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards. | 替换废弃构造（var、legacy 键名等）为现代等价写法。 |
| `GOV-TRJ-001` | <a id="gov-trj-001"></a>`governance` | `GOV` | `error` | `all` | Historical trajectory exhibits cyclic regressions, flip-flop oscillations, or re-introduces previously eliminated architectural anti-patterns. | 确保演化轨迹保持单调质量提升，避免在后续修订中死灰复燃已被重构配方消除的架构反模式。 |
| `GOV-TYP-001` | <a id="gov-typ-001"></a>`governance` | `GOV` | `warning` | `all` | Implicit loose typing hides type errors at runtime and weakens static safety guarantees. | 为变量/参数补齐类型注解。 |
| `GOV-TYP-002` | <a id="gov-typ-002"></a>`governance` | `GOV` | `warning` | `all` | Unannotated function signatures compromise API boundaries and allow unintended type drift. | 为函数补齐返回类型注解。 |
| `GOV-TYP-003` | <a id="gov-typ-003"></a>`governance` | `GOV` | `warning` | `typescript` | Naked `any` bypasses the entire compiler type checker, leaking type instability. | 裸 any 换成 unknown 或具体联合；动态边界用受控断言并注释理由。 |
| `GOV-TYP-004` | <a id="gov-typ-004"></a>`governance` | `GOV` | `warning` | `typescript` | Passing or assigning `undefined as any` or `null as any` indicates an Interface Segregation Principle (ISP) violation. | 将目标参数声明为可选联合类型或拆分专有接口，消除强制类型断言。 |
| `GOV-TYP-005` | <a id="gov-typ-005"></a>`governance` | `GOV` | `warning` | `typescript` | Accessing properties via `(expr as any).prop` bypasses compiler type safety and indicates missing type narrowing guards. | 使用标准类型收窄谓词（如 ts.canHaveModifiers 或 isXxx）保护属性访问。 |
| `GOV-TYP-006` | <a id="gov-typ-006"></a>`governance` | `GOV` | `warning` | `typescript` | Exported functions, classes, and public methods must specify explicit return types to protect public API contracts. | 为导出的公共函数、类方法补充显式返回类型注解，避免依赖隐式类型推断引起 API 破坏。 |
| `NAM-ABR-001` | <a id="nam-abr-001"></a>`naming` | `NAM` | `warning` | `all` | 严禁使用未批准的残缺缩写（如 usr/mgr/btn/cnt/ptr/cur 等），造成代码可读性衰减。 | 将隐晦残缺缩写展开为完整规范英文词汇（如 user/manager/button/count）。 |
| `NAM-COL-001` | <a id="nam-col-001"></a>`naming` | `NAM` | `info` | `all` | 集合（Array/Set）建议使用复数或 List 后缀，映射（Map/Dict）建议表达对应关系。 | 为数组集合增加复数形态，为字典映射添加 `*To*` 或 `*By*` 表达关联意图。 |
| `NAM-DEC-001` | <a id="nam-dec-001"></a>`naming` | `NAM` | `warning` | `all` | 标识符长度膨胀（30~40+ 字符）或同文件多符号共享长前缀，表明缺乏目录与模块分层解耦，驱动架构拆分。 | 提炼公共领域模块或下沉子目录，将冗长的前缀转化为模块/包命名空间，降低单个符号长度并实现物理分层解耦。 |
| `NAM-DIR-001` | <a id="nam-dir-001"></a>`naming` | `NAM` | `warning` | `all` | 源码目录名必须为全小写 kebab-case 或单名，严禁 CamelCase、空格及临时批次词。 | 将目录重命名为全小写短横线风格（如 `ast-utils`、`pipeline`）。 |
| `NAM-FIL-001` | <a id="nam-fil-001"></a>`naming` | `NAM` | `warning` | `all` | 文件命名必须符合语言惯例（TS/JS 强制 kebab-case，Python/Rust/GDScript 强制 snake_case），严禁临时批次黑话。 | 将文件名规范重命名为对应语言的标准格式（如 `foo-bar.ts` 或 `foo_bar.py`），且不可带有临时标记。 |
| `NAM-GLB-001` | <a id="nam-glb-001"></a>`naming` | `NAM` | `warning` | `all` | 模块顶层不可变常量必须遵循 UPPER_SNAKE_CASE 命名规范。 | 将模块级原始常量重命名为大写蛇形命名（如 `MAX_RETRIES`、`DEFAULT_TIMEOUT`）。 |
| `NAM-GLB-002` | <a id="nam-glb-002"></a>`naming` | `NAM` | `warning` | `all` | 严禁在模块顶层声明可变 `let` 或 `var` 变量（隐式全局共享状态）。 | 重构顶层可变状态为函数作用域变量、类实例属性或显式单例状态持有者。 |
| `NAM-JRG-002` | <a id="nam-jrg-002"></a>`naming` | `NAM` | `warning` | `all` | 工程资产与测试用例中严禁包含施工批次与临时黑话标记（禁止词如阶段批次号、临时变量及在制品缩写标记等），覆盖测试套件名、函数符号与标识符。 | 将施工批次标记替换为具有实际业务与领域架构含义的语义命名，杜绝将临时施工代号固化为资产。 |
| `NAM-LEN-001` | <a id="nam-len-001"></a>`naming` | `NAM` | `warning` | `all` | 变量名长度异常：局部变量过短（≤ 2 字符且不在白名单内）缺乏语义，或过长（≥ 30 字符）过度限定。 | 规范变量长度至 3~28 字符，短变量补齐领域修饰，超长变量精简修饰语。 |
| `NAM-LEN-002` | <a id="nam-len-002"></a>`naming` | `NAM` | `warning` | `all` | 函数/方法名长度异常：过短（< 3 字符如 f/do）缺乏明确动宾，或过长（≥ 38 字符）违反单一职责。 | 重构函数名为规范动宾短语（如 `calculateRisk`），超长复合函数按步骤拆分。 |
| `NAM-MBR-001` | <a id="nam-mbr-001"></a>`naming` | `NAM` | `warning` | `all` | 类属性、对象字段与方法名必须遵循 camelCase 小驼峰命名规范。 | 将属性和方法名调整为清晰有意义的小驼峰命名。 |
| `NAM-RES-001` | <a id="nam-res-001"></a>`naming` | `NAM` | `warning` | `all` | 结构化资源库（常量/字符串/规则/配置/枚举等）过于笼统且规模与语义体积膨胀，驱动按业务领域拆分。 | 根据功能负责域与倒排调用关系，将笼统大文件拆分为二级拓扑模块（如 constants_network.ts、constants_ui.ts）。 |
| `NAM-RES-002` | <a id="nam-res-002"></a>`naming` | `NAM` | `info` | `all` | 结构化资源库过度细化导致碎片化，微小文件使用了三级深层命名，建议合并至父域。 | 将低容量、高内聚的细分子库合并回二级领域模块（如合并至 constants_network.ts），降低架构认知成本。 |
| `NAM-RES-003` | <a id="nam-res-003"></a>`naming` | `NAM` | `warning` | `all` | 结构化资源库命名层级溢出（超过基础类型+功能域+可选子域的三层上限）。 | 简化命名拓扑至最多三层（基础类型名 + 功能负责域 + 可选精细化领域），消除过深层级。 |
| `NAM-RES-004` | <a id="nam-res-004"></a>`naming` | `NAM` | `warning` | `all` | 结构化资源库文件名过度描述堆叠（如 constants_network_http_request_response_...），造成维护负担。 | 去除冗余堆叠的描述词，改用精炼的领域命名表达架构职责。 |
| `NAM-RES-005` | <a id="nam-res-005"></a>`naming` | `NAM` | `warning` | `all` | 结构化资源库文件职责不匹配（声明为纯常量库却混入大量可执行业务函数与类）。 | 将可执行业务计算下沉至领域服务或工具类中，保持结构化资源库纯粹性。 |
| `NAM-SGL-001` | <a id="nam-sgl-001"></a>`naming` | `NAM` | `warning` | `all` | 严禁在业务逻辑中使用单字母变量名（仅循环头计数器与 discard 占位符豁免）。 | 改用能表达具体意图的具名标识符；仅 `for (let i = ...)`、`_` 允许单字母。 |
| `NAM-TYP-001` | <a id="nam-typ-001"></a>`naming` | `NAM` | `warning` | `all` | 类型定义与类声明必须遵循 PascalCase 大驼峰命名。 | 将类、接口、类型别名或枚举重命名为大驼峰格式（如 `Scanner`、`RuleDefinition`）。 |
| `NAM-VAG-001` | <a id="nam-vag-001"></a>`naming` | `NAM` | `warning` | `all` | 严禁使用无业务语义的模糊泛化变量名（如 data、res、ret、tmp、item 等裸词）。 | 结合业务领域语义补齐前缀或后缀（如 `parseResult`、`tokenPayload`、`ruleEntry`）。 |
| `NUM-PREC-001` | <a id="num-prec-001"></a>`governance` | `NUM` | `warning` | `typescript, javascript` | 数值截断精度失衡：数学计算路径中存在丢精度的四舍五入或比例失配风险。 | 使用标准 0.01 精度舍入（如 * 100 / 100）或显式容差界限以保留有效精度。 |
| `PRF-ALG-001` | <a id="prf-alg-001"></a>`performance` | `PRF` | `warning` | `all` | 发现 $\ge 3$ 层循环嵌套 (潜在 $O(N^3)$ 多项式计算热点)。 | 将内层查找通过 Map/Set 哈希预索引降维为 $O(1)$。 |
| `PRF-ALG-002` | <a id="prf-alg-002"></a>`performance` | `PRF` | `warning` | `all` | 循环内集合线性遍历反模式：在循环结构内部对外部集合进行线性检索（find/includes/has/in list 等），导致整体算法复杂度恶化至 O(N*M)。 | 在循环外预先将外部集合构建为 Map 或 Dictionary 哈希索引，将内层查找降至 O(1)，算法总体降至 O(N+M)。 |
| `PRF-IO-001` | <a id="prf-io-001"></a>`performance` | `PRF` | `warning` | `all` | 切换为异步非阻塞对应 API，避免锁死 Node.js 事件循环或游戏主线程。 | 事件循环同步阻塞风险：在 `async` 上下文或高频帧循环内调用同步阻塞 I/O (如 `readFileSync`, `time.sleep`)。`thresholds.blockingIoAllowPatterns` 声明的路径 glob（CLI/校验器/基准脚本等进程式工具）豁免；该键同时下发给治理规则 `GOV-PRF-004`，属单一策略源。 |
| `PRF-LEAK-001` | <a id="prf-leak-001"></a>`performance` | `PRF` | `warning` | `all` | 检测循环或定时器内的集合无界追加，防范 O(t) 或 O(n) 内存泄漏。 | 为集合设置容量上限/LRU淘汰/定期重置，或避免在循环与定时器内无界追加。 |
| `PRF-MEM-001` | <a id="prf-mem-001"></a>`performance` | `PRF` | `warning` | `all` | 将缓冲区/对象提升至循环外部复用，循环内仅清空重置。 | 高频热路径瞬态堆对象分配 (循环体内 `new Array`, `new Object`, `.duplicate(true)` 等)。 |
| `PRF-MEM-002` | <a id="prf-mem-002"></a>`performance` | `PRF` | `warning` | `all` | 循环热路径严禁瞬态实例化与深复制，必须使用对象池或外部复用（ADV-PRF-002）。 | 高承压热路径瞬态堆对象分配 (循环体内 `new Class()`, `.new()`, `.duplicate(true)` 等)。采用对象池模式并在借出/归还时调用 `reset_state()` 重置状态。 |
| `PRF-POL-001` | <a id="prf-pol-001"></a>`performance` | `PRF` | `warning` | `all` | 热路径高频昂贵资源缺乏复用池化：循环内或高频调用中频繁分配重型对象、缓冲区或连接。 | 引入对应对象池/缓冲池机制并在生命周期结束时回收复用。 |
| `PRF-POL-002` | <a id="prf-pol-002"></a>`performance` | `PRF` | `error` | `all` | 资源池缺乏状态重置契约或容量上限：池化机制缺失 reset_state 回收契约或无界增长导致数据污染与泄漏。 | 补全对象归还重置逻辑并设定池容量高水位淘汰限制。 |
| `PRF-POL-003` | <a id="prf-pol-003"></a>`performance` | `PRF` | `warning` | `all` | 负收益过度池化：对极小轻量纯值对象或冷路径过度引入池化管理开销，得不偿失。 | 移除负收益池化包装层，直接采用值对象或短生命周期瞬态分配。 |
| `PRF-POL-004` | <a id="prf-pol-004"></a>`performance` | `PRF` | `warning` | `all` | 流式数据分块加载缺乏环形缓冲复用：在流式 I/O、分块循环读取或异步回调中反复实例化临时 Buffer，造成高频内存碎片与 GC 停顿。 | 引入环形缓冲区（RingBuffer）或接入定长字节缓冲池（BufferPool），实现零拷贝槽位循环复用。 |

### Layer 4 — 领域框架专精、测试现代性与历史兼容层 (Domain Specialization, Test Modernity & Legacy Aliases)

| 规则 ID | 所属分析器 | 规则族 | 默认级别 | 适用语言 | 规则中文摘要 (`summary`) | 修复与重构指引 (`remediation`) |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `GDM-ISO-001` | <a id="gdm-iso-001"></a>`gdscript-game` | `GDM` | `error` | `gdscript` | 无头领域逻辑层直接引用视图层或场景树节点破坏解耦架构。 | 领域逻辑与表现层解耦，通过数据快照或纯状态机通信。 |
| `GDM-POL-001` | <a id="gdm-pol-001"></a>`gdscript-game` | `GDM` | `error` | `gdscript` | 对象池获取后未实现或未调用 reset_state 契约。 | 池化对象实现 reset_state() 并确保在 acquire/release 时重置状态。 |
| `GDM-PRF-001` | <a id="gdm-prf-001"></a>`gdscript-game` | `GDM` | `error` | `gdscript` | 循环或高频执行路径中瞬态堆分配导致掉帧风险。 | 在循环外预分配集合、使用对象池或复用缓冲区实例。 |
| `GDM-SIG-001` | <a id="gdm-sig-001"></a>`gdscript-game` | `GDM` | `warning` | `gdscript` | 信号连接后缺少对应断开逻辑导致生命周期悬挂泄漏。 | 在生命周期结束前调用 disconnect 或接入自动管理连接。 |
| `SEC-EXP-001` | <a id="sec-exp-001"></a>`client-exposure` | `SEC` | `error` | `all` | 内部或管理 API 端点暴露在客户端代码中。 | 通过受保护的后端网关反向代理并移除内部暴露路径。 |
| `SEC-EXP-002` | <a id="sec-exp-002"></a>`client-exposure` | `SEC` | `error` | `all` | 前端以 CSS 隐藏或按钮禁用代替服务端鉴权。 | 在服务端对敏感操作进行基于角色的鉴权校验。 |
| `SEC-EXP-003` | <a id="sec-exp-003"></a>`client-exposure` | `SEC` | `warning` | `all` | 关闭的 Feature Flag 仍然将完整实现代码打包下发。 | 采用构建期代码擦除或动态代码分割隔离未发布功能。 |
| `SEC-EXP-004` | <a id="sec-exp-004"></a>`client-exposure` | `SEC` | `error` | `all` | 未发布或测试演练路由静态打包暴露在生产路由中。 | 在构建期通过环境判定过滤排除开发与测试路由。 |
| `TST-DBT-001` | <a id="tst-dbt-001"></a>`test-modernity` | `TST` | `info` | `all` | 未登记里程碑收敛计划或责任人的滞后测试技术债务。 | 在测试债务登记表中补全责任 Agent 及目标收敛里程碑。 |
| `TST-DEN-001` | <a id="tst-den-001"></a>`test-modernity` | `TST` | `info` | `all` | 关键业务模块的有效现代化测试密度 (EMTD) 或当前业务承接率 (CBCR) 低于阈值。 | 补齐高风险语义单元的契约测试与边界测试，提高实际故障感知能力。 |
| `TST-FLT-001` | <a id="tst-flt-001"></a>`test-modernity` | `TST` | `warning` | `all` | 浮点断言脆弱性：测试直接对裸浮点字面量进行全等断言而缺乏容差控制或公式推导。 | 通过数学公式推导预期值或使用容差断言（如 toBeCloseTo 或 is_equal_approx）。 |
| `TST-ILS-001` | <a id="tst-ils-001"></a>`test-modernity` | `TST` | `warning` | `all` | 测试完整性幻觉：测试仅校验 Mock 配置或绑定已废弃业务契约。 | 将测试迁移至验证活跃业务契约与实际领域状态变化。 |
| `TST-SKP-001` | <a id="tst-skp-001"></a>`test-modernity` | `TST` | `warning` | `all` | 核心业务域中长期滞留的跳过、隔离或未执行测试用例。 | 修复并恢复测试用例，或正式登记入测试债务清单并设定收敛里程碑。 |
| `TST-TAU-001` | <a id="tst-tau-001"></a>`test-modernity` | `TST` | `warning` | `all` | 缺乏真实业务断言或包含恒真断言的无效测试。 | 替换恒真断言为针对业务实体输出和错误边界的有效验证。 |
| `TST-TOP-001` | <a id="tst-top-001"></a>`test-modernity` | `TST` | `warning` | `all` | 多语言测试拓扑双轨纪律：严禁在 TS/GDScript 等语言生产代码中内嵌测试代码域，强化 Rust 计算库物理分区与面向 Agent 可读注释契约。 | 将内嵌在非 Rust 生产文件中的测试逻辑迁移至显式独立测试文件（如 *.test.ts），Rust 计算库测试必须置于 #[cfg(test)] 尾部分区并补充 Agent 可读注释。 |
| `VSC-I18N-001` | <a id="vsc-i18n-001"></a>`vscode-extension` | `VSC` | `warning` | `typescript, javascript` | 用户可见消息使用硬编码字符串字面量未接入国际化字典。 | 使用 vscode.l10n.t(...) 或双语字典常量进行包装。 |
| `VSC-MEM-001` | <a id="vsc-mem-001"></a>`vscode-extension` | `VSC` | `error` | `typescript, javascript` | VS Code Disposable 资源创建后未压入 context.subscriptions。 | 使用 context.subscriptions.push(...) 注册或纳入复合 Disposable 管理。 |
| `VSC-PERF-001` | <a id="vsc-perf-001"></a>`vscode-extension` | `VSC` | `warning` | `typescript, javascript` | 在 Extension Host 主线程执行同步文件 I/O 阻塞编辑器 UI。 | 改用 fs.promises 或 vscode.workspace.fs 异步 I/O 接口。 |
| `VSC-PERF-002` | <a id="vsc-perf-002"></a>`vscode-extension` | `VSC` | `warning` | `typescript, javascript` | Webview CSS 动效直接过渡或动画几何布局属性引发浏览器昂贵重排（Reflow）。 | 将几何属性（width/height/top/left 等）动效替换为 transform 或 opacity 等 GPU 合成层属性。 |
| `VSC-UI-001` | <a id="vsc-ui-001"></a>`vscode-extension` | `VSC` | `warning` | `typescript, javascript` | Webview 集合列表渲染缺少有界密度控制或折叠收起能力（超过 5 项列表缺乏折叠与导出旁置布局）。 | 为 Webview 动态集合列表实现阈值折叠控件与紧凑密度布局，保障大数据集下信息层次清晰。 |
| `VSC-UI-002` | <a id="vsc-ui-002"></a>`vscode-extension` | `VSC` | `error` | `typescript, javascript` | Webview 视图样式包含硬编码单色颜色值，破坏 VS Code 主题动态自适应契约。 | 将硬编码颜色替换为 VS Code CSS 主题变量（如 var(--vscode-editor-foreground) 等）。 |
| `VSC-UI-003` | <a id="vsc-ui-003"></a>`vscode-extension` | `VSC` | `warning` | `typescript, javascript` | Webview 表单交互输入控件缺少无障碍名称或标签绑定（WCAG 4.1.2）。 | 为表单控件补充 aria-label、aria-labelledby 或显式绑定 <label for="...">。 |
| `analyzer-error` | <a id="analyzer-error"></a>`engine` | `LANG` | `info` | `all` | 分析器在单文件上抛异常（failOnAnalyzerError 可升为 error）。（计划迁移至 `ENG-RUN-001`） | 修复分析器缺陷；已知外部数据问题可保持 info 留痕。 |
| `clean-layer-violation` | <a id="clean-layer-violation"></a>`architecture` | `ARCH` | `error` | `all` | 增量管线中的分层越界（clean-layer 口径）。（计划迁移至 `ARCH-CLN-001`） | 按层序调整依赖方向或把实现下沉/上提到正确层。 |
| `disallowed-import` | <a id="disallowed-import"></a>`dependency-graph` | `DEP` | `error` | `all` | 声明式导入边界违规：跨组依赖或未授权外部包。（计划迁移至 `DEP-IMP-001`） | 按配置的 allowGroups/allowExternal 调整导入，或显式登记豁免。 |
| `duplicate-literal` | <a id="duplicate-literal"></a>`constants` | `LEGACY` | `warning` | `all` | 自动聚合多处行号并提示提取共享常量。（计划迁移至 `CST-DUP-001`） | 同一文件内相同字面量出现频次超标（默认 ≥ 3 次）。 |
| `expensive-loop-operation` | <a id="expensive-loop-operation"></a>`performance` | `PRF` | `error` | `all` | 循环体内执行昂贵深拷贝（.duplicate(true)）或阻塞式序列化与IO。（计划迁移至 `PRF-CLON-001`） | 消除热路径内的深拷贝操作，改用只读视图或轻量引用。 |
| `high-algorithmic-complexity` | <a id="high-algorithmic-complexity"></a>`performance` | `PRF` | `warning` | `all` | 循环多重嵌套引发潜在 O(N^2)/O(N^3) 复杂度热点或循环体内隐式线性查找。（计划迁移至 `PRF-NEST-001`） | 重构循环嵌套或预先构建 Map/Set 索引将查找降为 O(1)。 |
| `high-complexity` | <a id="high-complexity"></a>`complexity` | `CPX` | `warning` | `all` | 函数圈复杂度超过阈值。（计划迁移至 `CPX-CYC-001`） | 抽取具名步骤、早返回替代嵌套分支，或按职责拆分函数。 |
| `high-entropy-token` | <a id="high-entropy-token"></a>`secrets` | `LEGACY` | `warning` | `all` | 高熵字符串疑似密钥/令牌。（计划迁移至 `SEC-ENT-001`） | 移入配置/密钥管理；确为误报时用 matchRule 抑制并写明理由。 |
| `import-cycle` | <a id="import-cycle"></a>`dependency-graph` | `DEP` | `error` | `all` | 模块级循环依赖（Python 相对导入与包解析同样覆盖）。（计划迁移至 `DEP-CYC-001`） | 把共享契约下沉为独立模块，或用惰性导入打断环（惰性导入不建边）。 |
| `large-file` | <a id="large-file"></a>`large-file` | `BIG` | `warning` | `all` | 文件行数/函数数超过阈值。（计划迁移至 `BIG-SIZE-001`） | 按职责拆分模块，或把工具函数迁到专属文件。 |
| `loop-transient-allocation` | <a id="loop-transient-allocation"></a>`performance` | `PRF` | `warning` | `all` | 循环体内瞬态堆分配（ADV-PRF-002），违背零瞬态分配契约。（计划迁移至 `PRF-TRAN-001`） | 将对象实例化提升到循环外或使用对象池模式（ADV-POOL-001）。 |
| `nested-constant` | <a id="nested-constant"></a>`constants` | `LEGACY` | `warning` | `all` | 严禁常量化嵌套：禁止冗余常量别名引用、深层嵌套常量对象与作用域内部伪常量。（计划迁移至 `CST-NST-001`） | 将常量直接内联或提升至模块顶层单源声明，消除无意义的间接别名与深层对象嵌套。 |
| `secret-detected` | <a id="secret-detected"></a>`secrets` | `LEGACY` | `error` | `all` | 疑似硬编码凭据（按模式识别）。（计划迁移至 `SEC-TOK-001`） | 撤销并轮换该凭据；改为从环境/密钥管理读取。 |
| `unused-export` | <a id="unused-export"></a>`dependency-graph` | `DEP` | `warning` | `all` | 导出符号无人引用（TS/JS 口径；Python 无 export 关键字不参与）。（计划迁移至 `DEP-UNX-001`） | 删除无人使用的导出，或把它收回模块内部。 |
| `unused-module` | <a id="unused-module"></a>`dependency-graph` | `DEP` | `warning` | `all` | 模块无人导入（非入口白名单内）。（计划迁移至 `DEP-UNM-001`） | 删除该模块，或把入口 glob 加入 entryGlobs。 |

---

## 4. 关联文档导航

- [02. 自定义分析器插件与语义模式扩展规范](./02-custom-analyzer-plugin.md)
- [04. 跨语言泛化审查与项目中立性规范](../05-specs-and-benchmarks/04-cross-language-generalization.md)
- [06. 多语言现代化规则包与常量单源治理](../05-specs-and-benchmarks/06-modernization-program.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](../05-specs-and-benchmarks/07-quantified-quality-standard.md)
