# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/solvers/game_mode_feature_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 游戏模式特性解析求解器，解析单机、联机与默认安全沙盒下的系统开关矩阵。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name GameModeFeatureSolver
extends RefCounted

const MODE_UNSELECTED: int = 0
const MODE_SINGLE_PLAYER: int = 1
const MODE_MULTIPLAYER: int = 2

## 根据游戏运行模式静态解析特性清单
## 单机：启用本地剧情邮件、离线兑换码与抽卡；禁用联机匹配与公网社交商户
## 联机：启用匹配、在线聊天、跨服公会与商户；禁用离线兜底系统
## 默认/未知：全量安全沙盒隔离，全部特性关闭
static func resolve_features(game_mode: int) -> ModeFeatureManifestDTO:
	var manifest := ModeFeatureManifestDTO.new()
	manifest.game_mode = game_mode

	if game_mode == MODE_SINGLE_PLAYER:
		manifest.show_matchmaking = false
		manifest.show_online_chat = false
		manifest.show_real_money_shop = false
		manifest.show_cross_server_guild = false
		manifest.enable_offline_cdkey = true
		manifest.enable_offline_gacha = true
		manifest.enable_local_story_mail = true
		return manifest

	if game_mode == MODE_MULTIPLAYER:
		manifest.show_matchmaking = true
		manifest.show_online_chat = true
		manifest.show_real_money_shop = true
		manifest.show_cross_server_guild = true
		manifest.enable_offline_cdkey = false
		manifest.enable_offline_gacha = false
		manifest.enable_local_story_mail = false
		return manifest

	# 默认安全沙盒：全特性安全关闭
	manifest.show_matchmaking = false
	manifest.show_online_chat = false
	manifest.show_real_money_shop = false
	manifest.show_cross_server_guild = false
	manifest.enable_offline_cdkey = false
	manifest.enable_offline_gacha = false
	manifest.enable_local_story_mail = false
	return manifest
