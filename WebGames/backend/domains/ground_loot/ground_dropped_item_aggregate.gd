# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/ground_loot/ground_dropped_item_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/ground_loot.json | 信号: EventBus 领域广播
# 职责说明: 物品物理落地实例化、挂载微观空间坐标、专属保护期与材质衰变半衰期。 空间位置/拾取半径/保护期/衰变寿命默认值全部由 config/domains/ground_loot.json 驱动（代码零硬编码）；item 实例经 ItemInstanceFactory 生成权威 UID。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name GroundDroppedItemAggregate
extends RefCounted

# ==============================================================================
# 一、衰变类别枚举
# ==============================================================================

## 材质衰变分类：决定地面存活总时限（ORGANIC 快速腐败 / STANDARD 中等风化 / ETERNAL 永不腐朽）
enum LootDecayCategory {
	ORGANIC_PERISHABLE,    # 有机生鲜 (生肉/药草) -> 快速腐败
	STANDARD_MINERAL_EQUIP,# 标准矿石与装备 -> 中等风化
	ETERNAL_LEGENDARY      # 传奇神器与魔单晶 -> 永不自然腐朽
}

# ==============================================================================
# 二、掉落实体状态（空间位置）
# ==============================================================================

var drop_id: String = ""                         # 掉落实体唯一 ID (UUID，DRP_ 前缀)
var item_entity: ItemEntity = null               # 引用的真实万物物品实体 ItemEntity（第一卷）
var location_town_id: String = GameConfig.get_string("domains.world", "node_defaults/town_id", "TOWN_VALAN") # 所在城镇（世界配置）
var local_coordinates: Vector2 = Vector2.ZERO    # 微观空间坐标（拾取距离判定基准）
var pickup_radius_meters: float = GameConfig.get_float("domains.ground_loot", "defaults/pickup_radius_meters", 2.0) # 可拾取半径（米）

# ==============================================================================
# 三、归属与保护权
# ==============================================================================

var killer_account_id: String = ""               # 击杀者/掉落归属人（保护期内仅其可拾取）
var killer_team_id: String = ""                  # 归属小队 ID（预留团队保护）
var protection_remain_seconds: float = GameConfig.get_float("domains.ground_loot", "defaults/protection_remain_seconds", 60.0) # 专属保护倒计时（秒）

# ==============================================================================
# 四、生态衰变生命周期
# ==============================================================================

var decay_category: LootDecayCategory = LootDecayCategory.STANDARD_MINERAL_EQUIP # 衰变类别（决定寿命）
var total_lifespan_seconds: float = GameConfig.get_float("domains.ground_loot", "defaults/total_lifespan_seconds", 7200.0) # 地面存活总时限（秒）
var elapsed_alive_seconds: float = 0.0           # 已存活时长（秒，衰变推进器累加）
var is_decayed: bool = false                     # 衰变完成标记（触发 GC 释放引用）

## 构造掉落聚合：绑定 ID/物品实体/空间坐标/归属人/衰变类别。
## 契约：按 decay_category 覆盖 total_lifespan_seconds（有机 30 分钟 / 标准 2 小时 / 传奇永不，
##       config/domains/ground_loot.json lifespan.* 驱动）；实例不在此处注册，由监听器统一入列。
func _init(
	p_id: String = "",
	p_item: ItemEntity = null,
	p_pos: Vector2 = Vector2.ZERO,
	p_killer: String = "",
	p_decay_cat: LootDecayCategory = LootDecayCategory.STANDARD_MINERAL_EQUIP
) -> void:
	drop_id = p_id
	item_entity = p_item
	local_coordinates = p_pos
	killer_account_id = p_killer
	decay_category = p_decay_cat

	if decay_category == LootDecayCategory.ORGANIC_PERISHABLE:
		total_lifespan_seconds = GameConfig.get_float("domains.ground_loot", "lifespan/organic_perishable_seconds", 1800.0) # 30 分钟
	elif decay_category == LootDecayCategory.STANDARD_MINERAL_EQUIP:
		total_lifespan_seconds = GameConfig.get_float("domains.ground_loot", "lifespan/standard_mineral_seconds", 7200.0) # 2 小时
	else:
		total_lifespan_seconds = GameConfig.get_float("domains.ground_loot", "lifespan/eternal_legendary_seconds", -1.0) # 永不腐蚀

## 掉落声明统一事实源：canonical_id 必须已登记（未登记拒绝生成，禁造临时物件），
## 实例经 ItemInstanceFactory 生成权威 UID（前缀 DRP_ 掉落物）。
## 注意：本工厂只产出 ItemEntity，不构造聚合体（drop_id/位置/衰变寿命由调用方组装）；
## 因此不再声明 decay_cat 形参（曾为未使用参数，误导调用方）。
static func create_from_declaration(canonical_id: String, catalog: ItemRegistryCatalog, display_name: String = "") -> Dictionary:
	if canonical_id.is_empty():
		return {"success": false, "error_code": "EMPTY_ITEM_KEY"}
	if catalog == null:
		return {"success": false, "error_code": "NO_CATALOG"}
	var proto = catalog.get_prototype(canonical_id)
	if proto == null:
		return {"success": false, "error_code": "ITEM_NOT_REGISTERED", "canonical_id": canonical_id}
	var item := ItemInstanceFactory.build_instance(proto, display_name if not display_name.is_empty() else proto.english_name, "DRP_")
	return {"success": true, "item_entity": item, "canonical_id": canonical_id}
