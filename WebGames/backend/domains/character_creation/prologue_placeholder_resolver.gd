# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_placeholder_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 统一占位符格式 {VARIABLE_NAME} 的高可靠运行时解析与安全替换： - 从 CharacterPrologueContext 动态收集事实来源（严禁写死角色名/出生点/道具名） - 遇缺失占位符平稳降级为 [UNKNOWN:KEY] 并返回 missing_placeholders 清单 - 文案/地理名/道具名/NPC 名全部经后端剧情 i18n 表解析 关联细则: 阶段2 §二（占位符解析引擎算法实现）
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ProloguePlaceholderResolver：Headless Discrete Solver / Numerical Calculator
class_name ProloguePlaceholderResolver
extends RefCounted

# ==============================================================================
# 一、状态与依赖
# ==============================================================================

## 占位符正则：{大写/小写字母/数字/下划线} 形式（静态编译一次，全局复用零重建开销）
static var _regex: RegEx = RegEx.create_from_string(r"\{([a-zA-Z0-9_]+)\}")

# ==============================================================================
# 二、占位符提取（上下文事实收集）
# ==============================================================================

## 从角色序章上下文动态收集运行时占位符字典。
## 契约：prologue_context 为空返回空字典；起始地点/初始装备/NPC 名经 narratives.prologue_i18n
##       表解析，键缺失回退各自原始 ID（杜绝硬编码地理名/道具名）。
static func extract_placeholders(
	prologue_context: CharacterPrologueContext,
	adapted_mod_manifest: Dictionary = {},
	profile: Variant = null
) -> Dictionary:
	var placeholders: Dictionary = {}
	if prologue_context == null:
		return placeholders

	placeholders["PLAYER_NAME"] = prologue_context.character_name
	placeholders["CHARACTER_NAME"] = prologue_context.character_name
	placeholders["CHARACTER_ID"] = prologue_context.character_id
	placeholders["RACE_ID"] = prologue_context.race_id
	placeholders["GENDER"] = prologue_context.gender

	# 起始地点展示名（查后端剧情 i18n 地理表；缺失回退地点 ID）
	placeholders["START_LOCATION"] = GameConfig.get_string(
		"narratives.prologue_i18n", "locations/" + prologue_context.assigned_start_location_id, prologue_context.assigned_start_location_id
	)

	# 初始装备展示名
	var kit_id := prologue_context.assigned_starter_kit_id
	if kit_id.is_empty():
		kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + prologue_context.race_id, "")
	var kit_config: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits/" + kit_id, {})
	var weapon_canonical: String = str(kit_config.get("display_weapon", ""))
	if not weapon_canonical.is_empty():
		var weapon_key := weapon_canonical.replace(":", "_")
		placeholders["INITIAL_EQUIPMENT"] = GameConfig.get_string(
			"narratives.prologue_i18n", "items/" + weapon_key,
			GameConfig.get_string("narratives.prologue_i18n", "items/" + weapon_canonical, weapon_canonical)
		)
	else:
		placeholders["INITIAL_EQUIPMENT"] = ""

	# 序章接引人
	var npc_target: String = GameConfig.get_string("narratives.prologue_i18n", "npcs/default_guide", "FORTRESS_GUARD")
	placeholders["NPC_TARGET"] = GameConfig.get_string("narratives.prologue_i18n", "npcs/" + npc_target, npc_target)
	placeholders["EVENT_RESULT"] = "SUCCESS"

	# 身世、区域、套件与金币等衍生占位符
	_populate_extended_placeholders(prologue_context, adapted_mod_manifest, profile, kit_id, placeholders)

	# 写入所有键的小写形式及 race 别名
	var keys_to_lower: Array = placeholders.keys()
	for placeholder_key in keys_to_lower:
		placeholders[str(placeholder_key).to_lower()] = placeholders[placeholder_key]
	placeholders["race"] = placeholders["RACE_ID"]

	return placeholders

