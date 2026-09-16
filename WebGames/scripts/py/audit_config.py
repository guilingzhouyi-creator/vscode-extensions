#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 配置架构门禁)
# 文件路径: WebGames/scripts/py/audit_config.py
# 架构定位: 配置结构校验器 (Config Schema Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/**/*.json | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 递归校验配置 JSON 结构合法性、必需表注册完整性与键名命名规范
# 退出语义与设计依据: 退出码: 0=合规, 1=存在结构违规 | 设计依据: WebGames 零硬编码契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_config.py
#   python scripts/py/audit_config.py --fix
# ==============================================================================
"""审查 config/ 目录与 game_config.gd 必需表清单的一致性。"""
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root, load_json

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG_DIR = ROOT / "config"
GAME_CONFIG_GD = ROOT / "backend" / "infrastructure" / "game_config.gd"
RULES_FILE = ROOT / "scripts" / "config" / "value_domain_rules.json"

LAYERS = {"infrastructure", "domains", "frontend", "narratives", "items", "i18n", "descriptions", "copywriting"}
# 小写蛇形 / UPPER_SNAKE 标识（允许前导下划线）/ 数字索引 / 点号路由键与多语言键
KEY_RE = re.compile(
    r"^(?:\$?[a-z][a-z0-9_]*|_?[a-z][a-z0-9_]*|_?[A-Z][A-Z0-9_]*|\d+|[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+)$"
)
# 尾逗号可选：GDScript 数组末项通常不写尾逗号，若强制要求会漏掉 _required_tables
# 的最后一张表（该表因此永远不被校验，删了也没人告警）。
REQUIRED_RE = re.compile(r'^\s*"([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)",?\s*$')


def parse_required_tables() -> list[str]:
    if not GAME_CONFIG_GD.exists():
        return []
    tables: list[str] = []
    in_block = False
    for line in GAME_CONFIG_GD.read_text(encoding="utf-8").splitlines():
        if "_required_tables" in line and "=" in line:
            in_block = True
            continue
        if in_block:
            if line.strip().startswith("]"):
                break
            m = REQUIRED_RE.match(line)
            if m:
                tables.append(m.group(1))
    return tables


def check_keys(obj: Any, path: str, violations: list[str], table: str) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not KEY_RE.match(k):
                violations.append(f"{table}: 键 '{k}' 不符合键命名约定（{path}）")
            check_keys(v, f"{path}/{k}", violations, table)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            check_keys(v, f"{path}/{i}", violations, table)


def check_format(f: Path, raw: bytes, text: str, obj: Any, rel: str, violations: list[str], fix: bool = False) -> None:
    """格式一致性：对照 .editorconfig（UTF-8 无 BOM / LF / 2 空格规范序列化 / 末行换行）。

    规范序列化 = json.dumps(ensure_ascii=False, indent=2)；值等价性由解析比对保证，
    仅约束文本形态（键序保持原样），任何值语义差异不由本规则管辖。
    支持 --fix 原位安全写回。单趟复用已读取 raw 与已解析 obj。
    """
    rel_posix = str(rel).replace("\\", "/")
    has_bom = raw.startswith(b"\xef\xbb\xbf")
    has_crlf = b"\r\n" in raw
    missing_nl = raw and not raw.endswith(b"\n")
    canon = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    canon_bytes = canon.encode("utf-8")
    non_canon = (text != canon)

    if fix and (has_bom or has_crlf or missing_nl or non_canon):
        f.write_bytes(canon_bytes)
        print(f"  [格式修复] 已原位规范化: {rel_posix}")
        return

    if has_bom:
        violations.append(f"格式: {rel_posix} 带 UTF-8 BOM（应为无 BOM UTF-8）")
    if has_crlf:
        violations.append(f"格式: {rel_posix} 含 CRLF（.editorconfig 规定 JSON 为 LF）")
    if missing_nl:
        violations.append(f"格式: {rel_posix} 缺末行换行符")
    if non_canon:
        violations.append(f"格式: {rel_posix} 非规范序列化（应为 ensure_ascii=false + 2 空格缩进）")


## =============================================================================
## Phase 63: 声明式配置值域校验引擎（Declarative Config Rule Evaluator）
## 彻底解耦业务表与 Python 审查脚本，由 scripts/config/value_domain_rules.json 驱动
## =============================================================================

