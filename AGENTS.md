# AGENTS.md — 工作区治理总规与指针索引（精简·权威·高内聚）

> 三项目共存，本文件为工作区全局唯一的顶层治理总规与架构指针；详情以各项目真源文档为准，修改前必读对应指针。

## 一、 仓库拓扑与工程全景

- **三项目独立自治**：
  - `workspace-timing/`：VS Code 扩展，独立运行时，RingBuffer+Journal 内存双写崩溃安全，L0~L5 六层权重审查体系；
  - `auto-refactor/`：Node CLI 静态重构与审查引擎（非扩展，独立工具），TS+Rust 双轨内核，4 层规则金字塔；
  - `WebGames/`：Godot 4.7 卡拉尔世界引擎（纯逻辑无头解耦，配置驱动，静态规范守卫，四阶段案卷施工）；
- **顶层架构蓝图与全宗交付物**：
  - `docs/agent-native-system-blueprint.md`：多 Agent 自治体系、一体两面三层拓扑 Diff 差分系统与记忆提纯顶层设计案卷；
  - `archive/deliverables/`：历史阶段性审查报告、重构治理方案与评审交付物集中归档留痕；
- **根级发布与质量工具链（`scripts/`）**：
  - 统一审查中枢：`scripts/sh/audit-all.sh` / `scripts/ps1/audit-all.ps1`（全工作区跨项目统一审查与质量看板）；
  - 提交前检查钩子：`pre-commit-gate`（文件物理卫生、换行契约、双轨体积与 ELOC 预算、密钥防泄漏与 AST 局部切片审查，含 `sh/` 与 `ps1/` 同构双实现）；
  - 提交说明验证钩子：`commit-msg-gate`（生产工程级结构化正文、零黑话、文本风格求真务实与规则 ID 反虚构防漂移校验，依单源注册表 `scripts/common/rule-catalog.json` 与 `commit-msg-forbidden-terms.json` 核验）；
  - 推送前回归验证：`pre-push-gate`（推送前全量回归测试、待推送分支提交历史规范扫描与质量基线检查，经 `.githooks/` 与 `install-hooks` 激活）；
  - 构建与打包分发：`package.ps1` / `package.sh`（打包至 `dist/<ext>/`，支持 `-HotSync` 双端热同步与 `-Install` 自动化安装）；
  - 版本演进与标签：`version-bump.sh`（语义递增与 CHANGELOG 维护）；`release-tag.sh`（发布留痕）；提交前缀 `vX.Y.Z` 触发 GitHub Actions 自动化发布；`.github/workflows/ci.yml` 持续看守工程卫生作业。

## 二、 跨项目全局通用契约

### 1. 命名与代码排版
- **Git 分支契约**：分支命名遵循 `<type>/<scope>-简述`，其中 `<type>` 限于 feat/fix/refactor/docs/test/chore/style/perf；
- **Git 提交信息契约**：
  ① **标题规范**：`<type>(<scope>): <祈使句中文摘要标题>`，长度在 5~80 字符，结尾不加句号；
  ② **结构化区块**：正文必须包含 `[Why]`、`[Added]`、`[Changed]`、`[Fixed]`（如有修复缺陷）、`[Verification]` 结构化标签，非轻量提交正文有效字符数 $\ge 30$，由本地与远端流水线共同校验；
  ③ **纯粹技术事实原则**：客观记录修改动机、文件与逻辑变更，严禁使用临时性/敷衍用语（`CMG-STY-001`）、过度肯定与绝对化夸大（`CMG-STY-002`）、过度否定与情绪化贬损（`CMG-STY-003`），严禁以“调整语调为低调中肯、移除宣扬性词汇”等风格元叙事口号替代具体技术与文件改动事实（`CMG-STY-004`）（中英文同规）；
  ④ **执行验证质性断言纪律**：严禁在 `[Verification]` 区块使用“退出码0”、“双端返回0”、“XX项检查通过”等程序化流水账替代具体输入输出与断言细节（`CMG-STY-005`）；严禁在 `[Verification]` 执行标签区域出现任何形式的执行数字、用例计数、测试套件数、行数、耗时、比例或百分比流水账（`CMG-STY-006`），必须采用纯粹的技术功能逻辑与输入输出质性断言；
  ⑤ **分批原子提交与预审流程**：跨架构层次改动必须按依赖拓扑分批原子提交，每次提交前须先运行本地校验脚本（`commit-msg-gate` 与 `pre-commit-gate`）执行离线预审；
- **物理命名规范**：全局严格遵循 `kebab-case`（*例外*：WebGames 的 `config/**/*.json` 与 `.gd` 脚本保持 `snake_case` 对齐领域惯例）；
- **缩进与换行契约**：TypeScript 保持 4 空格缩进，其余源码保持 2 空格缩进；`ps1` 脚本严格采用 CRLF，`sh`、`gd`、`md`、`json`、`ts` 文件严格采用 LF。

