# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Core Engine)
# 文件路径: res://backend/infrastructure/authority_sync_stub.gd
# 架构定位: Infrastructure Service
# 跨域依赖: 上游: 全域业务域 (Domains) | 下游: GameConfig, EventBusCore | 配置: config/infrastructure/*.json | 信号: 无直接信号 (由子系统广播)
# 职责说明: 文字版完备版不落地 WebSocket/ENet，仅定义服务器权威校验与快照差分契约； 客户端预测与插值补偿预留接口，全部配置驱动，零硬编码。
# 设计依据: WebGames 基础设施分层架构规范
# ==============================================================================

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
func _init(p_mode: SyncMode = DEFAULT_MODE) -> void:
	mode = p_mode

# ==============================================================================
# 二、权威校验与快照差分
# ==============================================================================

## 权威校验：单机直接通过，联机预留签名校验
func verify_authority(payload: Dictionary) -> Dictionary:
	if mode == SyncMode.OFFLINE_TEXT:
		return {"success": true, "verified": true, "mode": mode}
	# 联机预留：需接入签名与回放校验（当前文字版不阻塞）
	return {"success": false, "error_code": "ONLINE_NOT_IMPLEMENTED"}

## 快照差分：文字版返回空差分，联机预留插值
func diff_snapshot(old_state: Dictionary, new_state: Dictionary) -> Dictionary:
	if old_state.is_empty() or new_state.is_empty():
		return {"success": false, "error_code": "EMPTY_SNAPSHOT"}
	var diff: Dictionary = {}
	for k in new_state:
		if old_state.get(k) != new_state.get(k):
			diff[k] = new_state[k]
	return {"success": true, "diff": diff, "has_diff": not diff.is_empty()}

## 配置驱动：同步模式经 infrastructure.admin 预留（支持 run/mode 与 sync/mode 配置路径）
static func current_sync_mode() -> SyncMode:
	var mode_str: String = GameConfig.get_string("infrastructure.admin", "sync/mode", "")
	if mode_str.is_empty():
		mode_str = GameConfig.get_string("infrastructure.admin", "run/mode", "offline_text")
	if mode_str == "online_authority" or mode_str == "online":
		return SyncMode.ONLINE_AUTHORITY
	return SyncMode.OFFLINE_TEXT
