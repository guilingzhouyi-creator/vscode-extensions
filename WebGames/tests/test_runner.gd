# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 全量无头自动化测试运行器
# 文件路径: res://tests/test_runner.gd
# 职责: 汇聚全域业务领域测试套件（清单与数量取自 TestRegistry，此处不写死），
#       执行第一性原理与数学方程断言并生成验收报告
# ==============================================================================
extends SceneTree

const TestRegistryClass = preload("res://tests/test_registry.gd")

## 检查测试套件是否具备合法的 run_all_tests 入口
func _is_valid_suite(test_cls: Variant) -> bool:
	if test_cls == null:
		return false
	if test_cls.has_method("run_all_tests"):
		return true
	if test_cls is Object:
		for m in test_cls.get_script_method_list():
			if m.get("name") == "run_all_tests":
				return true
	return false

## 报告无效测试套件并记录失败信息
func _report_invalid_suite(test_cls: Variant, failure_reports: Array[Dictionary]) -> void:
	if test_cls == null:
		print("[ FAIL ] === 未知测试套件 === (0/1 PASS)")
		print("    ❌  测试套件脚本加载失败 (null)\n")
		failure_reports.append({ "domain": "未知测试套件", "test": "测试套件脚本加载失败 (null)" })
		return

	var domain_name: String = test_cls.resource_path if (test_cls is Resource and not test_cls.resource_path.is_empty()) else "未实现套件"
	print("[ FAIL ] === %s === (0/1 PASS)" % domain_name)
	print("    ❌  测试套件未暴露 run_all_tests() 入口")
	if test_cls is GDScript:
		var can_inst: bool = test_cls.can_instantiate()
		var reload_code: int = test_cls.reload()
		print("        [DEBUG] can_instantiate=%s, reload=%d" % [can_inst, reload_code])
	print("")
	failure_reports.append({ "domain": domain_name, "test": "未暴露 run_all_tests() 入口" })

## 打印单个套件内各测试项结果
func _print_suite_item_results(domain_name: String, all_ok: bool, res_list: Array, failure_reports: Array[Dictionary]) -> void:
	if all_ok:
		for item: Variant in res_list:
			if item is Dictionary:
				var d: Dictionary = item as Dictionary
				print("    ✅  %s" % d.get("test", d.get("name", d.get("title", "未命名测试项"))))
		return

	for item: Variant in res_list:
		if not (item is Dictionary):
			continue
		var d: Dictionary = item as Dictionary
		var t_pass: bool = d.get("passed", false)
		var t_name: String = d.get("test", d.get("name", d.get("title", "未命名测试项")))
		if t_pass:
			print("    ✅  %s" % t_name)
		else:
			var detail_val: Variant = d.get("details", d.get("detail", d.get("message", d.get("error", ""))))
			var detail_msg: String = str(detail_val) if detail_val != null and str(detail_val) != "{}" else ""
			if detail_msg != "":
				print("    ❌  %s [FAILED]: %s" % [t_name, detail_msg])
			else:
				print("    ❌  %s [FAILED]" % t_name)
			failure_reports.append({ "domain": domain_name, "test": t_name })

	if res_list.is_empty():
		print("    ❌  测试套件未返回任何结果项")
		failure_reports.append({ "domain": domain_name, "test": "未返回任何结果项" })

## 执行单套件并打印日志，返回单套件统计
func _run_suite_and_report(test_cls: Variant, failure_reports: Array[Dictionary]) -> Dictionary:
	var result: Dictionary = test_cls.call("run_all_tests") if not test_cls.has_method("run_all_tests") else test_cls.run_all_tests()
	var domain_name: String = result.get("domain", "未知测试套件")
	var all_ok: bool = result.get("all_passed", false)
	var res_list: Array = result.get("results", [])
	var t_cnt: int = result.get("total_count", res_list.size())
	var p_cnt: int = result.get("passed_count", 0)

	if p_cnt == 0 and not res_list.is_empty():
		for it: Variant in res_list:
			if it is Dictionary and (it as Dictionary).get("passed", false):
				p_cnt += 1

	var status_tag: String = "[ PASS ]" if all_ok else "[ FAIL ]"
	print("%s === %s === (%d/%d PASS)" % [status_tag, domain_name, p_cnt, t_cnt])
	_print_suite_item_results(domain_name, all_ok, res_list, failure_reports)
	print("")

	return { "is_ok": all_ok, "passed": p_cnt, "total": t_cnt }