### 2. 代码复杂度与控制流刚性预算
- **AST 切片预算（`GATE-AST-001`）**：所有生产代码与工具脚本受暂存区 AST 局部切片规范守卫约束：单函数圈复杂度 $\text{CC} \le 15$、控制流嵌套深度 $\text{Depth} \le 4$、单行噪声比 $\text{Noise} \le 4.0$；
- **单文件双轨体积与 1:3 动态反推包络**：全工作区源码文件（`.ts`, `.js`, `.gd`, `.py` 等）以**有效代码行（$\text{ELOC} \le 900$）**作为第一刚性业务复杂度预算（$\text{ELOC}$ 严格剔除单行与多行注释及空行，保护高价值架构契约文档与 JSDoc）；以**物理总行数（$\text{LOC} \le 1400$）**作为编辑器排版防膨胀兜底红线。在此基础上执行 **1:3 密度比双向动态反推包络约束**：
  ① **正向动态物理上限**：$\text{LOC}_{dynamic\_max} = \min(1400, \max(150, \lceil \text{ELOC} \times 3.0 \rceil))$，低逻辑代码物理上限动态收敛，严禁通过空行注水扩张；
  ② **反向动态逻辑下限**：当 $\text{LOC} \ge 250$ 时，$\text{ELOC} \ge \lfloor \text{LOC} / 3.0 \rfloor$（纯净代码密度 $\ge 33.3\%$），大文件必须承载相称的业务逻辑；
  ③ **高负荷契约注释密度**：当 $\text{ELOC} \ge 600$ 时，反推要求注释占比 $\ge 8\%$，严禁为压缩物理行数而删除架构契约与状态机流转说明；
  ④ **十维量化模型内化联动**：动态稀释失衡联动扣减标准化与语义纯净度，高负荷缺乏契约联动扣减可维护性与注释质量，绝对超标联动扣减技术债风险；
- **平铺控制流契约**：循环体或核心调度逻辑涉及多条件派发时，采用卫语句（Guard Clauses）提前返回，并将分支处理逻辑下沉为独立纯函数，杜绝深层嵌套分支。

### 3. 文档与黑话边界隔离
- **零黑话纪律**：测试文件、代码符号、路径与提交信息**严禁包含施工批次与临时性标记**（禁止词：`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip`；WebGames 前端视图保留 `fe_01`~`fe_17` 规范名除外；历史归档案卷文件名在 `docs/归档库/` 与 `docs/路线图/` 中受物理豁免，但提交信息中严禁直录该类批次代号，必须提炼为纯粹产品特性与功能价值表述）；
- **面向用户文档纯粹性**：面向用户的文档（README、CHANGELOG、UI 提示文案）必须纯粹基于功能特性与产品交付价值撰写，严禁出现内部工程黑话、编译器内部参数或内部审查分层代号；底层工程细节统一收口至内部真源指针。

### 4. 执行环境与子进程契约
- **终端非阻塞**：全局与项目级脚本、环境配置必须具备非交互与重定向守卫（`[Environment]::UserInteractive -and -not [Console]::IsOutputRedirected`），严禁在重定向子进程中加载交互式 UI 或自动补全模块；
- **构建防重入**：打包流水线触发子构建时必须传递幂等标记（`WT_COMPILED=1`），杜绝在生命周期钩子中多重递归编译；
- **并发与去重**：审查系统与自检测试套件按唯一实例去重，统一采用 `Promise.all` 异步并发调度；
- **子进程工作目录显式隔离**：父级脚本或全局调度器跨目录调用子项目命令时，必须显式传递 `-WorkingDirectory`（PowerShell）或 `(cd <subproject> && ...)`（Bash），杜绝工具配置文件解析与相对路径发生跨目录漂移。

### 5. 双层质量防线与流水线健壮性契约
- **双层防护体系**：严格落实本地提交前检查（Tier 1 Local Guard）与远端持续集成（Tier 2 Remote CI Pipeline）两道防线。Git 钩子优先路由至跨平台 `pwsh`，严禁回退至对无 BOM UTF-8 解析脆弱的 Windows PowerShell 5.1；
- **子进程环境显式继承**：Bash 脚本与 CI 步骤中临时生成并由子进程读取的环境变量必须显式 `export`，杜绝局部变量导致子进程读取为空；
- **Bash 退出码平铺捕获**：在 `set -euo pipefail` 脚本中，预期失败并断言非 0 退出码的指令严禁裸调，必须通过 `STATUS=0; cmd || STATUS=$?` 平铺捕获或条件守卫，杜绝断言前异常熔断；
- **CI 多行文本确定性输出**：YAML 步骤中动态生成多行文件时统一使用 `printf "%s\n"` 语法，杜绝受缩进剥离影响的多行 Heredoc；
- **依赖就绪守卫**：跨目录调用的静态分析工具必须具备多级路径回退与环境就绪守卫，杜绝在未安装依赖的环境中抛出未捕获的模块缺失异常；跨版本依赖冲突且 `.npmrc` 被忽略时，CI 步骤显式声明 `--legacy-peer-deps`。

