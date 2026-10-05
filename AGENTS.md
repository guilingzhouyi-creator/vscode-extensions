# AGENTS.md — 工作区治理总规与指针查询总枢（精简·权威·高内聚）

> 本文件为工作区全局唯一的顶层治理总规与一级路由中枢。采用**指针式目录查询架构**（JIT Progressive Disclosure），全局刚性公理在此唯一裁定，细节规范全量收口至各真源指针，修改代码前必查对应指针。

---

## 一、 快速作业路由中枢（按需即查矩阵）

| 作业场景与任务意图 | 刚性约束与一票否决指标 | 权威真源指针 (SSOT) | 关联技能 (Skill) | 本地预审与验证命令 |
| :--- | :--- | :--- | :--- | :--- |
| **Git 提交与分批工作流** | 必填 `[Project]`；有效字数 $\ge 30$；零黑话；纯客观技术事实 | [commit-msg-forbidden-terms.json](scripts/common/commit-msg-forbidden-terms.json)<br/>[rule-catalog.json](scripts/common/rule-catalog.json) | [batch-commit](.agents/skills/batch-commit/SKILL.md) | `pwsh -File scripts/ps1/commit-msg-gate.ps1 <msg-file>` |
| **代码编写与体积控制** | $\text{CC}\le 15, \text{Depth}\le 4, \text{Noise}\le 4.0$；$\text{ELOC}\le 900, \text{LOC}\le 1400$ | [evaluate-eloc-budget.js](scripts/common/evaluate-eloc-budget.js) | — | `node scripts/common/evaluate-eloc-budget.js` |
| **模块导出与门面设计** | $\text{ELOC}\ge 15$ 或不可变冻结；单行跳板清零 (`ARCH-ABS-001`) | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) | [facade-discipline](.agents/skills/facade-discipline/SKILL.md) | `node auto-refactor/scripts/validate-facade-governance.js` |
| **门禁脚本与跨平台调用** | 子进程工作目录显式隔离；pwsh 7+ 优先；`set -euo pipefail` 平铺捕获 | [gate-governance](.agents/skills/gate-governance/SKILL.md)<br/>[scripts/README.md](scripts/README.md) | [gate-governance](.agents/skills/gate-governance/SKILL.md) | `pwsh -File scripts/ps1/pre-commit-gate.ps1` |
| **`workspace-timing/` 研发** | 五层解耦；RingBuffer+Journal 崩溃安全；UI 100% 双语字典 | [workspace-timing/README.md](workspace-timing/README.md) | — | `cd workspace-timing && npm run test:fast` |
| **`auto-refactor/` 研发** | 243 规则自测全通过；Rust 与 TS 100% 等价；QED/CAI 质量模型 | [auto-refactor/DOCS.md](auto-refactor/DOCS.md) | — | `cd auto-refactor && npm test` |
| **`WebGames/` 研发** | 全域配置驱动；循环内零堆分配 (`ADV-PRF-002`)；先四阶段方案后编码 | [WebGames/docs/README.md](WebGames/docs/README.md)<br/>[WebGames/config/README.md](WebGames/config/README.md) | — | `cd WebGames && pwsh scripts/ps1/audit-all.ps1` |
| **全工作区统一质量审查** | 5 大支柱 100% 绿色通行；零规则漂移 (`RCFG-RULE-DRIFT`) | [scripts/README.md](scripts/README.md)<br/>[rule-catalog.json](scripts/common/rule-catalog.json) | — | `pwsh -File scripts/ps1/audit-all.ps1` |
| **顶层蓝图与历史全宗** | Cell 平权自治体系；一体两面 Diff；归档案卷元数据规范 | [agent-native-system-blueprint.md](docs/agent-native-system-blueprint.md)<br/>[deliverables/README.md](archive/deliverables/README.md) | — | — |

---

## 二、 工作区全局刚性公理

### 1. 物理卫生与排版契约
- **零空文件**：全仓严禁创建或遗留 0 字节物理空文件或纯空白字符虚空文件；
- **换行契约**：PowerShell 脚本（`.ps1`）在磁盘必须严格保持 CRLF 换行；Bash（`.sh`）、GDScript（`.gd`）、TypeScript/JavaScript（`.ts`/`.js`）、Markdown（`.md`）与 JSON（`.json`）严格保持 LF 换行；
- **缩进规范**：TypeScript 保持 4 空格缩进，其余源码与配置文件保持 2 空格缩进；
- **文件命名**：全局遵循 `kebab-case`（*例外*：WebGames 的 `config/**/*.json` 与 `.gd` 脚本保持 `snake_case` 对齐领域惯例）。

