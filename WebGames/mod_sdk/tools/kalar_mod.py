#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · Unified CLI Facade)
# 文件路径: WebGames/mod_sdk/tools/kalar_mod.py
# 架构定位: MOD开发工具链统一入口门面 (Unified Mod CLI Interface)
# 依赖与触发: 触发方: CLI / 用户 / CI / 自动化管道 | 上游: scaffold_mod / check_mod / cook_assets / preview_mod / play_mod | 下游: 终端交互 / 校验报告 / 模组包 | 运行时: Python 3.10+
# 职责说明: 聚合 init、check、cook、preview、play、pack 六大核心子命令，提供一致的开发者交互界面与工件打包
# 退出语义与设计依据: 退出码: 0=操作成功, 1=业务校验失败, 2=参数错误/IO异常 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/kalar_mod.py --version
#   python mod_sdk/tools/kalar_mod.py init --id my_mod --name "我的模组" --output-dir ./my_mod
#   python mod_sdk/tools/kalar_mod.py check ./my_mod
#   python mod_sdk/tools/kalar_mod.py cook ./my_mod --check
#   python mod_sdk/tools/kalar_mod.py preview ./my_mod --simulate
#   python mod_sdk/tools/kalar_mod.py play ./my_mod
#   python mod_sdk/tools/kalar_mod.py pack ./my_mod
# ==============================================================================
"""卡拉尔世界引擎 MOD 统一开发套件 CLI 门面。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any

VERSION_STRING: str = "kalar-mod v1.0.0"

# 确保本工具同级目录在 sys.path 中
TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from check_mod import (
    DiagnosticItem,
    print_cli_report,
    validate_mod,
    validate_multi_mods,
)
from cook_assets import cook_assets, print_cook_report
from play_mod import play_mod_interactive, play_mod_suite, print_transcript_text
from preview_mod import preview_overview, simulate_mod
from scaffold_mod import scaffold_mod


def _ensure_utf8_stdout() -> None:
    """保障跨平台控制台 UTF-8 输出，防止 Windows GBK 编码崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


class Style:
    """终端彩色与结构化输出格式化工具。"""
    USE_COLOR = sys.stdout.isatty() if hasattr(sys.stdout, "isatty") else False
    RESET = "\033[0m" if USE_COLOR else ""
    BOLD = "\033[1m" if USE_COLOR else ""
    CYAN = "\033[36m" if USE_COLOR else ""
    GREEN = "\033[32m" if USE_COLOR else ""
    YELLOW = "\033[33m" if USE_COLOR else ""
    RED = "\033[31m" if USE_COLOR else ""
    MAGENTA = "\033[35m" if USE_COLOR else ""


# ==============================================================================
# 一、子命令分发逻辑 (Subcommand Handlers)
# ==============================================================================
def _handle_init(args: argparse.Namespace) -> int:
    """分发 init 子命令：脚手架骨架生成。"""
    out_dir = Path(args.output_dir) if args.output_dir else Path(args.pack_id)
    return scaffold_mod(
        pack_id=args.pack_id,
        pack_name=args.pack_name,
        race_id=args.race_id,
        out_dir=out_dir,
        with_destiny=args.with_destiny,
        inline_text=args.inline_text,
        tier=args.tier,
    )


