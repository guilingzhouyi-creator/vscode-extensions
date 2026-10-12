# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_placeholder_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 统一占位符格式 {VARIABLE_NAME} 的高可靠运行时解析与安全替换： - 从 CharacterPrologueContext 动态收集事实来源（严禁写死角色名/出生点/道具名） - 遇缺失占位符平稳降级为 [UNKNOWN:KEY] 并返回 missing_placeholders 清单 - 文案/地理名/道具名/NPC 名全部经后端剧情 i18n 表解析 关联细则: 阶段2 §二（占位符解析引擎算法实现）
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

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
## 契约：ctx 为空返回空字典；起始地点/初始装备/NPC 名经 narratives.prologue_i18n
##       表解析，键缺失回退各自原始 ID（杜绝硬编码地理名/道具名）。
static func extract_placeholders(
	ctx: CharacterPrologueContext,
	adapted_mod_manifest: Dictionary = {},
	profile: Variant = null
) -> Dictionary:
	var dict: Dictionary = {}
	if ctx == null:
		return dict

	dict["PLAYER_NAME"] = ctx.character_name
	dict["CHARACTER_NAME"] = ctx.character_name
	dict["CHARACTER_ID"] = ctx.character_id
	dict["RACE_ID"] = ctx.race_id
	dict["GENDER"] = ctx.gender

	# 起始地点展示名（查后端剧情 i18n 地理表；缺失回退地点 ID）
	dict["START_LOCATION"] = GameConfig.get_string(
		"narratives.prologue_i18n", "locations/" + ctx.assigned_start_location_id, ctx.assigned_start_location_id
	)

	# 初始装备展示名
	var kit_id := ctx.assigned_starter_kit_id
	if kit_id.is_empty():
		kit_id = GameConfig.get_string("domains.starter_loadout", "race_kit_map/" + ctx.race_id, "")
	var kit_cfg: Dictionary = GameConfig.get_dict("domains.starter_loadout", "starter_kits/" + kit_id, {})
	var weapon_canonical: String = str(kit_cfg.get("display_weapon", ""))
	if not weapon_canonical.is_empty():
		var weapon_key := weapon_canonical.replace(":", "_")
		dict["INITIAL_EQUIPMENT"] = GameConfig.get_string(
			"narratives.prologue_i18n", "items/" + weapon_key,
			GameConfig.get_string("narratives.prologue_i18n", "items/" + weapon_canonical, weapon_canonical)
		)
	else:
		dict["INITIAL_EQUIPMENT"] = ""

	# 序章接引人
	var npc_target: String = GameConfig.get_string("narratives.prologue_i18n", "npcs/default_guide", "FORTRESS_GUARD")
	dict["NPC_TARGET"] = GameConfig.get_string("narratives.prologue_i18n", "npcs/" + npc_target, npc_target)
	dict["EVENT_RESULT"] = "SUCCESS"

	# 身世、区域、套件与金币等衍生占位符
	_populate_extended_placeholders(ctx, adapted_mod_manifest, profile, kit_id, dict)

	# 写入所有键的小写形式及 race 别名
	var keys_to_lower: Array = dict.keys()
	for k in keys_to_lower:
		dict[str(k).to_lower()] = dict[k]
	dict["race"] = dict["RACE_ID"]

	return dict

static func _populate_extended_placeholders(
	ctx: CharacterPrologueContext,
	manifest: Dictionary,
	profile: Variant,
	kit_id: String,
	dict: Dictionary
) -> void:
	var origin_id: String = str(ctx.runtime_placeholders.get("ORIGIN_ID", ctx.runtime_placeholders.get("origin_id", "")))
	if origin_id.is_empty() and profile is Dictionary:
		origin_id = str((profile as Dictionary).get("origin_id", ""))
	dict["ORIGIN_ID"] = origin_id

	var origins_cat: Dictionary = manifest.get("origins_catalog", manifest.get("origins", {}))
	var orig_cfg: Dictionary = origins_cat.get(origin_id, {})
	dict["ORIGIN_NAME"] = str(orig_cfg.get("name", origin_id))

	var birth_region_map: Dictionary = manifest.get("birth_region_map", {})
	dict["BIRTH_REGION"] = str(birth_region_map.get(origin_id, str(orig_cfg.get("birth_region_id", "CENTRAL_CONTINENT"))))

	dict["TRAIT_SUMMARY"] = str(ctx.runtime_placeholders.get("TRAIT_SUMMARY", ctx.runtime_placeholders.get("trait_summary", "")))

	var mod_kits: Dictionary = manifest.get("starter_kits", manifest.get("custom_starter_kits", {}))
	var kit_name: String = str(mod_kits.get(kit_id, {}).get("name", kit_id))
	dict["STARTER_KIT_NAME"] = kit_name

	var gold_val: int = 50
	if profile != null:
		if profile is CharacterProfile:
			gold_val = int((profile as CharacterProfile).personal_resources.get("gold", 50))
		elif profile is Dictionary:
			var pr: Dictionary = (profile as Dictionary).get("personal_resources", (profile as Dictionary).get("wallet", {}))
			gold_val = int(pr.get("gold", 50))
	elif ctx.runtime_placeholders.has("INITIAL_GOLD"):
		gold_val = int(ctx.runtime_placeholders["INITIAL_GOLD"])
	elif ctx.runtime_placeholders.has("STARTER_GOLD"):
		gold_val = int(ctx.runtime_placeholders["STARTER_GOLD"])
	dict["INITIAL_GOLD"] = str(gold_val)

# ==============================================================================
# 三、模板解析与安全降级替换
# ==============================================================================

## 将模板中的 {KEY} 替换为运行时实值；未匹配占位符注入安全降级标记并返回清单。
## 契约：空模板返回成功空文本；缺失占位符替换为 [UNKNOWN:KEY]（不抛异常），
##       success 取 missing 是否为空；替换为单遍顺序执行（确定性）。
static func resolve_template(template_str: String, placeholders: Dictionary) -> Dictionary:
	if template_str.is_empty():
		return { "success": true, "text": "", "missing_placeholders": [] }

	var missing: Array[String] = []
	var result_text := template_str

	var matches := _regex.search_all(template_str)
	for m in matches:
		var key := m.get_string(1)
		var val_found: bool = false
		var val_str: String = ""

		if placeholders.has(key):
			val_found = true
			val_str = str(placeholders[key])
		elif placeholders.has(key.to_upper()):
			val_found = true
			val_str = str(placeholders[key.to_upper()])
		elif placeholders.has(key.to_lower()):
			val_found = true
			val_str = str(placeholders[key.to_lower()])

		if val_found:
			result_text = result_text.replace("{%s}" % key, val_str)
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

	var res := resolve_template(target_text, placeholders)
	return {
		"text": res.get("text", ""),
		"unresolved_keys": res.get("missing_placeholders", []),
		"success": res.get("success", false),
		"missing_placeholders": res.get("missing_placeholders", [])
	}
