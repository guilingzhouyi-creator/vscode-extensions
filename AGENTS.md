# AGENTS.md — 工作区指针索引（精简·泛化·严格）

> 三项目共存，本文件仅为指针索引与行为边界；详情以各项目真源文档为准。修改前必读对应指针。

## 一、 仓库概况与构建门禁

| 项目目录 | 类型与架构定位 | 构建与验证流水线 | 权威指针 |
| :--- | :--- | :--- | :--- |
| `workspace-timing/` | VS Code 扩展（TS 五层分层，RingBuffer+Journal） | `npm run compile → test:unit → lint` (`test:coverage`) | `workspace-timing/README.md` |
| `auto-refactor/` | Node CLI 静态分析工具（oxc+ts-morph 混合解析） | `npm run build → npm test → npm run benchmark` | `auto-refactor/DOCS.md` |
| `WebGames/` | Godot 4.7 引擎（纯逻辑无头解耦，GDScript） | `test-run.sh → check-gdscript.sh → bench-sweep.sh → audit-perf.sh`<br/>一键门禁：`audit-all.sh` / `audit-all.ps1`（20 项静态门禁） | `WebGames/docs/README.md`<br/>`WebGames/config/README.md`<br/>`WebGames/scripts/README.md` |

- **统一发布工具链（根 `scripts/`）**：`package.sh`/`package.ps1`（本地打包至 `dist/<ext>/`）；`version-bump.sh`（语义递增+CHANGELOG，三门禁+自检）；`release-tag.sh`（发布闭环，`--no-push` 留痕）；`check-display-assets.sh`（资产校验）；提交前缀 `vX.Y.Z` 触发 GitHub Actions 自动发布；`.github/workflows/ci.yml` 永久看守 hygiene 作业。
- **门禁通用契约**：`npm install → compile → lint → diff` 失败重跑；WebGames 警告即错误。

## 二、 关键架构约定与工程契约

| 机制 / 领域 | 核心硬性契约 | 红线约束与边界 | 权威指针 |
| :--- | :--- | :--- | :--- |
| **WebGames 零硬编码** | `GameConfig.get_*` 读 `config/<层>/<域>.json`；物品经 `ItemLoaderPipeline` 自动发现 | 严禁 `get_value`；新增表先建文件入 `_required_tables`；ID 三元组对齐 | `WebGames/config/README.md` |
| **前端可视化边界** | 前端仅作数据显示；业务数据统一经 `apply_snapshot()` 注入 | 严禁业务计算（随机/汇率/概率/规则状态机）、后端类直连与 EventBus 订阅 | `docs/模板/GD老练风格硬性规范标准.md` 第九章 |
| **单机与联机边界** | `GameBootstrap.assemble()` 幂等唯一入口；联机启用 `ClawbackService` | `LEVEL_GAME_MASTER` 权限；货币欠账物品钳制；GM 审计留痕 | `backend/infrastructure/` |
| **高承压与性能治理** | 循环内零瞬态堆分配（`ADV-PRF-002`）；池化对象必接 `reset_state()`（`ADV-POOL-001`） | 严禁循环内 `.new()` / `.duplicate(true)`；六维转化走转换引擎 | `backend/domains/` 与 `config/domains/` |
| **短期施工硬性契约** | 改动必先立分阶段施工细则（四阶段模板）；必须获批后才可写代码 | 案卷目录严格仅 4 份细则文件（阶段1~4），禁建 README 等多余文件；唯一登记于路线图总索引 | `docs/模板/README.md`<br/>`docs/路线图/路线图总索引.md` |
| **两轮施工周期机制** | 两轮 Agent 为一完整周期：第 1 轮规划细则 ➔ 获批 ➔ 第 2 轮实施验收闭环 | 严禁提前修改路线图状态；未获批准严禁写业务代码；第二轮结束前严禁开新任务 | 路线图全域施工规范 |
| **序号门禁与归档** | 开工先做前置检查（序号连续/唯一/无跳号/无越序）；每积 10 卷归档一次 | 当前第 09 期在途 4/10（Phase 85 ✅, Phase 86 ✅, Phase 87 ✅, Phase 88 ✅）；归档入 `docs/归档库/03_短期施工档案卷/` | `docs/归档库/` |

## 三、 测试工程化拓扑与零黑话铁律

> **物理拓扑红线**：`tests/unit/` 根目录散落文件数恒等于 0，严禁测试目录平铺倾倒。

