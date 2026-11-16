# 施工细则：MOD开发者体验优化与Tier3运行时差分加载及文档客观化体系改造 —— 阶段3：SDK文档对齐与源码文档系统性客观重构工程规范

> 施工开始日期: 2026-11-14（半夜）
> 状态: 已验收 (Phase 129 Completed)

> [!NOTE]
> 【施工目标】
> 对 `WebGames/mod_sdk/` 全套文档、`WebGames/docs/源码文档/` 全量 91 份技术手册及 `WebGames/README.md` 实施系统性更新与客观化表述重构：同步 CLI 参数与 `assets/manifest.json` 真实契约，补齐遗漏的新增与存量 `.gd` 脚本索引与文件/行数核实计数，清除绝对本地 URI 链接与主观修饰/内部术语黑话，并准确标注运行时已实现边界与离线/契约预留边界。

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- SDK 主文档体系：[`mod_sdk/README.md`](../../../../mod_sdk/README.md) · [`MOD_SPEC.md`](../../../../mod_sdk/MOD_SPEC.md) · [`SPECIFICATION.md`](../../../../mod_sdk/docs/SPECIFICATION.md) · [`AGENT_INTERACTION.md`](../../../../mod_sdk/docs/AGENT_INTERACTION.md) · [`ART_AND_ASSETS_GUIDE.md`](../../../../mod_sdk/docs/ART_AND_ASSETS_GUIDE.md) · [`TOTAL_CONVERSION_SPEC.md`](../../../../mod_sdk/docs/TOTAL_CONVERSION_SPEC.md) · [`COMPANION_PROTOCOL.md`](../../../../mod_sdk/docs/COMPANION_PROTOCOL.md) · [`mod_sdk/examples/README.md`](../../../../mod_sdk/examples/README.md)
- 项目主说明与架构统计门禁：[`WebGames/README.md`](../../../../README.md) · [`TestArchitectureGuardDomain`](../../../../tests/guards/test_architecture_guard.gd)
- 源码技术手册目录体系：[`源码文档 README`](../../../源码文档/README.md)
- 文档治理审计脚本：[`audit_docs.py`](../../../../scripts/py/audit_docs.py) · [`audit_sdk_sync.py`](../../../../scripts/py/audit_sdk_sync.py)

### 1.2 核心不变量约束断言

- **事实依据与客观表述不变量 (Inv-DOC-OBJECTIVE-PROSE-1)**：文档中的一切模块数量、文件数量、代码行数、命令参数、JSON 字段名与运行时行为描述，必须全部源自当前磁盘实际文件与工具输出统计；全面移除「坚不可摧」「100% 绝对」「彻底杜绝」「高纯度」「完美」等宣传/绝对化措辞，并替换「洗脱」「数据桩」「水化」「脱水」「回灌」「双轨」「防伪」「施工案卷」等内部过程黑话为标准工程术语（如「会话状态重置」「测试替身/模拟适配器」「快照填充/水合替换」「配置双路径读取」「校验拦截」）。
- **实现边界透明不变量 (Inv-DOC-BOUNDARY-CLARITY-2)**：在 `mod_sdk/` 与 `docs/源码文档/` 中明确区分三个实现层级：
  1. `Godot 运行时已执行`（如 `GameConfig` Overlay 差分覆盖、Tier 1~3 `content/` 已支持节段、8 信道事件、`WorldSessionRuntimeService`）；
  2. `SDK CLI / Schema 静态校验层支持`（如 `pack.schema.json` 全量扩展属性、`cutscene_manifest.schema.json`）；
  3. `契约预留 / 待视图接线`（如 `frontend/views/**` 部分页面与扩展 `k_workbench` 高级功能）。
- **链接与架构计数锚点不变量 (Inv-DOC-LINK-ARCH-LOCK-3)**：清除 `mod_sdk/examples/README.md` 等文件中的本地文件协议 URI 绝对路径，统一使用合法相对链接；更新 `WebGames/README.md` 时严格保留 `TC-ARCH-05` 正则校验所需的领域计数标记（当前 `config/infrastructure/domains.json` 登记数 `47`）；严禁修改 `WebGames/docs/归档库/**`。

