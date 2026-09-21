# AGENTS.md — 工作区指针索引（精简·泛化·严格）

> 三项目共存，本文件为工作区全局治理总规与指针索引；详情以各项目真源文档为准。修改前必读对应指针。

## 一、 仓库概况与构建门禁矩阵

| 项目目录 | 类型与核心架构 | 构建与验证流水线 | 权威真源指针 |
| :--- | :--- | :--- | :--- |
| `workspace-timing/` | VS Code 扩展（TS 五层架构，RingBuffer+Journal 双写无损，L0~L5 门禁） | `npm run compile → test:unit → lint` (`test:coverage`) | `workspace-timing/README.md` |
| `auto-refactor/` | Node CLI 静态分析审查引擎（oxc+ts-morph 混合解析，跨语言语义 IR，4 层规则金字塔） | `npm run build → npm test → npm run benchmark` | `auto-refactor/DOCS.md` |
| `WebGames/` | Godot 4.7 引擎（纯逻辑无头解耦，配置驱动，GDScript，20 项静态门禁） | `test-run.sh → check-gdscript.sh → bench-sweep.sh`<br/>一键门禁：`audit-all.sh` / `audit-all.ps1` | `WebGames/docs/README.md`<br/>`WebGames/config/README.md`<br/>`WebGames/scripts/README.md` |

- **统一发布工具链（根 `scripts/`）**：`package.sh`/`package.ps1`（本地打包至 `dist/<ext>/`）；`version-bump.sh`（语义递增+CHANGELOG，三门禁+自检）；`release-tag.sh`（发布闭环，`--no-push` 留痕）；`check-display-assets.sh`（资产校验）；提交前缀 `vX.Y.Z` 触发 GitHub Actions 自动发布；`.github/workflows/ci.yml` 永久看守 hygiene 作业。
- **门禁通用契约**：执行各项目专属构建门禁，失败重跑；警告即错误；禁止跨项目越界引入未经测试的代码变更。

## 二、 跨项目通用契约与命名规范

### 1. 命名与格式规范
- **分支与提交**：分支 `<type>/<scope>-简述`；提交 `<type>(<scope>): 简述`（feat/fix/refactor/docs/test/chore/style/perf）+ 中文正文引需求ID；
- **物理文件名**：全局严格遵循 `kebab-case`；
  - *例外豁免*：WebGames 的 `config/**/*.json` 与 `.gd` 脚本保持 `snake_case`（对齐领域 id 与 Godot 惯例）；
- **排版与换行符**：
  - 代码缩进：TypeScript 4 空格，其余语言/格式 2 空格；
  - 物理换行符：`ps1` 严格 CRLF，`sh`/`gd`/`md`/`json`/`ts` 严格 LF；
- **零黑话铁律**：测试文件、代码符号与路径**严禁包含施工批次与临时性标记**（禁止词：`p[0-9]+`、`phase[0-9]+`、`st[0-9]+`、`temp`、`new`、`v[0-9]+`、`wip`；WebGames 前端视图保留 `fe_01`~`fe_17` 规范名除外）。

## 三、 三项目专属核心架构契约

| 项目 | 核心硬性架构契约 | 红线约束与设计边界 | 权威指针 |
| :--- | :--- | :--- | :--- |
| **`workspace-timing/`** | ① **五层分层解耦**（UI / Engine / Storage / Analytics / Shared）；<br/>② **三级存储与双写**：`RingBuffer` 内存无 I/O 缓冲 + `Journal` (NDJSON) 追加崩溃即时回放 + 全量检查点存盘；<br/>③ **六层审查门禁**（L0~L5）联动 auto-refactor 扫描密钥、循环依赖与无用导出。 | 严禁破坏五层单向依赖；破坏性操作前必须写安全快照；UI 文本 100% 接入双语字典（zh-CN/en），严禁硬编码未翻译文案。 | `workspace-timing/README.md`<br/>`workspace-timing/package.json` |
| **`auto-refactor/`** | ① **规则金字塔与单一真源**：Layer 1~4 四层规则金字塔（166 条规则全量自测，零孤儿规则）；<br/>② **双轨解析与字节等价**：oxc 快速路径与 ts-morph/NormalizedNode 必须保持 100% 语义与字节等价；<br/>③ **核心层模块化拓扑**：`src/core/` 领域子目录（`ast/`、`config/`、`diff/`、`policy/`），平铺兼容 shim 零运行时开销。 | 严禁私改 baseline 掩盖回归；物理文件名必须通过 `validate-physical-naming.js` 看守；新增/修改规则必须具备对等正反向测试用例。 | `auto-refactor/DOCS.md`<br/>`auto-refactor/package.json` |
| **`WebGames/`** | ① **配置驱动零硬编码**：全域数据统一经 `GameConfig.get_*` 从 `config/<层>/<域>.json` 读取，物品经管线自动发现；<br/>② **前端可视化边界**：前端仅作数据显示，数据统一经 `apply_snapshot()` 注入；<br/>③ **高承压与对象池**：循环内零瞬态堆分配（`ADV-PRF-002`），池化对象必接 `reset_state()`；<br/>④ **短期施工规范**：改动必先立四阶段案卷细则，必须获批后方可编码实施；每积 10 卷归档一次。 | 严禁 `get_value` 与直读未登记配置；前端严禁业务计算、后端类直连与 EventBus 订阅；严禁循环内 `.new()`/`.duplicate(true)`；案卷目录严格仅 4 份细则文件（禁自造额外文件）。 | `WebGames/docs/README.md`<br/>`WebGames/config/README.md`<br/>`WebGames/docs/路线图/路线图总索引.md` |

