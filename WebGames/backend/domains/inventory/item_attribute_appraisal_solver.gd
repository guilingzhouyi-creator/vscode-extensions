# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_appraisal_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 判定 C 类特殊词缀鉴定条件、执行状态跃迁至 APPRAISED 并生成服务端防伪凭证。 条件：鉴定技能等级 + 专属知识体系（unlocked_lores），配置驱动零硬编码。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemAttributeAppraisalSolver
extends RefCounted

# ==============================================================================
# 一、鉴定结果 DTO
# ==============================================================================

## 鉴定操作结算结果：成败/错误码/审计令牌/前后可见性状态
class AppraisalResultDTO extends RefCounted:
	var success: bool = false
	var error_code: String = ""
	var message: String = ""
	var audit_token: String = ""
	var previous_state: ItemAttributeMountInstance.VisibilityState = ItemAttributeMountInstance.VisibilityState.HIDDEN
	var new_state: ItemAttributeMountInstance.VisibilityState = ItemAttributeMountInstance.VisibilityState.HIDDEN

	## 序列化为字典（遥测/前端渲染共用）
	func to_dict() -> Dictionary:
		return {
			"success": success,
			"error_code": error_code,
			"message": message,
			"audit_token": audit_token,
			"previous_state": previous_state,
			"new_state": new_state
		}

# ==============================================================================
# 二、鉴定算法
# ==============================================================================

## 执行 C 类特殊词缀的鉴定操作
static func appraise_mount_attribute(
	mount: ItemAttributeMountInstance,
	def: ItemAttributeDefinition,
	appraisal_context: Dictionary
) -> AppraisalResultDTO:
	var res := AppraisalResultDTO.new()
	if mount == null or def == null:
		res.success = false
		res.error_code = "INVALID_MOUNT_OR_DEF"
		res.message = "挂载实例或属性定义为空"
		return res

	res.previous_state = mount.visibility

	# 非特殊词缀无需鉴定
	if mount.category != ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
		res.success = true
		res.message = "非隐藏属性，无需鉴定"
		res.new_state = mount.visibility
		return res

	# 已经处于鉴定态
	if mount.visibility == ItemAttributeMountInstance.VisibilityState.APPRAISED:
		res.success = true
		res.message = "该属性此前已完成鉴定"
		res.new_state = mount.visibility
		return res

	# 校验鉴定技能等级要求
	var req_skill: int = int(def.appraisal_requirement.get("min_skill_level", 1))
	var player_skill: int = int(appraisal_context.get("appraisal_skill_level", 0))
	if player_skill < req_skill:
		res.success = false
		res.error_code = "SKILL_LEVEL_INSUFFICIENT"
		res.message = "鉴定技能等级不足 (需要: %d, 当前: %d)" % [req_skill, player_skill]
		res.new_state = mount.visibility
		return res

	# 校验专属知识体系要求 (unlocked_lores)
	var req_lore: String = str(def.appraisal_requirement.get("required_lore", ""))
	if not req_lore.is_empty():
		var lores: Array = appraisal_context.get("unlocked_lores", [])
		if not lores.has(req_lore):
			res.success = false
			res.error_code = "REQUIRED_LORE_MISSING"
			res.message = "缺少必要的专业知识体系: %s" % req_lore
			res.new_state = mount.visibility
			return res

	# 条件全部满足：执行服务端权威状态跃迁
	mount.visibility = ItemAttributeMountInstance.VisibilityState.APPRAISED
	mount.is_active = true

	var now_ts: int = int(Time.get_unix_time_from_system())
	var actor_id: String = str(appraisal_context.get("actor_id", "SERVER_APPRAISER"))
	var audit_sig := _generate_audit_signature(mount.item_uid, mount.attribute_uid, now_ts, actor_id)

	mount.appraisal_audit = {
		"is_appraised": true,
		"appraised_timestamp": now_ts,
		"appraiser_actor_id": actor_id,
		"audit_signature": audit_sig
	}

	res.success = true
	res.error_code = ""
	res.message = "词缀鉴定成功，特殊机制已激活"
	res.audit_token = audit_sig
	res.new_state = ItemAttributeMountInstance.VisibilityState.APPRAISED

	return res

# ==============================================================================
# 三、防伪签名生成
# ==============================================================================

## 服务端防伪签名生成算法（SHA-256 + 加盐，盐来自 appraisal_rules 配置）
static func _generate_audit_signature(item_uid: String, attr_uid: String, timestamp: int, actor_id: String) -> String:
	var salt := GameConfig.get_string("domains.item_attributes", "appraisal_rules/anti_spoof_salt", "KALAR_AFFIX_AUDIT_SALT_V1")
	var payload := "%s:%s:%d:%s:%s" % [item_uid, attr_uid, timestamp, actor_id, salt]
	return payload.sha256_text()