### 6. 门面层实质承载与跳板消融契约
- **实质承载预算**：任何作为门面（facade）、网关（gateway）或对外导出统一入口的模块，必须满足以下硬性条件之一：① 有效代码行（ELOC）$\ge 15$ 且包含数据契约校验、模式守卫或环境适配逻辑；② 聚合 $\ge 3$ 个子领域模块的跨领域聚合出口；③ 包含不可变性冻结（`Object.freeze` / `deepFreeze`）保障（违者触发 `ARCH-FAC-001`）；
- **单行跳板物理清零（`ARCH-ABS-001`）**：严禁创建或保留有效代码 $\le 3$ 行且仅向单一目标透传的空包跳板文件；重构或废弃文件必须直接更新全库调用点并物理删除，严禁遗留空壳重定向垫片。

## 三、 三项目专属工程矩阵（一表合一）

| 项目与定位 | 核心硬性架构契约 | 构建与测试流水线 | 拓扑规范与专属约束 | 权威真源指针 |
| :--- | :--- | :--- | :--- | :--- |
| **`workspace-timing/`**<br/>*(VS Code 扩展)* | ① 五层解耦（UI / Engine / Storage / Analytics / Shared）；<br/>② RingBuffer 内存缓冲 + Journal (NDJSON) 追加崩溃即时回放 + 全量检查点；<br/>③ L0~L5 六层权重审查体系；<br/>④ `tsconfig.json` 保持 `declaration: false` 与 `isolatedModules: true` 极速构建。 | `npm run compile`<br/>`npm run test:fast`<br/>`npm run review`<br/>`npm run sync` | ① 单元测试放 `test/**/*.test.js`（由 `npm run test:fast` 执行）；<br/>② UI 文本 100% 接入双语字典（zh-CN/en），严禁硬编码未翻译文案与内部技术黑话；<br/>③ SVG 图标/文字保持暗色高对比度；<br/>④ 审查规则单一真源登记于 `workspace-timing/scripts/config/review-rules.json`。 | `workspace-timing/README.md`<br/>`workspace-timing/package.json` |
| **`auto-refactor/`**<br/>*(Node CLI 分析引擎)* | ① Layer 1~4 四层规则体系（26 分析器，243 规则全自测，零孤儿）；<br/>② 四层正交 ELOC 空间（$\text{ELOC}_{processed}, \text{unique}, \text{changed}, \text{semantic}$）与长期质量轨迹（QED / ReviewYield / RegressionDensity）；<br/>③ $\mathcal{O}(\text{Runs} + \text{Milestones})$ 分层滚动持久化（NDJSON $<350\text{B}$/条，总空间 $\le 2\text{MB}$）；<br/>④ 四要素复合判定（Static $\land$ Dynamic $\land$ Regression $\land$ QualityDeltaPass）与 Anti-Gaming 防刷分去抖；<br/>⑤ Rust 原生算子内核与 pure-TS shim 100% 字节等价。 | `npm run gate`<br/>`npm run build`<br/>`npm test`<br/>`npm run benchmark` | ① 测试放 `scripts/validate-*.js`，在 `test-parallel.js` 统一登记防孤儿；<br/>② 物理文件名受 `validate-physical-naming.js` 看守；<br/>③ 项目中立性受 `validate-project-neutrality.js` 护栏管束；<br/>④ 单分析器扣分遵 `MAX_AXES_PER_FINDING <= 4`。 | `auto-refactor/DOCS.md`<br/>`auto-refactor/package.json` |
| **`WebGames/`**<br/>*(Godot 游戏引擎)* | ① 全域配置驱动与同构目录化：统一经 `GameConfig.get_*` 从 `config/domains/<域>/core.json` 及子表读取，严禁根目录平铺配置表；支持点分路径泛化路由与细粒度热重载；<br/>② 前端可视化边界：视图零业务计算，数据一律经 `apply_snapshot()` 注入；<br/>③ 高承压对象池：循环内零瞬态堆分配（`ADV-PRF-002`），池化对象必接 `reset_state()`；<br/>④ 统一继承 `TestCase`（`pack_results` 打包）。 | `test-run.sh`<br/>`check-gdscript.sh`<br/>`bench-sweep.sh`<br/>`audit-all.sh` / `.ps1` | ① `tests/unit/` 根目录散落脚本数恒为 0，按 domains/frontend/infrastructure 归位；<br/>② 改动必须先立四阶段方案细则，获批后方可编码（方案细则严格仅 4 份文件）；<br/>③ 严禁直读未登记配置与循环内 `.new()`；<br/>④ 新增领域在 `domains.json` 与 `test_registry.gd` 双向对齐。 | `WebGames/docs/README.md`<br/>`WebGames/config/README.md`<br/>`WebGames/docs/路线图/路线图总索引.md` |

