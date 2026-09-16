# ==============================================================================
# 单元测试：配置驱动角色创建系统升级与开局事件流接入 (Phase 48 专属测试套件)
# 文件路径: res://tests/integration/pipelines/test_character_creation_and_opening_pipeline.gd
# 职责: 验证 RaceDefinitionDTO 配置驱动种族元数据、创角顺序状态机防跃迁、
#       后端权威属性派生防伪（前端伪造战斗属性零信任丢弃）、首次开档开局事件
#       流广播、种族扩展灰度拦截，以及世界栏网关到开局叙事全链路无断裂。
# 需求源: Phase 48 (TC-CC-01 ~ TC-CC-06 验收矩阵)
# ==============================================================================
class_name TestCharacterCreationAndOpeningPipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_basic_name_and_display_name_unification())
	results.append(_test_race_extensibility_and_non_hardcoded_validation())
	results.append(_test_backend_authority_stat_generation_and_anti_spoofing())
	results.append(_test_first_creation_opening_event_stream_dispatch())
	results.append(_test_race_expansion_canary_gating())
	results.append(_test_full_lifecycle_gateway_to_opening_narrative())

	var all_passed := true
	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
		else:
			all_passed = false

	return {
		"domain": "Character Creation & Opening Event Stream Pipeline (Phase 48)",
		"all_passed": all_passed,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"results": results
	}


## 构造一个空档（首次开档）的档位状态字典（键集与 SaveSlotStateDTO.to_dto() 对齐）
static func _fresh_slot_state(account_id: String, world_id: String = "WORLD_DEFAULT_SP_01") -> Dictionary:
	return {
		"slot_id": "SLOT_SP_01",
		"account_id": account_id,
		"bound_world_id": world_id,
		"bound_character_id": "",
		"is_occupied": false,
		"is_first_creation": true,
		"created_timestamp_utc": 0,
		"last_played_timestamp_utc": 0
	}


## TC-CC-01: 基础字段创角与名字单一源头
static func _test_basic_name_and_display_name_unification() -> Dictionary:
	var req := CharacterCreationRequestDTO.new()
	req.account_id = "ACC_CC_01"
	req.slot_id = "SLOT_SP_01"
	req.world_id = "WORLD_DEFAULT_SP_01"
	req.character_name = "晨曦骑士"
	req.selected_race_id = "HUMAN"
	req.selected_gender = "MALE"

	var slot := _fresh_slot_state("ACC_CC_01")
	var res := CharacterCreationService.process_character_creation(req, slot, {})

	var ok: bool = bool(res.get("success", false))
	var profile: CharacterProfile = res.get("character_profile", null)
	var opening_ev: OpeningEventStreamDTO = res.get("opening_event", null)
	var name_ok: bool = profile != null and profile.character_name == "晨曦骑士"
	# 名字单一源头：角色档案名 == 开局事件名 == 请求名（无第二套展示名体系）
	var display_ok: bool = opening_ev != null and profile != null \
		and opening_ev.character_name == profile.character_name \
		and profile.character_name == req.character_name
	var step_ok: bool = int(res.get("fsm_step", -1)) == CharacterCreationFSM.CreationStep.OPENING_EVENT_TRIGGERED
	var occupied_ok: bool = bool(slot.get("is_occupied", false))

	var passed: bool = ok and name_ok and display_ok and step_ok and occupied_ok
	return { "test": "TC-CC-01: 基础字段创角成功且角色名为唯一展示名源头", "passed": passed }


## TC-CC-02: 种族数据结构可扩展性（配置驱动，非写死逻辑）
static func _test_race_extensibility_and_non_hardcoded_validation() -> Dictionary:
	var catalog: Dictionary = GameConfig.get_dict("domains.character_creation", "races_catalog", {})
	var human_present: bool = catalog.has("HUMAN")
	var elf_present: bool = catalog.has("ELF")

	var human := RaceDefinitionDTO.from_dto(catalog.get("HUMAN", {}))
	var elf := RaceDefinitionDTO.from_dto(catalog.get("ELF", {}))
	var human_enabled: bool = human.is_enabled and human.allowed_genders.has("MALE")
	var elf_reserved: bool = (not elf.is_enabled) and elf.canary_feature_tag == "FEATURE_RACE_EXPANSION"

	# 伪造一个扩展种族词条经 DTO 装配，验证结构驱动（HUMAN 写死分支为 0）
	var proto: Dictionary = (catalog.get("HUMAN", {}) as Dictionary).duplicate(true)
	proto["race_id"] = "ORC"
	proto["is_enabled"] = false
	var orc := RaceDefinitionDTO.from_dto(proto)
	var structural_ok: bool = orc.race_id == "ORC" and orc.base_stat_modifiers.has("STR")

	var passed: bool = human_present and elf_present and human_enabled and elf_reserved and structural_ok
	return { "test": "TC-CC-02: 种族元数据配置驱动可扩展（人族启用 + 精灵灰度预留 + 结构装配）", "passed": passed }


