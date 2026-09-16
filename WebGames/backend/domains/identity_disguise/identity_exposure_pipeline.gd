# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/identity_disguise/identity_exposure_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/identity_disguise.json | 信号: EventBus 领域广播
# 职责说明: 假名败露时触发因果穿透，将该假名下的所有通缉恶名 100% 合并回真身
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name IdentityExposurePipeline
extends RefCounted

## 假名事迹登记：未败露记入假名，已败露直记真身（M6 锁存后通道防二次搬运）
static func record_deed(
	identity: CharacterIdentityAggregate,
	reputation_delta: int,
	infamy_bounty_delta: int
) -> void:
	if identity.active_alias_id != "" and identity.alias_slots.has(identity.active_alias_id):
		var profile: CharacterIdentityAggregate.AliasProfile = identity.alias_slots[identity.active_alias_id]
		# M6（Phase 53）：已败露假名不再累积——恶名/声望直记真身（锁存后通道防二次搬运）
		if profile.is_compromised:
			identity.base_true_reputation += reputation_delta
			identity.base_true_infamy_bounty += infamy_bounty_delta
			return
		profile.accumulated_reputation += reputation_delta
		profile.accumulated_infamy_bounty += infamy_bounty_delta
	else:
		identity.base_true_reputation += reputation_delta
		identity.base_true_infamy_bounty += infamy_bounty_delta

## 揭面败露：幂等锁存 → 恶名/声望 100% 因果合并回真身（源字段归零 Inv-ON-2）+ 自动脱面具
static func trigger_unmask_exposure(
	identity: CharacterIdentityAggregate,
	compromised_alias_id: String
) -> Dictionary:
	if not identity.alias_slots.has(compromised_alias_id):
		return {
			"success": false,
			"error_code": "ALIAS_NOT_FOUND"
		}

	var profile: CharacterIdentityAggregate.AliasProfile = identity.alias_slots[compromised_alias_id]
	# M6（Phase 53）：锁存入口——已败露直接幂等返回（0 搬运），杜绝重复曝光 double-count
	if profile.is_compromised:
		return {
			"success": true,
			"error_code": "ALREADY_COMPROMISED",
			"character_uuid": identity.character_uuid,
			"compromised_alias": profile.display_name,
			"transferred_infamy_bounty": 0,
			"total_true_infamy": identity.base_true_infamy_bounty
		}

	profile.is_compromised = true

	# 因果穿透：将该假名的恶名与赏金 100% 合并到真身（搬运后源字段归零 Inv-ON-2）
	var merged_infamy: int = profile.accumulated_infamy_bounty
	identity.base_true_infamy_bounty += merged_infamy
	profile.accumulated_infamy_bounty = 0
	# 声望侧同构搬运归零（与 infamy 对齐，防残值二次搬运）
	identity.base_true_reputation += profile.accumulated_reputation
	profile.accumulated_reputation = 0

	# 如果当前正穿戴该假名，自动脱下恢复真身
	if identity.active_alias_id == compromised_alias_id:
		identity.active_alias_id = ""

	return {
		"success": true,
		"error_code": "OK",
		"character_uuid": identity.character_uuid,
		"true_canonical_name": identity.true_canonical_name,
		"compromised_alias": profile.display_name,
		"transferred_infamy_bounty": merged_infamy,
		"total_true_infamy": identity.base_true_infamy_bounty
	}
