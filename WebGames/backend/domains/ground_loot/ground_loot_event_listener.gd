# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/ground_loot/ground_loot_event_listener.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/ground_loot.json | 信号: EventBus 领域广播
# 职责说明: 订阅 EventBusCore 泛化领域信道（DOMAIN_EVENT_GENERIC），过滤 monster.killed， 将 payload 中的 drop_declarations 声明转化为 GroundDroppedItemAggregate 实例 并登记为活跃掉落物（由战斗结算方触发，解耦掉落声明与地面拾取域）。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name GroundLootEventListener extends RefCounted

# ==============================================================================
# 一、状态与依赖
# ==============================================================================

var _catalog: ItemRegistryCatalog = null                 # 物品注册表（声明登记校验用）
var _active_drops: Array[GroundDroppedItemAggregate] = [] # 活跃掉落物清单（拾取/衰变回收消费）
var _sub_token: EventBusSubscriptionToken = null         # 新总线订阅令牌（幂等解绑）

# ==============================================================================
# 二、生命周期（构造订阅 / 销毁解绑）
# ==============================================================================

## 构造即订阅事件总线（注入 catalog 用于声明登记校验，未登记 canonical_id 拒绝生成）
func _init(catalog: ItemRegistryCatalog) -> void:
	_catalog = catalog
	_sub_token = EventBusCore.get_instance().on_channel(
		EventChannelDefinition.DOMAIN_EVENT_GENERIC, _on_domain_packet)

## 资源释放与事件解绑（宿主销毁前调用，杜绝闭包泄漏）
func dispose() -> void:
	if _sub_token != null:
		_sub_token.unbind()
		_sub_token = null
	_active_drops.clear()
	_catalog = null

# ==============================================================================
# 三、事件回调与掉落登记
# ==============================================================================

## 领域事件回调：解包 EventPacket 后仅处理 monster.killed；无效 canonical_id 安全跳过
func _on_domain_packet(packet: EventPacket) -> void:
	var wrapper: Dictionary = packet.payload_data if packet.payload_data is Dictionary else {}
	if str(wrapper.get("channel", "")) != "monster.killed":
		return
	var payload: Dictionary = wrapper.get("payload", {}) if wrapper.get("payload", {}) is Dictionary else {}
	var declarations: Array = payload.get("drop_declarations", [])
	for decl in declarations:
		if not decl is Dictionary:
			continue
		var canonical_id := str(decl.get("canonical_id", ""))
		if canonical_id.is_empty():
			continue
		var result := GroundDroppedItemAggregate.create_from_declaration(
			canonical_id, _catalog, str(decl.get("display_name", ""))
		)
		if not result.get("success", false):
			continue
		var drop := GroundDroppedItemAggregate.new(
			UniqueIdGenerator.next_id("DRP_"),
			result["item_entity"],
			Vector2(float(decl.get("x", 0.0)), float(decl.get("y", 0.0))),
			str(decl.get("killer_id", "")),
			int(decl.get("decay_cat", GroundDroppedItemAggregate.LootDecayCategory.STANDARD_MINERAL_EQUIP))
		)
		_active_drops.append(drop)

# ==============================================================================
# 四、活跃掉落管理（查询 / 回收 / 拾取）
# ==============================================================================

## 当前活跃掉落物清单（供地面拾取与衰变回收消费）
func get_active_drops() -> Array[GroundDroppedItemAggregate]:
	return _active_drops

## 清理已衰变掉落物（由衰变时钟/回收调度方周期调用）
## P7：常态零分配——先扫有无衰变项，无则直接返回（不重建数组）；有才单遍过滤重建
func cleanup_decayed() -> void:
	var has_decayed := false
	for drop in _active_drops:
		if drop.is_decayed:
			has_decayed = true
			break
	if not has_decayed:
		return
	var alive: Array[GroundDroppedItemAggregate] = []
	for drop in _active_drops:
		if not drop.is_decayed:
			alive.append(drop)
	_active_drops = alive

## Phase 43 N2：按 drop_id 查找活跃掉落物（查询不出队；未命中返回 null）
func find_active_drop(drop_id: String) -> GroundDroppedItemAggregate:
	if drop_id.is_empty():
		return null
	for drop in _active_drops:
		if drop.drop_id == drop_id:
			return drop
	return null

## Phase 43 N2：按 drop_id 出队并返回实例（拾取成功后移除；未命中返回 null）
func claim_drop(drop_id: String) -> GroundDroppedItemAggregate:
	var drop := find_active_drop(drop_id)
	if drop == null:
		return null
	_active_drops.erase(drop)
	return drop

## 内部：按已查实例直接出队（复用外部已查结果，避免二次线性扫描）
func _claim_drop_instance(drop: GroundDroppedItemAggregate) -> void:
	_active_drops.erase(drop)

## Phase 43 N2：拾取便捷入口——查找 → GroundLootPickupSolver.attempt_pickup →
## 成功后出队，拾取链与监听器活跃掉落状态闭环（TC-P43-S2-02/S4-05）。
## 优化：复用已查 drop 实例直接出队，避免 claim_drop 二次查找
func attempt_pickup_from_ground(
	player_account_id: String,
	player_pos: Vector2,
	drop_id: String,
	inventory: WearableInventoryAggregate,
	library: AccountItemLibraryAggregate = null
) -> Dictionary:
	var drop := find_active_drop(drop_id)
	if drop == null:
		return {"success": false, "error_code": "DROP_NOT_FOUND", "drop_id": drop_id}
	var result := GroundLootPickupSolver.attempt_pickup(player_account_id, player_pos, drop, inventory, library)
	if not result.get("success", false):
		return result
	_claim_drop_instance(drop)
	return result