### 2. 代码复杂度与体积双轨预算
- **AST 切片预算（`GATE-AST-001`）**：暂存区生产代码与工具脚本受 AST 局部切片守卫约束：单函数圈复杂度 $\text{CC} \le 15$、控制流嵌套深度 $\text{Depth} \le 4$、单行噪声比 $\text{Noise} \le 4.0$；循环体与调度逻辑须平铺控制流并采用卫语句提前返回；
- **单文件双轨体积与 1:3 动态包络**：全仓源码文件（`.ts`, `.js`, `.gd`, `.py` 等）以**有效代码行（$\text{ELOC} \le 900$）**为第一刚性复杂度红线，以**物理行（$\text{LOC} \le 1400$）**为防膨胀兜底线；在 [evaluate-eloc-budget.js](scripts/common/evaluate-eloc-budget.js) 中执行 1:3 密度比动态反推包络约束与高负荷契约注释密度约束；
- **门面实质承载与跳板消融（`ARCH-FAC-001` / `ARCH-ABS-001`）**：门面（Facade）或对外导出入口必须满足 $\text{ELOC} \ge 15$ 校验逻辑、聚合 $\ge 3$ 个子领域或包含 `Object.freeze`/`deepFreeze` 不可变保障；严禁保留或创建有效代码 $\le 3$ 行且仅向单一目标透传导出的空包跳板文件（详见 [facade-discipline](.agents/skills/facade-discipline/SKILL.md)）。

### 3. Git 提交规范与技术事实纪律
- **提交格式**：`<type>(<scope>): <祈使句中文摘要标题>`（长度 5~80 字符，结尾不加句号；`<type>` 限于 feat/fix/refactor/docs/test/chore/style/perf）；
- **结构化区块**：关键生产提交（feat/fix/refactor）正文首区块必须包含 `[Project: workspace-timing | auto-refactor | WebGames | governance]`（`CMG-PRJ-001`）；正文必须包含 `[Why]`、`[Added]`、`[Changed]`、`[Fixed]`（如有修复缺陷）、`[Verification]` 标签，非轻量提交正文有效字符 $\ge 30$；
- **技术事实与零黑话**：
  ① 严禁敷衍词汇（`CMG-STY-001`）、夸大词汇（`CMG-STY-002`）、贬损词汇（`CMG-STY-003`）或“调整语调为低调中肯”等元叙事口号（`CMG-STY-004`）（禁词单源见 [commit-msg-forbidden-terms.json](scripts/common/commit-msg-forbidden-terms.json)）；
  ② 严禁在代码、测试、路径或提交信息中使用施工批次与临时标记（禁止词：`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip`；WebGames 前端视图保留 `fe_01`~`fe_17` 除外）；
  ③ `[Verification]` 严禁出现“退出码0”等程序化流水账（`CMG-STY-005`）或任何测试计数、耗时、比例流水账（`CMG-STY-006`），必须采用纯粹的技术功能逻辑与输入输出质性断言；
  ④ 提及的规则 ID 必须在 [rule-catalog.json](scripts/common/rule-catalog.json) 中真实登记，严禁虚构（`RCFG-RULE-DRIFT`）；
  ⑤ 跨架构层次改动必须依拓扑分批原子提交并执行离线预审（详见 [batch-commit](.agents/skills/batch-commit/SKILL.md)）。

### 4. 执行环境与子进程契约
- **工作目录显式隔离**：父级脚本跨目录调用子项目时，必须显式传递 `-WorkingDirectory (Join-Path $repoRoot "<subproject>")`（PowerShell）或 `(cd "<subproject>" && ...)`（Bash），杜绝工具配置文件解析与相对路径发生跨目录漂移；
- **平台与非阻塞守卫**：全局与项目级脚本必须带非交互守卫；Git 钩子优先路由至跨平台 `pwsh`（PowerShell 7+），严禁回退至 PS 5.1；Bash 脚本必须声明 `set -euo pipefail` 且预期允许失败指令必须通过 `STATUS=0; cmd || STATUS=$?` 平铺捕获（详见 [gate-governance](.agents/skills/gate-governance/SKILL.md)）。

---

## 三、 三大项目专属核心约束速查

