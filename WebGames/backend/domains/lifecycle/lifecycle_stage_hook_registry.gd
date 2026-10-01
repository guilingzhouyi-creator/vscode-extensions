# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/lifecycle_stage_hook_registry.gd
# 架构定位: Generic Pipeline & Hook Registry Engine
# 跨域依赖: 上游: 领域业务流 | 下游: GameConfig, UnwiredSlotGuardSolver, SessionFlowContextDTO | 配置: config/infrastructure/lifecycle.json
# 职责说明: 纯配置驱动的生命周期十阶段调度与扩展 Hook 注册执行引擎，解耦跨域强依赖
# 设计依据: 业务域第一性原理 / 分层解耦无头架构
# ==============================================================================

class_name LifecycleStageHookRegistry
extends RefCounted

static var _pre_hooks: Dictionary = {}
static var _post_hooks: Dictionary = {}
static var _config_version: int = -1
static var _stage_configs: Dictionary = {}
static var _stage_aliases: Dictionary = {}
static var _config_error: String = ""

static func invalidate_cache() -> void:
	_config_version = -1

static func clear_hooks() -> void:
	_pre_hooks.clear()
	_post_hooks.clear()

static func register_hook(stage_identifier: String, callable: Callable, hook_type: String = "post") -> void:
	var norm_id := _normalize_stage_key(stage_identifier)
	if norm_id.is_empty():
		return
	if hook_type == "pre":
		_register_to_table(_pre_hooks, norm_id, callable)
	else:
		_register_to_table(_post_hooks, norm_id, callable)

static func _register_to_table(table: Dictionary, norm_id: String, callable: Callable) -> void:
	if not table.has(norm_id):
		table[norm_id] = []
	var list: Array = table[norm_id]
	list.append(callable)

static func get_hooks(stage_identifier: String, hook_type: String = "post") -> Array:
	var norm_id := _normalize_stage_key(stage_identifier)
	if norm_id.is_empty():
		return []
	var table: Dictionary = _pre_hooks if hook_type == "pre" else _post_hooks
	if not table.has(norm_id):
		return []
	return table[norm_id]

static func execute_stage(stage_identifier: String, ctx: SessionFlowContextDTO, payload: Dictionary = {}) -> Dictionary:
	if not _ensure_config_index():
		return {"success": false, "error_code": "INVALID_STAGE_CONFIG", "details": _config_error}
	var norm_id := _normalize_stage_key(stage_identifier)
	if norm_id.is_empty():
		return {"success": false, "error_code": "UNKNOWN_STAGE", "stage_key": stage_identifier}
	var cfg: Dictionary = _stage_configs.get(norm_id, {})

	var req_slots := _extract_required_slots(cfg)
	var guard_res := UnwiredSlotGuardSolver.validate_slots(payload, req_slots)
	if not bool(guard_res.get("valid", false)):
		var slot_err: String = str(guard_res.get("unwired_slot", ""))
		ctx.mark_slot_unwired(slot_err)
		return {
			"success": false,
			"error_code": str(guard_res.get("error_code", "UNBOUND_SLOT")),
			"stage_key": norm_id,
			"unwired_slot": slot_err
		}

	_invoke_hook_list(_pre_hooks.get(norm_id, []), ctx, payload)

	var stage_idx: int = int(cfg.get("stage_index", 0))
	ctx.current_stage_index = stage_idx
	_apply_payload_to_context(ctx, payload)
	ctx.stage_results[norm_id] = {"success": true, "stage_index": stage_idx, "payload": payload}

	_invoke_hook_list(_post_hooks.get(norm_id, []), ctx, payload)

	return {
		"success": true,
		"error_code": "",
		"stage_key": norm_id,
		"stage_index": stage_idx,
		"context": ctx.to_dto()
	}

static func _invoke_hook_list(hooks: Array, ctx: SessionFlowContextDTO, payload: Dictionary) -> void:
	for h in hooks:
		if h is Callable:
			(h as Callable).call(ctx, payload)

static func _apply_payload_to_context(ctx: SessionFlowContextDTO, payload: Dictionary) -> void:
	if payload.has("session_token"):
		ctx.session_token = str(payload.get("session_token", ""))
	if payload.has("account_id"):
		ctx.account_id = str(payload.get("account_id", ""))
	if payload.has("username"):
		ctx.username = str(payload.get("username", ""))
	if payload.has("slot_id"):
		ctx.current_slot_id = str(payload.get("slot_id", ""))
	if payload.has("character_id"):
		ctx.character_id = str(payload.get("character_id", ""))
	if payload.has("character_name"):
		ctx.character_name = str(payload.get("character_name", ""))
	if payload.has("gender"):
		ctx.gender = str(payload.get("gender", ""))
	if payload.has("race_id"):
		ctx.race_id = str(payload.get("race_id", ""))
	if payload.has("world_id"):
		ctx.current_world_id = str(payload.get("world_id", ""))
	if payload.has("game_mode"):
		ctx.game_mode = int(payload.get("game_mode", 0))
	if payload.has("is_esc_menu_open"):
		ctx.is_esc_menu_open = bool(payload.get("is_esc_menu_open", false))
	if payload.has("hud_snapshot"):
		ctx.hud_snapshot = Dictionary(payload.get("hud_snapshot", {}))
	if payload.has("account_snapshot"):
		ctx.account_snapshot = Dictionary(payload.get("account_snapshot", {}))

