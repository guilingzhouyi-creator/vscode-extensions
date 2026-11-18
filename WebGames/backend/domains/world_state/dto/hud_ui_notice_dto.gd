# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/dto/hud_ui_notice_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: AuthoritativeHudSyncService, AgentHudSliceSolver | 下游: AgentHudTelemetryPacketDTO | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 去表现化结构化 UI 消息与通知契约，剥离富文本和像素坐标，仅保留客观纯语义与绑定交互指令。
# 退出语义与设计依据: 主页HUD面向Agent结构化切片流与行动空间双通道适配引擎设计规范 (Inv-UI-FEED-STRUCTURAL-PURITY-9)
# ==============================================================================

## HudUiNoticeDTO：Value Object DTO / Data Transport Model
class_name HudUiNoticeDTO
extends PoolableDtoBase

var notice_id: String = "" # 唯一提示标识符 (如 "GUIDE_POTENTIAL_ALLOCATION")
var category: String = "INFO" # "INFO", "WARNING", "GUIDE", "MODAL"
var priority: int = 0 # 通知优先级 (数字越大优先级越高)
var title: String = "" # 纯文本标题
var body_text: String = "" # 纯文本正文 (严格剔除 BBCode 与 HTML)
var is_modal: bool = false # 是否阻断性模态框 (需优先响应)
var action_directive_ids: Array[String] = [] # 响应此通知绑定的动作指令 (如 ["DISMISS_UI_NOTICE", "CONFIRM_ALLOCATION"])

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
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
		"is_modal": is_modal,
		"action_directive_ids": action_directive_ids.duplicate()
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> HudUiNoticeDTO:
	var notice := HudUiNoticeDTO.new()
	notice.notice_id = str(serialized_payload.get("notice_id", ""))
	notice.category = str(serialized_payload.get("category", "INFO"))
	notice.priority = int(serialized_payload.get("priority", 0))
	notice.title = str(serialized_payload.get("title", ""))
	notice.body_text = str(serialized_payload.get("body_text", ""))
	notice.is_modal = bool(serialized_payload.get("is_modal", false))
	notice.action_directive_ids.clear()
	var raw_actions: Array = serialized_payload.get("action_directive_ids", [])
	for directive_entry in raw_actions:
		notice.action_directive_ids.append(str(directive_entry))
	return notice
