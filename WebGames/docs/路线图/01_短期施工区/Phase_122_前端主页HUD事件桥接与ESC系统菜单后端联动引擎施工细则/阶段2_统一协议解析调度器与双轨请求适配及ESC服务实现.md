# 施工细则：Phase 122 前端主页HUD事件桥接与ESC系统菜单后端联动引擎 —— 阶段2：统一协议解析调度器与双轨请求适配及ESC服务实现

> [!NOTE]
> **【施工目标】**：实现全域统一协议解析调度器（UnifiedProtocolDispatcher）、人类控制租约动态守卫（HumanControlLeaseManager）以及面向前端表现层的 ESC 菜单后端联动服务（EscMenuBackendService），闭环双轨分发、租约抢占防护、网关全量洗脱与五阶段停机。
> **【授权依据】**：已获项目负责人/用户明确授权——在短期施工区正式立项 Phase 122。
> **【需求溯源】**：阶段 1 统一请求/响应信封契约与 ESC 交互动作规范。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [阶段 1 统一协议工厂与双轨请求信封及 ESC 交互契约规范设计](阶段1_统一协议工厂与双轨请求信封及ESC交互契约规范设计.md)
  * [`world_gateway_fsm.gd`](../../../../backend/domains/world_gateway/world_gateway_fsm.gd)：`exit_to_gateway()` 内存全量洗脱调用
  * [`game_lifecycle_service.gd`](../../../../backend/domains/lifecycle/game_lifecycle_service.gd)：`execute_graceful_shutdown()` 优雅停机调用
  * [`save_readiness_guard.gd`](../../../../backend/domains/world_state/guards/save_readiness_guard.gd)：保存就绪态与路径气密校验
* **核心不变量约束断言**：
  * **Inv-LEASE-PREEMPTION-1**：人类前台 UI 请求到达后，人类控制租约必须自动续订（默认维持 3000ms 保护窗），在此保护窗内所有试图修改同一角色/世界的 Agent 动作必须以 `ERR_PREEMPTED_BY_HUMAN` 立即阻断；
  * **Inv-TRANSACTIONAL-GATEWAY-SCRUB-2**：执行 `ESC_EXIT_TO_GATEWAY` 时，若配置了退出自动保存，必须前置确保 `SaveDataAccessLayer` 刷盘成功，之后方可触发 `WorldGatewayFSM.exit_to_gateway()`，严禁未刷盘先洗脱；
  * **Inv-ZERO-HEAP-DISPATCH-3**：协议调度器在解包、派发与组包响应过程中，必须采用就地原位填充，避免在循环体内频繁构造无界临时对象。
* **防漂移最高指示**：严格遵守 LF 换行契约，严禁引入施工批次与敏捷工期临时标记，保持 ELOC 与圈复杂度低认知名义。

---

## 一、 核心组件架构与实现方案

### 1. 人类控制租约管理器 (`HumanControlLeaseManager`)

```gdscript
# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 人类控制租约管理器)
# 文件路径: res://backend/domains/world_state/services/human_control_lease_manager.gd
# 架构定位: Domain Guard / Concurrency Lease Arbitrator
# 职责说明: 维护人类前台交互租约，提供毫秒级抢占窗口续订、失效判定与防冲突断言
# ==============================================================================

class_name HumanControlLeaseManager
extends RefCounted

const DEFAULT_LEASE_WINDOW_MS: int = 3000

static var _last_human_activity_ms: int = -100000
static var _current_lease_holder: String = ""
static var _active_lease_nonce: int = 0

## 续订人类前台控制租约
static func renew_human_lease(account_id: String, lease_nonce: int, window_ms: int = DEFAULT_LEASE_WINDOW_MS) -> void:
  _last_human_activity_ms = Time.get_ticks_msec()
  _current_lease_holder = account_id
  _active_lease_nonce = lease_nonce

## 判定当前是否处于人类控制租约保护期
static func is_lease_active(account_id: String = "") -> bool:
  var now := Time.get_ticks_msec()
  if now - _last_human_activity_ms > DEFAULT_LEASE_WINDOW_MS:
    return false
  if not account_id.is_empty() and not _current_lease_holder.is_empty():
    return account_id == _current_lease_holder
  return true

## 显式主动释放人类控制租约（例如用户主动闲置或退出世界）
static func release_lease() -> void:
  _last_human_activity_ms = -100000
  _current_lease_holder = ""
  _active_lease_nonce = 0

static func reset_for_tests() -> void:
  release_lease()
```

