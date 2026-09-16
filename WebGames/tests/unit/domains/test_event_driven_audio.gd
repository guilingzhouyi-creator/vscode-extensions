# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 39 事件驱动音频系统单元测试
# 文件路径: res://tests/unit/domains/test_event_driven_audio.gd
# ==============================================================================
class_name TestEventDrivenAudioDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 39: 事件驱动音频调度与空间混音系统"

	results.append(_test_spatial_distance_attenuation_and_pan())
	results.append(_test_concurrency_polyphony_limiter())
	results.append(_test_four_track_bus_routing())
	# Phase 53 L9-a 新增：并发水位显式释放路径
	results.append(_test_sound_count_release_bounded())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_spatial_distance_attenuation_and_pan() -> Dictionary:
	var cmd = AudioDispatchCommandDTO.new(
		"sfx_forge_hammer", AudioDispatchCommandDTO.AudioBusTrack.SE, 1.0, 1.0, true, Vector2(10, 0), 20.0
	)
	var listener = Vector2(0, 0)
	var res = SpatialAudioSolver.evaluate_spatial_audio(cmd, listener, 1.0)

	# 距离 10m，最大 20m，衰减系数为 (1 - 10/20) = 0.5，右声道 pan 为 +0.5
	var vol_correct = is_equal_approx(res.effective_volume, 0.5)
	var pan_correct = is_equal_approx(res.pan, 0.5)

	var passed = res.play and vol_correct and pan_correct
	return {
		"test": "TC-AUDIO-01: 空间声学几何线性距离衰减与立体声水平声相",
		"passed": passed
	}

static func _test_concurrency_polyphony_limiter() -> Dictionary:
	var active_counts := {}
	var cmd := AudioDispatchCommandDTO.new("sfx_arrow_rain", AudioDispatchCommandDTO.AudioBusTrack.SE, 1.0)
	var bus_vols := { "SE": 0.8 }

	# 连续派发 4 次 -> 均成功
	for i in range(4):
		AudioBusPipeline.dispatch_sound_event(active_counts, cmd, Vector2.ZERO, bus_vols, 4)

	# 第 5 次派发 -> 拦截 (CONCURRENCY_LIMIT_REACHED)
	var res_overflow = AudioBusPipeline.dispatch_sound_event(active_counts, cmd, Vector2.ZERO, bus_vols, 4)

	var passed = (active_counts.get("sfx_arrow_rain", 0) == 4) and (not res_overflow.dispatched) and (res_overflow.reason == "CONCURRENCY_LIMIT_REACHED")
	return {
		"test": "TC-AUDIO-02: 高频同音效并发播放截断与防爆音限流",
		"passed": passed
	}

static func _test_four_track_bus_routing() -> Dictionary:
	var cmd_bgm := AudioDispatchCommandDTO.new("bgm_valan_town", AudioDispatchCommandDTO.AudioBusTrack.BGM, 1.0)
	var cmd_se := AudioDispatchCommandDTO.new("sfx_potion_drink", AudioDispatchCommandDTO.AudioBusTrack.SE, 1.0)

	var bus_vols := { "BGM": 0.5, "SE": 0.9 }
	var active_counts := {}

	var r_bgm = AudioBusPipeline.dispatch_sound_event(active_counts, cmd_bgm, Vector2.ZERO, bus_vols)
	var r_se = AudioBusPipeline.dispatch_sound_event(active_counts, cmd_se, Vector2.ZERO, bus_vols)

	var passed = r_bgm.dispatched and (r_bgm.bus_track == "BGM") and is_equal_approx(r_bgm.volume, 0.5) and \
				 r_se.dispatched and (r_se.bus_track == "SE") and is_equal_approx(r_se.volume, 0.9)

	return {
		"test": "TC-AUDIO-03: 四轨独立音频总线路由与分路音量独立加权",
		"passed": passed
	}

## L9-a（Phase 53）：并发水位显式释放路径（Inv-ON-4）——
## 释放后计数归零删键（永不 < 0）、同音效可再次派发（红证：修复前只增不减，达限后永久拒播）
static func _test_sound_count_release_bounded() -> Dictionary:
	var active_counts := {}
	var cmd := AudioDispatchCommandDTO.new("sfx_loop_wind", AudioDispatchCommandDTO.AudioBusTrack.SE, 1.0)
	var bus_vols := { "SE": 0.8 }

	# 未派发过的 id 释放 → 安全无副作用
	AudioBusPipeline.release_sound_instance(active_counts, "never_played")
	var noop_ok = not active_counts.has("never_played")

	for i in range(4):
		AudioBusPipeline.dispatch_sound_event(active_counts, cmd, Vector2.ZERO, bus_vols, 4)
	AudioBusPipeline.release_sound_instance(active_counts, "sfx_loop_wind")
	AudioBusPipeline.release_sound_instance(active_counts, "sfx_loop_wind")
	var mid_ok = active_counts.get("sfx_loop_wind", 0) == 2
	for i in range(4):
		AudioBusPipeline.release_sound_instance(active_counts, "sfx_loop_wind")
	var released_ok = not active_counts.has("sfx_loop_wind")
	# 释放后同音效可再次派发（不再永久 CONCURRENCY_LIMIT_REACHED）
	var again = AudioBusPipeline.dispatch_sound_event(active_counts, cmd, Vector2.ZERO, bus_vols, 4)
	var passed = noop_ok and mid_ok and released_ok and again.dispatched
	return {
		"test": "TC-AUDIO-04: 并发水位显式释放（L9-a：归零删键、释放后可再派发）",
		"passed": passed
	}
