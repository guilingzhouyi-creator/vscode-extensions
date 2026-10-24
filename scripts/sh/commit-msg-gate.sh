#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · Git 提交信息门禁)
# 文件路径: scripts/sh/commit-msg-gate.sh
# 架构定位: Git commit-msg 钩子门禁验证器 (Linux Bash)
# 依赖与触发: 触发方: .githooks/commit-msg / 本地 CLI / CI 门禁 | 上游: git commit | 下游: 提交历史 | 运行时: Bash 4+
# 职责说明: 校验 Git 提交信息的 Conventional 格式、结构化正文区块、字数底线与规则 ID 反虚构
# 退出语义与设计依据: 退出码: 0=提交信息合规, 1=信息格式违规阻断 | 设计依据: AGENTS.md 生产工程级提交规范
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/commit-msg-gate.sh <commit-msg-file>
# ==============================================================================
set -euo pipefail

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
GATE_ROOT_DIR="$ROOT_DIR"
GATE_NODE_BIN="${NODE_BIN:-node}"

IS_AGENT=0
MSG_FILE=""

for arg in "$@"; do
    case "$arg" in
        --view-log|-v)
            exec "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --view
            ;;
        --agent|-a)
            IS_AGENT=1
            ;;
        *)
            if [[ -z "$MSG_FILE" && "$arg" != -* ]]; then
                MSG_FILE="$arg"
            fi
            ;;
    esac
done

GATE_SUPPRESS="$IS_AGENT"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init commit-msg

if [[ -z "$MSG_FILE" ]]; then
    if [[ "$IS_AGENT" -eq 1 ]]; then
        cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "BLOCK",
  "gate": "commit-msg",
  "summary": "用法错误: 请传入 commit-msg 文件路径",
  "violations": [{
    "ruleId": "GUARD-MSG-001",
    "severity": "BLOCK",
    "message": "用法错误: 请传入 commit-msg 文件路径",
    "actionableFix": "请传入有效的文件路径作为参数"
  }]
}
EOF
        exit 1
    fi
    echo "用法错误: 请传入 commit-msg 文件路径 (或 --view-log 查看上一次失败)"
    exit 1
fi

if [[ ! -f "$MSG_FILE" ]]; then
    if [[ "$IS_AGENT" -eq 1 ]]; then
        cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "BLOCK",
  "gate": "commit-msg",
  "summary": "提交信息文件不存在: $MSG_FILE",
  "violations": [{
    "ruleId": "GUARD-MSG-001",
    "severity": "BLOCK",
    "file": "$MSG_FILE",
    "message": "提交信息文件不存在: $MSG_FILE",
    "actionableFix": "请传入已存在的提交信息文件"
  }]
}
EOF
        exit 1
    fi
    echo "✖ BLOCK  提交信息文件不存在: $MSG_FILE"
    exit 1
fi

print_template_guide() {
    echo ""
    echo "💡 【生产工程级提交信息标准模板指引】:"
    echo "-----------------------------------------------------------------"
    echo "<type>(<scope>): <祈使句中文摘要标题，5~80 字符，不以句号结尾>"
    echo ""
    echo "[Project / 项目归属]"
    echo "- <workspace-timing | auto-refactor | WebGames | fractal-git | governance>"
    echo ""
    echo "[Why / 动机背景]"
    echo "- 业务背景、关联需求 ID 或解决的核心痛点。"
    echo ""
    echo "[Added / 新增内容] (如有新增必填)"
    echo "- 新增的文件、模块、接口或测试套件。"
    echo ""
    echo "[Changed / 变更调整] (如有调整必填)"
    echo "- 调整的现有逻辑、重构方法或参数配置。"
    echo ""
    echo "[Fixed / 修复缺陷] (如有 Bug 必填)"
    echo "- 修复的异常、崩溃、竞态条件或回归缺陷。"
    echo ""
    echo "[Verification / 验证结论]"
    echo "- 说明本地运行的验证命令与断言事实，严禁出现任何执行数字、统计量词或百分比（CMG-STY-006）。"
    echo "-----------------------------------------------------------------"
}

if [[ "$IS_AGENT" -ne 1 ]]; then
    echo "================================================================="
    echo "📝 执行生产工程级 Commit-Msg 规范与结构化内容门禁"
    echo "================================================================="
fi

