#!/bin/bash
#
# monitor-agents.sh - 监控任务状态
#
# Usage: ./scripts/monitor-agents.sh [task-id]
#

set -e

PROJECT_DIR="${1:-.}"
TASK_ID="${2:-}"
CLAWBOT_DIR="$PROJECT_DIR/.clawbot"
TASKS_FILE="$CLAWBOT_DIR/active-tasks.json"

echo "🔍 Agent Monitor"
echo "================"
echo ""

if [[ ! -f "$TASKS_FILE" ]]; then
    echo "No active tasks found."
    exit 0
fi

# 如果没有指定task-id，列出所有任务
if [[ -z "$TASK_ID" ]]; then
    echo "Active Tasks:"
    echo ""
    
    # 使用jq格式化输出
    jq -r '
        .[] | 
        "📋 Task: \(.id)\n" +
        "   Type: \(.type)\n" +
        "   Status: \(.status)\n" +
        "   Started: \(.started_at)\n" +
        "   Branch: \(.branch)\n" +
        "   Worktree: \(.worktree)\n" +
        ""
    ' "$TASKS_FILE" 2>/dev/null || cat "$TASKS_FILE"
    
    echo ""
    echo "Check specific task: ./scripts/monitor-agents.sh <task-id>"
    echo "Review completed: ./scripts/review-code.sh"
    exit 0
fi

# 检查特定任务
echo "Checking task: $TASK_ID"
echo ""

TASK=$(jq -r ".[] | select(.id == \"$TASK_ID\")" "$TASKS_FILE")

if [[ -z "$TASK" ]]; then
    echo "❌ Task not found: $TASK_ID"
    exit 1
fi

STATUS=$(echo "$TASK" | jq -r '.status')
WORKTREE=$(echo "$TASK" | jq -r '.worktree')
BRANCH=$(echo "$TASK" | jq -r '.branch')

echo "Status: $STATUS"
echo "Branch: $BRANCH"
echo "Worktree: $WORKTREE"
echo ""

# 检查进程状态
if [[ "$STATUS" == "running" ]]; then
    PID=$(echo "$TASK" | jq -r '.claude_pid // empty')
    
    if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
        echo "🟢 Claude Code is running (PID: $PID)"
    else
        echo "🟡 Process not found, checking git status..."
        
        # 检查是否有新提交
        cd "$WORKTREE"
        
        if git log --oneline --decorate | grep -q "$BRANCH"; then
            echo "   Commits found on branch"
            git log --oneline -5
            
            # 更新状态为completed
            jq "map(if .id == \"$TASK_ID\" then .status = \"completed\" else . end)" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
            
            echo ""
            echo "✅ Task marked as completed"
            
            # 触发代码审查
            echo "🔄 Triggering code review..."
            "$PROJECT_DIR/scripts/review-code.sh" "$TASK_ID"
        else
            echo "   No commits yet"
        fi
    fi
    
    # 显示最近日志
    LOG_FILE="$WORKTREE/.clawbot-log.txt"
    if [[ -f "$LOG_FILE" ]]; then
        echo ""
        echo "📄 Recent log (last 20 lines):"
        tail -20 "$LOG_FILE"
    fi
elif [[ "$STATUS" == "completed" ]]; then
    echo "✅ Task completed"
    echo ""
    
    # 显示提交
    cd "$WORKTREE"
    echo "Commits:"
    git log --oneline -5
    
    # 检查是否有PR
    echo ""
    echo "Review status:"
    if [[ -f "$WORKTREE/.clawbot-review.json" ]]; then
        cat "$WORKTREE/.clawbot-review.json"
    else
        echo "   Pending review"
        echo "   Run: ./scripts/review-code.sh $TASK_ID"
    fi
elif [[ "$STATUS" == "failed" ]]; then
    echo "❌ Task failed"
    
    LOG_FILE="$WORKTREE/.clawbot-log.txt"
    if [[ -f "$LOG_FILE" ]]; then
        echo ""
        echo "📄 Error log (last 30 lines):"
        tail -30 "$LOG_FILE"
    fi
fi

# 增加检查计数
jq "map(if .id == \"$TASK_ID\" then .check_count = ((.check_count // 0) + 1) else . end)" "$TASKS_FILE" > "$TASKS_FILE.tmp" && mv "$TASKS_FILE.tmp" "$TASKS_FILE"
