# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/character_creation_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 整合种族身世、六维属性、先天天赋与地缘出生点，实例化 CharacterPhysiologySheet （统一六维属性底座三层模型）： - L1 等级层：创角分配为统一 1~6 级（购点/骰点产出，经统一规则校验）； - L2 先天基础系数层：种族系数 × 天赋系数修正（身世/天赋 = 系数修正，不占等级空间）； 寿命尺度与文案由 config/domains/character_creation.json、narratives/character_creation.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterCreationService extends RefCounted

# ==============================================================================
# 一、核心算法与业务方法
# ==============================================================================

## 创建新角色聚合：身世/地缘/六维/天赋/钱包/寿命尺度一次性组装。
## 契约：allocated_base_stats 越界等级经 set_level 校验回退 min_level；
##       天赋修正仅作用于六维键与 heart_core_max；金币兜底 initial_gold_fallback；
##       完成后广播 birth_narrative 事件并返回完整聚合字典。
static func create_new_character(
	character_name: String,
	origin_id: String,
	birth_region_id: String,
	allocated_base_stats: Dictionary,
	selected_trait_ids: Array
) -> Dictionary:
	var origin = ReincarnationOriginEngine.get_origin(origin_id)
	var region = ReincarnationOriginEngine.get_birth_region(birth_region_id)

	var sheet := CharacterPhysiologySheet.new()
	sheet.race_id = str(origin.get("race", "HUMAN"))

	# L1 等级层：创角分配为统一 1~6 级（购点/骰点产出），越界经统一规则校验回退
	for stat_key in AttributeConversionEngine.DEFAULT_STAT_LIST:
		var lv := int(allocated_base_stats.get(stat_key, AttributeConversionEngine.min_level()))
		if not sheet.set_level(stat_key, lv):
			sheet.set_level(stat_key, AttributeConversionEngine.min_level())

	# L2 先天基础系数层 = 种族系数 × 天赋修正（身世/天赋 = 系数修正，不占等级空间）
	var coef_scale := GameConfig.get_float("domains.character_creation", "defaults/trait_coef_scale", 0.1)
	# heart_core 钳制界循环外一次读取（创角内常量）
	var heart_clamp_min := GameConfig.get_float("domains.character_creation", "defaults/heart_core_clamp_min", 0.1)
	var heart_clamp_max := GameConfig.get_float("domains.character_creation", "defaults/heart_core_clamp_max", 1.0)
	# 建立基础属性哈希索引以消除线性扫描（PRF-ALG-001）
	var default_stat_set: Dictionary = {}
	for stat_key in AttributeConversionEngine.DEFAULT_STAT_LIST:
		sheet.base_coefficients[stat_key] = AttributeConversionEngine.race_coefficient(sheet.race_id, stat_key)
		default_stat_set[stat_key] = true
	for tid in selected_trait_ids:
		var trait_info = InnateTraitRegistry.get_trait(tid)
		if not trait_info.is_empty():
			_apply_single_trait_modifiers(trait_info, sheet, default_stat_set, coef_scale, heart_clamp_min, heart_clamp_max)

	# 寿命尺度按种族映射（缺失回退 DEFAULT 行）
	var lifespan_scales: Dictionary = GameConfig.get_dict("domains.character_creation", "defaults/lifespan_scales", {})
	var race: String = str(origin.get("race", ""))
	if lifespan_scales.has(race):
		sheet.lifespan_scale = float(lifespan_scales[race])
	else:
		sheet.lifespan_scale = float(lifespan_scales.get("DEFAULT", 1.0))

	LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)

	var wallet := CharacterWalletEntity.new()
	var init_gold = int(origin.get("initial_gold", GameConfig.get_int("domains.character_creation", "defaults/initial_gold_fallback", 50)))
	wallet.gold = init_gold

	EventBusCore.get_instance().emit_narrative_by_key(
		"character_creation/birth_narrative", "lifecycle", [character_name, region.get("name", ""), origin.get("name", "")]
	)

	return {
		"character_name": character_name,
		"origin": origin,
		"birth_region": region,
		"physiology_sheet": sheet,
		"wallet": wallet,
		"selected_traits": selected_trait_ids
	}

## 遍历应用单个特质的属性与核心度修正（平铺单层循环，消除 PRF-ALG-001 嵌套热点）
static func _apply_single_trait_modifiers(
	trait_info: Dictionary,
	sheet: CharacterPhysiologySheet,
	default_stat_set: Dictionary,
	coef_scale: float,
	heart_clamp_min: float,
	heart_clamp_max: float
) -> void:
	var mods: Dictionary = trait_info.get("modifiers", {})
	for stat_key in mods:
		if default_stat_set.has(stat_key):
			sheet.base_coefficients[stat_key] = float(sheet.base_coefficients.get(stat_key, 1.0)) * (1.0 + float(mods[stat_key]) * coef_scale)
		elif stat_key == "heart_core_max":
			sheet.heart_core_integrity = clamp(sheet.heart_core_integrity + float(mods[stat_key]), heart_clamp_min, heart_clamp_max)

