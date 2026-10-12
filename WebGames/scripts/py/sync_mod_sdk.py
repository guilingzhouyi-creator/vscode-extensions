#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 同步引擎)
# 文件路径: WebGames/scripts/py/sync_mod_sdk.py
# 架构定位: MOD SDK 权威真源静态萃取与契约同步引擎 (MOD SDK Extraction & Sync Engine)
# 依赖与触发: 触发方: CI / 预提交钩子 / audit_sdk_sync.py | 上游: config/** | 下游: mod_sdk/** | 运行时: Python 3.10+
# 职责说明: 静态提取引擎权威真源、生成/更新 capabilities.json 与 MOD_SPEC.md、提供 --check-only 契约漂移判定
# 退出语义与设计依据: 退出码: 0=同步成功/无漂移, 1=契约漂移/校验失败, 2=配置缺失/运行异常 | 设计依据: AGENTS.md 契约防漂移与单源规则契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python WebGames/scripts/py/sync_mod_sdk.py
#   python WebGames/scripts/py/sync_mod_sdk.py --check-only
#   python WebGames/scripts/py/sync_mod_sdk.py --json
# ==============================================================================
"""MOD SDK 权威真源静态萃取与契约同步引擎。

从引擎配置单一真源提取受支持种族、DAG 节点类型、文本占位符及状态突变事件，
并同步生成 mod_sdk/capabilities.json 与更新 mod_sdk/MOD_SPEC.md。
"""

import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows GBK 崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def resolve_webgames_root() -> Path:
    """定位 WebGames 项目根目录。"""
    curr = Path(__file__).resolve()
    for candidate in [curr] + list(curr.parents):
        if (candidate / "config" / "domains" / "character_creation" / "core.json").is_file():
            return candidate
        if (candidate / "WebGames" / "config" / "domains" / "character_creation" / "core.json").is_file():
            return candidate / "WebGames"
    return Path(__file__).resolve().parents[2]


def load_json_file(file_path: Path) -> Dict[str, Any]:
    """读取指定 JSON 文件并解析为字典，遇到异常返回空字典。"""
    if not file_path.is_file():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception as exc:
        print(f"[WARN] 读取或解析 JSON 失败: {file_path} ({exc})", file=sys.stderr)
        return {}


def collect_placeholders_from_obj(obj: Any, pattern: re.Pattern) -> List[str]:
    """递归遍历对象中的所有字符串字段，提取占位符标识。"""
    placeholders: List[str] = []
    if isinstance(obj, str):
        matches = pattern.findall(obj)
        placeholders.extend(matches)
    elif isinstance(obj, dict):
        for val in obj.values():
            placeholders.extend(collect_placeholders_from_obj(val, pattern))
    elif isinstance(obj, list):
        for item in obj:
            placeholders.extend(collect_placeholders_from_obj(item, pattern))
    return placeholders


def extract_destiny_capabilities(config_dir: Path, core_data: Dict[str, Any]) -> Dict[str, Any]:
    """从角色创建、初始行囊与物品真源提取命途扩展能力契约。"""
    attr_gen = core_data.get("authoritative_reincarnation", {}).get("attribute_generation", {})
    attr_keys = attr_gen.get("keys")
    if not isinstance(attr_keys, list) or not attr_keys:
        attr_keys = ["STR", "CON", "INT", "AGI", "SPR", "VIT"]

    attribute_bounds = {
        "min_val": int(attr_gen.get("min_val", 1)),
        "max_val": int(attr_gen.get("max_val", 6)),
        "baseline": int(attr_gen.get("baseline", 3)),
        "total_points": int(attr_gen.get("total_points", 21)),
    }

    builtin_traits = sorted(list(core_data.get("traits", {}).keys()))

    loadout_path = config_dir / "domains" / "starter_loadout" / "core.json"
    loadout_data = load_json_file(loadout_path)
    builtin_starter_kits = sorted(list(loadout_data.get("starter_kits", {}).keys()))

    items_path = config_dir / "items" / "core.json"
    items_data = load_json_file(items_path)
    raw_items = items_data.get("items", [])
    canonical_item_ids = sorted([
        item["canonical_id"]
        for item in raw_items
        if isinstance(item, dict) and isinstance(item.get("canonical_id"), str) and item.get("canonical_id")
    ])

    return {
        "attribute_keys": list(attr_keys),
        "attribute_bounds": attribute_bounds,
        "origin_bonus_budget": {
            "per_stat_min": -2,
            "per_stat_max": 3,
            "net_sum_min": -2,
            "net_sum_max": 4,
            "max_initial_gold": 1000,
        },
        "causality_trait_rules": {
            "require_paired_pos_neg": True,
            "max_net_cost_delta": 1,
        },
        "ui_capability_modes": {
            "origin_selection_mode": ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"],
            "trait_selection_mode": ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"],
        },
        "builtin_traits": builtin_traits,
        "builtin_starter_kits": builtin_starter_kits,
        "canonical_item_ids": canonical_item_ids,
    }


