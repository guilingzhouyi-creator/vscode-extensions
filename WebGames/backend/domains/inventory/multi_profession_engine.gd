# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/multi_profession_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 掌握技能图云特征聚类、动态授予 Sword Master / Holy Archmage / Spellblade 位格。 阈值/符号表/职业称号与叙述文案由 config/domains/inventory.json、 config/narratives/inventory.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

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

## 技能图云聚类评估：物理/魔法符号计数达阈值授予 Sword Master/Archmage/Spellblade 位格
static func evaluate_active_professions(mastered_asts: Array) -> Array[ProfessionArchetype]:
	var result: Array[ProfessionArchetype] = []
	var phys_count: int = 0
	var magic_count: int = 0

	var phys_symbols: Array = GameConfig.get_array("domains.inventory", "profession/symbols/physical", ["STAB", "SLASH", "PARRY", "BLOCK", "LUNGE", "CLEAVE"])
	var magic_symbols: Array = GameConfig.get_array("domains.inventory", "profession/symbols/magic", ["FLAME", "FROST", "ARCANE", "BOLT", "HEAL"])
	var phys_node_type := GameConfig.get_string("domains.inventory", "profession/node_types/physical", "PHYSICAL_VERB")
	var magic_node_type := GameConfig.get_string("domains.inventory", "profession/node_types/magic", "MAGIC_RUNE")
	var phys_threshold := GameConfig.get_int("domains.inventory", "profession/phys_threshold", 10)
	var magic_threshold := GameConfig.get_int("domains.inventory", "profession/magic_threshold", 10)
	var sb_phys_threshold := GameConfig.get_int("domains.inventory", "profession/spellblade_phys_threshold", 8)
	var sb_magic_threshold := GameConfig.get_int("domains.inventory", "profession/spellblade_magic_threshold", 8)
	var rank_divisor := maxi(1, GameConfig.get_int("domains.inventory", "profession/rank_divisor", 10))
	var sb_rank_tier := GameConfig.get_int("domains.inventory", "profession/spellblade_rank_tier", 2)
	var sword_master: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/sword_master", {})
	var archmage: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/archmage", {})
	var spellblade: Dictionary = GameConfig.get_dict("domains.inventory", "profession/titles/spellblade", {})

	for ast in mastered_asts:
		if ast == null:
			continue
		var nodes_dict = ast.nodes if "nodes" in ast else {}
		for node in nodes_dict.values():
			var ntype = node.get("node_type", "")
			var symbol = node.get("symbol", "")
			if ntype == phys_node_type or symbol in phys_symbols:
				phys_count += 1
			elif ntype == magic_node_type or symbol in magic_symbols:
				magic_count += 1

	if phys_count >= phys_threshold:
		var p := ProfessionArchetype.new()
		p.profession_id = sword_master.get("id", "SWORD_MASTER")
		p.canonical_name = sword_master.get("name", "Sword Master")
		p.rank_tier = int(1 + floor(phys_count / float(rank_divisor)))
		p.stat_modifiers = sword_master.get("modifiers", {})
		result.append(p)

	if magic_count >= magic_threshold:
		var p := ProfessionArchetype.new()
		p.profession_id = archmage.get("id", "ARCHMAGE")
		p.canonical_name = archmage.get("name", "Holy Archmage")
		p.rank_tier = int(1 + floor(magic_count / float(rank_divisor)))
		p.stat_modifiers = archmage.get("modifiers", {})
		result.append(p)

	if phys_count >= sb_phys_threshold and magic_count >= sb_magic_threshold:
		var p := ProfessionArchetype.new()
		p.profession_id = spellblade.get("id", "SPELLBLADE")
		p.canonical_name = spellblade.get("name", "Spellblade")
		p.rank_tier = sb_rank_tier
		p.stat_modifiers = spellblade.get("modifiers", {})
		result.append(p)

	return result

## 同步角色职业：评估后逐位格广播晋升事件与叙事文案
static func sync_character_professions(character_id: String, mastered_asts: Array) -> Array[ProfessionArchetype]:
	var archetypes = evaluate_active_professions(mastered_asts)
	for p in archetypes:
		EventBusCore.get_instance().emit_profession_promoted(character_id, p.serialize())
		EventBusCore.get_instance().emit_narrative_by_key(
			"inventory/profession_promoted", "profession", [character_id, p.canonical_name, p.rank_tier]
		)
	return archetypes
