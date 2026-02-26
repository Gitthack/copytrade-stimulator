# Agent Orchestration System

## 三层架构

```
┌─────────────────────────────────────────┐
│           编排层 (Kimi)                  │
│  - 读取 MEMORY.md / memory/             │
│  - 理解业务上下文                        │
│  - 生成任务提示词                        │
│  - 选择 Agent + 模型                     │
│  - 监控进度                              │
│  - Telegram 通知                         │
└─────────────┬───────────────────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼────┐         ┌────▼────┐
│ Claude │         │ Gemini  │
│ Code   │         │         │
│        │         │         │
│ • 编码  │         │ • 审查  │
│ • 测试  │         │ • 安全  │
│ • PR   │         │ • 设计  │
└────────┘         └─────────┘
```

## 核心流程

```
想法/需求 → Kimi梳理 → 生成提示词 → 调用Claude Code → 创建PR → Kimi+Gemini审查 → CI测试 → Kimi检查 → Telegram通知 → 币世王合并
```

## 脚本使用

### 1. 生成Agent执行任务
```bash
./scripts/spawn-agent.sh <task-id> <task-type> <description> [project-dir]
```

示例:
```bash
./scripts/spawn-agent.sh "feat-auth" "feature" "Add JWT authentication to API"
```

### 2. 监控任务状态
```bash
# 列出所有任务
./scripts/monitor-agents.sh

# 检查特定任务
./scripts/monitor-agents.sh <task-id>
```

### 3. 代码审查
```bash
./scripts/review-code.sh <task-id>
```

### 4. 发送通知
```bash
./scripts/notify.sh <task-id> <status> [message]
```

## 配置

### 环境变量
```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
export GEMINI_API_KEY="AIzaSyBnHEum..."
export TELEGRAM_BOT_TOKEN="..."
export TELEGRAM_CHAT_ID="..."
```

### 配置文件 (~/.clawbot/config.json)
```json
{
  "anthropic": {
    "api_key": "sk-ant-api03-..."
  },
  "gemini": {
    "api_key": "AIzaSyBnHEum..."
  },
  "telegram": {
    "bot_token": "...",
    "chat_id": "..."
  }
}
```

## 任务类型模板

在 `.clawbot/prompt-templates/` 创建模板文件:
- `feature.md` - 新功能开发
- `bugfix.md` - Bug修复
- `refactor.md` - 重构
- `test.md` - 测试编写

## Cron监控

添加定时检查:
```bash
*/10 * * * * cd /path/to/project && ./scripts/monitor-agents.sh
```

## 工作流程

1. **创建任务**: Kimi分析需求 → 调用 `spawn-agent.sh`
2. **执行中**: Claude Code在worktree中工作
3. **监控**: Cron每10分钟检查状态
4. **完成**: 自动触发代码审查
5. **审查**: Claude自审 + Kimi审 + Gemini审
6. **通知**: Telegram通知币世王
7. **合并**: 币世王审查并合并

## 文件结构

```
.clawbot/
├── active-tasks.json          # 任务注册表
├── worktrees/                 # git worktree目录
│   └── <task-id>/            # 每个任务的隔离工作区
├── prompt-templates/          # 提示词模板
│   ├── feature.md
│   ├── bugfix.md
│   └── refactor.md
└── reviews/                   # 审查结果
    ├── <task-id>-claude.md
    ├── <task-id>-kimi.md
    └── <task-id>-gemini.md
```
