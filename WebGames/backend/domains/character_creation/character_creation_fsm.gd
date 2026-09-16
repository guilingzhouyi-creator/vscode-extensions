# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/character_creation_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 以顺序状态机约束创角流程：角色名录入 → 性别选定 → 扩展参数确认 → 提交校验 → 持久化完成 → 开局事件激活。前序未完成禁止跃迁后续状态 （创角顺序不可逆不变量）；角色名长度/非法字符由 GameConfig 驱动。 关联细则: Phase 48 阶段2 §2.1（创角流程状态机）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterCreationFSM
extends RefCounted

# ==============================================================================
# 一、状态枚举与常量
# ==============================================================================

## 创角顺序状态机枚举：每个状态触发条件见行尾注释，状态只允许 +1 递增跃迁
enum CreationStep {
	IDLE,                    # 未开始
	NAME_INPUT_PENDING,      # 1. 待录入角色名
	GENDER_SELECT_PENDING,   # 2. 待选择性别
	EXTENSIONS_PENDING,      # 3. 待确认其他启用参数
	SUBMITTED_VALIDATING,    # 4. 提交校验中
	PERSISTED_COMPLETED,     # 5. 持久化完成
	OPENING_EVENT_TRIGGERED  # 6. 开局事件已激活
}

# ==============================================================================
# 二、状态与草稿（依赖注入）
# ==============================================================================

## 当前创角步骤（顺序状态机指针，决定下一步可执行操作）
var current_step: CreationStep = CreationStep.IDLE
## 创角请求草稿（字段逐步填充，提交后由 service 落档消费）
var draft_request: CharacterCreationRequestDTO = null

# ==============================================================================
# 三、顺序状态流转（核心算法）
# ==============================================================================

## 开始创角：校验状态机处于 IDLE（防重复开档）并登记账号/档位/世界草稿。
## 契约：非 IDLE 返回 STEP_MISMATCH 且不产生任何副作用；成功后跃迁 NAME_INPUT_PENDING。
func start_creation(account_id: String, slot_id: String, world_id: String) -> Dictionary:
	if current_step != CreationStep.IDLE:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "状态机未处于 IDLE，禁止重复开档" }
	draft_request = CharacterCreationRequestDTO.new()
	draft_request.account_id = account_id
	draft_request.slot_id = slot_id
	draft_request.world_id = world_id
	current_step = CreationStep.NAME_INPUT_PENDING
	return { "success": true, "step": current_step }

## 1. 设定角色名（长度 [min,max] + 禁用字符清单，均经配置表取值）。
## 契约：仅 NAME_INPUT_PENDING 可调用；trim 后长度越界返回 INVALID_NAME_LENGTH、
##       含禁用字符返回 DISALLOWED_NAME_CHARACTER；成功后跃迁 GENDER_SELECT_PENDING。
func set_character_name(c_name: String) -> Dictionary:
	if current_step != CreationStep.NAME_INPUT_PENDING:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "当前不可设置角色名" }

	var trimmed := c_name.strip_edges()
	var min_len: int = GameConfig.get_int("domains.character_creation", "rules/min_name_length", 2)
	var max_len: int = GameConfig.get_int("domains.character_creation", "rules/max_name_length", 16)
	var banned: Array = GameConfig.get_array("domains.character_creation", "rules/disallowed_name_characters", [])

	if trimmed.length() < min_len or trimmed.length() > max_len:
		return {
			"success": false,
			"error_code": "INVALID_NAME_LENGTH",
			"message": "角色名长度须在 %d 至 %d 字符之间" % [min_len, max_len]
		}
	for ch in banned:
		if trimmed.contains(str(ch)):
			return { "success": false, "error_code": "DISALLOWED_NAME_CHARACTER", "message": "角色名包含禁用字符" }

	draft_request.character_name = trimmed
	current_step = CreationStep.GENDER_SELECT_PENDING
	return { "success": true, "step": current_step, "name": trimmed }

## 2. 设定性别（种族允许性别枚举校验）。
## 契约：仅 GENDER_SELECT_PENDING 可调用；race_def 为空或性别不在
##       allowed_genders 时返回 GENDER_NOT_ALLOWED；成功后跃迁 EXTENSIONS_PENDING。
func set_gender(gender_str: String, race_def: RaceDefinitionDTO) -> Dictionary:
	if current_step != CreationStep.GENDER_SELECT_PENDING:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "当前不可选择性别" }

	var g_upper := gender_str.to_upper()
	if race_def == null or not race_def.allowed_genders.has(g_upper):
		return { "success": false, "error_code": "GENDER_NOT_ALLOWED", "message": "该种族不支持所选性别" }

	draft_request.selected_gender = g_upper
	current_step = CreationStep.EXTENSIONS_PENDING
	return { "success": true, "step": current_step, "gender": g_upper }

## 3. 提交扩展参数并锁定（深拷贝防外部突变）。
## 契约：仅 EXTENSIONS_PENDING 可调用；成功后跃迁 SUBMITTED_VALIDATING。
func finalize_extensions(extra_fields: Dictionary) -> Dictionary:
	if current_step != CreationStep.EXTENSIONS_PENDING:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "当前不可提交扩展参数" }

	draft_request.extra_custom_fields = extra_fields.duplicate(true)
	current_step = CreationStep.SUBMITTED_VALIDATING
	return { "success": true, "step": current_step }

## 4. 持久化完成（binder 成功后由 service 推进）。
## 契约：仅 SUBMITTED_VALIDATING 可调用；成功后跃迁 PERSISTED_COMPLETED。
func mark_persisted_completed() -> Dictionary:
	if current_step != CreationStep.SUBMITTED_VALIDATING:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "当前不可标记持久化完成" }
	current_step = CreationStep.PERSISTED_COMPLETED
	return { "success": true, "step": current_step }

## 5. 开局事件已激活（EventBus 发布后由 service 推进）。
## 契约：仅 PERSISTED_COMPLETED 可调用；成功后跃迁终态 OPENING_EVENT_TRIGGERED。
func mark_opening_triggered() -> Dictionary:
	if current_step != CreationStep.PERSISTED_COMPLETED:
		return { "success": false, "error_code": "STEP_MISMATCH", "message": "当前不可激活开局事件" }
	current_step = CreationStep.OPENING_EVENT_TRIGGERED
	return { "success": true, "step": current_step }
