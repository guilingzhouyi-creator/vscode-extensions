#!/usr/bin/env python3
"""
卡拉尔引擎伴侣跨进程 IPC 客户端示例（纯 Python 标准库实现）。

协议契约: kalar.companion.ipc.v1（127.0.0.1 本地回环换行分隔 UTF-8 JSON-RPC）。
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from typing import Any

PROTOCOL_VERSION = "kalar.companion.ipc.v1"
ALLOWED_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class CompanionIPCError(RuntimeError):
    """表示伴侣 IPC 传输、解析或服务端返回的业务错误。"""

    def __init__(self, error_code: str, message: str) -> None:
        super().__init__(f"{error_code}: {message}")
        self.error_code = error_code
        self.message = message


class CompanionIPCClient:
    """基于本地回环 TCP 换行 JSON-RPC 的伴侣协议轻量客户端。"""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 19420,
        timeout_seconds: float = 5.0,
    ) -> None:
        if host not in ALLOWED_LOOPBACK_HOSTS:
            raise ValueError(f"出于安全隔离限制，伴侣 IPC 仅允许连接回环地址: {host}")
        self._host = host
        self._port = int(port)
        self._timeout_seconds = float(timeout_seconds)
        self._socket: socket.socket | None = None
        self._read_buffer = bytearray()
        self._sequence = 0

    def __enter__(self) -> CompanionIPCClient:
        self.connect()
        return self

    def __exit__(self, _exc_type: object, _exc_val: object, _exc_tb: object) -> None:
        self.close()

    def connect(self) -> None:
        """建立到底层 CompanionIPCServer 的本地回环 TCP 连接。"""
        if self._socket is not None:
            return
        self._socket = socket.create_connection((self._host, self._port), timeout=self._timeout_seconds)
        self._socket.settimeout(self._timeout_seconds)

    def close(self) -> None:
        """关闭 TCP 套接字并清空接收缓冲。"""
        if self._socket is not None:
            try:
                self._socket.close()
            finally:
                self._socket = None
        self._read_buffer.clear()

    def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        auth_token: str | None = None,
    ) -> Any:
        """发送单条 JSON-RPC 指令并返回服务端 payload；失败时抛出 CompanionIPCError。"""
        if self._socket is None:
            self.connect()
        assert self._socket is not None

        self._sequence += 1
        frame: dict[str, Any] = {
            "id": f"py_{self._sequence}",
            "method": method,
            "params": params or {},
        }
        if auth_token:
            frame["auth_token"] = auth_token

        encoded = (json.dumps(frame, ensure_ascii=False) + "\n").encode("utf-8")
        self._socket.sendall(encoded)
        response = json.loads(self._recv_line())
        if not bool(response.get("ok", False)):
            raise CompanionIPCError(
                str(response.get("error_code", "ERR_IPC_REMOTE")),
                str(response.get("message", "Unknown IPC failure")),
            )
        return response.get("payload")

    def authenticate(self, token: str) -> Any:
        """执行会话口令鉴权。"""
        return self.request("auth", auth_token=token)

    def ping(self) -> Any:
        """探测伴侣服务存活与绑定端口。"""
        return self.request("ping")

    def get_observation(self) -> Any:
        """拉取当前推演会话观测快照。"""
        return self.request("get_observation")

    def step(self, choice_id: str, extra_params: dict[str, Any] | None = None) -> Any:
        """提交单步决策推进信号。"""
        payload = dict(extra_params or {})
        payload["choice_id"] = choice_id
        return self.request("step", params=payload)

    def rollback(self) -> Any:
        """回滚最近一次推进步。"""
        return self.request("rollback")

    def inspect_blackbox(self) -> Any:
        """查询最近黑匣子诊断转储与事件尾迹。"""
        return self.request("inspect_blackbox")

    def hot_reload_poll(self) -> Any:
        """触发 MOD 目录热重载轮询。"""
        return self.request("hot_reload_poll")

    def hot_reload_status(self) -> Any:
        """读取当前热重载调度器状态。"""
        return self.request("hot_reload_status")

    def _recv_line(self) -> str:
        assert self._socket is not None
        while True:
            newline_pos = self._read_buffer.find(b"\n")
            if newline_pos >= 0:
                raw_line = bytes(self._read_buffer[:newline_pos])
                del self._read_buffer[: newline_pos + 1]
                return raw_line.decode("utf-8").strip()
            chunk = self._socket.recv(4096)
            if not chunk:
                raise CompanionIPCError("ERR_IPC_EOF", "Server closed connection before completing frame")
            self._read_buffer.extend(chunk)


def run_demo(host: str, port: int, token: str, choice_id: str | None) -> dict[str, Any]:
    """运行端到端鉴权、心跳与只读观察示例并返回结构化摘要。"""
    with CompanionIPCClient(host=host, port=port) as client:
        auth_result = client.authenticate(token)
        ping_result = client.ping()
        observation = client.get_observation()
        blackbox = client.inspect_blackbox()
        summary: dict[str, Any] = {
            "protocol": PROTOCOL_VERSION,
            "auth": auth_result,
            "ping": ping_result,
            "observation": observation,
            "blackbox": blackbox,
        }
        if choice_id:
            summary["step_result"] = client.step(choice_id)
            summary["rollback_result"] = client.rollback()
        return summary


def main(argv: list[str] | None = None) -> int:
    """示例 CLI 入口。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="卡拉尔伴侣跨进程 IPC Python 示例客户端")
    parser.add_argument("--host", default="127.0.0.1", help="本地回环地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=19420, help="CompanionIPCServer 端口（默认 19420）")
    parser.add_argument("--token", default=os.environ.get("KALAR_COMPANION_TOKEN", ""), help="会话口令")
    parser.add_argument("--choice", default=None, help="可选演练决策 choice_id（触发 step + rollback）")
    parser.add_argument("--demo", action="store_true", help="运行标准演示序列并打印 JSON")
    args = parser.parse_args(argv)

    if not args.demo:
        parser.print_help()
        return 0
    if not args.token:
        print("必须通过 --token 或 KALAR_COMPANION_TOKEN 环境变量提供会话口令。", file=sys.stderr)
        return 2

    output = run_demo(args.host, args.port, args.token, args.choice)
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
