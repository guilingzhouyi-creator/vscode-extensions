---
档号: KALAR-DEV-2026-ST118-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST118 (MOD开发者便利套件协议同步与全链路调试推演引擎施工细则)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段1：统一协议Schema字典设计与真源萃取及租约对齐规范
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 已验收 (100% PASS)
主题词/关键词: MOD SDK; 统一协议信封; JSON Schema; sync_mod_sdk; 动态租约; 阶段1
---

# 施工细则：Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段1：统一协议Schema字典设计与真源萃取及租约对齐规范

> [!NOTE]
> **【施工目标】**：针对 Phase 122 全域统一协议工厂（UnifiedProtocolFactory）与双轨请求信封架构，设计客户端统一请求信封、统一响应信封与 ESC 核心交互载荷的强类型 JSON Schema 字典矩阵；升级静态真源萃取引擎 `sync_mod_sdk.py`，将统一协议能力清单、受支持领域指令集与 3000ms 动态控制租约（对齐运行时单源）全量萃取至 `capabilities.json`，扩充支持错误码清单，彻底消除开发者套件协议脱节。
> **【授权依据】**：已获项目负责人明确授权——在短期施工区正式立项 Phase 123（第 12 归档周期，在途积累: 9/10 案卷）。
> **【需求溯源】**：Phase 122 统一协议工厂双轨请求信封与 ESC 后端联动引擎 + MOD 开发者便利性全景调查结论。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [`ClientRequestEnvelopeDTO`](../../../../backend/domains/world_state/dto/client_request_envelope_dto.gd)：统一前端客户端请求信封定义
  * [`UnifiedResponseEnvelopeDTO`](../../../../backend/domains/world_state/dto/unified_response_envelope_dto.gd)：统一服务端响应信封定义
  * [`HumanControlLeaseManager`](../../../../backend/domains/world_state/services/human_control_lease_manager.gd)：人类控制租约管理器（`DEFAULT_LEASE_WINDOW_MS = 3000`）
  * [`EscMenuBackendService`](../../../../backend/domains/world_state/services/esc_menu_backend_service.gd)：ESC 系统菜单 5 大指令与参数规范
  * [`sync_mod_sdk.py`](../../../../scripts/py/sync_mod_sdk.py)：MOD SDK 权威真源静态萃取引擎
* **核心不变量约束断言**：
  * **Inv-SCHEMA-ENVELOPE-PARITY-1**：新增的 `client_request_envelope.schema.json` 与 `unified_response_envelope.schema.json` 必须 100% 对齐 GDScript 运行时 DTO 字段属性、类型与枚举约束，严禁属性分叉；
  * **Inv-LEASE-WINDOW-SSOT-2**：`capabilities.json` 中的 `human_preemption_lease_ms` 必须与运行时 `HumanControlLeaseManager.DEFAULT_LEASE_WINDOW_MS`（3000ms）保持严格单源一致；
  * **Inv-ZERO-DRIFT-EXTRACTION-3**：`sync_mod_sdk.py --check-only` 判定必须保持严格确定性，新增的 `unified_protocol_capabilities` 必须从领域服务与配置表全自动静态萃取，禁止手动篡改。
* **防漂移最高指示**：严格遵守 LF 换行契约，严禁引入施工批次与敏捷工期临时标记，保持 ELOC 与圈复杂度低认知名义。

---

## 一、 核心 Schema 字典规范与萃取架构

### 1.1 `client_request_envelope.schema.json` 契约规约

规范客户端向服务端发送的统一请求载荷结构：
- **Schema ID**: `kalar.mod_sdk.client_request_envelope.v1`
- **必需字段**: `request_id`, `actor_type`, `domain`, `action_type`, `payload`, `client_timestamp_ms`
- **枚举约束**:
  * `actor_type`: 限定为 `HUMAN_UI` 与 `AGENT`；
  * `domain`: 必须匹配有效领域命名（如 `world_state`, `world_gateway`, `lifecycle`, `game_settings` 等）；
  * `lease_nonce`: 非负整数（人类请求自增流水号，Agent 请求恒为 0）。

### 1.2 `unified_response_envelope.schema.json` 契约规约

规范服务端返回给客户端的统一响应结构：
- **Schema ID**: `kalar.mod_sdk.unified_response_envelope.v1`
- **必需字段**: `request_id`, `is_success`, `payload`, `server_timestamp_ms`
- **可选字段**: `error_code`, `message`

### 1.3 `esc_menu_action_payload.schema.json` 契约规约

收敛 ESC 菜单 5 大系统指令的强类型参数格式：
- `ESC_QUERY_READINESS`: `{}`
- `ESC_SAVE_GAME`: `{"slot_id": "SLOT_01"}`
- `ESC_EXIT_TO_GATEWAY`: `{"auto_save": true}`
- `ESC_QUIT_GAME`: `{"exit_reason": "USER_QUIT"}`
- `ESC_APPLY_SETTINGS`: `{"volume_master": 0.8, ...}`

### 1.4 `capabilities.json` 扩展架构规约

在 `capabilities.json` 根节点新增 `unified_protocol_capabilities` 章节：
```json
{
  "unified_protocol_capabilities": {
    "protocol_version": "1.0.0",
    "supported_actors": ["HUMAN_UI", "AGENT"],
    "human_preemption_lease_ms": 3000,
    "supported_domains": [
      "world_state",
      "world_gateway",
      "lifecycle",
      "game_settings"
    ],
    "esc_menu_actions": [
      "ESC_QUERY_READINESS",
      "ESC_SAVE_GAME",
      "ESC_EXIT_TO_GATEWAY",
      "ESC_QUIT_GAME",
      "ESC_APPLY_SETTINGS"
    ]
  }
}
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 1.1: 编写客户端请求信封强类型 Schema `client_request_envelope.schema.json`
- [x] Step 1.2: 编写服务端响应信封强类型 Schema `unified_response_envelope.schema.json`
- [x] Step 1.3: 编写 ESC 系统菜单载荷 Schema `esc_menu_action_payload.schema.json`
- [x] Step 1.4: 升级 `sync_mod_sdk.py` 萃取流水线并重新生成 `capabilities.json` 与 `MOD_SPEC.md`

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-MSDK-S1-01 | 请求与响应信封 Schema 完备性 | 校验 3 份新 Schema 语法与结构 | 符合 JSON Schema Draft-07，字段约束与 DTO 100% 对齐 |
| TC-MSDK-S1-02 | 租约保护窗口单源真源对齐 | 检查 capabilities.json 中租约配置 | human_preemption_lease_ms 精确等于 3000ms |
| TC-MSDK-S1-03 | 统一协议能力清单静态自动萃取 | 运行 python scripts/py/sync_mod_sdk.py --check-only | 0 差异通过，capabilities.json 包含 unified_protocol_capabilities |
| TC-MSDK-S1-04 | 错误码清单收敛性 | 检查 capabilities.json supported_error_codes | 完整包含 Phase 122 新增的 5 大核心协议错误码 |
