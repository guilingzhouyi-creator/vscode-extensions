# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_profile.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 离线自洽账户、设备指纹绑定、多角色冒险插槽映射与天命传承点。 默认值/槽位上限由 config/domains/account.json 驱动；权限经 EntitlementService 密封鉴权（存档反序列化 fail-safe 校验）。
# 退出语义与设计依据: 业务域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

## AccountProfile：Domain Logic Component
class_name AccountProfile extends RefCounted

const DOMAIN_ACCOUNT_CONFIG: String = "domains.account"
const WORLD_DEFAULT_SP_01: String = "WORLD_DEFAULT_SP_01"
const UNBOUND_WORLD_SLOT: String = "UNBOUND_WORLD_SLOT"
const RESERVED_PLACEHOLDER: String = "RESERVED_PLACEHOLDER"

# ==============================================================================
# 一、账户身份与设备绑定
# ==============================================================================

var account_id: String = ""
var username: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_username", "Adventurer")
var password_hash_sha256: String = ""
## 口令盐版本：1=按配置盐哈希（标准单盐模式）
var salt_version: int = 1
var created_timestamp_utc: int = 0
var last_login_timestamp_utc: int = 0

var local_device_fingerprint: String = ""
var is_guest_mode: bool = false

# ==============================================================================
# 二、多角色存档插槽映射
# ==============================================================================

# 多角色存档插槽映射 (slot_id -> SaveSlotDTO)
var save_slot_summaries: Dictionary = {}
var active_slot_id: String = ""
# 多世界存档插槽映射与占位符元数据 (world_id -> slot_id)
var world_slots: Dictionary = {
	WORLD_DEFAULT_SP_01: "SLOT_01"
}

# ==============================================================================
# 三、权限与传承状态
# ==============================================================================

# 权限/等级字段体系（可扩展，仅描述资格，不直担逻辑；经 EntitlementService 统一鉴权）
var entitlements: Array[String] = []

# 当前游玩世界实例引用（与角色解耦：角色死亡不重置世界）
var world_state_ref: String = ""

# 全局成就与天命传承点
var meta_legacy_points: int = 0
var unlocked_heritage_traits: Array = []

# ==============================================================================
# 四、槽位操作
# ==============================================================================

## 按槽位取档位摘要（未绑定返回 null）
func get_summary_by_slot(slot_id: String) -> SaveSlotDTO:
	if slot_id.is_empty():
		return null
	return save_slot_summaries.get(slot_id, null)

## 登记/覆盖槽位摘要（入参为空静默跳过）
func add_slot_summary(slot_summary: SaveSlotDTO) -> void:
	if slot_summary == null or slot_summary.slot_id.is_empty():
		return
	save_slot_summaries[slot_summary.slot_id] = slot_summary

## 创建角色第一步：账号→槽位绑定（幂等，active_slot 切换，文字版鼠标/快捷键触发）
func bind_character_to_slot(slot_id: String, slot_summary: SaveSlotDTO) -> Dictionary:
	if slot_id.is_empty() or slot_summary == null:
		return {"success": false, "error_code": "INVALID_SLOT"}
	if slot_summary.slot_id != slot_id:
		slot_summary.slot_id = slot_id
	save_slot_summaries[slot_id] = slot_summary
	active_slot_id = slot_id
	EventBusCore.get_instance().emit_domain_event("account.slot_bound", {"args": [slot_id], "summary": {"character": slot_summary.character_name, "slot_id": slot_id}})
	return {"success": true, "slot_id": slot_id, "character_name": slot_summary.character_name}

## 取下一个可用槽位 ID（SLOT_%02d 序号递增探测，满员返回空串）
func get_next_available_slot_id() -> String:
	var max_slots: int = GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "save_slot/max_slots", 3)
	var prefix: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/id_prefix", "SLOT_")
	for slot_index in range(1, max_slots + 1):
		var candidate: String = "%s%02d" % [prefix, slot_index]
		if not save_slot_summaries.has(candidate):
			return candidate
	return ""

## 槽位是否已占用（save_slot_summaries 命中判定）
func is_slot_occupied(slot_id: String) -> bool:
	if slot_id.is_empty():
		return false
	return save_slot_summaries.has(slot_id)

## 获取全量世界槽位状态
func get_world_slots(should_deep_copy: bool = true) -> Dictionary:
	if world_slots.is_empty():
		return {}
	return world_slots.duplicate(should_deep_copy)

## 获取当前活跃世界槽位
func get_active_world_slot() -> String:
	if not world_state_ref.is_empty():
		return world_state_ref
	return GameConfig.get_string("domains.world_gateway", "single_player/default_world_id", WORLD_DEFAULT_SP_01)

## 检查目标世界槽位是否为占位符/未决状态
func is_world_slot_placeholder(world_id: String) -> bool:
	if world_id.is_empty() or not world_slots.has(world_id):
		return true
	var slot_binding_state: String = str(world_slots.get(world_id, ""))
	return slot_binding_state == RESERVED_PLACEHOLDER or slot_binding_state == UNBOUND_WORLD_SLOT

