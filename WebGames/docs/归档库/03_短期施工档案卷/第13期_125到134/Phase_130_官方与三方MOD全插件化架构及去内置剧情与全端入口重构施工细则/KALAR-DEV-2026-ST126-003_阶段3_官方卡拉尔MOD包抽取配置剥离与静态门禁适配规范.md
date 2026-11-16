---
档号: KALAR-DEV-2026-ST126-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST126 (Phase_130_官方与三方MOD全插件化架构及去内置剧情与全端入口重构施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_130_官方与三方MOD全插件化架构及去内置剧情与全端入口重构施工细则 —— 阶段3：官方卡拉尔MOD包抽取配置剥离与静态门禁适配规范
形成日期: 2026-11-14
归档日期: 2026-11-15（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 官方插件包物理目录拓扑; domains.json
---

# 施工细则：官方与三方MOD全插件化架构及去内置剧情与全端入口重构 —— 阶段3：官方卡拉尔MOD包抽取配置剥离与静态门禁适配规范

> 施工开始日期: 2026-11-14
> 状态: 已验收 (Phase 130 Completed)

> [!NOTE]
> **【施工目标】** 本阶段定义如何将 `WebGames/config/` 全量 131 份配置文件中属于卡拉尔世界观、种族、出身、开局道具、任务、NPC/怪物、过场影片、事件概率与前后端展示占位的故事资产完整抽取至单一官方插件包 `WebGames/mods/official_kalar/`，将 `WebGames/config/` 剥离净化为纯通用引擎配置，并同步重构 `mod_sdk/` 工具链与 Python/GDScript 静态守卫实现双端（纯引擎 + 官方包组合）静态闭合验证。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST126-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST126-001_阶段1_插件化官方MOD契约架构与引擎边界重构规范.md) ｜ [阶段2](KALAR-DEV-2026-ST126-002_阶段2_组合式MOD运行时引擎与统一DAG序章及全端视图实现规范.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST126-004_阶段4_全量测试夹具重构无头验证与全栈门禁回归验收规范.md)

---

## 📌 第一性原理溯源指针

### 1.1 精准上游规范指针

- 上游设计阶段: [阶段1_插件化官方MOD契约架构与引擎边界重构规范.md](KALAR-DEV-2026-ST126-001_阶段1_插件化官方MOD契约架构与引擎边界重构规范.md) · [阶段2_组合式MOD运行时引擎与统一DAG序章及全端视图实现规范.md](KALAR-DEV-2026-ST126-002_阶段2_组合式MOD运行时引擎与统一DAG序章及全端视图实现规范.md)
- 配置目录与基础设施真源: [domains.json](../../../../../config/infrastructure/domains.json) · [character_creation/core.json](../../../../../config/domains/character_creation/core.json) · [starter_loadout/core.json](../../../../../config/domains/starter_loadout/core.json) · [items/core.json](../../../../../config/items/core.json) · [world/core.json](../../../../../config/domains/world/core.json) · [quest/core.json](../../../../../config/domains/quest/core.json)
- SDK 与校验工具真源: [mod_sdk_shared.py](../../../../../scripts/py/lib/mod_sdk_shared.py) · [audit_sdk_rules.py](../../../../../scripts/py/lib/audit_sdk_rules.py) · [check_mod.py](../../../../../mod_sdk/tools/check_mod.py) · [check_mod_common.py](../../../../../mod_sdk/tools/check_mod_common.py) · [check_mod_destiny.py](../../../../../mod_sdk/tools/check_mod_destiny.py) · [play_mod_character.py](../../../../../mod_sdk/tools/play_mod_character.py)
- 静态守卫真源: [audit_arch_static.py](../../../../../scripts/py/audit_arch_static.py) · [audit_config.py](../../../../../scripts/py/audit_config.py) · [audit_sdk_sync.py](../../../../../scripts/py/audit_sdk_sync.py) · [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd) · [test_configuration_guard.gd](../../../../../tests/guards/test_configuration_guard.gd) · [test_frontend_boundary_guard.gd](../../../../../tests/guards/test_frontend_boundary_guard.gd)

### 1.2 核心不变量约束断言