## 四、 工作区绝对红线禁令

1. **路径与引用红线**：严禁在代码或配置中书写绝对路径、盘符或 `file:///`；重命名或删除文件必须同步修正全库所有引用点；严禁未经授权修改 baseline/基线文件以消音违规；
2. **规范守卫与规则红线**：严禁私自放宽各项目的 linter、formatter、naming 规则或质量检查脚本阈值；严禁向配置表臆造未在架构规范中定义的新字段；
3. **交付与占位符红线**：严禁在磁盘创建或遗留 0 字节物理空文件、纯空白虚空文件（0 ELOC）或仅含 `<...>` 占位符、未决 TODO 的半成品代码；所有文件必须一次性原子落地完整实现并通过物理卫生检查；严禁未获批准提前在任务路线图上标记完成；严禁交付仅跑通局部测试的缩水实现；
4. **方案与黑话红线**：方案目录下严格仅允许四阶段细则文件（严禁自造多余文件）；严禁在 `tests/unit/` 根目录平铺散落脚本；严禁在测试名称、代码标识符及面向用户的文档（README/CHANGELOG/UI）中使用施工批次黑话与内部工程代号；
5. **构建配置与性能红线**：严禁在 VS Code 扩展或无外部类型依赖的项目中开启 `"declaration": true` 导致构建膨胀；严禁在自动化执行环境中使用未加非交互守卫的全局 Shell 启动挂钩；
6. **审查规则一致性红线**：严禁在检查器代码中发射或在提交信息中书写未在 `scripts/common/rule-catalog.json` / `review-rules.json` 元数据中登记的规则 ID（违者触发 `RCFG-RULE-DRIFT` 阻断）；
7. **质量度量防刷分红线**：严禁通过大面积搬移常量、调整格式空白或生成空壳桩代码制造表面虚假产出；改动若 $\text{ELOC}_{semantic} \le 15\%$ 且无真实技术债净消除，强制冻结收益并触发 `BLOCK_GAMING_DETECTED` 熔断；
8. **质量防线合规红线**：严禁使用 `--no-verify` 或任何跳过本地 Tier 1 检查的手段提交或推送代码；向 `origin/main` 推送后必须确保 GitHub Actions 远端 Tier 2 流水线完全通过，任何失败必须同次闭环修复；严禁对未跟踪文件执行 `git rm`；
9. **原子提交与预审红线**：严禁将涉及多个不同层次架构（如文档索引、底层基础设施、业务领域逻辑与静态重构）的跨域大型改动一次性巨石提交；严禁在未通过本地 `commit-msg-gate` 与 `pre-commit-gate` 预审的情况下执行 `git commit`；
10. **空包转发与伪门面红线**：严禁在任何项目中创建或提交无本地声明、无数据校验、无不可变冻结且仅向单一文件透传导出的空包转发文件；门面层违反实质承载预算强制触发 `ARCH-FAC-001` 阻断；
11. **客观技术事实与执行数字红线**：严禁在提交信息中夹带临时敷衍词汇（`CMG-STY-001`）、绝对化夸大词汇（`CMG-STY-002`）、情绪化贬损词汇（`CMG-STY-003`）或“调整语调为低调中肯”等元叙事口号（`CMG-STY-004`）；严禁在 `[Verification]` 执行标签区域使用程序化流水账（`CMG-STY-005`）或记录任何形式的执行数字、用例计数、测试套件数、行数、耗时、比例与百分比流水账（`CMG-STY-006`）。

## 五、 Agent 行为边界与维护规则

### 1. 行为边界原则
- **默认单项目**：操作必须严格限定在当前任务所属的项目内，严禁跨项目扩散修改；
- **先契约后编码**：涉及架构或流程调整时，严格遵守先规划细则并获批后实施的工程闭环；
- **改前与改后验证**：改前通读对应项目真源指针，改后必须跑通该项目专属全量构建与审查测试，确保零违规。

### 2. 指针长效维护
本文件为工作区全局治理总规与指针索引底座。任何项目结构、全局命令、架构边界或发布工具链变更时，必须同次提交同步更新本文件，确保指针长效准确。
