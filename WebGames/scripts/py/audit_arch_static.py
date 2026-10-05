#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态审计体系)
# 文件路径: WebGames/scripts/py/audit_arch_static.py
# 架构定位: 原生静态分析架构护栏 (Native Static Architecture Guard)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 纯原生静态审计领域架构合规性，断言领域目录、配置表落地、测试注册、确定性随机、文档计数、配置键存在性、退役契约与边界隔离
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规 | 设计依据: test_architecture_guard.gd 原生等价实现
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_arch_static.py
#   python scripts/py/audit_arch_static.py --json
# ==============================================================================
"""架构护栏纯原生静态审计引擎：无需冷启动 Godot 引擎，毫秒级断言全域架构契约。"""

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
DOMAINS_DIR = ROOT / "backend" / "domains"
BACKEND_DIR = ROOT / "backend"
CONFIG_DIR = ROOT / "config"
MANIFEST_FILE = ROOT / "config" / "infrastructure" / "domains.json"
GUARD_FILE = ROOT / "tests" / "guards" / "test_architecture_guard.gd"
REGISTRY_FILE = ROOT / "tests" / "test_registry.gd"
ROUTER_FILE = ROOT / "backend" / "infrastructure" / "config_router_engine.gd"

RNG_IMPL_FILE = "deterministic_rng.gd"
FORBIDDEN_RANDOM_CALLS = ("randf", "randi", "randomize")
IDENT_CHARS = frozenset("._0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")

DOC_FILES = ("README.md", "config/README.md")
DOMAIN_COUNT_PATTERNS = (
  r"后端\s*(\d+)\s*个业务领域",
  r"#\s*(\d+)\s*个业务领域",
  r"覆盖\s*(\d+)\s*领域",
  r"\|\s*领域数\s*\|\s*(\d+)\s*\|",
  r"领域总数\s*[:：]\s*(\d+)",
)

CONFIG_CALL_RE = re.compile(
  r'GameConfig\.(?:get_string|get_int|get_float|get_bool|get_dict|get_array|get_value|has)\s*\(\s*"([^"]+)"\s*,\s*"([^"]*)"'
)
TOKEN_RE = re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|#[^\r\n]*)')
RANDOM_CALL_RE = re.compile(r"\b(randf|randi|randomize)\s*\(")


def strip_comments(source: str) -> str:
  """剥离单行注释并以等长空格填充，保留字符串字面量内容与行偏移。"""
  def repl(m: re.Match) -> str:
    s = m.group(0)
    if s.startswith("#"):
      return " " * len(s)
    return s
  return TOKEN_RE.sub(repl, source)


def strip_non_code(source: str) -> str:
  """清空注释与字符串内部内容（保留引号边界），用于裸函数调用分析。"""
  def repl(m: re.Match) -> str:
    s = m.group(0)
    if s.startswith("#"):
      return " " * len(s)
    delim = s[0]
    return delim + (" " * (len(s) - 2)) + delim
  return TOKEN_RE.sub(repl, source)


def is_dynamic_key(key: str) -> bool:
  """判定配置键路径是否为静态不可推导的动态表达式。"""
  if not key:
    return True
  if key.endswith("/"):
    return True
  if "+" in key or "%" in key:
    return True
  return False


def make_result(test_name: str, violations: List[str]) -> Dict[str, Any]:
  """构造统一测试结果字典。"""
  return {
    "test": test_name,
    "passed": len(violations) == 0,
    "violations": violations,
  }


