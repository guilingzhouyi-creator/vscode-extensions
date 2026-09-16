# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 全量无头自动化测试运行器
# 文件路径: res://tests/test_runner.gd
# 职责: 汇聚全域业务领域测试套件（清单与数量取自 TestRegistry，此处不写死），
#       执行第一性原理与数学方程断言并生成验收报告
# ==============================================================================
extends SceneTree

const TestRegistryClass = preload("res://tests/test_registry.gd")

## 注意：必须重写 _initialize() 而非 _init()。
## _init() 是构造期，此时 SceneTree 尚未就绪，在其中调用 quit() 会导致进程
## 以 SIGSEGV (退出码 139) 终止——测试全部通过但 CI 判定失败，且极难察觉。
func _initialize() -> void:
	# 全域启动装配（幂等）：GameConfig 就绪 + 物品注册表 + 内置 GM 命令，
	# 测试运行器作为 CLI 运行时入口覆盖真实装配路径
	GameBootstrap.assemble()
	var test_classes = TestRegistryClass.get_all_engine_test_classes()

	# 领域总数取自注册表，避免新增领域后标题数字与实际执行数失同步
	print("\n==============================================================================")
	print("  ⚔️  卡拉尔世界引擎 (KALAR WORLD ENGINE) - 全域 %d 套测试套件自动化执行  ⚔️" % test_classes.size())
	print("==============================================================================\n")

	var total_domains = test_classes.size()
	var passed_domains := 0
	var total_assertions := 0
	var passed_assertions := 0
	var failure_reports: Array[Dictionary] = []

	for test_cls in test_classes:
		if test_cls == null:
			print("[ FAIL ] === 未知测试套件 === (0/1 PASS)")
			print("    ❌  测试套件脚本加载失败 (null)")
			print("")
			total_assertions += 1
			failure_reports.append({ "domain": "未知测试套件", "test": "测试套件脚本加载失败 (null)" })
			continue

		if not test_cls.has_method("run_all_tests"):
			var domain_name: String = test_cls.resource_path if (test_cls is Resource and not test_cls.resource_path.is_empty()) else "未实现套件"
			print("[ FAIL ] === %s === (0/1 PASS)" % domain_name)
			print("    ❌  测试套件未暴露 run_all_tests() 入口")
			print("")
			total_assertions += 1
			failure_reports.append({ "domain": domain_name, "test": "未暴露 run_all_tests() 入口" })
			continue

		var result: Dictionary = test_cls.run_all_tests()
		var domain_name: String = result.get("domain", "未知测试套件")
		var all_ok: bool = result.get("all_passed", false)
		var res_list: Array = result.get("results", [])
		var t_cnt: int = result.get("total_count", res_list.size())
		var p_cnt: int = result.get("passed_count", 0)

		if p_cnt == 0 and not res_list.is_empty():
			for it in res_list:
				if it.get("passed", false):
					p_cnt += 1

		total_assertions += t_cnt
		passed_assertions += p_cnt

		if all_ok:
			passed_domains += 1
			print("[ PASS ] === %s === (%d/%d PASS)" % [domain_name, p_cnt, t_cnt])
			for item in res_list:
				print("    ✅  %s" % item.get("test", "未命名测试项"))
		else:
			print("[ FAIL ] === %s === (%d/%d PASS)" % [domain_name, p_cnt, t_cnt])
			for item in res_list:
				var t_pass: bool = item.get("passed", false)
				var t_name: String = item.get("test", "未命名测试项")
				if t_pass:
					print("    ✅  %s" % t_name)
				else:
					print("    ❌  %s [FAILED]" % t_name)
					failure_reports.append({ "domain": domain_name, "test": t_name })
		print("")

	print("==============================================================================")
	print("  📊 测试验收汇总报告 (DoD Verification Summary)")
	print("==============================================================================")
	var domain_rate: float = (float(passed_domains) / float(total_domains)) * 100.0
	var assertion_rate: float = (float(passed_assertions) / float(total_assertions)) * 100.0 if total_assertions > 0 else 0.0

	print("  套件通过率: %d / %d 套件 (%.1f%%)" % [passed_domains, total_domains, domain_rate])
	print("  断言通过率: %d / %d 测试项 (%.1f%%)" % [passed_assertions, total_assertions, assertion_rate])
	print("")

	# 全域资源与单例清理，杜绝进程退出期 ObjectDB 泄漏
	UIBindingRegistry.reset_instance()

	if failure_reports.is_empty():
		print("  🎉 恭喜！卡拉尔世界引擎全域 %d 套测试套件全量单元测试 100%% 验收通过！" % total_domains)
		print("==============================================================================\n")
		quit(0)
	else:
		print("  ⚠️  存在未通过测试项，请检查上述错误报告！")
		print("==============================================================================\n")
		quit(1)
