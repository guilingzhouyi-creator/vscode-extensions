# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/character_death_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 角色死亡时仅精确清理角色本体数据（白名单），世界时间/状态零回退， 历史影响片段只增不改；新角色零继承死亡角色完整状态。 核心规则：清理玩家角色状态，不清理世界状态；角色重新开始， 不代表世界重新开始。禁止：回档世界/删整档/重置时间/撤销影响/完整继承。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterDeathSolver extends RefCounted

# ==============================================================================
# 一、角色死亡清理
# ==============================================================================

## 角色死亡清理（精确子集）：dto 为槽位封面（含角色本体档案），world 可空
## 边界：重复死亡幂等（ALREADY_FALLEN）；死亡后槽位标记可重挂（slot_reusable）
static func handle_character_death(account: AccountProfileAggregate, slot_id: String, world: WorldInstance) -> Dictionary:
	if account == null or slot_id.is_empty():
		return {"success": false, "error_code": "INVALID_SLOT"}
	var dto: SaveSlotSummaryDTO = account.get_summary_by_slot(slot_id)
	if dto == null:
		return {"success": false, "error_code": "SLOT_EMPTY"}
	if dto.is_fallen:
		return {"success": false, "error_code": "ALREADY_FALLEN", "slot_id": slot_id}

	# 1. 精确清理角色本体子集（白名单，禁删全档）
	var cleared: Array[String] = []
	for k in CharacterProfile.CHARACTER_OWNED_KEYS:
		if dto.has_character_payload(k):
			dto.clear_character_payload(k)
			cleared.append(k)
	dto.is_fallen = true
	dto.last_saved_time_utc = int(Time.get_unix_time_from_system())

	# 2. 世界零回退：时间继续推进 + 历史影响片段只增
	var world_time_after: Dictionary = {}
	if world != null:
		world.advance_world_time(1)
		world.append_history_fragment({"source": dto.character_name, "slot_id": slot_id, "event": "character_death"})
		world_time_after = world.world_time.duplicate()

	EventBusCore.get_instance().emit_domain_event("character.death", {"args": [slot_id], "summary": {"cleared_keys": cleared, "world_tick": world_time_after.get("tick", 0)}})
	return {"success": true, "cleared_keys": cleared, "is_fallen": true, "slot_reusable": true, "world_time": world_time_after}

# ==============================================================================
# 二、新角色重挂载
# ==============================================================================

## 新角色重挂载：同槽位返回全新角色档案（零继承）
static func spawn_fresh_character(slot_id: String, character_name: String) -> CharacterProfile:
	var profile := CharacterProfile.new()
	profile.character_id = slot_id
	profile.character_name = character_name
	return profile