1. **单一官方基座物理完备性 (A1 对齐)**: `WebGames/mods/official_kalar/` 必须作为完备独立的官方插件包存在，自身通过 `kalar_mod.py check mods/official_kalar` 与新增全部 Schema 校验，不依赖 `WebGames/config/` 中残留的任何卡拉尔剧情键。
2. **引擎配置零故事泄漏不变量**: 阶段 3 剥离完成后的 `WebGames/config/`（131 份配置清理重整后）中不得出现卡拉尔世界专有名词、人物演示名（`阿尔托莉雅`、`梅莉尔`、`老剑客艾尔顿`、`瓦兰`）、剧情地标（`CENTRAL_CITY_PLAZA`、`VALAN_OUTPOST`、`TOWN_VALAN`）、官方道具条目（`KALAR:EQUIP:...`、`MITHRIL_LONGSWORD`）或官方默认种族/出身字典。
3. **工具链单真源与守卫无虚弱不变量**: 禁止通过禁用或跳过静态守卫脚本来掩盖配置剥离造成的断链；所有静态检查器（`audit_config`、`audit_arch_static`、`audit_sdk_sync`、`audit_event_probability`、`audit_copywriting`、`audit_item_keys`、`audit_cdc`、`audit_name_keys`、`audit_magic_dimensions`）必须重构为面向“纯引擎 Schema + 组合检验 `official_kalar`”的真实检查，保持零降级门禁强度。

### 1.3 工程化重构防漂移最高指示

- **剥离不等于盲删**: 每个被抽取至 `mods/official_kalar/` 的配置项，引擎侧都必须先验证在阶段 2 已具备纯代码层缺省保护或显式错误返回，并保留引擎必须的结构空框架或 Schema 规则键。
- **双语键与资产镜像一致性**: 迁移至 `official_kalar/i18n/` 与 `official_kalar/cutscenes/` 的所有文案键、占位符和媒体 URI（如 `mod://official_kalar/assets/...`）需与运行时占位符解析器一一映射闭环。

---

## 一、 `WebGames/mods/official_kalar/` 官方包结构设计与全资产抽取

### 1.1 官方插件包物理目录拓扑

```text
WebGames/mods/official_kalar/
  pack.json                         # pack_id: "official_kalar", pack_profile: "OFFICIAL_BASE", is_official: true, trust_tier: "OFFICIAL", content_sha256
  destinies.json                    # custom_races (HUMAN/ELF/MOUNTAIN_DWARF/TIEFLING_OR_HUMAN), custom_origins, custom_traits, paired_presets, custom_starter_kits, ui_capabilities
  routing_rules.json                # 出身/种族 -> DAG_PROLOGUE_HUMAN_CAPITAL / DAG_PROLOGUE_ELF_SANCTUARY 路由矩阵
  dag_graphs/
    dag_prologue_human_capital.json
    dag_prologue_elf_sanctuary.json
  cutscenes/
    cutscene_registry.json          # cs_prologue_awakening, cs_chapter1_climax
    cutscene_hooks.json             # hook_prologue_awakening_pre, hook_chapter1_climax_post
  i18n/
    zh_CN.json                      # 序章全部剧情文本、地点/道具/NPC名、官方世界 UI/演示文案键值
    en_US.json                      # 对应英文键值对齐
  content/
    items/kalar_items.json          # 原 config/items/core.json 全量 11 个 KALAR:* 原型 + magic/quality 内容数据
    skills/kalar_skills.json        # 卡拉尔职业技能卡与默认动作集覆盖
    rules/kalar_creation_world.json # 寿命系数、初始阵营声望、CDKEY 与 GM 创世示例规则
    world/kalar_world_topology.json # CENTRAL_CONTINENT、TOWN_VALAN、WORLD_DEFAULT_SP_01 等大区/城镇/地标与默认世界目录
    entities/kalar_entities.json    # NPC("老剑客艾尔顿")、怪物("双足飞龙")、世界Boss("灭烬巨龙")、精英词缀池
    quests/kalar_quests.json        # "净化古老遗迹" 悬赏/主线任务模板与声望奖惩
    events/kalar_events.json        # EVT_BEAST_TIDE、EVT_MARKET_CRASH、卡池祈愿 BANNER_LEGENDARY_HERO
    narratives/kalar_narratives.json# 原 narratives/ 中的剧情向、物种向及卡拉尔世界提示文本覆盖
    copywriting/kalar_copy.json     # 原 copywriting/{item,narrative,probability}.json 全量条目
  assets/                           # 从 res://assets/ 迁移归属官方故事媒体的过场动画与剧情资源，统一以 mod://official_kalar/assets/... 寻址
```

