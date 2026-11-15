# ==============================================================================
# 模块归属: 前端表现层 (Frontend · 权威角色创建与命途轮盘界面)
# 文件路径: res://frontend/views/character_creation/character_creation_view.gd
# 架构定位: BaseScreen Screen Controller
# 依赖与触发: 上游: NavManager, WorldGatewayView | 下游: ServiceLocator(ICharacterService/IWorldService), UIIntermediary
# 职责说明: 承载从世界网关分流进入的权威角色创建界面，获取创角快照、支持命途轮盘预览重骰、
#           完成权威创角与进入世界握手并按 prologue_required 分流至序章或主界面。
# 退出语义与设计依据: 表现层零业务计算与域边界隔离契约；支持经 NavManager.pop_screen 无损退回世界网关
# ==============================================================================

## CharacterCreationView：权威角色创建与命途轮盘页面主控制器
class_name CharacterCreationView
extends BaseScreen

const CharacterCreationRenderHelper = preload("res://frontend/views/character_creation/character_creation_render_helper.gd")

@onready var title_label: Label = %TitleLabel
@onready var world_slot_badge_label: Label = %WorldSlotBadgeLabel
@onready var back_btn: Button = %BackBtn
@onready var status_banner_label: Label = %StatusBannerLabel
@onready var name_header_label: Label = %NameHeaderLabel
@onready var character_name_edit: LineEdit = %CharacterNameEdit
@onready var origin_header_label: Label = %OriginHeaderLabel
@onready var origin_option_button: OptionButton = %OriginOptionButton
@onready var trait_header_label: Label = %TraitHeaderLabel
@onready var trait_option_button: OptionButton = %TraitOptionButton
@onready var control_hints_label: Label = %ControlHintsLabel
@onready var preview_header_label: Label = %PreviewHeaderLabel
@onready var destiny_preview_rich_label: RichTextLabel = %DestinyPreviewRichLabel
@onready var error_status_label: Label = %ErrorStatusLabel
@onready var reroll_btn: Button = %RerollBtn
@onready var confirm_create_btn: Button = %ConfirmCreateBtn

var current_account_id: String = ""
var current_session_token: String = ""
var current_world_id: String = ""
var current_slot_id: String = ""
var available_origins: Array = []
var available_trait_pairs: Array = []
var creation_ui_controls: Dictionary = {
	"allow_manual_origin_select": false,
	"allow_manual_trait_select": false,
	"allow_attribute_reroll": false
}
var selected_origin_id: String = ""
var selected_positive_trait: String = ""
var reroll_nonce: int = 0
var preview_snapshot: Dictionary = {}
var last_error_code: String = ""


func _ready() -> void:
	var theme_manager := ThemeManager.get_instance()
	if theme_manager.theme != null:
		theme = theme_manager.theme
	CharacterCreationRenderHelper.init_static_text(self)
	UIIntermediary.adapt_view(self)


## 进入权威创角屏幕时同步导航上下文，加载创角适配快照并初始化命途预览
func on_screen_enter(screen_parameters: Dictionary = {}) -> void:
	super.on_screen_enter(screen_parameters)
	_sync_navigation_context_properties(screen_parameters, {
		"world_id": "current_world_id",
		"slot_id": "current_slot_id"
	})
	reroll_nonce = 0
	selected_origin_id = ""
	selected_positive_trait = ""
	preview_snapshot = {}
	last_error_code = ""
	load_creation_snapshot(func(_reply: Dictionary) -> void:
		roll_destiny_preview(false)
	)


## 统一快照渲染映射：重绘创角受控选项与命途轮盘预览状态
func _render_from_snapshot() -> void:
	if snapshot.has("creation_ui_snapshot") and snapshot.get("creation_ui_snapshot") is Dictionary:
		_extract_creation_snapshot(snapshot.get("creation_ui_snapshot") as Dictionary)
	elif snapshot.has("available_origins") or snapshot.has("available_trait_pairs") or snapshot.has("ui_controls"):
		_extract_creation_snapshot(snapshot)
	if snapshot.has("preview") and snapshot.get("preview") is Dictionary:
		preview_snapshot = (snapshot.get("preview") as Dictionary).duplicate(true)
	if snapshot.has("error_code"):
		last_error_code = FrontendSnapshot.read_string(snapshot, "error_code", "")
	CharacterCreationRenderHelper.render_all(self)


