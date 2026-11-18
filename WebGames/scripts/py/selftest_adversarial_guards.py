#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 对抗性自检套件)
# 文件路径: WebGames/scripts/py/selftest_adversarial_guards.py
# 架构定位: 脚本库对抗性反证与旁路逃逸回归测试引擎 (Adversarial Guard Self-Test)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: 各 audit_*.py 规则模块 | 下游: 门禁验证结果 | 运行时: Python 3.10+
# 职责说明: 在隔离临时沙盒中构造对抗性绕过样本，验证注释伪装、引号遮蔽、恒定时间比对旁路、密码学散落及硬编码秘钥均可被精确拦截
# 退出语义与设计依据: 退出码: 0=全部对抗样本被成功阻断, 1=存在逃逸漏洞 | 设计依据: constraint-driven-development 对抗性证伪原则
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/selftest_adversarial_guards.py
# ==============================================================================
"""脚本库对抗性逃逸与旁路失效自动化自检套件。"""

from __future__ import annotations
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile

from audit_common import ensure_utf8_stdout
import audit_hardcode
import audit_script_comment
import audit_secrets
from lib.arch_guard_rules import check_tc_arch_12, check_tc_arch_13, check_tc_arch_14
from lib.audit_sdk_protocol_rules import _check_esc_action_enum_parity
from lib.selftest_audit_purity_guards import run_perf_and_refactor_purity_guards
from lib.selftest_reporting_guards import run_reporting_and_aggregate_guards
from gd import style_rules

ensure_utf8_stdout()


def _make_result(name: str, violations: list[str]) -> dict[str, object]:
    """构造标准架构校验断言结果字典。"""
    return {"test": name, "passed": len(violations) == 0, "violations": violations}


def _strip_comments_stub(src: str) -> str:
    """复刻引号感知行内注释剥离，供架构对抗自检使用。"""
    return "\n".join(audit_hardcode.strip_comment(ln) for ln in src.splitlines())


def _test_script_comment_evasion() -> list[str]:
    """对抗样本 1：验证注释伪装 PS1/Bash 三件套与第 40 行待办标记逃逸必被拦截。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        ps1_evade = tmp / "fake_evade.ps1"
        header_ps1 = (
            "# 模块归属: Test\n# 文件路径: WebGames/scripts/ps1/fake_evade.ps1\n"
            "# 架构定位: Test\n# 依赖与触发: Test\n# 职责说明: Test\n# 退出语义与设计依据: Test\n"
        )
        body_pad = "\n" * 32
        ps1_evade.write_text(
            header_ps1
            + "[CmdletBinding()]\n# Set-StrictMode -Version Latest\n# $ErrorActionPreference = 'Stop'\n"
            + body_pad
            + "# TO" + "DO: hidden after line 35\n"
            + "# phase" + "99: hidden jargon after line 35\n",
            encoding="utf-8",
        )
        viols = audit_script_comment.audit_file(ps1_evade, fix=False)
        rules = {v["rule"] for v in viols}
        for req in ("PS1-SET-STRICTMODE", "PS1-ERROR-ACTION", "COMMENT-PENDING-MARKER", "COMMENT-JARGON"):
            if req not in rules:
                failures.append(f"PS1 对抗逃逸未拦截: 缺失 {req} (实得 {sorted(rules)})")

        sh_evade = tmp / "fake_evade.sh"
        sh_evade.write_text(
            "#!/usr/bin/env bash\n" + header_ps1 + "# set -uo pipefail\necho ok\n",
            encoding="utf-8",
        )
        sh_rules = {v["rule"] for v in audit_script_comment.audit_file(sh_evade, fix=False)}
        if "BASH-SAFE-OPTIONS" not in sh_rules:
            failures.append(f"Bash 注释伪装未拦截: 缺失 BASH-SAFE-OPTIONS (实得 {sorted(sh_rules)})")
    return failures


def _test_quote_masking_hardcode() -> list[str]:
    """对抗样本 2：验证字符串字面量内的 `#` 无法遮蔽同行后续魔法数字与 print 调用，且技术前缀无法遮蔽同行后续业务/禁忌词。"""
    failures: list[str] = []
    masked_line = 'var color: String = "#FF0000"; var magic: int = 98765; print("bypass")'
    stripped = audit_hardcode.strip_comment(masked_line)
    if "98765" not in stripped or "print(" not in stripped:
        failures.append(f"引号内 # 错误截断后续代码: '{stripped}'")

    probe_counts = [0, 0, 0, 0, 0, 0]
    probe_examples: list[str] = []
    smuggled_line = 'var p := "res://ok/path"; var text := "秘密硬编码"; var mod_id := "official_kalar"'
    audit_hardcode._scan_code_line(smuggled_line, 1, probe_counts, probe_examples)
    if probe_counts[2] < 1 or probe_counts[5] < 1:
        failures.append(f"技术白名单遮蔽或短字符串漏报: counts={probe_counts}")
    return failures


def _test_arch_log_and_crypto_evasion() -> list[str]:
    """对抗样本 3：验证常量级别 emit_log 中文占位符、裸 AESContext、非恒定比对与静态密钥字面量均被拦截。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        bad_dir = root / "backend" / "domains" / "probe"
        bad_dir.mkdir(parents=True, exist_ok=True)
        bad_file = bad_dir / "bad_probe.gd"
        k_tok = "seal" + "_key"
        bad_file.write_text(
            'class_name BadProbe extends RefCounted\n'
            f'const BAD_KEY: String = "plain_{k_tok}_value_123"\n'
            'func run_bad(expected_mac: String, mac_hex: String) -> bool:\n'
            '\tEventBusCore.get_instance().emit_log(LogConstants.LEVEL_LOWER_WARN, "非法中文 %s")\n'
            '\tvar aes := AESContext.new()\n'
            '\treturn expected_mac == mac_hex and aes != null\n',
            encoding="utf-8",
        )
        raw = bad_file.read_text(encoding="utf-8")
        ctx = SimpleNamespace(root=root, backend_files=[bad_file], gd_sources={bad_file: (raw, _strip_comments_stub(raw))})
        res12 = check_tc_arch_12(ctx, _make_result, _strip_comments_stub)
        res13 = check_tc_arch_13(ctx, _make_result, _strip_comments_stub)
        if res12["passed"] or len(res12["violations"]) < 2:
            failures.append(f"TC-ARCH-12 对抗样本逃逸: {res12}")
        if res13["passed"] or len(res13["violations"]) < 2:
            failures.append(f"TC-ARCH-13 对抗样本逃逸: {res13}")

        (root / "config" / "infrastructure").mkdir(parents=True, exist_ok=True)
        (root / "config" / "infrastructure" / "log.json").write_text("{broken json", encoding="utf-8")
        res12_corrupt = check_tc_arch_12(ctx, _make_result, _strip_comments_stub)
        if res12_corrupt["passed"] or not any("log.json 解析异常" in v for v in res12_corrupt["violations"]):
            failures.append(f"TC-ARCH-12 损坏 JSON 静默吞没逃逸: {res12_corrupt}")

        sec_findings: list[str] = []
        sec_file = root / "bad_secret.gd"
        sec_file.write_text(f'const {k_tok}: String = "synthetic_plain_secret_9876"\n', encoding="utf-8")
        if audit_secrets.scan_file(sec_file, sec_findings) == 0:
            failures.append("audit_secrets 未能拦截静态密钥字面量赋值")
    return failures


