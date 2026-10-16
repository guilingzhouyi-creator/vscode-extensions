# 施工细则：Phase 122 前端主页HUD事件桥接与ESC系统菜单后端联动引擎 —— 阶段3：EventBus事件桥接双轨分发与前端表现层无缝接线

> [!NOTE]
> **【施工目标】**：实现主页 HUD 事件桥接器（HudEventBridge），完成与 EventBusCore 双信道的单源订阅接线；将前端表现层视图（MainHUDView、MainHUDSubpanels、SystemSaveView）的 ESC 交互无缝接入 UnifiedProtocolFactory 与 UnifiedProtocolDispatcher，消融纯 Mock 跳板，实现前后端真实联动。
> **【授权依据】**：已获项目负责人/用户明确授权——在短期施工区正式立项 Phase 122。
> **【需求溯源】**：阶段 1 协议工厂与阶段 2 统一协议调度器 + 前端零接线高保真白模架构治理。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [阶段 1 统一协议工厂与双轨请求信封及 ESC 交互契约规范设计](阶段1_统一协议工厂与双轨请求信封及ESC交互契约规范设计.md)
  * [阶段 2 统一协议解析调度器与双轨请求适配及 ESC 服务实现](阶段2_统一协议解析调度器与双轨请求适配及ESC服务实现.md)
  * [`EventBusCore`](../../../../backend/infrastructure/event_bus/event_bus_core.gd)：全域事件总线单例与信道分发
  * [`main_hud_view.gd`](../../../../frontend/views/main_hud/main_hud_view.gd) 与 [`main_hud_subpanels.gd`](../../../../frontend/views/main_hud/main_hud_subpanels.gd)：主界面表现层宿主
* **核心不变量约束断言**：
  * **Inv-SINGLE-SOURCE-SUBSCRIPTION-1**：任一 EventBusCore 信道在主页 HUD 侧至多存在一个唯一订阅点（由 `HudEventBridge` 统一管理），严禁子面板与散落控件各自私建监听；
  * **Inv-PRESENTATION-ZERO-CALC-2**：前端视图控制器（`MainHUDView` 等）接收到桥接器推送后，一律调用既有 `apply_snapshot()` 单向灌入数据，表现层严格保持 0 业务公式计算与 0 状态伪造；
  * **Inv-IDEMPOTENT-ATTACH-DETACH-3**：`HudEventBridge` 的 `attach_hud()` 与 `detach_hud()` 必须具备绝对幂等性，视图销毁（`NOTIFICATION_PREDELETE`）时必须 100% 释放事件句柄，杜绝跨场景内存泄漏。
* **防漂移最高指示**：严格遵守 LF 换行契约，严禁引入施工批次与敏捷工期临时标记，保持 ELOC 与圈复杂度低认知名义。

---

## 一、 核心组件设计与实现

### 1. 主页 HUD 事件桥接器 (`HudEventBridge`)

