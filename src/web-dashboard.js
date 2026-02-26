const express = require('express');
const path = require('path');
const { CopytradeDB } = require('./db');
const PolymarketData = require('./polymarket-data');

class WebDashboard {
  constructor(port = 3000) {
    this.app = express();
    this.port = port;
    this.db = new CopytradeDB();
    this.pmData = new PolymarketData();
    this.setupRoutes();
  }

  setupRoutes() {
    this.app.use(express.static(path.join(__dirname, '../public')));
    this.app.use(express.json());

    this.app.get('/api/traders', (req, res) => {
      const traders = this.db.getAllAddressStats();
      res.json(traders);
    });

    this.app.get('/api/traders/:id', (req, res) => {
      const id = parseInt(req.params.id);
      const trader = this.db.getAllAddressStats().find(t => t.id === id);
      if (!trader) return res.status(404).json({ error: 'Not found' });
      
      const trades = this.db.db.prepare(
        'SELECT * FROM trades WHERE address_id = ? ORDER BY timestamp DESC'
      ).all(id);
      
      res.json({ ...trader, trades });
    });

    this.app.get('/api/markets', async (req, res) => {
      const markets = await this.pmData.getTopMarketsByVolume(10);
      res.json(markets);
    });

    this.app.get('/api/stats', (req, res) => {
      const traders = this.db.getAllAddressStats();
      const totalTrades = traders.reduce((sum, t) => sum + (t.trade_count || 0), 0);
      const totalPnl = traders.reduce((sum, t) => sum + (t.total_profit_loss || 0), 0);
      
      res.json({
        traderCount: traders.length,
        totalTrades,
        totalPnl,
        lastUpdate: new Date().toISOString()
      });
    });

    this.app.get('/', (req, res) => {
      res.send(this.getHTML());
    });
  }

  getHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Polymarket CopyTrade Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #fff; padding: 20px; }
    .header { text-align: center; padding: 30px; background: linear-gradient(135deg, #00f5ff22, #b829dd22); border-radius: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 2.5em; background: linear-gradient(90deg, #00f5ff, #b829dd); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .stat-card { background: #16213e; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2em; font-weight: bold; color: #00f5ff; }
    .stat-value.positive { color: #00ff88; }
    .stat-value.negative { color: #ff4757; }
    .stat-label { color: #888; margin-top: 5px; }
    .section { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .section h2 { color: #00f5ff; margin-bottom: 15px; }
    .trader-list { display: grid; gap: 10px; }
    .trader-card { background: #1a1a2e; padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #00f5ff; }
    .trader-card.negative { border-left-color: #ff4757; }
    .trader-info h3 { color: #fff; margin-bottom: 5px; }
    .trader-info p { color: #888; font-size: 0.9em; }
    .trader-pnl { text-align: right; }
    .pnl-value { font-size: 1.5em; font-weight: bold; color: #00ff88; }
    .pnl-value.negative { color: #ff4757; }
    .loading { text-align: center; padding: 40px; color: #888; }
    .last-update { text-align: center; color: #666; font-size: 0.85em; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Polymarket CopyTrade Dashboard</h1>
    <p>实时追踪聪明钱交易员</p>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value" id="trader-count">-</div>
      <div class="stat-label">追踪交易员</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="total-trades">-</div>
      <div class="stat-label">总交易数</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" id="total-pnl">-</div>
      <div class="stat-label">总盈亏</div>
    </div>
  </div>

  <div class="section">
    <h2>👥 追踪交易员</h2>
    <div class="trader-list" id="trader-list"><div class="loading">加载中...</div></div>
  </div>

  <div class="section">
    <h2>📈 热门市场</h2>
    <div id="markets-list"><div class="loading">加载中...</div></div>
  </div>

  <div class="last-update" id="last-update"></div>

  <script>
    async function loadData() {
      try {
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        document.getElementById('trader-count').textContent = stats.traderCount;
        document.getElementById('total-trades').textContent = stats.totalTrades.toLocaleString();
        const pnlEl = document.getElementById('total-pnl');
        pnlEl.textContent = (stats.totalPnl >= 0 ? '+' : '') + '$' + Math.round(stats.totalPnl).toLocaleString();
        pnlEl.className = 'stat-value ' + (stats.totalPnl >= 0 ? 'positive' : 'negative');
        document.getElementById('last-update').textContent = '最后更新: ' + new Date(stats.lastUpdate).toLocaleString();

        const tradersRes = await fetch('/api/traders');
        const traders = await tradersRes.json();
        const traderList = document.getElementById('trader-list');
        traderList.innerHTML = traders.map(t => {
          const pnl = t.total_profit_loss || 0;
          const cardClass = pnl < 0 ? 'trader-card negative' : 'trader-card';
          const pnlClass = pnl >= 0 ? 'pnl-value' : 'pnl-value negative';
          const pnlStr = (pnl >= 0 ? '+' : '') + '$' + Math.round(pnl).toLocaleString();
          return '<div class="' + cardClass + '"' + '><div class="trader-info"><h3>' + 
            (t.label || t.address.slice(0, 20) + '...') + '</h3><p>' + 
            t.address.slice(0, 30) + '... | ' + (t.trade_count || 0) + ' 笔交易</p></div>' +
            '<div class="trader-pnl"><div class="' + pnlClass + '">' + pnlStr + '</div></div></div>';
        }).join('');

        const marketsRes = await fetch('/api/markets');
        const markets = await marketsRes.json();
        const marketsList = document.getElementById('markets-list');
        marketsList.innerHTML = markets.slice(0, 5).map(m => {
          const vol = (parseFloat(m.volume || 0) / 1000000).toFixed(2);
          return '<div class="trader-card"><div class="trader-info"><h3>' + 
            (m.question?.substring(0, 50) || 'Unknown') + '...</h3><p>交易量: $' + vol + 'M</p></div></div>';
        }).join('');
      } catch (err) {
        console.error('加载失败:', err);
      }
    }
    loadData();
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;
  }

  start() {
    this.app.listen(this.port, () => {
      console.log('🌐 Web Dashboard running at http://localhost:' + this.port);
    });
  }
}

module.exports = WebDashboard;
