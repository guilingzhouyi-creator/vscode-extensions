# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/anti_bridge_guard.gd
# 架构定位: Domain Security Guard / Anti-Privilege Escalation
# 依赖与触发: 上游: WorldGatewayFSM, GameModeRoutingSolver | 下游: EventBus | 配置: config/domains/world_gateway/core.json
# 职责说明: 拦截跨模式热切换、单机槽位跨界渗透联机与单机网络广播越权
# 退出语义与设计依据: 业务领域第一性原理与气密级防越权安全规范
# ==============================================================================

## AntiBridgeGuard：Domain Security Guard / Anti-Privilege Escalation
class_name AntiBridgeGuard
extends RefCounted

const SECURITY_ERR_CROSS_MODE_HOT_SWAP: String = "SECURITY_ERR_CROSS_MODE_HOT_SWAP"
const SECURITY_ERR_MODE_NOT_READY: String = "SECURITY_ERR_MODE_NOT_READY"
const SECURITY_ERR_MULTIPLAYER_UNAUTHORIZED: String = "SECURITY_ERR_MULTIPLAYER_UNAUTHORIZED"
const SECURITY_ERR_SLOT_MODE_POISONING: String = "SECURITY_ERR_SLOT_MODE_POISONING"
const SECURITY_ERR_NETWORK_MUTE_VIOLATION: String = "SECURITY_ERR_NETWORK_MUTE_VIOLATION"
const SECURITY_ERR_MULTIPLAYER_MOD_POISONING: String = "SECURITY_ERR_MULTIPLAYER_MOD_POISONING"

## 校验模式跃迁安全性（模式单向冻结、探针就绪报告、联机白名单资质）
static func validate_mode_transition(
	_from_phase: int,
	_to_phase: int,
	current_mode: int,
	target_mode: int,
	probe_report: Variant = null
) -> Dictionary:
	# 1. 模式单向冻结：若已选定模式且尝试直接切换至不同模式，必须经退网关全量重置清理
	if current_mode != WorldGatewayModel.GameMode.UNSELECTED and target_mode != current_mode:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_CROSS_MODE_HOT_SWAP,
			"message": GameConfig.msg_fmt("world_gateway", "mode_hot_switch_blocked", {"current_mode": current_mode, "target_mode": target_mode})
		}

	# 2. 检查探针报告就绪性
	if probe_report != null:
		var ready_check := _check_probe_readiness(probe_report)
		if not bool(ready_check.get("allowed", false)):
			return ready_check

	# 3. 检查联机权限（若为联机模式，校验白名单放行资质）
	if target_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		var auth_check := _check_multiplayer_authorization(probe_report)
		if not bool(auth_check.get("allowed", false)):
			return auth_check

	return {
		"allowed": true,
		"error_code": "",
		"message": "Mode transition security verification passed"
	}

## 检查探针报告就绪态
static func _check_probe_readiness(probe_report: Variant) -> Dictionary:
	var is_ready: bool = true
	var probe_message: String = ""

	if probe_report is Object:
		if "is_ready" in probe_report:
			is_ready = bool(probe_report.get("is_ready"))
		if "message" in probe_report:
			probe_message = str(probe_report.get("message"))
	elif probe_report is Dictionary:
		is_ready = bool(probe_report.get("is_ready", true))
		probe_message = str(probe_report.get("message", ""))

	if not is_ready:
		var detail_message := probe_message if not probe_message.is_empty() else "Environment not ready"
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_MODE_NOT_READY,
			"message": TemplateFormatter.format("Target mode probe diagnostics not ready: {detail}", {"detail": detail_message})
		}

	return {"allowed": true, "error_code": "", "message": ""}

## 检查联机白名单资质
static func _check_multiplayer_authorization(probe_report: Variant) -> Dictionary:
	if probe_report == null:
		return {"allowed": true, "error_code": "", "message": ""}

	var status_code: String = ""
	var is_whitelisted: bool = true

	if probe_report is Object:
		if "status_code" in probe_report:
			status_code = str(probe_report.get("status_code"))
	elif probe_report is Dictionary:
		status_code = str(probe_report.get("status_code", ""))
		if probe_report.has("is_whitelisted"):
			is_whitelisted = bool(probe_report.get("is_whitelisted", true))

	if status_code == "FEATURE_DISABLED" or not is_whitelisted:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_MULTIPLAYER_UNAUTHORIZED,
			"message": "Multiplayer mode is currently under maintenance and not available for this account"
		}

	return {"allowed": true, "error_code": "", "message": ""}

