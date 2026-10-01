#!/usr/bin/env bash
# =============================================================================
# commit-msg-gate.sh — 本地 Git 提交信息格式与零黑话门禁
# -----------------------------------------------------------------------------
# 职能域：gate
# 触发方：.githooks/commit-msg 或 本地 CLI 手动触发
# 用法：
#   bash scripts/sh/commit-msg-gate.sh <commit-msg-file>
# 依赖：bash, grep
# 退出码：0=通过；1=门禁阻断
# =============================================================================
set -uo pipefail

MSG_FILE="${1:?用法错误: 请传入 commit-msg 文件路径}"

if [[ ! -f "$MSG_FILE" ]]; then
    echo "❌ [FAIL] 提交信息文件不存在: $MSG_FILE"
    exit 1
fi

COMMIT_MSG=$(cat "$MSG_FILE")
FIRST_LINE=$(head -n 1 "$MSG_FILE" | tr -d '\r')

echo "================================================================="
echo "📝 执行本地 Commit-Msg 提交信息规范门禁"
echo "================================================================="
echo "提交标题: $FIRST_LINE"

# 1. 检查是否为空
if [[ -z "$FIRST_LINE" ]]; then
    echo "❌ [FAIL] 提交信息首行不能为空！"
    exit 1
fi

# 2. 检查 Header 格式规范
# 允许类型: feat | fix | refactor | docs | test | chore | style | perf
HEADER_PATTERN="^(feat|fix|refactor|docs|test|chore|style|perf)(\([a-zA-Z0-9_-]+\))?: .+$"
if ! echo "$FIRST_LINE" | grep -E "$HEADER_PATTERN" >/dev/null 2>&1; then
    echo "❌ [FAIL] 提交信息标题不符合规范！"
    echo "   标准格式: <type>(<scope>): <简述> 或 <type>: <简述>"
    echo "   允许类型: feat, fix, refactor, docs, test, chore, style, perf"
    echo "   例如: feat(auto-refactor): 引入公理化十维评分模型与代码密度噪声正交度量"
    exit 1
fi

# 3. 检查零黑话与临时违禁词
FORBIDDEN_WORDS="(wip|temp|test temp|tmp)"
if echo "$FIRST_LINE" | grep -iE "\b${FORBIDDEN_WORDS}\b" >/dev/null 2>&1; then
    echo "❌ [FAIL] 提交标题包含违规黑话/临时性标记 (wip/temp/tmp 等)！"
    exit 1
fi

# 4. 标题长度建议 (<= 80 字符)
CHAR_COUNT=${#FIRST_LINE}
if [[ "$CHAR_COUNT" -gt 85 ]]; then
    echo "⚠️  [WARN] 提交标题略长 ($CHAR_COUNT > 80 字符)，建议精简。"
fi

echo "✅ 【门禁结论】Commit-Msg 格式校验全部 PASS！"
echo "================================================================="
exit 0
