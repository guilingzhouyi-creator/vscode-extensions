# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_profile.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 离线自洽账户、设备指纹绑定、多角色冒险插槽映射与天命传承点。 默认值/槽位上限由 config/domains/account.json 驱动；权限经 EntitlementService 密封鉴权（存档反序列化 fail-safe 校验）。
# 设计依据: 业务域第一性原理 / 账号与槽位生命周期契约
# ==============================================================================

class_name AccountProfileAggregate extends RefCounted

const DOMAIN_ACCOUNT_CONFIG: String = "domains.account"

# ==============================================================================
# 一、账户身份与设备绑定
# ==============================================================================

var account_id: String = ""
var username: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_username", "Adventurer")
var password_hash_sha256: String = ""
## 口令盐版本：1=按配置盐哈希（新档默认）；0=空盐历史档（login-time 重铸标记）
var salt_version: int = 1
var created_timestamp_utc: int = 0
var last_login_timestamp_utc: int = 0

var local_device_fingerprint: String = ""
var is_guest_mode: bool = false

# ==============================================================================
# 二、多角色存档插槽映射
# ==============================================================================

# 多角色存档插槽映射 (slot_id -> SaveSlotSummaryDTO)
var save_slot_summaries: Dictionary = {}
var active_slot_id: String = ""

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
func get_summary_by_slot(slot_id: String) -> SaveSlotSummaryDTO:
	if slot_id.is_empty():
		return null
	return save_slot_summaries.get(slot_id, null)

## 登记/覆盖槽位摘要（入参为空静默跳过）
func add_slot_summary(dto: SaveSlotSummaryDTO) -> void:
	if dto == null or dto.slot_id.is_empty():
		return
	save_slot_summaries[dto.slot_id] = dto

## 创建角色第一步：账号→槽位绑定（幂等，active_slot 切换，文字版鼠标/快捷键触发）
func bind_character_to_slot(slot_id: String, dto: SaveSlotSummaryDTO) -> Dictionary:
	if slot_id.is_empty() or dto == null:
		return {"success": false, "error_code": "INVALID_SLOT"}
	if dto.slot_id != slot_id:
		dto.slot_id = slot_id
	save_slot_summaries[slot_id] = dto
	active_slot_id = slot_id
	EventBusCore.get_instance().emit_domain_event("account.slot_bound", {"args": [slot_id], "summary": {"character": dto.character_name, "slot_id": slot_id}})
	return {"success": true, "slot_id": slot_id, "character_name": dto.character_name}

## 取下一个可用槽位 ID（SLOT_%02d 序号递增探测，满员返回空串）
func get_next_available_slot_id() -> String:
	var max_slots: int = GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "save_slot/max_slots", 3)
	var prefix: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "save_slot/id_prefix", "SLOT_")
	for i in range(1, max_slots + 1):
		var candidate: String = "%s%02d" % [prefix, i]
		if not save_slot_summaries.has(candidate):
			return candidate
	return ""

## 槽位是否已占用（save_slot_summaries 命中判定）
func is_slot_occupied(slot_id: String) -> bool:
	return save_slot_summaries.has(slot_id)

## 序列化账户聚合为字典（含槽位摘要序列化与权限密封 entitlements_seal）
func serialize() -> Dictionary:
	var slots_dict := {}
	for k in save_slot_summaries:
		var item = save_slot_summaries[k]
		if item is SaveSlotSummaryDTO:
			slots_dict[k] = item.serialize()
		elif item is Dictionary:
			slots_dict[k] = item
	return {
		"account_id": account_id,
		"username": username,
		"password_hash_sha256": password_hash_sha256,
		"salt_version": salt_version,
		"created_timestamp_utc": created_timestamp_utc,
		"last_login_timestamp_utc": last_login_timestamp_utc,
		"local_device_fingerprint": local_device_fingerprint,
		"is_guest_mode": is_guest_mode,
		"save_slot_summaries": slots_dict,
		"active_slot_id": active_slot_id,
		"meta_legacy_points": meta_legacy_points,
		"unlocked_heritage_traits": unlocked_heritage_traits,
		"entitlements": entitlements.duplicate(),
		"entitlements_seal": EntitlementService.seal_entitlements(self),
		"world_state_ref": world_state_ref
	}

## 从字典反序列化账户聚合：权限密封校验失败回退空集 + 白名单过滤（fail-safe，防存档自造权限）
static func deserialize(d: Dictionary) -> AccountProfileAggregate:
	var acc := AccountProfileAggregate.new()
	acc.account_id = d.get("account_id", "")
	acc.username = d.get("username", GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "auth/default_username", "Adventurer"))
	acc.password_hash_sha256 = d.get("password_hash_sha256", "")
	acc.salt_version = int(d.get("salt_version", 0))  # 旧档缺省 0 = 空盐历史档
	acc.created_timestamp_utc = d.get("created_timestamp_utc", 0)
	acc.last_login_timestamp_utc = d.get("last_login_timestamp_utc", 0)
	acc.local_device_fingerprint = d.get("local_device_fingerprint", "")
	acc.is_guest_mode = d.get("is_guest_mode", false)
	acc.active_slot_id = d.get("active_slot_id", "")
	acc.meta_legacy_points = d.get("meta_legacy_points", 0)
	acc.unlocked_heritage_traits = d.get("unlocked_heritage_traits", [])
	var raw_ent: Variant = d.get("entitlements", GameConfig.get_array(DOMAIN_ACCOUNT_CONFIG, "entitlements/default", []))
	if raw_ent is Array:
		acc.entitlements.assign(raw_ent) # 类型化转换：JSON/配置返回的未类型化 Array → Array[String]（防运行时类型错误）
	# 密封校验：存档携带密封而重算不符 → 数据被改/损坏 → 权限回退空（fail-safe，明文存档的完整性防线）
	var recorded_seal := str(d.get("entitlements_seal", ""))
	if not recorded_seal.is_empty() and not EntitlementService.verify_seal(acc, recorded_seal):
		acc.entitlements.clear()
	# 白名单过滤：allowed 非空时拒绝未列出资格（防存档自造权限；空列表=放行全部）
	acc.entitlements.assign(EntitlementService.filter_allowed(acc.entitlements))
	acc.world_state_ref = d.get("world_state_ref", "")

	var raw_slots = d.get("save_slot_summaries", {})
	for k in raw_slots:
		var slot_data = raw_slots[k]
		if slot_data is Dictionary:
			acc.save_slot_summaries[k] = SaveSlotSummaryDTO.deserialize(slot_data)
	return acc