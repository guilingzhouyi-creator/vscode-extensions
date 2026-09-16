# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端核心: 应用生命周期状态机
# 文件路径: res://frontend/app/app_lifecycle_fsm.gd
# 职责: 规范管理客户端 13 态应用级生命周期，单向合法转移校验，阻断非法状态跳跃
# ==============================================================================
class_name AppLifecycleFSM
extends RefCounted

# ==============================================================================
# 一、13 大应用状态枚举
# ==============================================================================

enum AppState {
	BOOT,           # 冷启动环境侦测、基础单例装配
	INITIALIZING,   # 本地配置与着色器预热
	AUTHENTICATING, # 账号登录、验证码核验、服务器选择
	MAIN_MENU,      # 角色选择与创角界面
	LOBBY,          # 城镇主界面、社交与工坊主面板
	MATCHMAKING,    # 跨服匹配中、队伍组建中
	LOADING,        # 战斗副本/大世界场景资源加载
	IN_GAME,        # 战斗中、大地图漫游核心交互态
	PAUSED,         # 全屏模态暂停、系统菜单挂起
	RESULT,         # 战斗结算面板、掉落奖励清点
	DISCONNECTED,   # 网络断开、心跳丢包状态
	RECOVERING,     # 断线重连与服务器状态快照同步中
	ERROR           # 致命异常、资源损坏或强制退回
}

signal state_changed(from_state: AppState, to_state: AppState, context: Dictionary)

static var _instance: AppLifecycleFSM
static func get_instance() -> AppLifecycleFSM:
	if _instance == null:
		_instance = load("res://frontend/app/app_lifecycle_fsm.gd").new()
	return _instance

var _current_state: AppState = AppState.BOOT
var _previous_state: AppState = AppState.BOOT
var _context: Dictionary = {}

func get_current_state() -> AppState:
	return _current_state

func get_previous_state() -> AppState:
	return _previous_state

func get_context() -> Dictionary:
	return _context

## 状态合法转移白名单检查
func can_transition(to_state: AppState) -> bool:
	if _current_state == to_state:
		return true # 允许同状态刷新上下文
		
	match _current_state:
		AppState.BOOT:
			return to_state in [AppState.INITIALIZING, AppState.ERROR]
		AppState.INITIALIZING:
			return to_state in [AppState.AUTHENTICATING, AppState.ERROR]
		AppState.AUTHENTICATING:
			return to_state in [AppState.MAIN_MENU, AppState.LOBBY, AppState.ERROR, AppState.DISCONNECTED]
		AppState.MAIN_MENU:
			return to_state in [AppState.LOBBY, AppState.AUTHENTICATING, AppState.ERROR]
		AppState.LOBBY:
			return to_state in [AppState.MATCHMAKING, AppState.LOADING, AppState.IN_GAME, AppState.AUTHENTICATING, AppState.DISCONNECTED, AppState.ERROR]
		AppState.MATCHMAKING:
			return to_state in [AppState.LOADING, AppState.LOBBY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.LOADING:
			return to_state in [AppState.IN_GAME, AppState.LOBBY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.IN_GAME:
			return to_state in [AppState.PAUSED, AppState.RESULT, AppState.LOBBY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.PAUSED:
			return to_state in [AppState.IN_GAME, AppState.LOBBY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.RESULT:
			return to_state in [AppState.LOBBY, AppState.MATCHMAKING, AppState.DISCONNECTED, AppState.ERROR]
		AppState.DISCONNECTED:
			return to_state in [AppState.RECOVERING, AppState.AUTHENTICATING, AppState.ERROR]
		AppState.RECOVERING:
			return to_state in [AppState.IN_GAME, AppState.LOBBY, AppState.AUTHENTICATING, AppState.ERROR]
		AppState.ERROR:
			return to_state in [AppState.BOOT, AppState.AUTHENTICATING]
		_:
			return false

## 推进状态跃迁
func transition_to(to_state: AppState, context: Dictionary = {}) -> bool:
	if not can_transition(to_state):
		printerr("[AppLifecycleFSM] 非法状态跃迁: %s -> %s" % [get_state_name(_current_state), get_state_name(to_state)])
		return false

	var from_state := _current_state
	_previous_state = from_state
	_current_state = to_state
	_context = context

	state_changed.emit(from_state, to_state, context)
	return true

## 重置状态机至初始状态
func reset() -> void:
	_current_state = AppState.BOOT
	_previous_state = AppState.BOOT
	_context = {}

## 状态名称格式化工具
func get_state_name(state: AppState) -> String:
	match state:
		AppState.BOOT: return "BOOT"
		AppState.INITIALIZING: return "INITIALIZING"
		AppState.AUTHENTICATING: return "AUTHENTICATING"
		AppState.MAIN_MENU: return "MAIN_MENU"
		AppState.LOBBY: return "LOBBY"
		AppState.MATCHMAKING: return "MATCHMAKING"
		AppState.LOADING: return "LOADING"
		AppState.IN_GAME: return "IN_GAME"
		AppState.PAUSED: return "PAUSED"
		AppState.RESULT: return "RESULT"
		AppState.DISCONNECTED: return "DISCONNECTED"
		AppState.RECOVERING: return "RECOVERING"
		AppState.ERROR: return "ERROR"
		_: return "UNKNOWN"