## TC-CC-03: 后端权威属性派生 + 前端伪造战斗属性零信任丢弃
static func _test_backend_authority_stat_generation_and_anti_spoofing() -> Dictionary:
	var req := CharacterCreationRequestDTO.new()
	req.account_id = "ACC_CC_03"
	req.slot_id = "SLOT_SP_01"
	req.world_id = "WORLD_DEFAULT_SP_01"
	req.character_name = "铁壁卫"
	req.selected_race_id = "HUMAN"
	req.selected_gender = "MALE"
	# 模拟前端伪造提交：extra_custom_fields 携带六维战斗属性
	req.extra_custom_fields = { "STR": 999, "CON": 999, "hair_color": "银白" }

	var slot := _fresh_slot_state("ACC_CC_03")
	var res := CharacterCreationService.process_character_creation(req, slot, {})
	var ok: bool = bool(res.get("success", false))

	# 伪造键应被守卫丢弃：hair_color 保留、六维键被剔除
	var kept_ok: bool = req.extra_custom_fields.has("hair_color")
	var forged_removed: bool = (not req.extra_custom_fields.has("STR")) and (not req.extra_custom_fields.has("CON"))

	# 人族基线：六维全 3（无种族修正）——属性等级存于档案 attributes（内化版仅透传档案与事件）
	var profile: CharacterProfile = res.get("character_profile", null)
	var attr: Dictionary = profile.attributes if profile != null else {}
	var levels: Dictionary = attr.get("attribute_levels", {})
	var six_stats := ["STR", "CON", "INT", "AGI", "SPR", "VIT"]
	var all_three := true
	for stat in six_stats:
		if int(levels.get(stat, -1)) != 3:
			all_three = false

	var passed: bool = ok and kept_ok and forged_removed and all_three
	return { "test": "TC-CC-03: 后端按种族基线权威派生六维 [3,3,3,3,3,3] 并丢弃前端伪造属性", "passed": passed }


## TC-CC-04: 首次开档开局事件流广播（EventBus 订阅验证）
static func _test_first_creation_opening_event_stream_dispatch() -> Dictionary:
	var req := CharacterCreationRequestDTO.new()
	req.account_id = "ACC_CC_04"
	req.slot_id = "SLOT_SP_01"
	req.world_id = "WORLD_DEFAULT_SP_01"
	req.character_name = "林间诗人"
	req.selected_race_id = "HUMAN"
	req.selected_gender = "FEMALE"

	var slot := _fresh_slot_state("ACC_CC_04")
	var seen_channels: Array = []
	var bus = EventBusCore.get_instance()
	var cb := func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		seen_channels.append(str(w.get("channel", "")))
	var tok := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, cb)

	var res := CharacterCreationService.process_character_creation(req, slot, {})
	tok.unbind()

	var ok: bool = bool(res.get("success", false))
	var opening: OpeningEventStreamDTO = res.get("opening_event", null)
	var event_fields_ok: bool = opening != null \
		and opening.account_id == "ACC_CC_04" \
		and opening.slot_id == "SLOT_SP_01" \
		and opening.world_id == "WORLD_DEFAULT_SP_01" \
		and not opening.character_id.is_empty() \
		and opening.is_first_time_creation
	var broadcast_ok: bool = seen_channels.has("opening_narrative.triggered") \
		and seen_channels.has("character_creation.completed")
	var location_ok: bool = opening != null and not opening.starting_location_id.is_empty()

	var passed: bool = ok and event_fields_ok and broadcast_ok and location_ok
	return { "test": "TC-CC-04: 首开档触发开局事件流广播（含首次标记与完整上下文）", "passed": passed }


