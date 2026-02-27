/**
 * Alert System with Custom Thresholds
 * Enhanced alerting with history and visual notifications
 */

class AlertSystem {
  constructor(db) {
    this.db = db;
    this.thresholds = {
      winRateDrop: {
        enabled: true,
        value: 10,        // Win rate drop percentage
        minTrades: 10     // Minimum trades to trigger
      },
      singleLoss: {
        enabled: true,
        value: 1000       // Single trade loss threshold ($)
      },
      cumulativeLoss: {
        enabled: true,
        value: 5000       // Cumulative loss threshold ($)
      },
      drawdown: {
        enabled: true,
        value: 20          // Max drawdown percentage
      }
    };
    this.alertHistory = [];
    this.maxHistorySize = 1000;
    this.listeners = [];
    
    // Load thresholds from DB if available
    this.loadThresholds();
  }

  loadThresholds() {
    try {
      const saved = this.db.db.prepare('SELECT value FROM config WHERE key = ?').get('alert_thresholds');
      if (saved) {
        this.thresholds = { ...this.thresholds, ...JSON.parse(saved.value) };
      }
    } catch (e) {
      // Config table might not exist
    }
  }

  saveThresholds() {
    try {
      this.db.db.prepare(
        'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'
      ).run('alert_thresholds', JSON.stringify(this.thresholds));
    } catch (e) {
      console.error('Failed to save thresholds:', e.message);
    }
  }

  // Update threshold configuration
  setThreshold(type, config) {
    if (this.thresholds[type]) {
      this.thresholds[type] = { ...this.thresholds[type], ...config };
      this.saveThresholds();
      return true;
    }
    return false;
  }

  getThresholds() {
    return { ...this.thresholds };
  }

  // Generate alerts based on trader stats
  generateAlerts(traders) {
    const alerts = [];
    const now = Date.now() / 1000;

    traders.forEach(trader => {
      // Win rate drop alert
      if (this.thresholds.winRateDrop.enabled && trader.trade_count >= this.thresholds.winRateDrop.minTrades) {
        const historicalWinRate = this.getHistoricalWinRate(trader.id);
        if (historicalWinRate && trader.win_rate < historicalWinRate - this.thresholds.winRateDrop.value) {
          alerts.push(this.createAlert({
            type: 'warning',
            icon: '⚠️',
            title: '胜率骤降',
            description: `${trader.label || '交易员'} 胜率从 ${historicalWinRate.toFixed(1)}% 降至 ${trader.win_rate.toFixed(1)}%`,
            traderId: trader.id,
            metric: 'winRate',
            value: trader.win_rate,
            threshold: historicalWinRate - this.thresholds.winRateDrop.value
          }));
        }
      }

      // Cumulative loss alert
      if (this.thresholds.cumulativeLoss.enabled && trader.total_profit_loss < -this.thresholds.cumulativeLoss.value) {
        alerts.push(this.createAlert({
          type: 'danger',
          icon: '🔴',
          title: '累计亏损超限',
          description: `${trader.label || '交易员'} 累计亏损 $${Math.abs(trader.total_profit_loss).toFixed(2)}`,
          traderId: trader.id,
          metric: 'cumulativeLoss',
          value: trader.total_profit_loss,
          threshold: -this.thresholds.cumulativeLoss.value
        }));
      }

      // Low win rate alert
      if (this.thresholds.winRateDrop.enabled && trader.win_rate < 30 && trader.trade_count >= 20) {
        alerts.push(this.createAlert({
          type: 'warning',
          icon: '📉',
          title: '胜率过低',
          description: `${trader.label || '交易员'} 胜率仅 ${trader.win_rate.toFixed(1)}%`,
          traderId: trader.id,
          metric: 'lowWinRate',
          value: trader.win_rate,
          threshold: 30
        }));
      }

      // High performer alert (positive)
      if (trader.total_profit_loss > 10000 && trader.win_rate > 60) {
        alerts.push(this.createAlert({
          type: 'success',
          icon: '🚀',
          title: '优秀表现',
          description: `${trader.label || '交易员'} 累计盈利 $${trader.total_profit_loss.toFixed(2)}，胜率 ${trader.win_rate.toFixed(1)}%`,
          traderId: trader.id,
          metric: 'highPerformer',
          value: trader.total_profit_loss
        }));
      }
    });

    // Check for single large losses in recent trades
    this.checkRecentTrades(alerts);

    // Deduplicate and store
    const newAlerts = this.deduplicateAlerts(alerts);
    this.addToHistory(newAlerts);

    // Notify listeners
    if (newAlerts.length > 0) {
      this.notifyListeners(newAlerts);
    }

    return newAlerts;
  }

