# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_rule_state.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 承载封印、延时、临时升格等持续语义——必须建模为「状态持续存在」， 禁止复制新卡表达。统一生命周期：ACTIVE → RELEASED/EXPIRED/HOLDER_LOST/ ROLLED_BACK/CANCELLED。持有对象、来源行动卡、魔法引用、时长/步数、 状态清理与回退均落在此实体。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicRuleState
extends RefCounted

enum StateKind {
	SEAL = 1,     # 魔法封印（解放前不可打出目标魔法）
	DELAY,        # 延时释放调度（步数制，独立待触发，不阻塞玩家行动）
	TEMP_BOOST,   # 临时升格（到期回落原阶）
}

enum StateStatus {
	ACTIVE = 1,    # 生效中
	RELEASED,      # 解放/结算完成（清理）
	EXPIRED,       # 超时自动解除（清理）
	HOLDER_LOST,   # 持有者丢失（死亡/战斗结束按配置处置）
	ROLLED_BACK,   # 异常中断回退（无副作用）
	CANCELLED,     # 显式取消
}

var state_id: String = ""
var kind: StateKind = StateKind.SEAL
var status: StateStatus = StateStatus.ACTIVE
var holder_id: String = ""            # 持有对象（角色/账户维度）
var magic_ref: String = ""            # 被关联魔法 canonical
var source_card_id: String = ""       # 产生本状态的行动卡
var duration_seconds: int = 0         # 封印/临时升格时长（0 = 场景内常驻）
var remain_seconds: int = 0           # 剩余秒数
var remain_steps: int = 0             # 延时剩余步数（步数制主单位）
var created_tick: int = 0             # 创建时刻（战斗 tick）
var allow_duplicate: bool = false     # 是否允许同魔法重复进入同类状态（由配置收敛）

## 序列化持续状态为字典（枚举转整型）
func to_dto() -> Dictionary:
	return {
		"state_id": state_id,
		"kind": int(kind),
		"status": int(status),
		"holder_id": holder_id,
		"magic_ref": magic_ref,
		"source_card_id": source_card_id,
		"duration_seconds": duration_seconds,
		"remain_seconds": remain_seconds,
		"remain_steps": remain_steps,
		"created_tick": created_tick,
		"allow_duplicate": allow_duplicate,
	}

## 从字典重建持续状态（缺省回退默认枚举）
static func from_dto(data: Dictionary) -> MagicRuleState:
	var st := MagicRuleState.new()
	st.state_id = str(data.get("state_id", ""))
	st.kind = int(data.get("kind", StateKind.SEAL))
	st.status = int(data.get("status", StateStatus.ACTIVE))
	st.holder_id = str(data.get("holder_id", ""))
	st.magic_ref = str(data.get("magic_ref", ""))
	st.source_card_id = str(data.get("source_card_id", ""))
	st.duration_seconds = int(data.get("duration_seconds", 0))
	st.remain_seconds = int(data.get("remain_seconds", 0))
	st.remain_steps = int(data.get("remain_steps", 0))
	st.created_tick = int(data.get("created_tick", 0))
	st.allow_duplicate = bool(data.get("allow_duplicate", false))
	return st

## 是否生效中（ACTIVE）
func is_active() -> bool:
	return status == StateStatus.ACTIVE

## 是否终态（非 ACTIVE 即终态）
func is_terminal() -> bool:
	return status != StateStatus.ACTIVE

## 状态机跃迁：仅 ACTIVE 可迁出；终态不可逆（状态守卫）
func transition_to(next_status: StateStatus) -> bool:
	if not is_active():
		return false
	status = next_status
	return true