def _test_case_sensitive_res_and_esc_drift() -> list[str]:
    """对抗样本 4：验证精确大小写 res:// 校验与 ESC 动作枚举漂移检测必被拦截。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        target_dir = root / "backend" / "infrastructure"
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "RealFile.gd").write_text("class_name RealFile\n", encoding="utf-8")
        probe = target_dir / "probe.gd"
        probe.write_text('const X = preload("res://backend/infrastructure/realfile.gd")\n', encoding="utf-8")
        res14 = check_tc_arch_14(SimpleNamespace(root=root), _make_result, _strip_comments_stub)
        if res14["passed"] or not res14["violations"]:
            failures.append("TC-ARCH-14 未能拦截大小写不匹配的 preload(res://) 路径")

        mod_sdk = root / "mod_sdk"
        (mod_sdk / "schemas").mkdir(parents=True, exist_ok=True)
        (mod_sdk / "capabilities.json").write_text(
            '{"unified_protocol_capabilities": {"esc_menu_actions": ["ESC_A", "ESC_B"]}}',
            encoding="utf-8",
        )
        (mod_sdk / "schemas" / "esc_menu_action_payload.schema.json").write_text(
            '{"properties": {"action_type": {"enum": ["ESC_A"]}}}',
            encoding="utf-8",
        )
        esc_findings: list = []
        _check_esc_action_enum_parity(mod_sdk, esc_findings)
        if not esc_findings or esc_findings[0].rule_id != "SDK-PROTOCOL-ESC-ENUM-DRIFT":
            failures.append("SDK-PROTOCOL-ESC-ENUM-DRIFT 未能拦截 Schema 与 capabilities 枚举漂移")
    return failures


def _test_gd_strict_style_evasion() -> list[str]:
    """对抗样本 5：验证全量前后端严格六字段路径、类对齐、文档注释、黑话及 Lambda/缩写声明必被拦截。"""
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        bad_dir = root / "backend" / "domains" / "probe"
        bad_dir.mkdir(parents=True, exist_ok=True)
        bad_gd = bad_dir / "probe_sample.gd"
        bad_gd.write_text(
            "# 模块归属: Test\n"
            "# 文件路径: res://backend/domains/probe/stale_name.gd\n"
            "# 职责说明: R-18 与全链路底座闭环校验\n"
            "class_name WrongClassName extends RefCounted\n"
            "class CacheHelper:\n"
            "\tvar min_lv: int = 1\n"
            "func do_work(req: Dictionary) -> void:\n"
            "\tvar res: int = 0\n"
            "\tvar ch: String = \"a\"\n"
            "\tvar data: Dictionary = {}\n"
            "\tvar dir: String = \"north\"\n"
            "\tvar filtered: Array = [].filter(func(a, ok): return str(a) != ok)\n"
            "\tfor k in req.keys():\n"
            "\t\tres += int(k)\n",
            encoding="utf-8",
        )
        violations: list[str] = []
        style_rules.audit_file(bad_gd, violations, base_root=root)
        joined = "\n".join(violations)
        for tag in ("STYLE-HDR-001", "STYLE-CLS-001", "STYLE-DOC-001", "STYLE-JRG-001", "STYLE-NAM-002"):
            if tag not in joined:
                failures.append(f"gd/style_rules 对抗样本未拦截 {tag} (实得: {violations})")
        for jargon_tok in ("全链路", "底座", "闭环"):
            if jargon_tok not in joined:
                failures.append(f"gd/style_rules 新增禁忌黑话未拦截 {jargon_tok} (实得: {violations})")
        for cryptic in ("min_lv", "「ch」", "「data」", "「dir」", "「a」", "「ok」"):
            if cryptic not in joined:
                failures.append(f"gd/style_rules 未拦截隐蔽命名 {cryptic} (实得: {violations})")

        view_dir = root / "frontend" / "views" / "probe_view"
        view_dir.mkdir(parents=True, exist_ok=True)
        bad_view = view_dir / "probe_view.gd"
        bad_view.write_text(
            "# 文件路径: res://frontend/views/probe_view/probe_view.gd\n"
            "class_name ProbeView extends Control\n"
            "func bind_items(items_dict: Dictionary) -> void:\n"
            "\tpass\n",
            encoding="utf-8",
        )
        view_violations: list[str] = []
        style_rules.audit_file(bad_view, view_violations, base_root=root)
        view_joined = "\n".join(view_violations)
        for tag in ("STYLE-HDR-001", "STYLE-DOC-001", "STYLE-NAM-002"):
            if tag not in view_joined:
                failures.append(f"frontend/views 严格治理未拦截 {tag} (实得: {view_violations})")

        test_dir = root / "tests" / "unit"
        test_dir.mkdir(parents=True, exist_ok=True)
        bad_test = test_dir / "probe_test_suite.gd"
        bad_test.write_text(
            "# 文件路径: res://tests/unit/probe_test_suite.gd\n"
            "# 职责: 端到端全链路闭环及延迟基准验证\n"
            "static func test_latency() -> void:\n"
            "\tvar p95: int = 10\n"
            "\tvar limit: int = p95\n"
            "\tassert(limit == 10)\n",
            encoding="utf-8",
        )
        test_violations: list[str] = []
        style_rules.audit_file(bad_test, test_violations, base_root=root)
        test_joined = "\n".join(test_violations)
        for jargon_tok in ("全链路", "闭环"):
            if jargon_tok not in test_joined or "STYLE-JRG-001" not in test_joined:
                failures.append(f"tests/ 目录术语守卫未拦截 {jargon_tok} (实得: {test_violations})")
        if "p95" in test_joined or "STYLE-NAM-002" in test_joined:
            failures.append(f"tests/ 目录术语守卫误伤了 p95 或非严格命名规则 (实得: {test_violations})")
    return failures


def main() -> int:
    """CLI 入口：运行脚本库对抗性逃逸全量自检并返回退出码。"""
    failures: list[str] = []
    failures.extend(_test_script_comment_evasion())
    failures.extend(_test_quote_masking_hardcode())
    failures.extend(_test_arch_log_and_crypto_evasion())
    failures.extend(_test_case_sensitive_res_and_esc_drift())
    failures.extend(_test_gd_strict_style_evasion())
    failures.extend(run_reporting_and_aggregate_guards())
    failures.extend(run_perf_and_refactor_purity_guards())

    if failures:
        for item in failures:
            print(f"  ✗ [ADV-SELFTEST] {item}")
        print("【对抗自检结论】未通过（存在门禁绕过风险）")
        return 1

    print("【对抗自检结论】通过（脚本伪装/引号遮蔽/日志占位逃逸/密码学旁路与静态秘钥 100% 成功拦截）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
