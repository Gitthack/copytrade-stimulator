class BacktestEngine {
  constructor(db) {
    this.db = db;
  }

  // 回测单个交易员
  backtestTrader(addressId, options = {}) {
    const trades = this.db.db.prepare(
      'SELECT * FROM trades WHERE address_id = ? ORDER BY timestamp ASC'
    ).all(addressId);

    if (trades.length === 0) {
      return { error: 'No trade history' };
    }

    const initialCapital = options.initialCapital || 1000;
    let capital = initialCapital;
    let maxCapital = capital;
    let minCapital = capital;
    let wins = 0;
    let losses = 0;
    const dailyReturns = [];

    trades.forEach((trade, i) => {
      const pnl = trade.profit_loss || 0;
      const positionSize = capital * 0.1; // 每次投入10%
      const actualPnl = (pnl / 100) * positionSize; // 按比例计算

      capital += actualPnl;

      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;

      maxCapital = Math.max(maxCapital, capital);
      minCapital = Math.min(minCapital, capital);

      // 记录每日收益
      if (i > 0) {
        dailyReturns.push({
          date: trade.timestamp,
          return: (actualPnl / (capital - actualPnl)) * 100
        });
      }
    });

    const totalReturn = ((capital - initialCapital) / initialCapital) * 100;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const maxDrawdown = ((maxCapital - minCapital) / maxCapital) * 100;

    // 计算夏普比率 (简化版)
    const avgReturn = dailyReturns.reduce((sum, d) => sum + d.return, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, d) => sum + Math.pow(d.return - avgReturn, 2), 0) / dailyReturns.length;
    const sharpeRatio = variance > 0 ? avgReturn / Math.sqrt(variance) : 0;

    return {
      initialCapital,
      finalCapital: capital,
      totalReturn,
      totalTrades: trades.length,
      wins,
      losses,
      winRate,
      maxDrawdown,
      sharpeRatio,
      profitFactor: losses > 0 ? (wins * Math.abs(totalReturn)) / (losses * Math.abs(totalReturn)) : wins
    };
  }

  // 回测报告
  generateReport(addressId) {
    const result = this.backtestTrader(addressId);
    const trader = this.db.getAllAddresses().find(a => a.id === addressId);

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║              📊 回测报告                                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    console.log(`交易员: ${trader?.label || trader?.address || 'Unknown'}`);
    console.log(`回测期间: ${result.totalTrades} 笔交易\n`);

    console.log('💰 收益表现');
    console.log(`   初始资金: $${result.initialCapital.toFixed(2)}`);
    console.log(`   最终资金: $${result.finalCapital.toFixed(2)}`);
    console.log(`   总收益率: ${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(2)}%`);
    console.log(`   盈亏比: ${result.profitFactor.toFixed(2)}\n`);

    console.log('📈 交易统计');
    console.log(`   胜率: ${result.winRate.toFixed(1)}%`);
    console.log(`   最大回撤: ${result.maxDrawdown.toFixed(2)}%`);
    console.log(`   夏普比率: ${result.sharpeRatio.toFixed(2)}\n`);

    const recommendation = result.totalReturn > 50 && result.winRate > 60 
      ? '✅ 强烈推荐跟单'
      : result.totalReturn > 0 
        ? '⚠️  可以跟单，但需控制风险'
        : '❌ 不建议跟单';

    console.log(`💡 建议: ${recommendation}\n`);

    return result;
  }
}

module.exports = BacktestEngine;
