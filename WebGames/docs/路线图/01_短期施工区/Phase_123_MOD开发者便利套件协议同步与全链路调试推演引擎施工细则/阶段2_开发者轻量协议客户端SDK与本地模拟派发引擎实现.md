---
档号: KALAR-DEV-2026-ST118-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST118 (MOD开发者便利套件协议同步与全链路调试推演引擎施工细则)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段2：开发者轻量协议客户端SDK与本地模拟派发引擎实现
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 已验收 (100% PASS)
主题词/关键词: MOD SDK; Python Client; 协议组包; 租约维护; 本地派发; 阶段2
---

# 施工细则：Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段2：开发者轻量协议客户端SDK与本地模拟派发引擎实现

> [!NOTE]
> **【施工目标】**：实现面向 MOD 开发者与自动化评测 Agent 的轻量级 Python 协议客户端 SDK（`kalar_protocol_client.py`），提供开箱即用的强类型请求信封构造器、租约流水号单调递增维护、本地 Mock 派发器（MockDispatcher）与服务端响应验证能力；支持与 Phase 122 统一协议工厂在 Python 侧达成 100% 同构对齐。
> **【授权依据】**：已获项目负责人明确授权——在短期施工区正式立项 Phase 123。
> **【需求溯源】**：阶段 1 统一协议 Schema 契约字典 + 开发者免手动拼装 JSON 提高开发人体工学要求。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [阶段 1 统一协议 Schema 字典设计与真源萃取及租约对齐规范](阶段1_统一协议Schema字典设计与真源萃取及租约对齐规范.md)
  * [`ClientRequestEnvelopeDTO`](../../../../backend/domains/world_state/dto/client_request_envelope_dto.gd)
  * [`UnifiedResponseEnvelopeDTO`](../../../../backend/domains/world_state/dto/unified_response_envelope_dto.gd)
  * [`UnifiedProtocolDispatcher`](../../../../backend/domains/world_state/services/unified_protocol_dispatcher.gd)
* **核心不变量约束断言**：
  * **Inv-CLIENT-NONCE-MONOTONIC-1**：人类 UI 请求的 `lease_nonce` 必须在单会话内严格单调自增（`nonce_{k+1} > nonce_k`），Agent 请求的 `lease_nonce` 恒为 0；
  * **Inv-VALIDATION-OFFLINE-FIRST-2**：客户端 SDK 在发射请求前，必须依据 `client_request_envelope.schema.json` 执行离线强类型校验，格式非法立即抛出客户端异常；
  * **Inv-MOCK-DISPATCHER-PARITY-3**：内置的 `MockProtocolDispatcher` 必须忠实模拟后端 3000ms 抢占阻断逻辑，在人类租约期内阻断 Agent 冲突请求。
* **防漂移最高指示**：严格遵守 LF 换行契约，严禁引入施工批次与敏捷工期临时标记，保持 ELOC 与圈复杂度低认知名义。

---

## 一、 核心组件架构设计

### 1.1 `kalar_protocol_client.py` 模块职责

```text
WebGames/mod_sdk/tools/kalar_protocol_client.py
├── class KalarProtocolClient:
│   ├── create_human_request(domain, action_type, payload, ...) -> dict
│   ├── create_agent_request(domain, action_type, payload, ...) -> dict
│   ├── validate_envelope(envelope_dict) -> (bool, str)
│   ├── send_request(envelope_dict) -> dict
│   └── set_dispatcher(dispatcher_func) -> None
└── class LocalMockDispatcher:
    ├── dispatch(request_dict) -> dict
    ├── simulate_human_action(...) -> dict
    └── reset_lease_for_tests() -> None
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 编写轻量级 Python 客户端 SDK `kalar_protocol_client.py`
- [x] Step 2.2: 实现单调自增 `lease_nonce` 管理与 Schema 本地离线断言
- [x] Step 2.3: 实现轻量本地模拟调度器 `LocalMockDispatcher`，闭环离线联调

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-MSDK-S2-01 | Python 客户端组包规范性 | 调用 create_human_request 与 create_agent_request | 产出符合 Schema 规范的字典，字段类型完全一致 |
| TC-MSDK-S2-02 | 租约流水号单调自增断言 | 连续构造 10 次人类请求 | lease_nonce 严格连续递增 1..10 |
| TC-MSDK-S2-03 | 本地模拟调度器租约抢占拦截 | 先发人类请求后立即发射 Agent 请求 | Agent 请求在 3000ms 窗内返回 ERR_PREEMPTED_BY_HUMAN |
| TC-MSDK-S2-04 | 离线 Schema 校验拦截能力 | 输入缺少必需字段的请求信封 | validate_envelope 返回 (false, 错误原因) 并拦截发送 |

