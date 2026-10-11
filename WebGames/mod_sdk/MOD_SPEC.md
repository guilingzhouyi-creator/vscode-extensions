# 卡拉尔世界引擎 · 剧情 MOD 创作者开发契约规范 (MOD Spec v1.0)

> [!NOTE]
> **【规范定位】**：本规范是面向 MOD 创作者 Agent 与人类开发者的“一页纸极简开发指南”。所有能力清单均由底层单一真源自动化萃取同步，确保 MOD 契约与引擎运行时保持 100% 绝对一致。
> **引擎接口版本**：`1.0.0`

---

## 一、 扩展包目录结构规范 (Package Layout)

每个剧情 MOD 扩展包物理上为一个独立目录（支持存放在 `mods/narratives/<mod_dir>/` 或 `user://mods/narratives/<mod_dir>/`），标准布局如下：

```text
my_narrative_mod/
├── pack.json                   # 【必需】MOD 清单元数据描述文件
├── dags/                       # 【必需】剧情有向无环图配置目录
│   └── custom_prologue.json    # DAG 剧情图拓扑结构
├── i18n/                       # 【可选】剧情本地化文案字典
│   └── custom_prologue.json    # 包含占位符的剧情文本
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
<!-- AUTOGEN_CAPABILITIES_END -->

---

## 四、 DAG 剧情拓扑约束 (DAG Graph Invariants)

1. **严格有向无环**：剧情图必须构成有向无环图 (DAG)，解算器将在装配阶段运行 Kahn 算法，检测到环路立即阻断装配；
2. **单一入口与出口**：每张剧情图必须包含且仅包含 1 个 `START_ENTRY` 与 1 个 `TERMINAL_EXIT` 节点；
3. **前置条件闭包**：每个节点的 `required_prerequisites` 列表引用的父节点必须在该图内可达且真实存在；
4. **安全状态突变**：节点完成时的 `mutations_on_complete` 必须从上述 `valid_mutation_events` 中选取，禁止发布未声明事件。

---

## 五、 极简实战工程样例 (Minimal Working Example)

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

### 2. `dags/frontier_dag.json` 样例

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

## 六、 契约防漂移自动化守卫 (Contract Drift Guard)

本 SDK 规格说明与 `capabilities.json` 由引擎门禁脚本进行强校验。运行以下命令可验证契约是否与底层配置保持一致：

```bash
python WebGames/scripts/py/sync_mod_sdk.py --check-only
python WebGames/scripts/py/audit_sdk_sync.py
```
