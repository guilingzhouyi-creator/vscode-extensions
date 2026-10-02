# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/test_snapshot_builder.gd
# 架构定位: Fluent Builder / State Synthesizer
# 跨域依赖: 上游: 测试用例 / 开发者脚本 | 下游: TestSnapshotBundleDTO
# 职责说明: 提供流畅优雅的链式构造器，支持一行代码快速定制任意维度测试快照状态
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name TestSnapshotBuilder
extends RefCounted

const TestSnapshotBundleDTO = preload("res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd")

var _dto: TestSnapshotBundleDTO = null

func _init(snapshot_id: String = "BUILDER_SNAPSHOT") -> void:
	_dto = TestSnapshotBundleDTO.new()
	_dto.snapshot_id = snapshot_id
	_dto.timestamp_utc = int(Time.get_unix_time_from_system())

## 静态构造入口
static func create(snapshot_id: String = "BUILDER_SNAPSHOT") -> RefCounted:
	var normalized_id := snapshot_id.strip_edges()
	if normalized_id.is_empty():
		normalized_id = "BUILDER_SNAPSHOT"
	return new(normalized_id)

## 设置快照描述
func with_description(desc: String) -> RefCounted:
	_dto.description = desc
	return self

## 设置账号与世界槽位信息
func with_account(account_id: String, username: String = "", world_id: String = "WORLD_DEFAULT_SP_01", slot_id: String = "SLOT_01") -> RefCounted:
	_dto.account_id = account_id
	_dto.username = username if not username.is_empty() else account_id
	_dto.world_id = world_id
	_dto.slot_id = slot_id
	return self

## 设置角色元数据
func with_character(char_name: String, race: String = "HUMAN", gender: String = "MALE", level: int = 1) -> RefCounted:
	_dto.character_name = char_name
	_dto.character_id = "CHAR_" + char_name
	_dto.race_id = race
	_dto.gender = gender
	_dto.level = level
	return self

## 设置六维属性
func with_attributes(attrs: Dictionary) -> RefCounted:
	for k in attrs.keys():
		_dto.attributes[k] = attrs[k]
	return self

## 设置生命值
func with_hp(current: float, max_val: float) -> RefCounted:
	_dto.physiology_data["current_hp"] = current
	_dto.physiology_data["max_hp"] = max_val
	return self

## 设置魔力值
func with_mp(current: float, max_val: float) -> RefCounted:
	_dto.physiology_data["current_mp"] = current
	_dto.physiology_data["max_mp"] = max_val
	return self

## 设置耐力值
func with_stamina(current: float, max_val: float = 100.0) -> RefCounted:
	_dto.physiology_data["stamina"] = current
	_dto.physiology_data["max_stamina"] = max_val
	return self

## 设置理智值
func with_sanity(sanity: float) -> RefCounted:
	_dto.physiology_data["sanity"] = sanity
	return self

## 设置经济钱包资产
func with_wallet(gold: int, monocrystals: int = 0, copper: int = 0, silver: int = 0) -> RefCounted:
	_dto.wallet_data["gold"] = gold
	_dto.wallet_data["mana_monocrystals"] = monocrystals
	_dto.wallet_data["copper"] = copper
	_dto.wallet_data["silver"] = silver
	return self

## 增加一件背包物品
func with_item(item_data: Dictionary) -> RefCounted:
	_dto.inventory_items.append(item_data.duplicate(true))
	return self

## 设置地缘位置
func at_location(loc_name: String, x: float = 0.0, y: float = 0.0) -> RefCounted:
	_dto.location_name = loc_name
	_dto.coordinates_x = x
	_dto.coordinates_y = y
	return self

## 设置目标插入阶段
func at_stage(stage_key: String) -> RefCounted:
	_dto.target_stage_key = stage_key
	return self

## 增加领域扩展切片
func with_domain_extension(domain_id: String, data: Dictionary) -> RefCounted:
	_dto.domain_extensions[domain_id] = data.duplicate(true)
	return self

## 终结构建，产出只读 DTO
func build() -> TestSnapshotBundleDTO:
	return _dto