class JsonPathResolver:
    """路径寻址解析器：支持点分/斜杠路径、数组通配符 * 以及嵌套字典展开。"""
    @staticmethod
    def resolve(data: Any, path: str) -> Any:
        parts = path.replace(".", "/").strip("/").split("/")
        return JsonPathResolver._traverse(data, parts, "")

    @staticmethod
    def _traverse(node: Any, parts: list[str], current_path: str) -> Any:
        if not parts:
            return [(current_path, node)]
        head, *tail = parts
        results = []
        if head == "*":
            if isinstance(node, list):
                for idx, item in enumerate(node):
                    elem_path = f"{current_path}[{idx}]" if current_path else f"[{idx}]"
                    results.extend(JsonPathResolver._traverse(item, tail, elem_path))
            elif isinstance(node, dict):
                for k, v in node.items():
                    elem_path = f"{current_path}/{k}" if current_path else k
                    results.extend(JsonPathResolver._traverse(v, tail, elem_path))
        elif isinstance(node, dict) and head in node:
            next_path = f"{current_path}/{head}" if current_path else head
            results.extend(JsonPathResolver._traverse(node[head], tail, next_path))
        return results


MAGIC_CONDITION_OPS = {"AND", "OR", "NOT", "LEAF"}


def _check_condition_tree(node: Any, rel_posix: str, violations: list[str], path: str) -> None:
    if not isinstance(node, dict):
        violations.append(f"{path} 必须为对象: {rel_posix}")
        return
    op = node.get("op")
    if op not in MAGIC_CONDITION_OPS:
        violations.append(f"{path}.op 非法（应 ∈ {sorted(MAGIC_CONDITION_OPS)}）: {rel_posix}")
        return
    if op == "LEAF":
        if not isinstance(node.get("kind", ""), str) or not node.get("kind"):
            violations.append(f"{path} LEAF 缺 kind: {rel_posix}")
        if not isinstance(node.get("args", {}), dict):
            violations.append(f"{path} LEAF.args 必须为对象: {rel_posix}")
        return
    terms = node.get("terms")
    if not isinstance(terms, list):
        violations.append(f"{path}.terms 必须为数组: {rel_posix}")
        return
    for i, sub in enumerate(terms):
        _check_condition_tree(sub, rel_posix, violations, f"{path}.terms[{i}]")