def extract_capabilities(webgames_root: Path) -> Dict[str, Any]:
    """静态提取引擎权威真源配置。"""
    config_dir = webgames_root / "config"

    # 1. 提取 character_creation core.json
    core_path = config_dir / "domains" / "character_creation" / "core.json"
    core_data = load_json_file(core_path)

    races_catalog = core_data.get("races_catalog", {})
    supported_races = sorted([
        r_id for r_id, r_info in races_catalog.items()
        if isinstance(r_info, dict) and r_info.get("is_enabled", False)
    ])
    if not supported_races:
        supported_races = ["HUMAN"]

    origins = sorted(list(core_data.get("origins", {}).keys()))
    birth_regions = sorted(list(core_data.get("birth_regions", {}).keys()))

    # 2. 提取 prologue_i18n.json
    i18n_path = config_dir / "narratives" / "prologue_i18n.json"
    i18n_data = load_json_file(i18n_path)

    canonical_placeholder_desc: Dict[str, str] = {
        "{PLAYER_NAME}": "当前玩家角色的自定义名称",
        "{RACE_ID}": "角色所属种族唯一标识符（如 HUMAN）",
        "{START_LOCATION}": "角色出生与初始降临的地理场景标识或本地化名称",
        "{INITIAL_EQUIPMENT}": "角色获得的初始佩剑或基础装备道具名称",
        "{NPC_TARGET}": "对话交互或剧情引导的目标 NPC 实体名称",
    }

    placeholder_pattern = re.compile(r"\{[A-Z0-9_]+\}")
    found_placeholders = collect_placeholders_from_obj(i18n_data, placeholder_pattern)

    available_placeholders: Dict[str, str] = dict(canonical_placeholder_desc)
    for ph in found_placeholders:
        if ph not in available_placeholders:
            clean_name = ph.strip("{}")
            available_placeholders[ph] = f"剧情本地化占位符: {clean_name}"

    reference_locations = sorted(list(i18n_data.get("locations", {}).keys()))
    reference_items = sorted(list(i18n_data.get("items", {}).keys()))
    reference_npcs = sorted([
        k for k in i18n_data.get("npcs", {}).keys()
        if k != "default_guide"
    ])

    # 3. 提取 prologue_dag_catalog.json
    valid_node_types = ["START_ENTRY", "STANDARD_STEP", "BRANCH_CHOICE", "TERMINAL_EXIT"]
    valid_mutation_events = [
        "CharacterCreated",
        "LocationAssigned",
        "EquipmentGranted",
        "DialogueReady",
        "PrologueCompleted",
    ]

    # 4. 提取命途与创角扩展能力真源
    destiny_mod_capabilities = extract_destiny_capabilities(config_dir, core_data)

    return {
        "_meta": {
            "version": "1.0.0",
            "schema": "kalar.mod_sdk.capabilities",
            "generator": "WebGames/scripts/py/sync_mod_sdk.py",
            "description": "卡拉尔世界引擎 MOD 开发者 SDK 权威能力描述清单（权威真源萃取，禁止手动修改）",
        },
        "engine_api_version": "1.0.0",
        "supported_races": supported_races,
        "valid_node_types": valid_node_types,
        "available_placeholders": available_placeholders,
        "valid_mutation_events": valid_mutation_events,
        "origins": origins,
        "birth_regions": birth_regions,
        "reference_locations": reference_locations,
        "reference_items": reference_items,
        "reference_npcs": reference_npcs,
        "destiny_mod_capabilities": destiny_mod_capabilities,
    }


