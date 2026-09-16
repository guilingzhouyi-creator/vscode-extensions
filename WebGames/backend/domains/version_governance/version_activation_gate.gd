# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/version_activation_gate.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 贯彻“有文件 != 允许运行”的最高安全红线，在引擎装配点与进世界网关点实施强阻断
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name VersionActivationGate
extends RefCounted

const ActivationTokenDTO = preload("res://backend/domains/version_governance/activation_token_dto.gd")
const GrayPolicyDTO = preload("res://backend/domains/version_governance/gray_policy_dto.gd")

## 第一道门禁：全域引擎装配启动前置核验 (由 GameBootstrap.assemble_versioned() 调用)
static func evaluate_startup_eligibility(installed_version: String, token: ActivationTokenDTO) -> Dictionary:
	# 若为基础初始版本 (1.0.0)，无条件放行
	if installed_version == "1.0.0":
		return {"allowed": true, "reason": "BASE_VERSION_UNRESTRICTED"}

	if token == null:
		return {
			"allowed": false,
			"error_code": "ACTIVATION_TOKEN_MISSING",
			"reason": "未持有版本运行授权令牌"
		}

	var now_sec := int(Time.get_unix_time_from_system())
	if not token.is_eligible_at(now_sec):
		return {
			"allowed": false,
			"error_code": "ACTIVATION_TOKEN_EXPIRED",
			"reason": "运行授权令牌已失效或过期"
		}

	if token.authorized_version != installed_version:
		return {
			"allowed": false,
			"error_code": "VERSION_AUTHORIZATION_MISMATCH",
			"reason": "授权令牌版本(%s)与已安装版本(%s)不匹配" % [token.authorized_version, installed_version]
		}

	return {"allowed": true, "reason": "AUTHORIZED"}

## 第二道门禁：进世界运行时防撤回核验 (由 WorldGatewayService.enter_world() 或运行期调用)
static func evaluate_runtime_world_entry(character_id: String, _active_version: String, active_policy: GrayPolicyDTO) -> bool:
	if active_policy != null and active_policy.is_active:
		# 若该用户在运行期间被紧急列入黑名单或策略已被撤销
		if active_policy.is_explicitly_blacklisted(character_id):
			return false
	return true
