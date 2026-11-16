# ==============================================================================
# 模块归属: 测试支撑 (Tests · Support Fixtures)
# 文件路径: res://tests/support/synthetic_chrono_mod_fixture.gd
# 架构定位: Test Fixture Helper / Synthetic Non-Kalar MOD Stack Generator
# 依赖与触发: 上游: TestPluginModCompositionAndIsolation | 下游: AssetPathResolver, TestCase, TestTier3ContentOverrideHelper | 配置: 无
# 职责说明: 在临时沙盒目录构建完全脱离卡拉尔设定的合成异世界 TotalConversion + ContentAddon MOD 叠层，并提供隔离清理夹具。
# 退出语义与设计依据: 测试夹具共享与沙盒隔离契约
# ==============================================================================

## SyntheticChronoModFixture：非卡拉尔合成 Chrono Spire 双层 MOD 测试夹具生成与清理器
class_name SyntheticChronoModFixture
extends RefCounted

const SANDBOX_MODS_ROOT: String = "user://test_sandbox_phase130_composition/"


## 清理临时资产路径映射、卸载已激活 MOD 叠层并移除沙盒目录
static func cleanup_sandbox() -> void:
    AssetPathResolver.reset_for_tests()
    TestCase.unmount_mod_overlay_for_test()
    TestTier3ContentOverrideHelper.cleanup_directory_recursive(SANDBOX_MODS_ROOT)