## 四、 测试工程化拓扑与护栏守卫

| 项目 | 测试目录与组织拓扑 | 命名公式与规范示范 | 契约基座与护栏约束 |
| :--- | :--- | :--- | :--- |
| **`workspace-timing/`** | `tests/unit/`（单元测试）<br/>`tests/e2e/`（端到端测试） | `*.test.ts`<br/>示例：`ring-buffer.test.ts`, `journal.test.ts` | Mocha/Chai 底座；异步与定时器精准清理；覆盖率看守。 |
| **`auto-refactor/`** | `test/`（单元与集成测试）<br/>`scripts/test-parallel.js` | `validate-*.ts` / `test-*.ts`<br/>示例：`validate-physical-naming.js`, `validate-praxis.ts` | 62 套并行异步流水线；全量 PASS 门禁；基线防回退（ratchet）。 |
| **`WebGames/`** | `tests/unit/domains/`（领域单测）<br/>`tests/unit/frontend/`（前端视图/基建）<br/>`tests/unit/infrastructure/`（基础设施）<br/>`tests/guards/`（架构与配置长效护栏）<br/>`tests/integration/pipelines/`（跨域管线）<br/>`tests/fixtures/factories/`（测试工厂） | 领域：`test_<domain_id>.gd`<br/>前端视图：`test_fe_NN_<view>.gd`<br/>前端基建：`test_frontend_<topic>.gd`<br/>基础设施：`test_<service>.gd`<br/>长效护栏：`test_<topic>_guard.gd`<br/>跨域管线：`test_<topic>_pipeline.gd`<br/>测试工厂：`<entity>_factory.gd`（禁 `test_`） | 统一继承 `TestCase`（`pack_results` 打包）；`tests/unit/` 根目录散落文件数恒为 0；护栏单源演进（严禁随案卷分裂新建护栏文件）；新增领域在 `domains.json` 与 `test_registry.gd` 双向对齐。 |

## 五、 Agent 行为边界与绝对红线清单

### 1. 范围与事前原则
- **默认单项目**：操作必须严格限定在当前任务所属的项目内，严禁跨项目扩散修改；
- **先契约后编码**：涉及架构或流程调整时，严格遵守先规划细则并获批后实施的工程闭环；
- **改前与改后门禁**：改前通读对应项目 SOP 与真源指针，改后必须跑通该项目全量构建门禁且 0 违规。

### 2. 绝对红线禁令
1. **路径与引用红线**：严禁在代码或配置中书写绝对路径、盘符或 `file:///`；重命名或删除文件必须同步修正全库所有引用点；严禁未经授权修改 baseline/基线文件以消音违规；
2. **规范与门禁红线**：严禁私自放宽各项目的 linter、formatter、naming 规则或门禁脚本；严禁向配置表臆造未在架构规范中定义的新字段；
3. **交付与占位符红线**：严禁提交包含 `<...>` 占位符、未决 TODO 或伪实现的半成品；严禁未获批准提前在任务路线图上标记完成；严禁仅跑通局部测试的缩水 MVP 敷衍实现；
4. **案卷与测试红线**：案卷目录下严格仅允许四阶段细则文件（严禁自造 README 等多余文件）；严禁在 `tests/unit/` 根目录平铺散落脚本；严禁在测试名称与代码标识符中使用施工批次黑话（`pXX`/`phaseXX` 等）。

## 六、 维护规则

本文件为工作区指针索引与跨项目治理底座。任何项目结构、全局命令、架构边界或发布工具链变更时，必须同次提交同步更新本文件，确保指针长效准确。
