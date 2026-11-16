# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/run_mode_isolation_solver.gd
# 架构定位: Headless Mode Isolation Solver / Zero-Network Fast-Path Guard
# 依赖与触发: 上游: WorldGatewayFSM, AuthoritySyncStub | 下游: WorldGatewayModel | 配置: config/domains/world_gateway.json | 信号: 无
# 职责说明: 针对首个发行体验版提供单机与联机双通道环境的严格隔离；
#           单机模式实行 100% 离线、零网络轮询、本地权威与瞬时同步的高效性能快道；
#           联机模式严格作为待命存根预留 (Stub)，快速失败拦截并杜绝任何空跑轮询协程污染单机热路径。
# 退出语义与设计依据: 首发单机纯粹性与联机存根防线架构规约 (Inv-MODE-ISO-1)
# ==============================================================================

## RunModeIsolationSolver：单机快道与联机存根隔离解算器
class_name RunModeIsolationSolver
extends RefCounted

# ==============================================================================
# 一、错误码与运行模式常量
# ==============================================================================

const ERR_MULTIPLAYER_STUB_RESERVED: String = "ERR_MULTIPLAYER_STUB_RESERVED"
const ERR_UNSUPPORTED_GAME_MODE: String = "ERR_UNSUPPORTED_GAME_MODE"
const ERR_ONLINE_AUTHORITY_DISABLED: String = "ERR_ONLINE_AUTHORITY_DISABLED"

const MODE_UNSELECTED: int = WorldGatewayModel.GameMode.UNSELECTED
const MODE_SINGLE_PLAYER: int = WorldGatewayModel.GameMode.SINGLE_PLAYER
const MODE_MULTIPLAYER: int = WorldGatewayModel.GameMode.MULTIPLAYER

# ==============================================================================
# 二、模式状态与热路径旁路判断
# ==============================================================================

## 判定是否为离线单机模式（首期唯一完备体验模式）
static func is_offline_single_player(mode: int) -> bool:
	return mode == MODE_SINGLE_PLAYER

## 判定是否为联机存根预留模式（预留灰度，首发体验版不开放）
static func is_multiplayer_placeholder(mode: int) -> bool:
	return mode == MODE_MULTIPLAYER

## 判定是否旁路跳过网络心跳与远程轮询（单机模式与存根联机模式均应旁路，防止无谓开销）
static func should_bypass_network_poll(_mode: int) -> bool:
	return true

## 判定是否旁路跳过远程权威同步（单机模式 100% 具备本地最高权威）
static func should_bypass_remote_authority(mode: int) -> bool:
	return mode == MODE_SINGLE_PLAYER

# ==============================================================================
# 三、运行模式能力画像评估
# ==============================================================================

## 评估指定模式的完整能力配置画像
static func evaluate_mode_capabilities(mode: int) -> Dictionary:
	if mode == MODE_SINGLE_PLAYER:
		return {
			"mode": mode,
			"mode_name": "SINGLE_PLAYER",
			"is_single_player": true,
			"is_multiplayer": false,
			"network_active": false,
			"local_storage_only": true,
			"authoritative_local": true,
			"zero_latency_fast_path": true,
			"stub_reserved": false,
		}
	elif mode == MODE_MULTIPLAYER:
		return {
			"mode": mode,
			"mode_name": "MULTIPLAYER",
			"is_single_player": false,
			"is_multiplayer": true,
			"network_active": false,
			"local_storage_only": false,
			"authoritative_local": false,
			"zero_latency_fast_path": false,
			"stub_reserved": true,
		}

	return {
		"mode": mode,
		"mode_name": "UNKNOWN",
		"is_single_player": false,
		"is_multiplayer": false,
		"network_active": false,
		"local_storage_only": false,
		"authoritative_local": false,
		"zero_latency_fast_path": false,
		"stub_reserved": false,
	}

# ==============================================================================
# 四、权威同步调度与快速失败阻断
# ==============================================================================

## 执行权威同步分发裁定：单机秒级放行，联机快速失败
static func dispatch_authority_sync(mode: int, payload: Dictionary) -> Dictionary:
	if mode == MODE_SINGLE_PLAYER:
		return {
			"success": true,
			"verified": true,
			"mode": mode,
			"fast_path": true,
			"payload_size": payload.size(),
		}
	elif mode == MODE_MULTIPLAYER:
		return {
			"success": false,
			"verified": false,
			"mode": mode,
			"error_code": ERR_MULTIPLAYER_STUB_RESERVED,
			"message": "首个发行体验版联机功能仅占位，严禁占用网络热路径",
		}

	return {
		"success": false,
		"verified": false,
		"mode": mode,
		"error_code": ERR_UNSUPPORTED_GAME_MODE,
		"message": "未知游戏模式: %d" % mode,
	}
