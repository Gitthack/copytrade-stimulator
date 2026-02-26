#!/bin/bash
#
# review-code.sh - 多模型代码审查
#
# Usage: ./scripts/review-code.sh <task-id>
#

set -e

TASK_ID="${1:-}"
PROJECT_DIR="${2:-.}"

if [[ -z "$TASK_ID" ]]; then
    echo "Usage: ./scripts/review-code.sh <task-id>"
    exit 1
fi

CLAWBOT_DIR="$PROJECT_DIR/.clawbot"
TASKS_FILE="$CLAWBOT_DIR/active-tasks.json"
REVIEW_DIR="$CLAWBOT_DIR/reviews"

mkdir -p "$REVIEW_DIR"

# 获取任务信息
TASK=$(jq -r ".[] | select(.id == \"$TASK_ID\")" "$TASKS_FILE")
if [[ -z "$TASK" ]]; then
    echo "❌ Task not found: $TASK_ID"
    exit 1
fi

WORKTREE=$(echo "$TASK" | jq -r '.worktree')
BRANCH=$(echo "$TASK" | jq -r '.branch')
DESCRIPTION=$(echo "$TASK" | jq -r '.description')

echo "🔍 Code Review for Task: $TASK_ID"
echo "================================"
echo ""

# 进入worktree
cd "$WORKTREE"

# 获取变更的文件
echo "📁 Changed files:"
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only HEAD
CHANGED_FILES=$(git diff --name-only HEAD~1 2>/dev/null || git diff --name-only HEAD)
echo "$CHANGED_FILES"
echo ""

# 生成diff
DIFF=$(git diff HEAD~1 2>/dev/null || git diff HEAD)
DIFF_SUMMARY=$(echo "$DIFF" | head -100)

# 创建审查提示
REVIEW_PROMPT=$(cat <<EOF
You are an expert code reviewer. Review the following code changes.

## Task Description
$DESCRIPTION

## Changed Files
$CHANGED_FILES

## Diff Summary (first 100 lines)
\`\`\`diff
$DIFF_SUMMARY
\`\`\`

## Review Checklist
1. Code quality and readability
2. Potential bugs or edge cases
3. Security issues
4. Performance concerns
5. Test coverage
6. Documentation updates

## Output Format
Provide a structured review:

### Summary
Brief overview of changes

### Issues Found
- [Severity: High/Medium/Low] Description

### Recommendations
- Specific suggestions

### Approval Status
- [ ] Approved
- [ ] Approved with minor changes
- [ ] Changes requested
- [ ] Needs discussion

Be concise but thorough.
EOF
)

# 保存审查提示
REVIEW_PROMPT_FILE="$REVIEW_DIR/${TASK_ID}-prompt.md"
echo "$REVIEW_PROMPT" > "$REVIEW_PROMPT_FILE"

echo "🤖 Running code review..."
echo ""

# 1. Claude自审 (通过API调用)
echo "1️⃣ Claude Self-Review"
CLAUDE_REVIEW_FILE="$REVIEW_DIR/${TASK_ID}-claude.md"

# 使用curl调用Claude API
CLAUDE_RESPONSE=$(curl -s -X POST https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${ANTHROPIC_API_KEY:-}" \
  -H "anthropic-version: 2023-06-01" \
  -d "{
    \"model\": \"claude-3-5-sonnet-20241022\",
    \"max_tokens\": 2000,
    \"messages\": [{\"role\": \"user\", \"content\": $(echo "$REVIEW_PROMPT" | jq -Rs .)}]
  }" 2>/dev/null || echo '{"content":[{"text":"Claude API not available"}]}')

echo "$CLAUDE_RESPONSE" | jq -r '.content[0].text // "Claude review failed"' > "$CLAUDE_REVIEW_FILE"
echo "   ✅ Claude review saved to $CLAUDE_REVIEW_FILE"
echo ""

# 2. Kimi审查 (当前会话，直接执行)
echo "2️⃣ Kimi Review"
KIMI_REVIEW_FILE="$REVIEW_DIR/${TASK_ID}-kimi.md"

# 读取diff进行审查
KIMI_REVIEW=$(cat <<EOF
## Kimi Code Review

### Task
$DESCRIPTION

### Files Changed
$CHANGED_FILES

### Quick Assessment
- Diff size: $(echo "$DIFF" | wc -l) lines
- Files touched: $(echo "$CHANGED_FILES" | wc -l) files

### Review Notes
EOF
)

# 这里Kimi(我)应该实际审查代码，但由于是在脚本中，我们记录需要审查的事实
echo "$KIMI_REVIEW" > "$KIMI_REVIEW_FILE"
echo "   ⚠️  Kimi review requires manual check (run in active session)"
echo "   📄 Review file: $KIMI_REVIEW_FILE"
echo ""

# 3. Gemini审查 (通过API调用)
echo "3️⃣ Gemini Review"
GEMINI_REVIEW_FILE="$REVIEW_DIR/${TASK_ID}-gemini.md"

GEMINI_API_KEY="${GEMINI_API_KEY:-}"

if [[ -n "$GEMINI_API_KEY" ]]; then
    GEMINI_RESPONSE=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=$GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -X POST \
      -d "{
        \"contents\": [{\"parts\": [{\"text\": $(echo "$REVIEW_PROMPT" | jq -Rs .)}]}]
      }" 2>/dev/null || echo '{"candidates":[{"content":{"parts":[{"text":"Gemini API not available"}]}}]}')
    
    echo "$GEMINI_RESPONSE" | jq -r '.candidates[0].content.parts[0].text // "Gemini review failed"' > "$GEMINI_REVIEW_FILE"
    echo "   ✅ Gemini review saved to $GEMINI_REVIEW_FILE"
else
    echo "   ⚠️  Gemini API key not configured"
    echo "   Set GEMINI_API_KEY environment variable"
fi

echo ""
echo "================================"
echo "📊 Review Summary"
echo "================================"
echo ""
echo "Task: $TASK_ID"
echo "Branch: $BRANCH"
echo ""
echo "Review files:"
echo "  - Claude: $CLAUDE_REVIEW_FILE"
echo "  - Kimi:   $KIMI_REVIEW_FILE"
echo "  - Gemini: $GEMINI_REVIEW_FILE"
echo ""

# 汇总审查结果
FINAL_REVIEW=$(cat <<EOF
{
  "task_id": "$TASK_ID",
  "reviewed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files_changed": $(echo "$CHANGED_FILES" | jq -R -s -c 'split("\n") | map(select(length > 0))'),
  "reviews": {
    "claude": "$(cat $CLAUDE_REVIEW_FILE | head -20 | tr '\n' ' ')",
    "kimi": "pending_manual_review",
    "gemini": "$(cat $GEMINI_REVIEW_FILE 2>/dev/null | head -20 | tr '\n' ' ' || echo 'not_available')"
  },
  "status": "pending_approval"
}
EOF
)

REVIEW_RESULT_FILE="$WORKTREE/.clawbot-review.json"
echo "$FINAL_REVIEW" | jq . > "$REVIEW_RESULT_FILE"

echo "Review result: $REVIEW_RESULT_FILE"
echo ""
echo "Next steps:"
echo "  1. Check review files above"
echo "  2. If approved, merge: git merge $BRANCH"
echo "  3. Cleanup: git worktree remove $WORKTREE"