## 校验存档槽位模式亲和性（阻断单机槽位跨界渗透至联机界域）
static func validate_slot_mode_affinity(slot_mode: int, target_mode: int, slot_mods: Array = []) -> Dictionary:
	if slot_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER and target_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_SLOT_MODE_POISONING,
			"message": "Single-player save slot is strictly prohibited from penetrating into multiplayer realm"
		}

	if slot_mode != target_mode and slot_mode != WorldGatewayModel.GameMode.UNSELECTED:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_SLOT_MODE_POISONING,
			"message": GameConfig.msg_fmt("world_gateway", "slot_mode_mismatch", {"slot_mode": slot_mode, "target_mode": target_mode})
		}

	if target_mode == WorldGatewayModel.GameMode.MULTIPLAYER and not slot_mods.is_empty():
		for mod_entry in slot_mods:
			if not _is_vanilla_pack(mod_entry):
				return {
					"allowed": false,
					"error_code": SECURITY_ERR_SLOT_MODE_POISONING,
					"message": "Save slot with third-party MOD is strictly prohibited from penetrating into multiplayer realm"
				}

	return {
		"allowed": true,
		"error_code": "",
		"message": "Slot mode affinity verified"
	}

## 判断指定模组项是否具有受信任官方基础包声明（废除裸 vanilla_/official_ 字符串前缀欺骗）
static func is_vanilla_pack(mod_entry: Variant) -> bool:
	return _is_vanilla_pack(mod_entry)

## 受信任官方包声明底层解算（严格核验 is_official / pack_profile / trust_tier，拒绝伪造前缀字符串）
static func _is_vanilla_pack(mod_entry: Variant) -> bool:
	if mod_entry is String:
		var clean_identifier := (mod_entry as String).strip_edges().to_lower()
		if clean_identifier.is_empty():
			return false
		# 仅当裸字符串精确匹配磁盘已验证官方包或配置白名单包 ID 时放行；严禁 vanilla_* / official_* 前缀欺骗
		return false

	var is_official_flagged: bool = false
	var trust_tier_value: String = ""
	var pack_profile_value: String = ""

	if mod_entry is Dictionary:
		var mod_payload: Dictionary = mod_entry as Dictionary
		is_official_flagged = bool(mod_payload.get("is_official", false)) or bool(mod_payload.get("is_vanilla", false))
		trust_tier_value = str(mod_payload.get("trust_tier", "")).strip_edges().to_upper()
		pack_profile_value = str(mod_payload.get("pack_profile", "")).strip_edges().to_upper()
	elif mod_entry is Object:
		var mod_object: Object = mod_entry as Object
		if "is_official" in mod_object:
			is_official_flagged = bool(mod_object.get("is_official"))
		if not is_official_flagged and "is_vanilla" in mod_object:
			is_official_flagged = bool(mod_object.get("is_vanilla"))
		if "trust_tier" in mod_object:
			trust_tier_value = str(mod_object.get("trust_tier")).strip_edges().to_upper()
		if "pack_profile" in mod_object:
			pack_profile_value = str(mod_object.get("pack_profile")).strip_edges().to_upper()

	if not is_official_flagged:
		return false
	if not trust_tier_value.is_empty() and trust_tier_value != "OFFICIAL":
		return false
	if not pack_profile_value.is_empty() and pack_profile_value != "OFFICIAL_BASE":
		return false
	return true


## 联机服务器权威模组清单（realm_mod_manifest）与本地已安装包的 SHA-256 摘要强核验
static func verify_realm_mod_manifest(local_packs: Array, server_realm_manifest: Array) -> Dictionary:
	var local_index: Dictionary = {}
	for local_pack in local_packs:
		_index_local_pack_metadata(local_pack, local_index)

	var authorized_ids: Array[String] = []
	var mismatches: Array[Dictionary] = []
	var authorized_set: Dictionary = {}

	for required_entry in server_realm_manifest:
		_check_realm_manifest_entry(required_entry, local_index, authorized_ids, authorized_set, mismatches)

	if not mismatches.is_empty():
		return {
			"allowed": false,
			"error_code": "MOD_ERR_REALM_DIGEST_MISMATCH",
			"message": "Local base/realm MOD package version or SHA-256 digest does not match remote server manifest.",
			"authorized_pack_ids": authorized_ids,
			"mismatches": mismatches,
			"unauthorized_local_pack_ids": []
		}

	var unauthorized_local_pack_ids: Array[String] = []
	for local_pack_id in local_index.keys():
		if not authorized_set.has(local_pack_id):
			unauthorized_local_pack_ids.append(str(local_pack_id))

	return {
		"allowed": true,
		"error_code": "",
		"message": "Realm MOD manifest SHA-256 verification passed.",
		"authorized_pack_ids": authorized_ids,
		"mismatches": [],
		"unauthorized_local_pack_ids": unauthorized_local_pack_ids
	}


