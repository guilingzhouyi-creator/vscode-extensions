# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/identity_disguise/character_identity_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/identity_disguise.json | 信号: EventBus 领域广播
# 职责说明: 允许非唯一重名自由、绑定不可变 UUID、管理本源真名与多重假名面具履历
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CharacterIdentityAggregate
extends RefCounted

const DEFAULT_DISGUISE_QUALITY: float = 50.0

class AliasProfile extends RefCounted:
	var alias_id: String                    # 假名唯一 ID (UUID)
	var display_name: String                # 对外显示的虚假姓名 (允许任意重名)
	var disguise_quality_score: float = GameConfig.get_float("domains.identity_disguise", "defaults/disguise_quality_score", DEFAULT_DISGUISE_QUALITY)# 易容伪装精密度 (0~100)
	var accumulated_reputation: int = 0     # 该假名积累的声望
	var accumulated_infamy_bounty: int = 0  # 该假名被通缉的恶名赏金
	var is_compromised: bool = false        # 该假名是否已当场败露

	## 假名档案构造（ID/展示名/伪装精密度）
	func _init(p_id: String, p_name: String, p_quality: float = DEFAULT_DISGUISE_QUALITY) -> void:
		alias_id = p_id
		display_name = p_name
		disguise_quality_score = p_quality

var character_uuid: String = ""                 # 角色不可变唯一底层 UUID
var true_canonical_name: String = ""            # 本源真实姓名 (允许重名)
var active_alias_id: String = ""                # 当前穿戴激活的假名 ID (空字符串代表以真身行事)

# 本源真身积累的声望与通缉赏金
var base_true_reputation: int = 0
var base_true_infamy_bounty: int = 0

# 假名身份槽位字典 (alias_id -> AliasProfile)
var alias_slots: Dictionary = {}

## 角色身份聚合构造（不可变 UUID + 本源真名）
func _init(p_uuid: String = "", p_true_name: String = "") -> void:
	character_uuid = p_uuid
	true_canonical_name = p_true_name

## 对外展示名：穿戴未败露假名则显示假名，否则回退真名
func get_current_public_display_name() -> String:
	if active_alias_id != "" and alias_slots.has(active_alias_id):
		var profile: AliasProfile = alias_slots[active_alias_id]
		if not profile.is_compromised:
			return profile.display_name
	return true_canonical_name

## 新增假名面具档案（ID/展示名/精密度）
func add_alias_mask(alias_id: String, display_name: String, quality: float = DEFAULT_DISGUISE_QUALITY) -> void:
	alias_slots[alias_id] = AliasProfile.new(alias_id, display_name, quality)

## 穿戴假名：空串脱下面具；已败露假名拒绝穿戴
func equip_alias(alias_id: String) -> bool:
	if alias_id == "":
		active_alias_id = ""
		return true
	if alias_slots.has(alias_id):
		var p: AliasProfile = alias_slots[alias_id]
		if not p.is_compromised:
			active_alias_id = alias_id
			return true
	return false
