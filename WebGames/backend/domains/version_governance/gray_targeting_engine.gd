# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/gray_targeting_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 纯数学确定性散列计算，输入用户画像输出目标版本放量判定结果，零堆分配
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GrayTargetingEngine
extends RefCounted

const GrayPolicyDTO = preload("res://backend/domains/version_governance/gray_policy_dto.gd")

## 紧凑质数混叠哈希算法 (将任意字符串映射为 [0, 99] 的稳定散列标量)
static func compute_user_hash_bucket(user_id: String) -> int:
	if user_id.is_empty():
		return 99 # 空用户默认落在最高边界
	var hash_val: int = 5381
	var bytes := user_id.to_utf8_buffer()
	for b in bytes:
		hash_val = ((hash_val << 5) + hash_val) ^ int(b)
	# 符号位掩码归一（恒非负，杜绝 absi(INT64_MIN) 仍为负的理论边界偏置），
	# 再映射到 [0, 99]
	return (hash_val & 0x7FFFFFFFFFFFFFFF) % 100

## 多维正交策略判定评估
static func evaluate_eligibility(user_id: String, channel: String, ring: int, region: String, policy: GrayPolicyDTO) -> bool:
	if policy == null or not policy.is_active:
		return false

	# 1. 强行黑名单熔断检查 (优先级最高)
	if policy.is_explicitly_blacklisted(user_id):
		return false

	# 2. 强行白名单放行检查 (直接命中，跳过后续所有门禁)
	if policy.is_explicitly_whitelisted(user_id):
		return true

	# 3. 发布环限制 (Release Ring Gate)
	if not policy.allowed_rings.is_empty() and not policy.allowed_rings.has(ring):
		return false

	# 4. 渠道与地域正交过滤
	if not policy.target_channels.is_empty() and not policy.target_channels.has(channel):
		return false
	if not policy.target_regions.is_empty() and not policy.target_regions.has(region):
		return false

	# 5. 纯数学灰度百分比哈希切片判断
	if policy.rollout_percentage <= 0:
		return false
	if policy.rollout_percentage >= 100:
		return true

	var bucket := compute_user_hash_bucket(user_id)
	return bucket < policy.rollout_percentage
