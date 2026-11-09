#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 文档生成渲染)
# 文件路径: WebGames/scripts/py/lib/mod_sdk_render.py
# 架构定位: MOD SDK 契约规范 Markdown 渲染引擎 (MOD SDK Spec Markdown Renderer)
# 依赖与触发: 触发方: lib/mod_sdk_shared.py | 上游: capabilities 数据 | 下游: MOD_SPEC.md | 运行时: Python 3.10+
# 职责说明: 将引擎权威静态萃取的能力数据渲染为 MOD_SPEC.md 动态 Markdown 章节与全量开发手册
# 退出语义与设计依据: 纯库模块，无进程退出码 | 设计依据: 《卡拉尔世界模组创作者数据契约》与 LF 换行公理
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.mod_sdk_render import render_full_mod_spec, generate_autogen_spec_section
# ==============================================================================
"""MOD SDK 规范 Markdown 文档动态章节与全景手册生成器。"""

from __future__ import annotations
from typing import Any
import re
COMMA_SEP = ", "


def _build_destiny_autogen_lines(destiny_cap: dict[str, Any]) -> list[str]:
    """构建命途扩展能力章节的动态 Markdown 行列表。"""
    attr_keys = COMMA_SEP.join(destiny_cap.get("attribute_keys", []))
    bounds = destiny_cap.get("attribute_bounds", {})
    budget = destiny_cap.get("origin_bonus_budget", {})
    trait_rules = destiny_cap.get("causality_trait_rules", {})
    ui_modes = destiny_cap.get("ui_capability_modes", {})
    origin_modes = COMMA_SEP.join(ui_modes.get("origin_selection_mode", []))
    trait_modes = COMMA_SEP.join(ui_modes.get("trait_selection_mode", []))
    builtin_traits = COMMA_SEP.join(destiny_cap.get("builtin_traits", []))
    builtin_kits = COMMA_SEP.join(destiny_cap.get("builtin_starter_kits", []))
    builtin_dags = COMMA_SEP.join(destiny_cap.get("builtin_dag_ids", []))
    canonical_items = COMMA_SEP.join(destiny_cap.get("canonical_item_ids", []))
    error_codes = COMMA_SEP.join(destiny_cap.get("supported_error_codes", []))

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
        f"- **内置序章图元 (`builtin_dag_ids`)**: `{builtin_dags}`",
        f"- **合法物品 ID 清单 (`canonical_item_ids`)**: `{canonical_items}`",
        f"- **静态门禁错误码 (`supported_error_codes`)**: `{error_codes}`",
    ]


def _build_agent_hud_telemetry_autogen_lines(
    telemetry_cap: dict[str, Any],
) -> list[str]:
    """构建主页 HUD Agent 遥测与动态行动空间章节的动态 Markdown 行列表。"""
    protocol_ver = telemetry_cap.get("protocol_version", "1.0.0")
    domain_name = telemetry_cap.get("domain_name", "HOME_HUD")
    ring_cap = telemetry_cap.get("ring_buffer_capacity", 32)
    async_cap = telemetry_cap.get("async_queue_capacity", 128)
    backpressure = telemetry_cap.get("backpressure_strategy", "DROP_OLDEST")
    directives = COMMA_SEP.join(telemetry_cap.get("supported_directives", []))
    lease = telemetry_cap.get("control_lease", {})
    lease_ms = lease.get("human_preemption_lease_ms", 2000)
    auto_preempt = lease.get("auto_preempt_on_modal_open", True)
    modes = COMMA_SEP.join(lease.get("modes", []))
    op_states = COMMA_SEP.join(lease.get("operator_states", []))
    codec = telemetry_cap.get("binary_telemetry_codec", {})
    magic = codec.get("magic_header", "0x4B414C52")
    budget = codec.get("target_byte_budget", 256)

    return [
        "",
        "### 7. 主页 HUD 面向 Agent 动态行动空间与遥测流能力契约 (Home HUD Telemetry)",
        "",
        f"- **遥测协议版本 (`protocol_version`)**: `{protocol_ver}`",
        f"- **遥测业务域 (`domain_name`)**: `{domain_name}`",
        (
            f"- **定长轨迹与流控队列 (`ring_buffer_capacity` / `async_queue_capacity`)**: "
            f"定长环形缓冲 `{ring_cap}` 槽位，异步队列容量 `{async_cap}`，背压流控策略 `{backpressure}`"
        ),
        f"- **受支持动态行动空间指令集 (`supported_directives`)**: `{directives}`",
        (
            f"- **人类控制权优先租约 (`control_lease`)**: "
            f"人类抢占窗口 `{lease_ms}ms`，模态独占抢占 `{auto_preempt}`，"
            f"控制模式 `[{modes}]`，操作者状态 `[{op_states}]`"
        ),
        (
            f"- **紧凑二进制流编解码 (`binary_telemetry_codec`)**: "
            f"魔数标识 `{magic}` (KALR)，协议版本 `{codec.get('protocol_version', 1)}`，"
            f"目标压缩体积预算 `<={budget}` 字节"
        ),
    ]