## 输出最终验收报告
func _print_final_summary(passed_domains: int, total_domains: int, passed_assertions: int, total_assertions: int, failure_reports: Array[Dictionary]) -> void:
	print("==============================================================================")
	print("  📊 测试验收汇总报告 (DoD Verification Summary)")
	print("==============================================================================")
	var domain_rate: float = (float(passed_domains) / float(total_domains)) * 100.0
	var assertion_rate: float = (float(passed_assertions) / float(total_assertions)) * 100.0 if total_assertions > 0 else 0.0

	print("  套件通过率: %d / %d 套件 (%.1f%%)" % [passed_domains, total_domains, domain_rate])
	print("  断言通过率: %d / %d 测试项 (%.1f%%)" % [passed_assertions, total_assertions, assertion_rate])
	print("")

	UIBindingRegistry.reset_instance()

	if failure_reports.is_empty() and passed_domains == total_domains:
		print("  🎉 恭喜！卡拉尔世界引擎全域 %d 套测试套件全量单元测试 100%% 验收通过！" % total_domains)
		print("==============================================================================\n")
		quit(0)
	else:
		print("  ⚠️  存在未通过测试项（共 %d 项未通过，失败套件数: %d）：" % [failure_reports.size(), total_domains - passed_domains])
		for rep: Dictionary in failure_reports:
			print("    ❌ [%s] %s" % [rep.get("domain", ""), rep.get("test", "")])
		print("==============================================================================\n")
		quit(1)

## 注意：必须重写 _initialize() 而非 _init()。
## _init() 是构造期，此时 SceneTree 尚未就绪，在其中调用 quit() 会导致进程
## 以 SIGSEGV (退出码 139) 终止——测试全部通过但 CI 判定失败，且极难察觉。
func _initialize() -> void:
	# 全域启动装配（幂等）：GameConfig 就绪 + 物品注册表 + 内置 GM 命令，
	# 测试运行器作为 CLI 运行时入口覆盖真实装配路径
	GameBootstrap.assemble()
	var test_classes: Array = TestRegistryClass.get_all_engine_test_classes()
	if test_classes == null or test_classes.is_empty():
		printerr("❌ 致命错误：TestRegistry 未返回任何有效测试套件")
		quit(1)
		return

	# 领域总数取自注册表，避免新增领域后标题数字与实际执行数失同步
	print("\n==============================================================================")
	print("  ⚔️  卡拉尔世界引擎 (KALAR WORLD ENGINE) - 全域 %d 套测试套件自动化执行  ⚔️" % test_classes.size())
	print("==============================================================================\n")

	var total_domains: int = test_classes.size()
	var passed_domains: int = 0
	var total_assertions: int = 0
	var passed_assertions: int = 0
	var failure_reports: Array[Dictionary] = []

	for test_cls: Variant in test_classes:
		if not _is_valid_suite(test_cls):
			total_assertions += 1
			_report_invalid_suite(test_cls, failure_reports)
			continue

		var suite_stat: Dictionary = _run_suite_and_report(test_cls, failure_reports)
		if suite_stat.get("is_ok", false):
			passed_domains += 1
		passed_assertions += int(suite_stat.get("passed", 0))
		total_assertions += int(suite_stat.get("total", 0))

	_print_final_summary(passed_domains, total_domains, passed_assertions, total_assertions, failure_reports)
