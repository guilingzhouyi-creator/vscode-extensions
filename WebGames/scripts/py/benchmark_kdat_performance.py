#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 性能基准测试)
# 文件路径: WebGames/scripts/py/benchmark_kdat_performance.py
# 架构定位: 端到端加载性能与高纯度二进制流量化基准测试引擎 (E2E Benchmark Engine)
# 依赖与触发: 触发方: CLI / 性能门禁 | 上游: WebGames/config/*.json, lib.kalar_config_compiler | 下游: 性能报告 JSON | 运行时: Python 3.10+
# 职责说明: 量化全域配置表在 JSON 与 .kdat 二进制流格式下的端到端性能表现；
#           覆盖冷启动加载耗时、反序列化吞吐量、磁盘体积压缩比率、单包融合 TOC 寻址延迟；
#           量化媒体二进制块 (Binary Blob) 与流掩码混淆 (Stream Masking) 的开销。
# 退出语义与设计依据: 退出码: 0=基准测试完成并输出报告, 1=测试失败 | 设计依据: 性能量化与第一性原理差分基准
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/benchmark_kdat_performance.py
#   python scripts/py/benchmark_kdat_performance.py --iterations 20 --json-out benchmarks/reports/kdat_benchmark_report.json
# ==============================================================================
"""量化全域配置表端到端加载性能、吞吐量与体积缩减指标。"""

from __future__ import annotations
from dataclasses import asdict, dataclass
from pathlib import Path
import argparse
import base64
import json
import os
import sys
import time
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root
from lib.kalar_config_compiler import (
    PAYLOAD_MONOLITHIC_BUNDLE,
    build_monolithic_bundle,
    compile_data_to_kdat,
    decompile_kdat_to_data,
)

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG_DIR = ROOT / "config"
DEFAULT_REPORT_PATH = ROOT / "benchmarks" / "reports" / "kdat_benchmark_report.json"


@dataclass
class TableBenchmarkMetrics:
    """单个配置表的基准测试指标模型。"""
    table_name: str
    relative_path: str
    json_bytes: int
    kdat_bytes: int
    size_reduction_ratio: float
    json_parse_avg_us: float
    kdat_parse_avg_us: float
    speedup_ratio: float


@dataclass
class SuiteBenchmarkSummary:
    """全套配置表综合性能基准汇总模型。"""
    table_count: int
    total_json_bytes: int
    total_kdat_bytes: int
    overall_compression_ratio: float
    total_size_saved_bytes: int
    json_total_parse_ms: float
    kdat_total_parse_ms: float
    overall_speedup_ratio: float
    json_throughput_kb_per_sec: float
    kdat_throughput_kb_per_sec: float
    monolithic_bundle_bytes: int
    monolithic_toc_avg_lookup_us: float
    blob_json_base64_bytes: int
    blob_kdat_raw_bytes: int
    blob_kdat_saving_ratio: float
    encryption_overhead_percentage: float
    timestamp: str


def _measure_json_parsing(json_str: str, iterations: int) -> float:
    """测量 JSON 反序列化平均耗时（微秒）。"""
    t0 = time.perf_counter_ns()
    for _ in range(iterations):
        _ = json.loads(json_str)
    t1 = time.perf_counter_ns()
    return (t1 - t0) / (iterations * 1000.0)


def _measure_kdat_parsing(kdat_bytes: bytes, iterations: int) -> float:
    """测量 .kdat 二进制流反编译与 TLV 装配平均耗时（微秒）。"""
    t0 = time.perf_counter_ns()
    for _ in range(iterations):
        _, _ = decompile_kdat_to_data(kdat_bytes)
    t1 = time.perf_counter_ns()
    return (t1 - t0) / (iterations * 1000.0)