### 1.3 工程化重构最高指示

文档更新必须以阶段2落盘后的真实代码清单与目录树为准进行自动化统计核对，禁止凭历史印象估算文件数或行数；Mermaid 图中含 `[]{}()` 或斜杠 `/` 的节点标签必须用双引号 `""` 包裹。

---

## 一、 三大文档域系统性客观重写清单

### 1.1 Domain A：`WebGames/mod_sdk/` 开发者文档体系对齐

| 目标文档 | 具体缺陷与修正项 | 客观化改写要求 |
| :--- | :--- | :--- |
| `mod_sdk/README.md` | 1) `--tier TIER_1_LOGIC` 更正为 `--tier {1,2,3}`（与 `kalar_mod.py` 一致）；<br/>2) `--multi-dirs` 更正为 `--check-multi`；<br/>3) `preview` 示例 `--player-name`/`--race-id` 更正为 `--name`/`--race`；<br/>4) 补充 `dispatch` 与 `bake` 子命令说明。 | 移除「坚不可摧」「100% 绝对同步」「水化」等表述；增加清晰的「Tier 1 / Tier 2 / Tier 3 运行时支持矩阵」表。 |
| `mod_sdk/MOD_SPEC.md` | 核对 `mods/<pack_id>` 与 `mods/narratives/<pack_id>` 双扫描形态、Tier 3 `content/` 实际生效节段、`override_mode` 支持值（含 `MERGE`/`REPLACE_ENTRY`/`TOTAL_PURGE` 及其兼容别名）。 | 清除「100% 绝对」「双轨」「水化」，准确写出 `ModPackageDiscoverySolver` 与 `Tier3ContentOverrideLoader` 的真实加载顺序与回退行为。 |
| `mod_sdk/docs/SPECIFICATION.md` | 将根目录 `assets_manifest.json` 旧写法对齐为 `assets/manifest.json`；同步新增的 `GameConfig` Overlay 与 `ModManifestValidator` 结构化 `diagnostics` 字段示例。 | 精确区分运行时已接管节段与仅静态校验字段，补充 `field_path`/`fix_suggestion` 故障排查指引。 |
| `mod_sdk/docs/ART_AND_ASSETS_GUIDE.md` | 更新 `assets/manifest.json` 路径；将过时/与 `cook_assets.py` `ASSET_WHITELIST` 冲突的 `.ogv`/`.webm`/`.mp4` 视频直放声明修改为与阶段2代码裁决一致的准确说明，解释 `.import`/`.uid` 忽略机制。 | 删除「高纯度」「双轨」等非客观修饰。 |
| `mod_sdk/docs/AGENT_INTERACTION.md` · `TOTAL_CONVERSION_SPEC.md` · `COMPANION_PROTOCOL.md` | 核对 8 大/全量协议动作与 Schema 映射表；修正 `Total Conversion` 示例中实际被 `Tier3ContentOverrideLoader` 读取的 `items/`、`rules/`、`world/`、`skills/` 结构与保留字段。 | 删除「彻底杜绝」「水化」「双轨」；给出可复现的命令行操作示例。 |
| `mod_sdk/examples/README.md` | 移除所有非法本地文件协议 URI 绝对路径改为标准相对链接；按真实磁盘目录重写 `custom_hud_theme/` 文件清单与可运行验证命令。 | 确保全文 100% 相对路径可跳转且零坏链。 |

### 1.2 Domain B：`WebGames/docs/源码文档/` 全量 91 份文件同步与客观化

1. **真实代码库规模重新盘点（在阶段2代码落地后执行全目录脚本核实并写回）**：
   - 基础设施 (`backend/infrastructure/`)：`72` `.gd`（含 `game_config_loader.gd`、媒体/日志/资源治理细分脚本）；
   - 业务领域 (`backend/domains/`)：`50` 个子目录（3 个基础设施豁免目录 + 47 个 `domains.json` 正式业务域），全部 `.gd` 文件精确数（基线 `369` + 阶段2新增 `tier3_content_override_loader.gd` = `370`）；
   - 前端表现层 (`frontend/`)：`141` `.gd`（含 `frontend/domain_boundary/` 真实 `62` `.gd`、完整 i18n 模块）+ `18` `.tscn`；
   - 测试与配置与脚本 (`tests/`、`config/`、`scripts/`、`dev_harness/`、`benchmarks/`)：精确统计 `.gd` 数、注册表套件数、`config/*.json` 表数及非缓存/非 `node_modules` 脚本数。
