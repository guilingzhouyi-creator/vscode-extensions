# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建领域)
# 文件路径: res://backend/domains/character_creation/world_character_creation_orchestrator.gd
# 架构定位: Domain Orchestrator / Service Facade
# 依赖与触发: 上游: WorldGatewayFSM, UI/API | 下游: WorldArchiveRepository, SaveDataAccessLayer, AccountRepository, EventBusCore | 配置: config/domains/character_creation.json | 信号: character_creation.authoritative_completed
# 职责说明: 世界内角色权威创建与时空装配事务门面。执行零信任输入权威校验、后端权威命途解算、角色实体装配、初始装备实体入包装配、世界时钟因果锚定与历史片段只增追加、存储物理落盘与账号封面同步、网关状态自动回挂跃迁以及全景只读呈现信封组装。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldCharacterCreationOrchestrator：Domain Orchestrator / Service Facade
class_name WorldCharacterCreationOrchestrator
extends RefCounted

## 非法字符黑名单（防止文件注入与控制符号破坏）
const FORBIDDEN_CHARS: Array[String] = [
    "/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\n", "\r", "\t"
]

# ==============================================================================
# 一、主事务执行入口 (create_character_authoritative)
# ==============================================================================

## 世界内角色权威创建装配主流程
## 执行防篡改检验、权威解算、实体装配、物资装配、世界历史追加、物理落盘与网关回挂
static func create_character_authoritative(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    gateway_fsm: WorldGatewayFSM = null,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    # 1. 输入防篡改卫语句核验
    var validation_result := _validate_request(creation_request)
    if not bool(validation_result.get("valid", false)):
        return {
            "success": false,
            "error_code": str(validation_result.get("error_code", "")),
            "message": str(validation_result.get("message", ""))
        }
    var character_name: String = str(validation_result.get("character_name", ""))

    # 2. 世界存在性核验（不存在则立即阻断）
    var world_repository := WorldArchiveRepository.get_instance()
    if not world_repository.has_world(creation_request.world_id):
        return {
            "success": false,
            "error_code": "WORLD_NOT_FOUND",
            "message": GameConfig.msg_fmt("character_creation", "world_not_found", {"world_id": creation_request.world_id})
        }

    # 3. 权威命途解算（Fail-Closed：未挂载基础/全转化内容 MOD 严禁创角）
    var effective_manifest: Dictionary = _resolve_effective_manifest(gateway_fsm, adapted_mod_manifest)
    if effective_manifest.is_empty() or not bool(effective_manifest.get("has_base_content_mod", false)):
        return {
            "success": false,
            "error_code": "ERR_NO_BASE_CONTENT_MOD",
            "message": "No active base or total-conversion content MOD mounted; character creation is blocked."
        }
    var solver_result: Dictionary = AuthoritativeReincarnationSolver.resolve_reincarnation_package(
        creation_request,
        creation_request.request_seed,
        effective_manifest
    )
    if not bool(solver_result.get("success", false)):
        return solver_result

    # 4. 角色三维实体组装
    var race_id := str(solver_result.get("race_id", ""))
    var origin_id := str(solver_result.get("origin_id", ""))
    var character_id := "CHAR_%s_%s_%d" % [creation_request.account_id, creation_request.world_id, creation_request.slot_id]
    var profile := _assemble_character_profile(character_id, character_name, solver_result)
    var _physiology := _assemble_physiology(race_id, solver_result.get("attributes", {}))
    var _wallet := _assemble_wallet(profile, solver_result.get("wallet", {}))

    # 5. 初始背包装备实体装配
    var loadout_result: Dictionary = StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(
        profile,
        race_id,
        origin_id,
        effective_manifest
    )
    if not bool(loadout_result.get("success", false)):
        return loadout_result

    # 6. 世界时空连续性锚定、历史片段只增追加与世界MOD锁前置固化
    var lock_source_packs: Array = gateway_fsm.get_active_mods() if gateway_fsm != null and not gateway_fsm.get_active_mods().is_empty() else effective_manifest.get("enabled_pack_ids", [])
    var continuity_result := _anchor_world_continuity(world_repository, creation_request.world_id, profile, effective_manifest, lock_source_packs)
    if not bool(continuity_result.get("success", false)):
        return continuity_result
    var world_instance: WorldInstance = continuity_result.get("world_instance", null)

    # 7. 物理落盘与账号槽位封面同步绑定
    var persist_result := _persist_slot_and_cover(creation_request, profile, race_id, origin_id, solver_result)
    if not bool(persist_result.get("success", false)):
        return persist_result

    # 8. 世界网关就绪角色回挂与状态跃迁
    var gateway_result: Dictionary = {}
    var is_gateway_attached := false
    if gateway_fsm != null:
        gateway_result = gateway_fsm.attach_ready_character(profile.character_id)
        is_gateway_attached = bool(gateway_result.get("success", false))
        if not is_gateway_attached:
            EventBusCore.get_instance().emit_log("warn", TemplateFormatter.format("WorldCharacterCreationOrchestrator: attach_ready_character failed: {code}", {"code": str(gateway_result.get("error_code", ""))}))

    # 9. 构造全景只读呈现信封
    var presentation := _build_presentation_envelope(creation_request, profile, solver_result, loadout_result, world_instance)

    # 10. 发布全域领域事件
    var event_payload: Dictionary = presentation.to_dto()
    EventBusCore.get_instance().emit_domain_event("character_creation.authoritative_completed", event_payload)

    return {
        "success": true,
        "character_id": profile.character_id,
        "character_name": profile.character_name,
        "slot_id": creation_request.slot_id,
        "world_id": creation_request.world_id,
        "profile": profile,
        "presentation": presentation,
        "adapted_mod_manifest": effective_manifest,
        "gateway_result": gateway_result,
        "gateway_attached": is_gateway_attached
    }

## 统一编排门面：权威创角 + 开局事件流生成 + 自动启动角色序章因果 DAG 会话
static func execute_creation_and_boot_prologue(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    gateway_fsm: WorldGatewayFSM = null,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    var creation_result := create_character_authoritative(creation_request, gateway_fsm, adapted_mod_manifest)
    if not bool(creation_result.get("success", false)):
        return creation_result

    var effective_manifest: Dictionary = creation_result.get("adapted_mod_manifest", {})
    var profile: CharacterProfile = creation_result.get("profile", null)
    var presentation: CharacterCreationPresentationDTO = creation_result.get("presentation", null)
    var opening := OpeningEventStreamDTO.new()
    opening.event_id = IdGenerator.next_id("EVT_OPENING_")
    opening.account_id = creation_request.account_id
    opening.slot_id = "SLOT_%02d" % creation_request.slot_id
    opening.world_id = creation_request.world_id
    opening.character_id = str(creation_result.get("character_id", ""))
    opening.character_name = str(creation_result.get("character_name", ""))
    opening.race_id = presentation.race_id if presentation != null else ""
    opening.is_first_time_creation = true
    var birth_region := ""
    var origins_catalog: Dictionary = effective_manifest.get("origins_catalog", {})
    var origin_entry: Dictionary = origins_catalog.get(presentation.origin_id if presentation != null else "", {})
    if presentation != null and presentation.prologue_preview is Dictionary:
        birth_region = str(presentation.prologue_preview.get("birth_region_id", ""))
    opening.starting_location_id = birth_region
    opening.opening_quest_line_id = str(origin_entry.get("opening_quest_line_id", ""))
    if presentation != null and not presentation.origin_id.is_empty():
        opening.narrative_context["origin_id"] = presentation.origin_id
    opening.timestamp_utc = int(Time.get_unix_time_from_system())

    EventBusCore.get_instance().emit_domain_event("opening_narrative.triggered", opening.to_dto())
    var prologue_boot := PrologueExecutionKernel.boot_character_prologue(opening, opening.race_id, effective_manifest, profile)
    if not bool(prologue_boot.get("success", false)):
        return prologue_boot

    var prologue_context: CharacterPrologueContext = prologue_boot.get("context", null)
    if prologue_context != null and presentation != null and not presentation.origin_id.is_empty():
        prologue_context.origin_id = presentation.origin_id
        prologue_context.runtime_placeholders["ORIGIN_ID"] = presentation.origin_id
        prologue_context.runtime_placeholders["origin_id"] = presentation.origin_id
    if prologue_context != null and profile != null:
        prologue_context.runtime_placeholders["INITIAL_GOLD"] = str(int(profile.personal_resources.get("gold", 0)))

    return {
        "success": true,
        "character_id": opening.character_id,
        "character_name": opening.character_name,
        "slot_id": opening.slot_id,
        "world_id": opening.world_id,
        "profile": profile,
        "presentation": presentation,
        "opening_event": opening,
        "prologue_context": prologue_context,
        "prologue_packet": prologue_boot.get("packet", null),
        "dag_session": prologue_boot.get("dag_session", null),
        "adapted_mod_manifest": effective_manifest,
        "gateway_result": creation_result.get("gateway_result", {})
    }

# ==============================================================================
# 二、输入校验与实体组装子函数 (CC <= 15, Depth <= 3)
# ==============================================================================

## 请求入参防篡改卫语句校验
static func _validate_request(creation_request: AuthoritativeCharacterCreationRequestDTO) -> Dictionary:
    if creation_request == null:
        return {"valid": false, "error_code": "INVALID_REQUEST", "message": "请求契约对象不可为空"}

    var character_name := creation_request.character_name.strip_edges()
    if character_name.is_empty():
        return {"valid": false, "error_code": "EMPTY_NAME", "message": "角色名称不可为空"}

    if character_name.length() < 2 or character_name.length() > 16:
        return {"valid": false, "error_code": "INVALID_NAME_LENGTH", "message": "角色名称长度必须在 2 到 16 之间"}

    for character_index in FORBIDDEN_CHARS.size():
        if character_name.contains(FORBIDDEN_CHARS[character_index]):
            return {"valid": false, "error_code": "FORBIDDEN_CHARACTERS", "message": "角色名称包含非法特殊字符"}

    if creation_request.account_id.strip_edges().is_empty():
        return {"valid": false, "error_code": "EMPTY_ACCOUNT_ID", "message": "账号标识不可为空"}

    if creation_request.world_id.strip_edges().is_empty():
        return {"valid": false, "error_code": "EMPTY_WORLD_ID", "message": "世界标识不可为空"}

    if creation_request.slot_id <= 0:
        return {"valid": false, "error_code": "EMPTY_SLOT_ID", "message": "槽位编号不可为空或小于等于0"}

    return {"valid": true, "character_name": character_name}

## 组装角色档案实体
static func _assemble_character_profile(character_id: String, character_name: String, solver_result: Dictionary) -> CharacterProfile:
    var profile := CharacterProfile.new()
    profile.character_id = character_id
    profile.character_name = character_name
    profile.attributes = (solver_result.get("attributes", {}) as Dictionary).duplicate(true)
    var resolved_race := str(solver_result.get("race_id", ""))
    profile.character_exclusive_progress["race"] = resolved_race
    profile.character_exclusive_progress["origin"] = str(solver_result.get("origin_id", ""))
    profile.growth_state = {
        "level": 1,
        "experience": 0,
        "origin_id": str(solver_result.get("origin_id", "")),
        "origin_name": str(solver_result.get("origin_name", "")),
        "race_id": str(solver_result.get("race_id", "")),
        "race_name": str(solver_result.get("race_name", "")),
        "gender": str(solver_result.get("gender", "")),
        "birth_region_id": str(solver_result.get("birth_region_id", "")),
        "selected_traits": (solver_result.get("selected_traits", []) as Array).duplicate(true),
        "traits_details": (solver_result.get("traits_details", []) as Array).duplicate(true)
    }
    return profile

## 组装生理档案
static func _assemble_physiology(race_id: String, attributes_map: Dictionary) -> CharacterPhysiologySheet:
    var physiology := CharacterPhysiologySheet.new()
    physiology.race_id = race_id
    for attribute_key in attributes_map.keys():
        physiology.set_level(str(attribute_key), int(attributes_map[attribute_key]))
    return physiology

## 组装钱包实体与个人资源映射
static func _assemble_wallet(profile: CharacterProfile, solver_wallet: Dictionary) -> CharacterWalletEntity:
    var wallet := CharacterWalletEntity.new()
    wallet.gold = int(solver_wallet.get("gold", 0))
    wallet.copper = wallet.gold * 100

    profile.personal_resources = {
        "gold": wallet.gold,
        "wallet": {
            "copper": wallet.copper,
            "silver": wallet.silver,
            "gold": wallet.gold,
            "platinum": wallet.platinum,
            "mana_monocrystals": wallet.mana_monocrystals
        },
        "reputation": int(solver_wallet.get("reputation", 0))
    }
    return wallet

# ==============================================================================
# 三、时空连续性、物理持久化与信封组装
# ==============================================================================

## 解析生效的多MOD合并清单（显式入参优先，否则回退读取网关已预检清单或活跃会话模组上下文）
static func _resolve_effective_manifest(
    gateway_fsm: WorldGatewayFSM,
    adapted_mod_manifest: Dictionary
) -> Dictionary:
    if not adapted_mod_manifest.is_empty():
        return adapted_mod_manifest
    if gateway_fsm != null:
        return gateway_fsm.get_adapted_mod_manifest()
    return WorldSessionRuntimeService.get_adapted_mod_manifest()

## 锚定目标世界时空、只增追加出生历史片段并前置固化世界MOD锁文件
static func _anchor_world_continuity(
    world_repository: WorldArchiveRepository,
    world_id: String,
    profile: CharacterProfile,
    effective_manifest: Dictionary = {},
    lock_source_packs: Array = []
) -> Dictionary:
    var world_instance: WorldInstance = world_repository.load_world(world_id)
    if world_instance == null:
        return {"success": false, "error_code": "WORLD_INSTANCE_LOAD_FAILED", "message": GameConfig.msg_fmt("character_creation", "world_instance_load_failed", {"world_id": world_id})}

    var birth_fragment: Dictionary = {
        "type": "CHARACTER_BORN",
        "character_id": profile.character_id,
        "character_name": profile.character_name,
        "world_time": (world_instance.world_time as Dictionary).duplicate(true)
    }
    world_instance.append_history_fragment(birth_fragment)
    var save_world_result: Dictionary = world_repository.save_world(world_instance)
    if not bool(save_world_result.get("success", false)):
        return {"success": false, "error_code": "WORLD_SAVE_FAILED", "message": "保存世界时空连续性失败"}

    var lock_packs: Array = lock_source_packs if not lock_source_packs.is_empty() else effective_manifest.get("enabled_pack_ids", [])
    if lock_packs.is_empty() and effective_manifest.get("applied_packs") is Array:
        lock_packs = effective_manifest.get("applied_packs", [])
    var resolved_lock_packs: Array[Dictionary] = WorldModLockMetadataHelper.resolve_lock_pack_entries(lock_packs, effective_manifest)
    WorldModAffinityManager.new().save_world_mod_lock(world_id, resolved_lock_packs)

    return {"success": true, "world_instance": world_instance}

## 执行槽位物理存盘与账号封面原子绑定
static func _persist_slot_and_cover(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    profile: CharacterProfile,
    race_id: String,
    origin_id: String,
    solver_result: Dictionary
) -> Dictionary:
    var slot_name := "SLOT_%02d" % creation_request.slot_id
    var save_payload: Dictionary = {
        "version": 1,
        "data": {
            "character_info": {
                "id": profile.character_id,
                "name": profile.character_name,
                "race": race_id,
                "origin": origin_id,
                "gender": str(solver_result.get("gender", "")),
                "world_id": creation_request.world_id
            },
            "profile": profile.serialize(),
            "physiology": (solver_result.get("physiology", {}) as Dictionary).duplicate(true),
            "wallet": (profile.personal_resources.get("wallet", {}) as Dictionary).duplicate(true)
        }
    }
    var save_data_access_result: Dictionary = SaveDataAccessLayer.save_game(slot_name, save_payload)

    var account_repository := AccountRepository.get_instance()
    if account_repository != null and not account_repository.is_loaded():
        account_repository.load_all()
    var account: AccountProfile = account_repository.find_by_id(creation_request.account_id) if account_repository != null else null
    if account != null:
        var slot_summary := SaveSlotDTO.new()
        slot_summary.slot_id = slot_name
        slot_summary.character_name = profile.character_name
        slot_summary.world_id = creation_request.world_id
        slot_summary.world_slot_status = "OCCUPIED"
        slot_summary.is_fallen = false
        slot_summary.last_saved_time_utc = int(Time.get_unix_time_from_system())
        slot_summary.save_file_sha256 = str(save_data_access_result.get("sha256", ""))
        slot_summary.character_profile = profile
        account.bind_character_to_slot(slot_name, slot_summary)
        account.bind_world_slot(creation_request.world_id, slot_name)
        account_repository.save_account(account)

    return {"success": true, "slot_name": slot_name, "save_res": save_data_access_result}

## 组装全景只读呈现信封
static func _build_presentation_envelope(
    creation_request: AuthoritativeCharacterCreationRequestDTO,
    profile: CharacterProfile,
    solver_result: Dictionary,
    loadout_result: Dictionary,
    world_instance: WorldInstance
) -> CharacterCreationPresentationDTO:
    var presentation := CharacterCreationPresentationDTO.new()
    presentation.character_id = profile.character_id
    presentation.character_name = profile.character_name
    presentation.origin_id = str(solver_result.get("origin_id", ""))
    presentation.origin_name = str(solver_result.get("origin_name", ""))
    presentation.origin_desc = str(solver_result.get("origin_desc", ""))
    presentation.race_id = str(solver_result.get("race_id", ""))
    presentation.race_name = str(solver_result.get("race_name", ""))
    presentation.gender = str(solver_result.get("gender", ""))
    presentation.attributes_radar = (solver_result.get("attributes", {}) as Dictionary).duplicate(true)
    presentation.physiology_summary = (solver_result.get("physiology", {}) as Dictionary).duplicate(true)
    presentation.wallet_summary = (solver_result.get("wallet", {}) as Dictionary).duplicate(true)

    var starter_items: Array[Dictionary] = []
    var raw_starter_items: Array = loadout_result.get("starter_items_summary", [])
    starter_items.assign(raw_starter_items)
    presentation.starter_equipment = starter_items

    presentation.world_chronicle = {
        "world_id": creation_request.world_id,
        "world_time": (world_instance.world_time as Dictionary).duplicate(true),
        "history_fragments_count": world_instance.history_fragments.size()
    }
    presentation.prologue_preview = {
        "birth_region_id": str(solver_result.get("birth_region_id", "")),
        "base_factions": (solver_result.get("base_factions", {}) as Dictionary).duplicate(true),
        "selected_traits": (solver_result.get("selected_traits", []) as Array).duplicate(true)
    }
    return presentation
