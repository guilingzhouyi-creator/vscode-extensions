# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建集群 (Character Creation))
# 文件路径: res://backend/domains/character_creation/agent_playthrough_session_factory.gd
# 架构定位: Domain Factory / Agent Session Initialization & Context Builder
# 依赖与触发: 上游: AgentPlaythroughSession | 下游: ModPrecheckAndAdaptationSolver, ModPackageDiscoverySolver, CharacterProfile, CharacterPrologueContext | 配置: 无直读 | 信号: 无
# 职责说明: 为 Agent 长程试玩推演会话构建会话标识、解析合并 MOD 清单、装配权威创角请求、构造初始角色档案与序章上下文。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AgentPlaythroughSessionFactory：Domain Factory / Session Initialization Builder
class_name AgentPlaythroughSessionFactory
extends RefCounted


## 解析或生成唯一试玩推演会话 ID
static func prepare_session_id(config: Dictionary) -> String:
	var session_id: String = str(config.get("session_id", "")).strip_edges()
	if not session_id.is_empty():
		return session_id
	return "sess_%d_%d" % [int(Time.get_unix_time_from_system()), int(Time.get_ticks_usec()) % 1000000]


## 加载并适配试玩会话所需的显性 MOD 清单
static func resolve_mod_manifest(config: Dictionary) -> Dictionary:
	if config.has("adapted_manifest"):
		var raw_manifest: Variant = config.get("adapted_manifest")
		if raw_manifest is Dictionary and not (raw_manifest as Dictionary).is_empty():
			return {
				"success": true,
				"adapted_manifest": (raw_manifest as Dictionary).duplicate(true)
			}

	var candidate_packs: Array = config.get("candidate_packs", []).duplicate()
	var mod_dirs: Array = config.get("mod_dirs", [])
	if candidate_packs.is_empty() and not mod_dirs.is_empty():
		for mod_dir in mod_dirs:
			var loaded_package: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir(str(mod_dir))
			if not loaded_package.is_empty():
				candidate_packs.append(loaded_package)

	var enabled_ids: Array = config.get("enabled_pack_ids", ["*"])
	return ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(candidate_packs, enabled_ids)


## 基于配置构造权威创角请求 DTO
static func build_creation_request(config: Dictionary) -> AuthoritativeCharacterCreationRequestDTO:
	if config.get("request") is AuthoritativeCharacterCreationRequestDTO:
		return config.get("request")
	var creation_request: AuthoritativeCharacterCreationRequestDTO = AuthoritativeCharacterCreationRequestDTO.new()
	creation_request.account_id = str(config.get("account_id", "agent_account"))
	creation_request.slot_id = int(config.get("slot_id", 0))
	creation_request.world_id = str(config.get("world_id", "default_world"))
	creation_request.character_name = str(config.get("character_name", "Hero"))
	creation_request.request_seed = int(config.get("request_seed", config.get("seed", 0)))
	var raw_extra: Variant = config.get("extra_custom_fields", {})
	if raw_extra is Dictionary:
		creation_request.extra_custom_fields = (raw_extra as Dictionary).duplicate(true)
	var origin_id: String = str(config.get("origin_id", "")).strip_edges()
	if not origin_id.is_empty():
		creation_request.extra_custom_fields["selected_origin_id"] = origin_id
	var race_id: String = str(config.get("race_id", "")).strip_edges()
	if not race_id.is_empty():
		creation_request.extra_custom_fields["selected_race_id"] = race_id
	return creation_request


## 基于创角权威解算结果装配角色档案实例
static func build_character_profile(
	session_id: String,
	solve_result: Dictionary,
	creation_request: AuthoritativeCharacterCreationRequestDTO
) -> CharacterProfile:
	var character_profile: CharacterProfile = CharacterProfile.new()
	character_profile.character_id = "char_" + session_id
	character_profile.character_name = str(solve_result.get("character_name", creation_request.character_name))
	var attributes: Variant = solve_result.get("attributes", {})
	if attributes is Dictionary:
		character_profile.attributes = (attributes as Dictionary).duplicate(true)
	var wallet: Variant = solve_result.get("wallet", {})
	if wallet is Dictionary:
		character_profile.personal_resources = (wallet as Dictionary).duplicate(true)
	return character_profile


## 基于角色档案与解算结果装配序章上下文实例
static func build_prologue_context(
	solve_result: Dictionary,
	character_profile: CharacterProfile,
	creation_request: AuthoritativeCharacterCreationRequestDTO
) -> CharacterPrologueContext:
	var prologue_context: CharacterPrologueContext = CharacterPrologueContext.new()
	prologue_context.account_id = creation_request.account_id
	prologue_context.character_id = character_profile.character_id
	prologue_context.character_name = character_profile.character_name
	prologue_context.race_id = str(solve_result.get("race_id", "HUMAN"))
	prologue_context.gender = str(solve_result.get("gender", "OTHER"))
	prologue_context.assigned_start_location_id = str(solve_result.get("birth_region_id", "CENTRAL_CONTINENT"))
	prologue_context.assigned_starter_kit_id = str(solve_result.get("starter_kit_id", ""))
	prologue_context.created_timestamp_utc = int(Time.get_unix_time_from_system())
	prologue_context.is_active = true
	prologue_context.current_stage = 1
	prologue_context.step_index = 0

	var origin_id: String = str(solve_result.get("origin_id", ""))
	prologue_context.runtime_placeholders["ORIGIN_ID"] = origin_id
	prologue_context.runtime_placeholders["origin_id"] = origin_id
	prologue_context.runtime_placeholders["ORIGIN_NAME"] = str(solve_result.get("origin_name", origin_id))
	prologue_context.runtime_placeholders["TRAIT_SUMMARY"] = build_trait_summary(solve_result.get("traits_details", []))
	return prologue_context


## 格式化已选因果特质摘要文案
static func build_trait_summary(traits_details: Variant) -> String:
	if not (traits_details is Array):
		return ""
	var names: Array[String] = []
	for item in (traits_details as Array):
		if item is Dictionary:
			var trait_name: String = str((item as Dictionary).get("name", "")).strip_edges()
			if not trait_name.is_empty():
				names.append(trait_name)
	return " / ".join(names)
