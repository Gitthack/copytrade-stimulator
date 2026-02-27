/**
 * AI Trader Scoring Algorithm
 * Calculates comprehensive trader ratings based on multiple metrics
 */

class TraderScoring {
  constructor(db) {
    this.db = db;
  }

  /**
   * Calculate comprehensive trader score
   * Returns score 0-100 with detailed breakdown
   */
  calculateScore(trader) {
    const metrics = {
      winRate: this.calculateWinRateScore(trader.win_rate),
      profitFactor: this.calculateProfitFactorScore(trader.id),
      sharpeRatio: this.calculateSharpeRatio(trader.id),
      consistency: this.calculateConsistencyScore(trader.id),
      riskManagement: this.calculateRiskScore(trader.id),
      activity: this.calculateActivityScore(trader.trade_count)
    };

    // Weighted average
    const weights = {
      winRate: 0.25,
      profitFactor: 0.25,
      sharpeRatio: 0.20,
      consistency: 0.15,
      riskManagement: 0.10,
      activity: 0.05
    };

    const totalScore = Object.entries(metrics).reduce((sum, [key, value]) => {
      return sum + (value.score * weights[key]);
    }, 0);

    return {
      overall: Math.round(totalScore),
      riskLevel: this.determineRiskLevel(metrics),
      recommendation: this.generateRecommendation(totalScore, metrics),
      metrics,
      rank: this.calculateRank(totalScore)
    };
  }

  /**
   * Win rate score (0-100)
   */
  calculateWinRateScore(winRate) {
    const score = Math.min(100, Math.max(0, winRate));
    return {
      score,
      value: winRate,
      grade: this.getGrade(score),
      description: `胜率 ${winRate.toFixed(1)}%`
    };
  }

