# ==============================================================================
# 模块归属: 前端核心层 (Frontend · App Lifecycle State Machine)
# 文件路径: res://frontend/app/app_lifecycle_fsm.gd
# 架构定位: Client Application Lifecycle Finite State Machine
# 依赖与触发: 上游: AppBootstrap, NavManager, 视图控制器 | 下游: EventBusCore, TemplateFormatter
# 职责说明: 规范管理客户端 14 态应用级生命周期，执行单向合法转移校验，阻断非法状态跳跃。
# 退出语义与设计依据: 客户端状态机单向转移白名单与非侵入观察契约
# ==============================================================================

## AppLifecycleFSM：客户端应用级生命周期有限状态机
class_name AppLifecycleFSM
extends RefCounted

# ==============================================================================
# 一、应用生命周期状态枚举
# ==============================================================================

enum AppState {
	BOOT,           # 冷启动环境侦测、基础单例装配
	INITIALIZING,   # 本地配置与着色器预热
	AUTHENTICATING, # 账号登录、验证码核验、服务器选择
	MAIN_MENU,      # 账号首页与角色选择界面
	WORLD_GATEWAY,  # 世界网关、模式探测与世界档案/创角选档入口
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

## 获取应用生命周期状态机全局单例
static func get_instance() -> AppLifecycleFSM:
	if _instance == null:
		_instance = AppLifecycleFSM.new()
	return _instance

## 重置应用生命周期状态机静态单例并清空状态上下文
static func reset_instance() -> void:
	if _instance != null:
		_instance.reset()
	_instance = null

var _current_state: AppState = AppState.BOOT
var _previous_state: AppState = AppState.BOOT
var _context: Dictionary = {}

## 获取当前所处的应用生命周期状态
func get_current_state() -> AppState:
	return _current_state

## 获取上一次转移前的应用生命周期状态
func get_previous_state() -> AppState:
	return _previous_state

## 获取当前状态附带的上下文快照字典
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
			return to_state in [AppState.MAIN_MENU, AppState.WORLD_GATEWAY, AppState.LOBBY, AppState.ERROR, AppState.DISCONNECTED]
		AppState.MAIN_MENU:
			return to_state in [AppState.WORLD_GATEWAY, AppState.LOBBY, AppState.LOADING, AppState.AUTHENTICATING, AppState.ERROR]
		AppState.WORLD_GATEWAY:
			return to_state in [AppState.MAIN_MENU, AppState.LOBBY, AppState.LOADING, AppState.IN_GAME, AppState.AUTHENTICATING, AppState.ERROR]
		AppState.LOBBY:
			return to_state in [AppState.MATCHMAKING, AppState.LOADING, AppState.IN_GAME, AppState.WORLD_GATEWAY, AppState.MAIN_MENU, AppState.AUTHENTICATING, AppState.DISCONNECTED, AppState.ERROR]
		AppState.MATCHMAKING:
			return to_state in [AppState.LOADING, AppState.LOBBY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.LOADING:
			return to_state in [AppState.IN_GAME, AppState.LOBBY, AppState.WORLD_GATEWAY, AppState.DISCONNECTED, AppState.ERROR]
		AppState.IN_GAME:
			return to_state in [AppState.PAUSED, AppState.RESULT, AppState.LOBBY, AppState.WORLD_GATEWAY, AppState.MAIN_MENU, AppState.AUTHENTICATING, AppState.DISCONNECTED, AppState.ERROR]
		AppState.PAUSED:
			return to_state in [AppState.IN_GAME, AppState.LOBBY, AppState.WORLD_GATEWAY, AppState.MAIN_MENU, AppState.AUTHENTICATING, AppState.DISCONNECTED, AppState.ERROR]
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
		EventBusCore.get_instance().emit_log(
			"warn",
			TemplateFormatter.format(
				"AppLifecycleFSM: illegal state transition {from_state} -> {to_state}",
				{"from_state": get_state_name(_current_state), "to_state": get_state_name(to_state)}
			)
		)
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
func get_state_name(app_state: AppState) -> String:
	match app_state:
		AppState.BOOT: return "BOOT"
		AppState.INITIALIZING: return "INITIALIZING"
		AppState.AUTHENTICATING: return "AUTHENTICATING"
		AppState.MAIN_MENU: return "MAIN_MENU"
		AppState.WORLD_GATEWAY: return "WORLD_GATEWAY"
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
