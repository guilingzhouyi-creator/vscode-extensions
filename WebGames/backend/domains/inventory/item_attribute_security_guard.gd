# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_security_guard.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 校验服务端鉴定凭证完整性，拦截客户端直接篡改本地 is_appraised / is_active 状态。 非特殊词缀免签名校验；隐藏态严禁激活；已鉴定态必须携带服务端有效签名。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemAttributeSecurityGuard
extends RefCounted

## 验证挂载实例鉴定状态的真实性（防作弊）
static func verify_mount_integrity(mount: ItemAttributeMountInstance) -> bool:
	if mount == null:
		return false

	# 非特殊词缀无需校验防伪签名
	if mount.category != ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
		return true

	# 处于未鉴定态，合法（但严禁激活）
	if mount.visibility == ItemAttributeMountInstance.VisibilityState.HIDDEN:
		return not mount.is_active

	# 声明为已鉴定态，必须包含由服务端生成的有效签名
	var audit := mount.appraisal_audit
	if not bool(audit.get("is_appraised", false)):
		return false

	var ts := int(audit.get("appraised_timestamp", 0))
	var actor := str(audit.get("appraiser_actor_id", ""))
	var sig := str(audit.get("audit_signature", ""))

	if sig.is_empty() or ts <= 0:
		return false

	var expected := ItemAttributeAppraisalSolver._generate_audit_signature(
		mount.item_uid, mount.attribute_uid, ts, actor
	)
	return (sig == expected)