```gdscript
# ==============================================================================
# 模块归属: 前端系统层 (Frontend · 主页 HUD 事件桥接中枢)
# 文件路径: res://frontend/systems/hud_event_bridge.gd
# 架构定位: Presentation Bridge / Event Adapter
# 职责说明: 单源监听 EventBusCore 四通信道，将领域事件与快照转换为前端轻量渲染快照，驱动 MainHUDView 单向刷新
# ==============================================================================

class_name HudEventBridge
extends RefCounted

const MainHUDView = preload("res://frontend/views/main_hud/main_hud_view.gd")
const EventBusCore = preload("res://backend/infrastructure/event_bus_core.gd")
const AuthoritativeHudSnapshotDTO = preload("res://backend/domains/world_state/dto/authoritative_hud_snapshot_dto.gd")
const FrontendHudSnapshot = preload("res://frontend/domain_boundary/contracts/frontend_hud_snapshot.gd")

static var _instance: HudEventBridge = null
static func get_instance() -> HudEventBridge:
  if _instance == null:
    _instance = HudEventBridge.new()
  return _instance

var _view_ref: WeakRef = null
var _is_attached: bool = false
var _bus_tokens: Array = []

## 绑定主页 HUD 视图宿主（幂等）
func attach_hud(view: MainHUDView) -> void:
  if view == null:
    return
  if _is_attached and _view_ref != null and _view_ref.get_ref() == view:
    return
  detach_hud()

  _view_ref = weakref(view)
  _is_attached = true
  _setup_bus_subscriptions()

## 解绑主页 HUD 并注销事件总线监听（幂等·防泄漏）
func detach_hud() -> void:
  for tok in _bus_tokens:
    if tok != null and tok.has_method("unbind"):
      tok.unbind()
  _bus_tokens.clear()
  _view_ref = null
  _is_attached = false

func _setup_bus_subscriptions() -> void:
  var bus := EventBusCore.get_instance()
  if bus == null:
    return

  # 1. 订阅权威 HUD 快照全量推流信道
  var t1 = bus.on_channel("world_state.hud_snapshot_published", _on_authoritative_snapshot_received)
  _bus_tokens.append(t1)

  # 2. 订阅钱包变更增量同步
  var t2 = bus.on_channel("currency.wallet.mutated", _on_wallet_mutated)
  _bus_tokens.append(t2)

  # 3. 订阅序章与剧情叙事步进事件
  var t3 = bus.on_channel("prologue.step_advanced", _on_prologue_advanced)
  _bus_tokens.append(t3)

  # 4. 订阅世界进入与网关事件
  var t4 = bus.on_channel("world_gateway.world_entered", _on_world_entered)
  _bus_tokens.append(t4)

func _on_authoritative_snapshot_received(pkt: Variant) -> void:
  var view: MainHUDView = _get_view()
  if view == null:
    return
  var payload: Dictionary = pkt.payload_data if (pkt != null and pkt.get("payload_data") is Dictionary) else {}
  if payload.is_empty():
    return

  # 将后端权威快照转为前端快照字典并注入
  var snap_dict: Dictionary = {
    "account_id": payload.get("account_id", ""),
    "character_name": payload.get("character_name", ""),
    "hp_current": payload.get("hp_current", 100.0),
    "hp_max": payload.get("hp_max", 100.0),
    "mp_current": payload.get("mp_current", 50.0),
    "mp_max": payload.get("mp_max", 50.0),
    "ap_current": payload.get("ap_current", 10.0),
    "ap_max": payload.get("ap_max", 10.0),
    "gold": payload.get("wallet_gold", 0),
    "mana_monocrystals": payload.get("wallet_mana_monocrystals", 0),
    "level": payload.get("level", 1)
  }
  view.apply_snapshot(snap_dict)

func _on_wallet_mutated(pkt: Variant) -> void:
  var view: MainHUDView = _get_view()
  if view == null:
    return
  var payload: Dictionary = pkt.payload_data if (pkt != null and pkt.get("payload_data") is Dictionary) else {}
  var gold: int = int(payload.get("current_gold", payload.get("gold", view.wallet_gold)))
  var crystals: int = int(payload.get("current_crystals", payload.get("crystals", view.wallet_mana_crystals)))
  view.apply_snapshot({"gold": gold, "mana_monocrystals": crystals})

func _on_prologue_advanced(pkt: Variant) -> void:
  var view: MainHUDView = _get_view()
  if view == null:
    return
  var payload: Dictionary = pkt.payload_data if (pkt != null and pkt.get("payload_data") is Dictionary) else {}
  var text: String = str(payload.get("narrative_text", payload.get("text", "")))
  if not text.is_empty():
    view.append_terminal_log("NARRATIVE", text)

func _on_world_entered(pkt: Variant) -> void:
  var view: MainHUDView = _get_view()
  if view == null:
    return
  view.append_battle_log("SYSTEM", "已成功同步世界权威状态")

func _get_view() -> MainHUDView:
  if not _is_attached or _view_ref == null:
    return null
  return _view_ref.get_ref() as MainHUDView
```

### 2. 前端表现层视图接线改造 (`MainHUDSubpanels` 与 `SystemSaveView`)

在 [`main_hud_subpanels.gd`](../../../../frontend/views/main_hud/main_hud_subpanels.gd) 中，消融单纯本地假跳转，统一调用协议工厂组装请求：