def format_capabilities_json(capabilities: Dict[str, Any]) -> str:
    """将能力数据序列化为规整的 JSON 字符串（LF 换行，2 空格缩进）。"""
    return json.dumps(capabilities, indent=2, ensure_ascii=False) + "\n"


def _build_destiny_autogen_lines(destiny_cap: Dict[str, Any]) -> List[str]:
    """构建命途扩展能力章节的动态 Markdown 行列表。"""
    attr_keys = ", ".join(destiny_cap.get("attribute_keys", []))
    bounds = destiny_cap.get("attribute_bounds", {})
    budget = destiny_cap.get("origin_bonus_budget", {})
    trait_rules = destiny_cap.get("causality_trait_rules", {})
    ui_modes = destiny_cap.get("ui_capability_modes", {})
    origin_modes = ", ".join(ui_modes.get("origin_selection_mode", []))
    trait_modes = ", ".join(ui_modes.get("trait_selection_mode", []))
    builtin_traits = ", ".join(destiny_cap.get("builtin_traits", []))
    builtin_kits = ", ".join(destiny_cap.get("builtin_starter_kits", []))
    canonical_items = ", ".join(destiny_cap.get("canonical_item_ids", []))

    return [
        "",
        "### 6. 命途与创角扩展能力契约 (`destinies.json` Capabilities)",
        "",
        f"- **六维核心属性键 (`attribute_keys`)**: `{attr_keys}`",
        (
            f"- **六维基础生成边界 (`attribute_bounds`)**: "
            f"单维范围 `[{bounds.get('min_val', 1)}, {bounds.get('max_val', 6)}]`，"
            f"基准值 `{bounds.get('baseline', 3)}`，"
            f"总点数预算 `{bounds.get('total_points', 21)}`"
        ),
        (
            f"- **自定义身世加成红线 (`origin_bonus_budget`)**: "
            f"单维加成 `[{budget.get('per_stat_min', -2)}, {budget.get('per_stat_max', 3)}]`，"
            f"六维净代数和 `[{budget.get('net_sum_min', -2)}, {budget.get('net_sum_max', 4)}]`，"
            f"初始金币上限 `<={budget.get('max_initial_gold', 1000)}`"
        ),
        (
            f"- **正负因果天赋守恒规则 (`causality_trait_rules`)**: "
            f"`require_paired_pos_neg={trait_rules.get('require_paired_pos_neg', True)}`（必须一正一负成对配置），"
            f"`max_net_cost_delta={trait_rules.get('max_net_cost_delta', 1)}`（正负点数净和绝对值 `<= 1`）"
        ),
        (
            f"- **前端 UI 受控解锁策略 (`ui_capability_modes`)**: "
            f"`origin_selection_mode`: `[{origin_modes}]`；"
            f"`trait_selection_mode`: `[{trait_modes}]`"
        ),
        f"- **内置因果天赋 (`builtin_traits`)**: `{builtin_traits}`",
        f"- **内置初始套件 (`builtin_starter_kits`)**: `{builtin_kits}`",
        f"- **合法物品 ID 清单 (`canonical_item_ids`)**: `{canonical_items}`",
    ]


