# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/state_mutation_isolation_guard.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: account, feature_toggle_canary | 配置: config/domains/world_gateway.json | 信号: EventBus 领域广播
# 职责说明: 拦截跨模式、跨世界或跨档位的越权写入，保障单机与联机状态物理正交隔离
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name StateMutationIsolationGuard
extends RefCounted

## 校验状态写入操作是否符合当前会话模式与世界归属
static func validate_mutation_permission(
	context: WorldGatewayContextDTO,
	target_mode: int,
	target_world_id: String,
	target_slot_id: String
) -> Dictionary:
	if context == null:
		return { "allowed": false, "error_code": "GUARD_ERR_NULL_CONTEXT", "message": "网关上下文为空" }

	# 1. 运行模式匹配性检查（严禁单机向联机写，反之亦然）
	if context.selected_mode != target_mode:
		return {
			"allowed": false,
			"error_code": "GUARD_ERR_CROSS_MODE_MUTATION",
			"message": "跨模式状态写入被拦截: 会话模式 %d, 目标模式 %d" % [context.selected_mode, target_mode]
		}

	# 2. 世界 ID 绑定校验
	if not target_world_id.is_empty() and context.selected_world_id != target_world_id:
		return {
			"allowed": false,
			"error_code": "GUARD_ERR_WORLD_MISMATCH",
			"message": "写入世界目标与当前会话世界不一致"
		}

	# 3. 档位 ID 绑定校验
	if not target_slot_id.is_empty() and context.selected_slot_id != target_slot_id:
		return {
			"allowed": false,
			"error_code": "GUARD_ERR_SLOT_MISMATCH",
			"message": "写入档位目标与当前会话档位不一致"
		}

	return { "allowed": true, "error_code": "", "message": "校验通过" }
