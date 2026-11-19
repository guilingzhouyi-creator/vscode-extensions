# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/character_death_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 角色死亡时仅精确清理角色本体数据（白名单），世界时间/状态零回退， 历史影响片段只增不改；新角色零继承死亡角色完整状态。 核心规则：清理玩家角色状态，不清理世界状态；角色重新开始， 不代表世界重新开始。禁止：回档世界/删整档/重置时间/撤销影响/完整继承。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CharacterDeathSolver：Headless Discrete Solver / Numerical Calculator
class_name CharacterDeathSolver extends RefCounted

# ==============================================================================
# 一、角色死亡清理
# ==============================================================================

## 角色死亡清理（精确子集）：slot_summary 为槽位封面（含角色本体档案），world 可空
## 边界：重复死亡幂等（ALREADY_FALLEN）；死亡后槽位标记可重挂（slot_reusable）
static func handle_character_death(account: AccountProfile, slot_id: String, world: WorldInstance) -> Dictionary:
	if account == null or slot_id.is_empty():
		return {"success": false, "error_code": "INVALID_SLOT"}
	var slot_summary: SaveSlotDTO = account.get_summary_by_slot(slot_id)
	if slot_summary == null:
		return {"success": false, "error_code": "SLOT_EMPTY"}
	if slot_summary.is_fallen:
		return {"success": false, "error_code": "ALREADY_FALLEN", "slot_id": slot_id}

	# 1. 精确清理角色本体子集（白名单，禁删全档）
	var cleared_keys: Array[String] = []
	for owned_key in CharacterProfile.CHARACTER_OWNED_KEYS:
		if slot_summary.has_character_payload(owned_key):
			slot_summary.clear_character_payload(owned_key)
			cleared_keys.append(owned_key)
	slot_summary.is_fallen = true
	slot_summary.last_saved_time_utc = int(Time.get_unix_time_from_system())

	# 2. 世界零回退：时间继续推进 + 历史影响片段只增
	var world_time_after: Dictionary = {}
	if world != null:
		world.advance_world_time(1)
		world.append_history_fragment({"source": slot_summary.character_name, "slot_id": slot_id, "event": "character_death"})
		world_time_after = world.world_time.duplicate()

	EventBusCore.get_instance().emit_domain_event("character.death", {"category_key": "bio", "args": [slot_id], "summary": {"cleared_keys": cleared_keys, "world_tick": world_time_after.get("tick", 0)}})
	return {"success": true, "cleared_keys": cleared_keys, "is_fallen": true, "slot_reusable": true, "world_time": world_time_after}

# ==============================================================================
# 二、新角色重挂载
# ==============================================================================

## 新角色重挂载：同槽位返回全新角色档案（零继承）
static func spawn_fresh_character(slot_id: String, character_name: String) -> CharacterProfile:
	var profile := CharacterProfile.new()
	profile.character_id = slot_id
	profile.character_name = character_name
	return profile
