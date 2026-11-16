# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/services/gameplay_social_protocol_handler.gd
# 架构定位: Domain Protocol Action Handler / Social, Save, Misc & GM Domains
# 依赖与触发: 上游: UnifiedProtocolDispatcher | 下游: WorldSessionRuntimeService, OrganizationGovernanceSolver, WorldArchiveRepository
# 职责说明: 承接 mail/guild/misc_edge/system_save/gm_command 统一协议动作并持久化/同步后端权威状态。
# 退出语义与设计依据: 统一协议全域路由与持久化会话状态契约 (Inv-FE-BE-CONTRACT-1)
# ==============================================================================

## GameplaySocialProtocolHandler：社交、邮箱、杂项、存档与 GM 指令统一协议分发处理器
class_name GameplaySocialProtocolHandler
extends RefCounted

static var _mail_drafts: Array = []
static var _sent_mails: Array = []
static var _registered_names: Dictionary = {}

## 分发社交、邮箱、边缘玩法、存档管理与 GM 指令协议动作
static func dispatch(request: ClientRequestEnvelopeDTO) -> UnifiedResponseEnvelopeDTO:
	var payload_map: Dictionary = request.payload if request.payload is Dictionary else {}
	match request.domain:
		"mail":
			return _handle_mail(request.request_id, request.action_type, payload_map)
		"guild":
			return _handle_guild(request.request_id, request.action_type, payload_map)
		"misc_edge":
			return _handle_misc_edge(request.request_id, request.action_type, payload_map)
		"system_save":
			return _handle_system_save(request.request_id, request.action_type, payload_map)
		"gm_command":
			return _handle_gm_command(request.request_id, request.action_type, payload_map)
	return UnifiedProtocolFactory.create_unhandled_action_response(request.request_id, request.action_type)

static func _handle_mail(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "SAVE_DRAFT":
		_mail_drafts.append(payload_map.duplicate(true))
		return UnifiedProtocolFactory.create_response(request_id, true, {"draft_count": _mail_drafts.size()}, "", "Mail draft saved")
	if action_type == "SEND_MAIL":
		var mail_record := {
			"mail_id": "MAIL_%d" % (_sent_mails.size() + 1),
			"recipient": str(payload_map.get("recipient", "")),
			"subject": str(payload_map.get("subject", "")),
			"body": str(payload_map.get("body", "")),
			"attachment_keys": payload_map.get("attachment_keys", []),
			"is_read": true,
			"is_claimed": false,
		}
		_sent_mails.append(mail_record)
		return UnifiedProtocolFactory.create_response(request_id, true, {"mail": mail_record, "sent_count": _sent_mails.size()}, "", "Mail sent")
	if action_type == "CLAIM_MAIL" and WorldSessionRuntimeService.has_active_world():
		var claim_bonus := maxi(0, int(payload_map.get("bonus_gold", 0)))
		if claim_bonus > 0:
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": claim_bonus, "unread_mail_delta": -1}, -1, false)
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type}, "", "Mail directive processed")

static func _handle_guild(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "CHECK_PERMISSION" or action_type == "MANAGE_MEMBER":
		var operator_role := str(payload_map.get("operator_role", "MEMBER")).to_upper()
		var guild_entity := OrganizationAggregate.new()
		guild_entity.member_roster["OPERATOR"] = {
			"role": OrganizationAggregate.GuildRole.GUILD_MASTER if operator_role in ["LEADER", "MASTER", "GUILD_MASTER"] else OrganizationAggregate.GuildRole.NOVICE
		}
		var allowed := OrganizationGovernanceSolver.can_perform_action(guild_entity, "OPERATOR", str(payload_map.get("permission_action", "KICK_MEMBER")))
		return UnifiedProtocolFactory.create_response(request_id, allowed, {"allowed": allowed, "target": str(payload_map.get("member_id", ""))}, "" if allowed else "ERR_GUILD_PERMISSION_DENIED", "Guild governance checked")
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type, "channel": str(payload_map.get("channel", "GUILD"))}, "", "Guild social action processed")

