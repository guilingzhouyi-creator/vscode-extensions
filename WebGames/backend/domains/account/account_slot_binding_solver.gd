# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_slot_binding_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 账号→槽位→角色的首步落盘：校验槽位可用性、创建 SaveSlot 封面、绑定至账号；全部配置驱动，文字版鼠标/快捷键触发。
# 退出语义与设计依据: 业务领域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

## AccountSlotBindingSolver：Headless Discrete Solver / Numerical Calculator
class_name AccountSlotBindingSolver extends RefCounted

const AccountRepository = preload("res://backend/domains/account/account_repository.gd")
const CharacterProfile = preload("res://backend/domains/account/character_profile.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const AccountSlotCreationDTO = preload("res://backend/domains/account/dto/account_slot_creation_dto.gd")
const DOMAIN_ACCOUNT_CONFIG := "domains.account"

# ==============================================================================
# 一、创建角色与槽位绑定
# ==============================================================================

## 强类型上下文创角入口（GOV-DAT-001 参数泥团收敛规范）
static func create_character_in_slot_context(creation_context: AccountSlotCreationDTO) -> Dictionary:
	if creation_context == null:
		return {"success": false, "error_code": "INVALID_CONTEXT"}
	return _create_character_in_slot_internal(creation_context)

## 创建角色第一步：为指定账号的空槽位创建角色封面并绑定
## 边界：fallen 槽位（角色已死亡）可重挂新角色（零继承，slot_id 保持稳定）；
##       world_state_ref 经 ensure_account_world_ref 沿用账号当前世界（开关关闭不新建独立世界）。
##       若 provision_disk 为 true（或配置 auto_provision_disk 开启），则预创建初始物理存档；
##       若账号已注册于 AccountRepository，则同步持久化槽位摘要。
static func create_character_in_slot(
	account: AccountProfile,
	slot_id: String,
	character_name: String,
	title_prefix: String = "",
	is_permadeath: bool = false,
	allow_default_fallback: bool = true,
	provision_disk: bool = false
) -> Dictionary:
	var creation_context := AccountSlotCreationDTO.new({
		"account": account,
		"slot_id": slot_id,
		"character_name": character_name,
		"title_prefix": title_prefix,
		"is_permadeath": is_permadeath,
		"allow_default_fallback": allow_default_fallback,
		"provision_disk": provision_disk
	})
	return _create_character_in_slot_internal(creation_context)

static func _create_character_in_slot_internal(creation_context: AccountSlotCreationDTO) -> Dictionary:
	var account: AccountProfile = creation_context.account
	if account == null:
		return {"success": false, "error_code": "INVALID_ACCOUNT"}
	var slot_id: String = _resolve_target_slot_id(account, creation_context.slot_id)
	if slot_id.is_empty():
		return {"success": false, "error_code": "NO_AVAILABLE_SLOT"}
	if not _can_bind_slot(account, slot_id):
		return {"success": false, "error_code": "SLOT_OCCUPIED", "slot_id": slot_id}

	var name_result: Dictionary = _resolve_character_name(slot_id, creation_context.character_name, creation_context.allow_default_fallback)
	if not bool(name_result.get("success", false)):
		return name_result
	var character_name: String = str(name_result.get("character_name", ""))

	var slot_summary := SaveSlotDTO.new()
	slot_summary.slot_id = slot_id
	slot_summary.character_name = character_name
	slot_summary.title_prefix = creation_context.title_prefix if not creation_context.title_prefix.is_empty() else GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/title_prefix", "Apprentice Adventurer")
	slot_summary.is_permadeath_mode = creation_context.is_permadeath
	slot_summary.last_saved_time_utc = int(Time.get_unix_time_from_system())
	slot_summary.current_location_name = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/current_location_name", "Central Continent · Kalar Holy City")
	_attach_initial_profile_for_race(slot_summary, character_name, creation_context.race)

	var bind_result := account.bind_character_to_slot(slot_id, slot_summary)
	if not bind_result.success:
		return bind_result

	var provision_result: Dictionary = _provision_slot_disk_if_needed(slot_id, character_name, slot_summary, creation_context.provision_disk)
	var repository := AccountRepository.get_instance()
	if repository.has_account(account.account_id):
		repository.save_account(account)

	var world_reference := ensure_account_world_ref(account, creation_context.allow_default_fallback)
	return {
		"success": true,
		"slot_id": slot_id,
		"character_name": character_name,
		"account_id": account.account_id,
		"world_state_ref": world_reference,
		"provision_result": provision_result
	}

static func _resolve_target_slot_id(account: AccountProfile, requested_slot_id: String) -> String:
	if not requested_slot_id.is_empty():
		return requested_slot_id
	return account.get_next_available_slot_id()

static func _can_bind_slot(account: AccountProfile, slot_id: String) -> bool:
	if not account.is_slot_occupied(slot_id):
		return true
	var existing: SaveSlotDTO = account.get_summary_by_slot(slot_id)
	# fallen 槽位可重挂：外层以全新 DTO 整体替换（零继承；不就地重置旧 DTO，无死代码）
	return existing != null and existing.is_fallen

static func _resolve_character_name(slot_id: String, raw_name: String, allow_default_fallback: bool) -> Dictionary:
	var require_explicit_name := GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "save_slot/unwired_policy/require_explicit_character_name", false)
	if raw_name.strip_edges().is_empty():
		if not allow_default_fallback or require_explicit_name:
			return {
				"success": false,
				"error_code": "PENDING_CHARACTER_NAME",
				"unwired_slot": "character_name",
				"slot_id": slot_id
			}
		return {
			"success": true,
			"character_name": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/defaults/character_name", "Nameless Wanderer")
		}
	return {"success": true, "character_name": raw_name}