```gdscript
# 改造点 1: 打开 ESC 菜单时异步查询保存就绪状态，动态控制界面保存按钮可用性
func toggle_main_menu() -> void:
  if _view == null or _view._main_menu_panel == null:
    return
  _view.main_menu_visible = not _view.main_menu_visible
  _view._main_menu_panel.visible = _view.main_menu_visible
  if _view.main_menu_visible:
    append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_opened"))
    # 触发保存就绪态主动检测
    _query_and_refresh_save_readiness()
  else:
    append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.menu_closed"))

func _query_and_refresh_save_readiness() -> void:
  var req := UnifiedProtocolFactory.create_human_request(
    "world_state", "ESC_QUERY_READINESS", {"in_combat": false, "in_cutscene": false}
  )
  var resp := UnifiedProtocolDispatcher.dispatch_request(req)
  var is_ready: bool = bool(resp.data.get("is_ready", true))
  # 若不可保存，对菜单内保存按钮实施视觉置灰与提示
  if _view._menu_btn_settings:
    _view._menu_btn_settings.tooltip_text = "" if is_ready else "当前处于特殊状态，暂时不可保存"

# 改造点 2: 点击退出游戏 -> 触发统一协议优雅停机
func on_menu_exit_pressed() -> void:
  append_battle_log("SYSTEM", UIIntermediary.text("ui.fe02.battle_log.exit_game"))
  var req := UnifiedProtocolFactory.create_human_request(
    "lifecycle", "ESC_QUIT_GAME", {"slot_id": "SLOT_01"}
  )
  var resp := UnifiedProtocolDispatcher.dispatch_request(req)
  if resp.success:
    # 停机成功，平稳退出桌面
    _view.get_tree().quit(0)
  else:
    NavManager.get_instance().show_toast("优雅停机失败，已安全取消退出", NavTypes.ToastLevel.ERROR)

# 改造点 3: 退出到世界档案 -> 触发网关内存全量洗脱并重置页面
func on_menu_exit_to_gateway_pressed(gateway: WorldGatewayFSM) -> void:
  var req := UnifiedProtocolFactory.create_human_request(
    "world_gateway", "ESC_EXIT_TO_GATEWAY", {"auto_save": true}
  )
  var resp := UnifiedProtocolDispatcher.dispatch_request(req, gateway)
  if resp.success:
    NavManager.get_instance().replace_screen("account_entry")
  else:
    NavManager.get_instance().show_toast("退出世界失败: " + resp.error_message, NavTypes.ToastLevel.ERROR)
```

---

## 二、 通道路由单源配置 (`hud_event_bridge.json`)

在 `config/frontend/views/hud_event_bridge.json` 中定义通道路由与降级策略，消融硬编码：

```json
{
  "_meta": {
    "version": "1.0.0",
    "description": "主页HUD事件桥接器通道白名单与策略路由配置"
  },
  "subscribed_channels": [
    {
      "channel": "world_state.hud_snapshot_published",
      "handler": "on_authoritative_snapshot_received",
      "priority": 100,
      "payload_schema": "authoritative_hud_snapshot"
    },
    {
      "channel": "currency.wallet.mutated",
      "handler": "on_wallet_mutated",
      "priority": 90,
      "payload_schema": "wallet_mutation"
    },
    {
      "channel": "prologue.step_advanced",
      "handler": "on_prologue_advanced",
      "priority": 80,
      "payload_schema": "prologue_event"
    },
    {
      "channel": "world_gateway.world_entered",
      "handler": "on_world_entered",
      "priority": 70,
      "payload_schema": "world_entry"
    }
  ],
  "fallback_policy": {
    "unregistered_channel_action": "IGNORE_OR_SYSTEM_LOG",
    "missing_field_fallback": "RETAIN_LAST_SNAPSHOT"
  }
}
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 编写主页 HUD 事件桥接器 HudEventBridge
- [x] Step 3.2: 接入 MainHUDView 与 MainHUDSubpanels 表现层联动
- [x] Step 3.3: 配置 hud_event_bridge.json 规则白名单

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-UPE-S3-01 | HUD 事件桥接器生命周期与幂等挂载 | 连续调用 attach_hud 与 detach_hud | 弱引用管理正确，无死引用残留，重复调用幂等安全 |
| TC-UPE-S3-02 | EventBus 信号推送与轻量快照灌入 | 发射 hud_snapshot_published 领域事件 | 桥接器成功拦截并单向驱动 apply_snapshot 刷新视图 |
| TC-UPE-S3-03 | 前端 ESC 菜单真实后端联动交互 | 触发菜单退出世界与退出游戏按钮 | 成功向 UnifiedProtocolDispatcher 发射信封并处理结果 |
| TC-UPE-S3-04 | 视图表现层零业务逻辑计算核查 | 审查 MainHUDView 与 Subpanels 代码 | 表现层无业务结算与数值公式，严格保持数据向表现单向流动 |
