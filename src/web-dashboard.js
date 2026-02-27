/**
 * CopyTrade Dashboard v5.0 - Enhanced Web Dashboard
 * Features: Real-time data, AI scoring, alerts, exports
 */

const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { CopytradeDB } = require('./db');
const PolymarketDataService = require('./polymarket-data-service');
const AlertSystem = require('./alert-system');
const TraderScoring = require('./trader-scoring');

class WebDashboard {
  constructor(port = 3000) {
    this.app = express();
    this.port = port;
    this.db = new CopytradeDB();
    this.dataService = new PolymarketDataService();
    this.alertSystem = new AlertSystem(this.db);
    this.scoring = new TraderScoring(this.db);
    
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.clients = new Set();
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.startPeriodicUpdates();
    
    // Alert listener for real-time notifications
    this.alertSystem.onAlert((alerts) => {
      this.broadcastAlerts(alerts);
    });
  }

  setupMiddleware() {
    this.app.use(express.static(path.join(__dirname, '../public')));
    this.app.use(express.json());
    
    // CORS headers
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      next();
    });
  }

  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '5.0'
      });
    });

    // ============ Traders API ============
    
    // Get all traders with stats and scores
    this.app.get('/api/traders', (req, res) => {
      try {
        let traders = this.db.getAllAddressStats();
        
        // Add AI scores
        traders = this.scoring.batchScoreTraders(traders);
        
        // Sort by score if requested
        const sortBy = req.query.sort || 'score';
        if (sortBy === 'score') {
          traders.sort((a, b) => b.score.overall - a.score.overall);
        }
        
        res.json(traders);
      } catch (error) {
        console.error('Error fetching traders:', error);
        res.status(500).json({ error: 'Failed to fetch traders' });
      }
    });

    // Get trader recommendations
    this.app.get('/api/traders/recommendations', (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 5;
        const recommendations = this.scoring.getTopRecommendations(limit);
        res.json(recommendations);
      } catch (error) {
        console.error('Error fetching recommendations:', error);
        res.status(500).json({ error: 'Failed to fetch recommendations' });
      }
    });

    // Get single trader with details
    this.app.get('/api/traders/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const trader = this.db.getAllAddressStats().find(t => t.id === id);
        
        if (!trader) {
          return res.status(404).json({ error: 'Trader not found' });
        }
        
        // Get trades
        const trades = this.db.db.prepare(
          'SELECT * FROM trades WHERE address_id = ? ORDER BY timestamp DESC'
        ).all(id);
        
        // Calculate score
        const score = this.scoring.calculateScore(trader);
        
        // Get PnL history
        const pnlHistory = this._getPnlHistory(id, 90);
        
        // Get related markets
        const markets = await this._getTraderMarkets(id);
        
        res.json({ 
          ...trader, 
          trades, 
          score,
          pnlHistory,
          markets
        });
      } catch (error) {
        console.error('Error fetching trader:', error);
        res.status(500).json({ error: 'Failed to fetch trader' });
      }
    });

    // Get trader PnL history
    this.app.get('/api/traders/:id/pnl-history', (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const days = parseInt(req.query.days) || 30;
        const history = this._getPnlHistory(id, days);
        res.json(history);
      } catch (error) {
        console.error('Error fetching PnL history:', error);
        res.status(500).json({ error: 'Failed to fetch PnL history' });
      }
    });

    // ============ Trades API ============
    
    this.app.get('/api/trades/recent', (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        
        const trades = this.db.db.prepare(`
          SELECT t.*, a.label as trader_label, a.address as trader_address
          FROM trades t
          JOIN tracked_addresses a ON t.address_id = a.id
          ORDER BY t.timestamp DESC
          LIMIT ? OFFSET ?
        `).all(limit, offset);
        
        res.json(trades);
      } catch (error) {
        console.error('Error fetching recent trades:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
      }
    });

    // ============ Stats API ============
    
    this.app.get('/api/stats', (req, res) => {
      try {
        const traders = this.db.getAllAddressStats();
        const totalTrades = traders.reduce((sum, t) => sum + (t.trade_count || 0), 0);
        const totalPnl = traders.reduce((sum, t) => sum + (t.total_profit_loss || 0), 0);
        const totalWins = traders.reduce((sum, t) => sum + (t.wins || 0), 0);
        const totalLosses = traders.reduce((sum, t) => sum + (t.losses || 0), 0);
        
        // Calculate additional stats
        const profitableTraders = traders.filter(t => (t.total_profit_loss || 0) > 0).length;
        const avgWinRate = traders.length > 0 
          ? traders.reduce((sum, t) => sum + (t.win_rate || 0), 0) / traders.length 
          : 0;
        
        res.json({
          traderCount: traders.length,
          totalTrades,
          totalPnl,
          totalWins,
          totalLosses,
          profitableTraders,
          avgWinRate: avgWinRate.toFixed(2),
          overallWinRate: totalWins + totalLosses > 0 
            ? (totalWins / (totalWins + totalLosses) * 100).toFixed(2) 
            : 0,
          lastUpdate: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
      }
    });

    // ============ Markets API ============
    
    this.app.get('/api/markets', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const markets = await this.dataService.getTopMarketsByVolume(limit);
        res.json(markets);
      } catch (error) {
        console.error('Error fetching markets:', error);
        res.status(500).json({ error: 'Failed to fetch markets' });
      }
    });

    this.app.get('/api/markets/:id', async (req, res) => {
      try {
        const market = await this.dataService.getMarketById(req.params.id);
        if (!market) {
          return res.status(404).json({ error: 'Market not found' });
        }
        res.json(market);
      } catch (error) {
        console.error('Error fetching market:', error);
        res.status(500).json({ error: 'Failed to fetch market' });
      }
    });

    // ============ Alerts API ============
    
    this.app.get('/api/alerts', (req, res) => {
      try {
        const active = req.query.active === 'true';
        const alerts = active 
          ? this.alertSystem.getActiveAlerts()
          : this.alertSystem.getAlertHistory(parseInt(req.query.limit) || 50);
        res.json(alerts);
      } catch (error) {
        console.error('Error fetching alerts:', error);
        res.status(500).json({ error: 'Failed to fetch alerts' });
      }
    });

    this.app.get('/api/alerts/stats', (req, res) => {
      try {
        res.json(this.alertSystem.getStats());
      } catch (error) {
        console.error('Error fetching alert stats:', error);
        res.status(500).json({ error: 'Failed to fetch alert stats' });
      }
    });

    this.app.post('/api/alerts/:id/acknowledge', (req, res) => {
      try {
        const success = this.alertSystem.acknowledgeAlert(req.params.id);
        res.json({ success });
      } catch (error) {
        console.error('Error acknowledging alert:', error);
        res.status(500).json({ error: 'Failed to acknowledge alert' });
      }
    });

    this.app.get('/api/alerts/thresholds', (req, res) => {
      res.json(this.alertSystem.getThresholds());
    });

    this.app.post('/api/alerts/thresholds', (req, res) => {
      try {
        const { type, config } = req.body;
        const success = this.alertSystem.setThreshold(type, config);
        res.json({ success });
      } catch (error) {
        console.error('Error setting threshold:', error);
        res.status(500).json({ error: 'Failed to set threshold' });
      }
    });

    // ============ Export API ============
    
    // CSV Export
    this.app.get('/api/export/traders', (req, res) => {
      try {
        const traders = this.db.getAllAddressStats();
        const scored = this.scoring.batchScoreTraders(traders);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=traders_${new Date().toISOString().split('T')[0]}.csv`);
        
        const headers = ['ID', 'Label', 'Address', 'Total PnL', 'Win Rate', 'Wins', 'Losses', 'Trade Count', 'Avg PnL', 'AI Score', 'Risk Level'];
        const rows = scored.map(t => [
          t.id,
          t.label || '',
          t.address,
          t.total_profit_loss || 0,
          t.win_rate?.toFixed(2) || 0,
          t.wins || 0,
          t.losses || 0,
          t.trade_count || 0,
          t.avg_profit_loss?.toFixed(2) || 0,
          t.score?.overall || 0,
          t.score?.riskLevel?.label || '未知'
        ]);
        
        res.send([headers.join(','), ...rows.map(r => r.join(','))].join('\n'));
      } catch (error) {
        console.error('Error exporting traders:', error);
        res.status(500).json({ error: 'Failed to export traders' });
      }
    });

    // Excel Export (JSON format for frontend processing)
    this.app.get('/api/export/excel', (req, res) => {
      try {
        const traders = this.db.getAllAddressStats();
        const scored = this.scoring.batchScoreTraders(traders);
        const alerts = this.alertSystem.getAlertHistory(100);
        
        // Get recent trades
        const trades = this.db.db.prepare(`
          SELECT t.*, a.label as trader_label
          FROM trades t
          JOIN tracked_addresses a ON t.address_id = a.id
          ORDER BY t.timestamp DESC
          LIMIT 1000
        `).all();
        
        res.json({
          sheets: {
            traders: scored.map(t => ({
              ID: t.id,
              标签: t.label || '',
              地址: t.address,
              总盈亏: t.total_profit_loss || 0,
              胜率: t.win_rate?.toFixed(2) || 0,
              盈利次数: t.wins || 0,
              亏损次数: t.losses || 0,
              交易总数: t.trade_count || 0,
              平均盈亏: t.avg_profit_loss?.toFixed(2) || 0,
              AI评分: t.score?.overall || 0,
              风险等级: t.score?.riskLevel?.label || '未知',
              推荐操作: t.score?.recommendation?.text || ''
            })),
            trades: trades.map(t => ({
              时间: new Date(t.timestamp * 1000).toISOString(),
              交易员: t.trader_label || '',
              市场: t.asset || '',
              方向: t.side || '',
              金额: t.amount_in || t.amount_out || 0,
              盈亏: t.profit_loss || 0,
              交易哈希: t.tx_hash || ''
            })),
            alerts: alerts.map(a => ({
              时间: new Date(a.timestamp * 1000).toISOString(),
              类型: a.type,
              标题: a.title,
              描述: a.description,
              已确认: a.acknowledged ? '是' : '否'
            }))
          },
          generatedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error generating Excel data:', error);
        res.status(500).json({ error: 'Failed to generate Excel data' });
      }
    });

    // ============ Cache API ============
    
    this.app.get('/api/cache/stats', (req, res) => {
      res.json(this.dataService.getCacheStats());
    });

    this.app.post('/api/cache/clear', (req, res) => {
      const { pattern } = req.body || {};
      this.dataService.clearCache(pattern);
      res.json({ success: true });
    });

    // Serve main HTML
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });

    // Catch-all for SPA routing
    this.app.get(/.*/, (req, res) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket client connected');
      this.clients.add(ws);
      
      // Send initial data
      ws.send(JSON.stringify({ 
        type: 'connected', 
        timestamp: Date.now(),
        message: 'Connected to CopyTrade Dashboard v5.0'
      }));
      
      // Handle client messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleClientMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
        }
      });
      
      ws.on('close', () => {
        console.log('WebSocket client disconnected');
        this.clients.delete(ws);
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });
    });
  }

  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'subscribe_trader':
        // Subscribe to real-time updates for a trader
        const address = message.address;
        if (address) {
          this.dataService.subscribeToTrader(address, (trades) => {
            ws.send(JSON.stringify({
              type: 'trader_update',
              address,
              trades: trades.slice(0, 10)
            }));
          });
        }
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
    }
  }

  startPeriodicUpdates() {
    // Broadcast updates every 30 seconds
    setInterval(() => {
      this.broadcastUpdate();
    }, 30000);
    
    // Generate alerts every minute
    setInterval(() => {
      this.checkAlerts();
    }, 60000);
  }

  broadcastUpdate() {
    if (this.clients.size === 0) return;
    
    const message = JSON.stringify({
      type: 'update',
      timestamp: Date.now(),
      data: {
        stats: this._getQuickStats(),
        recentTrades: this._getRecentTrades(5)
      }
    });
    
    this.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }

  broadcastAlerts(alerts) {
    if (this.clients.size === 0 || alerts.length === 0) return;
    
    const message = JSON.stringify({
      type: 'alerts',
      timestamp: Date.now(),
      alerts
    });
    
    this.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }

  broadcastNewTrade(trade) {
    const message = JSON.stringify({
      type: 'new_trade',
      timestamp: Date.now(),
      trade
    });
    
    this.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }

  checkAlerts() {
    const traders = this.db.getAllAddressStats();
    this.alertSystem.generateAlerts(traders);
  }

  _getQuickStats() {
    const traders = this.db.getAllAddressStats();
    return {
      traderCount: traders.length,
      totalTrades: traders.reduce((sum, t) => sum + (t.trade_count || 0), 0),
      totalPnl: traders.reduce((sum, t) => sum + (t.total_profit_loss || 0), 0)
    };
  }

  _getRecentTrades(limit = 5) {
    return this.db.db.prepare(`
      SELECT t.*, a.label as trader_label
      FROM trades t
      JOIN tracked_addresses a ON t.address_id = a.id
      ORDER BY t.timestamp DESC
      LIMIT ?
    `).all(limit);
  }

  _getPnlHistory(traderId, days) {
    const trades = this.db.db.prepare(`
      SELECT timestamp, profit_loss
      FROM trades
      WHERE address_id = ?
      ORDER BY timestamp ASC
    `).all(traderId);
    
    const history = [];
    let cumulative = 0;
    const now = Date.now() / 1000;
    const cutoff = now - days * 86400;
    
    trades.forEach(trade => {
      if (trade.timestamp >= cutoff) {
        cumulative += trade.profit_loss || 0;
        history.push({
          timestamp: trade.timestamp,
          date: new Date(trade.timestamp * 1000).toISOString().split('T')[0],
          pnl: cumulative
        });
      }
    });
    
    return history;
  }

  async _getTraderMarkets(traderId) {
    try {
      const trades = this.db.db.prepare(`
        SELECT DISTINCT asset
        FROM trades
        WHERE address_id = ? AND asset IS NOT NULL
        LIMIT 10
      `).all(traderId);
      
      return trades.map(t => t.asset).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  start() {
    this.server.listen(this.port, () => {
      console.log(`🌐 CopyTrade Dashboard v5.0 running at http://localhost:${this.port}`);
      console.log(`📊 API endpoints available at http://localhost:${this.port}/api`);
      console.log(`🔌 WebSocket server ready at ws://localhost:${this.port}/ws`);
    });
  }

  stop() {
    this.wss.close();
    this.server.close();
    this.db.close();
  }
}

module.exports = WebDashboard;