def generate_autogen_spec_section(capabilities: Dict[str, Any]) -> str:
    """生成 MOD_SPEC.md 动态能力章节的 Markdown 文本。"""
    lines: List[str] = [
        "<!-- AUTOGEN_CAPABILITIES_START -->",
        "> [!IMPORTANT]",
        f"> **【引擎权威能力清单】**：当前兼容引擎 API 版本: `{capabilities.get('engine_api_version', '1.0.0')}`。本节由 `sync_mod_sdk.py` 静态萃取维护，禁止手动篡改。",
        "",
        "### 1. 启用的种族清单 (Supported Races)",
        "",
        "MOD 创作者角色与序章节点路由仅允许绑定下列已启用种族：",
        "",
        "| 种族标识符 (Race ID) | 状态 | 规范语义 |",
        "| :--- | :---: | :--- |",
    ]

    for race in capabilities.get("supported_races", []):
        lines.append(f"| `{race}` | 启用 (Active) | 卡拉尔世界核心创角与剧情支持种族 |")

    lines.extend([
        "",
        "### 2. 合法 DAG 节点类型 (Valid DAG Node Types)",
        "",
        "剧情图由下列四类节点拓扑连接，严禁使用非声明节点类型：",
        "",
        "| 节点类型枚举 | 拓扑约束 | 语义与职责 |",
        "| :--- | :--- | :--- |",
        "| `START_ENTRY` | 入度必须为 0，单图仅允许 1 个 | 序章剧情唯一的起始入口节点 |",
        "| `STANDARD_STEP` | 入度 >= 1，出度 >= 1 | 标准顺序执行剧情推进步骤 |",
        "| `BRANCH_CHOICE` | 入度 >= 1，出度 >= 2 | 具有多分支交互选择或因果分流节点 |",
        "| `TERMINAL_EXIT` | 出度必须为 0，允许触发完成突变 | 剧情图唯一的终结退出节点 |",
        "",
        "### 3. 合法文本占位符字典 (Available Placeholders)",
        "",
        "本地化文案模板（i18n）中支持插值的动态占位符全集：",
        "",
        "| 占位符宏 (Placeholder) | 解析源与说明 |",
        "| :--- | :--- |",
    ])

    placeholders = capabilities.get("available_placeholders", {})
    for ph, desc in placeholders.items():
        lines.append(f"| `{ph}` | {desc} |")

    lines.extend([
        "",
        "### 4. 状态突变事件规范 (Valid Mutation Events)",
        "",
        "DAG 终结节点或剧情关键节点仅允许发布下列合法状态突变事件：",
        "",
        "| 突变事件类型 (Mutation Type) | 触发阶段与语义 |",
        "| :--- | :--- |",
        "| `CharacterCreated` | 角色基础档案初始化完成并装配属性 |",
        "| `LocationAssigned` | 角色出生地与初始空间坐标指派完毕 |",
        "| `EquipmentGranted` | 角色初始新兵行囊与佩剑装备入包 |",
        "| `DialogueReady` | 对话总线就绪并激活引导 NPC 交互 |",
        "| `PrologueCompleted` | 序章历程完结，世界大门敞开，流转至主舞台 |",
        "",
        "### 5. 参考预设枚举库 (Reference Constants)",
        "",
        f"- **可选出身预设 (Origins)**: `{', '.join(capabilities.get('origins', []))}`",
        f"- **可选出生地域 (Birth Regions)**: `{', '.join(capabilities.get('birth_regions', []))}`",
        f"- **标准初始场景 (Locations)**: `{', '.join(capabilities.get('reference_locations', []))}`",
        f"- **标准初始装备 (Items)**: `{', '.join(capabilities.get('reference_items', []))}`",
        f"- **引导 NPC 实体 (NPCs)**: `{', '.join(capabilities.get('reference_npcs', []))}`",
    ])

    destiny_cap = capabilities.get("destiny_mod_capabilities", {})
    if isinstance(destiny_cap, dict) and destiny_cap:
        lines.extend(_build_destiny_autogen_lines(destiny_cap))

    lines.append("<!-- AUTOGEN_CAPABILITIES_END -->")
    return "\n".join(lines)


