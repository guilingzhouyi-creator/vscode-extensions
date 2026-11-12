# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Pure Statistics & Sanitization Library)
# 文件路径: res://backend/infrastructure/pure/statistics_math_lib.gd
# 架构定位: Pure Statistical, Masking & Text Scrubbing Calculation Library
# 依赖与触发: 上游: TelemetryAggregate, RedactionRule, LogCollector, EventBusCore | 下游: LogConstants | 配置: 无 | 信号: 无
# 职责说明: 集中收口纯计算统计分位（P50/P95）、环形索引步进、字符串掩码裁剪、消息内联敏感凭据清洗与调用栈文件名提取算子。
# 退出语义与设计依据: 纯计算域库化集中治理规范 / 热路径零副作用规约
# ==============================================================================

## StatisticsMathLib：Pure Statistical, Masking & Text Scrubbing Calculation Library
class_name StatisticsMathLib extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")

# ==============================================================================
# 一、静态编译内联脱敏正则（全局复用零重复编译）
# ==============================================================================

static var _inline_kv_secret_re: RegEx = RegEx.create_from_string(
	r"(?i)\b(password|passwd|pwd|secret|token|session_token|api_key|apikey|seal_key|private_key)\s*([:=])\s*([^\s,;'\x22}\]]+)"
)
static var _inline_bearer_re: RegEx = RegEx.create_from_string(
	r"(?i)\b(bearer)\s+([A-Za-z0-9._\-]{6,})"
)

# ==============================================================================
# 二、统计与环形索引纯算子 (Pure Math Functions)
# ==============================================================================

## 在已排序升序样本集合中计算指定分位比率位置的值
static func compute_percentile_from_sorted(sorted_vals: Array[int], ratio: float) -> int:
	var n := sorted_vals.size()
	if n <= 0:
		return 0
	var idx := mini(n - 1, maxi(0, int(n * ratio)))
	return int(sorted_vals[idx])

## 计算样本集合的 P50 与 P95 耗时指标字典（按需懒调用）
static func compute_p50_p95(samples: Array[int]) -> Dictionary:
	var n := samples.size()
	if n <= 0:
		return {"p50_ms": 0, "p95_ms": 0}
	var scratch: Array[int] = samples.duplicate()
	scratch.sort()
	return {
		"p50_ms": compute_percentile_from_sorted(scratch, LogConstants.PERCENTILE_P50_RATIO),
		"p95_ms": compute_percentile_from_sorted(scratch, LogConstants.PERCENTILE_P95_RATIO),
	}

## 计算定长环形队列下一个写入游标位置（防除零越界）
static func ring_next_cursor(cursor: int, capacity: int) -> int:
	var cap := maxi(1, capacity)
	return (cursor + 1) % cap

# ==============================================================================
# 三、字符串掩码、内联洗净与调用帧解析算子
# ==============================================================================

## 对字符串执行前后缀保留掩码（过短整值替换为掩码占位符，防长度泄露）
static func mask_string(val_str: String, prefix_len: int, suffix_len: int, replace_with: String) -> String:
	var total_len := val_str.length()
	if total_len == 0 or total_len <= prefix_len + suffix_len:
		return replace_with
	var p := val_str.left(prefix_len)
	var s := val_str.right(suffix_len) if suffix_len > 0 else ""
	return p + replace_with + s

## 二次内联洗净日志正文文本中的敏感凭据模式（password=/token=/Bearer 等，零匹配快速短路跳过）
static func scrub_inline_secrets(message: String, mask_token: String = LogConstants.DEFAULT_MASK_REPLACEMENT) -> String:
	if message.is_empty():
		return message
	var has_kv := ("=" in message) or (":" in message)
	var has_bearer := message.findn("bearer ") != -1
	if not has_kv and not has_bearer:
		return message
	var out := message
	if has_kv and _inline_kv_secret_re != null:
		out = _inline_kv_secret_re.sub(out, "$1$2" + mask_token, true)
	if has_bearer and _inline_bearer_re != null:
		out = _inline_bearer_re.sub(out, "$1 " + mask_token, true)
	return out

## 从调用栈提取首个非跳过白名单的源文件 basename 与行号（杜绝绝对路径泄漏）
static func extract_caller_from_stack(stack_frames: Array, skip_basenames: Array[String]) -> Dictionary:
	if stack_frames.is_empty():
		return {"source_file": "", "source_line": 0}
	for frame in stack_frames:
		var src := str(frame.get("source", ""))
		var fname := src.get_file()
		if not fname.is_empty() and not (fname in skip_basenames):
			return {
				"source_file": fname,
				"source_line": int(frame.get("line", 0)),
			}
	return {"source_file": "", "source_line": 0}
