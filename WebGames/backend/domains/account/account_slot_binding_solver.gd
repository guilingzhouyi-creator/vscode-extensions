# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_slot_binding_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 账号→槽位→角色的首步落盘：校验槽位可用性、创建 SaveSlot 封面、绑定至账号；全部配置驱动，文字版鼠标/快捷键触发。
# 设计依据: 业务领域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

class_name AccountSlotBindingSolver extends RefCounted

const DOMAIN_ACCOUNT_CONFIG := "domains.account"

# ==============================================================================
# 一、创建角色与槽位绑定
# ==============================================================================

## 创建角色第一步：为指定账号的空槽位创建角色封面并绑定
## 边界：fallen 槽位（角色已死亡）可重挂新角色（零继承，slot_id 保持稳定）；
##       world_state_ref 经 ensure_account_world_ref 沿用账号当前世界（开关关闭不新建独立世界）。
static func create_character_in_slot(
	account: AccountProfileAggregate,
	slot_id: String,
	character_name: String,
	title_prefix: String = "",
	is_permadeath: bool = false,
	allow_default_fallback: bool = true
) -> Dictionary:
	if account == null:
		return {"success": false, "error_code": "INVALID_ACCOUNT"}
	if slot_id.is_empty():
		var next_id := account.get_next_available_slot_id()
		if next_id.is_empty():
			return {"success": false, "error_code": "NO_AVAILABLE_SLOT"}
		slot_id = next_id
	if account.is_slot_occupied(slot_id):
		var existing: SaveSlotSummaryDTO = account.get_summary_by_slot(slot_id)
		if existing == null or not existing.is_fallen:
			return {"success": false, "error_code": "SLOT_OCCUPIED", "slot_id": slot_id}
		# fallen 槽位可重挂：下方以全新 DTO 整体替换该槽位（零继承；不就地重置旧 DTO，无死代码）
	var require_explicit_name := GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "save_slot/unwired_policy/require_explicit_character_name", false)
	if character_name.strip_edges().is_empty():
		if not allow_default_fallback or require_explicit_name:
			return {
				"success": false,
				"error_code": "PENDING_CHARACTER_NAME",
				"unwired_slot": "character_name",
				"slot_id": slot_id
			}
		character_name = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/character_name", "Nameless Wanderer")
	var dto := SaveSlotSummaryDTO.new()
	dto.slot_id = slot_id
	dto.character_name = character_name
	dto.title_prefix = title_prefix if not title_prefix.is_empty() else GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/title_prefix", "Apprentice Adventurer")
	dto.is_permadeath_mode = is_permadeath
	dto.last_saved_time_utc = int(Time.get_unix_time_from_system())
	dto.current_location_name = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/current_location_name", "中洲·卡拉尔圣城")
	var bind_res := account.bind_character_to_slot(slot_id, dto)
	if not bind_res.success:
		return bind_res
	var world_ref := ensure_account_world_ref(account, allow_default_fallback)
	return {"success": true, "slot_id": slot_id, "character_name": character_name, "account_id": account.account_id, "world_state_ref": world_ref}

# ==============================================================================
# 二、快捷创建 / 世界引用沿用 / 网关档位状态桥接 / 解绑
# ==============================================================================

## 快捷创建：优先重挂 fallen 槽位，无 fallen 再自动选空槽（鼠标点击空槽热区触发）
static func quick_create_in_next_slot(account: AccountProfileAggregate, character_name: String, allow_default_fallback: bool = true) -> Dictionary:
	if account == null:
		return {"success": false, "error_code": "INVALID_ACCOUNT"}
	for slot_id in account.save_slot_summaries:
		var dto: SaveSlotSummaryDTO = account.save_slot_summaries[slot_id]
		if dto != null and dto.is_fallen:
			return create_character_in_slot(account, str(slot_id), character_name, "", false, allow_default_fallback)
	var next_id := account.get_next_available_slot_id()
	if next_id.is_empty():
		return {"success": false, "error_code": "NO_AVAILABLE_SLOT"}
	return create_character_in_slot(account, next_id, character_name, "", false, allow_default_fallback)

## 账号世界引用沿用：未接线严格模式下显式保留 UNBOUND 哨兵，不静默绑定默认世界
static func ensure_account_world_ref(account: AccountProfileAggregate, allow_default_fallback: bool = true) -> String:
	if account == null:
		return ""
	var require_explicit_world := GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "save_slot/unwired_policy/require_explicit_world_ref", false)
	var unbound_sentinel: String = GameConfig.get_string("infrastructure.lifecycle", "shutdown_hooks/unwired_slot_sentinel", "")
	if unbound_sentinel.is_empty():
		return ""
	if account.world_state_ref.is_empty() or account.world_state_ref == unbound_sentinel:
		if not allow_default_fallback or require_explicit_world:
			account.world_state_ref = unbound_sentinel
			return account.world_state_ref
		var template: Dictionary = GameConfig.get_dict("domains.world", "default_template", {"world_id": "WORLD_DEFAULT"})
		account.world_state_ref = String(template.get("world_id", "WORLD_DEFAULT"))
	return account.world_state_ref

## 将账号下的 SaveSlotSummaryDTO 导出为网关兼容的纯 Dictionary 档位状态列表（零跨领域类引用）
static func to_gateway_slot_states(account: AccountProfileAggregate, bound_world_id: String = "") -> Array:
	var out: Array = []
	if account == null:
		return out
	var effective_world := bound_world_id if not bound_world_id.is_empty() else account.world_state_ref
	for slot_id in account.save_slot_summaries.keys():
		var summary: SaveSlotSummaryDTO = account.save_slot_summaries[slot_id]
		if summary == null:
			continue
		var bound_character_id: String = ""
		if not summary.is_fallen and summary.character_profile != null:
			bound_character_id = summary.character_profile.character_id
		var is_occupied: bool = not bound_character_id.is_empty()
		out.append({
			"slot_id": str(slot_id),
			"account_id": account.account_id,
			"bound_world_id": effective_world,
			"bound_character_id": bound_character_id,
			"is_occupied": is_occupied,
			"is_first_creation": not is_occupied,
			"created_timestamp_utc": summary.last_saved_time_utc,
			"last_played_timestamp_utc": summary.last_saved_time_utc
		})
	return out

## 解绑：删除槽位角色（回退为空槽，active_slot 清理）
static func clear_slot(account: AccountProfileAggregate, slot_id: String) -> Dictionary:
	if account == null or slot_id.is_empty():
		return {"success": false, "error_code": "INVALID_SLOT"}
	if not account.save_slot_summaries.has(slot_id):
		return {"success": false, "error_code": "SLOT_EMPTY"}
	account.save_slot_summaries.erase(slot_id)
	if account.active_slot_id == slot_id:
		account.active_slot_id = ""
	EventBusCore.get_instance().emit_domain_event("account.slot_cleared", {"args": [slot_id], "summary": {"slot_id": slot_id}})
	return {"success": true, "slot_id": slot_id}
