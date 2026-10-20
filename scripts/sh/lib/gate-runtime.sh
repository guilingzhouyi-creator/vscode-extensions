#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 门禁运行时基础库)
# 文件路径: scripts/sh/lib/gate-runtime.sh
# 架构定位: 门禁共享运行时库 (Bash，由各门禁 Runner 点源加载)
# 依赖与触发: 触发方: pre-commit-gate.sh / pre-push-gate.sh / commit-msg-gate.sh / audit-all.sh / audit-taxis.sh
#             上游: scripts/common/gate-step-registry.json
#             下游: 各门禁的步骤横幅、四态判定与看门狗超时诊断
#             运行时: Bash 4+
# 职责说明: 提供步骤身份解析、四态判定渲染、抑制式输出与带诊断快照的超时等待四项能力，
#           使步骤身份、状态词表与超时处置在全部门禁中只有一份实现
# 退出语义与设计依据: 无独立退出码（点源库，未登记步骤标识直接返回非零）
#   设计依据: 步骤身份必须单源；五处复制同一份登记表解析器会让序号与规则归因在任一处漂移
# ------------------------------------------------------------------------------
# 用法示例:
#   GATE_SUPPRESS=0
#   . "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
#   gate_init pre-commit
#   write_step_banner "STAGED-HYGIENE-01"
#   write_step_verdict "STAGED-HYGIENE-01" PASS "暂存区物理卫生合规"
# ==============================================================================

# 本库被点源加载，不在子 shell 中执行；此处重新声明完整防御选项。
# 点源它的四个 Runner 本身已是 set -euo pipefail，故这是幂等加固而非改变调用方语义。
set -euo pipefail

# 步骤登记表投影缓存：单次进程内只投影一次，避免每步都拉起 node。
GATE_STEP_TSV=""
GATE_STEP_TOTAL=0
GATE_SUPPRESS="${GATE_SUPPRESS:-0}"
GATE_ENTRY_ID="${GATE_ENTRY_ID:-}"
GATE_ROOT_DIR="${GATE_ROOT_DIR:-}"
GATE_NODE_BIN="${GATE_NODE_BIN:-node}"

# 抑制模式承诺在标准输出给出单一机器可读文档，
# 任何人类可读行都会破坏该文档，故宿主输出统一受此开关抑制。
gate_log() {
    if [[ "${GATE_SUPPRESS}" -eq 0 ]]; then
        printf '%s\n' "$*"
    fi
}

gate_log_err() {
    if [[ "${GATE_SUPPRESS}" -eq 0 ]]; then
        printf '%s\n' "$*" >&2
    fi
}

# 加载步骤登记表投影；失败即阻断，绝不回落到合成标识。
gate_init() {
    GATE_ENTRY_ID="${1:-${GATE_ENTRY_ID}}"
    if [[ -z "${GATE_ENTRY_ID}" ]]; then
        echo "✖ BLOCK  门禁运行时缺少条目标识 (gate_init <entryId>)" >&2
        return 1
    fi
    if [[ -n "${GATE_STEP_TSV}" ]]; then
        return 0
    fi
    local registry_js="${GATE_ROOT_DIR}/scripts/common/gate-step-registry.js"
    if [[ ! -f "${registry_js}" ]]; then
        echo "✖ BLOCK  单源步骤登记表加载器缺失: ${registry_js}" >&2
        return 1
    fi
    GATE_STEP_TSV=$("${GATE_NODE_BIN}" "${registry_js}" --entry "${GATE_ENTRY_ID}" --tsv 2>/dev/null) || {
        echo "✖ BLOCK  单源步骤登记表无法投影 ${GATE_ENTRY_ID} 条目" >&2
        return 1
    }
    GATE_STEP_TOTAL=$(grep -c . <<< "${GATE_STEP_TSV}" || true)
    GATE_STEP_TOTAL="${GATE_STEP_TOTAL:-0}"
    return 0
}

