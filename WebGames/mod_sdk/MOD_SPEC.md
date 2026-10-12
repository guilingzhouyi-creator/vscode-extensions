# 卡拉尔世界引擎 · 剧情与命途 MOD 创作者开发契约规范 (MOD Spec v1.1)

> [!NOTE]
> **【规范定位】**：本规范是面向 MOD 创作者 Agent 与人类开发者的“一页纸极简开发指南”。所有能力清单均由底层单一真源自动化萃取同步，确保 MOD 契约与引擎运行时保持 100% 绝对一致。
> **引擎接口版本**：`1.0.0`

---

## 一、 扩展包目录结构规范 (Package Layout)

每个剧情与命途 MOD 扩展包物理上为一个独立目录（支持存放在 `mods/narratives/<mod_dir>/` 或 `user://mods/narratives/<mod_dir>/`），标准布局如下：

```text
my_narrative_mod/
├── pack.json                   # 【必需】MOD 清单元数据描述文件
├── routing_rules.json          # 【必需】创角种族与出身到序章 DAG 的路由规则
├── destinies.json              # 【可选/推荐】自定义身世、因果天赋、初始行囊与 UI 解锁策略
├── dag_graphs/                 # 【必需】剧情有向无环图配置目录
│   └── DAG_MY_PROLOGUE.json    # DAG 剧情图拓扑结构
├── i18n/                       # 【必需】剧情本地化文案字典
│   └── zh-CN.json              # 包含占位符的剧情文本
└── assets/                     # 【可选】美术与音效资源（如有）
```

---

## 二、 MOD 清单元数据契约 (`pack.json`)

`pack.json` 描述 MOD 的基础身份与依赖拓扑，反序列化严格对齐 `NarrativePackManifestDTO`：

| 字段名称 | 类型 | 必需 | 默认值 | 约束说明与语义 |
| :--- | :---: | :---: | :--- | :--- |
| `pack_id` | String | 是 | - | 唯一标识符，全小写字母、数字与下划线（如 `mod_valan_origins`） |
| `pack_name` | String | 是 | - | 人类可读显示名称（如 `瓦兰边境起源包`） |
| `version` | String | 是 | - | 语义化版本号（如 `1.0.0`） |
| `author` | String | 否 | `"Unknown"` | 作者或制作组署名 |
| `engine_api_version` | String | 是 | `"1.0.0"` | 兼容的目标引擎 API 版本 |
| `priority` | int | 否 | `100` | 同拓扑层级内的加载优先级（数值越大越优先装配） |
| `dependencies` | Array[String] | 否 | `[]` | 必须前置加载的 MOD `pack_id` 列表 |
| `incompatible_packs` | Array[String] | 否 | `[]` | 互斥冲突 MOD 标识符黑名单 |
| `semantic_tags` | Array[String] | 否 | `[]` | 语义标签（如 `["prologue", "dark_fantasy"]`） |
| `is_active` | bool | 否 | `true` | 是否激活启用状态 |

---

## 三、 引擎能力真源契约 (Engine Capabilities)

<!-- AUTOGEN_CAPABILITIES_START -->
> [!IMPORTANT]
> **【引擎权威能力清单】**：当前兼容引擎 API 版本: `1.0.0`。本节由 `sync_mod_sdk.py` 静态萃取维护，禁止手动篡改。

### 1. 启用的种族清单 (Supported Races)

MOD 创作者角色与序章节点路由仅允许绑定下列已启用种族：

| 种族标识符 (Race ID) | 状态 | 规范语义 |
| :--- | :---: | :--- |
| `HUMAN` | 启用 (Active) | 卡拉尔世界核心创角与剧情支持种族 |

### 2. 合法 DAG 节点类型 (Valid DAG Node Types)

剧情图由下列四类节点拓扑连接，严禁使用非声明节点类型：

