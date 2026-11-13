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
	var sid: String = str(config.get("session_id", "")).strip_edges()
	if not sid.is_empty():
		return sid
	return "sess_%d_%d" % [int(Time.get_unix_time_from_system()), int(Time.get_ticks_usec()) % 1000000]


## 加载并适配试玩会话所需的显性 MOD 清单
static func resolve_mod_manifest(config: Dictionary) -> Dictionary:
	if config.has("adapted_manifest"):
		var raw_man: Variant = config.get("adapted_manifest")
		if raw_man is Dictionary and not (raw_man as Dictionary).is_empty():
			return {
				"success": true,
				"adapted_manifest": (raw_man as Dictionary).duplicate(true)
			}

	var cand_packs: Array = config.get("candidate_packs", []).duplicate()
	var mod_dirs: Array = config.get("mod_dirs", [])
	if cand_packs.is_empty() and not mod_dirs.is_empty():
		for d in mod_dirs:
			var pkg: Dictionary = ModPackageDiscoverySolver.load_full_mod_package_from_dir(str(d))
			if not pkg.is_empty():
				cand_packs.append(pkg)

	var enabled_ids: Array = config.get("enabled_pack_ids", ["*"])
	return ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list(cand_packs, enabled_ids)


## 基于配置构造权威创角请求 DTO
static func build_creation_request(config: Dictionary) -> AuthoritativeCharacterCreationRequestDTO:
	if config.get("request") is AuthoritativeCharacterCreationRequestDTO:
		return config.get("request")
	var req: AuthoritativeCharacterCreationRequestDTO = AuthoritativeCharacterCreationRequestDTO.new()
	req.account_id = str(config.get("account_id", "agent_account"))
	req.slot_id = int(config.get("slot_id", 0))
	req.world_id = str(config.get("world_id", "default_world"))
	req.character_name = str(config.get("character_name", "Hero"))
	req.request_seed = int(config.get("request_seed", config.get("seed", 0)))
	var raw_extra: Variant = config.get("extra_custom_fields", {})
	if raw_extra is Dictionary:
		req.extra_custom_fields = (raw_extra as Dictionary).duplicate(true)
	var origin_id: String = str(config.get("origin_id", "")).strip_edges()
	if not origin_id.is_empty():
		req.extra_custom_fields["selected_origin_id"] = origin_id
	var race_id: String = str(config.get("race_id", "")).strip_edges()
	if not race_id.is_empty():
		req.extra_custom_fields["selected_race_id"] = race_id
	return req


## 基于创角权威解算结果装配角色档案实例
static func build_character_profile(
	session_id: String,
	solve_res: Dictionary,
	req: AuthoritativeCharacterCreationRequestDTO
) -> CharacterProfile:
	var prof: CharacterProfile = CharacterProfile.new()
	prof.character_id = "char_" + session_id
	prof.character_name = str(solve_res.get("character_name", req.character_name))
	var attrs: Variant = solve_res.get("attributes", {})
	if attrs is Dictionary:
		prof.attributes = (attrs as Dictionary).duplicate(true)
	var wallet: Variant = solve_res.get("wallet", {})
	if wallet is Dictionary:
		prof.personal_resources = (wallet as Dictionary).duplicate(true)
	return prof


## 基于角色档案与解算结果装配序章上下文实例
static func build_prologue_context(
	solve_res: Dictionary,
	prof: CharacterProfile,
	req: AuthoritativeCharacterCreationRequestDTO
) -> CharacterPrologueContext:
	var c: CharacterPrologueContext = CharacterPrologueContext.new()
	c.account_id = req.account_id
	c.character_id = prof.character_id
	c.character_name = prof.character_name
	c.race_id = str(solve_res.get("race_id", "HUMAN"))
	c.gender = str(solve_res.get("gender", "OTHER"))
	c.assigned_start_location_id = str(solve_res.get("birth_region_id", "CENTRAL_CONTINENT"))
	c.assigned_starter_kit_id = str(solve_res.get("starter_kit_id", ""))
	c.created_timestamp_utc = int(Time.get_unix_time_from_system())
	c.is_active = true
	c.current_stage = 1
	c.step_index = 0

	var origin_id: String = str(solve_res.get("origin_id", ""))
	c.runtime_placeholders["ORIGIN_ID"] = origin_id
	c.runtime_placeholders["origin_id"] = origin_id
	c.runtime_placeholders["ORIGIN_NAME"] = str(solve_res.get("origin_name", origin_id))
	c.runtime_placeholders["TRAIT_SUMMARY"] = build_trait_summary(solve_res.get("traits_details", []))
	return c


## 格式化已选因果特质摘要文案
static func build_trait_summary(traits_details: Variant) -> String:
	if not (traits_details is Array):
		return ""
	var names: Array[String] = []
	for item in (traits_details as Array):
		if item is Dictionary:
			var tname: String = str((item as Dictionary).get("name", "")).strip_edges()
			if not tname.is_empty():
				names.append(tname)
	return " / ".join(names)