## 构造非卡拉尔 TotalConversion(mod_chrono_spire) + ContentAddon(mod_chrono_relics) 双层 MOD 目录树
static func write_synthetic_chrono_stack() -> void:
    var base_dir := SANDBOX_MODS_ROOT.path_join("mod_chrono_spire")
    TestTier3ContentOverrideHelper.write_json_file(base_dir.path_join("pack.json"), {
        "pack_id": "mod_chrono_spire",
        "pack_name": "Chrono Spire Total Conversion",
        "version": "1.0.0",
        "author": "SynthStudio",
        "pack_profile": "TOTAL_CONVERSION",
        "mod_tier": "TOTAL_CONVERSION",
        "priority": 200,
        "is_active": true,
        "ui_capabilities": {
            "origin_selection_mode": "ALLOW_MANUAL",
            "trait_selection_mode": "ALLOW_MANUAL",
            "allow_attribute_reroll": true
        },
        "custom_races": {
            "AUTOMATON": {
                "race_id": "AUTOMATON",
                "name": "发条构装体",
                "initial_location_id": "CHRONO_SPIRE_DECK",
                "starter_kit_id": "KIT_AUTOMATON_SCRIBE"
            }
        },
        "custom_origins": [
            {
                "origin_id": "CLOCKWORK_SCRIBE",
                "name": "时钟塔铭文士",
                "desc": "来自发条尖塔的齿轮记录者",
                "race_id": "AUTOMATON",
                "birth_region_id": "CHRONO_SPIRE_DECK",
                "weight": 40,
                "initial_gold": 220,
                "attribute_bonus": {"INT": 2, "SPR": 1},
                "starter_kit_id": "KIT_AUTOMATON_SCRIBE",
                "prologue_dag_id": "DAG_CHRONO_AWAKEN"
            }
        ],
        "custom_traits": {
            "BRASS_HEART": {"name": "黄铜核心", "type": "POSITIVE", "cost": 2, "desc": "充能稳定"},
            "OIL_LEAK": {"name": "机油渗漏", "type": "NEGATIVE", "cost": -2, "desc": "消耗偏快"}
        },
        "paired_presets": [
            {"positive": "BRASS_HEART", "negative": "OIL_LEAK", "weight": 40}
        ],
        "custom_starter_kits": {
            "KIT_AUTOMATON_SCRIBE": {
                "initial_gold": 220,
                "display_weapon": "CHRONO:EQUIP:FOCUS:ETHER_LENS",
                "initial_items": [
                    {"canonical_id": "CHRONO:EQUIP:FOCUS:ETHER_LENS", "count": 1}
                ]
            }
        },
        "custom_i18n": {
            "narrative.chrono.awakening": "【发条苏醒】{PLAYER_NAME}在齿轮尖塔观测室睁开光学镜片。",
            "narrative.chrono.completed": "【齿轮起航】{PLAYER_NAME}带着晶体钥匙踏入星晷长廊，序章结束！"
        }
    })
    TestTier3ContentOverrideHelper.write_json_file(base_dir.path_join("dag_graphs/DAG_CHRONO_AWAKEN.json"), {
        "dag_id": "DAG_CHRONO_AWAKEN",
        "entry_node_id": "NODE_CHRONO_BOOT",
        "terminal_node_id": "NODE_CHRONO_DEPART",
        "nodes": {
            "NODE_CHRONO_BOOT": {"node_type": "START_ENTRY", "narrative_key": "narrative.chrono.awakening"},
            "NODE_CHRONO_DEPART": {
                "node_type": "TERMINAL_EXIT",
                "narrative_key": "narrative.chrono.completed",
                "required_prerequisites": ["NODE_CHRONO_BOOT"],
                "mutations_on_complete": [{"type": "PrologueCompleted", "dag_id": "DAG_CHRONO_AWAKEN"}]
            }
        },
        "edges": [{"from": "NODE_CHRONO_BOOT", "to": "NODE_CHRONO_DEPART"}]
    })
    TestTier3ContentOverrideHelper.write_json_file(base_dir.path_join("content/items/chrono_items.json"), {
        "override_mode": "MERGE",
        "items": [
            {
                "canonical_id": "CHRONO:EQUIP:FOCUS:ETHER_LENS",
                "english_name": "ether_lens",
                "loc_name_key": "item.ether_lens.name",
                "category_major": "EQUIPMENT",
                "category_minor": "WEAPON_BLADE",
                "tier_rank": 2,
                "default_mass_kg": 0.9,
                "default_volume_slots": 1,
                "base_market_value": 180
            }
        ]
    })
    TestTier3ContentOverrideHelper.write_json_file(base_dir.path_join("content/world/chrono_world.json"), {
        "override_mode": "MERGE",
        "worlds_catalog": {
            "WORLD_CHRONO_SP_01": {
                "world_id": "WORLD_CHRONO_SP_01",
                "display_name": "发条尖塔纪元",
                "mode": 1,
                "default_location_id": "CHRONO_SPIRE_DECK"
            }
        }
    })

    var addon_dir := SANDBOX_MODS_ROOT.path_join("mod_chrono_relics")
    TestTier3ContentOverrideHelper.write_json_file(addon_dir.path_join("pack.json"), {
        "pack_id": "mod_chrono_relics",
        "pack_name": "Chrono Relics Addon",
        "version": "1.0.0",
        "author": "SynthStudio",
        "pack_profile": "CONTENT_ADDON",
        "mod_tier": "EXPANSION",
        "priority": 250,
        "dependencies": ["mod_chrono_spire"],
        "is_active": true
    })
    TestTier3ContentOverrideHelper.write_json_file(addon_dir.path_join("content/items/addon_items.json"), {
        "override_mode": "MERGE",
        "items": [
            {
                "canonical_id": "CHRONO:CONSUM:POTION:OIL_FLASK",
                "english_name": "oil_flask",
                "loc_name_key": "item.oil_flask.name",
                "category_major": "CONSUMABLE",
                "category_minor": "ALCHEMY",
                "tier_rank": 1,
                "default_mass_kg": 0.4,
                "default_volume_slots": 1,
                "base_market_value": 45
            }
        ]
    })


## 校验 GameConfig.items.mod_overrides.items 中是否存在指定规范物品 ID
static func has_override_item(canonical_id: String) -> bool:
    var override_items: Array = GameConfig.get_array("items.mod_overrides", "items", [])
    for item_entry in override_items:
        if item_entry is Dictionary and str((item_entry as Dictionary).get("canonical_id", "")) == canonical_id:
            return true
    return false