static func _attach_initial_profile_for_race(slot_summary: SaveSlotDTO, character_name: String, race: String) -> void:
	var clean_race: String = race.strip_edges()
	if clean_race.is_empty():
		return
	var character_profile := CharacterProfile.new()
	character_profile.character_id = IdGenerator.next_id("CHR_")
	character_profile.character_name = character_name
	character_profile.character_exclusive_progress["race"] = clean_race
	slot_summary.attach_character_profile(character_profile)

static func _provision_slot_disk_if_needed(
	slot_id: String,
	character_name: String,
	slot_summary: SaveSlotDTO,
	provision_disk: bool
) -> Dictionary:
	var should_provision := provision_disk or GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "save_slot/auto_provision_disk", false)
	if not should_provision:
		return {}
	var template: Dictionary = GameConfig.get_dict(DOMAIN_ACCOUNT_CONFIG, "save_slot/provision_template", {"level": 1, "gold": 0})
	var init_payload := {
		"version": 1,
		"data": {
			"character_info": {
				"name": character_name,
				"level": int(template.get("level", 1))
			},
			"wallet": {
				"gold": int(template.get("gold", 0))
			}
		}
	}
	var provision_result: Dictionary = SaveDataAccessLayer.save_game(slot_id, init_payload)
	if bool(provision_result.get("success", false)):
		slot_summary.save_file_sha256 = str(provision_result.get("sha256", ""))
	return provision_result

# ==============================================================================
# 二、快捷创建 / 世界引用沿用 / 网关档位状态桥接 / 解绑
# ==============================================================================

## 快捷创建：优先重挂 fallen 槽位，无 fallen 再自动选空槽（鼠标点击空槽热区触发）
static func quick_create_in_next_slot(account: AccountProfile, character_name: String, allow_default_fallback: bool = true, provision_disk: bool = false) -> Dictionary:
	if account == null:
		return {"success": false, "error_code": "INVALID_ACCOUNT"}
	for slot_id in account.save_slot_summaries:
		var slot_summary: SaveSlotDTO = account.save_slot_summaries[slot_id]
		if slot_summary != null and slot_summary.is_fallen:
			return create_character_in_slot(account, str(slot_id), character_name, "", false, allow_default_fallback, provision_disk)
	var next_id := account.get_next_available_slot_id()
	if next_id.is_empty():
		return {"success": false, "error_code": "NO_AVAILABLE_SLOT"}
	return create_character_in_slot(account, next_id, character_name, "", false, allow_default_fallback, provision_disk)

## 账号世界引用沿用：未接线严格模式下显式保留 UNBOUND 哨兵，不静默绑定默认世界
static func ensure_account_world_ref(account: AccountProfile, allow_default_fallback: bool = true) -> String:
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