| 项目 | 核心专属约束与架构红线 | 专属构建/测试命令 | 权威真源指针 |
| :--- | :--- | :--- | :--- |
| **`workspace-timing/`**<br/>*(VS Code 扩展)* | ① UI 文本 100% 接入双语字典（zh-CN/en），严禁硬编码未翻译文案与内部技术黑话；<br/>② 审查规则单源登记于 `workspace-timing/scripts/config/review-rules.json`；<br/>③ `tsconfig.json` 保持 `declaration: false` 极速构建。 | `npm run compile`<br/>`npm run test:fast`<br/>`npm run review` | [workspace-timing/README.md](workspace-timing/README.md)<br/>[architecture.md](workspace-timing/docs/architecture.md) |
| **`auto-refactor/`**<br/>*(Node CLI 引擎)* | ① 26 分析器与 243 条内置规则全量自测，零孤儿用例；<br/>② Rust 原生算子内核与 pure-TS shim 100% 字节等价；<br/>③ 单分析器扣分遵循 `MAX_AXES_PER_FINDING <= 4`；受 `validate-project-neutrality.js` 项目中立性守卫管束。 | `npm run gate`<br/>`npm run build`<br/>`npm test` | [auto-refactor/DOCS.md](auto-refactor/DOCS.md)<br/>[auto-refactor/package.json](auto-refactor/package.json) |
| **`WebGames/`**<br/>*(Godot 引擎)* | ① 统一经 `GameConfig.get_*` 读取配置，严禁根目录平铺配置；<br/>② 视图零业务计算，数据一律经 `apply_snapshot()` 注入；<br/>③ 高承压对象池循环内零瞬态堆分配（`ADV-PRF-002`），必须实现 `reset_state()`；<br/>④ 改动必须先立四阶段方案细则（严格仅 4 份文件），获批后方可编码。 | `check-gdscript.sh`<br/>`test-run.sh`<br/>`audit-all.sh` | [WebGames/docs/README.md](WebGames/docs/README.md)<br/>[路线图总索引.md](WebGames/docs/路线图/路线图总索引.md) |

---

## 四、 工作区一票否决红线禁令

1. **路径与引用红线**：严禁在代码或配置中书写绝对路径、盘符或 `file:///`；重命名或删除文件必须同步修正全库所有引用点；严禁私自修改 baseline/基线文件以消音违规；
2. **规则与防刷分红线**：严禁私自放宽各项目的 linter、formatter、naming 规则或门禁脚本阈值；改动若 $\text{ELOC}_{semantic} \le 15\%$ 且无真实技术债净消除，强制冻结收益并触发 `BLOCK_GAMING_DETECTED` 熔断；
3. **交付与完整性红线**：严禁创建或遗留 0 字节文件、纯空白文件或仅含占位符、未决 TODO 的半成品代码；严禁未获批准提前在任务路线图上标记完成；严禁交付未通过全量回归测试的缩水实现；
4. **方案与黑话红线**：方案目录下严格仅允许四阶段细则文件；严禁在 `tests/unit/` 根目录平铺散落脚本；严禁在代码标识符、测试用例与提交信息中使用施工批次黑话代号；
5. **规则一致性红线**：严禁在检查器代码中发射或在提交信息中书写未在 [rule-catalog.json](scripts/common/rule-catalog.json) 登记的规则 ID（违者触发 `RCFG-RULE-DRIFT` 阻断）；
6. **防线与验证红线**：严禁使用 `--no-verify` 或跳过本地门禁提交或推送代码；向远端推送后必须确保 CI 流水线完全通过；严禁对未跟踪文件执行 `git rm`；
7. **原子提交与归属红线**：关键生产级提交（feat/fix/refactor）必须显式声明 `[Project]` 并限定于四大受控项目（`CMG-PRJ-001`）；提交前必须先通过本地 `commit-msg-gate` 与 `pre-commit-gate` 预审；
8. **跳板消融红线**：严禁创建或保留有效代码 $\le 3$ 行且仅向单一目标透传的空包跳板文件；门面层违反实质承载预算强制触发 `ARCH-FAC-001` 阻断；
9. **客观求实红线**：提交信息严禁夹带敷衍（`CMG-STY-001`）、夸大（`CMG-STY-002`）、贬损（`CMG-STY-003`）或元叙事口号（`CMG-STY-004`）；`[Verification]` 严禁程序化流水账（`CMG-STY-005`）与执行数字统计流水账（`CMG-STY-006`）。

---

## 五、 Agent 标准作业闭环（SOP）

1. **查验指针**：接到任务后，依据意图查阅 §一 路由矩阵，精读对应项目的 SSOT 指针与关联 Skill，明确架构边界与红线；
2. **单域作业**：操作严格限定在当前任务所属的项目内，严禁跨项目扩散修改；涉及方案调整严格遵守“先细则获批、后编码施工”；
3. **本地预审**：提交前必须在本地依次运行离线门禁预审：
   - 暂存区检查：`pwsh -File scripts/ps1/pre-commit-gate.ps1`
   - 提交信息检查：`pwsh -File scripts/ps1/commit-msg-gate.ps1 <path-to-msg>`
4. **全量回归**：改动落地后，执行对应项目专属全量测试及全工作区统一审查（`pwsh -File scripts/ps1/audit-all.ps1`），确保 100% 绿色通行后方可交割。