2. **遗漏文件索引补齐（77+ 个原未收录脚本 + 阶段2新增脚本）**：
   - `01_后端基础设施/`：补充 `game_config_loader.gd` 及未索引的资源/日志/协议子模块；
   - `03_后端业务领域/`：补充 `character_creation/` (4 个脚本)、`narrative_orchestration/tier3_content_override_loader.gd`、`world_state/dto/` (18 个 DTO) 与 `services/`/`solvers/` (4+ 个脚本)、以及其余业务域中缺失登记的 DTO/Solver/Helper；
   - `04_前端表现层/`：全面修正 `02_领域边界与协议容器.md` 的文件列表与真实 LOC 统计，补录 `frontend/domain_boundary/interfaces/`、`services/`、`mocks/` 与 `frontend/i18n/` 全量文件；
   - `06_开发工具与模组SDK/`：同步阶段2后的 CLI、模板校验与 Tier 3 差分加载架构说明。
3. **术语与主观表述全域清洗**：
   - 按自动化正则检索清理全部 22+ 个命中文件中的「洗脱」「数据桩」「水化」「脱水」「回灌」「双轨」「防伪」「坚不可摧」「100% 绝对」「彻底杜绝」「施工案卷」等用语，改写为准确客观的架构职责说明。

### 1.3 Domain C：`WebGames/README.md` 更新与护栏兼容

- 依据阶段2及阶段3统计后的真实目录与文件计数，客观重写 `WebGames/README.md` 中的仓库结构概览、MOD 快速上手命令与架构分层状态（保留 `TC-ARCH-05` 正则必需匹配的 `47 个领域` 计数标注），删除残留开发期行话与过时数据。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 运行磁盘静态统计脚本获取阶段2落地后 `backend/`、`frontend/`、`tests/`、`config/`、`mod_sdk/`、`scripts/` 的精确文件数、行数与未收录 `.gd` 清单。
- [x] Step 3.2: 对照阶段2落地 CLI 与源码，完成 `WebGames/mod_sdk/` 下 8 份主/副文档与 `examples/README.md` 的参数对齐、相对链接修复与客观化重写。
- [x] Step 3.3: 系统更新 `WebGames/docs/源码文档/` 下受影响的目录索引（`00_~06_`），补齐全部遗漏 `.gd` 脚本并统一清洗主观形容词与内部黑话。
- [x] Step 3.4: 客观更新 `WebGames/README.md` 并核查 `TC-ARCH-05` 领域计数锚点与 `docs/归档库/**` 零改动。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P129-0301** | CLI 文档与源码参数 1:1 对齐 | 比对 `mod_sdk/README.md` 全文示例命令与 `kalar_mod.py` `argparse` 定义 | 所有示例命令可直接在无参数错误下执行或通过 `--help` 核验 |
| **DOD-P129-0302** | 源码文档统计数与文件覆盖率 | 扫描 `backend/` 与 `frontend/` 全量 `.gd` 在 `docs/源码文档/` 中的检索覆盖情况 | 原遗漏的 77 个脚本及新增脚本 100% 编入对应手册，计数误差为 0 |
| **DOD-P129-0303** | 主观词汇、黑话与非法路径零残留 | 对 `mod_sdk/**/*.md`、`docs/源码文档/**/*.md`、`WebGames/README.md` 执行正则扫描 | 零本地文件协议 URI 路径、零黑话/宣传词清单命中（合法代码标识符除外） |
| **DOD-P129-0304** | 全量文档治理审计通过 | 运行 `python WebGames/scripts/py/audit_docs.py --baseline WebGames/benchmarks/reports/docs_baseline.json` | 零错误、零警告、零新增违规 |