def _handle_check(args: argparse.Namespace) -> int:
    """分发 check 子命令：纯静态轻量自愈诊断。"""
    raw_dirs: list[str] = []
    if args.mod_dir:
        raw_dirs.append(args.mod_dir)
    if args.multi_dirs:
        raw_dirs.extend(args.multi_dirs)

    if not raw_dirs:
        raw_dirs.append(".")

    targets: list[Path] = []
    seen: set[Path] = set()
    for d in raw_dirs:
        resolved = Path(d).resolve()
        if resolved not in seen:
            seen.add(resolved)
            targets.append(resolved)

    for p in targets:
        if not p.is_dir():
            err_msg = f"MOD 目标目录不存在: {p}"
            if args.as_json:
                print(json.dumps({"valid": False, "error": err_msg}, ensure_ascii=False))
            else:
                print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
            return 2

    if args.multi_dirs is not None or len(targets) > 1:
        valid, diags = validate_multi_mods(targets)
        report_target = targets[0]
    else:
        report_target = targets[0]
        valid, diags = validate_mod(report_target)

    if args.as_json:
        payload = {
            "valid": valid,
            "checked_packs": [d.name for d in targets],
            "error_count": len(diags),
            "diagnostics": [d.to_dict() for d in diags],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cli_report(valid, diags, report_target)

    return 0 if valid else 1


def _handle_cook(args: argparse.Namespace) -> int:
    """分发 cook 子命令：资产预编译与审计。"""
    target_dir = Path(args.mod_dir).resolve()
    if not target_dir.is_dir():
        err_msg = f"MOD 目标目录不存在: {target_dir}"
        if args.as_json:
            print(json.dumps({"valid": False, "error": err_msg}, ensure_ascii=False))
        else:
            print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
        return 2

    valid, diags, manifest = cook_assets(target_dir, check_only=args.check_only)
    if args.as_json:
        payload = {
            "valid": valid,
            "mod_dir": str(target_dir),
            "check_only": args.check_only,
            "asset_count": manifest.get("asset_count", 0),
            "total_size_bytes": manifest.get("total_size_bytes", 0),
            "diagnostics": [d.to_dict() for d in diags],
            "manifest": manifest,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cook_report(valid, diags, manifest, target_dir, args.check_only)

    return 0 if valid else 1


def _handle_preview(args: argparse.Namespace) -> int:
    """分发 preview 子命令：无头剧情演习推演。"""
    target_dir = Path(args.mod_dir).resolve()
    if not target_dir.is_dir():
        err_msg = f"MOD 目标目录不存在: {target_dir}"
        if args.as_json:
            print(json.dumps({"error": err_msg}, ensure_ascii=False))
        else:
            print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
        return 2

    if args.simulate:
        return simulate_mod(
            target_dir,
            race_id=args.race_id,
            player_name=args.player_name,
            origin_id=args.origin_id,
            as_json=args.as_json,
        )
    return preview_overview(
        target_dir,
        race_id=args.race_id,
        origin_id=args.origin_id,
        as_json=args.as_json,
    )


def _handle_play(args: argparse.Namespace) -> int:
    """分发 play 子命令：全自动端到端试玩推演。"""
    paths = [Path(p).resolve() for p in args.mod_dirs]
    for p in paths:
        if not p.is_dir():
            err_msg = f"MOD 目标目录不存在: {p}"
            if args.as_json:
                print(json.dumps({"error": err_msg}, ensure_ascii=False))
            else:
                print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
            return 2

    if args.interactive:
        transcript, is_success = play_mod_interactive(
            mod_paths=paths,
            player_name=args.player_name,
            race_id=args.race_id,
            gender=args.gender,
            origin_id_param=args.origin_id,
            trait_pair_param=args.trait_pair,
            reroll_nonce=args.reroll_nonce,
            seed=args.seed,
        )
        if args.as_json:
            print(json.dumps(transcript, ensure_ascii=False))
        else:
            print_transcript_text(transcript)
        return 0 if is_success else 1

    transcript, is_success = play_mod_suite(
        mod_paths=paths,
        player_name=args.player_name,
        race_id=args.race_id,
        gender=args.gender,
        origin_id_param=args.origin_id,
        trait_pair_param=args.trait_pair,
        reroll_nonce=args.reroll_nonce,
        seed=args.seed,
        choices_param=args.choices,
        choice_strategy=args.choice_strategy,
    )
    if args.as_json:
        print(json.dumps(transcript, ensure_ascii=False, indent=2))
    else:
        print_transcript_text(transcript)
    return 0 if is_success else 1


# ==============================================================================
# 二、pack 子命令（校验并打包分发 ZIP 包）
# ==============================================================================
EXCLUDED_PACK_NAMES: frozenset[str] = frozenset({
    "__pycache__", ".git", ".gitignore", ".DS_Store", "Thumbs.db", ".tmp",
})


def _should_exclude_from_pack(rel_path: Path) -> bool:
    """判断文件或目录是否应从模组发布包中排除。"""
    for part in rel_path.parts:
        if part in EXCLUDED_PACK_NAMES or part.endswith(".tmp") or part.endswith(".zip"):
            return True
    return False


def _compute_file_sha256(file_path: Path) -> str:
    """计算单个文件的 SHA-256 哈希值。"""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as fp:
        while chunk := fp.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def _handle_pack(args: argparse.Namespace) -> int:
    """分发 pack 子命令：验证模组并打包为 .zip 分发包。"""
    target_dir = Path(args.mod_dir).resolve()
    if not target_dir.is_dir():
        err_msg = f"MOD 目标目录不存在: {target_dir}"
        if args.as_json:
            print(json.dumps({"success": False, "error": err_msg}, ensure_ascii=False))
        else:
            print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
        return 2

    # 1. 静态前置校验 (除非指定 --no-check)
    if not args.no_check:
        valid_mod, check_diags = validate_mod(target_dir)
        if not valid_mod:
            if args.as_json:
                print(json.dumps({
                    "success": False,
                    "error": "模组静态诊断未通过，拒绝打包",
                    "diagnostics": [d.to_dict() for d in check_diags],
                }, ensure_ascii=False))
            else:
                print(f"{Style.RED}❌ 打包中止: MOD 静态诊断存在 {len(check_diags)} 处违规错误！{Style.RESET}", file=sys.stderr)
                print_cli_report(valid_mod, check_diags, target_dir)
            return 1

        # 若存在 assets 目录，前置资产审计
        assets_dir = target_dir / "assets"
        if assets_dir.is_dir():
            valid_assets, asset_diags, _ = cook_assets(target_dir, check_only=True)
            if not valid_assets:
                if args.as_json:
                    print(json.dumps({
                        "success": False,
                        "error": "assets/ 资产审计门禁未通过，拒绝打包",
                        "diagnostics": [d.to_dict() for d in asset_diags],
                    }, ensure_ascii=False))
                else:
                    print(f"{Style.RED}❌ 打包中止: assets/ 资产审计存在违规或 manifest.json 未更新！{Style.RESET}", file=sys.stderr)
                return 1

    # 2. 读取 pack.json 确定默认包名
    manifest_file = target_dir / "pack.json"
    pack_id = target_dir.name
    version = "1.0.0"
    if manifest_file.is_file():
        try:
            m_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            if isinstance(m_data, dict):
                pack_id = str(m_data.get("pack_id") or pack_id)
                version = str(m_data.get("version") or version)
        except Exception:
            pass

    out_zip = Path(args.output).resolve() if args.output else target_dir.parent / f"{pack_id}_v{version}.zip"

    # 3. 收集并打包所有有效文件
    packaged_files: list[str] = []
    total_uncompressed_bytes = 0

    try:
        out_zip.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for root, dirs, files in os.walk(target_dir):
                root_path = Path(root)
                rel_root = root_path.relative_to(target_dir)
                if _should_exclude_from_pack(rel_root):
                    dirs.clear()
                    continue

                for f in sorted(files):
                    file_path = root_path / f
                    rel_file = file_path.relative_to(target_dir)
                    if _should_exclude_from_pack(rel_file):
                        continue

                    arcname = rel_file.as_posix()
                    zf.write(file_path, arcname)
                    packaged_files.append(arcname)
                    total_uncompressed_bytes += file_path.stat().st_size
    except OSError as err:
        err_msg = f"生成 ZIP 压缩包失败: {err}"
        if args.as_json:
            print(json.dumps({"success": False, "error": err_msg}, ensure_ascii=False))
        else:
            print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
        return 1

    zip_size_bytes = out_zip.stat().st_size
    zip_sha256 = _compute_file_sha256(out_zip)

    if args.as_json:
        payload = {
            "success": True,
            "pack_id": pack_id,
            "version": version,
            "output_zip": str(out_zip),
            "file_count": len(packaged_files),
            "uncompressed_bytes": total_uncompressed_bytes,
            "compressed_bytes": zip_size_bytes,
            "sha256": zip_sha256,
            "files": packaged_files,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("==============================================================================")
    print(f"{Style.GREEN}📦 MOD 打包成功: {pack_id} (v{version}){Style.RESET}")
    print("------------------------------------------------------------------------------")
    print(f"  • 输出路径   : {out_zip}")
    print(f"  • 文件总数   : {len(packaged_files)} 项")
    print(f"  • 原始大小   : {round(total_uncompressed_bytes / 1024, 2)} KB")
    print(f"  • 压缩后大小 : {round(zip_size_bytes / 1024, 2)} KB")
    print(f"  • SHA-256    : {zip_sha256}")
    print("==============================================================================")
    return 0


# ==============================================================================
# 三、CLI 参数解析器构建 (Argparse Setup)
# ==============================================================================
def _build_parser() -> argparse.ArgumentParser:
    """构建统一 CLI 参数解析器。"""
    parser = argparse.ArgumentParser(
        prog="kalar-mod",
        description="卡拉尔世界引擎 MOD 统一开发套件与工具链门面 (Mod SDK CLI Facade)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("-v", "--version", action="version", version=VERSION_STRING)

    subparsers = parser.add_subparsers(dest="subcommand", title="核心子命令", metavar="<command>")

    # 1. init
    p_init = subparsers.add_parser("init", help="初始化生成新的卡拉尔 MOD 项目骨架")
    p_init.add_argument("--id", required=True, dest="pack_id", help="MOD 包唯一标识符 (如 mod_elf_story)")
    p_init.add_argument("--name", required=True, dest="pack_name", help="MOD 人类可读名称")
    p_init.add_argument("--race", default="HUMAN", dest="race_id", help="默认绑定的角色种族 (默认: HUMAN)")
    p_init.add_argument("--output-dir", default=None, dest="output_dir", help="生成的目标目录路径 (默认: 当前目录下 <id>)")
    p_init.add_argument(
        "--tier",
        type=int,
        choices=[1, 2, 3],
        default=2,
        dest="tier",
        help="模组复杂度层级 (1=极简纯剧情, 2=命途扩展, 3=全量富媒体与大魔改, 默认: 2)",
    )
    p_init.add_argument(
        "--with-destiny",
        action="store_true",
        dest="with_destiny",
        default=True,
        help="生成命途扩展配置文件 destinies.json (默认开启)",
    )
    p_init.add_argument(
        "--no-destiny",
        action="store_false",
        dest="with_destiny",
        help="跳过生成 destinies.json",
    )
    p_init.add_argument(
        "--inline-text",
        action="store_true",
        dest="inline_text",
        default=False,
        help="在因果图元中直接内联文本，免除外部多语言字典强依赖",
    )

    # 2. check
    p_check = subparsers.add_parser("check", help="纯静态轻量自愈诊断 MOD 清单、DAG 因果图元与资产引用")
    p_check.add_argument("mod_dir", nargs="?", default=".", help="待诊断的 MOD 根目录路径 (默认: 当前目录)")
    p_check.add_argument(
        "--check-multi",
        nargs="+",
        dest="multi_dirs",
        default=None,
        help="多包联合冲突预检的附加或完整 MOD 目录列表",
    )
    p_check.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 诊断信息")

    # 3. cook
    p_cook = subparsers.add_parser("cook", help="扫描、审计与预编译 assets/ 资源清单 (manifest.json)")
    p_cook.add_argument("mod_dir", nargs="?", default=".", help="待审计/预编译的 MOD 根目录路径 (默认: 当前目录)")
    p_cook.add_argument(
        "--check",
        action="store_true",
        dest="check_only",
        help="以只读门禁模式运行：校验格式白名单、体积预算与 manifest.json 是否最新",
    )
    p_cook.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 报告")

    # 4. preview
    p_prev = subparsers.add_parser("preview", help="无头演习推演 MOD 剧情流转与四级路由分支")
    p_prev.add_argument("mod_dir", nargs="?", default=".", help="待演习的 MOD 根目录路径 (默认: 当前目录)")
    p_prev.add_argument("--simulate", action="store_true", dest="simulate", help="启动全分支剧情推演与文本占位符水化")
    p_prev.add_argument("--race", default="HUMAN", dest="race_id", help="模拟角色的种族 (默认: HUMAN)")
    p_prev.add_argument("--name", default="阿尔温", dest="player_name", help="模拟角色的名称 (默认: 阿尔温)")
    p_prev.add_argument("--origin", default=None, dest="origin_id", help="指定演习选定的创角身世 ID")
    p_prev.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 演习报告")

    # 5. play
    p_play = subparsers.add_parser("play", help="全自动端到端试玩推演与结构化战报发生器")
    p_play.add_argument("mod_dirs", nargs="+", help="参与试玩演习的一个或多个 MOD 根目录路径")
    p_play.add_argument("--name", default="阿尔温", dest="player_name", help="模拟角色自定义名称 (默认: 阿尔温)")
    p_play.add_argument("--race", default="HUMAN", dest="race_id", help="模拟角色种族 (默认: HUMAN)")
    p_play.add_argument("--gender", default="FEMALE", dest="gender", help="模拟角色性别 (默认: FEMALE)")
    p_play.add_argument("--origin", default=None, dest="origin_id", help="指定演习创角身世 ID")
    p_play.add_argument("--trait-pair", default=None, dest="trait_pair", help="指定演习因果天赋配对预设 ID")
    p_play.add_argument("--reroll-nonce", type=int, default=0, dest="reroll_nonce", help="六维属性重掷随机数 (默认: 0)")
    p_play.add_argument("--seed", default="KALAR_SEED_DEFAULT", dest="seed", help="确定性创角与推演种子 (默认: KALAR_SEED_DEFAULT)")
    p_play.add_argument("--choices", default=None, dest="choices", help="交互分支决策序列 (逗号分隔，如 0,1 或 NODE_ID)")
    p_play.add_argument(
        "--choice-strategy",
        choices=["first", "random", "all-branches"],
        default="first",
        dest="choice_strategy",
        help="交互分支遍历决策策略 (默认: first)",
    )
    p_play.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 战报")
    p_play.add_argument(
        "--interactive",
        action="store_true",
        dest="interactive",
        help="启动长程交互式单步推演会话 (Agent stdio 流式推演)",
    )
    p_play.add_argument("--simulate", action="store_true", dest="simulate", help="启动推演模式（兼容参数）")

    # 6. pack
    p_pack = subparsers.add_parser("pack", help="验证并打包 MOD 为 .zip 分发包")
    p_pack.add_argument("mod_dir", help="待打包的 MOD 根目录路径")
    p_pack.add_argument("-o", "--output", default=None, dest="output", help="生成的目标 ZIP 压缩包路径 (可选)")
    p_pack.add_argument(
        "--no-check",
        action="store_true",
        dest="no_check",
        help="跳过打包前的静态自愈诊断与资产审计门禁",
    )
    p_pack.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 打包结果")

    return parser


def main() -> None:
    """门面主函数入口。"""
    _ensure_utf8_stdout()
    parser = _build_parser()

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()
    if not args.subcommand:
        parser.print_help()
        sys.exit(0)

    handlers = {
        "init": _handle_init,
        "check": _handle_check,
        "cook": _handle_cook,
        "preview": _handle_preview,
        "play": _handle_play,
        "pack": _handle_pack,
    }

    handler = handlers.get(args.subcommand)
    if not handler:
        parser.error(f"未知子命令: {args.subcommand}")

    code = handler(args)
    sys.exit(code)


if __name__ == "__main__":
    main()
