# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/multi_profession_engine.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 掌握技能图云特征聚类、动态授予 Sword Master / Holy Archmage / Spellblade 位格。 阈值/符号表/职业称号与叙述文案由 config/domains/inventory.json、 config/narratives/inventory.json 驱动。
# 退出语义与设计依据: 业务域第一性原理 / 多职业引擎规范
# ==============================================================================

## MultiProfessionEngine：Domain Logic Component
class_name MultiProfessionEngine extends RefCounted

# ==============================================================================
# 一、职业原型实体
# ==============================================================================

## 职业原型：职业 ID/规范名/位格阶/属性修正
class ProfessionArchetype extends RefCounted:
	var profession_id: String = ""
	var canonical_name: String = ""
	var rank_tier: int = 1
	var stat_modifiers: Dictionary = {}

	## 序列化职业原型为字典
	func serialize() -> Dictionary:
		return {
			"profession_id": profession_id,
			"canonical_name": canonical_name,
			"rank_tier": rank_tier,
			"stat_modifiers": stat_modifiers
		}

# ==============================================================================
# 二、技能图云聚类评估与职业同步
# ==============================================================================

static func _count_ast_symbols(
	ast: Variant,
	physical_node_type: String,
	magic_node_type: String,
	physical_symbols: Array,
	magic_symbols: Array
) -> Vector2i:
	if ast == null:
		return Vector2i.ZERO
	var nodes_dict: Variant = ast.nodes if "nodes" in ast else {}
	var physical_count := 0
	var magic_count := 0
	for node in nodes_dict.values():
		var node_type: Variant = node.get("node_type", "")
		var symbol: Variant = node.get("symbol", "")
		if node_type == physical_node_type or symbol in physical_symbols:
			physical_count += 1
		elif node_type == magic_node_type or symbol in magic_symbols:
			magic_count += 1
	return Vector2i(physical_count, magic_count)

## 技能图云聚类评估：物理/魔法符号计数达阈值授予 Sword Master/Archmage/Spellblade 位格
static func evaluate_active_professions(mastered_asts: Array) -> Array[ProfessionArchetype]:
	var result: Array[ProfessionArchetype] = []
	var physical_count: int = 0
	var magic_count: int = 0

	var physical_symbols: Array = GameConfig.get_array("domains.inventory", "profession/symbols/physical", ["STAB", "SLASH", "PARRY", "BLOCK", "LUNGE", "CLEAVE"])
	var magic_symbols: Array = GameConfig.get_array("domains.inventory", "profession/symbols/magic", ["FLAME", "FROST", "ARCANE", "BOLT", "HEAL"])
	var physical_node_type := GameConfig.get_string("domains.inventory", "profession/node_types/physical", "PHYSICAL_VERB")
	var magic_node_type := GameConfig.get_string("domains.inventory", "profession/node_types/magic", "MAGIC_RUNE")
	var physical_threshold := GameConfig.get_int("domains.inventory", "profession/phys_threshold", 10)
	var magic_threshold := GameConfig.get_int("domains.inventory", "profession/magic_threshold", 10)
	var spellblade_physical_threshold := GameConfig.get_int("domains.inventory", "profession/spellblade_phys_threshold", 8)
	var spellblade_magic_threshold := GameConfig.get_int("domains.inventory", "profession/spellblade_magic_threshold", 8)
	var rank_divisor := maxi(1, GameConfig.get_int("domains.inventory", "profession/rank_divisor", 10))
	var spellblade_rank_tier := GameConfig.get_int("domains.inventory", "profession/spellblade_rank_tier", 2)
	var sword_master: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/sword_master", {})
	var archmage: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/archmage", {})
	var spellblade: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/spellblade", {})

	for ast in mastered_asts:
		var counts := _count_ast_symbols(ast, physical_node_type, magic_node_type, physical_symbols, magic_symbols)
		physical_count += counts.x
		magic_count += counts.y

	if physical_count >= physical_threshold:
		var archetype := ProfessionArchetype.new()
		archetype.profession_id = sword_master.get("id", "SWORD_MASTER")
		archetype.canonical_name = sword_master.get("name", "Sword Master")
		archetype.rank_tier = int(1 + floor(physical_count / float(rank_divisor)))
		archetype.stat_modifiers = sword_master.get("modifiers", {})
		result.append(archetype)

	if magic_count >= magic_threshold:
		var archetype := ProfessionArchetype.new()
		archetype.profession_id = archmage.get("id", "ARCHMAGE")
		archetype.canonical_name = archmage.get("name", "Holy Archmage")
		archetype.rank_tier = int(1 + floor(magic_count / float(rank_divisor)))
		archetype.stat_modifiers = archmage.get("modifiers", {})
		result.append(archetype)

	if physical_count >= spellblade_physical_threshold and magic_count >= spellblade_magic_threshold:
		var archetype := ProfessionArchetype.new()
		archetype.profession_id = spellblade.get("id", "SPELLBLADE")
		archetype.canonical_name = spellblade.get("name", "Spellblade")
		archetype.rank_tier = spellblade_rank_tier
		archetype.stat_modifiers = spellblade.get("modifiers", {})
		result.append(archetype)

	return result

## 同步角色职业：评估后逐位格广播晋升事件与叙事文案
static func sync_character_professions(character_id: String, mastered_asts: Array) -> Array[ProfessionArchetype]:
	var archetypes: Array[ProfessionArchetype] = evaluate_active_professions(mastered_asts)
	for archetype in archetypes:
		EventBusCore.get_instance().emit_profession_promoted(character_id, archetype.serialize())
		EventBusCore.get_instance().emit_narrative_by_key(
			"inventory/profession_promoted", "profession", [character_id, archetype.canonical_name, archetype.rank_tier]
		)
	return archetypes