static func _handle_misc_edge(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	if action_type == "CHECK_NAME":
		var candidate_name := str(payload_map.get("candidate_name", "")).strip_edges()
		var name_available := not candidate_name.is_empty() and candidate_name.length() >= 2 and not _registered_names.has(candidate_name.to_lower())
		return UnifiedProtocolFactory.create_response(request_id, true, {"available": name_available, "candidate_name": candidate_name}, "", "Name availability checked")
	if action_type == "REGISTER_NAME":
		var candidate_name := str(payload_map.get("candidate_name", "")).strip_edges()
		if candidate_name.is_empty() or _registered_names.has(candidate_name.to_lower()):
			return UnifiedProtocolFactory.create_response(request_id, false, {"candidate_name": candidate_name}, "ERR_NAME_UNAVAILABLE", "Candidate name is empty or taken")
		_registered_names[candidate_name.to_lower()] = Time.get_datetime_string_from_system(false, true)
		var fee_gold := maxi(0, int(payload_map.get("fee", 0)))
		if WorldSessionRuntimeService.has_active_world() and fee_gold > 0:
			WorldSessionRuntimeService.apply_mutation_and_sync({"wallet_gold_delta": -fee_gold, "character_name": candidate_name}, -1, false)
		return UnifiedProtocolFactory.create_response(request_id, true, {"candidate_name": candidate_name, "fee": fee_gold}, "", "Name registered")
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type}, "", "Misc edge action processed")

static func _handle_system_save(request_id: String, action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var slot_identifier := str(payload_map.get("slot_id", WorldSessionRuntimeService.get_active_slot_id()))
	if action_type == "SAVE_TO_SLOT" or action_type == "EXPORT_SLOT":
		var world_identifier := WorldSessionRuntimeService.get_active_world_id()
		var snapshot_payload := WorldSessionRuntimeService.assemble_runtime_save_payload()
		if snapshot_payload.is_empty():
			snapshot_payload = {"slot_id": slot_identifier, "timestamp": Time.get_datetime_string_from_system(false, true)}
		if action_type == "EXPORT_SLOT":
			var export_path := "user://saves/%s_export.json" % (slot_identifier if not slot_identifier.is_empty() else "slot")
			AtomicFileWriter.ensure_directory("user://saves/")
			var output_handle := FileAccess.open(export_path, FileAccess.WRITE)
			if output_handle != null:
				output_handle.store_string(JSON.stringify(snapshot_payload, "  ") + "\n")
				output_handle.close()
			return UnifiedProtocolFactory.create_response(request_id, true, {"export_path": export_path}, "", "Save slot exported")
		if not world_identifier.is_empty():
			WorldArchiveRepository.get_instance().save_all()
		return UnifiedProtocolFactory.create_response(request_id, true, {"slot_id": slot_identifier, "saved": true}, "", "Save slot committed")
	if action_type == "REDEEM_CDKEY":
		var voucher_code := str(payload_map.get("code", "")).strip_edges().to_upper()
		if voucher_code.is_empty() or voucher_code.length() < 4:
			return UnifiedProtocolFactory.create_response(request_id, false, {}, "INVALID_CODE", "Voucher code is invalid")
		return UnifiedProtocolFactory.create_response(request_id, true, {"code": voucher_code, "redeemed_at": Time.get_datetime_string_from_system(false, true)}, "", "Voucher processed")
	return UnifiedProtocolFactory.create_response(request_id, true, {"action": action_type, "slot_id": slot_identifier}, "", "System save action processed")

static func _handle_gm_command(request_id: String, _action_type: String, payload_map: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var command_line := str(payload_map.get("command", "")).strip_edges()
	if command_line.is_empty():
		return UnifiedProtocolFactory.create_response(request_id, false, {}, "ERR_EMPTY_GM_COMMAND", "Command string cannot be empty")
	var clean_token := command_line.trim_prefix("/").split(" ", false)[0]
	var command_known := (clean_token in GmCommandCatalog.BUILTIN_COMMANDS) or (clean_token in ["heal", "tp", "set_level", "add_gold", "help"])
	return UnifiedProtocolFactory.create_response(request_id, command_known, {"command": command_line, "token": clean_token}, "" if command_known else "ERR_UNKNOWN_GM_COMMAND", "GM command processed")
