#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 协议客户端引擎)
# 文件路径: WebGames/mod_sdk/tools/kalar_protocol_client.py
# 架构定位: 跨端全域统一通信协议客户端与本地模拟派发引擎 (Protocol Client & Mock Dispatcher)
# 依赖与触发: 触发方: CLI / kalar_mod.py / 外部 Agent | 上游: capabilities.json & schemas/** | 运行时: Python 3.10+
# 职责说明: 构造统一请求信封、执行离线 Schema 校验、提供人类租约与领域状态机模拟、输出标准响应
# 退出语义与设计依据: 退出码: 0=派发成功, 1=信封无效/租约阻断, 2=参数解析或IO异常 | 设计依据: Phase 122/123 统一通信协议规范
# ==============================================================================
"""卡拉尔世界引擎 MOD 开发者轻量统一协议客户端与本地模拟派发引擎。"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TOOLS_DIR = Path(__file__).resolve().parent
MOD_SDK_DIR = TOOLS_DIR.parent
SCHEMAS_DIR = MOD_SDK_DIR / "schemas"
CAPABILITIES_PATH = MOD_SDK_DIR / "capabilities.json"


def ensure_utf8_stdout() -> None:
    """保障 Windows 下控制台 UTF-8 输出。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_load_json(file_path: Path) -> Dict[str, Any]:
    """安全读取并解析 JSON 文件。"""
    if not file_path.is_file():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception as exc:
        print(f"[WARN] 读取 JSON 失败: {file_path} ({exc})", file=sys.stderr)
        return {}


