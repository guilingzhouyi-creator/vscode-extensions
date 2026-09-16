# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/activation_token_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 作为客户端已获得目标版本合法运行资格的“入场券”，落实“本地物理存在 != 允许运行”安全边界
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ActivationTokenDTO
extends RefCounted

var token_id: String = ""                     # 令牌 UUID / 唯一次序码
var user_id: String = ""                      # 绑定的目标用户账号
var authorized_version: String = ""           # 被授权运行的精确版本号
var authorized_version_code: int = 0          # 被授权运行的版本整型码
var issued_at_unix: int = 0                   # 签发时间戳
var expires_at_unix: int = 0                  # 过期时间戳 (0 为永久)
var signature_hmac: String = ""               # 授权校验数字签名 (防篡改)
var is_revoked: bool = false                  # 是否已被中心紧急撤销

## 检查令牌有效期与合法性
func is_eligible_at(now_unix: int) -> bool:
	if is_revoked:
		return false
	if expires_at_unix > 0 and now_unix > expires_at_unix:
		return false
	return not authorized_version.is_empty() and authorized_version_code > 0
