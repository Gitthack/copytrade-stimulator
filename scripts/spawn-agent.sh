#!/bin/bash
#
# spawn-agent.sh - 生成Agent，调用Claude Code执行任务
#
# Usage: ./scripts/spawn-agent.sh <task-id> <task-type> <description>
#

set -e

TASK_ID="${1:-$(date +%s)}"
TASK_TYPE="${2:-feature}"
DESCRIPTION="${3:-}"
PROJECT_DIR="${4:-.}"

CLAWBOT_DIR="$PROJECT_DIR/.clawbot"
TASKS_FILE="$CLAWBOT_DIR/active-tasks.json"
WORKTREE_DIR="$CLAWBOT_DIR/worktrees/$TASK_ID"

echo "🚀 Spawning agent for task: $TASK_ID"
echo "   Type: $TASK_TYPE"
echo "   Description: $DESCRIPTION"

# 1. 创建git worktree (隔离)
echo "📁 Creating worktree..."
git worktree add "$WORKTREE_DIR" -b "agent/$TASK_ID" 2>/dev/null || {
    echo "   Branch exists, checking out..."
    git worktree add "$WORKTREE_DIR" "agent/$TASK_ID"
}

# 2. 读取任务模板
echo "📝 Loading prompt template..."
TEMPLATE_FILE="$CLAWBOT_DIR/prompt-templates/${TASK_TYPE}.md"
if [[ -f "$TEMPLATE_FILE" ]]; then
    PROMPT=$(cat "$TEMPLATE_FILE")
else
    PROMPT=$(cat <<'EOF'
You are Claude Code, an expert software engineer.
Your task is to implement the feature described below.

## Rules
1. Write clean, tested code
2. Follow existing project conventions
3. Create/update tests as needed
4. Update documentation if APIs change
5. Commit with descriptive messages

## Task
{{DESCRIPTION}}

## Context
- Project root: {{WORKTREE_DIR}}
- Task ID: {{TASK_ID}}
- Run tests before committing: npm test (or equivalent)

## Output
1. Implement the feature
2. Run tests
3. Commit changes
4. Push branch: git push origin agent/{{TASK_ID}}
5. Create PR description summarizing changes

Do not ask for clarification unless absolutely necessary. Use best judgment.
EOF
)
fi

# 替换变量
PROMPT="${PROMPT//\{\{DESCRIPTION\}\}/$DESCRIPTION}"
PROMPT="${PROMPT//\{\{TASK_ID\}\}/$TASK_ID}"
PROMPT="${PROMPT//\{\{WORKTREE_DIR\}\}/$WORKTREE_DIR}"

# 3. 注册任务到active-tasks.json
echo "📝 Registering task..."
TASK_ENTRY=$(cat <<EOF
{
  "id": "$TASK_ID",
  "type": "$TASK_TYPE",
  "description": "$DESCRIPTION",
  "worktree": "$WORKTREE_DIR",
  "branch": "agent/$TASK_ID",
  "status": "running",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "claude_pid": null,
  "check_count": 0
}
EOF
)

if [[ -f "$TASKS_FILE" ]]; then
    # 追加到JSON数组
    jq ". += [$TASK_ENTRY]" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
else
    echo "[$TASK_ENTRY]" > "$TASKS_FILE"
fi

# 4. 调用Claude Code (后台运行)
echo "🤖 Starting Claude Code..."
cd "$WORKTREE_DIR"

# 创建提示词文件
PROMPT_FILE="$WORKTREE_DIR/.clawbot-prompt.md"
echo "$PROMPT" > "$PROMPT_FILE"

# 后台运行Claude Code
# 注意: 这里假设claude CLI已安装并配置好API key
(
    # 设置API key环境变量
    export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(cat $HOME/.config/claude/config.json 2>/dev/null | jq -r '.apiKey // empty')}"
    
    # 运行claude并传递提示词
    claude --prompt "$PROMPT_FILE" --cwd "$WORKTREE_DIR" 2>&1 | tee "$WORKTREE_DIR/.clawbot-log.txt"
    
    # 更新任务状态
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 0 ]]; then
        NEW_STATUS="completed"
    else
        NEW_STATUS="failed"
    fi
    
    # 更新active-tasks.json
    jq "map(if .id == \"$TASK_ID\" then .status = \"$NEW_STATUS\" | .finished_at = \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" else . end)" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
    
    # 发送通知
    if [[ -f "$PROJECT_DIR/scripts/notify.sh" ]]; then
        "$PROJECT_DIR/scripts/notify.sh" "$TASK_ID" "$NEW_STATUS" "$DESCRIPTION"
    fi
) &

CLAUDE_PID=$!
echo "   Claude Code PID: $CLAUDE_PID"

# 更新PID到任务记录
jq "map(if .id == \"$TASK_ID\" then .claude_pid = $CLAUDE_PID else . end)" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"

echo ""
echo "✅ Agent spawned successfully!"
echo "   Task ID: $TASK_ID"
echo "   Worktree: $WORKTREE_DIR"
echo "   Branch: agent/$TASK_ID"
echo "   Log: $WORKTREE_DIR/.clawbot-log.txt"
echo ""
echo "Monitor with: ./scripts/monitor-agents.sh"
