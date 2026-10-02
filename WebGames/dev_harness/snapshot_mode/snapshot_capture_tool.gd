# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/snapshot_capture_tool.gd
# 架构定位: Runtime State Freezer / Snapshot Serializer
# 跨域依赖: 上游: 测试用例 / 开发者指令 | 下游: DAL, TestSnapshotBundleDTO
# 职责说明: 提供运行时全域内存状态现场一键冻结与抓取，序列化为持久化测试快照
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name SnapshotCaptureTool
extends RefCounted

const TestSnapshotBundleDTO = preload("res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")
const SnapshotInjectionSolver = preload("res://dev_harness/snapshot_mode/snapshot_injection_solver.gd")

## 抓取当前全域状态为快照 DTO
static func capture_current_state(snapshot_id: String, description: String = "", custom_ctx: RefCounted = null) -> TestSnapshotBundleDTO:
	var bundle := TestSnapshotBundleDTO.new()
	bundle.snapshot_id = snapshot_id
	bundle.description = description if not description.is_empty() else "运行时捕获现场快照: " + snapshot_id
	bundle.timestamp_utc = int(Time.get_unix_time_from_system())

	# 1. 优先从活动会话上下文汲取字段
	var ctx: RefCounted = custom_ctx if custom_ctx != null else SnapshotInjectionSolver.get_active_context()
	if ctx != null:
		_capture_from_context(bundle, ctx)

	# 2. 融合当前活动实体最新数值（若有活动注入）
	_capture_from_live_entities(bundle)

	# 3. 融合底层 DAL 数据提供者载荷
	var payload := SaveDataAccessLayer.build_save_payload()
	var data: Dictionary = payload.get("data", {})
	if not data.is_empty():
		_capture_from_dal_payload(bundle, data)

	return bundle

static func _capture_from_context(bundle: TestSnapshotBundleDTO, ctx: RefCounted) -> void:
	bundle.account_id = ctx.account_id
	bundle.session_token = ctx.session_token
	bundle.username = ctx.username
	bundle.world_id = ctx.current_world_id
	bundle.slot_id = ctx.current_slot_id
	bundle.character_id = ctx.character_id
	bundle.character_name = ctx.character_name
	bundle.race_id = ctx.race_id
	bundle.gender = ctx.gender
	if not ctx.wallet_snapshot.is_empty():
		for k in ctx.wallet_snapshot.keys():
			bundle.wallet_data[k] = ctx.wallet_snapshot[k]
	if not ctx.physiology_snapshot.is_empty():
		for k in ctx.physiology_snapshot.keys():
			bundle.physiology_data[k] = ctx.physiology_snapshot[k]

static func _capture_from_live_entities(bundle: TestSnapshotBundleDTO) -> void:
	var live_wallet = SnapshotInjectionSolver.get_active_wallet()
	if live_wallet != null:
		bundle.wallet_data["gold"] = live_wallet.gold
		bundle.wallet_data["copper"] = live_wallet.copper
		bundle.wallet_data["silver"] = live_wallet.silver
		bundle.wallet_data["platinum"] = live_wallet.platinum
		bundle.wallet_data["mana_monocrystals"] = live_wallet.mana_monocrystals

	var live_phys = SnapshotInjectionSolver.get_active_physiology()
	if live_phys != null and not live_phys.race_id.is_empty():
		bundle.race_id = live_phys.race_id

static func _capture_from_dal_payload(bundle: TestSnapshotBundleDTO, data: Dictionary) -> void:
	var acc_data: Dictionary = data.get("account", {})
	if not acc_data.is_empty():
		bundle.account_id = String(acc_data.get("account_id", bundle.account_id))
		bundle.username = String(acc_data.get("username", bundle.username))
		bundle.world_id = String(acc_data.get("active_world_slot", bundle.world_id))
		bundle.slot_id = String(acc_data.get("active_slot_id", bundle.slot_id))

	var char_data: Dictionary = data.get("character_creation", {})
	if not char_data.is_empty():
		bundle.character_id = String(char_data.get("character_id", bundle.character_id))
		bundle.character_name = String(char_data.get("character_name", bundle.character_name))
		bundle.race_id = String(char_data.get("selected_race_id", bundle.race_id))
		bundle.gender = String(char_data.get("selected_gender", bundle.gender))
		bundle.level = int(char_data.get("level", bundle.level))
		var raw_attr = char_data.get("attributes", {})
		if raw_attr is Dictionary:
			bundle.attributes = (raw_attr as Dictionary).duplicate(true)

	var phys_data: Dictionary = data.get("lifecycle_physiology", {})
	if not phys_data.is_empty():
		for k in phys_data.keys():
			bundle.physiology_data[k] = phys_data[k]

	var wallet_data: Dictionary = data.get("currency_economy", {})
	if not wallet_data.is_empty():
		for k in wallet_data.keys():
			bundle.wallet_data[k] = wallet_data[k]

	var inv_data: Dictionary = data.get("inventory", {})
	var items = inv_data.get("items", [])
	if items is Array:
		bundle.inventory_items = (items as Array).duplicate(true)

	var nav_data: Dictionary = data.get("world_navigation", {})
	if not nav_data.is_empty():
		bundle.location_name = String(nav_data.get("current_location_name", bundle.location_name))
		bundle.coordinates_x = float(nav_data.get("coordinates_x", bundle.coordinates_x))
		bundle.coordinates_y = float(nav_data.get("coordinates_y", bundle.coordinates_y))

	var quest_data: Dictionary = data.get("quest_causality", {})
	if not quest_data.is_empty():
		bundle.quest_dag_state = quest_data.duplicate(true)

	var standard_keys := [
		"account", "character_creation", "lifecycle_physiology",
		"currency_economy", "inventory", "world_navigation", "quest_causality"
	]
	for k in data.keys():
		if not standard_keys.has(k):
			bundle.domain_extensions[k] = data[k]

## 抓取并输出为格式化 JSON 字符串
static func capture_to_json_string(snapshot_id: String, description: String = "", custom_ctx = null) -> String:
	var bundle := capture_current_state(snapshot_id, description, custom_ctx)
	return JSON.stringify(bundle.to_dict(), "\t")

## 将快照保存为磁盘文件
static func save_snapshot_to_file(bundle: TestSnapshotBundleDTO, file_path: String) -> bool:
	if bundle == null or file_path.is_empty():
		return false
	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if file == null:
		return false
	var content := JSON.stringify(bundle.to_dict(), "\t")
	file.store_string(content)
	file.close()
	return true