  /**
   * Profit factor score (gross profit / gross loss)
   */
  calculateProfitFactorScore(traderId) {
    try {
      const result = this.db.db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN profit_loss > 0 THEN profit_loss ELSE 0 END), 0) as gross_profit,
          COALESCE(SUM(CASE WHEN profit_loss < 0 THEN ABS(profit_loss) ELSE 0 END), 0) as gross_loss
        FROM trades
        WHERE address_id = ?
      `).get(traderId);

      const profitFactor = result.gross_loss > 0 
        ? result.gross_profit / result.gross_loss 
        : result.gross_profit > 0 ? 10 : 0;

      // Score: PF > 2.0 = 100, PF = 1.0 = 50, PF < 1.0 < 50
      const score = Math.min(100, Math.max(0, 50 + (profitFactor - 1) * 50));

      return {
        score,
        value: profitFactor,
        grade: this.getGrade(score),
        description: `盈亏比 ${profitFactor.toFixed(2)}`
      };
    } catch (error) {
      return { score: 0, value: 0, grade: 'F', description: '无数据' };
    }
  }

  /**
   * Sharpe ratio (risk-adjusted return)
   */
  calculateSharpeRatio(traderId) {
    try {
      const trades = this.db.db.prepare(`
        SELECT profit_loss, timestamp
        FROM trades
        WHERE address_id = ? AND profit_loss IS NOT NULL
        ORDER BY timestamp ASC
      `).all(traderId);

      if (trades.length < 10) {
        return { score: 50, value: 0, grade: 'N/A', description: '交易数不足' };
      }

      // Calculate daily returns
      const dailyReturns = this.aggregateDailyReturns(trades);
      
      if (dailyReturns.length < 5) {
        return { score: 50, value: 0, grade: 'N/A', description: '数据不足' };
      }

      const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
      const stdDev = Math.sqrt(variance);

      const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(365) : 0;
      
      // Score: Sharpe > 2.0 = 100, Sharpe = 1.0 = 75, Sharpe = 0 = 25
      const score = Math.min(100, Math.max(0, 25 + sharpe * 37.5));

      return {
        score,
        value: sharpe,
        grade: this.getGrade(score),
        description: `夏普比率 ${sharpe.toFixed(2)}`
      };
    } catch (error) {
      return { score: 50, value: 0, grade: 'N/A', description: '计算错误' };
    }
  }

  /**
   * Consistency score (low volatility in returns)
   */
  calculateConsistencyScore(traderId) {
    try {
      const trades = this.db.db.prepare(`
        SELECT profit_loss
        FROM trades
        WHERE address_id = ? AND profit_loss IS NOT NULL
        ORDER BY timestamp ASC
      `).all(traderId);

      if (trades.length < 10) {
        return { score: 50, value: 0, grade: 'N/A', description: '交易数不足' };
      }

      // Calculate consecutive win/loss streaks
      let currentStreak = 0;
      let maxWinStreak = 0;
      let maxLossStreak = 0;

      trades.forEach(trade => {
        if (trade.profit_loss > 0) {
          if (currentStreak > 0) {
            currentStreak++;
          } else {
            currentStreak = 1;
          }
          maxWinStreak = Math.max(maxWinStreak, currentStreak);
        } else {
          if (currentStreak < 0) {
            currentStreak--;
          } else {
            currentStreak = -1;
          }
          maxLossStreak = Math.max(maxLossStreak, Math.abs(currentStreak));
        }
      });

      // Score based on win streak vs loss streak ratio
      const ratio = maxLossStreak > 0 ? maxWinStreak / maxLossStreak : maxWinStreak;
      const score = Math.min(100, 50 + ratio * 25);

      return {
        score,
        value: { maxWinStreak, maxLossStreak },
        grade: this.getGrade(score),
        description: `最长连赢 ${maxWinStreak} 次 / 连亏 ${maxLossStreak} 次`
      };
    } catch (error) {
      return { score: 50, value: 0, grade: 'N/A', description: '计算错误' };
    }
  }

  /**
   * Risk management score (drawdown control)
   */
  calculateRiskScore(traderId) {
    try {
      const trades = this.db.db.prepare(`
        SELECT profit_loss
        FROM trades
        WHERE address_id = ? AND profit_loss IS NOT NULL
        ORDER BY timestamp ASC
      `).all(traderId);

      if (trades.length < 5) {
        return { score: 50, value: 0, grade: 'N/A', description: '交易数不足' };
      }

      // Calculate max drawdown
      let peak = 0;
      let maxDrawdown = 0;
      let runningPnl = 0;

      trades.forEach(trade => {
        runningPnl += trade.profit_loss;
        if (runningPnl > peak) {
          peak = runningPnl;
        }
        const drawdown = peak - runningPnl;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      });

      // Score: Lower drawdown = higher score
      // Max acceptable drawdown = $5000
      const score = Math.max(0, 100 - (maxDrawdown / 50));

      return {
        score,
        value: maxDrawdown,
        grade: this.getGrade(score),
        description: `最大回撤 $${maxDrawdown.toFixed(2)}`
      };
    } catch (error) {
      return { score: 50, value: 0, grade: 'N/A', description: '计算错误' };
    }
  }

  /**
   * Activity score (trade frequency)
   */
  calculateActivityScore(tradeCount) {
    // Optimal: 50-200 trades
    let score;
    if (tradeCount < 10) {
      score = 30;
    } else if (tradeCount < 30) {
      score = 50 + (tradeCount - 10) * 1.5;
    } else if (tradeCount < 100) {
      score = 80 + (tradeCount - 30) * 0.28;
    } else if (tradeCount < 500) {
      score = 100;
    } else {
      score = 90; // Too many trades might indicate overtrading
    }

    return {
      score: Math.min(100, score),
      value: tradeCount,
      grade: this.getGrade(score),
      description: `${tradeCount} 笔交易`
    };
  }

  /**
   * Aggregate trades into daily returns
   */
  aggregateDailyReturns(trades) {
    const dailyMap = new Map();
    
    trades.forEach(trade => {
      const day = Math.floor(trade.timestamp / 86400);
      const current = dailyMap.get(day) || 0;
      dailyMap.set(day, current + trade.profit_loss);
    });

    return Array.from(dailyMap.values());
  }

  /**
   * Determine risk level based on metrics
   */
  determineRiskLevel(metrics) {
    const { sharpeRatio, riskManagement, consistency } = metrics;
    
    const riskScore = (sharpeRatio.score * 0.4) + 
                      (riskManagement.score * 0.4) + 
                      (consistency.score * 0.2);

    if (riskScore >= 80) return { level: 'low', label: '低风险', color: '#00ff88' };
    if (riskScore >= 60) return { level: 'medium', label: '中风险', color: '#ffa502' };
    return { level: 'high', label: '高风险', color: '#ff4757' };
  }

  /**
   * Generate recommendation text
   */
  generateRecommendation(overallScore, metrics) {
    if (overallScore >= 85) {
      return {
        action: 'strong_buy',
        text: '强烈推荐跟单',
        reason: '各项指标优秀，风险收益比极佳'
      };
    } else if (overallScore >= 70) {
      return {
        action: 'buy',
        text: '推荐跟单',
        reason: '整体表现良好，值得跟随'
      };
    } else if (overallScore >= 50) {
      return {
        action: 'watch',
        text: '观望',
        reason: '表现一般，建议持续观察'
      };
    } else {
      return {
        action: 'avoid',
        text: '不建议跟单',
        reason: '风险较高或表现不佳'
      };
    }
  }

  /**
   * Calculate rank percentile
   */
  calculateRank(score) {
    if (score >= 90) return { percentile: 95, stars: 5 };
    if (score >= 80) return { percentile: 85, stars: 4 };
    if (score >= 70) return { percentile: 70, stars: 3 };
    if (score >= 60) return { percentile: 50, stars: 2 };
    return { percentile: 30, stars: 1 };
  }

  /**
   * Get letter grade
   */
  getGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Get top recommended traders
   */
  getTopRecommendations(limit = 5) {
    const traders = this.db.getAllAddressStats();
    
    const scored = traders.map(trader => ({
      ...trader,
      score: this.calculateScore(trader)
    }));

    return scored
      .filter(t => t.score.overall >= 60 && t.score.riskLevel.level !== 'high')
      .sort((a, b) => b.score.overall - a.score.overall)
      .slice(0, limit);
  }

  /**
   * Batch score calculation
   */
  batchScoreTraders(traders) {
    return traders.map(trader => ({
      ...trader,
      score: this.calculateScore(trader)
    }));
  }
}

module.exports = TraderScoring;