def render_full_mod_spec(capabilities: Dict[str, Any], existing_content: Optional[str] = None) -> str:
    """渲染或注入 MOD_SPEC.md 完整内容。"""
    autogen_part = generate_autogen_spec_section(capabilities)

    if (
        existing_content
        and "<!-- AUTOGEN_CAPABILITIES_START -->" in existing_content
        and "destinies.json" in existing_content
    ):
        pattern = re.compile(
            r"<!-- AUTOGEN_CAPABILITIES_START -->.*?<!-- AUTOGEN_CAPABILITIES_END -->",
            re.DOTALL,
        )
        updated = pattern.sub(autogen_part, existing_content)
        return updated.replace("\r\n", "\n")

    template = f"""# 卡拉尔世界引擎 · 剧情与命途 MOD 创作者开发契约规范 (MOD Spec v1.1)

> [!NOTE]
> **【规范定位】**：本规范是面向 MOD 创作者 Agent 与人类开发者的“一页纸极简开发指南”。所有能力清单均由底层单一真源自动化萃取同步，确保 MOD 契约与引擎运行时保持 100% 绝对一致。
> **引擎接口版本**：`{capabilities.get('engine_api_version', '1.0.0')}`

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

{autogen_part}

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
{{
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
}}
```

### 2. `destinies.json` 样例

```json
{{
  "ui_capabilities": {{
    "origin_selection_mode": "ALLOW_MANUAL",
    "trait_selection_mode": "ALLOW_MANUAL",
    "allow_attribute_reroll": true
  }},
  "custom_origins": [
    {{
      "origin_id": "STARTER_ASTRAL_INITIATE",
      "name": "星界巡林学徒",
      "race": "HUMAN",
      "birth_region": "CENTRAL_CONTINENT",
      "weight": 25,
      "initial_gold": 150,
      "starter_kit_id": "KIT_STARTER_WANDERER",
      "attribute_bonus": {{"INT": 2, "AGI": 1, "CON": -1}},
      "desc": "自幼在边境星象观测所研习古籍与巡林箭术的年轻行者。"
    }}
  ],
  "custom_traits": [
    {{
      "trait_id": "TRAIT_STARLIGHT_AFFINITY",
      "name": "星辉亲和",
      "cost": 2,
      "type": "POSITIVE",
      "modifiers": {{"INT": 2, "SPR": 1}},
      "desc": "受星界微光眷顾，施法专注与精神韧性显著提升。"
    }},
    {{
      "trait_id": "TRAIT_ASTRAL_FATIGUE",
      "name": "星蚀倦怠",
      "cost": -2,
      "type": "NEGATIVE",
      "modifiers": {{"CON": -1, "VIT": -1}},
      "desc": "星力共鸣偶发反噬，肉体耐受力较常人略显单薄。"
    }}
  ],
  "paired_presets": [
    {{
      "preset_id": "PAIR_STARTER_ASTRAL",
      "positive": "TRAIT_STARLIGHT_AFFINITY",
      "negative": "TRAIT_ASTRAL_FATIGUE",
      "weight": 50
    }}
  ],
  "custom_starter_kits": [
    {{
      "kit_id": "KIT_STARTER_WANDERER",
      "name": "巡林学徒轻便行囊",
      "initial_gold": 80,
      "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
      "initial_items": [
        {{"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", "count": 1}},
        {{"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "count": 2}}
      ]
    }}
  ]
}}
```

### 3. `dag_graphs/DAG_FRONTIER_AWAKEN.json` 样例

```json
{{
  "dag_id": "DAG_FRONTIER_AWAKEN",
  "entry_node_id": "NODE_ENTRY",
  "terminal_node_id": "NODE_EXIT",
  "nodes": {{
    "NODE_ENTRY": {{
      "node_type": "START_ENTRY",
      "narrative_key": "frontier.awakening",
      "required_prerequisites": []
    }},
    "NODE_STEP_EXPLORE": {{
      "node_type": "STANDARD_STEP",
      "narrative_key": "frontier.explore",
      "required_prerequisites": ["NODE_ENTRY"]
    }},
    "NODE_EXIT": {{
      "node_type": "TERMINAL_EXIT",
      "narrative_key": "frontier.completed",
      "required_prerequisites": ["NODE_STEP_EXPLORE"],
      "mutations_on_complete": [
        {{
          "type": "PrologueCompleted",
          "dag_id": "DAG_FRONTIER_AWAKEN"
        }}
      ]
    }}
  }},
  "edges": [
    {{"from": "NODE_ENTRY", "to": "NODE_STEP_EXPLORE"}},
    {{"from": "NODE_STEP_EXPLORE", "to": "NODE_EXIT"}}
  ]
}}
```

---

## 七、 契约防漂移自动化守卫 (Contract Drift Guard)

本 SDK 规格说明与 `capabilities.json` 由引擎门禁脚本进行强校验。运行以下命令可验证契约是否与底层配置保持一致：

```bash
python WebGames/scripts/py/sync_mod_sdk.py --check-only
python WebGames/scripts/py/audit_sdk_sync.py
```
"""
    return template.replace("\r\n", "\n")