class DeclarativeRuleEvaluator:
    """声明式配置值域校验引擎：加载 value_domain_rules.json 并分派执行 11 大规则原语。"""
    def __init__(self, rule_db: dict, all_configs: dict | None = None) -> None:
        self.rules = rule_db.get("rules", []) if isinstance(rule_db, dict) else []
        self.all_configs = all_configs or {}
        self.rules_by_target = {}
        for r in self.rules:
            tf = r.get("target_file", "").replace("\\", "/")
            self.rules_by_target.setdefault(tf, []).append(r)

    def evaluate_file(self, data: dict, rel_posix: str, violations: list[str]) -> None:
        rules = self.rules_by_target.get(rel_posix, [])
        for r in rules:
            self._evaluate_rule(r, data, rel_posix, violations)

    def _evaluate_rule(self, rule: dict, data: dict, rel_posix: str, violations: list[str]) -> None:
        primitive = rule.get("primitive")
        rule_id = rule.get("rule_id", "VD_UNKNOWN")
        params = rule.get("params", {})

        if primitive == "positive_num":
            allow_float = params.get("allow_float", True)
            min_ex = params.get("min_exclusive", 0)
            matches = JsonPathResolver.resolve(data, rule.get("key_path", ""))
            for loc, v in matches:
                if v is None:
                    continue
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    violations.append(f"{rule_id}: {rel_posix} {loc} 必须为数值（实测 {v}）")
                elif not allow_float and isinstance(v, float):
                    violations.append(f"{rule_id}: {rel_posix} {loc} 必须为整数（实测 {v}）")
                elif v <= min_ex:
                    violations.append(f"{rule_id}: {rel_posix} {loc} 必须 > {min_ex}（实测 {v}）")

        elif primitive == "bounded_range":
            matches = JsonPathResolver.resolve(data, rule.get("key_path", ""))
            min_v = params.get("min_val")
            max_v = params.get("max_val")
            if "max_val_reference" in params:
                ref_matches = JsonPathResolver.resolve(data, params["max_val_reference"])
                if ref_matches and isinstance(ref_matches[0][1], (int, float)) and not isinstance(ref_matches[0][1], bool):
                    max_v = ref_matches[0][1] + params.get("max_val_offset", 0)
            allow_float = params.get("allow_float", True)
            inclusive = params.get("inclusive", True)

            for loc, v in matches:
                if v is None:
                    continue
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    violations.append(f"{rule_id}: {rel_posix} {loc} 必须为数值（实测 {v}）")
                elif not allow_float and isinstance(v, float):
                    violations.append(f"{rule_id}: {rel_posix} {loc} 必须为整数（实测 {v}）")
                else:
                    out = (v < min_v or v > max_v) if inclusive else (v <= min_v or v >= max_v)
                    if out:
                        violations.append(f"{rule_id}: {rel_posix} {loc} 必须在 [{min_v}, {max_v}]（实测 {v}）")

        elif primitive == "range_ordered":
            lefts = JsonPathResolver.resolve(data, rule.get("key_path_left", ""))
            rights = JsonPathResolver.resolve(data, rule.get("key_path_right", ""))
            if lefts and rights:
                l_val, r_val = lefts[0][1], rights[0][1]
                if l_val is not None and r_val is not None:
                    if isinstance(l_val, (int, float)) and isinstance(r_val, (int, float)) and not isinstance(l_val, bool) and not isinstance(r_val, bool):
                        strict = params.get("strict_less", True)
                        bad = (l_val >= r_val) if strict else (l_val > r_val)
                        if bad:
                            op = "<" if strict else "<="
                            violations.append(f"{rule_id}: {rel_posix} {rule.get('key_path_left')} 必须 {op} {rule.get('key_path_right')}（实测 {l_val} / {r_val}）")

        elif primitive == "enum_whitelist":
            whitelist = set(params.get("whitelist", []))
            arr_path = rule.get("array_path")
            key_path = rule.get("item_key_path") or rule.get("key_path", "")
            full_path = f"{arr_path}/*/{key_path}" if arr_path else key_path
            matches = JsonPathResolver.resolve(data, full_path)
            for loc, v in matches:
                if v is not None and v not in whitelist:
                    violations.append(f"{rule_id}: {rel_posix} {loc} 非法（应 ∈ {sorted(list(whitelist))}，实测 {v}）")

        elif primitive == "unique_key":
            arr_path = rule.get("array_path", "")
            key_path = rule.get("item_key_path", "")
            matches = JsonPathResolver.resolve(data, f"{arr_path}/*/{key_path}")
            seen = set()
            for loc, v in matches:
                if v is not None:
                    if v in seen:
                        violations.append(f"{rule_id}: {rel_posix} 键重复: {v} ({loc})")
                    else:
                        seen.add(v)

        elif primitive == "required_sections":
            sections = params.get("sections", {})
            for sec_name, sec_type in sections.items():
                val = data.get(sec_name)
                if val is None:
                    violations.append(f"{rule_id}: {rel_posix} 缺少必需段: {sec_name}")
                elif sec_type == "dict" and not isinstance(val, dict):
                    violations.append(f"{rule_id}: {rel_posix} {sec_name} 必须为对象")
                elif sec_type == "list" and not isinstance(val, list):
                    violations.append(f"{rule_id}: {rel_posix} {sec_name} 必须为数组")

        elif primitive == "array_elements_schema":
            arr_path = rule.get("array_path", "")
            req_fields = params.get("required_fields", {})
            single_obj = params.get("single_object", False)
            op_whitelist = set(params.get("operator_whitelist", [])) if "operator_whitelist" in params else None
            matches = JsonPathResolver.resolve(data, arr_path)
            for loc, target in matches:
                if target is None:
                    continue
                elems = [target] if single_obj and isinstance(target, dict) else (target if isinstance(target, list) else [])
                for idx, elem in enumerate(elems):
                    if not isinstance(elem, dict):
                        violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}] 必须为对象")
                        continue
                    for f_name, f_type in req_fields.items():
                        val = elem.get(f_name)
                        if val is None:
                            violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}] 缺 {f_name}")
                        elif f_type == "non_empty_str" and (not isinstance(val, str) or not val.strip()):
                            violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}].{f_name} 必须为非空字符串")
                        elif f_type == "str" and not isinstance(val, str):
                            violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}].{f_name} 必须为字符串")
                        elif f_type == "list" and not isinstance(val, list):
                            violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}].{f_name} 必须为数组")
                    if op_whitelist and elem.get("operator") not in op_whitelist:
                        violations.append(f"{rule_id}: {rel_posix} {loc}[{idx}].operator 非法: {elem.get('operator')}")

        elif primitive == "cross_field_dependency":
            dep_type = params.get("type")
            if dep_type == "infra_exempt_matches_infra_domains":
                infra_domains = set(data.get(params.get("infra_domains_path", "infra_domains"), []))
                entries = data.get(rule.get("array_path", "entries"), [])
                if isinstance(entries, list):
                    for idx, e in enumerate(entries):
                        if isinstance(e, dict):
                            dname = e.get(params.get("domain_field", "domain_name"), "")
                            exempt = bool(e.get(params.get("exempt_field", "infra_exempt"), False))
                            if exempt != (dname in infra_domains):
                                violations.append(f"{rule_id}: {rel_posix} entries[{idx}] ({e.get('contract_id')}) infra_exempt 与 infra_domains 不一致")

        elif primitive == "foreign_key_reference":
            src_path = f"{rule.get('source_dict_path')}/*/{rule.get('source_item_key')}"
            target_dict_path = rule.get("target_dict_path")
            target_data = self.all_configs.get(rule.get("target_file_override", rel_posix), data)
            target_matches = JsonPathResolver.resolve(target_data, target_dict_path)
            valid_keys = set(target_matches[0][1].keys()) if target_matches and isinstance(target_matches[0][1], dict) else set()
            src_matches = JsonPathResolver.resolve(data, src_path)
            for loc, ref in src_matches:
                if ref is None:
                    continue
                refs = ref if isinstance(ref, list) else [ref]
                for item in refs:
                    if item not in valid_keys:
                        violations.append(f"{rule_id}: {rel_posix} {loc} 未登记于 {target_dict_path}: {item}")

        elif primitive == "condition_tree":
            matches = JsonPathResolver.resolve(data, rule.get("key_path", ""))
            for loc, tree_node in matches:
                if tree_node is not None:
                    _check_condition_tree(tree_node, rel_posix, violations, f"{loc}")

        elif primitive == "weights_sum":
            matches = JsonPathResolver.resolve(data, rule.get("key_path", ""))
            target_sum = params.get("target_sum", 1.0)
            tol = params.get("tolerance", 0.01)
            for loc, d in matches:
                if isinstance(d, dict):
                    total = 0.0
                    for k, w in d.items():
                        if not isinstance(w, (int, float)) or isinstance(w, bool) or w < 0.0:
                            violations.append(f"{rule_id}: {rel_posix} {loc}.{k} 必须为非负数值")
                        else:
                            total += float(w)
                    if abs(total - target_sum) > tol:
                        violations.append(f"{rule_id}: {rel_posix} {loc} 合计应 ≈ {target_sum}（实测 {total:.3f}）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="必需表缺失也视为失败")
    ap.add_argument("--fix", action="store_true", help="自动修复 JSON 格式（无 BOM / LF / 2 空格规范序列化 / 末行换行）")
    args = ap.parse_args()

    violations: list[str] = []
    warnings: list[str] = []
    found_tables: set[str] = set()
    files = sorted(CONFIG_DIR.rglob("*.json"))
    if not files:
        print("【audit-config】未找到任何 config/*.json")
        return 1

    rule_db = load_json(RULES_FILE)

    # P2-5 修复：预加载全部配置文件构建 {rel_posix: data} 映射，供 foreign_key_reference
    # 的 target_file_override 跨文件校验解析目标文件（此前 all_configs 恒空导致机制失效——
    # 跨文件 FK 恒回退当前文件造成误报/漏报）；主循环仍会报告解析失败，此处仅预载可用配置
    all_configs: dict = {}
    for f in files:
        try:
            rel_posix = str(f.relative_to(CONFIG_DIR)).replace("\\", "/")
            all_configs[rel_posix] = json.loads(f.read_bytes().decode("utf-8-sig"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError):
            continue
    evaluator = DeclarativeRuleEvaluator(rule_db, all_configs)

    for f in files:
        rel = f.relative_to(CONFIG_DIR)
        rel_posix = str(rel).replace("\\", "/")
        layer = rel.parts[0] if len(rel.parts) > 1 else ""
        name = f.stem
        if layer not in LAYERS:
            violations.append(f"配置文件层级非法: {rel_posix}（应为 {sorted(LAYERS)} 之一）")
        table = f"{layer}.{name}" if layer else name
        found_tables.add(table)
        try:
            raw = f.read_bytes()
            raw_text = raw.decode("utf-8-sig")
            data = json.loads(raw_text)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as e:
            violations.append(f"JSON 解析失败: {rel_posix} ({e})")
            continue
        if not isinstance(data, dict):
            violations.append(f"顶层必须为 JSON 对象: {rel_posix}")
        check_keys(data, "", violations, table)
        check_format(f, raw, raw_text, data, rel, violations, fix=args.fix)
        evaluator.evaluate_file(data, rel_posix, violations)

    required = parse_required_tables()
    if not required:
        violations.append("game_config.gd 未解析到 _required_tables 清单")
    for t in required:
        if t not in found_tables:
            warnings.append(f"必需表缺失（game_config.gd 声明但无对应文件）: {t}")

    print(f"【audit-config】配置表: {len(found_tables)} 张 / 必需表: {len(required)} 张")
    for w in warnings:
        print(f"  ⚠ {w}")
    if violations or (args.strict and warnings):
        print("【audit-config】违规项:")
        for v in violations:
            print(f"  ✗ {v}")
        print("【审查结论】未通过")
        return 1
    print("【审查结论】通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
