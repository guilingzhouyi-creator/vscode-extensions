# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_placeholder_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 统一占位符格式 {VARIABLE_NAME} 的高可靠运行时解析与安全替换： - 从 CharacterPrologueContext 动态收集事实来源（严禁写死角色名/出生点/道具名） - 遇缺失占位符平稳降级为 [UNKNOWN:KEY] 并返回 missing_placeholders 清单 - 文案/地理名/道具名/NPC 名全部经后端剧情 i18n 表解析 关联细则: Phase 49 阶段2 §二（占位符解析引擎算法实现）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name ProloguePlaceholderResolver
extends RefCounted

# ==============================================================================
# 一、状态与依赖
# ==============================================================================

## 占位符正则：{大写字母/数字/下划线} 形式（静态编译一次，全局复用零重建开销）
static var _regex: RegEx = RegEx.create_from_string(r"\{([A-Z0-9_]+)\}")

# ==============================================================================
# 二、占位符提取（上下文事实收集）
# ==============================================================================

## 从角色序章上下文动态收集运行时占位符字典。
## 契约：ctx 为空返回空字典；起始地点/初始装备/NPC 名经 narratives.prologue_i18n
##       表解析，键缺失回退各自原始 ID（杜绝硬编码地理名/道具名）。
static func extract_placeholders(ctx: CharacterPrologueContext) -> Dictionary:
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

	# 初始装备展示名（新手套件 display_weapon canonical → i18n 道具名）
	# kit_id 未指派时按种族 race_kit_map 兜底（与 Dispatcher 同映射逻辑，保证
	# extract→dispatch 顺序下 INITIAL_EQUIPMENT 亦可解析，避免 boot 首步为空）
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

	# 序章接引人（i18n NPC 表；default_guide 键路由默认接引 NPC）
	var npc_target: String = GameConfig.get_string("narratives.prologue_i18n", "npcs/default_guide", "FORTRESS_GUARD")
	dict["NPC_TARGET"] = GameConfig.get_string("narratives.prologue_i18n", "npcs/" + npc_target, npc_target)

	dict["EVENT_RESULT"] = "SUCCESS"
	return dict

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
		if placeholders.has(key):
			var val := str(placeholders[key])
			result_text = result_text.replace("{%s}" % key, val)
		else:
			if not missing.has(key):
				missing.append(key)
			# 遇缺失占位符注入安全降级标记，避免抛出异常
			result_text = result_text.replace("{%s}" % key, "[UNKNOWN:%s]" % key)

	return {
		"success": missing.is_empty(),
		"text": result_text,
		"missing_placeholders": missing
	}
