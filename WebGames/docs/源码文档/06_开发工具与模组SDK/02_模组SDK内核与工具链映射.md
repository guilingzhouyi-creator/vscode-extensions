# 02 模组 SDK 内核与工具链映射 (`mod_sdk/`)

> 本册建立对 [WebGames/mod_sdk/](../../../mod_sdk/) 的工程索引：详细开发协议与 JSON 契约以 `mod_sdk/docs/` 独立权威手册为准，本册重点梳理其 CLI 工具模块、Schema 家族、模板示例及与引擎门禁的同步机制。

---

## 一、`kalar-mod` CLI 统一工具链 (`mod_sdk/tools/`，15 个 `.py`)

统一入口 [kalar_mod.py](../../../mod_sdk/tools/kalar_mod.py) 聚合 `init`、`check`、`cook`、`preview`、`play`、`pack`、`dispatch`、`workbench`、`bake` 核心子命令：

| 子模块组 | 脚本清单 | 核心工程职能 |
| :--- | :--- | :--- |
| 统一 CLI 门面 | [kalar_mod.py](../../../mod_sdk/tools/kalar_mod.py) | 命令路由、参数校验、`pack` 工件打包与统一退出码（`0=成功 / 1=业务失败 / 2=参数或 IO 异常`） |
| 脚手架与构建 | `scaffold_mod.py`、`cook_assets.py`、`preview_mod.py` | 生成标准模组目录骨架；检查/烘焙资源清单与二进制资产；离线预演模组结构与模拟推演 |
| 多维静态校验器 | `check_mod.py`、`check_mod_common.py`、`check_mod_dag.py`、`check_mod_destiny.py`、`check_mod_multi.py` | 校验模组清单、Schema 合规性、叙事 DAG 环路与可达性、命途规则冲突以及多模组联动兼容性 |
| 交互游玩与终端 | `play_mod.py`、`play_mod_common.py`、`play_mod_character.py`、`play_mod_interactive.py` | 驱动终端交互游玩测试、角色创角推演与剧情副本回归，支持 `--with-hud` HUD 快照投影 |
| 协议客户端与工坊 | `kalar_protocol_client.py`、`kalar_workbench.py` | 通过标准客户端请求信封与引擎交互（如 `ESC_QUERY_READINESS` 等动作）及模组工坊会话调试 |

---

## 二、Schema 契约体系 (`mod_sdk/schemas/`，19 份)

- **包清单与资产**：`pack.schema.json`、`bundle_manifest.schema.json`、`assets_manifest.schema.json`、`kdat_manifest.schema.json`、`cutscene_manifest.schema.json`。
- **内容与世界规则**：`world.schema.json`、`items.schema.json`、`skills.schema.json`、`game_rules.schema.json`、`destinies.schema.json`、`dag_graph.schema.json`、`workbench_config.schema.json`。
- **运行时与智能体通信协议**：`client_request_envelope.schema.json`、`unified_response_envelope.schema.json`、`esc_menu_action_payload.schema.json`、`action.schema.json`、`observation.schema.json`、`agent_action_packet.schema.json`、`agent_hud_telemetry_packet.schema.json`。

---

## 三、模板、示例与对外权威文档指针

| 类别 | 路径内容 | 权威参考链接 |
| :--- | :--- | :--- |
| SDK 权威规范 | `SPECIFICATION.md`（总契约）、`TOTAL_CONVERSION_SPEC.md`（全转换模组）、`AGENT_INTERACTION.md`（AI 交互）、`COMPANION_PROTOCOL.md`（同伴协议）、`ART_AND_ASSETS_GUIDE.md`（美术资产） | [SPECIFICATION.md](../../../mod_sdk/docs/SPECIFICATION.md) · [AGENT_INTERACTION.md](../../../mod_sdk/docs/AGENT_INTERACTION.md) |
| 起步模板（3 套） | `starter_story/`、`audio_visual_pack/`、`total_conversion_sample/` | [mod_sdk/templates/](../../../mod_sdk/templates/) |
| 示例工程（1 套） | `custom_hud_theme/` | [mod_sdk/examples/](../../../mod_sdk/examples/) |

**双源防漂移机制**：引擎内部契约与 `mod_sdk` 暴露面之间受 [sync_mod_sdk.py](../../../scripts/py/sync_mod_sdk.py) 与门禁任务 `audit_sdk_sync.py`（依赖规则库 `lib/audit_sdk_rules.py` 与 `lib/audit_sdk_protocol_rules.py`）持续核对，确保枚举、信封字段与动作白名单零漂移。
