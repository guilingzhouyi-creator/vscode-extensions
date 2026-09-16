# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 架构护栏独立无头运行器
# 文件路径: res://tests/arch_runner.gd
# 职责: 在无头 Godot 中单独执行架构护栏测试套件（TC-ARCH-01~08B）
# ==============================================================================
extends SceneTree

func _initialize() -> void:
	var cls = load("res://tests/guards/test_architecture_guard.gd")
	var res: Dictionary = cls.run_all_tests()
	var ok: bool = res.get("all_passed", false)
	print("[audit-arch] %s" % res.get("domain", "架构护栏"))
	for item in res.get("results", []):
		var passed: bool = item.get("passed", false)
		print("  [%s] %s" % ["PASS" if passed else "FAIL", item.get("test", "")])
		if not passed:
			for v in item.get("violations", []):
				print("        - %s" % v)
	quit(0 if ok else 1)
