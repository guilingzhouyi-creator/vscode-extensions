# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/world_gateway_model.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 定义世界网关运行模式、生命周期阶段枚举与统一状态标识
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name WorldGatewayModel
extends RefCounted

## 游戏运行模式（严格隔离，不得混用状态）
enum GameMode {
	UNSELECTED = 0,       ## 未选定
	SINGLE_PLAYER = 1,    ## 单机模式（当前首期：单档+单世界）
	MULTIPLAYER = 2       ## 联机模式（预留灰度控制，严格隔离房间/公网世界）
}

## 网关生命周期状态
enum GatewayPhase {
	AUTHENTICATED = 1,          ## 1. 已登录，等待进入世界栏
	GATEWAY_ENTERED = 2,        ## 2. 已处于世界栏，展示模式选项
	MODE_SELECTED = 3,          ## 3. 模式已选定，展示档位/世界列表
	SLOT_WORLD_RESOLVED = 4,    ## 4. 档位与世界已选定，解析角色状态
	CHARACTER_PENDING = 5,      ## 5. 待创建角色（首次开档）或待选择角色
	WORLD_ENTRY_PERMITTED = 6,  ## 6. 准许进入世界（触发开局或正常入界）
	IN_WORLD = 7                ## 7. 已在世界中运行
}
