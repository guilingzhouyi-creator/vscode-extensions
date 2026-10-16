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

if [[ -z "$MSG_FILE" ]]; then
    if [[ "$IS_AGENT" -eq 1 ]]; then
        cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "BLOCK",
  "gate": "commit-msg",
  "summary": "用法错误: 请传入 commit-msg 文件路径",
  "violations": [{
    "ruleId": "GATE-MSG-001",
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
    "ruleId": "GATE-MSG-001",
    "severity": "BLOCK",
    "file": "$MSG_FILE",
    "message": "提交信息文件不存在: $MSG_FILE",
    "actionableFix": "请传入已存在的提交信息文件"
  }]
}
EOF
        exit 1
    fi
    echo "❌ [FAIL] 提交信息文件不存在: $MSG_FILE"
    exit 1
fi

print_template_guide() {
    echo ""
    echo "💡 【生产工程级提交信息标准模板指引】:"
    echo "-----------------------------------------------------------------"
    echo "<type>(<scope>): <祈使句中文摘要标题，5~80 字符，不以句号结尾>"
    echo ""
    echo "[Project / 项目归属]"
    echo "- <workspace-timing | auto-refactor | WebGames | governance>"
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

fail_commit_msg() {
    local rule_id="$1"
    local message="$2"
    local actual="${3:-}"
    local expected="${4:-}"
    local actionable_fix="${5:-}"

    DIAG_DIR="$ROOT_DIR/.audit-logs"
    mkdir -p "$DIAG_DIR" 2>/dev/null || true
    FAIL_LOG="$DIAG_DIR/last-commit-msg.log"
    {
        echo "================================================================="
        echo "❌ Commit-Msg 门禁拦截现场快照"
        echo "时间: $(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo 'unknown')"
        echo "规则: $rule_id"
        echo "说明: $message"
        echo "-----------------------------------------------------------------"
        echo "【提交信息原内容】:"
        if [[ -f "$MSG_FILE" ]]; then
            cat "$MSG_FILE"
        fi
        echo "================================================================="
    } > "$FAIL_LOG" 2>/dev/null || true

    SNAPSHOT_JSON="$DIAG_DIR/last-failure.json"
    cat <<EOF > "$SNAPSHOT_JSON" 2>/dev/null || true
{
  "protocolVersion": "1.0.0",
  "recordedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo 'unknown')",
  "status": "BLOCK",
  "gate": "commit-msg",
  "step": "Commit-Msg Validation ($rule_id)",
  "failedCommand": "bash scripts/sh/commit-msg-gate.sh $MSG_FILE",
  "exitCode": 1,
  "summary": "$message",
  "logFile": ".audit-logs/last-commit-msg.log",
  "violations": [
    {
      "ruleId": "$rule_id",
      "severity": "BLOCK",
      "file": "$MSG_FILE",
      "actual": "$actual",
      "expected": "$expected",
      "message": "$message",
      "actionableFix": "$actionable_fix",
      "verificationCommand": "bash scripts/sh/commit-msg-gate.sh $MSG_FILE"
    }
  ],
  "agentDirectives": {
    "targetFiles": ["$MSG_FILE"],
    "remediationPriority": ["$rule_id"],
    "verificationCommand": "bash scripts/sh/commit-msg-gate.sh $MSG_FILE",
    "fastRecheckCommand": "bash scripts/sh/commit-msg-gate.sh $MSG_FILE"
  }
}
EOF

    if [[ "$IS_AGENT" -eq 1 ]]; then
        cat "$SNAPSHOT_JSON"
        exit 1
    fi

    echo "❌ [FAIL] ${rule_id}: $message"
    if [[ -n "$actionable_fix" ]]; then
        echo "   💡 建议: $actionable_fix"
    fi
    print_template_guide
    echo "💡 失败诊断快照已保留至: .audit-logs/last-commit-msg.log"
    echo "   (可运行 bash scripts/sh/commit-msg-gate.sh --view-log 快速查看)"
    exit 1
}

if [[ "$IS_AGENT" -ne 1 ]]; then
    echo "================================================================="
    echo "📝 执行生产工程级 Commit-Msg 规范与结构化内容门禁"
    echo "================================================================="
fi

# --- Rule 1: Header 格式与长度校验 ---
HEADER_PATTERN="^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_-]+\))?: .{5,80}$"
if ! echo "$FIRST_LINE" | grep -E "$HEADER_PATTERN" >/dev/null 2>&1; then
    fail_commit_msg "GATE-MSG-001" "Rule 1: 提交标题不符合生产级格式规范！" "$FIRST_LINE" "<type>(<scope>): <简述> (5~80 字符)" "调整为 feat/fix/refactor/docs/test/chore/style/perf(<scope>): 描述"
fi

# 检查标题末尾不得有句号
if [[ "$FIRST_LINE" =~ [.。]$ ]]; then
    fail_commit_msg "GATE-MSG-001" "Rule 1: 提交标题末尾严禁包含句号（. 或 。）！" "$FIRST_LINE" "末尾无句号" "移除标题末尾句号"
fi

# --- Rule 2: 零黑话与空洞泛化词拦截 ---
FORBIDDEN_WORDS="\b(wip|temp|test temp|tmp)\b"
if echo "$FIRST_LINE" | grep -iE "$FORBIDDEN_WORDS" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "Rule 2: 提交标题包含违规黑话/临时性标记 (wip/temp/tmp 等)！" "$FIRST_LINE" "零黑话技术描述" "陈述具体完成的技术特性，严禁使用 wip/temp"
fi

LAZY_WORDS="^([a-z]+(\([a-z0-9_-]+\))?:\s*(update|modify|changes|fix|test|fixes|clean|refactor|todo))\s*$"
if echo "$FIRST_LINE" | grep -iE "$LAZY_WORDS" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "Rule 2: 提交标题过于空洞敷衍！请明确具体加了什么、改了什么或修了什么。" "$FIRST_LINE" "说明具体改动模块与功能" "明确陈述具体变更逻辑"
fi

# 提取提交类型
COMMIT_TYPE=$(echo "$FIRST_LINE" | sed -E 's/^([a-z]+)(\(.*\))?:.*$/\1/')

# --- Rule 3: Header 与 Body 之间必须保留空行 ---
if [[ "$TOTAL_LINES" -gt 1 ]]; then
    SECOND_LINE="${CLEAN_LINES[1]}"
    if [[ -n "$SECOND_LINE" ]]; then
        fail_commit_msg "GATE-MSG-001" "Rule 3: 标题与正文之间第 2 行必须保留空行（当前直接粘连正文）！" "$SECOND_LINE" "第 2 行为独立空行" "在标题与正文之间插入一个空行"
    fi
fi

# --- 统计正文内容（第 3 行及之后）---
BODY_TEXT=""
BODY_CHAR_COUNT=0
if [[ "$TOTAL_LINES" -gt 2 ]]; then
    for ((i=2; i<TOTAL_LINES; i++)); do
        line="${CLEAN_LINES[$i]}"
        BODY_TEXT="${BODY_TEXT}${line}"$'\n'
        # 统计非空白字符
        non_ws_line=$(echo "$line" | tr -d ' \t\r\n')
        BODY_CHAR_COUNT=$((BODY_CHAR_COUNT + ${#non_ws_line}))
    done
fi

# --- Rule 4: 实质性提交的正文字数底线与信息密度 ---
if [[ "$COMMIT_TYPE" =~ ^(feat|fix|refactor)$ ]]; then
    MIN_BODY_CHARS=30
    if [[ "$BODY_CHAR_COUNT" -lt "$MIN_BODY_CHARS" ]]; then
        fail_commit_msg "GATE-MSG-001" "Rule 4: 生产级关键提交 ($COMMIT_TYPE) 正文信息量不足！当前有效字数: $BODY_CHAR_COUNT" "$BODY_CHAR_COUNT 字符" ">= $MIN_BODY_CHARS 字符" "补充 [Why], [Changed], [Verification] 详细技术事实"
    fi

    # --- Rule 5: 结构化区块完整性校验 ---
    STRUCTURE_PATTERN='(\[(Project|Why|Added|Changed|Fixed|Removed|Verification|项目|项目归属|动机|背景|新增|变更|修改|修复|删除|验证).*?\]|^- )'
    if ! echo "$BODY_TEXT" | grep -iE "$STRUCTURE_PATTERN" >/dev/null 2>&1; then
        fail_commit_msg "GATE-MSG-001" "Rule 5: 关键提交 ($COMMIT_TYPE) 缺少生产级结构化区块！" "" "包含 [Project], [Why], [Added/Changed/Fixed], [Verification] 之一" "补充标准结构化区块 [Project], [Why], [Changed], [Verification]"
    fi
fi

# --- Rule 5.1: 项目归属格式区与合法枚举校验 (CMG-PRJ-001) ---
FOUND_PROJECT_HEADER=false
IN_PROJECT_SECTION=false
DECLARED_PROJECTS=()
PROJECT_HEADER_REGEX='^\[[[:space:]]*([pP][rR][oO][jJ][eE][cC][tT]|项目|项目归属)([[:space:]]*[:/|][[:space:]]*([^]]*))?\]([[:space:]]*:[[:space:]]*(.*))?$'

for ((i=2; i<TOTAL_LINES; i++)); do
    cur_line="${CLEAN_LINES[$i]}"
    trimmed_line=$(echo "$cur_line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    if [[ "$trimmed_line" =~ $PROJECT_HEADER_REGEX ]]; then
        FOUND_PROJECT_HEADER=true
        IN_PROJECT_SECTION=true
        inline_val="${BASH_REMATCH[3]}"
        if [[ -z "$inline_val" ]]; then
            inline_val="${BASH_REMATCH[5]}"
        fi
        if [[ -n "$inline_val" ]]; then
            IFS=',，、' read -ra parts <<< "$inline_val"
            for p in "${parts[@]}"; do
                p_clean=$(echo "$p" | sed -e 's/^[[:space:]-]*//' -e 's/[[:space:]]*$//' -e 's/[([（].*$//' -e 's/[[:space:]].*$//')
                if [[ -n "$p_clean" ]]; then
                    DECLARED_PROJECTS+=("$p_clean")
                fi
            done
        fi
    elif [[ "$IN_PROJECT_SECTION" == true ]]; then
        if [[ -z "$trimmed_line" ]]; then
            continue
        elif [[ "$trimmed_line" =~ ^\[.*\] ]]; then
            IN_PROJECT_SECTION=false
        elif [[ "$trimmed_line" =~ ^-[[:space:]]*(.*) ]]; then
            item_val="${BASH_REMATCH[1]}"
            IFS=',，、' read -ra parts <<< "$item_val"
            for p in "${parts[@]}"; do
                p_clean=$(echo "$p" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/[([（].*$//' -e 's/[[:space:]].*$//')
                if [[ -n "$p_clean" ]]; then
                    DECLARED_PROJECTS+=("$p_clean")
                fi
            done
        else
            IN_PROJECT_SECTION=false
        fi
    fi
done

if [[ "$COMMIT_TYPE" =~ ^(feat|fix|refactor)$ ]]; then
    if [[ "$FOUND_PROJECT_HEADER" == false ]]; then
        fail_commit_msg "CMG-PRJ-001" "Rule 5.1 (CMG-PRJ-001): 关键生产级提交 ($COMMIT_TYPE) 缺少项目归属格式区！" "" "[Project: workspace-timing | auto-refactor | WebGames | governance]" "在正文首个结构化区块声明 [Project / 项目归属]"
    fi

    if [[ ${#DECLARED_PROJECTS[@]} -eq 0 ]]; then
        fail_commit_msg "CMG-PRJ-001" "Rule 5.1 (CMG-PRJ-001): [Project / 项目归属] 区块未声明任何项目名称！" "" "workspace-timing | auto-refactor | WebGames | governance" "指定合法的项目归属名称"
    fi
fi

if [[ ${#DECLARED_PROJECTS[@]} -gt 0 ]]; then
    VALID_NORM=" workspace-timing auto-refactor webgames web-games governance "
    INVALID_PROJECTS=()
    for p in "${DECLARED_PROJECTS[@]}"; do
        p_lower=$(echo "$p" | tr '[:upper:]' '[:lower:]')
        if [[ ! "$VALID_NORM" =~ [[:space:]]"$p_lower"[[:space:]] ]]; then
            INVALID_PROJECTS+=("$p")
        fi
    done

    if [[ ${#INVALID_PROJECTS[@]} -gt 0 ]]; then
        INV_STR=$(IFS=', '; echo "${INVALID_PROJECTS[*]}")
        fail_commit_msg "CMG-PRJ-001" "Rule 5.1 (CMG-PRJ-001): 声明的项目归属包含未授权/非法的项目标识: $INV_STR" "$INV_STR" "workspace-timing | auto-refactor | WebGames | governance" "纠正项目名称为合法枚举之一"
    fi
fi

# --- Rule 6: 正文零黑话与无批次代号 ---
if echo "$BODY_TEXT" | grep -iE "\b(phase[0-9]+|st[0-9]+|p[0-9]+)\b" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "Rule 6: 提交正文包含违规施工批次代号/黑话 (phaseN/stN/pN)！" "" "纯客观技术事实" "基于功能特性与交付价值进行纯粹描述，移除批次代号"
fi

# --- Rule 7 & 8: 规则 ID 反虚构与求真务实禁词联合审查 ---
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
RESOLVED_MSG_FILE=$(realpath "$MSG_FILE" 2>/dev/null || readlink -f "$MSG_FILE" 2>/dev/null || echo "$MSG_FILE")
VALIDATE_ARGS=("$RESOLVED_MSG_FILE")
if [[ "$IS_AGENT" -eq 1 ]]; then
    VALIDATE_ARGS+=("--agent")
fi

if [[ "$IS_AGENT" -eq 1 ]]; then
    if ! (cd "$ROOT_DIR" && "$NODE_BIN" scripts/common/validate-commit-msg.js "${VALIDATE_ARGS[@]}" >/dev/null 2>&1); then
        if [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
        fi
        exit 1
    fi
else
    if ! (cd "$ROOT_DIR" && "$NODE_BIN" scripts/common/validate-commit-msg.js "${VALIDATE_ARGS[@]}"); then
        print_template_guide
        exit 1
    fi
fi

if [[ "$IS_AGENT" -eq 1 ]]; then
    cat <<EOF
{
  "protocolVersion": "1.0.0",
  "status": "PASS",
  "gate": "commit-msg",
  "summary": "All commit-msg validation rules passed cleanly."
}
EOF
    exit 0
fi

echo "  ✔ Rule 1: Header 格式与长度 (5~80 字符, 无句号) 合规"
echo "  ✔ Rule 2: 零黑话与空洞词检测通过"
echo "  ✔ Rule 3: Header-Body 空行分割契约合规"
echo "  ✔ Rule 4: 正文有效字数与信息密度 ($BODY_CHAR_COUNT 字符) 达标"
echo "  ✔ Rule 5: 生产工程级结构化区块校验通过"
if [[ ${#DECLARED_PROJECTS[@]} -gt 0 ]]; then
    PROJ_STR=$(IFS=', '; echo "${DECLARED_PROJECTS[*]}")
    echo "  ✔ Rule 5.1: 项目归属格式区合规 ([Project: $PROJ_STR])"
else
    echo "  ✔ Rule 5.1: 项目归属格式区校验通过 (免检/非强制类型)"
fi
echo "  ✔ Rule 6: 正文零施工批次黑话校验通过"
echo "  ✔ Rule 7: 规则 ID 单源目录一致性防虚构校验通过"
echo "  ✔ Rule 8: 提交文本求真务实与禁词审查合规 (零临时/零夸大/零贬损/零元叙事口号)"
echo "================================================================="
echo "✅ Commit-Msg 检查通过"
echo "================================================================="
exit 0
