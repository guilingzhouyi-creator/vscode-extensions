---
档号: KALAR-DEV-2026-ST117-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST117 (MOD开发者SDK全域同步与数据契约同构治理施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 121 MOD开发者SDK全域同步与数据契约同构治理 —— 阶段2：静态萃取引擎升级与HUD遥测和专属动作Schema实现
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 规划就绪 (PLANNING)
主题词/关键词: sync_mod_sdk; capabilities.json; MOD_SPEC; agent_hud_telemetry_packet; agent_action_packet; 阶段2
---

# 施工细则：Phase 121 MOD开发者SDK全域同步与数据契约同构治理 —— 阶段2：静态萃取引擎升级与HUD遥测和专属动作Schema实现

> [!NOTE]
> **【施工目标】**：对 `WebGames/scripts/py/sync_mod_sdk.py` 静态萃取流水线进行实质扩展，接入 `config/domains/world_state/core.json` 权威真源，自动化萃取主页 HUD 遥测流、动态行动空间指令集与人类独占租约配置；同步生成更新 `mod_sdk/capabilities.json` 与受控回写 `mod_sdk/MOD_SPEC.md`；并在 `mod_sdk/schemas/` 目录下落地 `agent_hud_telemetry_packet.schema.json` 与 `agent_action_packet.schema.json` 强类型 JSON Schema 契约文件。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[AGENTS.md 工作区全局刚性公理](../../../../../AGENTS.md) §一、§二.1、§二.2；[阶段1_MOD开发者SDK权威真源萃取与遥测契约规范设计.md](阶段1_MOD开发者SDK权威真源萃取与遥测契约规范设计.md)；[sync_mod_sdk.py](../../../../scripts/py/sync_mod_sdk.py)；[agent_hud_telemetry_packet_dto.gd](../../../../backend/domains/world_state/dto/agent_hud_telemetry_packet_dto.gd)；[agent_action_packet_dto.gd](../../../../backend/domains/world_state/dto/agent_action_packet_dto.gd)
* **核心不变量约束断言**：
  - `Inv-EXTRACTION-COMPLETENESS-1 (萃取完备性公理)`：`sync_mod_sdk.py` 必须精准提取 `agent_telemetry_stream` 与 `agent_action_channel` 下的所有关键字段，杜绝字段缺失或类型降级；
  - `Inv-ATOMIC-DISK-WRITE-2 (原子落盘与换行一致性公理)`：生成的 `capabilities.json` 与 `MOD_SPEC.md` 必须严格保持 LF 换行与 2 空格缩进，末尾必须且仅保留一个换行符；
  - `Inv-SCHEMA-VALIDITY-3 (Schema 语法与版本合规公理)`：新增的 JSON Schema 必须符合 Draft 2020-12 标准，根节点必须为对象，严禁出现无效类型引用或未闭合结构；
  - `Inv-SPEC-DYNAMIC-ANCHOR-4 (文档动态标记锚点不侵入公理)`：`MOD_SPEC.md` 仅允许在 `<!-- AUTOGEN_CAPABILITIES_START -->` 与 `<!-- AUTOGEN_CAPABILITIES_END -->` 之间替换内容，严禁破坏手工维护的架构全景章节。
* **防漂移最高指示**：保持控制流平铺直叙，有效代码行符合预算，禁止在生成内容中注入敏捷临时批次代码。

---

## 一、 `sync_mod_sdk.py` 静态萃取流水线扩展实现

### 1.1 萃取逻辑增强 (`extract_capabilities`)
在 `sync_mod_sdk.py` 中新增 `extract_agent_telemetry_capabilities` 模块级函数：
```python
def extract_agent_telemetry_capabilities(config_dir: Path) -> Dict[str, Any]:
    """从 config/domains/world_state/core.json 静态萃取 Agent 遥测与动作通道能力。"""
    ws_core_path = config_dir / "domains" / "world_state" / "core.json"
    ws_data = load_json_file(ws_core_path)
    
    stream_cfg = ws_data.get("agent_telemetry_stream", {})
    channel_cfg = ws_data.get("agent_action_channel", {})
    
    return {
        "protocol_version": str(stream_cfg.get("protocol_version", "1.0.0")),
        "domain_name": str(stream_cfg.get("domain_name", "HOME_HUD")),
        "ring_buffer_capacity": int(stream_cfg.get("ring_buffer_capacity", 32)),
        "async_queue_capacity": int(stream_cfg.get("async_queue_capacity", 128)),
        "backpressure_strategy": str(stream_cfg.get("backpressure_strategy", "DROP_OLDEST")),
        "binary_compression_enabled": bool(stream_cfg.get("binary_compression_enabled", True)),
        "supported_directives": list(stream_cfg.get("supported_directives", [])),
        "control_lease": {
            "human_preemption_lease_ms": int(channel_cfg.get("human_preemption_lease_ms", 2000)),
            "auto_preempt_on_modal_open": bool(channel_cfg.get("auto_preempt_on_modal_open", True)),
            "modes": ["READ_WRITE", "READ_ONLY_OBSERVER"],
            "operator_states": ["IDLE", "ACTIVE", "EXCLUSIVE_MODAL_OPEN"],
        },
        "binary_telemetry_codec": {
            "magic_header": "0x4B414C52",
            "protocol_version": 1,
            "target_byte_budget": 256,
        },
    }
```

### 1.2 文档动态渲染增强 (`generate_autogen_spec_section`)
在 `generate_autogen_spec_section` 中追加《主页 HUD 面向 Agent 动态行动空间与遥测流能力表》生成逻辑，渲染 7 大指令枚举、语义说明、代价与前置条件表格。

---

## 二、 核心 Schema 落地规格

### 2.1 `agent_hud_telemetry_packet.schema.json`
放置于 `WebGames/mod_sdk/schemas/agent_hud_telemetry_packet.schema.json`，完整映射 `AgentHudTelemetryPacketDTO`：
- `envelope`: 强类型信封头与 `control_lease` 租约对象；
- `observation`: `AgentHudContextSliceDTO` 纯净观测状态切片；
- `causal_deltas`: `HudCausalDeltaDTO` 因果突变数组；
- `action_space`: `AgentActionDirectiveDTO` 动态行动空间指令数组。

### 2.2 `agent_action_packet.schema.json`
放置于 `WebGames/mod_sdk/schemas/agent_action_packet.schema.json`，完整映射 `AgentActionPacketDTO`：
- `session_id`, `sequence_index`, `directive_id`, `params`, `origin_packet_id`, `agent_signature`, `client_timestamp_ms`。

---

## 三、 阶段交付清单与验收标准

1. `sync_mod_sdk.py` 支持 `--check-only` 与生成模式，无代码语法缺陷；
2. 自动化生成规整的 `capabilities.json` 并回写 `MOD_SPEC.md`；
3. `mod_sdk/schemas/` 目录下新增两份标准 JSON Schema，经语法验证 100% 合法；
4. 运行 `python WebGames/scripts/py/sync_mod_sdk.py --check-only` 返回退出码 0。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 升级 sync_mod_sdk.py 静态萃取脚本
- [x] Step 2.2: 生成标准 agent_hud_telemetry_packet.schema.json
- [x] Step 2.3: 生成标准 agent_action_packet.schema.json
- [x] Step 2.4: 增补 capabilities.json 能力清单与版本声明

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-MSDK-S2-01 | 自动萃取产物语法合法性 | 运行脚本生成各 Schema | 产物通过标准 JSON 解析，无语法中断与空字段 |
| TC-MSDK-S2-02 | Schema 物理落盘与路径合规 | 检查 mod_sdk/schemas/ 目录 | 文件命名严格遵循规范契约 |
| TC-MSDK-S2-03 | 能力清单自动化同步回写 | 萃取脚本同步能力字典 | capabilities.json 自动更新版本与支持指令清单 |
| TC-MSDK-S2-04 | 静态萃取无破坏性覆盖 | 多次运行萃取脚本 | 产物具备幂等性，未引入额外未经确认的 Diff |

