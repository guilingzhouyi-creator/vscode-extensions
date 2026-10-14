---
档号: KALAR-DEV-2026-ST115-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST115 (主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 119 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎 —— 阶段4：无头主页HUD标准数据包与LLM逐包解读验收测试矩阵
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 已验收 (PASSED)
主题词/关键词: 验收测试矩阵; 无头测试流水线; 标准数据包验收; 逐包解读; 对象池守恒; 阶段4
---

# 施工细则：Phase 119 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎 —— 阶段4：无头主页HUD标准数据包与LLM逐包解读验收测试矩阵

> [!NOTE]
> **【施工目标】**：编写面向 Phase 119 的全链路无头集成测试流水线 `test_agent_hud_slice_and_action_space_pipeline.gd`，构建由 11 大验收用例（TC-AHS-01 ~ TC-AHS-11）组成的严密测试矩阵。覆盖标准遥测数据包四段式结构（Envelope/Obs/Deltas/Actions）、序列号单调自增、行动空间动态剪枝、因果差分追踪、UI 消息结构化切片装箱、专属动作通道零硬件争抢与越界熔断、人类前台操作抢占与 Agent 行动空间强制退化只读租约、伴侣总线广播、对象池守恒（`ADV-PRF-002`）以及端到端 LLM 逐包解读闭环，确保自动化测试 100% 绿色达标。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[AGENTS.md 工作区全局刚性公理](../../../../../AGENTS.md) §二.1、§二.2、§三；[阶段1_主页HUD结构化切片数据流DTO与动态行动空间契约设计.md](阶段1_主页HUD结构化切片数据流DTO与动态行动空间契约设计.md)；[阶段2_主页HUD切片求解器与动态行动空间裁决器核心实现.md](阶段2_主页HUD切片求解器与动态行动空间裁决器核心实现.md)；[阶段3_主页HUD双轨流式分发桥接与伴侣总线广播集成.md](阶段3_主页HUD双轨流式分发桥接与伴侣总线广播集成.md)
* **核心不变量约束断言**：
  - `Inv-TEST-ISOLATION-1 (测试环境对称隔离公理)`：测试用例前后必须显式调用 `_setup_environment()` 与 `_teardown_environment()`，重置伴侣总线、专属动作通道与仓储单例；
  - `Inv-DETERMINISTIC-ORACLE-2 (确定性神谕断言公理)`：测试断言必须采用严格的质性技术逻辑与精确数值比对，严禁使用宽松的模糊匹配；
  - `Inv-PACKET-TOPOLOGY-PURITY-3 (顶层数据包四段式纯度公理)`：TC-AHS-01 必须严格校验 `envelope`, `observation`, `causal_deltas`, `action_space` 顶层键名完备且无任何 UI 样式杂质；
  - `Inv-MONOTONIC-SEQUENCE-4 (时序序号自增公理)`：TC-AHS-02 必须验证多轮推演中 `sequence_index` 严格单调递增，`packet_id` 唯一且具备物理时间戳；
  - `Inv-ZERO-HEAP-ASSERT-5 (循环零堆分配证明公理)`：TC-AHS-07 必须在 1000 次连续推演循环中验证对象池复用，确保无多余引用残留；
  - `Inv-UI-NOTICE-SLICING-6 (UI消息结构化装箱断言)`：TC-AHS-09 必须验证各种 UI 弹窗与 Toast 剥离视图样式后，转换为纯语义 `HudUiNoticeDTO` 数组并携带可用交互指令；
  - `Inv-ACTION-CHANNEL-EXECUTION-7 (专属输入通道无硬件冲突断言)`：TC-AHS-10 必须验证通过 `AgentActionChannel` 发送 `AgentActionPacketDTO` 直接驱动领域服务状态突变，且拦截非法/越界指令，实现零 OS 输入事件模拟；
  - `Inv-PREEMPTION-READ-ONLY-ORACLE-8 (人类优先抢占只读退化断言)`：TC-AHS-11 必须验证当人类前台操作或模态弹窗展开时，数据包明确标明 `is_writable: false`，全部行动指令自动剪枝置灰且携带 `ERR_PREEMPTED_BY_HUMAN`，通道物理拒绝 Agent 指令写入。
* **防漂移最高指示**：测试流水线必须实现确定性时钟与环境对称隔离，严禁存在非确定性断言。

---

## 一、 验收测试用例矩阵清单 (TC-AHS-01 ~ TC-AHS-11)

| 用例编号 | 用例名称 | 核心验证逻辑与神谕断言 | 对应核心不变量 |
| :--- | :--- | :--- | :--- |
| **TC-AHS-01** | 标准遥测数据包四段式结构与体积极限验证 | 验证 `AgentHudTelemetryPacketDTO` 包含四段顶层结构，序列化 JSON 体积 $\le 2\text{KB}$，纯净无 UI 样式标签 | `Inv-PACKET-TOPOLOGY-PURITY-3` |
| **TC-AHS-02** | 时序信封单调递增性与物理时间戳验证 | 连续装箱多步数据包，断言 `sequence_index` 严格单调自增（1, 2, 3...），`timestamp_ms` 合法 | `Inv-MONOTONIC-SEQUENCE-4` |
| **TC-AHS-03** | 潜能加点行动空间动态裁决验证 | 潜能点 > 0 时指令 `is_executable == true`，潜能点清零后自动置为 `false` 并输出阻塞码 | `Inv-ACTION-SPACE-PRUNING-6` |
| **TC-AHS-04** | AP 体能与历法推进动态裁决验证 | AP $\ge 2.0$ 时宿屋休息指令可用，AP 耗尽至 $< 2.0$ 时指令自动阻断并标明 `ERR_INSUFFICIENT_AP` | `Inv-ACTION-SPACE-PRUNING-6` |
| **TC-AHS-05** | 单机/联机模式行动空间自适应验证 | 单机模式下网络特性指令隐藏或静默，联机模式下启用多端就绪状态标量与签名校验指示 | `Inv-SINGLE-SOURCE-DERIVATION-4` |
| **TC-AHS-06** | 单步因果差分精准溯源计算验证 | 模拟生理体能恢复与金币扣减，验证 `HudCausalDeltaSolver` 生成的 Deltas 类别、字段、差值及 `initiator` 精准对应 | `Inv-DETERMINISTIC-ORACLE-2` |
| **TC-AHS-07** | 对象池复用与 reset_state 守恒验证 | 连续 1000 次求解循环，复用同一 DTO 实例并通过 `reset_state()` 重置，验证数据不交叉污染 | `Inv-ZERO-HEAP-ASSERT-5` |
| **TC-AHS-08** | 端到端 LLM 逐包解读与决策闭环模拟验证 | 完整模拟 LLM 接收第 1 包 $\to$ 解读可用指令 $\to$ 输出动作 $\to$ 接收第 2 包与因果差分确认闭环 | `Inv-STANDARD-PACKET-ENVELOPE-1` |
| **TC-AHS-09** | UI 消息通知与模态对话框结构化切片装箱验证 | 模拟系统广播 Toast 与紧急停服模态弹窗，验证 `HudUiNoticeDTO` 数组正确装箱，去表现化纯度 100%，携带明确 `actions` 指令清单 | `Inv-UI-NOTICE-SLICING-6` |
| **TC-AHS-10** | 专属动作通道零硬件冲突与越界熔断验证 | 通过 `AgentActionChannel.dispatch_action` 发送合法动作驱动领域服务突变；发送伪造或前置条件不满足动作，断言返回明确阻断码，OS 硬件事件监听计数为 0 | `Inv-ACTION-CHANNEL-EXECUTION-7` |
| **TC-AHS-11** | 人类前台操作抢占与 Agent 行动空间强制退化只读验证 | 激活人类交互租约，断言信封 `control_lease.is_writable == false`，模式为 `READ_ONLY_OBSERVER`，行动空间全量置灰；动作通道拒绝写入并返回 `ERR_PREEMPTED_BY_HUMAN` | `Inv-PREEMPTION-READ-ONLY-ORACLE-8` |

---

## 二、 核心测试流水线代码框架设计

```gdscript
class_name TestAgentHudSliceAndActionSpacePipeline
extends TestCase

static func run_all_tests() -> Dictionary:
    var results: Array[Dictionary] = []
    results.append(test_standard_telemetry_packet_topology_and_size())
    results.append(test_envelope_monotonic_sequence_and_timestamp())
    results.append(test_potential_allocation_action_space_pruning())
    results.append(test_ap_and_rest_action_space_pruning())
    results.append(test_single_player_and_multiplayer_action_adaptation())
    results.append(test_causal_deltas_precise_tracking())
    results.append(test_object_pool_reuse_and_reset_conservation())
    results.append(test_end_to_end_llm_packet_by_packet_decision_loop())
    results.append(test_ui_notices_structural_slicing_and_actions())
    results.append(test_dedicated_action_channel_dispatch_and_guard())
    results.append(test_human_preemption_and_agent_read_only_fallback())
    return TestCase.pack_results("主页HUD面向Agent标准数据包与行动空间流水线", results)

static func test_ui_notices_structural_slicing_and_actions() -> Dictionary:
    var env: Dictionary = _setup_environment()
    var bridge: AgentHudSliceBridge = env["bridge"]
    
    # 模拟 UI 发出引导通知与模态对话框
    var test_notice := HudUiNoticeDTO.new()
    test_notice.notice_id = "notice_rest_recommendation_001"
    test_notice.category = "RECOMMENDATION"
    test_notice.priority = 2
    test_notice.message_text = "AP 体能偏低，建议返回宿屋休息恢复。"
    test_notice.actions = ["REST_INN", "DISMISS_NOTICE"]
    
    bridge.inject_ui_notice(test_notice)
    var packet: AgentHudTelemetryPacketDTO = bridge.step_and_publish()
    
    # 断言结构化切片中正确捕获 UI 通知且无富文本/像素标记
    assert_true(packet.observation.ui_notices.size() == 1, "应捕获 1 条结构化 UI 通知")
    assert_equal(packet.observation.ui_notices[0].notice_id, "notice_rest_recommendation_001")
    assert_true(not packet.observation.ui_notices[0].message_text.contains("<color>"), "严禁包含表现层富文本标记")
    assert_equal(packet.observation.ui_notices[0].actions.size(), 2)
    
    _teardown_environment(env)
    return TestCase.pass("test_ui_notices_structural_slicing_and_actions")

static func test_dedicated_action_channel_dispatch_and_guard() -> Dictionary:
    var env: Dictionary = _setup_environment()
    var channel: AgentActionChannel = env["action_channel"]
    
    # 1. 验证合法动作包直投领域服务突变
    var action_packet := AgentActionPacketDTO.new()
    action_packet.action_id = "ALLOCATE_POTENTIAL"
    action_packet.parameters = {"attribute": "strength", "amount": 1}
    action_packet.origin_packet_id = "pkt_step_001"
    action_packet.agent_signature = "sig_valid_agent_001"
    
    var res: Dictionary = channel.dispatch_action(action_packet)
    assert_true(res.get("success", false), "合法加点指令必须成功派发并执行")
    assert_equal(res.get("error_code", ""), "", "成功执行无错误码")
    
    # 2. 验证越界/非法指令拦截熔断
    var invalid_action := AgentActionPacketDTO.new()
    invalid_action.action_id = "ILLEGAL_ADMIN_KILL"
    invalid_action.parameters = {}
    
    var invalid_res: Dictionary = channel.dispatch_action(invalid_action)
    assert_false(invalid_res.get("success", true), "未注册非法指令必须阻断")
    assert_equal(invalid_res.get("error_code", ""), "ERR_UNKNOWN_ACTION_COMMAND")
    
    _teardown_environment(env)
    return TestCase.pass("test_dedicated_action_channel_dispatch_and_guard")

static func test_human_preemption_and_agent_read_only_fallback() -> Dictionary:
    var env: Dictionary = _setup_environment()
    var bridge: AgentHudSliceBridge = env["bridge"]
    var channel: AgentActionChannel = env["action_channel"]
    
    # 1. 模拟人类前台触发UI交互（激活人类租约）
    bridge.set_human_interacting(true)
    var packet: AgentHudTelemetryPacketDTO = bridge.step_and_publish()
    
    # 2. 断言控制权降级为只读
    assert_false(packet.envelope.control_lease.is_writable, "人类操作期间智能体必须处于只读态")
    assert_equal(packet.envelope.control_lease.agent_control_mode, "READ_ONLY_OBSERVER")
    assert_true(packet.envelope.control_lease.preempted_by_human, "必须明确标明被人类抢占")
    
    # 3. 断言行动空间全量剪枝置灰
    for d in packet.action_space:
        assert_false(d.is_executable, "人类操作期间所有指令必须置灰")
        assert_equal(d.blocked_reason, "ERR_PREEMPTED_BY_HUMAN")
        
    # 4. 断言专属通道物理拦截上行动作
    var action_pkt := AgentActionPacketDTO.new()
    action_pkt.action_id = "ALLOCATE_POTENTIAL"
    var res: Dictionary = channel.dispatch_action(action_pkt)
    assert_false(res.get("success", true), "并发或旧指令必须被通道拦截")
    assert_equal(res.get("error_code", ""), "ERR_PREEMPTED_BY_HUMAN")
    
    _teardown_environment(env)
    return TestCase.pass("test_human_preemption_and_agent_read_only_fallback")
```

---

## 三、 阶段交付物与全绿判定准则

1. **交付文件集**：
   - `WebGames/tests/integration/pipelines/test_agent_hud_slice_and_action_space_pipeline.gd`
   - 更新 `WebGames/tests/test_registry.gd`（注册本流水线）
2. **全绿判定准则**：
   - 运行无头测试流水线，TC-AHS-01 ~ TC-AHS-11 必须 11/11 通过（100% PASS）；
   - 执行静态代码检查 `bash WebGames/scripts/sh/check-gdscript.sh` 零错误；
   - 全工作区 `pwsh -File scripts/ps1/audit-all.ps1 -Fast` 保持绿色达标。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 编写 `test_agent_hud_slice_and_action_space_pipeline.gd` 测试流水线代码框架
- [x] Step 4.2: 覆盖 TC-AHS-01 ~ TC-AHS-11 共 11 项用例并确保 100% 绿色通行
- [x] Step 4.3: 在 `test_registry.gd` 中注册流水线并在 CI 门禁中闭环验证

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-AHS-S4-01 | 数据包拓扑与体积极限断言 | 执行 TC-AHS-01 测试用例 | 四段顶层结构完整无缺，序列化体积 $\le 2\text{KB}$ |
| TC-AHS-S4-02 | 对象池零堆分配守恒断言 | 执行 TC-AHS-07 测试用例 | 1000 次循环下无引用泄漏与脏数据污染 |
| TC-AHS-S4-03 | 动作通道零硬件冲突断言 | 执行 TC-AHS-10 测试用例 | 领域服务直投成功，Godot 物理硬件事件计数为 0 |
| TC-AHS-S4-04 | 人类优先抢占退化只读断言 | 执行 TC-AHS-11 测试用例 | 行动空间置灰，阻断码为 `ERR_PREEMPTED_BY_HUMAN` |