class ArchitectureAuditContext:
  """架构审计静态提取上下文与高效单趟缓存底座。"""

  def __init__(self, root: Path) -> None:
    self.root = root
    self.manifest: List[Dict[str, Any]] = []
    self.cross_cutting_suites: List[str] = []
    self.primary_aliases: Dict[str, str] = {}
    self.domain_subtables: Dict[str, List[str]] = {}
    self.backend_files: List[Path] = []
    self.gd_sources: Dict[Path, Tuple[str, str]] = {}
    self.domain_gd_files: Dict[str, List[Path]] = {}
    self.table_key_cache: Dict[str, Optional[Dict[str, bool]]] = {}

  def initialize(self) -> None:
    """一次性加载清单、路由表、测试套件定义与后端全量脚本缓存。"""
    if MANIFEST_FILE.exists():
      try:
        data = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        self.manifest = data.get("domains", [])
      except Exception:
        self.manifest = []

    if GUARD_FILE.exists():
      guard_text = GUARD_FILE.read_text(encoding="utf-8")
      m_cc = re.search(r"CROSS_CUTTING_SUITES:\s*Array\[String\]\s*=\s*\[(.*?)\]\n\n", guard_text, re.DOTALL)
      if m_cc:
        self.cross_cutting_suites = re.findall(r'"(res://[^"]+)"', m_cc.group(1))

    if ROUTER_FILE.exists():
      router_text = ROUTER_FILE.read_text(encoding="utf-8")
      m_aliases = re.search(r"_primary_aliases:\s*Dictionary\s*=\s*\{(.*?)\}", router_text, re.DOTALL)
      if m_aliases:
        for k, v in re.findall(r'"([^"]+)":\s*"([^"]+)"', m_aliases.group(1)):
          self.primary_aliases[k] = v

      m_subtables = re.search(r"_domain_subtables:\s*Dictionary\s*=\s*\{(.*?)\n\}", router_text, re.DOTALL)
      if m_subtables:
        for block in re.finditer(r'"([^"]+)":\s*\[(.*?)\]', m_subtables.group(1), re.DOTALL):
          k = block.group(1)
          items = re.findall(r'"([^"]+)"', block.group(2))
          self.domain_subtables[k] = items

    self.backend_files = sorted(BACKEND_DIR.rglob("*.gd"))
    for file_path in self.backend_files:
      raw = file_path.read_text(encoding="utf-8")
      stripped_c = strip_comments(raw)
      self.gd_sources[file_path] = (raw, stripped_c)
      try:
        rel = file_path.relative_to(DOMAINS_DIR)
        domain_id = rel.parts[0]
        if domain_id not in self.domain_gd_files:
          self.domain_gd_files[domain_id] = []
        self.domain_gd_files[domain_id].append(file_path)
      except ValueError:
        pass

  def get_subtables_for_domain(self, domain_name: str) -> List[str]:
    """获取指定领域下辖的细分子表清单（与 ConfigRouterEngine 一致）。"""
    if domain_name in self.domain_subtables:
      return list(self.domain_subtables[domain_name])
    if domain_name in self.primary_aliases:
      return [self.primary_aliases[domain_name]]
    parts = domain_name.split(".")
    if len(parts) == 2 and parts[0] == "domains":
      return [f"{parts[0]}.{parts[1]}.core"]
    return []

  def table_path_rel(self, table_name: str) -> str:
    """表名转相对路径（<层>.<名> -> config/<层>/<名>.json）。"""
    parts = table_name.split(".")
    if len(parts) >= 2:
      return "config/" + "/".join(parts) + ".json"
    return f"config/{table_name}.json"

  def table_file_exists(self, table_name: str) -> bool:
    """检查物理配置表文件是否存在。"""
    return (self.root / self.table_path_rel(table_name)).exists()

  def get_table_keys(self, table_name: str) -> Optional[Dict[str, bool]]:
    """递归摊平并缓存配置表全部合法键路径。"""
    if table_name in self.table_key_cache:
      return self.table_key_cache[table_name]

    keys: Optional[Dict[str, bool]] = None
    target_file = self.root / self.table_path_rel(table_name)
    if target_file.exists():
      try:
        data = json.loads(target_file.read_text(encoding="utf-8"))
        flat: Dict[str, bool] = {}
        self._flatten_keys(data, "", flat)
        keys = flat
      except Exception:
        keys = None
    else:
      subtables = self.get_subtables_for_domain(table_name)
      if subtables:
        merged: Dict[str, bool] = {}
        for sub in subtables:
          sub_keys = self.get_table_keys(sub)
          if sub_keys is not None:
            merged.update(sub_keys)
        keys = merged

    self.table_key_cache[table_name] = keys
    return keys

  def _flatten_keys(self, data: Any, prefix: str, out: Dict[str, bool]) -> None:
    """递归摊平 JSON 节点（中间路径与数组索引均标记为合法）。"""
    if prefix != "":
      out[prefix] = True
    if isinstance(data, dict):
      for k, v in data.items():
        seg = f"{prefix}/{k}" if prefix else str(k)
        self._flatten_keys(v, seg, out)
    elif isinstance(data, list):
      for i, item in enumerate(data):
        seg = f"{prefix}/{i}" if prefix else str(i)
        self._flatten_keys(item, seg, out)