def validate_client_request_envelope(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """离线严格校验客户端请求信封 (client_request_envelope.schema.json)。"""
    errors: List[str] = []
    if not isinstance(data, dict):
        return False, ["请求信封根节点必须为字典对象"]

    required_keys = ["request_id", "actor_type", "domain", "action_type", "payload", "client_timestamp_ms"]
    for req in required_keys:
        if req not in data:
            errors.append(f"缺失必需字段: {req}")

    if "request_id" in data and (not isinstance(data["request_id"], str) or len(data["request_id"]) < 1):
        errors.append("request_id 必须为非空字符串")

    if "actor_type" in data and data["actor_type"] not in ["HUMAN_UI", "AGENT"]:
        errors.append(f"actor_type 必须为 HUMAN_UI 或 AGENT，实际为: {data['actor_type']}")

    if "domain" in data and (not isinstance(data["domain"], str) or len(data["domain"]) < 1):
        errors.append("domain 必须为非空字符串")

    if "action_type" in data and (not isinstance(data["action_type"], str) or len(data["action_type"]) < 1):
        errors.append("action_type 必须为非空字符串")

    if "payload" in data and not isinstance(data["payload"], dict):
        errors.append("payload 必须为字典对象")

    if "lease_nonce" in data and (not isinstance(data["lease_nonce"], int) or data["lease_nonce"] < 0):
        errors.append("lease_nonce 必须为非负整数")

    if "client_timestamp_ms" in data and (not isinstance(data["client_timestamp_ms"], int) or data["client_timestamp_ms"] < 0):
        errors.append("client_timestamp_ms 必须为非负物理毫秒时间戳")

    allowed_keys = {
        "request_id", "session_token", "account_id", "character_id",
        "actor_type", "domain", "action_type", "payload",
        "lease_nonce", "client_timestamp_ms",
    }
    for k in data.keys():
        if k not in allowed_keys:
            errors.append(f"检测到未定义扩展字段: {k}")

    return len(errors) == 0, errors


def validate_unified_response_envelope(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """离线严格校验服务端响应信封 (unified_response_envelope.schema.json)。"""
    errors: List[str] = []
    if not isinstance(data, dict):
        return False, ["响应信封根节点必须为字典对象"]

    required_keys = ["request_id", "is_success", "payload", "server_timestamp_ms"]
    for req in required_keys:
        if req not in data:
            errors.append(f"缺失必需字段: {req}")

    if "request_id" in data and not isinstance(data["request_id"], str):
        errors.append("request_id 必须为字符串")

    if "is_success" in data and not isinstance(data["is_success"], bool):
        errors.append("is_success 必须为布尔值")

    if "payload" in data and not isinstance(data["payload"], dict):
        errors.append("payload 必须为字典对象")

    if "server_timestamp_ms" in data and (not isinstance(data["server_timestamp_ms"], int) or data["server_timestamp_ms"] < 0):
        errors.append("server_timestamp_ms 必须为非负物理毫秒时间戳")

    allowed_keys = {
        "request_id", "is_success", "payload", "error_code", "message", "server_timestamp_ms"
    }
    for k in data.keys():
        if k not in allowed_keys:
            errors.append(f"检测到未定义扩展字段: {k}")

    return len(errors) == 0, errors


def validate_esc_action_payload(data: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """离线严格校验 ESC 动作载荷 (esc_menu_action_payload.schema.json)。"""
    errors: List[str] = []
    if not isinstance(data, dict):
        return False, ["ESC 载荷根节点必须为字典对象"]

    if "action_type" not in data:
        errors.append("缺失必需字段: action_type")
    elif data["action_type"] not in [
        "ESC_QUERY_READINESS",
        "ESC_SAVE_GAME",
        "ESC_EXIT_TO_GATEWAY",
        "ESC_QUIT_GAME",
        "ESC_APPLY_SETTINGS",
    ]:
        errors.append(f"无效的 ESC action_type: {data['action_type']}")

    if "payload" not in data:
        errors.append("缺失必需字段: payload")
    elif not isinstance(data["payload"], dict):
        errors.append("payload 必须为字典对象")

    allowed_keys = {"action_type", "payload"}
    for k in data.keys():
        if k not in allowed_keys:
            errors.append(f"检测到未定义扩展字段: {k}")

    return len(errors) == 0, errors


class LocalMockDispatcher:
    """本地离线模拟派发器 (Local Mock Dispatcher)。

    职责与状态机契约：
    1. 模拟卡拉尔世界引擎服务端的双轨信封解包与鉴权校验；
    2. 维护高精度人类控制权优先租约保护窗口（默认 3000ms 保持与单一真源对齐）；
    3. 模拟 ESC 菜单与主页 HUD 业务逻辑并产出合法响应；
    4. 零外部网络依赖，支持全链路端到端确定性离线回归测试。
    """

    def __init__(
        self,
        capabilities: Optional[Dict[str, Any]] = None,
        lease_window_ms: int = 3000,
    ) -> None:
        self.capabilities = capabilities or safe_load_json(CAPABILITIES_PATH)
        proto_cfg = self.capabilities.get("unified_protocol_capabilities", {})
        self.lease_window_ms = int(proto_cfg.get("human_preemption_lease_ms", lease_window_ms))
        self.lease_holder: str = ""
        self.active_lease_nonce: int = 0
        self.human_lease_expiry_ms: int = -100000
        self.simulated_clock_offset_ms: int = 0

        # 初始化模拟 HUD 状态
        self.hud_state: Dict[str, Any] = {
            "hp": 100.0,
            "hp_max": 100.0,
            "mp": 50.0,
            "mp_max": 50.0,
            "ap": 10.0,
            "ap_max": 10.0,
            "gold": 200,
            "potential_stat_points": 3,
            "current_location": "VALAN_SANCTUARY",
            "active_mode": "single_player",
            "active_modals": [],
            "unread_mail_count": 1,
            "tracked_quest": "QUEST_PROLOGUE_WAKE",
        }

    def get_current_time_ms(self) -> int:
        """获取当前毫秒时间戳（含模拟偏移）。"""
        return int(time.time() * 1000) + self.simulated_clock_offset_ms

    def advance_time_ms(self, delta_ms: int) -> None:
        """推进模拟时间时钟。"""
        self.simulated_clock_offset_ms += delta_ms

    def release_lease(self) -> None:
        """显式主动释放人类控制租约。"""
        self.human_lease_expiry_ms = -100000
        self.lease_holder = ""
        self.active_lease_nonce = 0

    def is_lease_active(self, account_id: str = "") -> bool:
        """判定当前人类控制租约是否有效。"""
        now = self.get_current_time_ms()
        if now >= self.human_lease_expiry_ms:
            return False
        if account_id and self.lease_holder and account_id != self.lease_holder:
            return False
        return True

    def dispatch(self, request_envelope: Dict[str, Any]) -> Dict[str, Any]:
        """接收客户端请求信封，执行状态机判定并返回规范化响应信封。"""
        now = self.get_current_time_ms()
        req_id = request_envelope.get("request_id", str(uuid.uuid4()))

        # 1. 前置 Schema 合法性校验
        valid, errors = validate_client_request_envelope(request_envelope)
        if not valid:
            return {
                "request_id": req_id,
                "is_success": False,
                "payload": {},
                "error_code": "ERR_INVALID_ENVELOPE",
                "message": f"请求信封格式不合法: {'; '.join(errors)}",
                "server_timestamp_ms": now,
            }

        actor_type = request_envelope["actor_type"]
        domain = request_envelope["domain"]
        action_type = request_envelope["action_type"]
        payload = request_envelope["payload"]
        account_id = request_envelope.get("account_id", "default_account")
        lease_nonce = request_envelope.get("lease_nonce", 0)

        # 2. 人类租约抢占判定
        if actor_type == "AGENT":
            if self.is_lease_active():
                return {
                    "request_id": req_id,
                    "is_success": False,
                    "payload": {
                        "lease_holder": self.lease_holder,
                        "remaining_lease_ms": max(0, self.human_lease_expiry_ms - now),
                    },
                    "error_code": "ERR_PREEMPTED_BY_HUMAN",
                    "message": "Agent 动作被人类前台独占租约拦截",
                    "server_timestamp_ms": now,
                }
        elif actor_type == "HUMAN_UI":
            # 人类前台交互主动续订租约
            self.lease_holder = account_id
            self.active_lease_nonce = lease_nonce or (self.active_lease_nonce + 1)
            self.human_lease_expiry_ms = now + self.lease_window_ms

        # 3. 业务域路由分发
        if domain in ["ESC_MENU", "world_gateway", "game_settings"]:
            return self._handle_esc_menu(req_id, action_type, payload, now)

        if domain in ["HOME_HUD", "world_state"]:
            return self._handle_home_hud(req_id, action_type, payload, now)

        if domain in ["PROLOGUE", "CHARACTER_CREATION", "lifecycle"]:
            return {
                "request_id": req_id,
                "is_success": True,
                "payload": {
                    "domain": domain,
                    "action_type": action_type,
                    "status": "ACCEPTED",
                },
                "error_code": "",
                "message": "OK",
                "server_timestamp_ms": now,
            }

        return {
            "request_id": req_id,
            "is_success": False,
            "payload": {},
            "error_code": "ERR_INVALID_ENVELOPE",
            "message": f"不支持的目标业务领域: {domain}",
            "server_timestamp_ms": now,
        }

    def _handle_esc_menu(
        self, req_id: str, action_type: str, payload: Dict[str, Any], now: int
    ) -> Dict[str, Any]:
        """处理 ESC 系统菜单相关指令。"""
        valid_esc_actions = [
            "ESC_QUERY_READINESS",
            "ESC_SAVE_GAME",
            "ESC_EXIT_TO_GATEWAY",
            "ESC_QUIT_GAME",
            "ESC_APPLY_SETTINGS",
            "RESUME_GAME",
            "OPEN_SETTINGS",
            "SAVE_AND_QUIT_TO_ARCHIVE",
            "FORCE_QUIT_TO_ARCHIVE",
            "SAVE_AND_QUIT_TO_GATEWAY",
            "SAVE_AND_QUIT_DESKTOP",
        ]
        if action_type not in valid_esc_actions:
            return {
                "request_id": req_id,
                "is_success": False,
                "payload": {},
                "error_code": "ERR_INVALID_ESC_ACTION",
                "message": f"未知的 ESC 系统动作: {action_type}",
                "server_timestamp_ms": now,
            }

        # 模拟存档防护卫语句
        if payload.get("block_save", False):
            return {
                "request_id": req_id,
                "is_success": False,
                "payload": {"reason": "CombatInProgress"},
                "error_code": "ERR_SAVE_GUARD_BLOCKED",
                "message": "战斗或关键过渡中禁止保存游戏",
                "server_timestamp_ms": now,
            }

        if action_type in ["ESC_SAVE_GAME", "SAVE_AND_QUIT_TO_ARCHIVE", "SAVE_AND_QUIT_TO_GATEWAY", "SAVE_AND_QUIT_DESKTOP"]:
            slot_id = payload.get("slot_id", "SLOT_01")
            return {
                "request_id": req_id,
                "is_success": True,
                "payload": {
                    "save_status": "SUCCESS",
                    "slot_id": slot_id,
                    "saved_bytes": 1024,
                    "saved_at_ms": now,
                },
                "error_code": "",
                "message": "存档成功写入物理快照",
                "server_timestamp_ms": now,
            }

        if action_type in ["ESC_EXIT_TO_GATEWAY", "SAVE_AND_QUIT_TO_GATEWAY"]:
            self.release_lease()
            return {
                "request_id": req_id,
                "is_success": True,
                "payload": {
                    "nav_target": "GATEWAY_SELECT",
                    "lease_cleared": True,
                },
                "error_code": "",
                "message": "已成功退出到世界档案网关",
                "server_timestamp_ms": now,
            }

        return {
            "request_id": req_id,
            "is_success": True,
            "payload": {
                "action": action_type,
                "status": "COMPLETED",
            },
            "error_code": "",
            "message": "ESC 指令已执行",
            "server_timestamp_ms": now,
        }

    def _handle_home_hud(
        self, req_id: str, action_type: str, payload: Dict[str, Any], now: int
    ) -> Dict[str, Any]:
        """处理主页 HUD 业务指令。"""
        supported_directives = [
            "ALLOCATE_POTENTIAL_STAT",
            "CLAIM_QUEST_OBJECTIVE",
            "DISMISS_UI_NOTICE",
            "INSPECT_INVENTORY_SLOT",
            "MARK_MAIL_READ",
            "REST_AND_ADVANCE_TIME",
            "TOGGLE_MODE_ADAPTATION",
            "SYNC_HUD_SNAPSHOT",
        ]
        if action_type not in supported_directives:
            return {
                "request_id": req_id,
                "is_success": False,
                "payload": {},
                "error_code": "ERR_INVALID_ENVELOPE",
                "message": f"未知的 HUD 指令动作: {action_type}",
                "server_timestamp_ms": now,
            }

        # 状态突变逻辑模拟
        if action_type == "ALLOCATE_POTENTIAL_STAT":
            stat_name = payload.get("stat_name", "STR")
            cost = payload.get("points", 1)
            if self.hud_state["potential_stat_points"] >= cost:
                self.hud_state["potential_stat_points"] -= cost
            else:
                return {
                    "request_id": req_id,
                    "is_success": False,
                    "payload": {"remaining_points": self.hud_state["potential_stat_points"]},
                    "error_code": "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
                    "message": "潜能点数不足",
                    "server_timestamp_ms": now,
                }

        elif action_type == "REST_AND_ADVANCE_TIME":
            self.hud_state["hp"] = self.hud_state["hp_max"]
            self.hud_state["mp"] = self.hud_state["mp_max"]
            self.hud_state["ap"] = self.hud_state["ap_max"]
            self.advance_time_ms(3600 * 1000)

        elif action_type == "MARK_MAIL_READ":
            self.hud_state["unread_mail_count"] = 0

        elif action_type == "TOGGLE_MODE_ADAPTATION":
            curr_mode = self.hud_state["active_mode"]
            self.hud_state["active_mode"] = "multiplayer" if curr_mode == "single_player" else "single_player"

        return {
            "request_id": req_id,
            "is_success": True,
            "payload": {
                "action": action_type,
                "applied_at_ms": now,
                "snapshot": dict(self.hud_state),
            },
            "error_code": "",
            "message": "HUD 指令已应用",
            "server_timestamp_ms": now,
        }


class KalarProtocolClient:
    """卡拉尔统一协议客户端 (Kalar Protocol Client)。

    提供高层语义接口以构建、校验和发射请求信封，并由底层 Dispatcher 或通信管道承载。
    """

    def __init__(
        self,
        dispatcher: Optional[LocalMockDispatcher] = None,
        account_id: str = "kalar_developer_user",
        character_id: str = "CHAR_VALAN_SCOUT",
    ) -> None:
        self.dispatcher = dispatcher or LocalMockDispatcher()
        self.account_id = account_id
        self.character_id = character_id
        self.session_token: str = f"tok_{uuid.uuid4().hex[:12]}"
        self._lease_counter: int = 1

    def build_request(
        self,
        actor_type: str,
        domain: str,
        action_type: str,
        payload: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """构建强类型客户端请求信封字典。"""
        now = self.dispatcher.get_current_time_ms()
        req_id = request_id or f"req_{int(now)}_{uuid.uuid4().hex[:8]}"
        lease_nonce = self._lease_counter if actor_type == "HUMAN_UI" else 0
        if actor_type == "HUMAN_UI":
            self._lease_counter += 1

        envelope: Dict[str, Any] = {
            "request_id": req_id,
            "session_token": self.session_token,
            "account_id": self.account_id,
            "character_id": self.character_id,
            "actor_type": actor_type,
            "domain": domain,
            "action_type": action_type,
            "payload": payload or {},
            "lease_nonce": lease_nonce,
            "client_timestamp_ms": now,
        }
        return envelope

    def send(self, request_envelope: Dict[str, Any]) -> Dict[str, Any]:
        """发射请求信封并获取经校验的统一响应信封。"""
        response = self.dispatcher.dispatch(request_envelope)
        valid, errs = validate_unified_response_envelope(response)
        if not valid:
            print(f"[WARN] 响应信封未通过校验: {errs}", file=sys.stderr)
        return response

    def send_human_esc_action(
        self, action_type: str, payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """便捷方法：以人类 UI 身份发射 ESC 系统菜单指令。"""
        req = self.build_request("HUMAN_UI", "ESC_MENU", action_type, payload)
        return self.send(req)

    def send_agent_hud_action(
        self, action_type: str, payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """便捷方法：以自主 Agent 身份发射主页 HUD 指令。"""
        req = self.build_request("AGENT", "HOME_HUD", action_type, payload)
        return self.send(req)

    def send_human_hud_action(
        self, action_type: str, payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """便捷方法：以人类 UI 身份发射主页 HUD 指令（触发租约续订）。"""
        req = self.build_request("HUMAN_UI", "HOME_HUD", action_type, payload)
        return self.send(req)


def main() -> int:
    """CLI 入口。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(description="卡拉尔统一协议客户端与离线模拟派发 CLI")
    parser.add_argument("--actor", choices=["HUMAN_UI", "AGENT"], default="HUMAN_UI", help="操作发起方主体类型")
    parser.add_argument("--domain", default="ESC_MENU", help="目标业务领域名称")
    parser.add_argument("--action", default="ESC_QUERY_READINESS", help="具体指令动作类型")
    parser.add_argument("--payload", default="{}", help="业务载荷 JSON 字符串")
    parser.add_argument("--json", action="store_true", help="以格式化 JSON 输出响应")
    args = parser.parse_args()

    try:
        payload_dict = json.loads(args.payload)
    except Exception as exc:
        print(f"[FAIL] 无法解析 payload JSON: {exc}", file=sys.stderr)
        return 2

    client = KalarProtocolClient()
    req = client.build_request(
        actor_type=args.actor,
        domain=args.domain,
        action_type=args.action,
        payload=payload_dict,
    )
    resp = client.send(req)

    if args.json:
        print(json.dumps(resp, indent=2, ensure_ascii=False))
    else:
        status_label = "SUCCESS" if resp.get("is_success") else "FAILED"
        print(f"[{status_label}] ReqID={resp.get('request_id')} Msg={resp.get('message')} Code={resp.get('error_code', 'NONE')}")
        if resp.get("payload"):
            print(f"Payload: {json.dumps(resp['payload'], ensure_ascii=False)}")

    return 0 if resp.get("is_success") else 1


if __name__ == "__main__":
    sys.exit(main())
