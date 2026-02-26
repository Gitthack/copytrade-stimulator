const axios = require('axios');

class TelegramNotifier {
  constructor(botToken, chatId) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = chatId || process.env.TELEGRAM_CHAT_ID;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  async sendMessage(text) {
    if (!this.botToken || !this.chatId) {
      console.log('Telegram not configured');
      return;
    }

    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error('Telegram send failed:', err.message);
    }
  }

  // 资金抽离提醒
  async sendWithdrawalAlert(trader, daysSince) {
    const message = `🚨 *资金抽离预警*

交易员: \`${trader.label || trader.address.slice(0, 20)}...\`
历史盈利: +$${(trader.total_pnl || 0).toFixed(2)}
最后交易: ${daysSince} 天前

⚠️ 该交易员可能已撤资，建议检查链上余额`;

    await this.sendMessage(message);
  }

  // 大额交易提醒
  async sendLargeTradeAlert(trader, trade, amount) {
    const message = `💰 *大额交易*

交易员: \`${trader.label || trader.address.slice(0, 20)}...\`
金额: $${amount.toFixed(2)}
盈亏: ${trade.profit_loss >= 0 ? '+' : ''}$${trade.profit_loss.toFixed(2)}

🔔 关注该交易员的最新动向`;

    await this.sendMessage(message);
  }

  // 每日报告
  async sendDailyReport(stats, recommendations) {
    const totalPnl = stats.reduce((sum, s) => sum + (s.total_pnl || 0), 0);
    const winRate = stats.length > 0 
      ? (stats.filter(s => (s.total_pnl || 0) > 0).length / stats.length * 100).toFixed(1)
      : 0;

    let message = `📊 *每日 CopyTrade 报告*

`;
    message += `追踪交易员: ${stats.length} 人\n`;
    message += `总盈亏: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}\n`;
    message += `胜率: ${winRate}%\n\n`;

    if (recommendations.length > 0) {
      message += `*AI 建议:*\n`;
      recommendations.slice(0, 3).forEach(rec => {
        const icon = rec.type === 'REMOVE' ? '❌' : rec.type === 'INCREASE' ? '✅' : '⚡';
        message += `${icon} ${rec.reason.substring(0, 50)}...\n`;
      });
    }

    await this.sendMessage(message);
  }
}

module.exports = TelegramNotifier;
