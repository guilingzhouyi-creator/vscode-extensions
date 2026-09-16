# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/version_state_machine.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 严格管控版本从发现、分群、推送、授权、下载、校验、暂存、激活到运行的 9 大单向状态及 4 大异常状态跃迁
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name VersionStateMachine
extends RefCounted

enum State {
	DISCOVERED = 0,      # 捕获新版本元数据
	ASSIGNED = 1,        # 灰度策略判定命中
	PUSHED = 2,          # P72 EventBus 下发通知
	AUTHORIZED = 3,      # 获得有效激活令牌
	DOWNLOADING = 4,     # 数据面正在拉取资源
	VERIFIED = 5,        # SHA-256 完整性校验通过
	STAGED = 6,          # 补丁包暂存就绪
	ACTIVATED = 7,       # 动态挂载且门禁通过
	RUNNING = 8,         # 进入正式业务运行时
	# 异常状态
	FAILED = 90,         # 下载或挂载失败
	REJECTED = 91,       # 校验不通过/签名伪造
	REVOKED = 92,        # 授权被中心撤销
	ROLLED_BACK = 93     # 触发熔断紧急回滚
}

var current_state: int = State.DISCOVERED
var current_version: String = "1.0.0"

## 状态跃迁控制 (非法跃迁直接告警阻断；经 ErrorReporter 统一通道，不依赖旧版 EventBus)
func transition_to(new_state: int) -> bool:
	if _is_valid_transition(current_state, new_state):
		current_state = new_state
		return true
	ErrorReporter.emit("version_state_machine_illegal_transition", {
		"current_state": current_state,
		"target_state": new_state,
		"version": current_version
	}, "【VersionStateMachine】非法状态跃迁：无法从 %d 跃迁至 %d" % [current_state, new_state])
	return false

func _is_valid_transition(from_s: int, to_s: int) -> bool:
	# 异常状态允许从任何在途状态跃迁入
	if to_s in [State.FAILED, State.REJECTED, State.REVOKED, State.ROLLED_BACK]:
		return true
	# 异常态恢复路径（防终态死锁）：失败重试 / 授权重授 / 校验驳回重试
	if from_s == State.FAILED and to_s == State.DOWNLOADING:
		return true   # 下载/挂载失败后重试拉取
	if from_s == State.REVOKED and to_s == State.AUTHORIZED:
		return true   # 授权被撤销后中心重发令牌，重新获得运行资格
	if from_s == State.REJECTED and (to_s == State.DOWNLOADING or to_s == State.DISCOVERED):
		return true   # 校验/签名驳回后清理脏包并允许重新触发拉取或重新发现
	# 正向单向流动规则
	match from_s:
		State.DISCOVERED: return to_s == State.ASSIGNED
		State.ASSIGNED: return to_s == State.PUSHED
		State.PUSHED: return to_s == State.AUTHORIZED
		State.AUTHORIZED: return to_s == State.DOWNLOADING
		State.DOWNLOADING: return to_s == State.VERIFIED
		State.VERIFIED: return to_s == State.STAGED
		State.STAGED: return to_s == State.ACTIVATED
		State.ACTIVATED: return to_s == State.RUNNING
		State.ROLLED_BACK: return to_s == State.RUNNING # 回滚至基线后恢复运行态
		_: return false