# 输出 "序号<TAB>步骤标识<TAB>规则标识<TAB>标题"；未登记标识返回非零。
get_step_meta() {
    local step_id="$1"
    gate_init || return 1
    local row
    row=$(awk -F'\t' -v id="${step_id}" '$2 == id { print; exit }' <<< "${GATE_STEP_TSV}")
    if [[ -z "${row}" ]]; then
        echo "✖ BLOCK  未登记的步骤标识 '${step_id}'，请在 scripts/common/gate-step-registry.json 声明" >&2
        return 1
    fi
    printf '%s' "${row}"
}

write_step_banner() {
    local step_id="$1"
    local row ordinal title
    row=$(get_step_meta "${step_id}") || return 1
    ordinal=$(cut -f1 <<< "${row}")
    title=$(cut -f4 <<< "${row}")
    gate_log "▶ [${ordinal}/${GATE_STEP_TOTAL}] ${step_id}  ${title}"
}

# 状态词表为四态闭包；越界状态直接阻断，而非静默渲染为未定义标记。
write_step_verdict() {
    local step_id="$1"
    local status="$2"
    local detail="${3:-}"
    local glyph
    case "${status}" in
        PASS) glyph="✔" ;;
        BLOCK) glyph="✖" ;;
        SKIP) glyph="⚠️" ;;
        WARN) glyph="⚠️" ;;
        *)
            echo "✖ BLOCK  write_step_verdict 收到四态闭包外状态 '${status}' (步骤 ${step_id})" >&2
            return 1
            ;;
    esac
    get_step_meta "${step_id}" >/dev/null || return 1
    if [[ -n "${detail}" ]]; then
        gate_log "  ${glyph} ${status}  ${step_id}  ${detail}"
    else
        gate_log "  ${glyph} ${status}  ${step_id}"
    fi
}

# 等待后台进程结束，超时则级联终止并落盘诊断快照。
# 返回 0 表示进程在阈值内自行退出；返回 124 表示看门狗已介入。
wait_with_timeout() {
    local pid="$1"
    local timeout_sec="$2"
    local name="$3"
    local log_file="${4:-}"
    local prefix="${5:-timeout}"
    local count=0
    while kill -0 "${pid}" 2>/dev/null; do
        if [[ "${count}" -ge "${timeout_sec}" ]]; then
            gate_log_err "⚠️ ${name} 执行超时 (${timeout_sec}s，PID: ${pid})，强制终止进程..."
            kill -TERM "${pid}" 2>/dev/null || true
            sleep 1
            kill -KILL "${pid}" 2>/dev/null || true

            local diag_dir="${GATE_ROOT_DIR}/.audit-logs"
            mkdir -p "${diag_dir}" 2>/dev/null || true
            local timestamp
            timestamp=$(date +"%Y%m%d-%H%M%S" 2>/dev/null || echo "unknown")
            local safe_name
            safe_name=$(printf '%s' "${name}" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')
            local diag_file="${diag_dir}/${prefix}-${safe_name}-${timestamp}.log"
            {
                echo "================================================================================"
                echo "⚠️ WATCHDOG TIMEOUT 诊断快照"
                echo "================================================================================"
                echo "目标模块: ${name}"
                echo "进程 PID: ${pid}"
                echo "超时阈值: ${timeout_sec} 秒"
                echo "触发时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
                echo "处置措施: 看门狗已触发 SIGTERM/SIGKILL 级联终止进程"
                echo "--------------------------------------------------------------------------------"
                echo "【最后捕获的标准输出与错误日志】:"
                if [[ -n "${log_file}" && -f "${log_file}" ]]; then
                    tail -n 100 "${log_file}"
                else
                    echo "(日志内容为空或未指定日志文件)"
                fi
                echo "================================================================================"
            } > "${diag_file}" 2>/dev/null || true
            gate_log_err "💡 超时诊断快照已落盘至: ${diag_file}"
            "${GATE_NODE_BIN}" "${GATE_ROOT_DIR}/scripts/common/log-rotator.js" --prune >/dev/null 2>&1 || true
            return 124
        fi
        sleep 1
        count=$((count + 1))
    done
    wait "${pid}" 2>/dev/null || return $?
    return 0
}
