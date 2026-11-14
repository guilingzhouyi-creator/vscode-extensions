# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_appraisal_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 判定 C 类特殊词缀鉴定条件、执行状态跃迁至 APPRAISED 并生成服务端防篡改凭证。 条件：鉴定技能等级 + 专属知识体系（unlocked_lores），配置驱动零硬编码。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ItemAttributeAppraisalSolver：Headless Discrete Solver / Numerical Calculator
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
	definition: ItemAttributeDefinition,
	appraisal_context: Dictionary
) -> AppraisalResultDTO:
	var appraisal_result := AppraisalResultDTO.new()
	if mount == null or definition == null:
		appraisal_result.success = false
		appraisal_result.error_code = "INVALID_MOUNT_OR_DEF"
		appraisal_result.message = "挂载实例或属性定义为空"
		return appraisal_result

	appraisal_result.previous_state = mount.visibility

	# 非特殊词缀无需鉴定
	if mount.category != ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
		appraisal_result.success = true
		appraisal_result.message = "非隐藏属性，无需鉴定"
		appraisal_result.new_state = mount.visibility
		return appraisal_result

	# 已经处于鉴定态
	if mount.visibility == ItemAttributeMountInstance.VisibilityState.APPRAISED:
		appraisal_result.success = true
		appraisal_result.message = "该属性此前已完成鉴定"
		appraisal_result.new_state = mount.visibility
		return appraisal_result

	# 校验鉴定技能等级要求
	var required_skill_level: int = int(definition.appraisal_requirement.get("min_skill_level", 1))
	var player_skill: int = int(appraisal_context.get("appraisal_skill_level", 0))
	if player_skill < required_skill_level:
		appraisal_result.success = false
		appraisal_result.error_code = "SKILL_LEVEL_INSUFFICIENT"
		appraisal_result.message = "鉴定技能等级不足 (需要: %d, 当前: %d)" % [required_skill_level, player_skill]
		appraisal_result.new_state = mount.visibility
		return appraisal_result

	# 校验专属知识体系要求 (unlocked_lores)
	var required_lore: String = str(definition.appraisal_requirement.get("required_lore", ""))
	if not required_lore.is_empty():
		var lores: Array = appraisal_context.get("unlocked_lores", [])
		if not lores.has(required_lore):
			appraisal_result.success = false
			appraisal_result.error_code = "REQUIRED_LORE_MISSING"
			appraisal_result.message = "缺少必要的专业知识体系: %s" % required_lore
			appraisal_result.new_state = mount.visibility
			return appraisal_result

	# 条件全部满足：执行服务端权威状态跃迁
	mount.visibility = ItemAttributeMountInstance.VisibilityState.APPRAISED
	mount.is_active = true

	var current_timestamp: int = int(Time.get_unix_time_from_system())
	var actor_id: String = str(appraisal_context.get("actor_id", "SERVER_APPRAISER"))
	var audit_signature := _generate_audit_signature(mount.item_uid, mount.attribute_uid, current_timestamp, actor_id)

	mount.appraisal_audit = {
		"is_appraised": true,
		"appraised_timestamp": current_timestamp,
		"appraiser_actor_id": actor_id,
		"audit_signature": audit_signature
	}

	appraisal_result.success = true
	appraisal_result.error_code = ""
	appraisal_result.message = "词缀鉴定成功，特殊机制已激活"
	appraisal_result.audit_token = audit_signature
	appraisal_result.new_state = ItemAttributeMountInstance.VisibilityState.APPRAISED

	return appraisal_result

# ==============================================================================
# 三、防篡改签名生成
# ==============================================================================

## 服务端防篡改签名生成算法（SHA-256 + 加盐，盐来自 appraisal_rules 配置）
static func _generate_audit_signature(item_uid: String, attribute_uid: String, timestamp: int, actor_id: String) -> String:
	var salt := GameConfig.get_string("domains.item_attributes", "appraisal_rules/anti_spoof_salt", "KALAR_AFFIX_AUDIT_SALT_V1")
	var payload := "%s:%s:%d:%s:%s" % [item_uid, attribute_uid, timestamp, actor_id, salt]
	return payload.sha256_text()