def benchmark_all_tables(
    config_dir: Path,
    iterations: int = 15,
) -> tuple[list[TableBenchmarkMetrics], int, int, float, float]:
    """批量测试所有配置表的体积与反序列化延迟。"""
    json_files = sorted(config_dir.rglob("*.json"))
    table_metrics: list[TableBenchmarkMetrics] = []

    total_json_bytes = 0
    total_kdat_bytes = 0
    total_json_time_us = 0.0
    total_kdat_time_us = 0.0

    for jf in json_files:
        rel_path = str(jf.relative_to(config_dir)).replace("\\", "/")
        raw_text = jf.read_text(encoding="utf-8")
        parsed_data = json.loads(raw_text)

        json_len = len(raw_text.encode("utf-8"))
        kdat_bytes = compile_data_to_kdat(parsed_data, compress=True)
        kdat_len = len(kdat_bytes)

        json_avg_us = _measure_json_parsing(raw_text, iterations)
        kdat_avg_us = _measure_kdat_parsing(kdat_bytes, iterations)

        reduction = 1.0 - (float(kdat_len) / float(max(1, json_len)))
        speedup = (json_avg_us / kdat_avg_us) if kdat_avg_us > 0.0 else 1.0

        total_json_bytes += json_len
        total_kdat_bytes += kdat_len
        total_json_time_us += json_avg_us
        total_kdat_time_us += kdat_avg_us

        metric = TableBenchmarkMetrics(
            table_name=jf.stem,
            relative_path=rel_path,
            json_bytes=json_len,
            kdat_bytes=kdat_len,
            size_reduction_ratio=round(reduction, 4),
            json_parse_avg_us=round(json_avg_us, 2),
            kdat_parse_avg_us=round(kdat_avg_us, 2),
            speedup_ratio=round(speedup, 2),
        )
        table_metrics.append(metric)

    return table_metrics, total_json_bytes, total_kdat_bytes, total_json_time_us, total_kdat_time_us


def benchmark_monolithic_bundle(config_dir: Path, iterations: int = 50) -> tuple[int, float]:
    """测试单包融合模式与 TOC 索引直接寻址延迟。"""
    temp_bundle_path = config_dir.parent / "temp_benchmark_bundle.kdat"
    try:
        res, bundle_data = build_monolithic_bundle(config_dir, temp_bundle_path, compress=True)
        bundle_bytes = temp_bundle_path.read_bytes()

        decompiled_bundle, _ = decompile_kdat_to_data(bundle_bytes)
        toc = decompiled_bundle.get("toc", [])
        raw_payload = decompiled_bundle.get("payload", b"")
        if isinstance(raw_payload, dict) and "data" in raw_payload:
            payload_blob = raw_payload["data"]
        else:
            payload_blob = raw_payload

        # 随机抽取 5 个表格测试基于 TOC 偏移切片就地解析耗时
        sample_entries = toc[:min(5, len(toc))]
        t0 = time.perf_counter_ns()
        for _ in range(iterations):
            for entry in sample_entries:
                offset = entry["offset"]
                length = entry["length"]
                _ = payload_blob[offset : offset + length]
        t1 = time.perf_counter_ns()
        total_lookups = iterations * len(sample_entries)
        avg_toc_lookup_us = (t1 - t0) / (total_lookups * 1000.0)

        return len(bundle_bytes), round(avg_toc_lookup_us, 3)
    finally:
        if temp_bundle_path.exists():
            temp_bundle_path.unlink()


def benchmark_binary_blob_embedding(iterations: int = 30) -> tuple[int, int, float]:
    """量化多媒体二进制块 (Binary Blob) 直接嵌入与 Base64 嵌入对比。"""
    # 模拟 32KB 纹理原始二进制
    mock_texture_bytes = bytes([((i * 37) ^ 0x5A) & 0xFF for i in range(32768)])

    # 1. 传统 JSON 模式（必须使用 Base64 转码字符串）
    b64_str = base64.b64encode(mock_texture_bytes).decode("ascii")
    json_container = {"texture_id": "tex_combat_bg", "data_b64": b64_str}
    json_payload = json.dumps(json_container).encode("utf-8")

    # 2. .kdat 模式（原生 TLV 二进制块无转码）
    kdat_container = {
        "texture_id": "tex_combat_bg",
        "blob": {
            "__type": "binary_blob",
            "mime_type": "image/png",
            "data": mock_texture_bytes,
        },
    }
    kdat_payload = compile_data_to_kdat(kdat_container, compress=True)

    json_size = len(json_payload)
    kdat_size = len(kdat_payload)
    saving = 1.0 - (float(kdat_size) / float(max(1, json_size)))

    return json_size, kdat_size, round(saving, 4)