static func _populate_extended_placeholders(
	prologue_context: CharacterPrologueContext,
	manifest: Dictionary,
	profile: Variant,
	kit_id: String,
	placeholders: Dictionary
) -> void:
	var origin_id: String = str(prologue_context.runtime_placeholders.get("ORIGIN_ID", prologue_context.runtime_placeholders.get("origin_id", "")))
	if origin_id.is_empty() and profile is Dictionary:
		origin_id = str((profile as Dictionary).get("origin_id", ""))
	placeholders["ORIGIN_ID"] = origin_id

	var origins_catalog: Dictionary = manifest.get("origins_catalog", manifest.get("origins", {}))
	var origin_config: Dictionary = origins_catalog.get(origin_id, {})
	placeholders["ORIGIN_NAME"] = str(origin_config.get("name", origin_id))

	var birth_region_map: Dictionary = manifest.get("birth_region_map", {})
	placeholders["BIRTH_REGION"] = str(birth_region_map.get(origin_id, str(origin_config.get("birth_region_id", "CENTRAL_CONTINENT"))))

	placeholders["TRAIT_SUMMARY"] = str(prologue_context.runtime_placeholders.get("TRAIT_SUMMARY", prologue_context.runtime_placeholders.get("trait_summary", "")))

	var mod_kits: Dictionary = manifest.get("starter_kits", manifest.get("custom_starter_kits", {}))
	var kit_name: String = str(mod_kits.get(kit_id, {}).get("name", kit_id))
	placeholders["STARTER_KIT_NAME"] = kit_name

	var gold_value: int = 50
	if profile != null:
		if profile is CharacterProfile:
			gold_value = int((profile as CharacterProfile).personal_resources.get("gold", 50))
		elif profile is Dictionary:
			var personal_resources: Dictionary = (profile as Dictionary).get("personal_resources", (profile as Dictionary).get("wallet", {}))
			gold_value = int(personal_resources.get("gold", 50))
	elif prologue_context.runtime_placeholders.has("INITIAL_GOLD"):
		gold_value = int(prologue_context.runtime_placeholders["INITIAL_GOLD"])
	elif prologue_context.runtime_placeholders.has("STARTER_GOLD"):
		gold_value = int(prologue_context.runtime_placeholders["STARTER_GOLD"])
	placeholders["INITIAL_GOLD"] = str(gold_value)

# ==============================================================================
# 三、模板解析与安全降级替换
# ==============================================================================

## 将模板中的 {KEY} 替换为运行时实值；未匹配占位符注入安全降级标记并返回清单。
## 契约：空模板返回成功空文本；缺失占位符替换为 [UNKNOWN:KEY]（不抛异常），
##       success 取 missing 是否为空；替换为单遍顺序执行（确定性）。
static func resolve_template(template_text: String, placeholders: Dictionary) -> Dictionary:
	if template_text.is_empty():
		return { "success": true, "text": "", "missing_placeholders": [] }

	var missing: Array[String] = []
	var result_text := template_text

	var matches := _regex.search_all(template_text)
	for regex_match in matches:
		var key := regex_match.get_string(1)
		var is_value_found: bool = false
		var value_text: String = ""

		if placeholders.has(key):
			is_value_found = true
			value_text = str(placeholders[key])
		elif placeholders.has(key.to_upper()):
			is_value_found = true
			value_text = str(placeholders[key.to_upper()])
		elif placeholders.has(key.to_lower()):
			is_value_found = true
			value_text = str(placeholders[key.to_lower()])

		if is_value_found:
			result_text = result_text.replace("{%s}" % key, value_text)
		else:
			if not missing.has(key):
				missing.append(key)
			result_text = result_text.replace("{%s}" % key, "[UNKNOWN:%s]" % key)

	return {
		"success": missing.is_empty(),
		"text": result_text,
		"missing_placeholders": missing
	}

## 多级解析叙事键：优先查 adapted_mod_manifest.custom_i18n，次查内置 i18n 表，再次回退 inline_fallback
static func resolve_narrative_key(
	narrative_key: String,
	placeholders: Dictionary,
	adapted_mod_manifest: Dictionary = {},
	inline_fallback: String = ""
) -> Dictionary:
	var target_text: String = ""
	var custom_i18n: Dictionary = adapted_mod_manifest.get("custom_i18n", {})

	if custom_i18n.has(narrative_key):
		target_text = str(custom_i18n[narrative_key])
	elif custom_i18n.has(narrative_key.replace("/", ".")):
		target_text = str(custom_i18n[narrative_key.replace("/", ".")])
	elif custom_i18n.has(narrative_key.replace(".", "/")):
		target_text = str(custom_i18n[narrative_key.replace(".", "/")])

	if target_text.is_empty():
		var key_slash: String = narrative_key.replace(".", "/")
		target_text = GameConfig.get_string("narratives.prologue_i18n", key_slash, "")

	if target_text.is_empty():
		target_text = inline_fallback

	if target_text.is_empty():
		target_text = narrative_key

	var template_result := resolve_template(target_text, placeholders)
	return {
		"text": template_result.get("text", ""),
		"unresolved_keys": template_result.get("missing_placeholders", []),
		"success": template_result.get("success", false),
		"missing_placeholders": template_result.get("missing_placeholders", [])
	}