### 2. 统一协议解析与路由调度器 (`UnifiedProtocolDispatcher`)

```gdscript
# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 统一协议调度器)
# 文件路径: res://backend/domains/world_state/services/unified_protocol_dispatcher.gd
# 架构定位: Domain Dispatcher / Entry Router
# 职责说明: 接收 ClientRequestEnvelopeDTO，统一实施租约裁决、鉴权校验与领域路由分发
# ==============================================================================

class_name UnifiedProtocolDispatcher
extends RefCounted

const EscMenuBackendService = preload("res://backend/domains/world_state/services/esc_menu_backend_service.gd")
const AgentActionExecutionSolver = preload("res://backend/domains/world_state/solvers/agent_action_execution_solver.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

## 核心派发入口：处理一切来自客户端或 Agent 包装的统一请求信封
static func dispatch_request(req: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
  if req == null:
    return UnifiedProtocolFactory.create_response(
      "", false, {}, "ERR_NULL_REQUEST", "请求信封不能为空"
    )

  # 1. 租约与并发冲突仲裁
  if req.actor_type == ClientRequestEnvelopeDTO.ACTOR_HUMAN_UI:
    HumanControlLeaseManager.renew_human_lease(req.account_id, req.lease_nonce)
  elif req.actor_type == ClientRequestEnvelopeDTO.ACTOR_AGENT:
    if HumanControlLeaseManager.is_lease_active(req.account_id):
      return UnifiedProtocolFactory.create_response(
        req.request_id, false, {}, "ERR_PREEMPTED_BY_HUMAN", "人类前台正在操作，Agent 动作已被抢占式阻断"
      )

  # 2. 按领域路由分发
  match req.domain:
    "world_state", "world_gateway", "lifecycle":
      if req.action_type.begins_with("ESC_"):
        return EscMenuBackendService.handle_esc_action(req, gateway)
      elif req.domain == "world_state" and req.actor_type == ClientRequestEnvelopeDTO.ACTOR_AGENT:
        # 兼容派发至 Agent 既有动作求解器
        return _dispatch_agent_action_compat(req)
    "game_settings":
      return _dispatch_settings_action(req)
    _:
      return UnifiedProtocolFactory.create_response(
        req.request_id, false, {}, "ERR_UNKNOWN_DOMAIN", "未知业务领域: %s" % req.domain
      )

  return UnifiedProtocolFactory.create_response(
    req.request_id, false, {}, "ERR_UNHANDLED_ACTION", "未支持的操作指令: %s" % req.action_type
  )

static func _dispatch_agent_action_compat(req: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
  var agent_pkt := AgentActionPacketDTO.new()
  agent_pkt.session_id = req.character_id
  agent_pkt.directive_id = req.action_type
  agent_pkt.params = req.payload
  agent_pkt.client_timestamp_ms = req.client_timestamp_ms
  var hud_snap := AuthoritativeHudSyncService.get_authoritative_snapshot({"account_id": req.account_id})
  var res := AgentActionExecutionSolver.validate_and_execute(agent_pkt, hud_snap, false)
  return UnifiedProtocolFactory.create_response(
    req.request_id,
    bool(res.get("success", false)),
    res,
    str(res.get("error_code", "")),
    str(res.get("cause", "")),
    res.get("causal_delta", {}) if res.has("causal_delta") else {}
  )

static func _dispatch_settings_action(req: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
  # 设置中心属性批量更新
  return UnifiedProtocolFactory.create_response(
    req.request_id, true, {"applied_settings": req.payload}, "", "设置应用成功"
  )
```

### 3. ESC 菜单后端联动服务 (`EscMenuBackendService`)

