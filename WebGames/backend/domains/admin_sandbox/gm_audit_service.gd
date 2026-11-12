# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/gm_audit_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 记录全域管理员指令操作流水与防篡改留痕（单机：内存留痕+EventBus广播， 联机预留磁盘持久化与 HMAC；当前单机聚焦阶段以内存为准，重启不保留）。 审计模板与 recent_limit 由 config/narratives/admin.json 与 config/infrastructure/admin.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## GMArbitrationAuditService：Domain Service / State Orchestrator
class_name GMArbitrationAuditService extends RefCounted

static var audit_log: Array = []

## 记录 GM 操作流水：规范化载荷签名（缺钥失败关闭）+ 有界裁剪（O(1) 批量切片）+ 日志广播
static func record_audit(admin_id: String, action: String, details: Dictionary) -> Dictionary:
	# 清单 6：签名覆盖规范化完整载荷（含 details——JSON 排序键确定性）+ key_id 支持轮换验证
	var key_id := GameConfig.get_string(LogConstants.CFG_ADMIN_TABLE, LogConstants.CFG_PATH_SECURITY_SEAL_ID, "")
	var canonical := "%s:%s:%s" % [admin_id, action, JSON.stringify(details, "", true)]
	var entry := {
		LogConstants.KEY_TIMESTAMP_UTC: int(Time.get_unix_time_from_system()),
		"admin_id": admin_id,
		"action": action,
		"details": details,
		"key_id": key_id,
		"signature": _sign(canonical)
	}
	audit_log.append(entry)
	# 审计有界化——按 infrastructure.admin audit/max_entries（默认 500）
	# 从头裁剪，最旧先出，长运行审计内存受控（recent_limit 仍只控制查询窗口）
	# 有界裁剪 O(max_entries) 浅拷贝（500 引用级，可忽略），避免 while+pop_front O(n²) 移位
	var audit_max := maxi(1, GameConfig.get_int(LogConstants.CFG_ADMIN_TABLE, "audit/max_entries", 500))
	if audit_log.size() > audit_max:
		audit_log = audit_log.slice(audit_log.size() - audit_max, audit_log.size())
	var tmpl := GameConfig.get_string("narratives.admin", "audit_log", SystemBaseMessages.MSG_GM_AUDIT_FALLBACK)
	EventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_WARN, TemplateFormatter.format(tmpl, {"admin_id": admin_id, "action": action}))
	return entry

## 清单 6：带密钥 HMAC 签名（受控环境密钥提供器——缺钥失败关闭，不降级公开摘要）
static func _sign(canonical: String) -> String:
	var key := CryptoIntegrityLib.resolve_seal_key_bytes(LogConstants.CFG_ADMIN_TABLE, LogConstants.CFG_PATH_SECURITY_SEAL_ENV)
	if key.is_empty():
		ErrorReporter.emit_error(LogConstants.CHANNEL_GM_AUDIT, "AUDIT_KEY_MISSING", SystemBaseMessages.MSG_AUDIT_KEY_MISSING)
		return ""
	return CryptoIntegrityLib.hmac_sha256_hex(key, canonical.to_utf8_buffer())

## 最近审计流水查询（recent_limit 配置驱动，上限裁剪）
static func get_recent_audits(limit: int = -1) -> Array:
	var cfg_limit := GameConfig.get_int(LogConstants.CFG_ADMIN_TABLE, "audit/recent_limit", 20)
	var lim := limit if limit >= 0 else cfg_limit
	var count: int = mini(lim, audit_log.size())
	return audit_log.slice(audit_log.size() - count, audit_log.size())