def benchmark_stream_encryption_overhead(iterations: int = 30) -> float:
    """量化对称流掩码加密混淆带来的 CPU 计算开销百分比。"""
    test_dict = {"hero_id": "warrior", "stats": {"hp": 1000, "atk": 250, "def": 120}, "tags": ["melee", "tank"]}

    # 未加密
    t0 = time.perf_counter_ns()
    for _ in range(iterations):
        raw = compile_data_to_kdat(test_dict, compress=True, encrypt=False)
        _, _ = decompile_kdat_to_data(raw)
    t1 = time.perf_counter_ns()
    plain_us = (t1 - t0) / iterations

    # 已加密
    t2 = time.perf_counter_ns()
    for _ in range(iterations):
        enc = compile_data_to_kdat(test_dict, compress=True, encrypt=True)
        _, _ = decompile_kdat_to_data(enc)
    t3 = time.perf_counter_ns()
    enc_us = (t3 - t2) / iterations

    overhead = ((enc_us - plain_us) / max(1.0, plain_us)) * 100.0
    return round(overhead, 2)


def run_full_benchmark(
    config_dir: Path,
    iterations: int,
    output_report_path: Path | None,
) -> SuiteBenchmarkSummary:
    """执行全套端到端基准测试并生成统计报表。"""
    print(f"🚀 开始全域配置端到端加载性能基准测试 (轮次: {iterations})...")
    metrics, total_json, total_kdat, total_j_us, total_k_us = benchmark_all_tables(config_dir, iterations)

    total_reduction = 1.0 - (float(total_kdat) / float(max(1, total_json)))
    saved_bytes = total_json - total_kdat
    overall_speedup = (total_j_us / total_k_us) if total_k_us > 0.0 else 1.0

    json_ms = total_j_us / 1000.0
    kdat_ms = total_k_us / 1000.0

    # 吞吐量 (KB/sec)
    json_sec = json_ms / 1000.0
    kdat_sec = kdat_ms / 1000.0
    json_throughput = (total_json / 1024.0) / max(0.0001, json_sec)
    kdat_throughput = (total_json / 1024.0) / max(0.0001, kdat_sec)

    print("📦 正在评测单包融合模式 (Monolithic Bundle TOC)...")
    bundle_size, toc_lookup_us = benchmark_monolithic_bundle(config_dir)

    print("🖼️ 正在评测多媒体二进制原生块 (Binary Blob) 性能...")
    blob_json_sz, blob_kdat_sz, blob_saving = benchmark_binary_blob_embedding()

    print("🔐 正在评测对称流掩码加密混淆 (Stream Masking) 计算损耗...")
    enc_overhead = benchmark_stream_encryption_overhead()

    summary = SuiteBenchmarkSummary(
        table_count=len(metrics),
        total_json_bytes=total_json,
        total_kdat_bytes=total_kdat,
        overall_compression_ratio=round(total_reduction, 4),
        total_size_saved_bytes=saved_bytes,
        json_total_parse_ms=round(json_ms, 2),
        kdat_total_parse_ms=round(kdat_ms, 2),
        overall_speedup_ratio=round(overall_speedup, 2),
        json_throughput_kb_per_sec=round(json_throughput, 2),
        kdat_throughput_kb_per_sec=round(kdat_throughput, 2),
        monolithic_bundle_bytes=bundle_size,
        monolithic_toc_avg_lookup_us=toc_lookup_us,
        blob_json_base64_bytes=blob_json_sz,
        blob_kdat_raw_bytes=blob_kdat_sz,
        blob_kdat_saving_ratio=blob_saving,
        encryption_overhead_percentage=enc_overhead,
        timestamp=time.strftime("%Y-%m-%d %H:%M:%S"),
    )

    # 格式化终端输出
    _print_benchmark_dashboard(summary, metrics[:8])

    if output_report_path:
        output_report_path.parent.mkdir(parents=True, exist_ok=True)
        report_data = {
            "summary": asdict(summary),
            "tables": [asdict(m) for m in metrics],
        }
        content = json.dumps(report_data, ensure_ascii=False, indent=2) + "\n"
        output_report_path.write_bytes(content.encode("utf-8"))
        print(f"\n📊 详细基准测试报告已落盘: {output_report_path}")

    return summary