# --- 合并提交结构性豁免（MERGE-STRUCTURE-10）---
# git merge 生成的 "Merge branch ..." 消息不是人工撰写的正文，结构契约与禁词审查对它必然误杀，
# 过去只能靠 --no-verify 绕过（连带丢掉 pre-commit 门禁）。此处仅在 MERGE_HEAD 存在且首行为
# Git 生成的合并标题时放行，并登记独立步骤，使收据能区分「结构性合并」与「文本契约通过」。
IS_MERGE_COMMIT=0
GIT_DIR_PATH=$(git rev-parse --git-dir 2>/dev/null || echo ".git")
MERGE_HEAD_PATH="$GIT_DIR_PATH/MERGE_HEAD"
[[ "$MERGE_HEAD_PATH" = /* ]] || MERGE_HEAD_PATH="$ROOT_DIR/$MERGE_HEAD_PATH"
if [[ -f "$MERGE_HEAD_PATH" ]]; then
    MERGE_SUBJECT=$(grep -vE '^[[:space:]]*#' "$MSG_FILE" | head -n 1 | tr -d '\r')
    if [[ "$MERGE_SUBJECT" =~ ^Merge\ (branch|remote-tracking\ branch|tag|commit|pull\ request) ]]; then
        IS_MERGE_COMMIT=1
    fi
fi
if [[ "$IS_MERGE_COMMIT" -eq 1 ]]; then
    write_step_banner "MERGE-STRUCTURE-10"
    write_step_verdict "MERGE-STRUCTURE-10" PASS "合并提交采用 Git 生成的结构性标题，文本契约由合并来源提交保证"
    if [[ "$IS_AGENT" -eq 1 ]]; then
        cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "PASS",
  "gate": "commit-msg",
  "summary": "Merge commit message accepted through structural exemption."
}
EOF
    else
        echo "✔ Commit-Msg 检查通过（合并提交结构性豁免）"
        echo "================================================================="
    fi
    exit 0
fi

# --- 结构契约校验（单一实现：scripts/common/commit-structure-contract.js）---
# 七项结构判定原先在本文件与 PowerShell 版本各写一份。本文件那一份已经漂移：
# [[ =~ ]] 的字符类在 C.UTF-8 下按字节匹配，全角句号与中文标题都被误判。
# 现在只调度一次 Node，两个平台看到的是同一套规则与同一个步骤归属。
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
RESOLVED_MSG_FILE=$(realpath "$MSG_FILE" 2>/dev/null || readlink -f "$MSG_FILE" 2>/dev/null || echo "$MSG_FILE")
STRUCTURE_SCRIPT="$ROOT_DIR/scripts/common/validate-commit-msg.js"

if [[ "${IS_AGENT:-0}" -ne 1 ]]; then
    PREVIEW=$(grep -vE '^[[:space:]]*#' "$RESOLVED_MSG_FILE" | head -n 1)
    echo "提交标题: ${PREVIEW%$'\r'}"
fi

STRUCTURE_OUT=$("$NODE_BIN" "$STRUCTURE_SCRIPT" "$RESOLVED_MSG_FILE" --structure-only --agent 2>&1) || STRUCTURE_STATUS=$?
STRUCTURE_STATUS=${STRUCTURE_STATUS:-0}
if [[ "$STRUCTURE_STATUS" -ne 0 ]]; then
    echo "$STRUCTURE_OUT"
    if [[ "${IS_AGENT:-0}" -ne 1 ]]; then
        print_template_guide
    fi
    exit "$STRUCTURE_STATUS"
fi

# --- 规则标识反虚构与文本求真联合审查 ---
VALIDATE_ARGS=("$RESOLVED_MSG_FILE")
if [[ "$IS_AGENT" -eq 1 ]]; then
    VALIDATE_ARGS+=("--agent")
fi

if [[ "$IS_AGENT" -eq 1 ]]; then
    NODE_OUT=""
    NODE_STATUS=0
    NODE_OUT=$(cd "$ROOT_DIR" && "$NODE_BIN" scripts/common/validate-commit-msg.js "${VALIDATE_ARGS[@]}" 2>&1) || NODE_STATUS=$?

    if [[ $NODE_STATUS -ne 0 ]]; then
        if [[ "$NODE_OUT" =~ ^[[:space:]]*\{ ]]; then
            echo "$NODE_OUT"
        elif [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
        else
            echo "$NODE_OUT"
        fi
        exit 1
    fi

    if [[ "$NODE_OUT" =~ ^[[:space:]]*\{ ]]; then
        echo "$NODE_OUT"
        exit 0
    fi

    cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "PASS",
  "gate": "commit-msg",
  "summary": "All commit-msg validation rules passed cleanly."
}
EOF
    exit 0
else
    if ! (cd "$ROOT_DIR" && "$NODE_BIN" scripts/common/validate-commit-msg.js "${VALIDATE_ARGS[@]}"); then
        print_template_guide
        exit 1
    fi
fi

write_step_banner "HEADER-FORM-01"
write_step_verdict "HEADER-FORM-01" PASS "标题格式与长度合规"
write_step_banner "SLANG-GUARD-02"
write_step_verdict "SLANG-GUARD-02" PASS "零黑话与空洞词"
write_step_banner "BODY-SPLIT-03"
write_step_verdict "BODY-SPLIT-03" PASS "空行分割契约合规"
write_step_banner "BODY-DENSITY-04"
write_step_verdict "BODY-DENSITY-04" PASS "正文实质信息量达标"
write_step_banner "BODY-SECTIONS-05"
write_step_verdict "BODY-SECTIONS-05" PASS "结构化区块完整"
write_step_banner "PROJECT-SCOPE-06"
write_step_verdict "PROJECT-SCOPE-06" PASS "项目归属合规"
write_step_banner "BATCH-CODE-07"
write_step_verdict "BATCH-CODE-07" PASS "正文零批次代号"
write_step_banner "RULE-TRUTH-08"
write_step_verdict "RULE-TRUTH-08" PASS "规则标识反虚构"
write_step_banner "TEXT-TRUTH-09"
write_step_verdict "TEXT-TRUTH-09" PASS "文本求真务实与禁词合规"
echo "✔ Commit-Msg 检查通过"
echo "================================================================="
exit 0