## TC-CC-05: 种族扩展灰度开关限制（非白名单拦截 / 白名单放行）
static func _test_race_expansion_canary_gating() -> Dictionary:
	var flag := FeatureToggleAggregate.FeatureFlagEntry.new(
		"FEATURE_RACE_EXPANSION",
		FeatureToggleAggregate.RolloutStrategy.WHITELIST_ONLY,
		0,
		["ACC_ELF_WHITELIST_01"]
	)
	var canary_flags := { "FEATURE_RACE_EXPANSION": flag }

	# 1. 非白名单账号尝试创建精灵（未全量开放种族）：断言拦截
	var req_rejected := CharacterCreationRequestDTO.new()
	req_rejected.account_id = "ACC_ELF_REGULAR_99"
	req_rejected.slot_id = "SLOT_SP_01"
	req_rejected.world_id = "WORLD_DEFAULT_SP_01"
	req_rejected.character_name = "月影游侠"
	req_rejected.selected_race_id = "ELF"
	req_rejected.selected_gender = "MALE"
	var slot_rejected := _fresh_slot_state("ACC_ELF_REGULAR_99")
	var res_rejected := CharacterCreationService.process_character_creation(req_rejected, slot_rejected, canary_flags)
	var reject_ok: bool = (not bool(res_rejected.get("success", false))) \
		and res_rejected.get("error_code", "") == "RACE_CANARY_RESTRICTED"

	# 2. 白名单账号尝试创建精灵：断言准许（可走完整创角）
	var req_allowed := CharacterCreationRequestDTO.new()
	req_allowed.account_id = "ACC_ELF_WHITELIST_01"
	req_allowed.slot_id = "SLOT_SP_01"
	req_allowed.world_id = "WORLD_DEFAULT_SP_01"
	req_allowed.character_name = "月影游侠"
	req_allowed.selected_race_id = "ELF"
	req_allowed.selected_gender = "FEMALE"
	var slot_allowed := _fresh_slot_state("ACC_ELF_WHITELIST_01")
	var res_allowed := CharacterCreationService.process_character_creation(req_allowed, slot_allowed, canary_flags)
	var allow_ok: bool = bool(res_allowed.get("success", false))

	var passed: bool = reject_ok and allow_ok
	return { "test": "TC-CC-05: 种族灰度互锁（非白名单 RACE_CANARY_RESTRICTED / 白名单放行）", "passed": passed }


## TC-CC-06: 世界栏网关到开局叙事全链路闭环（P47 网关 → P48 创角 → 开局事件）
static func _test_full_lifecycle_gateway_to_opening_narrative() -> Dictionary:
	var account_id := "ACC_FULL_FLOW_01"

	# 1. 登录后进入世界栏网关（Phase 47 WorldGatewayFSM）
	var fsm := WorldGatewayFSM.new(account_id)
	var gateway_ok: bool = bool(fsm.enter_gateway().get("success", false))

	# 2. 选择单机模式：解析出首档（requires_character_creation == true）
	var sel := fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [])
	var mode_ok: bool = bool(sel.get("success", false)) and bool(sel.get("context", {}).get("is_first_time_creation", false))
	var route_result = sel.get("route_result", null)
	var primary_slot: SaveSlotStateDTO = null
	if route_result != null and route_result.available_slots.size() > 0:
		primary_slot = route_result.available_slots[0]

	# 3. 创角（P48 CharacterCreationService）：以网关解析的档位状态字典入参
	var req := CharacterCreationRequestDTO.new()
	req.account_id = account_id
	req.slot_id = primary_slot.slot_id if primary_slot != null else "SLOT_SP_01"
	req.world_id = primary_slot.bound_world_id if primary_slot != null else "WORLD_DEFAULT_SP_01"
	req.character_name = "命运开拓者"
	req.selected_race_id = "HUMAN"
	req.selected_gender = "MALE"

	var slot_state: Dictionary = primary_slot.to_dto() if primary_slot != null else _fresh_slot_state(account_id)
	var seen_channels: Array = []
	var bus = EventBusCore.get_instance()
	var cb := func(pkt: EventPacket) -> void:
		var w: Dictionary = pkt.payload_data if pkt.payload_data is Dictionary else {}
		seen_channels.append(str(w.get("channel", "")))
	var tok := bus.on_channel(EventChannelDefinition.DOMAIN_EVENT_GENERIC, cb)
	var res := CharacterCreationService.process_character_creation(req, slot_state, {})
	tok.unbind()

	var creation_ok: bool = bool(res.get("success", false))
	var opening: OpeningEventStreamDTO = res.get("opening_event", null)
	var opening_ok: bool = opening != null and opening.is_first_time_creation \
		and not opening.character_id.is_empty() and not opening.character_name.is_empty()
	var broadcast_ok: bool = seen_channels.has("opening_narrative.triggered")

	# 4. 创角完成后回挂网关并正式进入世界（全链路状态无断裂）
	var char_id: String = ""
	if opening != null:
		char_id = opening.character_id
	var attach := fsm.attach_ready_character(char_id)
	var attach_ok: bool = bool(attach.get("success", false))
	var enter_world_ok: bool = bool(fsm.enter_world().get("success", false))

	var passed: bool = gateway_ok and mode_ok and creation_ok and opening_ok and broadcast_ok and attach_ok and enter_world_ok
	return { "test": "TC-CC-06: 网关→模式路由→创角→开局事件→回挂进世界全链路闭环", "passed": passed }