def _build_unified_protocol_autogen_lines(proto_cap: dict[str, Any]) -> list[str]:
    """构建全域统一协议与跨端信封契约章节的动态 Markdown 行列表。"""
    protocol_ver = proto_cap.get("protocol_version", "1.0.0")
    actors = COMMA_SEP.join(proto_cap.get("supported_actors", []))
    lease_ms = proto_cap.get("human_preemption_lease_ms", 3000)
    auto_preempt = proto_cap.get("auto_preempt_on_modal_open", True)
    domains = COMMA_SEP.join(proto_cap.get("supported_domains", []))
    esc_actions = COMMA_SEP.join(proto_cap.get("esc_menu_actions", []))
    schemas = proto_cap.get("envelope_schema_versions", {})
    req_schema = schemas.get(
        "client_request", "kalar.mod_sdk.client_request_envelope.v1"
    )
    resp_schema = schemas.get(
        "unified_response", "kalar.mod_sdk.unified_response_envelope.v1"
    )
    esc_schema = schemas.get("esc_payload", "kalar.mod_sdk.esc_menu_action_payload.v1")

    return [
        "",
        "### 8. 全域统一请求响应信封与 ESC 协议契约 (Unified Protocol Envelope)",
        "",
        f"- **统一协议版本 (`protocol_version`)**: `{protocol_ver}`",
        f"- **受支持参与者身份 (`supported_actors`)**: `{actors}`",
        (
            f"- **人类独占抢占租约窗口 (`human_preemption_lease_ms`)**: "
            f"`{lease_ms}ms`（模态打开自动抢占: `{auto_preempt}`）"
        ),
        f"- **协议路由业务域 (`supported_domains`)**: `{domains}`",
        f"- **受支持系统菜单指令 (`esc_menu_actions`)**: `{esc_actions}`",
        (
            f"- **信封强类型 Schema 版本 (`envelope_schema_versions`)**: "
            f"请求信封 `{req_schema}`，响应信封 `{resp_schema}`，ESC 载荷 `{esc_schema}`"
        ),
    ]


def _build_workbench_autogen_lines(wb_cap: dict[str, Any]) -> list[str]:
    """构建开发者集成工作台与打包能力章节的动态 Markdown 行列表。"""
    formats = COMMA_SEP.join([f"`{fmt}`" for fmt in wb_cap.get("supported_package_formats", [])])
    actions = COMMA_SEP.join([f"`{act}`" for act in wb_cap.get("supported_actions", [])])
    compression = wb_cap.get("supported_compression", "ZIP_DEFLATE")
    hash_algo = wb_cap.get("hash_algorithm", "SHA256")

    return [
        "",
        "### 9. 开发者集成工作台与归档打包能力契约 (Developer Workbench Capabilities)",
        "",
        f"- **支持包格式 (`supported_package_formats`)**: {formats}",
        f"- **支持工作台动作 (`supported_actions`)**: {actions}",
        f"- **归档压缩算法 (`supported_compression`)**: `{compression}`",
        f"- **单向指纹校验算法 (`hash_algorithm`)**: `{hash_algo}`",
    ]


