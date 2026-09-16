# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/lifecycle_model.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 定义全生命周期运行阶段枚举、退出触发原因与状态判定规范
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GameLifecycleModel
extends RefCounted

## 引擎全生命周期阶段枚举（结构性强类型，零魔法字符串）
enum LifecyclePhase {
	UNINITIALIZED = 0,     ## 0. 未初始化
	BOOT_INITIALIZING = 1, ## 1. 启动装配中（配置加载/注册表填充）
	RUNNING = 2,           ## 2. 正常运行中（主循环活跃）
	PAUSED = 3,            ## 3. 游戏暂停中（模态阻断）
	STOPPING = 4,          ## 4. 正在安全停机（停输入/刷存档/断网络）
	STOP_FAILED = 5,       ## 5. 安全停机异常受阻（I/O超时或资源死锁）
	FORCE_STOPPING = 6,    ## 6. 强制终止清理（降级强杀孤儿任务）
	STOPPED = 7            ## 7. 停机完成（资源归零，可安全关闭进程）
}

## 退出触发原因分类
enum ExitReason {
	USER_LOGOUT_TO_MENU = 1,  ## 用户主动退回主菜单/选服页
	USER_DESKTOP_QUIT = 2,    ## 用户主动退出到操作系统桌面
	WINDOW_CLOSE_REQUEST = 3, ## OS 窗口右上角 "X" 关闭请求
	FATAL_EXCEPTION = 4,      ## 核心系统崩溃导致的不可恢复停机
	REMOTE_KICK_OUT = 5       ## 远端服务端踢出或会话顶替
}

## 获取阶段的可读名称（用于日志与遥测）
static func get_phase_name(phase: int) -> String:
	match phase:
		LifecyclePhase.UNINITIALIZED:
			return "UNINITIALIZED"
		LifecyclePhase.BOOT_INITIALIZING:
			return "BOOT_INITIALIZING"
		LifecyclePhase.RUNNING:
			return "RUNNING"
		LifecyclePhase.PAUSED:
			return "PAUSED"
		LifecyclePhase.STOPPING:
			return "STOPPING"
		LifecyclePhase.STOP_FAILED:
			return "STOP_FAILED"
		LifecyclePhase.FORCE_STOPPING:
			return "FORCE_STOPPING"
		LifecyclePhase.STOPPED:
			return "STOPPED"
		_:
			return "UNKNOWN"

## 获取退出原因的可读名称
static func get_reason_name(reason: int) -> String:
	match reason:
		ExitReason.USER_LOGOUT_TO_MENU:
			return "USER_LOGOUT_TO_MENU"
		ExitReason.USER_DESKTOP_QUIT:
			return "USER_DESKTOP_QUIT"
		ExitReason.WINDOW_CLOSE_REQUEST:
			return "WINDOW_CLOSE_REQUEST"
		ExitReason.FATAL_EXCEPTION:
			return "FATAL_EXCEPTION"
		ExitReason.REMOTE_KICK_OUT:
			return "REMOTE_KICK_OUT"
		_:
			return "UNKNOWN"