```gdscript
# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群)
# 文件路径: res://backend/domains/world_state/services/esc_menu_backend_service.gd
# 架构定位: Domain Service / Facade Orchestrator
# 职责说明: 集中处理 ESC 菜单各类操作（状态检测、安全存档、退回世界网关洗脱、退出桌面）
# ==============================================================================

class_name EscMenuBackendService
extends RefCounted

const SaveReadinessGuard = preload("res://backend/domains/world_state/guards/save_readiness_guard.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const GameLifecycleService = preload("res://backend/domains/lifecycle/game_lifecycle_service.gd")
const GameShutdownDTO = preload("res://backend/domains/lifecycle/dto/game_shutdown_dto.gd")
const GameLifecycleModel = preload("res://backend/domains/lifecycle/lifecycle_model.gd")
const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")

static func handle_esc_action(req: ClientRequestEnvelopeDTO, gateway: WorldGatewayFSM = null) -> UnifiedResponseEnvelopeDTO:
  match req.action_type:
    "ESC_QUERY_READINESS":
      var in_combat: bool = bool(req.payload.get("in_combat", false))
      var in_cutscene: bool = bool(req.payload.get("in_cutscene", false))
      var is_dead: bool = bool(req.payload.get("is_dead", false))
      var readiness := SaveReadinessGuard.evaluate_save_readiness(in_combat, in_cutscene, is_dead)
      return UnifiedProtocolFactory.create_response(
        req.request_id, true, readiness, "", "保存就绪状态查询成功"
      )

    "ESC_SAVE_GAME":
      var slot_id: String = str(req.payload.get("slot_id", "SLOT_01"))
      var mode: int = int(req.payload.get("game_mode", WorldGatewayModel.GameMode.SINGLE_PLAYER))
      var path_safety := SaveReadinessGuard.evaluate_storage_path_safety("user://offline_vault/%s.sav" % slot_id.to_lower(), mode)
      if not bool(path_safety.get("is_safe", false)):
        return UnifiedProtocolFactory.create_response(
          req.request_id, false, path_safety, "ERR_STORAGE_UNSAFE", "存储路径不符合模式隔离规范"
        )

      var save_res := SaveDataAccessLayer.save_game(slot_id, req.payload.get("game_data", {}))
      var ok := bool(save_res.get("success", false))
      return UnifiedProtocolFactory.create_response(
        req.request_id, ok, save_res,
        "" if ok else str(save_res.get("error_code", "ERR_SAVE_FAILED")),
        "存档保存成功" if ok else "存档保存失败"
      )

    "ESC_EXIT_TO_GATEWAY":
      if gateway == null:
        return UnifiedProtocolFactory.create_response(
          req.request_id, false, {}, "ERR_GATEWAY_NOT_BOUND", "未绑定当前世界的运行网关实例"
        )
      # 若指定 auto_save，执行前置快速刷盘
      if bool(req.payload.get("auto_save", true)) and not req.character_id.is_empty():
        SaveDataAccessLayer.save_game(gateway.context.selected_slot_id, {})

      # 触发网关全量内存洗脱
      var scrub_res := gateway.exit_to_gateway()
      HumanControlLeaseManager.release_lease()
      return UnifiedProtocolFactory.create_response(
        req.request_id, bool(scrub_res.get("success", false)), scrub_res, "", "已成功退出世界并洗脱网关内存"
      )

    "ESC_QUIT_GAME":
      var shut_req := GameShutdownDTO.Request.new()
      shut_req.session_token = req.session_token
      shut_req.account_id = req.account_id
      shut_req.exit_reason = GameLifecycleModel.ExitReason.USER_DESKTOP_QUIT
      shut_req.target_save_slot = str(req.payload.get("slot_id", "SLOT_01"))

      var shut_resp := GameLifecycleService.execute_graceful_shutdown(shut_req)
      HumanControlLeaseManager.release_lease()
      return UnifiedProtocolFactory.create_response(
        req.request_id, shut_resp.is_success, shut_resp.to_dto(),
        shut_resp.error_code, "五阶段安全停机管线已执行完毕"
      )

  return UnifiedProtocolFactory.create_response(
    req.request_id, false, {}, "ERR_INVALID_ESC_ACTION", "未识别的 ESC 指令: %s" % req.action_type
  )
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 2.1: 实现人类控制租约管理器 HumanControlLeaseManager
- [x] Step 2.2: 实现 ESC 菜单后端联动服务 EscMenuBackendService
- [x] Step 2.3: 实现全域统一协议调度解析器 UnifiedProtocolDispatcher

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-UPE-S2-01 | 人类租约管理器续订与抢占拦截 | 并发触发人类请求与 Agent 请求 | 人类请求获租约保护，Agent 在保护窗内被 ERR_PREEMPTED_BY_HUMAN 阻断 |
| TC-UPE-S2-02 | ESC 菜单后端联动服务调用闭环 | 依次调用 readiness, save, exit_to_gateway, quit_game | 真实穿透至持久化与生命周期底座，状态码符合预期 |
| TC-UPE-S2-03 | 统一协议调度解析器双轨分流 | 分发各类领域指令至对应领域服务 | 路由准确率 100%，响应格式严格统一 |
| TC-UPE-S2-04 | 协议对象零瞬态堆分配自测 | 高频反复派发 100 次指令 | 对象支持原位复用与安全重置，无多余堆内存泄漏 |