## 绑定世界槽位
func bind_world_slot(world_id: String, slot_id: String) -> bool:
	if world_id.is_empty() or slot_id.is_empty():
		return false
	world_slots[world_id] = slot_id
	return true

## 序列化账户聚合为字典（含槽位摘要序列化与权限密封 entitlements_seal）
func serialize() -> Dictionary:
	var serialized_slots := {}
	for slot_key in save_slot_summaries:
		var slot_entry: Variant = save_slot_summaries[slot_key]
		if slot_entry is SaveSlotDTO:
			serialized_slots[slot_key] = slot_entry.serialize()
		elif slot_entry is Dictionary:
			serialized_slots[slot_key] = slot_entry
	return {
		"account_id": account_id,
		"username": username,
		"password_hash_sha256": password_hash_sha256,
		"salt_version": salt_version,
		"created_timestamp_utc": created_timestamp_utc,
		"last_login_timestamp_utc": last_login_timestamp_utc,
		"local_device_fingerprint": local_device_fingerprint,
		"is_guest_mode": is_guest_mode,
		"save_slot_summaries": serialized_slots,
		"active_slot_id": active_slot_id,
		"meta_legacy_points": meta_legacy_points,
		"unlocked_heritage_traits": unlocked_heritage_traits,
		"entitlements": entitlements.duplicate(),
		"entitlements_seal": EntitlementService.seal_entitlements(self),
		"world_state_ref": world_state_ref,
		"world_slots": world_slots.duplicate()
	}

## 从字典反序列化账户聚合：权限密封校验失败回退空集 + 白名单过滤（fail-safe，防存档自造权限）
static func deserialize(serialized_payload: Dictionary) -> AccountProfile:
	var account := AccountProfile.new()
	account.account_id = serialized_payload.get("account_id", "")
	account.username = serialized_payload.get("username", GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_username", "Adventurer"))
	account.password_hash_sha256 = serialized_payload.get("password_hash_sha256", "")
	account.salt_version = int(serialized_payload.get("salt_version", 1))
	account.created_timestamp_utc = serialized_payload.get("created_timestamp_utc", 0)
	account.last_login_timestamp_utc = serialized_payload.get("last_login_timestamp_utc", 0)
	account.local_device_fingerprint = serialized_payload.get("local_device_fingerprint", "")
	account.is_guest_mode = serialized_payload.get("is_guest_mode", false)
	account.active_slot_id = serialized_payload.get("active_slot_id", "")
	account.meta_legacy_points = serialized_payload.get("meta_legacy_points", 0)
	account.unlocked_heritage_traits = serialized_payload.get("unlocked_heritage_traits", [])
	var raw_entitlements: Variant = serialized_payload.get("entitlements", GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "entitlements/default", []))
	if raw_entitlements is Array:
		account.entitlements.assign(raw_entitlements) # 类型化转换：JSON/配置返回的未类型化 Array → Array[String]（防运行时类型错误）
	# 密封校验：开启安全存储或环境中存在密封密钥时强制完整验签（缺封或篡改均清零权限）；否则兼容已附密封的防篡改校验
	var recorded_seal := str(serialized_payload.get("entitlements_seal", ""))
	var has_seal_key := not CryptoIntegrityLib.resolve_seal_key_bytes(LogConstants.CFG_ADMIN_TABLE, LogConstants.CFG_PATH_SECURITY_SEAL_ENV).is_empty()
	var is_seal_required := EntitlementService.encrypted_storage_enabled() or has_seal_key
	if is_seal_required:
		if recorded_seal.is_empty() or not EntitlementService.verify_seal(account, recorded_seal):
			account.entitlements.clear()
	elif not recorded_seal.is_empty() and not EntitlementService.verify_seal(account, recorded_seal):
		account.entitlements.clear()
	# 白名单过滤：allowed 非空时拒绝未列出资格（防存档自造权限；空列表=放行全部）
	account.entitlements.assign(EntitlementService.filter_allowed(account.entitlements))
	account.world_state_ref = serialized_payload.get("world_state_ref", "")

	var raw_world_slots: Variant = serialized_payload.get("world_slots", {})
	if raw_world_slots is Dictionary and not (raw_world_slots as Dictionary).is_empty():
		account.world_slots = (raw_world_slots as Dictionary).duplicate()
	else:
		account.world_slots = {
			WORLD_DEFAULT_SP_01: "SLOT_01"
		}

	var raw_slots: Variant = serialized_payload.get("save_slot_summaries", {})
	for slot_key in raw_slots:
		var slot_payload: Variant = raw_slots[slot_key]
		if slot_payload is Dictionary:
			account.save_slot_summaries[slot_key] = SaveSlotDTO.deserialize(slot_payload)
	return account
