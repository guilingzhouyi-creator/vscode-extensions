# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/entitlement_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/account.json | 信号: EventBus 领域广播
# 职责说明: 可扩展账号权限/等级字段体系的统一鉴权入口（安全分责）： - 权限字段仅描述账号资格，不直担具体游戏逻辑； - 业务模块一律经 has_entitlement 判断，禁止直读 account.entitlements； - 本地存档为明文（entitlements/encrypted=false）：完整性靠存档密封 （seal 重算比对，防意外损坏/简单篡改），资格合法性靠 allowed 白名单 （空列表=放行全部）与消费端鉴权共同约束，配置由 config/domains/account.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## EntitlementService：Domain Service / State Orchestrator
class_name EntitlementService extends RefCounted

# ==============================================================================
# 一、统一鉴权入口与白名单
# ==============================================================================

## 统一鉴权入口：账号是否具备某模式/版本/授权（可扩展，不固化商业划分）
static func has_entitlement(account: AccountProfileAggregate, entitlement: String) -> bool:
	if account == null or entitlement.is_empty():
		return false
	return account.entitlements.has(entitlement)

## 合法权限白名单（配置驱动；空列表=放行全部，避免脏数据膨胀）
static func is_valid_entitlement(entitlement: String) -> bool:
	if entitlement.is_empty():
		return false
	var allowed: Array = GameConfig.get_array("domains.account", "entitlements/allowed", [])
	return allowed.is_empty() or allowed.has(entitlement)

## 白名单过滤：allowed 非空时仅保留已列出资格（空列表=放行全部，语义同 is_valid_entitlement）
static func filter_allowed(entitlements: Array) -> Array:
	var allowed: Array = GameConfig.get_array("domains.account", "entitlements/allowed", [])
	if allowed.is_empty():
		return entitlements
	var out: Array = []
	for e in entitlements:
		if allowed.has(e):
			out.append(e)
	out.sort()
	return out

## 追加资格（白名单校验通过且未持有才追加；非法资格拒绝）
static func add_entitlement(account: AccountProfileAggregate, entitlement: String) -> bool:
	if account == null or not is_valid_entitlement(entitlement):
		return false
	if not has_entitlement(account, entitlement):
		account.entitlements.append(entitlement)
	return true

## 移除资格（幂等；空列表或未持有返回 true 无操作语义——erase 天然幂等）
static func remove_entitlement(account: AccountProfileAggregate, entitlement: String) -> bool:
	if account == null or account.entitlements.is_empty():
		return false
	account.entitlements.erase(entitlement)
	return true

# ==============================================================================
# 二、密封（存档完整性防篡改）
# ==============================================================================

## 安全存储开关：开启时客户端改本地 entitlements 无法绕过（指纹校验）
static func encrypted_storage_enabled() -> bool:
	return GameConfig.get_bool("domains.account", "entitlements/encrypted", true)

## 密封密钥 ID（非秘密元数据，仅用于追溯；HMAC 密钥来自环境变量）
static func _seal_key_id() -> String:
	return GameConfig.get_string(LogConstants.CFG_ADMIN_TABLE, LogConstants.CFG_PATH_SECURITY_SEAL_ID, "")

## 规范化载荷：账号 ID + 白名单过滤后排序权限列表（顺序无关，防误报篡改）
static func _canonical_payload(account: AccountProfileAggregate) -> String:
	var sorted_list: Array = filter_allowed(account.entitlements.duplicate())
	sorted_list.sort()
	return account.account_id + ":" + ",".join(sorted_list)

## 生成权限指纹（安全存储）：HMAC-SHA256 摘要 + 密钥 ID 版本前缀（v2:）
static func seal_entitlements(account: AccountProfileAggregate) -> String:
	if account == null:
		return ""
	var key := CryptoIntegrityLib.resolve_seal_key_bytes(LogConstants.CFG_ADMIN_TABLE, LogConstants.CFG_PATH_SECURITY_SEAL_ENV)
	if key.is_empty():
		ErrorReporter.emit_error(LogConstants.CHANNEL_ENTITLEMENT, "SEAL_KEY_MISSING", SystemBaseMessages.MSG_SEAL_KEY_MISSING)
		return ""
	var payload := _canonical_payload(account)
	var mac_hex := CryptoIntegrityLib.hmac_sha256_hex(key, payload.to_utf8_buffer())
	return "v2:%s:%s" % [_seal_key_id(), mac_hex]

## 校验权限指纹是否被篡改（常量时间比对，防御时序侧信道攻击）
static func verify_seal(account: AccountProfileAggregate, recorded_seal: String) -> bool:
	if account == null or recorded_seal.is_empty():
		return false
	return CryptoIntegrityLib.constant_time_equals(seal_entitlements(account), recorded_seal)
