# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/save_slot_character_binder.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 完成「后端派生属性 → 构造角色档案 → 绑定目标档位 → 生成开局事件包」 的原子落档。档位状态以 Dictionary 数据契约传入/回写，键集与 Phase 47 `SaveSlotStateDTO.to_dto()` 对齐（slot_id/account_id/bound_world_id/ bound_character_id/is_occupied/is_first_creation/last_played_timestamp_utc）， 规避对 P47 world_gateway 域（在途未 import）的跨文件类引用。 关联细则: Phase 48 阶段2 §2.3（档位绑定与开局事件触发器）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name SaveSlotCharacterBinder
extends RefCounted

# ==============================================================================
# 一、核心算法（原子落档）
# ==============================================================================

## 原子提交：校验档位占用 → 唯一角色 ID → 后端派生属性 → 构造 CharacterProfile
## → 档位绑定回写 → 生成 OpeningEventStreamDTO。
## 契约：request/slot_state 为空返回 INVALID_INPUT；slot_id 缺失返回 INVALID_SLOT_ID；
##       slot 已占用返回 SLOT_ALREADY_OCCUPIED（禁止覆盖创建）；
##       slot_state 原地更新并随结果返回（dict 引用语义）。
static func commit_creation_and_bind_slot(
	request: CharacterCreationRequestDTO,
	slot_state: Dictionary,
	race_def: RaceDefinitionDTO
) -> Dictionary:
	var res := {}
	if request == null or slot_state.is_empty():
		return { "success": false, "error_code": "INVALID_INPUT", "message": "请求或档位数据为空" }

	var slot_id := str(slot_state.get("slot_id", ""))
	var account_id := str(slot_state.get("account_id", ""))
	if slot_id.is_empty():
		return { "success": false, "error_code": "INVALID_SLOT_ID", "message": "档位 ID 缺失" }

	if bool(slot_state.get("is_occupied", false)) and not str(slot_state.get("bound_character_id", "")).is_empty():
		return { "success": false, "error_code": "SLOT_ALREADY_OCCUPIED", "message": "目标档位已存在角色，禁止覆盖创建" }

	# 1. 派生唯一角色 ID（档位维度稳定；账号下 slot 唯一 → 角色 ID 唯一）
	var new_char_id := "CHAR_%s_%s" % [account_id, slot_id]

	# 2. 后端权威生成属性等级（L1 层；L2 系数/L3 实值由既有生理底座承接）
	var baseline_stats := CharacterBaselineAttributeSolver.generate_baseline_attributes(race_def)
	var attribute_levels: Dictionary = baseline_stats.get("attribute_levels", {})

	# 3. 构造角色档案（character_id/character_name 直挂，种族/性别/属性入 attributes）
	var profile := CharacterProfile.new()
	profile.character_id = new_char_id
	profile.character_name = request.character_name
	profile.attributes = {
		"race_id": request.selected_race_id,
		"gender": request.selected_gender,
		"attribute_levels": attribute_levels.duplicate(true)
	}

	# 4. 绑定档位（原地回写；首次创建标记消费后置 false）
	var was_first_creation := bool(slot_state.get("is_first_creation", true))
	slot_state["bound_character_id"] = new_char_id
	slot_state["is_occupied"] = true
	slot_state["is_first_creation"] = false
	slot_state["last_played_timestamp_utc"] = int(Time.get_unix_time_from_system())

	# 5. 生成开局事件包
	var opening := OpeningEventStreamDTO.new()
	opening.event_id = "EVT_OPENING_%s" % new_char_id
	opening.account_id = account_id
	opening.slot_id = slot_id
	opening.world_id = str(slot_state.get("bound_world_id", request.world_id))
	opening.character_id = new_char_id
	opening.character_name = request.character_name
	opening.is_first_time_creation = was_first_creation
	opening.starting_location_id = GameConfig.get_string("domains.character_creation", "defaults/starting_location", "CENTRAL_CITY_PLAZA")
	opening.opening_quest_line_id = GameConfig.get_string("domains.character_creation", "defaults/initial_quest_line", "QUEST_PROLOGUE_01")
	opening.timestamp_utc = int(Time.get_unix_time_from_system())
	opening.narrative_context = {
		"welcome_message": "欢迎来到卡拉尔世界，冒险者 %s！" % request.character_name
	}

	res["success"] = true
	res["character_profile"] = profile
	res["opening_event"] = opening
	res["attribute_levels"] = attribute_levels
	res["slot_state"] = slot_state
	return res