def check_tc_arch_01(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-01: 领域目录集合与清单 id 集合双向一致（含 depends_on 引用完整性）。"""
  violations: List[str] = []
  if not ctx.manifest:
    violations.append("领域清单为空或解析失败: res://config/infrastructure/domains.json")
    return make_result("TC-ARCH-01: 领域目录集合与清单 id 集合双向一致", violations)

  disk_ids: List[str] = []
  if DOMAINS_DIR.exists():
    for sub in DOMAINS_DIR.iterdir():
      if sub.is_dir() and sub.name not in ("contract_registry", "lifecycle", "version_governance"):
        disk_ids.append(sub.name)
  disk_ids.sort()

  manifest_ids: List[str] = []
  duplicates: List[str] = []
  for entry in ctx.manifest:
    entry_id = str(entry.get("id", ""))
    if not entry_id:
      violations.append("清单存在缺失 id 的条目")
      continue
    if entry_id in manifest_ids:
      duplicates.append(entry_id)
    else:
      manifest_ids.append(entry_id)
  manifest_ids.sort()

  for d in disk_ids:
    if d not in manifest_ids:
      violations.append(f"目录存在但清单未登记: backend/domains/{d}")
  for m in manifest_ids:
    if m not in disk_ids:
      violations.append(f"清单已登记但目录缺失: backend/domains/{m}")
  for dup in duplicates:
    violations.append(f"清单 id 重复: {dup}")

  manifest_id_set = set(manifest_ids)
  for entry in ctx.manifest:
    owner = str(entry.get("id", ""))
    for dep in entry.get("depends_on", []):
      if dep not in manifest_id_set:
        violations.append(f"depends_on 引用未登记领域: {owner} -> {dep}")

  return make_result("TC-ARCH-01: 领域目录集合与清单 id 集合双向一致", violations)


def check_tc_arch_02(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-02: 清单声明的配置表/文案表存在，且代码引用的 domains.* 字面量均有落地表。"""
  violations: List[str] = []
  re_literal = re.compile(r'"(domains\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)"')

  for entry in ctx.manifest:
    eid = str(entry.get("id", ""))
    cfg = str(entry.get("config", ""))
    narr = str(entry.get("narrative", ""))
    sub_tables = entry.get("sub_tables", [])

    if not cfg:
      violations.append(f"{eid}: 清单缺少 config 表名")
    elif sub_tables:
      for sub in sub_tables:
        if not ctx.table_file_exists(sub):
          violations.append(f"{eid}: 子配置表缺失 {sub} -> res://{ctx.table_path_rel(sub)}")
    elif not ctx.table_file_exists(cfg):
      violations.append(f"{eid}: 配置表缺失 {cfg} -> res://{ctx.table_path_rel(cfg)}")

    if not narr:
      violations.append(f"{eid}: 清单缺少 narrative 表名")
    elif not ctx.table_file_exists(narr):
      violations.append(f"{eid}: 文案表缺失 {narr} -> res://{ctx.table_path_rel(narr)}")

    files = ctx.domain_gd_files.get(eid, [])
    scanned_literals: Set[str] = set()
    for gd_file in files:
      _, code = ctx.gd_sources[gd_file]
      for m in re_literal.finditer(code):
        scanned_literals.add(m.group(1))

    for table in sorted(scanned_literals):
      exists = ctx.table_file_exists(table) or len(ctx.get_subtables_for_domain(table)) > 0
      if not exists:
        violations.append(f"{eid}: 代码引用了不存在的配置表 {table} -> res://{ctx.table_path_rel(table)}")

  return make_result("TC-ARCH-02: 配置表与文案表齐备且代码字面量全部落地", violations)


def check_tc_arch_03(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-03: 测试文件存在、已在注册表 preload、已进 get_all_test_classes()，总数自洽。"""
  violations: List[str] = []
  if not REGISTRY_FILE.exists():
    violations.append(f"无法读取测试注册表: res://tests/test_registry.gd")
    return make_result("TC-ARCH-03: 测试套件注册完整且注册表条目数自洽", violations)

  registry_text = REGISTRY_FILE.read_text(encoding="utf-8")
  body_start = registry_text.find("static func get_all_test_classes")
  if body_start < 0:
    violations.append("注册表未找到函数: static func get_all_test_classes")
  registry_body = registry_text[body_start:] if body_start >= 0 else ""

  for entry in ctx.manifest:
    eid = str(entry.get("id", ""))
    test_path = str(entry.get("test", ""))
    symbol = str(entry.get("test_symbol", ""))
    if not test_path or not symbol:
      violations.append(f"{eid}: 清单缺少 test 或 test_symbol")
      continue

    rel = test_path.replace("res://", "")
    if not (ctx.root / rel).exists():
      violations.append(f"{eid}: 测试文件缺失: {test_path}")
      continue
    if f'preload("{test_path}")' not in registry_text:
      violations.append(f"{eid}: 测试文件未在注册表 preload: {test_path}")
    if body_start >= 0 and not re.search(rf"\b{re.escape(symbol)}\b", registry_body):
      violations.append(f"{eid}: 测试符号 {symbol} 未出现在 get_all_test_classes()")

  for cc_path in ctx.cross_cutting_suites:
    if f'preload("{cc_path}")' not in registry_text:
      violations.append(f"横切测试套件未在注册表 preload: {cc_path}")

  m_arr = re.search(r"return\s*\[(.*?)\]", registry_body, re.DOTALL)
  actual_symbols: List[str] = []
  if m_arr:
    for line in m_arr.group(1).splitlines():
      c = line.split("#")[0].strip()
      if c:
        for item in c.split(","):
          s = item.strip()
          if s:
            actual_symbols.append(s)

  expected = len(ctx.manifest) + len(ctx.cross_cutting_suites)
  if len(actual_symbols) != expected:
    violations.append(
      f"注册表条目数不匹配: 期望 {expected}（清单 {len(ctx.manifest)} + 横切 {len(ctx.cross_cutting_suites)}），实际 {len(actual_symbols)}"
    )

  return make_result("TC-ARCH-03: 测试套件注册完整且注册表条目数自洽", violations)


def check_tc_arch_04(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-04: 业务代码禁止裸调用 Godot 全局 randf()/randi()/randomize()。"""
  violations: List[str] = []
  scanned = 0

  for gd_file in ctx.backend_files:
    if gd_file.name == RNG_IMPL_FILE:
      continue
    scanned += 1
    raw, _ = ctx.gd_sources[gd_file]
    code = strip_non_code(raw)
    hits: Set[str] = set()
    for m in RANDOM_CALL_RE.finditer(code):
      fn = m.group(1)
      start = m.start()
      if start > 0 and code[start - 1] in IDENT_CHARS:
        continue
      if fn not in hits:
        hits.add(fn)
        rel = "res://" + gd_file.relative_to(ctx.root).as_posix()
        violations.append(f"{rel}: 禁用全局随机调用 {fn}()，请改用 DeterministicRNG")

  if scanned == 0:
    violations.append("未扫描到任何后端脚本: res://backend")

  return make_result("TC-ARCH-04: 业务代码零全局随机调用（确定性约定）", violations)


def check_tc_arch_05(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-05: README 中的领域计数与清单条目数一致。"""
  violations: List[str] = []
  expected = len(ctx.manifest)

  for doc in DOC_FILES:
    doc_path = ctx.root / doc
    res_doc = "res://" + doc
    if not doc_path.exists():
      violations.append(f"文档缺失: {res_doc}")
      continue

    text = doc_path.read_text(encoding="utf-8")
    matched = 0
    for pat in DOMAIN_COUNT_PATTERNS:
      for m in re.finditer(pat, text):
        matched += 1
        found = int(m.group(1))
        if found != expected:
          violations.append(f"{res_doc}: 领域计数 {found} 与清单条目数 {expected} 不一致（片段「{m.group(0).strip()}」）")
    if matched == 0:
      violations.append(f"{res_doc}: 未找到任何领域计数标记，文档已与清单脱钩")

  return make_result("TC-ARCH-05: 文档领域计数与清单条目数一致", violations)


def check_tc_arch_06(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-06: 代码读取的「表 + 键路径」必须在配置表中真实存在。"""
  violations: List[str] = []
  checked = 0

  for entry in ctx.manifest:
    eid = str(entry.get("id", ""))
    files = ctx.domain_gd_files.get(eid, [])
    for gd_file in files:
      _, source = ctx.gd_sources[gd_file]
      rel_gd = "res://" + gd_file.relative_to(ctx.root).as_posix()
      for m in CONFIG_CALL_RE.finditer(source):
        table = m.group(1)
        key = m.group(2)
        if is_dynamic_key(key):
          continue
        checked += 1
        line = source[:m.start()].count("\n") + 1
        keys = ctx.get_table_keys(table)
        if keys is None:
          msg = f"{eid}: 配置表缺失或解析失败 {table} -> res://{ctx.table_path_rel(table)}（引用处 {rel_gd}:{line}）"
          if msg not in violations:
            violations.append(msg)
        elif key not in keys:
          msg = f"{eid}: 表 {table} 缺少键 {key}（引用处 {rel_gd}:{line}）"
          if msg not in violations:
            violations.append(msg)

  if checked == 0:
    violations.append("未扫描到任何静态配置键引用: res://backend/domains")

  return make_result("TC-ARCH-06: 代码读取的配置键在表中真实存在", violations)


def check_tc_arch_07(ctx: ArchitectureAuditContext) -> Dict[str, Any]:
  """TC-ARCH-07: 兼容层退役护栏断言（后端旧表/别名/直发/双路径/死配置彻底清零）。"""
  violations: List[str] = []

  if (ctx.root / "config/descriptions/items.json").exists():
    violations.append("config/descriptions/items.json 必须彻底删除")
  if (ctx.root / "config/narratives/events.json").exists():
    violations.append("config/narratives/events.json 必须彻底删除")

  if (ctx.root / "backend/domains/magic_system/action_card_definition.gd").exists():
    violations.append("backend/domains/magic_system/action_card_definition.gd 必须彻底删除")

  if "legacy_test_path" in MANIFEST_FILE.read_text(encoding="utf-8"):
    violations.append("domains.json 严禁残留 legacy_test_path 字段")

  for gd_file in ctx.backend_files:
    _, code = ctx.gd_sources[gd_file]
    rel = "res://" + gd_file.relative_to(ctx.root).as_posix()
    if "dispatch_rewards_direct" in code:
      violations.append(f"{rel}: 含有 dispatch_rewards_direct 残留引用")
    if "ActionCardDefinition" in code:
      violations.append(f"{rel}: 含有 ActionCardDefinition 残留引用")
    if "_legacy_fallback" in code:
      violations.append(f"{rel}: 含有 _legacy_fallback 残留引用")

  tier_path = ctx.root / "backend/domains/item_namespace_registry/magic_ability_tier_resolver.gd"
  if tier_path.exists():
    _, t_code = ctx.gd_sources.get(tier_path, ("", ""))
    if "infer_tier_candidates(rank: int, registry: MagicTierRegistry = null)" in t_code:
      violations.append("magic_ability_tier_resolver.gd: infer_tier_candidates 必须移除 = null")

  band_path = ctx.root / "backend/domains/item_namespace_registry/magic_rank_band_resolver.gd"
  if band_path.exists():
    _, b_code = ctx.gd_sources.get(band_path, ("", ""))
    if "rank_to_band(rank: int, registry: MagicTierRegistry = null)" in b_code:
      violations.append("magic_rank_band_resolver.gd: rank_to_band 必须移除 = null")

  return make_result("TC-ARCH-07: 兼容层退役护栏断言（后端旧表/别名/直发/双路径/死配置彻底清零）", violations)


def check_tc_arch_08(ctx: ArchitectureAuditContext) -> List[Dict[str, Any]]:
  """TC-ARCH-08A & TC-ARCH-08B: 账号槽位解算器边界隔离护栏。"""
  violations_a: List[str] = []
  violations_b: List[str] = []
  solver_path = ctx.root / "backend/domains/account/account_slot_binding_solver.gd"

  if not solver_path.exists():
    violations_a.append("目标文件不存在: res://backend/domains/account/account_slot_binding_solver.gd")
    violations_b.append("目标文件不存在: res://backend/domains/account/account_slot_binding_solver.gd")
  else:
    _, content = ctx.gd_sources.get(solver_path, ("", ""))
    if "res://backend/infrastructure/" in content:
      violations_a.append("account_slot_binding_solver.gd 严禁包含 res://backend/infrastructure/ 依赖")
    if re.search(r"\bGameLoopStateStack\b", content):
      violations_b.append("account_slot_binding_solver.gd 严禁引用 GameLoopStateStack 符号")

  return [
    make_result("TC-ARCH-08A: 账号槽位解算器严禁包含基础设施层预加载路径", violations_a),
    make_result("TC-ARCH-08B: 账号槽位解算器严禁引用 GameLoopStateStack", violations_b),
  ]


def run_all_checks() -> Tuple[bool, List[Dict[str, Any]], str, float]:
  """运行全量 9 大架构合规性断言并统计耗时。"""
  t0 = time.perf_counter()
  ctx = ArchitectureAuditContext(ROOT)
  ctx.initialize()

  results: List[Dict[str, Any]] = [
    check_tc_arch_01(ctx),
    check_tc_arch_02(ctx),
    check_tc_arch_03(ctx),
    check_tc_arch_04(ctx),
    check_tc_arch_05(ctx),
    check_tc_arch_06(ctx),
    check_tc_arch_07(ctx),
    *check_tc_arch_08(ctx),
  ]

  elapsed = time.perf_counter() - t0
  total_domains = len(ctx.manifest) + len(ctx.cross_cutting_suites)
  domain_title = f"Domain {total_domains}: 架构护栏与领域清单一致性"
  all_passed = all(r["passed"] for r in results)
  return all_passed, results, domain_title, elapsed


def main() -> int:
  """命令行主入口。"""
  parser = argparse.ArgumentParser(description="WebGames 架构护栏原生静态审计引擎")
  parser.add_argument("--json", action="store_true", help="输出 JSON 格式聚合报告")
  args = parser.parse_args()

  all_passed, results, domain_title, elapsed = run_all_checks()

  if args.json:
    report = {
      "domain": domain_title,
      "all_passed": all_passed,
      "elapsed_sec": round(elapsed, 3),
      "results": results,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if all_passed else 1

  print(f"[audit-arch] {domain_title}")
  for r in results:
    passed = r["passed"]
    print(f"  [{'PASS' if passed else 'FAIL'}] {r['test']}")
    if not passed:
      for v in r["violations"]:
        print(f"        - {v}")

  if all_passed:
    print("【审查结论】通过（架构护栏无违规）")
    return 0
  else:
    print("【审查结论】未通过（架构护栏存在违规项）")
    return 1


if __name__ == "__main__":
  sys.exit(main())