### 1.2 全量 131 份 `WebGames/config/` JSON 剥离分级矩阵

| 目录分类 | 文件总数 | 保留纯引擎部分 (`config/`) | 拆分/清洗为抽象规则或空模板 (`config/`) | 完整迁出至 `mods/official_kalar/` |
| :--- | :---: | :--- | :--- | :--- |
| `infrastructure/` | 18 | **15 份纯引擎契约** (`clock`, `contracts`, `contract_completeness_baseline`, `domains`, `errors_catalog`, `event_bus_config`, `event_categories`, `lifecycle`, `log`, `object_pool`, `persistence`, `release_policy`, `resource_catalog`, `storage`, `version_manifest`) | **1 份混合拆分**：`admin.json`（保留安全/审计/幂等策略；剥离 `"【GM创世神器】"` 与卡拉尔默认盐值标记） | **2 份全量迁出**：`cutscene_registry.json`、`cutscene_hooks.json`（`config/` 仅保留空模板或交由 MOD 覆盖注入） |
| `narratives/` | 49 | **26 份纯系统运维/错误模板**（如 `errors.json` 72键、`admin.json`、`clock.json`、`persistence.json`、`spatial_movement.json` 等）+ **5 份占位注释文件** | **16 份去剧情中性化**：`quest.json`、`npc.json`、`world_gateway.json`、`world_state.json` 及 12 份含世界观字面/示例物品词条文件移除卡拉尔字样，改为纯参数化引擎系统回执模板 | **2 份全量迁出**：`prologue_dag_catalog.json`、`prologue_i18n.json`（`config/` 移除故事内容或置空契约） |
| `domains/` | 54 | ~**40 份纯算法/公式/机制域配置**（如 `combat/damage_formulas`, `potential`, `currency` 汇率机制等） | **13 份混合拆分**：`character_creation/core.json`（仅留姓名规则、属性点数分配与字段骨架）、`starter_loadout/core.json`（仅留结构与空池）、`world/core.json`（仅留 A*/行军/连续性公式与物理阻抗）、`quest/core.json`（留图校验/悬赏阈值）、`attribute`、`sovereignty`、`npc`、`monster`、`world_boss`、`elite`、`gacha`、`world_gateway`（仅留模式政策与探测规则，清出 `WORLD_DEFAULT_SP_01`）、`chat_command`、`equipment`、`lattice` | **1 份全量迁出**：`event_probability/core.json`（`EVT_BEAST_TIDE` 等完整战役概率事件图）；其余 13 份中所有卡拉尔世界名称/NPC/道具/祈愿/CDKEY全量迁出 |
| `items/` | 1 | — | `items/core.json` 清空为 `{"items": []}` 引擎空原型壳 | 原 11 个 `KALAR:*` 道具原型完整迁入 `content/items/kalar_items.json` |
| `copywriting/` | 4 | **1 份保留**：`bulletin.json`（系统维护公告 ops 模板） | — | **3 份全量迁出**：`item.json`、`narrative.json`、`probability.json` |
| `frontend/` & `i18n/` | 5 | `frontend/views.json`（仅视图路由路径，扩展新增 3 视图）、`frontend/views/hud_event_bridge.json` | `frontend/ui.json`（`service_mode = "real"`，清理 `阿尔托莉雅`/`ENEMY_ORC_01`/`TOWN_ROCK`/卡拉尔标题）、`i18n/{zh_CN,en_US}.json`（清出 `ui.fe*.mock.*` 与卡拉尔世界观词条，保留引擎通用 UI 键） | 所有卡拉尔专有 UI 文案与官方世界文本迁入 `official_kalar/i18n/*.json` |

---

## 二、 `mod_sdk/` Schema 新增、工具链改造与文档同步

