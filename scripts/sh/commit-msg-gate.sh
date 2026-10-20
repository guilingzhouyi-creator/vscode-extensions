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
    echo "❌ BLOCK  提交信息文件不存在: $MSG_FILE"
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

fail_commit_msg() {
    local rule_id="$1"
    local message="$2"
    local actual="${3:-}"
    local expected="${4:-}"
    local actionable_fix="${5:-}"

    # 失败判定必须绑定到登记的步骤身份：裸文本让操作者无从知道是哪一步阻断。
    local failed_step_id
    if [[ "$message" =~ \[([A-Z][A-Z0-9]*(-[A-Z0-9]+)*-[0-9]{2})\] ]]; then
        failed_step_id="${BASH_REMATCH[1]}"
        write_step_banner "$failed_step_id"
        write_step_verdict "$failed_step_id" BLOCK "$message"
    fi

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

    echo "❌ BLOCK  ${rule_id}: $message"
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

# 读取所有行并过滤掉以 # 开头的注释行
mapfile -t RAW_LINES < "$MSG_FILE"
CLEAN_LINES=()
for line in "${RAW_LINES[@]}"; do
    trimmed="${line%"${line##*[![:space:]]}"}"
    [[ "$trimmed" =~ ^[[:space:]]*# ]] && continue
    CLEAN_LINES+=("$trimmed")
done
TOTAL_LINES=${#CLEAN_LINES[@]}

if [[ "$TOTAL_LINES" -eq 0 || -z "${CLEAN_LINES[0]}" ]]; then
    fail_commit_msg "GUARD-MSG-001" "提交信息不能为空！" "" "符合 Conventional Commits 格式的提交内容" "请参考规范填写格式化提交信息"
fi

FIRST_LINE="${CLEAN_LINES[0]}"
if [[ "$IS_AGENT" -ne 1 ]]; then
    echo "提交标题: $FIRST_LINE"
fi

# --- 标题格式与长度校验 ---
HEADER_PATTERN="^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_\-\/,@.]+\))?: .{4,80}$"
if ! echo "$FIRST_LINE" | grep -E "$HEADER_PATTERN" >/dev/null 2>&1; then
    fail_commit_msg "GUARD-MSG-001" "[HEADER-FORM-01] 提交标题不符合生产级格式规范！" "$FIRST_LINE" "<type>(<scope>): <简述> (4~80 字符)" "调整为 feat/fix/refactor/docs/test/chore/style/perf(<scope>): 描述"
fi

# 检查标题末尾不得有句号
if [[ "$FIRST_LINE" =~ [.。]$ ]]; then
    fail_commit_msg "GUARD-MSG-001" "[HEADER-FORM-01] 提交标题末尾严禁包含句号" "$FIRST_LINE" "末尾无句号" "移除标题末尾句号"
fi

# --- 标题零黑话与空洞泛化词拦截 ---
FORBIDDEN_WORDS="\b(wip|temp|test temp|tmp)\b"
if echo "$FIRST_LINE" | grep -iE "$FORBIDDEN_WORDS" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "[SLANG-GUARD-02] 提交标题包含违规黑话或临时性标记" "$FIRST_LINE" "零黑话技术描述" "陈述具体完成的技术特性，严禁使用 wip/temp"
fi

LAZY_WORDS="^([a-z]+(\([^\)]+\))?:\s*(update|modify|changes|fix|test|fixes|clean|refactor|todo|修复问题|更新代码|修改代码|新增功能|优化代码|日常更新|代码重构))\s*$"
if echo "$FIRST_LINE" | grep -iE "$LAZY_WORDS" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "[SLANG-GUARD-02] 提交标题过于空洞，未说明具体改动" "$FIRST_LINE" "说明具体改动模块与功能" "明确陈述具体变更逻辑"
fi

# 提取提交类型
COMMIT_TYPE=$(echo "$FIRST_LINE" | sed -E 's/^([a-z]+)(\(.*\))?:.*$/\1/')

# --- 标题与正文空行分割契约 ---
if [[ "$TOTAL_LINES" -gt 1 ]]; then
    SECOND_LINE="${CLEAN_LINES[1]}"
    if [[ -n "$SECOND_LINE" ]]; then
        fail_commit_msg "GUARD-MSG-001" "[BODY-SPLIT-03] 标题与正文之间第 2 行必须保留空行" "$SECOND_LINE" "第 2 行为独立空行" "在标题与正文之间插入一个空行"
    fi
fi

# --- 统计正文内容（第 3 行及之后）---
BODY_TEXT=""
BODY_CHAR_COUNT=0
BODY_SUBSTANTIVE_CHARS=0
IN_PROJECT_BLOCK=0
if [[ "$TOTAL_LINES" -gt 2 ]]; then
    for ((i=2; i<TOTAL_LINES; i++)); do
        line="${CLEAN_LINES[$i]}"
        BODY_TEXT="${BODY_TEXT}${line}"$'\n'
        # 统计非空白字符（参数展开，避免循环内子进程）
        non_ws_line="${line//[[:space:]]/}"
        BODY_CHAR_COUNT=$((BODY_CHAR_COUNT + ${#non_ws_line}))

        trimmed_body_line="${line#"${line%%[![:space:]]*}"}"
        trimmed_body_line="${trimmed_body_line%"${trimmed_body_line##*[![:space:]]}"}"
        if echo "$trimmed_body_line" | grep -qE '^\[[^]]+\]([[:space:]]*:.*)?[[:space:]]*$'; then
            if echo "$trimmed_body_line" | grep -qiE '^\[(Project|项目|项目归属)'; then
                IN_PROJECT_BLOCK=1
            else
                IN_PROJECT_BLOCK=0
            fi
            continue
        fi
        if [[ "$IN_PROJECT_BLOCK" -eq 1 ]]; then
            if [[ -z "$trimmed_body_line" ]] || [[ "$trimmed_body_line" =~ ^- ]]; then
                continue
            fi
            IN_PROJECT_BLOCK=0
        fi
        BODY_SUBSTANTIVE_CHARS=$((BODY_SUBSTANTIVE_CHARS + ${#non_ws_line}))
    done
fi

# --- 正文字数底线与信息密度 ---
if [[ "$COMMIT_TYPE" =~ ^(feat|fix|refactor|perf)$ ]]; then
    MIN_BODY_CHARS=30
    if [[ "$BODY_SUBSTANTIVE_CHARS" -lt "$MIN_BODY_CHARS" ]]; then
        fail_commit_msg "GUARD-MSG-001" "[BODY-DENSITY-04] 生产级关键提交 ($COMMIT_TYPE) 正文实质信息量不足！当前实质字数: $BODY_SUBSTANTIVE_CHARS（区块标题与项目归属不计入）" "$BODY_SUBSTANTIVE_CHARS 字符" ">= $MIN_BODY_CHARS 字符" "补充 [Why], [Changed], [Verification] 的实质技术事实"
    fi

    # --- 结构化区块完整性校验 ---
    HAS_WHY=0
    HAS_CHANGE=0
    HAS_VERIFICATION=0
    echo "$BODY_TEXT" | grep -iE '\[(Why|动机|背景).*?\]' >/dev/null 2>&1 && HAS_WHY=1 || true
    echo "$BODY_TEXT" | grep -iE '\[(Added|Changed|Fixed|Removed|新增|变更|修改|修复|删除).*?\]' >/dev/null 2>&1 && HAS_CHANGE=1 || true
    echo "$BODY_TEXT" | grep -iE '\[(Verification|验证|验证结论).*?\]' >/dev/null 2>&1 && HAS_VERIFICATION=1 || true

    if [[ "$HAS_WHY" -eq 0 || "$HAS_CHANGE" -eq 0 || "$HAS_VERIFICATION" -eq 0 ]]; then
        fail_commit_msg "GUARD-MSG-001" "[BODY-SECTIONS-05] 关键提交 ($COMMIT_TYPE) 结构化区块不完整！必须同时包含 [Why], [Changed/Added/Fixed], [Verification] 区块。" "" "[Why], [Changed/Added/Fixed], [Verification]" "补充标准结构化区块 [Why], [Changed], [Verification]"
    fi

    if [[ "$COMMIT_TYPE" == "fix" ]] && ! echo "$BODY_TEXT" | grep -iE '\[(Fixed|修复|修复缺陷).*?\]' >/dev/null 2>&1; then
        fail_commit_msg "GUARD-MSG-001" "[BODY-SECTIONS-05] 缺陷修复提交 (fix) 必须显式包含 [Fixed / 修复缺陷] 区块说明具体修复的缺陷与根因！" "" "[Fixed / 修复缺陷]" "补充 [Fixed] 区块明确缺陷现象与根因"
    fi
fi

# --- 项目归属格式区与合法枚举校验 ---
FOUND_PROJECT_HEADER=false
IN_PROJECT_SECTION=false
DECLARED_PROJECTS=()
PROJECT_HEADER_REGEX='^\[[[:space:]]*([pP][rR][oO][jJ][eE][cC][tT]([[:space:]]*/[[:space:]]*(项目|项目归属))?|项目归属|项目)([[:space:]]*:[[:space:]]*([^]]*))?\]([[:space:]]*:[[:space:]]*(.*))?$'

for ((i=2; i<TOTAL_LINES; i++)); do
    cur_line="${CLEAN_LINES[$i]}"
    trimmed_line="${cur_line#"${cur_line%%[![:space:]]*}"}"
    trimmed_line="${trimmed_line%"${trimmed_line##*[![:space:]]}"}"
    if [[ "$trimmed_line" =~ $PROJECT_HEADER_REGEX ]]; then
        FOUND_PROJECT_HEADER=true
        IN_PROJECT_SECTION=true
        inline_val="${BASH_REMATCH[4]}"
        if [[ -z "$inline_val" ]]; then
            inline_val="${BASH_REMATCH[6]}"
        fi
        if [[ -n "$inline_val" ]]; then
            IFS=',，、' read -ra parts <<< "$inline_val"
            for p in "${parts[@]}"; do
                p_clean="${p#"${p%%[![:space:]]*}"}"
                p_clean="${p_clean#-}"
                p_clean="${p_clean#"${p_clean%%[![:space:]]*}"}"
                p_clean="${p_clean%%(*}"
                p_clean="${p_clean%%（*}"
                p_clean="${p_clean%"${p_clean##*[![:space:]]}"}"
                p_clean="${p_clean%%[[:space:]]*}"
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
                p_clean="${p#"${p%%[![:space:]]*}"}"
                p_clean="${p_clean%%(*}"
                p_clean="${p_clean%%（*}"
                p_clean="${p_clean%"${p_clean##*[![:space:]]}"}"
                p_clean="${p_clean%%[[:space:]]*}"
                if [[ -n "$p_clean" ]]; then
                    DECLARED_PROJECTS+=("$p_clean")
                fi
            done
        else
            IN_PROJECT_SECTION=false
        fi
    fi
done

if [[ "$COMMIT_TYPE" =~ ^(feat|fix|refactor|perf)$ ]]; then
    if [[ "$FOUND_PROJECT_HEADER" == false ]]; then
        fail_commit_msg "CMG-PRJ-001" "[PROJECT-SCOPE-06] (CMG-PRJ-001) 关键生产级提交 ($COMMIT_TYPE) 缺少项目归属格式区！" "" "[Project: workspace-timing | auto-refactor | WebGames | fractal-git | governance]" "在正文首个结构化区块声明 [Project / 项目归属]"
    fi

    if [[ ${#DECLARED_PROJECTS[@]} -eq 0 ]]; then
        fail_commit_msg "CMG-PRJ-001" "[PROJECT-SCOPE-06] (CMG-PRJ-001) [Project / 项目归属] 区块未声明任何项目名称！" "" "workspace-timing | auto-refactor | WebGames | fractal-git | governance" "指定合法的项目归属名称"
    fi
fi

if [[ ${#DECLARED_PROJECTS[@]} -gt 0 ]]; then
    VALID_NORM=" workspace-timing auto-refactor webgames web-games fractal-git fractalgit governance "
    INVALID_PROJECTS=()
    for p in "${DECLARED_PROJECTS[@]}"; do
        p_lower="${p,,}"
        if [[ ! "$VALID_NORM" =~ [[:space:]]"$p_lower"[[:space:]] ]]; then
            INVALID_PROJECTS+=("$p")
        fi
    done

    if [[ ${#INVALID_PROJECTS[@]} -gt 0 ]]; then
        INV_STR=$(IFS=', '; echo "${INVALID_PROJECTS[*]}")
        fail_commit_msg "CMG-PRJ-001" "[PROJECT-SCOPE-06] (CMG-PRJ-001) 声明的项目归属包含未授权/非法的项目标识: $INV_STR" "$INV_STR" "workspace-timing | auto-refactor | WebGames | fractal-git | governance" "纠正项目名称为合法枚举之一"
    fi
fi

# --- 正文零批次代号与工期黑话 ---
if echo "$BODY_TEXT" | grep -iE "\b(phase[0-9]+|st[0-9]+|p[0-9]+|sprint[[:space:]]*[0-9]+|w[1-9]|pass[[:space:]]*[1-6])\b" >/dev/null 2>&1; then
    fail_commit_msg "CMG-STY-001" "[BATCH-CODE-07] 提交正文包含违规工期代号或批次黑话 (phaseN/stN/pN/sprintN/wN/passN)！" "" "纯客观技术事实" "基于功能特性与交付价值进行纯粹描述，移除批次与工期代号"
fi

# --- 规则标识反虚构与文本求真联合审查 ---
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
RESOLVED_MSG_FILE=$(realpath "$MSG_FILE" 2>/dev/null || readlink -f "$MSG_FILE" 2>/dev/null || echo "$MSG_FILE")
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
write_step_verdict "BODY-DENSITY-04" PASS "正文实质字数 $BODY_SUBSTANTIVE_CHARS 达标"
write_step_banner "BODY-SECTIONS-05"
write_step_verdict "BODY-SECTIONS-05" PASS "结构化区块完整"
write_step_banner "PROJECT-SCOPE-06"
if [[ ${#DECLARED_PROJECTS[@]} -gt 0 ]]; then
    PROJ_STR=$(IFS=', '; echo "${DECLARED_PROJECTS[*]}")
    write_step_verdict "PROJECT-SCOPE-06" PASS "项目归属合规 ([Project: $PROJ_STR])"
else
    write_step_verdict "PROJECT-SCOPE-06" SKIP "免检类型，不强制项目归属"
fi
write_step_banner "BATCH-CODE-07"
write_step_verdict "BATCH-CODE-07" PASS "正文零批次代号"
write_step_banner "RULE-TRUTH-08"
write_step_verdict "RULE-TRUTH-08" PASS "规则标识反虚构"
write_step_banner "TEXT-TRUTH-09"
write_step_verdict "TEXT-TRUTH-09" PASS "文本求真务实与禁词合规"
echo "================================================================="
echo "✅ Commit-Msg 检查通过"
echo "================================================================="
exit 0