| 节点类型枚举 | 拓扑约束 | 语义与职责 |
| :--- | :--- | :--- |
| `START_ENTRY` | 入度必须为 0，单图仅允许 1 个 | 序章剧情唯一的起始入口节点 |
| `STANDARD_STEP` | 入度 >= 1，出度 >= 1 | 标准顺序执行剧情推进步骤 |
| `BRANCH_CHOICE` | 入度 >= 1，出度 >= 2 | 具有多分支交互选择或因果分流节点 |
| `TERMINAL_EXIT` | 出度必须为 0，允许触发完成突变 | 剧情图唯一的终结退出节点 |

### 3. 合法文本占位符字典 (Available Placeholders)

本地化文案模板（i18n）中支持插值的动态占位符全集：

| 占位符宏 (Placeholder) | 解析源与说明 |
| :--- | :--- |
| `{PLAYER_NAME}` | 当前玩家角色的自定义名称 |
| `{RACE_ID}` | 角色所属种族唯一标识符（如 HUMAN） |
| `{START_LOCATION}` | 角色出生与初始降临的地理场景标识或本地化名称 |
| `{INITIAL_EQUIPMENT}` | 角色获得的初始佩剑或基础装备道具名称 |
| `{NPC_TARGET}` | 对话交互或剧情引导的目标 NPC 实体名称 |

### 4. 状态突变事件规范 (Valid Mutation Events)

DAG 终结节点或剧情关键节点仅允许发布下列合法状态突变事件：

| 突变事件类型 (Mutation Type) | 触发阶段与语义 |
| :--- | :--- |
| `CharacterCreated` | 角色基础档案初始化完成并装配属性 |
| `LocationAssigned` | 角色出生地与初始空间坐标指派完毕 |
| `EquipmentGranted` | 角色初始新兵行囊与佩剑装备入包 |
| `DialogueReady` | 对话总线就绪并激活引导 NPC 交互 |
| `PrologueCompleted` | 序章历程完结，世界大门敞开，流转至主舞台 |

### 5. 参考预设枚举库 (Reference Constants)

- **可选出身预设 (Origins)**: `DWARVEN_BLACKSMITH, ELVEN_SCHOLAR, IMPERIAL_NOBLE, SHADOW_OUTCAST`
- **可选出生地域 (Birth Regions)**: `CENTRAL_CONTINENT, HOWLING_TUNDRA, SCORCHED_CANYON, SILVER_FOREST, VOID_ARCHIPELAGO`
- **标准初始场景 (Locations)**: `CENTRAL_CITY_PLAZA, ELVEN_SANCTUARY_GROVE, VALAN_OUTPOST`
- **标准初始装备 (Items)**: `KALAR_EQUIP_WEAPON_BLADE_IRON_SWORD, KALAR_EQUIP_WEAPON_BLADE_MITHRIL_LONGSWORD`
- **引导 NPC 实体 (NPCs)**: `FORTRESS_GUARD`

### 6. 命途与创角扩展能力契约 (`destinies.json` Capabilities)

- **六维核心属性键 (`attribute_keys`)**: `STR, CON, INT, AGI, SPR, VIT`
- **六维基础生成边界 (`attribute_bounds`)**: 单维范围 `[1, 6]`，基准值 `3`，总点数预算 `21`
- **自定义身世加成红线 (`origin_bonus_budget`)**: 单维加成 `[-2, 3]`，六维净代数和 `[-2, 4]`，初始金币上限 `<=1000`
- **正负因果天赋守恒规则 (`causality_trait_rules`)**: `require_paired_pos_neg=True`（必须一正一负成对配置），`max_net_cost_delta=1`（正负点数净和绝对值 `<= 1`）
- **前端 UI 受控解锁策略 (`ui_capability_modes`)**: `origin_selection_mode`: `[INHERIT, ALLOW_MANUAL, FORCE_RANDOM]`；`trait_selection_mode`: `[INHERIT, ALLOW_MANUAL, FORCE_RANDOM]`
- **内置因果天赋 (`builtin_traits`)**: `GIANT_MIGHT, HEART_CORE_FISSURE, IRON_WILL, MANA_INSULATED, PRIMORDIAL_RESONANCE`
- **内置初始套件 (`builtin_starter_kits`)**: `KIT_ELF_DEFAULT, KIT_HUMAN_DEFAULT`
- **合法物品 ID 清单 (`canonical_item_ids`)**: `KALAR:CONSUM:ALCHEMY:POTION_MANA, KALAR:CONSUM:FOOD:HEARTY_STEW, KALAR:EQUIP:ARMOR:IRON_CHEST, KALAR:EQUIP:ARMOR:RUNIC_SHIELD, KALAR:EQUIP:WEAPON_BLADE:ELVEN_BOW, KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD, KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD, KALAR:MATERIAL:DISPOSAL:MANA_DUST, KALAR:MATERIAL:DISPOSAL:SLAG_ASH, KALAR:MATERIAL:ORE:MITHRIL_ORE, KALAR:QUEST:ARTIFACT:RELIC_FRAGMENT`
<!-- AUTOGEN_CAPABILITIES_END -->