1. **新增 9 份 `.schema.json` 与 `pack`/`destinies` 扩展**:
   - 在 `WebGames/mod_sdk/schemas/` 新增 `quests.schema.json`、`entities.schema.json`、`world_topology.schema.json`、`event_probability.schema.json`、`races_catalog.schema.json`、`narratives_overlay.schema.json`、`copywriting_overlay.schema.json`、`routing_rules.schema.json`、`realm_mod_manifest.schema.json`。
   - 更新 `pack.schema.json` 与 `destinies.schema.json`，区分 `CONTENT_ADDON`（维持金/属性/物品上限）与 `OFFICIAL_BASE` / `TOTAL_CONVERSION`（解除外挂限额，强制内容完整性和 `content_sha256` 摘要检验）。
2. **`mod_sdk_shared.py` 与 `capabilities.json` 去硬编码重构**:
   - 更新 [mod_sdk_shared.py](../../../../../scripts/py/lib/mod_sdk_shared.py)：不再直接从 `WebGames/config/domains/character_creation/core.json`、`starter_loadout/core.json`、`items/core.json`、`narratives/prologue_*.json` 硬读取卡拉尔实体；拆分为从纯引擎配置读取抽象属性/节点枚举能力 + 从指定官方包根 `mods/official_kalar/` 提取官方预设示例供 `capabilities.json` 与 `audit_sdk_sync.py` 对齐。
3. **`check_mod*.py` 与 `play_mod_character.py` 升级**:
   - [check_mod.py](../../../../../mod_sdk/tools/check_mod.py)：为 `content/{items,skills,rules,world,entities,quests,events,narratives,copywriting}/*.json` 与 `routing_rules.json` 接入完整 JSON Schema 校验；按 `has_prologue_dag` 控制 `dag_graphs/` 强校验。
   - [check_mod_common.py](../../../../../mod_sdk/tools/check_mod_common.py) & [check_mod_destiny.py](../../../../../mod_sdk/tools/check_mod_destiny.py) & [play_mod_character.py](../../../../../mod_sdk/tools/play_mod_character.py)：清除硬编码 `BUILTIN_ORIGINS` / `BUILTIN_TRAITS` / `DEFAULT_BUILTIN_*` 卡拉尔 fallback，改为动态加载传入的 `--base-mod`（默认探寻 `mods/official_kalar`）或显式声明无基座组合边界；支持按 `pack_profile` 执行差异化数值门禁。
   - [kalar_protocol_client.py](../../../../../mod_sdk/tools/kalar_protocol_client.py)：参数化 `"VALAN_SANCTUARY"` / `"QUEST_PROLOGUE_WAKE"` 默认测试串，从挂载 MOD 参数或 CLI 参数读取。
4. **SDK 文档客观对齐**: 更新 `WebGames/mod_sdk/docs/SPECIFICATION.md`、`TOTAL_CONVERSION_SPEC.md`、`MOD_SPEC.md`，废弃 `res://config/narratives/packs/` 优先根与“Vanilla Fallback 到 `config/`”的过期描述，如实记录“纯引擎底座 + `official_kalar` 官方插件包 + `user://mods/` 叠层顺序”。

---

## 三、 Python 与 GDScript 静态门禁适配器改造规范

