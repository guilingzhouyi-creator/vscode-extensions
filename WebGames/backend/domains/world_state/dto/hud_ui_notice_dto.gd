# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_ui_notice_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: AuthoritativeHudSyncService, AgentHudSliceSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 去表现化结构化 UI 消息与通知契约，剥离富文本和像素坐标，仅保留客观纯语义与绑定交互指令。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双轨适配引擎施工细则 (Inv-UI-FEED-STRUCTURAL-PURITY-9)
# ==============================================================================

## HudUiNoticeDTO：Value Object DTO / Data Transport Model
class_name HudUiNoticeDTO
extends RefCounted

var notice_id: String = ""         # 唯一提示标识符 (如 "GUIDE_POTENTIAL_ALLOCATION")
var category: String = "INFO"      # "INFO", "WARNING", "GUIDE", "MODAL"
var priority: int = 0              # 通知优先级 (数字越大优先级越高)
var title: String = ""             # 纯文本标题
var body_text: String = ""         # 纯文本正文 (严格剔除 BBCode 与 HTML)
var message_text: String:          # 兼容性属性
	get:
		return body_text if not body_text.is_empty() else title
	set(val):
		body_text = val
var is_modal: bool = false         # 是否阻断性模态框 (需优先响应)
var action_directive_ids: Array[String] = [] # 响应此通知绑定的动作指令 (如 ["DISMISS_UI_NOTICE", "CONFIRM_ALLOCATION"])
var actions: Array[String]:        # 兼容性属性
	get:
		return action_directive_ids
	set(val):
		action_directive_ids = val

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	notice_id = ""
	category = "INFO"
	priority = 0
	title = ""
	body_text = ""
	is_modal = false
	action_directive_ids.clear()

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"notice_id": notice_id,
		"category": category,
		"priority": priority,
		"title": title,
		"body_text": body_text,
		"message_text": body_text if not body_text.is_empty() else title,
		"is_modal": is_modal,
		"action_directive_ids": action_directive_ids.duplicate(),
		"actions": action_directive_ids.duplicate()
	}

## 从输入字典反序列化还原传输对象
static func from_dto(data: Dictionary) -> HudUiNoticeDTO:
	var dto := HudUiNoticeDTO.new()
	dto.notice_id = str(data.get("notice_id", ""))
	dto.category = str(data.get("category", "INFO"))
	dto.priority = int(data.get("priority", 0))
	dto.title = str(data.get("title", ""))
	dto.body_text = str(data.get("body_text", data.get("message_text", "")))
	dto.is_modal = bool(data.get("is_modal", false))
	dto.action_directive_ids.clear()
	var raw_actions: Array = data.get("action_directive_ids", data.get("actions", []))
	for act in raw_actions:
		dto.action_directive_ids.append(str(act))
	return dto
