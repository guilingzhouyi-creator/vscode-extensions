# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/runtime_mode_gate.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 维护游戏运行模式，并在运行模式、数据源、生命周期与服务入口四层实施 严格物理隔离，杜绝本地编辑器热更新与非权威数据污染联机体系（Inv-SV-8）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name RuntimeModeGate extends RefCounted

enum Mode {
	SINGLE_PLAYER,
	ONLINE
}

class OnlineAuthoritativeSource extends RefCounted:
	pass

static var _mode: Mode = Mode.SINGLE_PLAYER
static var _online_data_source: Variant = null
static var _default_online_source: OnlineAuthoritativeSource = OnlineAuthoritativeSource.new()

## 设置当前运行模式（启动时装配，或联机登录切换）
static func set_mode(mode: Mode) -> void:
	_mode = mode

## 获取当前运行模式
static func get_mode() -> Mode:
	return _mode

## 是否为单机模式
static func is_single_player() -> bool:
	return _mode == Mode.SINGLE_PLAYER

## 是否为联机模式
static func is_online() -> bool:
	return _mode == Mode.ONLINE

## 注入联机专用权威数据源
static func set_online_data_source(src: Variant) -> void:
	_online_data_source = src

## 获取当前模式下的活动数据源（四层隔离之二：数据源隔离）
static func get_active_data_source() -> Variant:
	if _mode == Mode.ONLINE:
		return _online_data_source if _online_data_source != null else _default_online_source
	return SaveManager

## 是否允许热更新（四层隔离之三：生命周期隔离）
static func is_hot_reload_enabled() -> bool:
	return _mode == Mode.SINGLE_PLAYER

## 测试重置
static func reset_for_tests() -> void:
	_mode = Mode.SINGLE_PLAYER
	_online_data_source = null
