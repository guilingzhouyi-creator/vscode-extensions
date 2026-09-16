# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/telemetry_account_lifecycle/account_lifecycle_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/telemetry_account_lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 追踪注册/登录/创角/进世界/心跳完整生命周期阶段，计算会话留存指标
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name AccountLifecyclePipeline
extends RefCounted

enum LifecycleStage {
	REGISTER_SUCCESS,
	LOGIN_SUCCESS,
	CHARACTER_CREATED,
	ENTER_WORLD,
	HEARTBEAT_ACTIVE,
	LOGOUT_NORMAL,
	LOGOUT_TIMEOUT_CRASH
}

## 生命周期阶段跃迁埋点：枚举转阶段名经旁路遥测引擎记录（含会话时长）
static func track_stage_transition(
	engine: TelemetrySidecarEngine,
	account_id: String,
	stage: LifecycleStage,
	current_utc: int,
	session_duration: float = 0.0
) -> TelemetryEventDTO:
	var stage_name := "UNKNOWN"
	match stage:
		LifecycleStage.REGISTER_SUCCESS: stage_name = "ACCOUNT_REGISTER_SUCCESS"
		LifecycleStage.LOGIN_SUCCESS: stage_name = "ACCOUNT_LOGIN_SUCCESS"
		LifecycleStage.CHARACTER_CREATED: stage_name = "CHARACTER_CREATED"
		LifecycleStage.ENTER_WORLD: stage_name = "ENTER_WORLD"
		LifecycleStage.HEARTBEAT_ACTIVE: stage_name = "HEARTBEAT_ACTIVE"
		LifecycleStage.LOGOUT_NORMAL: stage_name = "LOGOUT_NORMAL"
		LifecycleStage.LOGOUT_TIMEOUT_CRASH: stage_name = "LOGOUT_TIMEOUT_CRASH"

	return engine.record_event(stage_name, account_id, { "stage_enum": int(stage) }, current_utc, session_duration)
