# ==============================================================================
# 模块归属: 自动化测试层 (Tests · 架构护栏入口)
# 文件路径: res://tests/arch_runner.gd
# 架构定位: Headless Architecture Guard Runner Entrypoint
# 依赖与触发: 触发方: audit-arch CLI | 上游: test_architecture_guard.gd | 下游: 控制台输出
# 职责说明: 在无头 Godot 中单独执行架构护栏测试套件（TC-ARCH-01~08B）并汇报违规明细。
# 退出语义与设计依据: SceneTree 入口，0=全过, 1=违规 | 设计依据: 领域与配置双向一致守卫
# ==============================================================================

## ArchRunner：架构护栏独立无头运行器
class_name ArchRunner
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
