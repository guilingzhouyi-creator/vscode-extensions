# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/bulletin_board_maintenance/bulletin_push_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/bulletin_board_maintenance.json | 信号: EventBus 领域广播
# 职责说明: 响应 GM 指令动态修改维护模式或发布紧急停机公告卡片
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name BulletinPushPipeline
extends RefCounted

static func set_maintenance(
	board: BulletinBoardAggregate,
	enable_maintenance: bool,
	duration_seconds: int = 3600,
	current_utc: int = 0,
	custom_msg: String = ""
) -> Dictionary:
	board.server_maintenance_mode = enable_maintenance
	board.maintenance_end_timestamp_utc = current_utc + duration_seconds if enable_maintenance else 0
	# 未显式指定时回退到配置文案，避免同一句公告在代码里多处重复
	board.maintenance_notice_msg = custom_msg if custom_msg != "" else _notice_msg()

	return {
		"success": true,
		"maintenance_mode": board.server_maintenance_mode,
		"end_timestamp_utc": board.maintenance_end_timestamp_utc
	}

# ==============================================================================
# 配置读取
# ==============================================================================

static func _notice_msg() -> String:
	return GameConfig.get_string(
		"narratives.bulletin_board_maintenance", "maintenance_notice",
		"服务器正在进行例行维护，请稍后重试。"
	)