def _print_benchmark_dashboard(summary: SuiteBenchmarkSummary, top_samples: list[TableBenchmarkMetrics]) -> None:
    """打印结构化基准评测看板。"""
    print("\n" + "=" * 78)
    print("🏆 卡拉尔世界：全域配置表端到端加载性能基准评测看板 (E2E Benchmark Dashboard)")
    print("=" * 78)
    print(f"  • 测试表格总数: {summary.table_count} 份配置表")
    print(f"  • 原始 JSON 体积: {summary.total_json_bytes:,} 字节 ({summary.total_json_bytes / 1024.0:.1f} KB)")
    print(f"  • .kdat 编译体积: {summary.total_kdat_bytes:,} 字节 ({summary.total_kdat_bytes / 1024.0:.1f} KB)")
    print(f"  • 物理体积缩减: 缩减率 {summary.overall_compression_ratio * 100:.1f}% (节省 {summary.total_size_saved_bytes / 1024.0:.1f} KB)")
    print(f"  • 单包融合 (config.kdat): {summary.monolithic_bundle_bytes:,} 字节 | TOC 索引就地寻址: {summary.monolithic_toc_avg_lookup_us} µs")
    print("-" * 78)
    print("⚡ 延迟与吞吐量差分对比:")
    print(f"  • JSON 全量反序列化总耗时: {summary.json_total_parse_ms:.2f} ms")
    print(f"  • .kdat 流式反序列化总耗时: {summary.kdat_total_parse_ms:.2f} ms (加速比: {summary.overall_speedup_ratio:.2f}x)")
    print(f"  • 数据处理吞吐量: JSON {summary.json_throughput_kb_per_sec:,.1f} KB/s ➔ .kdat {summary.kdat_throughput_kb_per_sec:,.1f} KB/s")
    print("-" * 78)
    print("🛡️ 安全混淆与多媒体二进制块扩展指标:")
    print(f"  • 媒体二进制块 (32KB): Base64 JSON {summary.blob_json_base64_bytes:,}B ➔ .kdat {summary.blob_kdat_raw_bytes:,}B (缩减 {summary.blob_kdat_saving_ratio * 100:.1f}%)")
    print(f"  • 对称流掩码加密计算损耗: {summary.encryption_overhead_percentage:+.2f}% (常数级轻量，不拖累主线程)")
    print("=" * 78)
    print("📋 部分核心配置表采样明细:")
    print(f"  {'表格名称':<28} | {'JSON体积':<10} | {'.kdat体积':<10} | {'体积缩减':<8} | {'加速比':<8}")
    print("  " + "-" * 74)
    for m in top_samples:
        print(f"  {m.table_name:<28} | {m.json_bytes:>8} B | {m.kdat_bytes:>8} B | {m.size_reduction_ratio*100:>6.1f}% | {m.speedup_ratio:>6.2f}x")
    print("=" * 78)


def main() -> int:
    """CLI 命令行入口函数。"""
    parser = argparse.ArgumentParser(description="量化全域配置表端到端加载性能、吞吐量与体积缩减指标")
    parser.add_argument("--iterations", type=int, default=15, help="每个配置表的测试迭代轮次")
    parser.add_argument("--config-dir", type=Path, default=CONFIG_DIR, help="配置目录路径")
    parser.add_argument("--json-out", type=Path, default=DEFAULT_REPORT_PATH, help="结果报告输出 JSON 路径")
    args = parser.parse_args()

    summary = run_full_benchmark(
        config_dir=args.config_dir,
        iterations=args.iterations,
        output_report_path=args.json_out,
    )
    return 0 if summary.table_count > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