def generate_autogen_spec_section(capabilities: dict[str, Any]) -> str:
    """生成 MOD_SPEC.md 动态能力章节的 Markdown 文本。"""
    lines: list[str] = [
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

    lines.extend(
        [
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
            "本地化文案模板（i18n）与节点内联文案（`inline_text`）支持大小写双轨插值（如 `{player_name}` 与 `{PLAYER_NAME}`）：",
            "",
            "| 占位符宏 (Placeholder) | 解析源与说明 |",
            "| :--- | :--- |",
        ]
    )

    placeholders = capabilities.get("available_placeholders", {})
    for ph, desc in placeholders.items():
        lines.append(f"| `{ph}` | {desc} |")

    lines.extend(
        [
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
            f"- **可选出身预设 (Origins)**: `{COMMA_SEP.join(capabilities.get('origins', []))}`",
            f"- **可选出生地域 (Birth Regions)**: `{COMMA_SEP.join(capabilities.get('birth_regions', []))}`",
            f"- **标准初始场景 (Locations)**: `{COMMA_SEP.join(capabilities.get('reference_locations', []))}`",
            f"- **标准初始装备 (Items)**: `{COMMA_SEP.join(capabilities.get('reference_items', []))}`",
            f"- **引导 NPC 实体 (NPCs)**: `{COMMA_SEP.join(capabilities.get('reference_npcs', []))}`",
        ]
    )

    destiny_cap = capabilities.get("destiny_mod_capabilities", {})
    if isinstance(destiny_cap, dict) and destiny_cap:
        lines.extend(_build_destiny_autogen_lines(destiny_cap))

    telemetry_cap = capabilities.get("agent_hud_telemetry_capabilities", {})
    if isinstance(telemetry_cap, dict) and telemetry_cap:
        lines.extend(_build_agent_hud_telemetry_autogen_lines(telemetry_cap))

    proto_cap = capabilities.get("unified_protocol_capabilities", {})
    if isinstance(proto_cap, dict) and proto_cap:
        lines.extend(_build_unified_protocol_autogen_lines(proto_cap))

    wb_cap = capabilities.get("workbench_capabilities", {})
    if isinstance(wb_cap, dict) and wb_cap:
        lines.extend(_build_workbench_autogen_lines(wb_cap))

    lines.append("<!-- AUTOGEN_CAPABILITIES_END -->")
    return "\n".join(lines)


def render_full_mod_spec(capabilities: dict[str, Any], existing_content: str | None = None) -> str:
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

    template = f"""# 卡拉尔世界引擎 · 模组创作者数据契约速查指南 (MOD Quick-Reference Spec v1.2)

> [!NOTE]
> **【规范定位】**：本手册是面向模组开发者与自主推演 Agent 的根目录官方契约速查指南与真源索引总枢。所有动态能力清单均由底层单一真源自动化静态萃取同步，确保数据契约与引擎运行时保持一致。
> 完整深入的架构设计、算法公式与协议明细，请直接查阅 [`docs/`](docs/) 对应权威规范卷。
> **引擎接口版本**：`{capabilities.get("engine_api_version", "1.0.0")}`

---

## 🧭 官方权威规范导航矩阵 (Documentation Index & Navigation Hub)

| 专题领域 | 权威规范文档指针 | 核心内容摘要 |
| :--- | :--- | :--- |
| **全景架构与装配** | [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | 模组核心架构、Kahn 拓扑排序装配算法、多包冲突裁决公理与静态门禁错误码字典 |
| **视听多媒体准入** | [`docs/ART_AND_ASSETS_GUIDE.md`](docs/ART_AND_ASSETS_GUIDE.md) | Tier 2 视听资产烹饪规范、WebP/OGG/TTF 格式白名单、体积配额与 SHA-256 清单机制 |
| **规则大魔改覆写** | [`docs/TOTAL_CONVERSION_SPEC.md`](docs/TOTAL_CONVERSION_SPEC.md) | Tier 3 全局大魔改规范、世界地图空间阻抗、物品卡牌、战斗动力学公式与差分覆写语义 |
| **无头交互推演** | [`docs/AGENT_INTERACTION.md`](docs/AGENT_INTERACTION.md) | Agent 无头交互式推演协议、STDIO NDJSON 双向流式通信契约与 Observation-Action 状态机 |
| **现场遥测与伴侣** | [`docs/COMPANION_PROTOCOL.md`](docs/COMPANION_PROTOCOL.md) | 非侵入式伴侣观察总线、事件广播协议、会话遥测与现场黑匣子录制归档规范 |

---

## 一、 引擎能力真源契约 (Engine Capabilities)

{autogen_part}

---

## 二、 自动化验证与守卫命令

```bash
# 验证 MOD SDK 契约是否与引擎底层真源保持一致（零漂移）
python WebGames/scripts/py/sync_mod_sdk.py --check-only

# 执行全量 SDK 完整性与门禁审计断言
python WebGames/scripts/py/audit_sdk_sync.py
```
"""
    return template.replace("\r\n", "\n")