---

## 四、 命途扩展契约规范 (`destinies.json`)

MOD 可通过根目录下的 `destinies.json` 以**列表式结构**扩展创角身世池、正负因果天赋池、初始装备行囊以及前端 UI 交互策略：

1. **前端 UI 受控解锁模式 (`ui_capabilities`)**：
   - `origin_selection_mode` / `trait_selection_mode` 仅允许取值 `"INHERIT"`（默认继承）、`"ALLOW_MANUAL"`（解锁前端下拉自选）、`"FORCE_RANDOM"`（强制盲盒随机）；
   - `allow_attribute_reroll`: 布尔值，控制是否开放创角阶段六维属性重掷开关。
2. **自定义身世数值预算红线 (`custom_origins`)**：
   - 采用列表项声明（每项含唯一 `origin_id`），`attribute_bonus` 单项属性加成严格限制在 `[-2, 3]`，六维加成净代数和严格限制在 `[-2, 4]`；
   - `initial_gold` 严禁超过 `1000` 金币上限。
3. **正负因果天赋配对守恒 (`custom_traits` & `paired_presets`)**：
   - 正向天赋 `cost > 0`，负向天赋 `cost < 0`；
   - `paired_presets` 必须将 1 个正向天赋与 1 个负向天赋成对绑定，且正负 `cost` 代数和绝对值必须 `<= 1`（即 `abs(pos_cost + neg_cost) <= 1`）。
4. **自定义初始行囊契约 (`custom_starter_kits`)**：
   - 每套行囊（含唯一 `kit_id`）的 `initial_items` 物品总件数必须 `<= 10`，且每项物品的 `canonical_id` 必须非空并对齐 `config/items/core.json`。
5. **多包非冲突合并规则 (Multi-Pack Merge & Conflict Guard)**：
   - 多个 MOD 同时启用时，各包的 `custom_origins`、`custom_traits`、`paired_presets`、`custom_starter_kits` 按优先级顺序执行列表追加合并；
   - 严禁跨包出现同名 `origin_id` / `trait_id` / `kit_id`（报 `ERR_MOD_DUPLICATE_ID_CONFLICT`），严禁同时启用 `incompatible_packs` 互斥包（报 `ERR_MOD_INCOMPATIBLE_CONFLICT`），严禁在 `ui_capabilities` 中同时声明 `"ALLOW_MANUAL"` 与 `"FORCE_RANDOM"` 相反策略（报 `ERR_MOD_UI_POLICY_CONFLICT`）。

---

## 五、 DAG 剧情拓扑约束 (DAG Graph Invariants)

1. **严格有向无环**：剧情图必须构成有向无环图 (DAG)，解算器将在装配阶段运行 Kahn 算法，检测到环路立即阻断装配；
2. **单一入口与出口**：每张剧情图必须包含且仅包含 1 个 `START_ENTRY` 与至少 1 个 `TERMINAL_EXIT` 节点；
3. **前置条件闭包**：每个节点的 `required_prerequisites` 列表引用的父节点必须在该图内可达且真实存在；
4. **安全状态突变**：节点完成时的 `mutations_on_complete` 必须从上述 `valid_mutation_events` 中选取，禁止发布未声明事件。

---

## 六、 极简实战工程样例 (Minimal Working Example)

### 1. `pack.json` 样例

