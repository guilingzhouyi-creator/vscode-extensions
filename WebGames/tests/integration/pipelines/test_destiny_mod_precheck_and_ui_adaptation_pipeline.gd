# ==============================================================================
# 模块归属: 集成测试层 (Integration · 单机显性MOD预检与命途UI多包列表适配流水线)
# 文件路径: res://tests/integration/pipelines/test_destiny_mod_precheck_and_ui_adaptation_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: ModPrecheckAndAdaptationSolver, WorldGatewayFSM, WorldCharacterCreationOrchestrator, AccountEntryView, SnapshotInjectionSolver, PrologueDagRegistry, WorldModAffinityManager | 配置: config/domains/*.json | 信号: 无直接监听
# 职责说明: 全链路验证单机显性MOD合规预检拦截、多MOD列表协同合并、冲突检测阻断、前端AccountEntryView受控UI解锁与载荷构建、后端受控权威创角与初始装备入包及序章路由与世界锁前置固化、以及SnapshotInjectionSolver虚拟MOD水化与对称清理。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name TestDestinyModPrecheckAndUiAdaptationPipeline
extends TestCase

const TEST_SANDBOX_DIR: String = "user://test_sandbox_dmp_pipeline/"
const TEST_WORLD_ID: String = "WORLD_DMP_TEST_01"
const TEST_ACCOUNT_ID: String = "ACC_DMP_TEST_01"

# ==============================================================================
# 一、测试套件总入口与沙箱环境生命周期
# ==============================================================================

## 执行全量流水线测试 (TC-DMP-01 ~ TC-DMP-06)
static func run_all_tests() -> Dictionary:
    var results: Array = []
    results.append(test_single_mod_compliance_precheck_and_interception())
    results.append(test_multi_mod_collaborative_list_merging())
    results.append(test_multi_mod_conflict_detection_and_blocking())
    results.append(test_frontend_snapshot_controlled_ui_unlock_and_lock())
    results.append(test_backend_authoritative_creation_and_world_lock_closed_loop())
    results.append(test_harness_virtual_mod_injection_and_teardown())

    var all_passed := true
    var passed_cnt := 0
    for r in results:
        if bool(r.get("passed", false)):
            passed_cnt += 1
        else:
            all_passed = false

    return {
        "domain": "Destiny MOD Precheck & UI Adaptation Pipeline",
        "all_passed": all_passed,
        "passed_count": passed_cnt,
        "total_count": results.size(),
        "results": results
    }

## 装配纯净隔离沙箱
static func _setup_environment() -> void:
    WorldArchiveRepository.reset_for_tests()
    AccountRepository.reset_for_tests()
    SaveDataAccessLayer.reset_for_tests()
    RuntimeModeGate.reset_for_tests()

    var world_repo := WorldArchiveRepository.get_instance()
    world_repo.set_custom_root_dir(TEST_SANDBOX_DIR + "worlds/")
    world_repo.set_custom_catalog_path(TEST_SANDBOX_DIR + "worlds/world_catalog.json")
    world_repo.load_all()
    world_repo.create_world(TEST_WORLD_ID, "命途多包测试界域")

    var acc_repo := AccountRepository.get_instance()
    acc_repo.set_custom_registry_path(TEST_SANDBOX_DIR + "accounts/account_registry.json")
    acc_repo.load_all()

    var acc := AccountProfileAggregate.new()
    acc.account_id = TEST_ACCOUNT_ID
    acc.username = "DestinyModTester"
    acc_repo.save_account(acc)

## 对称清理沙箱
static func _teardown_environment() -> void:
    var lock_mgr := WorldModAffinityManager.new()
    var lock_path: String = lock_mgr.get_lock_file_path(TEST_WORLD_ID)
    if not lock_path.is_empty() and FileAccess.file_exists(lock_path):
        DirAccess.remove_absolute(lock_path)
    var world_repo := WorldArchiveRepository.get_instance()
    if world_repo.has_world(TEST_WORLD_ID):
        world_repo.delete_world(TEST_WORLD_ID)
    WorldArchiveRepository.reset_for_tests()
    AccountRepository.reset_for_tests()
    SaveDataAccessLayer.reset_for_tests()
    RuntimeModeGate.reset_for_tests()

