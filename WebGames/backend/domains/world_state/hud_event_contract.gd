# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/hud_event_contract.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 消除散落魔法字符串，统一向表现层公开事件频道白名单。 频道命名遵循 EventBus 硬约定 "<domain_id>.<event_name>"（event_bus.gd:36）： account.*    -> 账户鉴权域（domains.account auth/channels） world_state.* -> 世界状态域（domains.world_state hud/channels） 契约权威: 演进02 S1 HudEventContract；值统一经 GameConfig 读取（零硬编码）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name HudEventContract
extends RefCounted

## 账户鉴权域事件通道
static func channel_auth_registered() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/registered", "account.registered")

static func channel_auth_login_succeeded() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/login_succeeded", "account.login_succeeded")

static func channel_auth_session_revoked() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/session_revoked", "account.session_revoked")

## 主页 HUD 状态同步通道
static func channel_hud_snapshot() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/snapshot", "world_state.snapshot_published")

static func channel_hud_stat_mutated() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/stat_mutated", "world_state.stat_mutated")

static func channel_hud_wallet_mutated() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/wallet_mutated", "world_state.wallet_mutated")
