# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_navigation/world_travel_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world.json | 信号: EventBus 领域广播
# 职责说明: 队伍行军时间推进、地质阻抗口粮消耗与城镇抵达状态跃迁。 行军速度/口粮消耗与叙事文案由 config/world.json、 config/narratives/world.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name WorldTravelAndSettlementFSM extends RefCounted

class MarchingParty extends RefCounted:
	var party_id: String = ""
	var current_node_id: String = ""
	var ration_units: float = GameConfig.get_float("domains.world", "marching/default_ration_units", 50.0)
	var party_size: int = GameConfig.get_int("domains.world", "marching/default_party_size", 4)
	var is_starving: bool = false

## 行军步骤执行：四步输入校验（确定错误码，前四步失败不扣口粮/不移动）→ 阻抗修正耗时/口粮 → 抵达到点并广播行军叙事
static func execute_marching_step(
	party: MarchingParty,
	destination_node: WorldMapGraphNode,
	distance_km: float
) -> Dictionary:
	# 0. 输入校验（Phase 32 S2）：失败返回确定错误码，不修改队伍状态（前四步任一失败都不扣口粮/移动）
	if party == null or party.party_id.is_empty() or party.party_size <= 0:
		return { "success": false, "code": "EMPTY_PARTY" }
	if destination_node == null or destination_node.node_id.is_empty():
		return { "success": false, "code": "DESTINATION_NOT_FOUND" }
	if not is_finite(distance_km) or distance_km < 0.0:
		return { "success": false, "code": "NEGATIVE_DISTANCE" }

	var base_speed := maxf(0.1, GameConfig.get_float("domains.world", "marching/base_speed_kmh", 5.0))
	var ration_per_hour := GameConfig.get_float("domains.world", "marching/ration_per_person_hour", 0.1)

	var impedance = MapAndEcologySolver.get_terrain_impedance(destination_node.terrain_type)
	var travel_hours = int(ceil((distance_km / base_speed) * impedance)) # 基准时速 5km/h
	var ration_consumed = float(party.party_size) * float(travel_hours) * ration_per_hour * impedance

	party.ration_units -= ration_consumed
	if party.ration_units < 0.0:
		party.ration_units = 0.0
		party.is_starving = true
	else:
		party.is_starving = false

	party.current_node_id = destination_node.node_id

	EventBusCore.get_instance().emit_narrative_by_key(
		"world/march_arrival", "travel",
		[travel_hours, destination_node.node_name, destination_node.terrain_type, ration_consumed, destination_node.node_name],
		{
			"node_id": destination_node.node_id,
			"travel_hours": travel_hours,
			"ration_consumed": ration_consumed,
			"is_starving": party.is_starving
		}
	)

	return {
		"success": true,
		"code": "",
		"travel_hours": travel_hours,
		"ration_consumed": ration_consumed,
		"is_starving": party.is_starving,
		"current_node_id": party.current_node_id
	}