# ==============================================================================
# 二、测试夹具数据构造器
# ==============================================================================

## 构造合规命途扩展包 A（观星学徒 + 星眸洞察/夜盲症 + 秘银长剑套件 + 专属序章路由）
static func _make_compliant_mod_a() -> Dictionary:
    return {
        "pack_id": "mod_astro_scholar",
        "pack_name": "星象学者命途扩展包",
        "version": "1.0.0",
        "author": "AstroStudio",
        "priority": 100,
        "ui_capabilities": {
            "origin_selection_mode": "ALLOW_MANUAL",
            "trait_selection_mode": "ALLOW_MANUAL",
            "allow_attribute_reroll": true
        },
        "custom_origins": [
            {
                "origin_id": "ASTRO_SCHOLAR",
                "name": "观星学徒",
                "desc": "自幼在银月尖塔观测星轨的学者",
                "race_id": "HIGH_ELF",
                "birth_region_id": "SILVER_MOON_SPIRE",
                "weight": 35,
                "initial_gold": 120,
                "attribute_bonus": {"INT": 2, "SPR": 1, "STR": -1},
                "starter_kit_id": "KIT_ASTRO_SCHOLAR",
                "prologue_dag_id": "DAG_PROLOGUE_ASTRO_01"
            }
        ],
        "custom_traits": {
            "STAR_VISION": {
                "name": "星眸洞察",
                "type": "POSITIVE",
                "cost": 3,
                "desc": "夜观星象提升感知与法术洞察"
            },
            "NIGHT_BLINDNESS": {
                "name": "幽暗眩光",
                "type": "NEGATIVE",
                "cost": -3,
                "desc": "受星辉反噬在深渊暗处视野受限"
            }
        },
        "paired_presets": [
            {
                "positive": "STAR_VISION",
                "negative": "NIGHT_BLINDNESS",
                "weight": 40
            }
        ],
        "custom_starter_kits": {
            "KIT_ASTRO_SCHOLAR": {
                "initial_gold": 80,
                "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD",
                "initial_items": [
                    {"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "count": 1},
                    {"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "count": 2}
                ]
            }
        },
        "custom_routing_rules": [
            {
                "match_condition": {"origin_id": "ASTRO_SCHOLAR"},
                "target_dag_id": "DAG_PROLOGUE_ASTRO_01"
            }
        ]
    }

## 构造合规命途扩展包 B（符文锻造师 + 符文之心/魔力过载 + 铁剑套件）
static func _make_compliant_mod_b() -> Dictionary:
    return {
        "pack_id": "mod_rune_forger",
        "pack_name": "矮人符文匠师扩展包",
        "version": "1.1.0",
        "author": "ForgeGuild",
        "priority": 110,
        "ui_capabilities": {
            "origin_selection_mode": "INHERIT",
            "trait_selection_mode": "INHERIT",
            "allow_attribute_reroll": false
        },
        "custom_origins": [
            {
                "origin_id": "RUNE_FORGER",
                "name": "符文锻造师",
                "desc": "深炉堡垒的秘银铭文学徒",
                "race_id": "MOUNTAIN_DWARF",
                "birth_region_id": "IRON_FORGE_CITADEL",
                "weight": 30,
                "initial_gold": 150,
                "attribute_bonus": {"STR": 2, "CON": 2, "AGI": -1},
                "starter_kit_id": "KIT_RUNE_FORGER",
                "prologue_dag_id": "DAG_PROLOGUE_RUNE_01"
            }
        ],
        "custom_traits": {
            "RUNIC_HEART": {
                "name": "符文熔炉之心",
                "type": "POSITIVE",
                "cost": 2,
                "desc": "体魄强健且抗热"
            },
            "MANA_OVERLOAD": {
                "name": "魔力淤塞",
                "type": "NEGATIVE",
                "cost": -2,
                "desc": "体内魔力运转滞重"
            }
        },
        "paired_presets": [
            {
                "positive": "RUNIC_HEART",
                "negative": "MANA_OVERLOAD",
                "weight": 35
            }
        ],
        "custom_starter_kits": {
            "KIT_RUNE_FORGER": {
                "initial_gold": 60,
                "display_weapon": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD",
                "initial_items": [
                    {"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD", "count": 1}
                ]
            }
        }
    }

# ==============================================================================
# 三、六大核心端到端测试用例实现 (TC-DMP-01 ~ TC-DMP-06)
# ==============================================================================

## TC-DMP-01: 单机显性 MOD 合规预检拦截（合规包通过 vs 超标属性与失衡天赋阻断）
static func test_single_mod_compliance_precheck_and_interception() -> Dictionary:
    var mod_ok: Dictionary = _make_compliant_mod_a()
    var res_ok: Dictionary = ModPrecheckAndAdaptationSolver.precheck_single_mod(mod_ok)
    var ok_valid: bool = bool(res_ok.get("valid", false)) and str(res_ok.get("error_code", "")) == ""

    var mod_over_stat: Dictionary = _make_compliant_mod_a()
    mod_over_stat["pack_id"] = "mod_cheat_stats"
    mod_over_stat["custom_origins"] = [
        {
            "origin_id": "GOD_ EMPEROR",
            "name": "超模神皇",
            "attribute_bonus": {"STR": 5, "CON": 5, "INT": 5},
            "initial_gold": 100
        }
    ]
    var res_stat: Dictionary = ModPrecheckAndAdaptationSolver.precheck_single_mod(mod_over_stat)
    var ok_stat_blocked: bool = (not bool(res_stat.get("valid", true))) \
        and str(res_stat.get("error_code", "")) == "ERR_DESTINY_STAT_BUDGET_EXCEEDED"

    var mod_imbalance_trait: Dictionary = _make_compliant_mod_a()
    mod_imbalance_trait["pack_id"] = "mod_cheat_trait"
    mod_imbalance_trait["custom_traits"] = {
        "CHEAT_BLESSING": {"name": "无代价神赐", "type": "POSITIVE", "cost": 5},
        "TINY_FLAW": {"name": "微瑕", "type": "NEGATIVE", "cost": -1}
    }
    mod_imbalance_trait["paired_presets"] = [
        {"positive": "CHEAT_BLESSING", "negative": "TINY_FLAW", "weight": 50}
    ]
    var res_trait: Dictionary = ModPrecheckAndAdaptationSolver.precheck_single_mod(mod_imbalance_trait)
    var ok_trait_blocked: bool = (not bool(res_trait.get("valid", true))) \
        and str(res_trait.get("error_code", "")) == "ERR_DESTINY_CAUSALITY_IMBALANCE"

    var gw := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
    gw.context.selected_mode = WorldGatewayModel.GameMode.MULTIPLAYER
    var mp_reject: Dictionary = gw.precheck_and_configure_single_player_mods([mod_ok])
    var ok_mp_rejected: bool = (not bool(mp_reject.get("success", true))) \
        and str(mp_reject.get("error_code", "")) == AntiBridgeGuard.SECURITY_ERR_MULTIPLAYER_MOD_POISONING

    var passed: bool = ok_valid and ok_stat_blocked and ok_trait_blocked and ok_mp_rejected
    return {
        "test": "TC-DMP-01: 单机显性 MOD 合规预检拦截",
        "passed": passed
    }

## TC-DMP-02: 多 MOD 列表清单式协同合并适配（Vanilla + MOD A + MOD B 全量保留）
static func test_multi_mod_collaborative_list_merging() -> Dictionary:
    var mod_a: Dictionary = _make_compliant_mod_a()
    var mod_b: Dictionary = _make_compliant_mod_b()

    var gw := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
    gw.context.selected_mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
    var res: Dictionary = gw.precheck_and_configure_single_player_mods(
        [mod_a, mod_b],
        ["mod_astro_scholar", "mod_rune_forger"]
    )
    var ok_success: bool = bool(res.get("success", false))

    var manifest: Dictionary = gw.get_adapted_mod_manifest()
    var origins_cat: Dictionary = manifest.get("origins_catalog", {})
    var has_vanilla_origin: bool = origins_cat.has("IMPERIAL_NOBLE")
    var has_mod_a_origin: bool = origins_cat.has("ASTRO_SCHOLAR")
    var has_mod_b_origin: bool = origins_cat.has("RUNE_FORGER")

    var kits: Dictionary = manifest.get("starter_kits", {})
    var has_both_kits: bool = kits.has("KIT_ASTRO_SCHOLAR") and kits.has("KIT_RUNE_FORGER")

    var ui_snap: Dictionary = gw.get_creation_ui_snapshot()
    var ui_origins: Array = ui_snap.get("available_origins", [])
    var ui_traits: Array = ui_snap.get("available_trait_pairs", [])
    var ok_ui_lists: bool = ui_origins.size() >= 3 and ui_traits.size() >= 3

    var passed: bool = ok_success and has_vanilla_origin and has_mod_a_origin and has_mod_b_origin and has_both_kits and ok_ui_lists
    return {
        "test": "TC-DMP-02: 多 MOD 列表清单式协同合并适配",
        "passed": passed
    }

## TC-DMP-03: 多 MOD 冲突检测阻断（同名 origin_id 冲突与 UI 策略互斥冲突）
static func test_multi_mod_conflict_detection_and_blocking() -> Dictionary:
    var mod_1: Dictionary = _make_compliant_mod_a()
    var mod_2: Dictionary = _make_compliant_mod_b()
    mod_2["custom_origins"] = [
        {
            "origin_id": "ASTRO_SCHOLAR",
            "name": "重名观星者",
            "race_id": "HUMAN",
            "attribute_bonus": {"INT": 1},
            "initial_gold": 50
        }
    ]

    var gw := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
    gw.context.selected_mode = WorldGatewayModel.GameMode.SINGLE_PLAYER
    var dup_res: Dictionary = gw.precheck_and_configure_single_player_mods([mod_1, mod_2])
    var ok_dup_blocked: bool = (not bool(dup_res.get("success", true))) \
        and str(dup_res.get("error_code", "")) == "ERR_MOD_DUPLICATE_ID_CONFLICT" \
        and not (dup_res.get("conflicts", []) as Array).is_empty()

    var mod_manual: Dictionary = _make_compliant_mod_a()
    var mod_force_random: Dictionary = _make_compliant_mod_b()
    mod_force_random["ui_capabilities"] = {
        "origin_selection_mode": "FORCE_RANDOM",
        "trait_selection_mode": "INHERIT",
        "allow_attribute_reroll": false
    }
    var policy_res: Dictionary = gw.precheck_and_configure_single_player_mods([mod_manual, mod_force_random])
    var ok_policy_blocked: bool = (not bool(policy_res.get("success", true))) \
        and str(policy_res.get("error_code", "")) == "ERR_MOD_UI_POLICY_CONFLICT" \
        and gw.get_adapted_mod_manifest().is_empty()

    var passed: bool = ok_dup_blocked and ok_policy_blocked
    return {
        "test": "TC-DMP-03: 多 MOD 冲突检测阻断",
        "passed": passed
    }

## TC-DMP-04: 前端 AccountEntryView 快照驱动受控 UI 解锁与锁定
static func test_frontend_snapshot_controlled_ui_unlock_and_lock() -> Dictionary:
    var view := AccountEntryView.new()
    view.form_character_name = "星轨行者"

    # 1. 原生默认状态：严禁自选身世、自选天赋与属性重随
    var locked_origin_ok: bool = not view.select_custom_origin("ASTRO_SCHOLAR")
    var locked_trait_ok: bool = not view.select_custom_trait("STAR_VISION")
    var locked_reroll_ok: bool = not view.trigger_mod_attribute_reroll()
    var locked_payload: Dictionary = view.build_creation_request_payload()
    var locked_extra_empty: bool = (locked_payload.get("extra_custom_fields", {}) as Dictionary).is_empty()

    # 2. 注入合规多MOD预检生成的 creation_ui_snapshot
    var adapt_res: Dictionary = ModPrecheckAndAdaptationSolver.precheck_and_adapt_mod_list([
        _make_compliant_mod_a(),
        _make_compliant_mod_b()
    ])
    var ui_snap: Dictionary = adapt_res.get("creation_ui_snapshot", {})
    view.apply_snapshot({"creation_ui_snapshot": ui_snap})

    var unlocked_origin_ok: bool = view.select_custom_origin("ASTRO_SCHOLAR")
    var unlocked_trait_ok: bool = view.select_custom_trait("STAR_VISION")
    var unlocked_reroll_ok: bool = view.trigger_mod_attribute_reroll()
    var invalid_origin_blocked: bool = not view.select_custom_origin("NON_EXISTENT_ORIGIN")

    var unlocked_payload: Dictionary = view.build_creation_request_payload()
    var extra: Dictionary = unlocked_payload.get("extra_custom_fields", {})
    var payload_fields_ok: bool = str(extra.get("selected_origin_id", "")) == "ASTRO_SCHOLAR" \
        and str(extra.get("selected_positive_trait", "")) == "STAR_VISION" \
        and int(extra.get("reroll_nonce", 0)) == 1

    view.free()

    var passed: bool = locked_origin_ok and locked_trait_ok and locked_reroll_ok and locked_extra_empty \
        and unlocked_origin_ok and unlocked_trait_ok and unlocked_reroll_ok and invalid_origin_blocked and payload_fields_ok
    return {
        "test": "TC-DMP-04: 前端 AccountEntryView 快照驱动受控 UI 解锁与锁定",
        "passed": passed
    }

## TC-DMP-05: 后端受控权威创角、专属初始装备入包、专属序章路由与 world_mod_lock.json 前置锁定全链路闭环
static func test_backend_authoritative_creation_and_world_lock_closed_loop() -> Dictionary:
    _setup_environment()

    var gw := WorldGatewayFSM.new(TEST_ACCOUNT_ID)
    gw.enter_gateway()
    var acc_repo := AccountRepository.get_instance()
    var acc: AccountProfileAggregate = acc_repo.find_by_id(TEST_ACCOUNT_ID)
    gw.select_mode_for_account(WorldGatewayModel.GameMode.SINGLE_PLAYER, acc, {}, TEST_WORLD_ID, "SLOT_01")

    var precheck_res: Dictionary = gw.precheck_and_configure_single_player_mods([
        _make_compliant_mod_a(),
        _make_compliant_mod_b()
    ])
    var ok_precheck: bool = bool(precheck_res.get("success", false))

    var req := AuthoritativeCharacterCreationRequestDTO.new()
    req.account_id = TEST_ACCOUNT_ID
    req.world_id = TEST_WORLD_ID
    req.slot_id = 1
    req.character_name = "阿斯特拉"
    req.request_seed = 70007
    req.extra_custom_fields = {
        "selected_origin_id": "ASTRO_SCHOLAR",
        "selected_positive_trait": "STAR_VISION",
        "reroll_nonce": 2
    }

    var create_res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req, gw)
    var ok_created: bool = bool(create_res.get("success", false))
    var profile: CharacterProfile = create_res.get("profile", null)
    var ok_origin_and_trait: bool = profile != null \
        and str(profile.growth_state.get("origin_id", "")) == "ASTRO_SCHOLAR" \
        and str(profile.growth_state.get("race_id", "")) == "HIGH_ELF" \
        and (profile.growth_state.get("selected_traits", []) as Array).has("STAR_VISION")

    var pres: CharacterCreationPresentationDTO = create_res.get("presentation", null)
    var ok_equip: bool = pres != null and not pres.starter_equipment.is_empty()

    var dag: NarrativeDAGGraphDTO = PrologueDagRegistry.resolve_prologue_dag(
        "HIGH_ELF",
        "ASTRO_SCHOLAR",
        gw.get_adapted_mod_manifest()
    )
    var ok_dag: bool = dag != null and dag.dag_id == "DAG_PROLOGUE_ASTRO_01"

    var lock_data: Dictionary = WorldModAffinityManager.new().load_world_mod_lock(TEST_WORLD_ID)
    var ok_lock: bool = bool(lock_data.get("exists", false)) \
        and (lock_data.get("locked_packs", []) as Array).size() == 2

    # 验证未启用自选时后端零信任剥离伪造自选字段
    var req_unauth := AuthoritativeCharacterCreationRequestDTO.new()
    req_unauth.account_id = TEST_ACCOUNT_ID
    req_unauth.world_id = TEST_WORLD_ID
    req_unauth.slot_id = 2
    req_unauth.character_name = "原生旅者"
    req_unauth.request_seed = 70008
    req_unauth.extra_custom_fields = {
        "selected_origin_id": "ASTRO_SCHOLAR",
        "selected_positive_trait": "STAR_VISION"
    }
    var unauth_res: Dictionary = WorldCharacterCreationOrchestrator.create_character_authoritative(req_unauth, null, {})
    var unauth_profile: CharacterProfile = unauth_res.get("profile", null)
    var ok_zero_trust: bool = unauth_profile != null \
        and str(unauth_profile.growth_state.get("origin_id", "")) != "ASTRO_SCHOLAR"

    _teardown_environment()

    var passed: bool = ok_precheck and ok_created and ok_origin_and_trait and ok_equip and ok_dag and ok_lock and ok_zero_trust
    return {
        "test": "TC-DMP-05: 后端受控权威创角、装备水化、序章路由与世界锁前置固化闭环",
        "passed": passed
    }

## TC-DMP-06: 工程方 SnapshotInjectionSolver 内存虚拟 MOD 一键注入水化与 teardown 对称清理验证
static func test_harness_virtual_mod_injection_and_teardown() -> Dictionary:
    var snap_payload: Dictionary = {
        "snapshot_id": "SNAP_VIRTUAL_DESTINY_MODS_01",
        "account_id": "ACC_HARNESS_DMP_01",
        "username": "HarnessModTester",
        "character_id": "CHAR_HARNESS_DMP_01",
        "character_name": "HarnessAstro",
        "race_id": "HIGH_ELF",
        "world_id": "WORLD_DEFAULT_SP_01",
        "slot_id": "SLOT_01",
        "virtual_destiny_mods": [
            _make_compliant_mod_a(),
            _make_compliant_mod_b()
        ],
        "enabled_mod_ids": ["mod_astro_scholar", "mod_rune_forger"]
    }

    var inject_res: Dictionary = SnapshotInjectionSolver.inject_and_hydrate(snap_payload)
    var ok_inject: bool = bool(inject_res.get("success", false))
    var mod_adapt: Dictionary = inject_res.get("mod_adaptation", {})
    var ok_adapted: bool = bool(mod_adapt.get("success", false)) \
        and not (mod_adapt.get("adapted_manifest", {}) as Dictionary).is_empty() \
        and not (mod_adapt.get("creation_ui_snapshot", {}) as Dictionary).is_empty() \
        and not SnapshotInjectionSolver.get_injected_mod_adaptation().is_empty()

    var ctx = inject_res.get("session_context", null)
    SnapshotInjectionSolver.teardown_snapshot(ctx)
    var ok_teardown_clean: bool = SnapshotInjectionSolver.get_injected_mod_adaptation().is_empty()

    var passed: bool = ok_inject and ok_adapted and ok_teardown_clean
    return {
        "test": "TC-DMP-06: 工程方 SnapshotInjectionSolver 内存虚拟 MOD 水化与对称清理",
        "passed": passed
    }