| 测试分类 | 物理存放目录 | 严格命名公式 | 规范示范 | 严禁反例（违规阻断） |
| :--- | :--- | :--- | :--- | :--- |
| **业务域单测** | `tests/unit/domains/` | `test_<domain_id>.gd` | `test_inventory.gd` | ❌ `test_inv.gd`, `test_p82_combat.gd` |
| **前端视图单测** | `tests/unit/frontend/` | `test_fe_NN_<view_name>.gd` | `test_fe_01_account_entry.gd` | ❌ `test_account.gd`, `test_fe_login.gd` |
| **前端基建单测** | `tests/unit/frontend/` | `test_frontend_<topic>.gd` | `test_frontend_robustness.gd` | ❌ `test_fe_p82_robustness.gd`, `test_ui_mock.gd` |
| **基础设施单测** | `tests/unit/infrastructure/` | `test_<service>.gd` | `test_event_bus.gd` | ❌ `test_p75_event_bus.gd` |
| **架构与配置护栏** | `tests/guards/` | `test_<topic>_guard.gd` | `test_frontend_boundary_guard.gd` | ❌ `test_frontend_p82_boundary_guard.gd` |
| **跨域业务管道** | `tests/integration/pipelines/` | `test_<topic>_pipeline.gd` | `test_game_loop_fsm_pipeline.gd` | ❌ `test_pipeline_combat.gd` |
| **测试数据工厂** | `tests/fixtures/factories/` | `<entity>_factory.gd` | `contract_registry_factory.gd` | ❌ `test_contract_factory.gd`（禁 test_ 前缀） |

- **【绝对红线·禁止黑名单】**：全域测试文件名（含符号与路径）**严禁包含任何施工批次与临时性标记**，禁止词：`p[0-9]+`（如 `p82`）、`phase[0-9]+`、`st[0-9]+`、`fe[0-9]+`（除 `fe_01`~`fe_17` 视图外）、`temp`、`new`、`v[0-9]+`、`wip`。
- **护栏单源演进**：护栏套件为长效全域资产，**严禁随案卷分裂新护栏文件**，新增断言必须归并演进至既有同域护栏（如前端断言全量归并收敛至 `test_frontend_boundary_guard.gd`）。
- **统一测试底座与登记**：统一继承 `tests/support/test_case.gd` (`TestCase`)；强类型断言与 `pack_results` 打包；新增领域测试在 `domains.json` 与 `test_registry.gd` 双向对齐，架构护栏零差集看守。

## 四、 命名格式与 Agent 行为边界

### 1. 命名与格式规范
- 分支 `<type>/<scope>-简述`；提交 `<type>(<scope>): 简述`（feat/fix/refactor/docs/test/chore/style）+ 中文正文引需求ID；
- 文件 `kebab-case`，类 `PascalCase`，常量 `UPPER_SNAKE_CASE`；TS 4 空格，其余 2 空格；`ps1 CRLF`，`sh/gd/md/json LF`；
- WebGames 命名豁免：`config/**/*.json` 与 `.gd` 保持 `snake_case`（对齐领域 id 与 Godot 惯例）。

### 2. Agent 活动范围与禁止（硬性红线）
- **范围与必做**：默认单项目；改前 `audit-docs.sh --json` + 通读 SOP；改中可修复项走 `--fix`；改后 `audit-all.sh` 20 项门禁全绿且 `audit-docs --baseline` 0 新增；
- **绝对禁止清单**：
  1. 路径违规：绝对路径/盘符/`file:///`；重命名/删档不同步全库入链；改基线消音新增违规；
  2. 规范放宽：放宽 `NAMING_RULES`/注释门禁；臆造与需求表冲突字段；通读 87KB 总目录（用 `--manifest`/glob/头20行）；无差别通读全量模板（须按区间切片阅读）；
  3. 交付违规：留存 `<...>` 占位符与未决标记；跳号/重号/越序添加任务；未获批准提前在路线图标记完成；仅跑通局部单测的最小 MVP 敷衍实现；
  4. 目录与案卷：案卷目录下自造非细则文件（严格仅 4 份细则）；向 `01_短期施工区/README.md` 写入在途任务；
  5. 测试违规：`tests/unit/` 根散落脚本；自造与 `domains.json` 不一致的别名；测试名含施工批次黑话（`pXX`/`phaseXX`）；随案卷分裂创建新护栏；数据工厂以 `test_` 前缀命名。

## 五、 维护规则

本文件为指针索引；项目结构/命令/边界/约定变更时同次提交同步更新，详情以各项目真源文档为准。
