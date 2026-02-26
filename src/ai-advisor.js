class AIAdvisor {
  constructor(db, options = {}) {
    if (!db) {
      throw new Error('CopytradeDB instance is required');
    }

    this.db = db;
    this.options = {
      removalWinRate: options.removalWinRate ?? 0.4,
      increaseWinRate: options.increaseWinRate ?? 0.7,
      lossThreshold: options.lossThreshold ?? 0,
      profitThreshold: options.profitThreshold ?? 0,
      varianceThreshold: options.varianceThreshold ?? 0,
    };
  }

  _getWinRatesByAddressId() {
    const rows = this.db.db
      .prepare(
        `
        SELECT
          address_id,
          SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) AS win_count,
          COUNT(*) AS trade_count
        FROM trades
        GROUP BY address_id
        `.trim()
      )
      .all();

    const map = new Map();
    for (const row of rows) {
      const tradeCount = row.trade_count || 0;
      const winCount = row.win_count || 0;
      const winRate = tradeCount > 0 ? winCount / tradeCount : 0;
      map.set(row.address_id, {
        winRate,
        winCount,
        tradeCount,
      });
    }

    return map;
  }

  analyzeForRemoval() {
    const stats = this.db.getAllAddressStats();
    const winRates = this._getWinRatesByAddressId();
    const results = [];

    for (const row of stats) {
      const win = winRates.get(row.id) || { winRate: 0, tradeCount: 0, winCount: 0 };
      const reasons = [];

      if (win.winRate < this.options.removalWinRate) {
        reasons.push(`win rate ${(win.winRate * 100).toFixed(2)}% < ${(this.options.removalWinRate * 100).toFixed(0)}%`);
      }

      if (row.total_profit_loss < -this.options.lossThreshold) {
        reasons.push(`total loss ${row.total_profit_loss.toFixed(2)} < -${this.options.lossThreshold.toFixed(2)}`);
      }

      if (reasons.length > 0) {
        results.push({
          id: row.id,
          address: row.address,
          label: row.label,
          tradeCount: win.tradeCount,
          winRate: win.winRate,
          totalProfitLoss: row.total_profit_loss,
          reasons,
        });
      }
    }

    return results;
  }

  analyzeForIncrease() {
    const stats = this.db.getAllAddressStats();
    const winRates = this._getWinRatesByAddressId();
    const results = [];

    for (const row of stats) {
      const win = winRates.get(row.id) || { winRate: 0, tradeCount: 0, winCount: 0 };
      const reasons = [];

      if (win.winRate > this.options.increaseWinRate) {
        reasons.push(`win rate ${(win.winRate * 100).toFixed(2)}% > ${(this.options.increaseWinRate * 100).toFixed(0)}%`);
      }

      if (row.total_profit_loss > this.options.profitThreshold) {
        reasons.push(`profit ${row.total_profit_loss.toFixed(2)} > ${this.options.profitThreshold.toFixed(2)}`);
      }

      if (reasons.length === 2) {
        results.push({
          id: row.id,
          address: row.address,
          label: row.label,
          tradeCount: win.tradeCount,
          winRate: win.winRate,
          totalProfitLoss: row.total_profit_loss,
          reasons,
        });
      }
    }

    return results;
  }

  analyzePortfolioOptimization() {
    const stats = this.db.getAllAddressStats();
    const values = stats.map((row) => row.total_profit_loss || 0);
    const count = values.length;

    if (count === 0) {
      return {
        variance: 0,
        mean: 0,
        count: 0,
        recommendation: 'No portfolio data available yet.',
      };
    }

    const mean = values.reduce((sum, v) => sum + v, 0) / count;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;

    const recommendation =
      variance > this.options.varianceThreshold
        ? 'Portfolio variance is high; consider diversifying across more consistent traders.'
        : 'Portfolio variance is within the acceptable range.';

    return {
      variance,
      mean,
      count,
      recommendation,
    };
  }

  generateDailyReport() {
    const stats = this.db.getAllAddressStats();
    const removal = this.analyzeForRemoval();
    const increase = this.analyzeForIncrease();
    const portfolio = this.analyzePortfolioOptimization();

    let topPerformer = null;
    let worstPerformer = null;

    if (stats.length > 0) {
      const sorted = [...stats].sort((a, b) => b.total_profit_loss - a.total_profit_loss);
      const top = sorted[0];
      const worst = sorted[sorted.length - 1];
      topPerformer = {
        id: top.id,
        address: top.address,
        label: top.label,
        totalProfitLoss: top.total_profit_loss,
        tradeCount: top.trade_count,
      };
      worstPerformer = {
        id: worst.id,
        address: worst.address,
        label: worst.label,
        totalProfitLoss: worst.total_profit_loss,
        tradeCount: worst.trade_count,
      };
    }

    const date = new Date().toISOString().slice(0, 10);

    return {
      date,
      summary: {
        totalTracked: stats.length,
        totalRecommendations: removal.length + increase.length,
      },
      topPerformer,
      worstPerformer,
      recommendations: {
        remove: removal,
        increase,
        portfolio,
      },
    };
  }
}

module.exports = {
  AIAdvisor,
};