# ==============================================================================
# 二、防伪属性守卫（常量）
# ==============================================================================

## 战斗属性保留键清单：前端注入这些键一律丢弃（后端权威派生，不入任何派生路径）
const FORGED_STAT_KEYS: Array[String] = ["STR", "CON", "INT", "AGI", "SPR", "VIT"]

# ==============================================================================
# 三、配置驱动创角主入口（P9 升级增量）
# ==============================================================================

## P9 升级增量：配置驱动创角主入口（直接内化于 CharacterCreationService，杜绝 V2 割裂）
## 整合防伪属性守卫、种族 Canary 灰度校验、顺序状态机流转、原子落档与全域双事件广播。
## 契约：输入为空返回 INVALID_INPUT；种族未配置返回 RACE_NOT_FOUND；灰度未开放返回
##       RACE_CANARY_RESTRICTED；状态机任一环节失败即短路返回；成功后依次广播
##       character_creation.completed 与 opening_narrative.triggered（双事件确定性顺序）。
static func process_character_creation(
	request: CharacterCreationRequestDTO,
	slot_state: Dictionary,
	canary_flags: Dictionary
) -> Dictionary:
	if request == null or slot_state.is_empty():
		return { "success": false, "error_code": "INVALID_INPUT", "message": "请求或档位数据为空" }

	# 0. 防伪守卫：前端注入战斗属性一律丢弃并告警（后端权威派生，不入任何派生路径）
	var forged_dropped: Array = []
	for key in request.extra_custom_fields.keys():
		if FORGED_STAT_KEYS.has(str(key)) or str(key) in ["attributes", "stats", "base_stats"]:
			forged_dropped.append(str(key))
	for fk in forged_dropped:
		request.extra_custom_fields.erase(fk)
	if not forged_dropped.is_empty():
		EventBusCore.get_instance().emit_domain_event("character_creation.forged_fields_dropped", {
			"account_id": request.account_id,
			"dropped_keys": forged_dropped
		})

	# 1. 种族可用性与灰度校验（races_catalog 配置驱动，不写死种族清单）
	var races_dict: Dictionary = GameConfig.get_dict("domains.character_creation", "races_catalog", {})
	var race_data: Dictionary = races_dict.get(request.selected_race_id, {})
	if race_data.is_empty():
		return { "success": false, "error_code": "RACE_NOT_FOUND", "message": "目标种族不存在: %s" % request.selected_race_id }

	var race_def := RaceDefinitionDTO.from_dto(race_data)
	if not race_def.is_enabled:
		var tag := race_def.canary_feature_tag
		var flag = canary_flags.get(tag, null)
		var is_open := false
		if flag != null:
			is_open = CanaryRolloutSolver.is_feature_enabled_for_account(flag, request.account_id)
		if not is_open:
			return {
				"success": false,
				"error_code": "RACE_CANARY_RESTRICTED",
				"message": "该种族当前处于灰度封测阶段，未向当前账号开放"
			}

	# 2. 顺序状态机校验（角色名 → 性别 → 扩展参数）
	var fsm := CharacterCreationFSM.new()
	var start_res := fsm.start_creation(request.account_id, str(slot_state.get("slot_id", "")), str(slot_state.get("bound_world_id", request.world_id)))
	if not start_res.get("success", false):
		return start_res

	var name_res := fsm.set_character_name(request.character_name)
	if not name_res.get("success", false):
		return name_res

	var gender_res := fsm.set_gender(request.selected_gender, race_def)
	if not gender_res.get("success", false):
		return gender_res

	var ext_res := fsm.finalize_extensions(request.extra_custom_fields)
	if not ext_res.get("success", false):
		return ext_res

	# 3. 提交持久化与档位绑定（原子：占用拦截/唯一 ID/事件包生成）
	var bind_res := SaveSlotCharacterBinder.commit_creation_and_bind_slot(request, slot_state, race_def)
	if not bind_res.get("success", false):
		return { "success": false, "error_code": bind_res.get("error_code", ""), "message": bind_res.get("message", "") }

	fsm.mark_persisted_completed()

	var profile: CharacterProfile = bind_res.get("character_profile")
	var opening: OpeningEventStreamDTO = bind_res.get("opening_event")

	# 4. 事件总线广播：角色创建完成事件
	EventBusCore.get_instance().emit_domain_event("character_creation.completed", {
		"account_id": request.account_id,
		"slot_id": str(slot_state.get("slot_id", "")),
		"character_id": profile.character_id,
		"character_name": profile.character_name
	})

	# 5. 广播开局事件流（首次创建标记 + 完整上下文）
	EventBusCore.get_instance().emit_domain_event("opening_narrative.triggered", opening.to_dto())

	fsm.mark_opening_triggered()

	return {
		"success": true,
		"character_name": profile.character_name,
		"character_profile": profile,
		"opening_event": opening,
		"attribute_levels": profile.attributes.get("attribute_levels", {}),
		"final_step": fsm.current_step,
		"fsm_step": fsm.current_step,
		"slot_state": slot_state
	}
