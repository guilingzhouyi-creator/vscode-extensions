# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/anti_bridge_guard.gd
# 架构定位: Domain Security Guard / Anti-Privilege Escalation
# 跨域依赖: 上游: WorldGatewayFSM, GameModeRoutingSolver | 下游: EventBus | 配置: config/domains/world_gateway/core.json
# 职责说明: 拦截跨模式热切换、单机槽位跨界渗透联机与单机网络广播越权
# 设计依据: 业务领域第一性原理与气密级防越权安全规范
# ==============================================================================

class_name AntiBridgeGuard
extends RefCounted

const SECURITY_ERR_CROSS_MODE_HOT_SWAP: String = "SECURITY_ERR_CROSS_MODE_HOT_SWAP"
const SECURITY_ERR_MODE_NOT_READY: String = "SECURITY_ERR_MODE_NOT_READY"
const SECURITY_ERR_MULTIPLAYER_UNAUTHORIZED: String = "SECURITY_ERR_MULTIPLAYER_UNAUTHORIZED"
const SECURITY_ERR_SLOT_MODE_POISONING: String = "SECURITY_ERR_SLOT_MODE_POISONING"
const SECURITY_ERR_NETWORK_MUTE_VIOLATION: String = "SECURITY_ERR_NETWORK_MUTE_VIOLATION"

## 校验模式跃迁安全性（模式单向冻结、探针就绪报告、联机白名单资质）
static func validate_mode_transition(
	from_phase: int,
	to_phase: int,
	current_mode: int,
	target_mode: int,
	probe_report: Variant = null
) -> Dictionary:
	# 1. 模式单向冻结：若已选定模式且尝试直接切换至不同模式，必须经退网关全量洗脱
	if current_mode != WorldGatewayModel.GameMode.UNSELECTED and target_mode != current_mode:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_CROSS_MODE_HOT_SWAP,
			"message": "跨模式热切换被拦截: 模式已选定(%d)，变更至(%d)必须经退网关全量洗脱" % [current_mode, target_mode]
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
		"message": "模式跃迁安全裁定通过"
	}

## 检查探针报告就绪态
static func _check_probe_readiness(probe_report: Variant) -> Dictionary:
	var is_ready: bool = true
	var probe_msg: String = ""

	if probe_report is Object:
		if "is_ready" in probe_report:
			is_ready = bool(probe_report.get("is_ready"))
		if "message" in probe_report:
			probe_msg = str(probe_report.get("message"))
	elif probe_report is Dictionary:
		is_ready = bool(probe_report.get("is_ready", true))
		probe_msg = str(probe_report.get("message", ""))

	if not is_ready:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_MODE_NOT_READY,
			"message": "目标模式探针诊断未就绪: %s" % (probe_msg if not probe_msg.is_empty() else "环境未就绪")
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
			"message": "联机模式当前处于灰度维护状态，未对当前账号开放"
		}

	return {"allowed": true, "error_code": "", "message": ""}

## 校验存档槽位模式亲和性（阻断单机槽位跨界渗透至联机界域）
static func validate_slot_mode_affinity(slot_mode: int, target_mode: int) -> Dictionary:
	if slot_mode == WorldGatewayModel.GameMode.SINGLE_PLAYER and target_mode == WorldGatewayModel.GameMode.MULTIPLAYER:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_SLOT_MODE_POISONING,
			"message": "单机存档槽位严禁渗透至联机界域"
		}

	if slot_mode != target_mode and slot_mode != WorldGatewayModel.GameMode.UNSELECTED:
		return {
			"allowed": false,
			"error_code": SECURITY_ERR_SLOT_MODE_POISONING,
			"message": "槽位运行模式与目标模式不匹配: 槽位模式 %d, 目标模式 %d" % [slot_mode, target_mode]
		}

	return {
		"allowed": true,
		"error_code": "",
		"message": "槽位模式亲和性合规"
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
				"message": "单机模式网络信道静默违规，禁止广播远程通道: %s" % channel_name
			}

	return {
		"allowed": true,
		"error_code": "",
		"message": "信道通信合规"
	}