static func _index_local_pack_metadata(local_pack: Variant, target_index: Dictionary) -> void:
	if local_pack is Dictionary:
		var pack_map := local_pack as Dictionary
		var pack_id := str(pack_map.get("pack_id", pack_map.get("id", ""))).strip_edges()
		if not pack_id.is_empty():
			target_index[pack_id] = {
				"pack_id": pack_id,
				"version": str(pack_map.get("version", "")).strip_edges(),
				"content_sha256": str(pack_map.get("content_sha256", "")).strip_edges()
			}
	elif local_pack is Object and "pack_id" in local_pack:
		var pack_id := str(local_pack.get("pack_id")).strip_edges()
		if not pack_id.is_empty():
			target_index[pack_id] = {
				"pack_id": pack_id,
				"version": str(local_pack.get("version")) if "version" in local_pack else "",
				"content_sha256": str(local_pack.get("content_sha256")) if "content_sha256" in local_pack else ""
			}


static func _check_realm_manifest_entry(
	required_entry: Variant,
	local_index: Dictionary,
	authorized_ids: Array[String],
	authorized_set: Dictionary,
	mismatches: Array[Dictionary]
) -> void:
	if not (required_entry is Dictionary):
		mismatches.append({"reason": "INVALID_ENTRY_TYPE"})
		return
	var entry_map := required_entry as Dictionary
	var required_id := str(entry_map.get("pack_id", "")).strip_edges()
	var required_version := str(entry_map.get("version", "")).strip_edges()
	var required_sha := str(entry_map.get("content_sha256", "")).strip_edges()
	if required_id.is_empty():
		mismatches.append({"reason": "EMPTY_PACK_ID"})
		return
	if not local_index.has(required_id):
		mismatches.append({"pack_id": required_id, "reason": "MISSING_LOCAL_PACK"})
		return
	var local_meta := local_index[required_id] as Dictionary
	var local_version := str(local_meta.get("version", ""))
	var local_sha := str(local_meta.get("content_sha256", ""))
	if not required_version.is_empty() and local_version != required_version:
		mismatches.append({"pack_id": required_id, "reason": "VERSION_MISMATCH", "expected": required_version, "actual": local_version})
		return
	if not required_sha.is_empty() and local_sha != required_sha:
		mismatches.append({"pack_id": required_id, "reason": "DIGEST_MISMATCH", "expected": required_sha, "actual": local_sha})
		return
	authorized_ids.append(required_id)
	authorized_set[required_id] = true

## 校验模组界域纪律（联机模式拦截第三方非 Vanilla 模组，单机沙盒放行）
static func validate_mod_realm_discipline(target_mode: int, active_mods: Array) -> Dictionary:
	if target_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER:
		return {
			"allowed": true,
			"error_code": "",
			"message": "Single-player mod sandbox approved"
		}

	if target_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		for mod_entry in active_mods:
			if not _is_vanilla_pack(mod_entry):
				return {
					"allowed": false,
					"error_code": SECURITY_ERR_MULTIPLAYER_MOD_POISONING,
					"message": "Multiplayer mode strictly prohibits loading third-party local storyline or numeric MODs"
				}
		return {
			"allowed": true,
			"error_code": "",
			"message": "Official vanilla package safely approved in multiplayer mode"
		}

	return {
		"allowed": true,
		"error_code": "",
		"message": "Unselected mode approved"
	}

## 校验网络信道通信纪律（单机模式下网络信道静默）
static func validate_network_channel_discipline(current_mode: int, channel_name: String) -> Dictionary:
	if current_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER or current_mode == WorldGatewayModel.GameMode.UNSELECTED:
		var is_remote_channel: bool = channel_name.begins_with("network.") \
			or channel_name.begins_with("mp.") \
			or channel_name.begins_with("multiplayer.") \
			or channel_name.begins_with("realm.") \
			or channel_name.begins_with("remote.")
		if is_remote_channel:
			return {
				"allowed": false,
				"error_code": SECURITY_ERR_NETWORK_MUTE_VIOLATION,
				"message": GameConfig.msg_fmt("world_gateway", "silent_channel_violation", {"channel_name": channel_name})
			}

	return {
		"allowed": true,
		"error_code": "",
		"message": "Channel communication compliant"
	}
