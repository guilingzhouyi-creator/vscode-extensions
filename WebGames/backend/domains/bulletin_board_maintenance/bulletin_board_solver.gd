# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/bulletin_board_maintenance/bulletin_board_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/bulletin_board_maintenance.json | 信号: EventBus 领域广播
# 职责说明: 检定维护模式状态、非 GM 账户强阻断与维护倒计时计算
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## BulletinBoardSolver：Headless Discrete Solver / Numerical Calculator
class_name BulletinBoardSolver
extends RefCounted

## 校验客户端登录权限与维护停服白名单
static func check_login_permission(
	board: BulletinBoardAggregate,
	is_gm_account: bool,
	current_utc: int
) -> Dictionary:
	if board == null:
		return { "allow_login": true, "message": _msg("entry_allowed") }

	if board.server_maintenance_mode:
		if not is_gm_account:
			var remain_secs := maxi(0, board.maintenance_end_timestamp_utc - current_utc)
			return {
				"allow_login": false,
				"error_code": "ERR_SERVER_MAINTENANCE",
				"remain_seconds": remain_secs,
				"message": _msg("remaining_minutes") % [board.maintenance_notice_msg, int(remain_secs / 60.0)]
			}

	return { "allow_login": true, "message": _msg("entry_allowed") }

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("bulletin_board_maintenance", key)
