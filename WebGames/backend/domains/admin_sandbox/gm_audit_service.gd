# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/gm_audit_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 记录全域管理员指令操作流水与防篡改留痕（单机：内存留痕+EventBus广播， 联机预留磁盘持久化与 HMAC；当前单机聚焦阶段以内存为准，重启不保留）。 审计模板与 recent_limit 由 config/narratives/admin.json 与 config/infrastructure/admin.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GMArbitrationAuditService extends RefCounted

static var audit_log: Array = []

## 记录 GM 操作流水：规范化载荷签名（缺钥失败关闭）+ 有界裁剪（O(1) 批量切片）+ 日志广播
static func record_audit(admin_id: String, action: String, details: Dictionary) -> Dictionary:
	# P39 清单 6：签名覆盖规范化完整载荷（含 details——JSON 排序键确定性）+ key_id 支持轮换验证
	var key_id := GameConfig.get_string("infrastructure.admin", "security/seal_key_id", "")
	var canonical := "%s:%s:%s" % [admin_id, action, JSON.stringify(details, "", true)]
	var entry := {
		"timestamp_utc": int(Time.get_unix_time_from_system()),
		"admin_id": admin_id,
		"action": action,
		"details": details,
		"key_id": key_id,
		"signature": _sign(canonical)
	}
	audit_log.append(entry)
	# Phase 43 P2-12：审计有界化——按 infrastructure.admin audit/max_entries（默认 500）
	# 从头裁剪，最旧先出，长运行审计内存受控（recent_limit 仍只控制查询窗口）
	# 有界裁剪 O(max_entries) 浅拷贝（500 引用级，可忽略），避免 while+pop_front O(n²) 移位
	var audit_max := maxi(1, GameConfig.get_int("infrastructure.admin", "audit/max_entries", 500))
	if audit_log.size() > audit_max:
		audit_log = audit_log.slice(audit_log.size() - audit_max, audit_log.size())
	var tmpl := GameConfig.get_string("narratives.admin", "audit_log", "GM Audit: Admin [%s] executed [%s]")
	EventBusCore.get_instance().emit_log("warn", tmpl % [admin_id, action])
	return entry

## P39 清单 6：带密钥 HMAC 签名（受控环境密钥提供器——缺钥失败关闭，不降级公开摘要）
static func _sign(canonical: String) -> String:
	var env_name := GameConfig.get_string("infrastructure.admin", "security/seal_key_env", "")
	var key := OS.get_environment(env_name) if not env_name.is_empty() else ""
	if key.is_empty():
		ErrorReporter.emit_error("gm_audit_service", "AUDIT_KEY_MISSING", "GMArbitrationAuditService: 审计签名密钥缺失（seal_key_env 未配置）——签名不可用（失败关闭）")
		return ""
	return Crypto.new().hmac_digest(
		HashingContext.HASH_SHA256, key.to_utf8_buffer(), canonical.to_utf8_buffer()
	).hex_encode()

## 最近审计流水查询（recent_limit 配置驱动，上限裁剪）
static func get_recent_audits(limit: int = -1) -> Array:
	var cfg_limit := GameConfig.get_int("infrastructure.admin", "audit/recent_limit", 20)
	var lim := limit if limit >= 0 else cfg_limit
	var count = min(lim, audit_log.size())
	return audit_log.slice(audit_log.size() - count, audit_log.size())