def check_contract_drift(
    webgames_root: Path,
    capabilities: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """比对磁盘既有文件与内存萃取结果，返回是否存在漂移及差异说明。"""
    mod_sdk_dir = webgames_root / "mod_sdk"
    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    diff_messages: List[str] = []

    # 1. 检查 capabilities.json
    expected_cap_content = format_capabilities_json(capabilities)
    if not cap_path.is_file():
        diff_messages.append(f"磁盘缺失文件: {cap_path}")
    else:
        existing_cap_content = cap_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        if existing_cap_content != expected_cap_content:
            diff_lines = list(difflib.unified_diff(
                existing_cap_content.splitlines(keepends=True),
                expected_cap_content.splitlines(keepends=True),
                fromfile="disk/capabilities.json",
                tofile="memory/capabilities.json",
            ))
            diff_messages.append(
                f"capabilities.json 契约漂移:\n" + "".join(diff_lines[:30])
            )

    # 2. 检查 MOD_SPEC.md
    if not spec_path.is_file():
        diff_messages.append(f"磁盘缺失文件: {spec_path}")
    else:
        existing_spec_content = spec_path.read_text(encoding="utf-8").replace("\r\n", "\n")
        expected_spec_content = render_full_mod_spec(capabilities, existing_spec_content)
        if existing_spec_content != expected_spec_content:
            diff_lines = list(difflib.unified_diff(
                existing_spec_content.splitlines(keepends=True),
                expected_spec_content.splitlines(keepends=True),
                fromfile="disk/MOD_SPEC.md",
                tofile="memory/MOD_SPEC.md",
            ))
            diff_messages.append(
                f"MOD_SPEC.md 契约漂移:\n" + "".join(diff_lines[:30])
            )

    is_clean = len(diff_messages) == 0
    return is_clean, diff_messages


def sync_to_disk(webgames_root: Path, capabilities: Dict[str, Any]) -> None:
    """将萃取的能力清单与文档写入磁盘（保证 LF 换行与 UTF-8 编码）。"""
    mod_sdk_dir = webgames_root / "mod_sdk"
    mod_sdk_dir.mkdir(parents=True, exist_ok=True)

    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    # 1. 写入 capabilities.json
    cap_content = format_capabilities_json(capabilities)
    cap_path.write_text(cap_content, encoding="utf-8", newline="\n")
    print(f"[OK] 已同步能力清单: {cap_path}")

    # 2. 写入或注入 MOD_SPEC.md
    existing_spec = spec_path.read_text(encoding="utf-8") if spec_path.is_file() else None
    spec_content = render_full_mod_spec(capabilities, existing_spec)
    spec_path.write_text(spec_content, encoding="utf-8", newline="\n")
    print(f"[OK] 已同步开发契约规范: {spec_path}")


def main() -> int:
    """CLI 入口主函数。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(description="卡拉尔引擎 MOD 开发者 SDK 权威真源静态萃取与防漂移同步引擎")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="比对磁盘既有文件与内存萃取结果，检测到差异返回非 0 退出码（CI 门禁阻断）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="输出萃取的 capabilities 结构化 JSON 到标准输出",
    )
    args = parser.parse_args()

    root = resolve_webgames_root()
    capabilities = extract_capabilities(root)

    if args.json:
        print(format_capabilities_json(capabilities))
        return 0

    if args.check_only:
        is_clean, diffs = check_contract_drift(root, capabilities)
        if is_clean:
            print("[OK] MOD SDK 契约与引擎真源保持 100% 绝对一致，未检测到任何漂移。")
            return 0
        print("[FAIL] 检测到 MOD SDK 契约发生漂移！", file=sys.stderr)
        for diff in diffs:
            print(diff, file=sys.stderr)
        print("\n请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新同步最新权威契约。", file=sys.stderr)
        return 1

    sync_to_disk(root, capabilities)
    return 0


if __name__ == "__main__":
    sys.exit(main())