```json
{
  "pack_id": "mod_frontier_awakening",
  "pack_name": "边境要塞苏醒包",
  "version": "1.0.0",
  "author": "KalarModders",
  "engine_api_version": "1.0.0",
  "priority": 120,
  "dependencies": [],
  "incompatible_packs": [],
  "semantic_tags": ["prologue", "frontier"],
  "is_active": true
}
```

### 2. `destinies.json` 样例

```json
{
  "ui_capabilities": {
    "origin_selection_mode": "ALLOW_MANUAL",
    "trait_selection_mode": "ALLOW_MANUAL",
    "allow_attribute_reroll": true
  },
  "custom_origins": [
    {
      "origin_id": "STARTER_ASTRAL_INITIATE",
      "name": "星界巡林学徒",
      "race": "HUMAN",
      "birth_region": "CENTRAL_CONTINENT",
      "weight": 25,
      "initial_gold": 150,
      "starter_kit_id": "KIT_STARTER_WANDERER",
      "attribute_bonus": {"INT": 2, "AGI": 1, "CON": -1},
      "desc": "自幼在边境星象观测所研习古籍与巡林箭术的年轻行者。"
    }
  ],
  "custom_traits": [
    {
      "trait_id": "TRAIT_STARLIGHT_AFFINITY",
      "name": "星辉亲和",
      "cost": 2,
      "type": "POSITIVE",
      "modifiers": {"INT": 2, "SPR": 1},
      "desc": "受星界微光眷顾，施法专注与精神韧性显著提升。"
    },
    {
      "trait_id": "TRAIT_ASTRAL_FATIGUE",
      "name": "星蚀倦怠",
      "cost": -2,
      "type": "NEGATIVE",
      "modifiers": {"CON": -1, "VIT": -1},
      "desc": "星力共鸣偶发反噬，肉体耐受力较常人略显单薄。"
    }
  ],
  "paired_presets": [
    {
      "preset_id": "PAIR_STARTER_ASTRAL",
      "positive": "TRAIT_STARLIGHT_AFFINITY",
      "negative": "TRAIT_ASTRAL_FATIGUE",
      "weight": 50
    }
  ],
  "custom_starter_kits": [
    {
      "kit_id": "KIT_STARTER_WANDERER",
      "name": "巡林学徒轻便行囊",
      "initial_gold": 80,
      "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
      "initial_items": [
        {"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", "count": 1},
        {"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "count": 2}
      ]
    }
  ]
}
```

### 3. `dag_graphs/DAG_FRONTIER_AWAKEN.json` 样例

```json
{
  "dag_id": "DAG_FRONTIER_AWAKEN",
  "entry_node_id": "NODE_ENTRY",
  "terminal_node_id": "NODE_EXIT",
  "nodes": {
    "NODE_ENTRY": {
      "node_type": "START_ENTRY",
      "narrative_key": "frontier.awakening",
      "required_prerequisites": []
    },
    "NODE_STEP_EXPLORE": {
      "node_type": "STANDARD_STEP",
      "narrative_key": "frontier.explore",
      "required_prerequisites": ["NODE_ENTRY"]
    },
    "NODE_EXIT": {
      "node_type": "TERMINAL_EXIT",
      "narrative_key": "frontier.completed",
      "required_prerequisites": ["NODE_STEP_EXPLORE"],
      "mutations_on_complete": [
        {
          "type": "PrologueCompleted",
          "dag_id": "DAG_FRONTIER_AWAKEN"
        }
      ]
    }
  },
  "edges": [
    {"from": "NODE_ENTRY", "to": "NODE_STEP_EXPLORE"},
    {"from": "NODE_STEP_EXPLORE", "to": "NODE_EXIT"}
  ]
}
```

---

## 七、 契约防漂移自动化守卫 (Contract Drift Guard)

本 SDK 规格说明与 `capabilities.json` 由引擎门禁脚本进行强校验。运行以下命令可验证契约是否与底层配置保持一致：

```bash
python WebGames/scripts/py/sync_mod_sdk.py --check-only
python WebGames/scripts/py/audit_sdk_sync.py
```
