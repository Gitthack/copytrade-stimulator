#!/bin/bash
#
# notify.sh - Telegram通知
#
# Usage: ./scripts/notify.sh <task-id> <status> [message]
#

set -e

TASK_ID="${1:-}"
STATUS="${2:-}"
MESSAGE="${3:-}"
PROJECT_DIR="${4:-.}"

if [[ -z "$TASK_ID" || -z "$STATUS" ]]; then
    echo "Usage: ./scripts/notify.sh <task-id> <status> [message]"
    exit 1
fi

# Telegram配置 (从环境变量或配置文件读取)
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

# 尝试从配置文件读取
if [[ -z "$TELEGRAM_BOT_TOKEN" && -f "$HOME/.clawbot/config.json" ]]; then
    TELEGRAM_BOT_TOKEN=$(cat "$HOME/.clawbot/config.json" | jq -r '.telegram.bot_token // empty')
    TELEGRAM_CHAT_ID=$(cat "$HOME/.clawbot/config.json" | jq -r '.telegram.chat_id // empty')
fi

if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
    echo "⚠️  Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
    exit 0
fi

# 构建通知消息
EMOJI="🤖"
case "$STATUS" in
    "completed")
        EMOJI="✅"
        ;;
    "failed")
        EMOJI="❌"
        ;;
    "running")
        EMOJI="🔄"
        ;;
    "review_pending")
        EMOJI="👀"
        ;;
esac

NOTIFICATION="${EMOJI} *Agent Task Update*

*Task ID:* \`${TASK_ID}\`
*Status:* ${STATUS}

${MESSAGE}

_$(date '+%Y-%m-%d %H:%M:%S')_"

# 发送Telegram消息
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${NOTIFICATION}" \
    -d "parse_mode=Markdown" \
    -d "disable_web_page_preview=true" > /dev/null

echo "📨 Telegram notification sent"
