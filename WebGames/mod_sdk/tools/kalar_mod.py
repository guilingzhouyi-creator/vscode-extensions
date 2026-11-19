#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · Unified CLI Facade)
# 文件路径: WebGames/mod_sdk/tools/kalar_mod.py
# 架构定位: MOD开发工具链统一入口门面 (Unified Mod CLI Interface)
# 依赖与触发: 触发方: CLI / 用户 / CI / 自动化管道 | 上游: scaffold_mod / check_mod / cook_assets / preview_mod / play_mod | 下游: 终端交互 / 校验报告 / 模组包 | 运行时: Python 3.10+
# 职责说明: 聚合 init、check、cook、preview、play、pack、dispatch、workbench、bake 九大核心子命令，提供一致的开发者交互界面与工件打包
# 退出语义与设计依据: 退出码: 0=操作成功, 1=业务校验失败, 2=参数错误/IO异常 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/kalar_mod.py --version
#   python mod_sdk/tools/kalar_mod.py init --id my_mod --name "我的模组" --output-dir ./my_mod
#   python mod_sdk/tools/kalar_mod.py check ./my_mod
#   python mod_sdk/tools/kalar_mod.py cook ./my_mod --check
#   python mod_sdk/tools/kalar_mod.py preview ./my_mod --simulate
#   python mod_sdk/tools/kalar_mod.py play ./my_mod --with-hud
#   python mod_sdk/tools/kalar_mod.py dispatch --action ESC_QUERY_READINESS
#   python mod_sdk/tools/kalar_mod.py pack ./my_mod
# ==============================================================================
"""纯净世界引擎 MOD 统一开发套件 CLI 门面。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import argparse
import json
import sys

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
from kalar_mod_parser_core import register_core_subparsers
from kalar_mod_parser_ops import register_ops_subparsers
from play_mod import PlaySuiteContext, play_mod_suite, print_transcript_text
from play_mod_interactive import InteractivePlayConfig, play_mod_interactive
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
                print(
                    json.dumps({"valid": False, "error": err_msg}, ensure_ascii=False)
                )
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
            InteractivePlayConfig(
                mod_paths=paths,
                player_name=args.player_name,
                race_id=args.race_id,
                gender=args.gender,
                origin_id_param=args.origin_id,
                trait_pair_param=args.trait_pair,
                reroll_nonce=args.reroll_nonce,
                seed=args.seed,
            )
        )
        if args.as_json:
            print(json.dumps(transcript, ensure_ascii=False))
        else:
            print_transcript_text(transcript)
        return 0 if is_success else 1

    transcript, is_success = play_mod_suite(
        PlaySuiteContext(
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
            with_hud=getattr(args, "with_hud", False),
        )
    )
    if args.as_json:
        print(json.dumps(transcript, ensure_ascii=False, indent=2))
    else:
        print_transcript_text(transcript)
    return 0 if is_success else 1


def _handle_dispatch(args: argparse.Namespace) -> int:
    """分发 dispatch 子命令：离线派发统一协议请求并执行强类型信封校验。"""
    from kalar_protocol_client import KalarProtocolClient, ProtocolRequestContext

    try:
        payload_dict = json.loads(args.payload) if args.payload else {}
    except Exception as exc:
        err_msg = f"无法解析 payload JSON: {exc}"
        if args.as_json:
            print(
                json.dumps({"success": False, "error": err_msg}, ensure_ascii=False)
            )
        else:
            print(f"{Style.RED}❌ 错误: {err_msg}{Style.RESET}", file=sys.stderr)
        return 2

    client = KalarProtocolClient()
    req = client.build_request(
        ProtocolRequestContext(
            actor_type=args.actor,
            domain=args.domain,
            action_type=args.action,
            payload=payload_dict,
        )
    )
    resp = client.send(req)

    if args.as_json:
        print(json.dumps(resp, ensure_ascii=False, indent=2))
    else:
        if resp.get("success"):
            print(
                f"{Style.GREEN}✔ 协议派发成功{Style.RESET} [ReqID={resp.get('request_id')}]"
            )
            print(
                f"  • 响应动作   : {resp.get('data', {}).get('action', args.action)}"
            )
            print(f"  • 服务端时间 : {resp.get('server_timestamp_ms')}ms")
            print(
                f"  • 载荷摘要   : {json.dumps(resp.get('data', {}), ensure_ascii=False)}"
            )
        else:
            print(
                f"{Style.RED}❌ 协议派发受阻{Style.RESET} [ReqID={resp.get('request_id')}]"
            )
            print(f"  • 错误代码   : {resp.get('error_code', 'UNKNOWN')}")
            print(f"  • 提示信息   : {resp.get('error_message', 'None')}")
            if resp.get("data"):
                print(
                    f"  • 详细信息   : {json.dumps(resp.get('data', {}), ensure_ascii=False)}"
                )

    return 0 if resp.get("success") else 1


# ==============================================================================
# 二、pack 子命令（校验并编译封装标准 .kmod 二进制包）
# ==============================================================================
def _handle_pack(args: argparse.Namespace) -> int:
    """分发 pack 子命令：验证模组并打包为 .kmod 分发包。"""
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
                print(
                    json.dumps(
                        {
                            "success": False,
                            "error": "模组静态诊断未通过，拒绝打包",
                            "diagnostics": [d.to_dict() for d in check_diags],
                        },
                        ensure_ascii=False,
                    )
                )
            else:
                print(
                    f"{Style.RED}❌ 打包中止: MOD 静态诊断存在 {len(check_diags)} 处违规错误！{Style.RESET}",
                    file=sys.stderr,
                )
                print_cli_report(valid_mod, check_diags, target_dir)
            return 1

        # 若存在 assets 目录，前置资产审计
        assets_dir = target_dir / "assets"
        if assets_dir.is_dir():
            valid_assets, asset_diags, _ = cook_assets(target_dir, check_only=True)
            if not valid_assets:
                if args.as_json:
                    print(
                        json.dumps(
                            {
                                "success": False,
                                "error": "assets/ 资产审计门禁未通过，拒绝打包",
                                "diagnostics": [d.to_dict() for d in asset_diags],
                            },
                            ensure_ascii=False,
                        )
                    )
                else:
                    print(
                        f"{Style.RED}❌ 打包中止: assets/ 资产审计存在违规或 manifest.json 未更新！{Style.RESET}",
                        file=sys.stderr,
                    )
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

    from kalar_workbench import handle_kmod_pack_cli

    out_p = Path(args.output).resolve() if args.output else None
    return handle_kmod_pack_cli(target_dir, out_p, args.as_json, pack_id, version)


def _handle_workbench(args: argparse.Namespace) -> int:
    """分发 workbench 子命令：开发者集成工作台核心命令台。"""
    from kalar_workbench import handle_workbench_cli

    return handle_workbench_cli(args)


def _handle_bake(args: argparse.Namespace) -> int:
    """分发 bake 子命令：将 JSON 配置表或目录编译为高纯度紧凑二进制流 (.kdat)。"""
    try:
        from kalar_config_compiler import handle_bake_cli
    except ImportError:
        scripts_py_lib = TOOLS_DIR.parent.parent / "scripts" / "py" / "lib"
        if str(scripts_py_lib) not in sys.path:
            sys.path.insert(0, str(scripts_py_lib))
        from kalar_config_compiler import handle_bake_cli
    return handle_bake_cli(args)


def _handle_install(args: argparse.Namespace) -> int:
    """安装 .kmod 归档包或 MOD 源目录到引擎 mods 目标根目录。"""
    from kalar_dev_pipeline import handle_install_cli

    return handle_install_cli(args, TOOLS_DIR)


def _handle_dev(args: argparse.Namespace) -> int:
    """分发 dev 子命令：调试(JSON) 与正式封装(.kmod/.kdat) 一体化流水线。"""
    from kalar_dev_pipeline import handle_dev_cli

    return handle_dev_cli(args, TOOLS_DIR)


def _handle_inspect(args: argparse.Namespace) -> int:
    """分发 inspect 子命令：检查 .kmod 二进制段或反向导出 JSON 调试工作区。"""
    from kalar_dev_pipeline import handle_inspect_cli

    return handle_inspect_cli(args)


# ==============================================================================
# 三、CLI 参数解析器构建 (Argparse Setup)
# ==============================================================================
def _build_parser() -> argparse.ArgumentParser:
    """构建统一 CLI 参数解析器。"""
    parser = argparse.ArgumentParser(
        prog="kalar-mod",
        description="纯净世界引擎 MOD 统一开发套件与工具链门面 (Mod SDK CLI Facade)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("-v", "--version", action="version", version=VERSION_STRING)

    subparsers = parser.add_subparsers(
        dest="subcommand", title="核心子命令", metavar="<command>"
    )
    register_core_subparsers(subparsers)

    # 5. play
    p_play = subparsers.add_parser(
        "play", help="全自动端到端试玩推演与结构化战报发生器"
    )
    p_play.add_argument(
        "mod_dirs", nargs="+", help="参与试玩演习的一个或多个 MOD 根目录路径"
    )
    p_play.add_argument(
        "--name",
        default="阿尔温",
        dest="player_name",
        help="模拟角色自定义名称 (默认: 阿尔温)",
    )
    p_play.add_argument(
        "--race", default="HUMAN", dest="race_id", help="模拟角色种族 (默认: HUMAN)"
    )
    p_play.add_argument(
        "--gender", default="FEMALE", dest="gender", help="模拟角色性别 (默认: FEMALE)"
    )
    p_play.add_argument(
        "--origin", default=None, dest="origin_id", help="指定演习创角身世 ID"
    )
    p_play.add_argument(
        "--trait-pair",
        default=None,
        dest="trait_pair",
        help="指定演习因果天赋配对预设 ID",
    )
    p_play.add_argument(
        "--reroll-nonce",
        type=int,
        default=0,
        dest="reroll_nonce",
        help="六维属性重掷随机数 (默认: 0)",
    )
    p_play.add_argument(
        "--seed",
        default="PURE_WORLD_SEED_DEFAULT",
        dest="seed",
        help="确定性创角与推演种子 (默认: PURE_WORLD_SEED_DEFAULT)",
    )
    p_play.add_argument(
        "--choices",
        default=None,
        dest="choices",
        help="交互分支决策序列 (逗号分隔，如 0,1 或 NODE_ID)",
    )
    p_play.add_argument(
        "--choice-strategy",
        choices=["first", "random", "all-branches"],
        default="first",
        dest="choice_strategy",
        help="交互分支遍历决策策略 (默认: first)",
    )
    p_play.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="输出机器可读的结构化 JSON 战报",
    )
    p_play.add_argument(
        "--interactive",
        action="store_true",
        dest="interactive",
        help="启动长程交互式单步推演会话 (Agent stdio 流式推演)",
    )
    p_play.add_argument(
        "--with-hud",
        action="store_true",
        dest="with_hud",
        help="在推演战报中附带初始主页 HUD 快照切片",
    )

    register_ops_subparsers(subparsers)
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
        "dispatch": _handle_dispatch,
        "workbench": _handle_workbench,
        "bake": _handle_bake,
        "install": _handle_install,
        "dev": _handle_dev,
        "inspect": _handle_inspect,
    }

    handler = handlers.get(args.subcommand)
    if not handler:
        parser.error(f"未知子命令: {args.subcommand}")

    code = handler(args)
    sys.exit(code)


if __name__ == "__main__":
    main()