| 检查脚本 / 守卫 | 当前阻塞点 | 阶段 3 改造方案（保持门禁零降级） |
| :--- | :--- | :--- |
| [audit_arch_static.py](../../../../../scripts/py/audit_arch_static.py) (`TC-ARCH-02/06/09`) & [test_architecture_guard.gd](../../../../../tests/guards/test_architecture_guard.gd) | 强制 `domains.json` 所有 47 域均须存在 `config/narratives/<name>.json` 实体与静态字面量命中；`TC-ARCH-09` 强校 `errors.json` | 读取 `domains.json` 新增 `narrative_scope`：`"engine_system"` 域继续由 `config/narratives/` 强校验闭合；`"mod_content"` 域改为面向 `Composed(config + official_kalar)` 双根校验字面键存在性，同时在 `config/` 独立启动校验中豁免 `mod_content` 叙事内容条目 |
| [audit_config.py](../../../../../scripts/py/audit_config.py) & [test_configuration_guard.gd](../../../../../tests/guards/test_configuration_guard.gd) (`TC-CFG-01..06`) | 强断言 `_required_tables`（70 表）全满及具体卡拉尔默认数值；`value_domain_rules.json` 直扫 `config/` 完整世界包数据 | 对 `TC-CFG-01..06` 及 `audit_config.py` 进行双态验证：(1) Pure Engine 模式下校验精简后的基础设施与公式契约表闭环；(2) Mounted Official Base 模式下挂载 `mods/official_kalar/` 后执行全量值域校验与 `domains.*` 全键检查 |
| `audit_event_probability.py`、`audit_copywriting.py`、`audit_item_keys.py`、`audit_cdc.py`、`audit_name_keys.py`、`audit_magic_dimensions.py` | 强制要求 `config/copywriting/`、`config/domains/event_probability/`、`config/items/core.json`、`config/i18n/` 在 `WebGames/config/` 内保有完整故事负载 | 适配通用“内容包联合扫描根解析器”（Engine `config/` + `mods/official_kalar/`）：若内容已迁至官方包则联合扫描覆盖层中的文案、概率事件、`KALAR:*` 道具引用、魔导维度与 i18n 双语对齐，既消除误报又继续拦截真正断链 |
| [test_frontend_boundary_guard.gd](../../../../../tests/guards/test_frontend_boundary_guard.gd) | 仅维护 8 项 `CONFIG_SEMANTIC_WHITELIST` 并断言 `MockDataCatalog` 存在卡拉尔角色/经济示例键 | 为新增或重构视图合法配额更新 `CONFIG_SEMANTIC_WHITELIST`；彻底解除对 `MockDataCatalog` 卡拉尔角色/地标数据键的断言绑定；增加守卫断言验证 `ui.json` 默认 `service_mode == "real"` 且新视图（`world_gateway`/`mod_workbench`/`prologue`）100% 遵守 17 项 FE 边界规范 |

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 创建 `WebGames/mods/official_kalar/` 官方基础插件包全套目录与 `pack.json`（生成规范化 SHA-256 摘要）、`destinies.json`、`routing_rules.json`、`dag_graphs/`、`cutscenes/`、`i18n/`、`content/**` 及 `assets/`。
- [x] Step 3.2: 按 131 份文件分级表逐一清洗与剥离 `WebGames/config/{infrastructure,narratives,domains,items,copywriting,frontend,i18n}/`，确保 `WebGames/config/` 与 `WebGames/backend/`、`WebGames/frontend/` 中零卡拉尔故事硬编码残留。
- [x] Step 3.3: 在 `WebGames/mod_sdk/schemas/` 落地 9 份新 Schema 及 `pack`/`destinies` 扩展；升级 `mod_sdk_shared.py`、`check_mod*.py`、`play_mod_character.py`、`kalar_protocol_client.py`、`audit_sdk_sync.py`、`audit_sdk_rules.py` 与 `mod_sdk/docs/*.md`。
- [x] Step 3.4: 适配 `audit_arch_static.py`、`audit_config.py`、`audit_{event_probability,copywriting,item_keys,cdc,name_keys,magic_dimensions,event_channels}.py`、`test_architecture_guard.gd`、`test_configuration_guard.gd` 与 `test_frontend_boundary_guard.gd` 为“Engine Base + `official_kalar`”联合静态闭包校验。

---

## 三、 阶段验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| **DOD-P130-0301** | 官方插件包自检与完整 Schema 合规 | 运行 `python WebGames/mod_sdk/tools/kalar_mod.py check WebGames/mods/official_kalar` | 零 ERROR、19+9 份 Schema 与 DAG/Destinies/Items/Entities/Quests 全项通过 |
| **DOD-P130-0302** | `WebGames/config/` 与源码卡拉尔净空校验 | 对 `WebGames/config/`、`backend/`、`frontend/` 扫描卡拉尔专有名词/硬编码默认值 | 零卡拉尔默认角色/地标/装备/剧情文案残留（除合法注释或测试夹具显式引用 `official_kalar`） |
| **DOD-P130-0303** | SDK 能力真源同步校验 | 运行 `python WebGames/scripts/py/audit_sdk_sync.py` 与 `audit_sdk_rules.py` | 零 `SDK-CONTRACT-DRIFT`；官方基座与外挂配额规则校验精确区分 |
| **DOD-P130-0304** | 全量 Python 与 GDScript 静态门禁 | 运行 `python WebGames/scripts/py/audit_runner.py` 与 4 套 `tests/guards/` 用例 | 所有静态架构/配置/文案/道具/命名/前端边界守卫全绿，无门禁削弱或豁免绕过 |