## 将账号下的 SaveSlotDTO 导出为网关兼容的纯 Dictionary 档位状态列表（零跨领域类引用）
static func to_gateway_slot_states(account: AccountProfile, bound_world_id: String = "") -> Array:
	var slot_states: Array = []
	if account == null:
		return slot_states
	var effective_world := bound_world_id if not bound_world_id.is_empty() else account.world_state_ref
	for slot_id in account.save_slot_summaries.keys():
		var summary: SaveSlotDTO = account.save_slot_summaries[slot_id]
		if summary == null:
			continue
		var bound_character_id: String = ""
		if not summary.is_fallen and summary.character_profile != null:
			bound_character_id = summary.character_profile.character_id
		var is_occupied: bool = not bound_character_id.is_empty()
		slot_states.append({
			"slot_id": str(slot_id),
			"account_id": account.account_id,
			"bound_world_id": effective_world,
			"bound_character_id": bound_character_id,
			"is_occupied": is_occupied,
			"is_first_creation": not is_occupied,
			"created_timestamp_utc": summary.last_saved_time_utc,
			"last_played_timestamp_utc": summary.last_saved_time_utc
		})
	return slot_states

## 将账号下的 SaveSlotDTO 导出为前端 AccountEntryView 消费的槽位字典列表
## 字段契约: slot_id, name, race, class, level, town, empty
## 保证槽位按照 max_slots (读 domains.account save_slot/max_slots 配置，默认 3) 补全空槽 (empty=true)
static func to_frontend_character_slots(account: AccountProfile) -> Array:
	var frontend_slots: Array = []
	var max_slots: int = GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "save_slot/max_slots", 3)
	if max_slots <= 0:
		max_slots = 3
	var prefix: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/id_prefix", "SLOT_")
	for slot_index in range(1, max_slots + 1):
		var slot_id: String = "%s%02d" % [prefix, slot_index]
		frontend_slots.append(get_frontend_character_slot(account, slot_id))
	return frontend_slots

## 导出单个指定槽位的前端消费字典（创角即时回传与列表导出单源复用）
static func get_frontend_character_slot(account: AccountProfile, slot_id: String) -> Dictionary:
	var summary: SaveSlotDTO = null
	var is_occupied: bool = false
	if account != null and account.save_slot_summaries.has(slot_id):
		summary = account.save_slot_summaries[slot_id]
		if summary != null and not summary.is_fallen:
			is_occupied = true
	return _to_frontend_slot_dict(slot_id, summary, is_occupied)

static func _to_frontend_slot_dict(slot_id: String, summary: SaveSlotDTO, is_occupied: bool) -> Dictionary:
	if not is_occupied or summary == null:
		return {
			"slot_id": slot_id,
			"name": "",
			"race": "",
			"class": "",
			"level": 0,
			"town": "",
			"empty": true
		}
	var race_value: String = "HUMAN"
	var level_value: int = 1
	if summary.character_profile != null:
		if summary.character_profile.growth_state.has("level"):
			level_value = int(summary.character_profile.growth_state.get("level", 1))
		elif "level" in summary.character_profile:
			level_value = int(summary.character_profile.get("level"))
		if summary.character_profile.character_exclusive_progress.has("race"):
			race_value = str(summary.character_profile.character_exclusive_progress.get("race"))
		elif "race" in summary.character_profile:
			race_value = str(summary.character_profile.get("race"))
	var class_value: String = summary.profession_tier_name if not summary.profession_tier_name.is_empty() else "WARRIOR"
	var town_value: String = summary.current_location_name if not summary.current_location_name.is_empty() else "TOWN_START"
	return {
		"slot_id": slot_id,
		"name": summary.character_name,
		"race": race_value,
		"class": class_value,
		"level": level_value,
		"town": town_value,
		"empty": false
	}

## 解绑：删除槽位角色（回退为空槽，active_slot 清理）
static func clear_slot(account: AccountProfile, slot_id: String) -> Dictionary:
	if account == null or slot_id.is_empty():
		return {"success": false, "error_code": "INVALID_SLOT"}
	if not account.save_slot_summaries.has(slot_id):
		return {"success": false, "error_code": "SLOT_EMPTY"}
	account.save_slot_summaries.erase(slot_id)
	if account.active_slot_id == slot_id:
		account.active_slot_id = ""
	var repository := AccountRepository.get_instance()
	if repository.has_account(account.account_id):
		repository.save_account(account)
	EventBusCore.get_instance().emit_domain_event("account.slot_cleared", {"args": [slot_id], "summary": {"slot_id": slot_id}})
	return {"success": true, "slot_id": slot_id}
