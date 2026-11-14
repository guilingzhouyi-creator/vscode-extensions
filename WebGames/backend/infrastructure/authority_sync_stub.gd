# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Core Engine)
# 文件路径: res://backend/infrastructure/authority_sync_stub.gd
# 架构定位: Infrastructure Service
# 依赖与触发: 上游: 全域业务域 (Domains) | 下游: GameConfig, EventBusCore | 配置: config/infrastructure/*.json | 信号: 无直接信号 (由子系统广播)
# 职责说明: 文字版完备版不落地 WebSocket/ENet，仅定义服务器权威校验与快照差分契约； 客户端预测与插值补偿预留接口，全部配置驱动，零硬编码。
# 退出语义与设计依据: WebGames 基础设施分层架构规范
# ==============================================================================

## AuthoritySyncStub：Infrastructure Service
class_name AuthoritySyncStub extends RefCounted

# ==============================================================================
# 一、同步模式与状态
# ==============================================================================

enum SyncMode {
	OFFLINE_TEXT,      # 单机文字版（当前完备版）
	ONLINE_AUTHORITY,  # 联机权威（预留）
}

const DEFAULT_MODE: SyncMode = SyncMode.OFFLINE_TEXT

var mode: SyncMode = DEFAULT_MODE

## 构造：指定同步模式（默认单机文字版）
func _init(initial_mode: SyncMode = DEFAULT_MODE) -> void:
	mode = initial_mode

# ==============================================================================
# 二、权威校验与快照差分
# ==============================================================================

## 权威校验：单机直接通过，联机预留签名校验与隔离阻断
func verify_authority(payload: Dictionary) -> Dictionary:
	if mode == SyncMode.OFFLINE_TEXT:
		return {"success": true, "verified": true, "mode": mode, "fast_path": true}
	# 联机模式存根：由 RunModeIsolationSolver 快速失败阻断，杜绝空跑协程
	return RunModeIsolationSolver.dispatch_authority_sync(WorldGatewayModel.GameMode.MULTIPLAYER, payload)

## 快照差分：文字版返回空差分，联机预留插值
func diff_snapshot(old_state: Dictionary, new_state: Dictionary) -> Dictionary:
	if old_state.is_empty() or new_state.is_empty():
		return {"success": false, "error_code": "EMPTY_SNAPSHOT"}
	var snapshot_differences: Dictionary = {}
	for state_key in new_state:
		if old_state.get(state_key) != new_state.get(state_key):
			snapshot_differences[state_key] = new_state[state_key]
	return {"success": true, "diff": snapshot_differences, "has_diff": not snapshot_differences.is_empty()}

## 配置驱动：同步模式经 infrastructure.admin 预留（统一读取 sync/mode 配置路径）
static func current_sync_mode() -> SyncMode:
	var mode_text: String = GameConfig.get_string("infrastructure.admin", "sync/mode", "offline_text")
	if mode_text == "online_authority" or mode_text == "online":
		return SyncMode.ONLINE_AUTHORITY
	return SyncMode.OFFLINE_TEXT
