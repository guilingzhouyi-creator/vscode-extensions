# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/ground_loot/ground_loot_pickup_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/ground_loot.json | 信号: EventBus 领域广播
# 职责说明: 四重拾取检定——衰变失效、空间物理距离 (D <= pickup_radius_meters)、 击杀归属保护期（保护期内仅归属人可拾取）、背包空间与负重容量； 通过后移交物品实体并同步物品统计（GAP-01 注入式遥测）。 纯静态工具类（无状态），错误文案经 GameConfig.msg("ground_loot", key) 配置驱动。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name GroundLootPickupSolver
extends RefCounted

# ==============================================================================
# 一、核心拾取检定算法（按序短路：衰变 → 距离 → 保护 → 容量）
# ==============================================================================

## 尝试拾取掉落物：按四重检定顺序短路，任一失败返回对应 error_code（不产生副作用）。
## 契约：
##   - 衰变/距离/保护失败：物品实体原地保留，背包零改动；
##   - 背包 add_item 失败（满/负重超限）：返回 INVENTORY_FULL，物品不动；
##   - 成功：item_entity 移出地面实体（置 null），经 ItemStatisticsSolver 记录
##     EVENT_ITEM_GRANTED（library 可空注入，保证测试确定性，GAP-01）；
##   - 返回 { success, drop_id, picked_item }。
static func attempt_pickup(
	player_account_id: String,
	player_pos: Vector2,
	drop: GroundDroppedItemAggregate,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate = null # GAP-01 统计库可空注入（测试确定性）
) -> Dictionary:
	# 1. 衰变失效检定
	if drop.is_decayed or drop.item_entity == null:
		return {
			"success": false,
			"error_code": "ITEM_DECAYED",
			"error_message": _msg("decayed")
		}

	# 2. 空间物理距离检定（欧氏距离 ≤ 拾取半径）
	if not SpatialMath.within_radius(player_pos, drop.local_coordinates, drop.pickup_radius_meters):
		return {
			"success": false,
			"error_code": "OUT_OF_PICKUP_RANGE",
			"error_message": _msg("too_far") % drop.pickup_radius_meters
		}

	# 3. 归属保护期检定（保护期内仅归属账号可拾取，防止抢怪截胡）
	if drop.protection_remain_seconds > 0.0 and drop.killer_account_id != "":
		if player_account_id != drop.killer_account_id:
			return {
				"success": false,
				"error_code": "PROTECTED_BY_KILLER",
				"error_message": _msg("kill_protected") % drop.protection_remain_seconds
			}

	# 4. 背包空间与负重检定（满包/超负重拒绝，物品保持在地面）
	if inventory != null:
		if not inventory.add_item(drop.item_entity):
			return {
				"success": false,
				"error_code": "INVENTORY_FULL",
				"error_message": _msg("inventory_full")
			}

	var picked_item = drop.item_entity
	drop.item_entity = null # 移出地面实体（所有权移交背包）

	# GAP-01 修复：统计接入（对称 mail/gacha/quest/shop 路径）
	if library != null and picked_item != null and not picked_item.template_id.is_empty():
		ItemStatisticsSolver.record_item_event(
			library, ItemStatisticsSolver.EVENT_ITEM_GRANTED,
			picked_item.template_id, 1
		)

	return {
		"success": true,
		"drop_id": drop.drop_id,
		"picked_item": picked_item
	}

# ==============================================================================
# 二、配置读取
# ==============================================================================

## 拾取失败文案读取（config/narratives/ground_loot 消息键，零硬编码）
static func _msg(key: String) -> String:
	return GameConfig.msg("ground_loot", key)