## 从领域边界服务拉取创角只读 UI 适配快照
func load_creation_snapshot(on_completed: Callable = Callable()) -> Dictionary:
	var character_service: ICharacterService = ServiceLocator.get_instance().character()
	if character_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	var reply_holder: Dictionary = {}
	character_service.get_creation_ui_snapshot_async(
		current_account_id,
		current_session_token,
		func(response_payload: Dictionary) -> void:
			reply_holder.merge(response_payload, true)
			if bool(response_payload.get("success", false)):
				var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
				apply_snapshot(data_map)
			else:
				last_error_code = str(response_payload.get("error_code", "ERR_SNAPSHOT_LOAD_FAILED"))
				CharacterCreationRenderHelper.render_all(self)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return reply_holder


## 触发权威命途轮盘预览计算并更新右侧只读摘要
func roll_destiny_preview(increment_nonce: bool = true, on_completed: Callable = Callable()) -> Dictionary:
	var character_service: ICharacterService = ServiceLocator.get_instance().character()
	if character_service == null:
		return ServiceLocator.reply_service_unavailable(on_completed)
	if increment_nonce:
		if not bool(creation_ui_controls.get("allow_attribute_reroll", false)):
			NavManager.get_instance().show_toast(UIIntermediary.text("ui.cc.toast.reroll_disabled"), NavTypes.ToastLevel.WARNING)
			var blocked_reply := {"success": false, "error_code": "ERR_REROLL_DISABLED"}
			if on_completed.is_valid():
				on_completed.call(blocked_reply)
			return blocked_reply
		reroll_nonce += 1
	var request_payload := _build_request_payload(true)
	var reply_holder: Dictionary = {}
	character_service.roll_destiny_preview_async(
		current_account_id,
		current_session_token,
		request_payload,
		func(response_payload: Dictionary) -> void:
			reply_holder.merge(response_payload, true)
			if bool(response_payload.get("success", false)):
				var data_map: Dictionary = response_payload.get("data", response_payload) as Dictionary
				last_error_code = ""
				apply_snapshot({"preview": data_map, "error_code": ""})
			else:
				last_error_code = str(response_payload.get("error_code", "ERR_ROLL_FAILED"))
				CharacterCreationRenderHelper.render_error_status(self)
			if on_completed.is_valid():
				on_completed.call(response_payload)
	)
	return reply_holder

func _extract_creation_snapshot(source_payload: Dictionary) -> void:
	available_origins = FrontendSnapshot.read_array(source_payload, "available_origins")
	if available_origins.is_empty() and source_payload.has("available_origins_list"):
		available_origins = FrontendSnapshot.read_array(source_payload, "available_origins_list")
	available_trait_pairs = FrontendSnapshot.read_array(source_payload, "available_trait_pairs")
	if available_trait_pairs.is_empty() and source_payload.has("available_traits_list"):
		available_trait_pairs = FrontendSnapshot.read_array(source_payload, "available_traits_list")
	var raw_controls: Variant = source_payload.get("ui_controls", source_payload.get("creation_ui_controls", null))
	if raw_controls is Dictionary:
		var control_flags := raw_controls as Dictionary
		creation_ui_controls = {
			"allow_manual_origin_select": bool(control_flags.get("allow_manual_origin_select", false)),
			"allow_manual_trait_select": bool(control_flags.get("allow_manual_trait_select", false)),
			"allow_attribute_reroll": bool(control_flags.get("allow_attribute_reroll", false))
		}
	if not bool(creation_ui_controls.get("allow_manual_origin_select", false)):
		selected_origin_id = ""
	if not bool(creation_ui_controls.get("allow_manual_trait_select", false)):
		selected_positive_trait = ""


func _build_request_payload(for_preview: bool) -> Dictionary:
	var raw_name := character_name_edit.text.strip_edges() if character_name_edit != null else ""
	if raw_name.is_empty() and for_preview:
		raw_name = UIIntermediary.text("ui.cc.preview.fallback_name")
	var payload: Dictionary = {
		"world_id": current_world_id,
		"slot_id": current_slot_id,
		"slot_index": _resolve_slot_index(current_slot_id),
		"character_name": raw_name,
		"name": raw_name,
		"reroll_nonce": reroll_nonce
	}
	if bool(creation_ui_controls.get("allow_manual_origin_select", false)) and not selected_origin_id.is_empty():
		payload["selected_origin_id"] = selected_origin_id
	if bool(creation_ui_controls.get("allow_manual_trait_select", false)) and not selected_positive_trait.is_empty():
		payload["selected_positive_trait"] = selected_positive_trait
	return payload


func _resolve_slot_index(slot_id_text: String) -> int:
	var parsed := slot_id_text.to_int()
	return maxi(1, parsed) if parsed > 0 else 1