  checkRecentTrades(alerts) {
    try {
      const recentTrades = this.db.db.prepare(`
        SELECT t.*, a.label as trader_label, a.id as trader_id
        FROM trades t
        JOIN tracked_addresses a ON t.address_id = a.id
        WHERE t.timestamp > ? AND t.profit_loss < ?
        ORDER BY t.timestamp DESC
        LIMIT 50
      `).all(Date.now() / 1000 - 3600, -this.thresholds.singleLoss.value);

      recentTrades.forEach(trade => {
        alerts.push(this.createAlert({
          type: 'danger',
          icon: '💸',
          title: '大额亏损交易',
          description: `${trade.trader_label || '交易员'} 单笔亏损 $${Math.abs(trade.profit_loss).toFixed(2)}`,
          traderId: trade.trader_id,
          tradeId: trade.id,
          metric: 'singleLoss',
          value: trade.profit_loss,
          threshold: -this.thresholds.singleLoss.value
        }));
      });
    } catch (error) {
      console.error('Error checking recent trades:', error);
    }
  }

  createAlert(data) {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now() / 1000,
      acknowledged: false,
      ...data
    };
  }

  deduplicateAlerts(newAlerts) {
    const recentAlerts = this.alertHistory.slice(-50);
    return newAlerts.filter(newAlert => {
      // Don't add if similar alert exists in last hour
      return !recentAlerts.some(old => 
        old.traderId === newAlert.traderId &&
        old.type === newAlert.type &&
        old.metric === newAlert.metric &&
        old.timestamp > newAlert.timestamp - 3600
      );
    });
  }

  addToHistory(alerts) {
    this.alertHistory.push(...alerts);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }
  }

  getHistoricalWinRate(traderId) {
    // Get win rate from 7 days ago for comparison
    try {
      const result = this.db.db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN profit_loss < 0 THEN 1 ELSE 0 END), 0) as losses
        FROM trades
        WHERE address_id = ? AND timestamp < ?
      `).get(traderId, Date.now() / 1000 - 7 * 86400);

      const total = result.wins + result.losses;
      return total > 0 ? (result.wins / total) * 100 : null;
    } catch (error) {
      return null;
    }
  }

  // Get active (unacknowledged) alerts
  getActiveAlerts() {
    return this.alertHistory.filter(a => !a.acknowledged).slice(-50);
  }

  // Get all alert history
  getAlertHistory(limit = 100) {
    return this.alertHistory.slice(-limit);
  }

  // Acknowledge alert
  acknowledgeAlert(alertId) {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  // Clear all alerts
  clearAlerts() {
    this.alertHistory = [];
  }

  // Subscribe to new alerts
  onAlert(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx > -1) this.listeners.splice(idx, 1);
    };
  }

  notifyListeners(alerts) {
    this.listeners.forEach(cb => {
      try {
        cb(alerts);
      } catch (e) {
        console.error('Alert listener error:', e);
      }
    });
  }

  // Get alert statistics
  getStats() {
    const active = this.getActiveAlerts();
    return {
      total: this.alertHistory.length,
      active: active.length,
      byType: {
        danger: active.filter(a => a.type === 'danger').length,
        warning: active.filter(a => a.type === 'warning').length,
        success: active.filter(a => a.type === 'success').length
      }
    };
  }
}

module.exports = AlertSystem;