static func _extract_required_slots(cfg: Dictionary) -> Array[String]:
	var result: Array[String] = []
	var raw_slots: Variant = cfg.get("required_slots", [])
	if not raw_slots is Array:
		return result
	for slot in raw_slots:
		result.append(String(slot))
	return result

static func _ensure_config_index() -> bool:
	var current_version: int = GameConfig.config_reload_version()
	if current_version == _config_version and not _stage_configs.is_empty():
		return true

	var pipeline_cfg: Dictionary = GameConfig.get_dict("infrastructure.lifecycle", "session_stage_pipeline", {})
	if pipeline_cfg.is_empty():
		_config_error = "EMPTY_STAGE_PIPELINE"
		return false

	var next_configs: Dictionary = {}
	var next_aliases: Dictionary = {}
	var seen_indices: Dictionary = {}
	for raw_stage_key in pipeline_cfg:
		var stage_key: String = String(raw_stage_key).strip_edges().to_upper()
		if stage_key.is_empty() or next_configs.has(stage_key):
			_config_error = "INVALID_OR_DUPLICATE_STAGE_KEY"
			return false
		var raw_stage_config: Variant = pipeline_cfg[raw_stage_key]
		if not raw_stage_config is Dictionary:
			_config_error = "STAGE_CONFIG_NOT_OBJECT:" + stage_key
			return false
		var stage_config: Dictionary = raw_stage_config
		var raw_stage_index: Variant = stage_config.get("stage_index", null)
		var stage_index_type: int = typeof(raw_stage_index)
		if (stage_index_type != TYPE_INT and stage_index_type != TYPE_FLOAT) \
			or float(raw_stage_index) <= 0.0 \
			or not is_equal_approx(float(raw_stage_index), floor(float(raw_stage_index))):
			_config_error = "INVALID_STAGE_INDEX:" + stage_key
			return false
		var stage_index: int = int(raw_stage_index)
		if seen_indices.has(stage_index):
			_config_error = "DUPLICATE_STAGE_INDEX:" + str(stage_index)
			return false
		seen_indices[stage_index] = true

		var raw_slots: Variant = stage_config.get("required_slots", null)
		if not raw_slots is Array or raw_slots.is_empty():
			_config_error = "INVALID_REQUIRED_SLOTS:" + stage_key
			return false
		var required_slots: Array[String] = []
		for raw_slot in raw_slots:
			if not raw_slot is String:
				_config_error = "INVALID_REQUIRED_SLOT:" + stage_key
				return false
			var slot: String = String(raw_slot).strip_edges()
			if slot.is_empty() or required_slots.has(slot):
				_config_error = "EMPTY_OR_DUPLICATE_REQUIRED_SLOT:" + stage_key
				return false
			required_slots.append(slot)

		var raw_aliases: Variant = stage_config.get("aliases", [])
		if not raw_aliases is Array:
			_config_error = "INVALID_STAGE_ALIASES:" + stage_key
			return false
		var aliases: Array[String] = []
		for raw_alias in raw_aliases:
			if not raw_alias is String:
				_config_error = "INVALID_STAGE_ALIAS:" + stage_key
				return false
			var alias: String = String(raw_alias).strip_edges().to_upper()
			if alias.is_empty() or aliases.has(alias):
				_config_error = "EMPTY_OR_DUPLICATE_STAGE_ALIAS:" + stage_key
				return false
			aliases.append(alias)

		next_configs[stage_key] = {
			"stage_index": stage_index,
			"required_slots": required_slots,
			"aliases": aliases
		}
		next_aliases[stage_key] = stage_key

	for stage_key in next_configs:
		var stage_config: Dictionary = next_configs[stage_key]
		var aliases: Array[String] = stage_config["aliases"]
		for alias in aliases:
			if next_aliases.has(alias):
				_config_error = "STAGE_ALIAS_COLLISION:" + alias
				return false
			next_aliases[alias] = stage_key

	_stage_configs = next_configs
	_stage_aliases = next_aliases
	_config_version = current_version
	_config_error = ""
	return true

static func _normalize_stage_key(stage_identifier: String) -> String:
	var key := stage_identifier.strip_edges().to_upper()
	if key.is_empty() or not _ensure_config_index():
		return ""
	return String(_stage_aliases.get(key, ""))
