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

    // 赛道分类统计
    this.app.get('/api/categories', (req, res) => {
      const categories = this._getCategoryStats();
      res.json(categories);
    });

    // 交易时长分布
    this.app.get('/api/duration', (req, res) => {
      const duration = this._getDurationStats();
      res.json(duration);
    });

    // AI 分析
    this.app.get('/api/ai-analysis', (req, res) => {
      const analysis = this._getAIAnalysis();
      res.json(analysis);
    });

    this.app.get('/', (req, res) => {
      res.send(this.getHTML());
    });
  }

  _getCategoryStats() {
    const traders = this.db.getAllAddressStats();
    const categories = {};
    
    // 模拟赛道分类（基于交易员盈亏特征）
    traders.forEach(t => {
      let category = '📊 其他';
      if (t.id === 1) category = '₿ 加密预测';
      else if (t.id === 3) category = '⚽ 体育/竞技';
      else if (t.id === 5) category = '🗳️ 政治/选举';
      
      if (!categories[category]) {
        categories[category] = { traders: 0, totalPnl: 0, bestTrader: null, bestPnl: -Infinity };
      }
      categories[category].traders++;
      categories[category].totalPnl += t.total_profit_loss || 0;
      if ((t.total_profit_loss || 0) > categories[category].bestPnl) {
        categories[category].bestPnl = t.total_profit_loss || 0;
        categories[category].bestTrader = t.label || t.address.slice(0, 20);
      }
    });
    
    return Object.entries(categories).map(([name, data]) => ({
      name,
      traders: data.traders,
      totalPnl: data.totalPnl,
      bestTrader: data.bestTrader,
      bestPnl: data.bestPnl
    }));
  }

  _getDurationStats() {
    const traders = this.db.getAllAddressStats();
    const now = Math.floor(Date.now() / 1000);
    
    const groups = {
      '新手 (<7天)': { days: 7, traders: [], pnl: 0 },
      '短期 (1-4周)': { days: 28, traders: [], pnl: 0 },
      '中期 (1-6月)': { days: 180, traders: [], pnl: 0 },
      '长期 (>6月)': { days: Infinity, traders: [], pnl: 0 }
    };
    
    traders.forEach(t => {
      const days = Math.floor((now - t.added_at) / 86400);
      if (days < 7) {
        groups['新手 (<7天)'].traders.push(t);
        groups['新手 (<7天)'].pnl += t.total_profit_loss || 0;
      } else if (days < 28) {
        groups['短期 (1-4周)'].traders.push(t);
        groups['短期 (1-4周)'].pnl += t.total_profit_loss || 0;
      } else if (days < 180) {
        groups['中期 (1-6月)'].traders.push(t);
        groups['中期 (1-6月)'].pnl += t.total_profit_loss || 0;
      } else {
        groups['长期 (>6月)'].traders.push(t);
        groups['长期 (>6月)'].pnl += t.total_profit_loss || 0;
      }
    });
    
    return Object.entries(groups)
      .filter(([_, data]) => data.traders.length > 0)
      .map(([name, data]) => ({
        name,
        count: data.traders.length,
        avgPnl: data.pnl / data.traders.length
      }));
  }

  _getAIAnalysis() {
    const traders = this.db.getAllAddressStats();
    const categories = this._getCategoryStats();
    
    // 找出最佳赛道
    const bestCategory = categories.sort((a, b) => b.totalPnl - a.totalPnl)[0];
    
    // 计算整体胜率
    const totalWins = traders.reduce((sum, t) => sum + (t.wins || 0), 0);
    const totalLosses = traders.reduce((sum, t) => sum + (t.losses || 0), 0);
    const totalWithResult = totalWins + totalLosses;
    const winRate = totalWithResult > 0 ? (totalWins / totalWithResult * 100).toFixed(1) : 0;
    
    return {
      bestCategory: bestCategory?.name || null,
      bestCategoryPnl: bestCategory?.totalPnl || 0,
      overallWinRate: winRate,
      totalTrades: traders.reduce((sum, t) => sum + (t.trade_count || 0), 0),
      recommendation: bestCategory ? `关注${bestCategory.name}赛道的交易员` : '暂无建议'
    };
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
    .section h2 { color: #00f5ff; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
    .trader-list { display: grid; gap: 10px; }
    .trader-card { background: #1a1a2e; padding: 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid #00f5ff; }
    .trader-card.negative { border-left-color: #ff4757; }
    .trader-info h3 { color: #fff; margin-bottom: 5px; }
    .trader-info p { color: #888; font-size: 0.9em; }
    .trader-stats { display: flex; gap: 15px; text-align: right; }
    .stat-item { display: flex; flex-direction: column; }
    .stat-item .value { font-size: 1.2em; font-weight: bold; color: #00ff88; }
    .stat-item .value.negative { color: #ff4757; }
    .stat-item .label { font-size: 0.75em; color: #666; }
    .category-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; }
    .category-card { background: #1a1a2e; padding: 15px; border-radius: 8px; border-left: 4px solid #b829dd; }
    .category-card h3 { color: #fff; margin-bottom: 10px; }
    .category-card p { color: #888; font-size: 0.9em; margin: 5px 0; }
    .category-card .best { color: #00ff88; }
    .duration-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .duration-card { background: #1a1a2e; padding: 15px; border-radius: 8px; text-align: center; }
    .duration-card h3 { color: #00f5ff; margin-bottom: 10px; }
    .ai-box { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px; border-radius: 8px; border: 1px solid #00f5ff33; }
    .ai-box h3 { color: #00f5ff; margin-bottom: 15px; }
    .ai-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 15px; }
    .ai-stat { text-align: center; }
    .ai-stat .value { font-size: 1.5em; font-weight: bold; color: #fff; }
    .ai-stat .label { color: #888; font-size: 0.85em; }
    .recommendation { background: #00f5ff11; padding: 15px; border-radius: 8px; border-left: 4px solid #00f5ff; }
    .recommendation p { color: #fff; }
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

  <div class="section">
    <h2>🏷️ 赛道分类</h2>
    <div class="category-grid" id="categories-list"><div class="loading">加载中...</div></div>
  </div>

  <div class="section">
    <h2>⏱️ 交易时长分布</h2>
    <div class="duration-list" id="duration-list"><div class="loading">加载中...</div></div>
  </div>

  <div class="section">
    <h2>🤖 AI 市场分析</h2>
    <div id="ai-analysis"><div class="loading">加载中...</div></div>
  </div>

  <div class="last-update" id="last-update"></div>

  <script>
    async function loadData() {
      try {
        // 基础统计
        const statsRes = await fetch('/api/stats');
        const stats = await statsRes.json();
        document.getElementById('trader-count').textContent = stats.traderCount;
        document.getElementById('total-trades').textContent = stats.totalTrades.toLocaleString();
        const pnlEl = document.getElementById('total-pnl');
        pnlEl.textContent = (stats.totalPnl >= 0 ? '+' : '') + '$' + Math.round(stats.totalPnl).toLocaleString();
        pnlEl.className = 'stat-value ' + (stats.totalPnl >= 0 ? 'positive' : 'negative');
        document.getElementById('last-update').textContent = '最后更新: ' + new Date(stats.lastUpdate).toLocaleString();

        // 交易员列表（带胜率）
        const tradersRes = await fetch('/api/traders');
        const traders = await tradersRes.json();
        const traderList = document.getElementById('trader-list');
        traderList.innerHTML = traders.map(t => {
          const pnl = t.total_profit_loss || 0;
          const cardClass = pnl < 0 ? 'trader-card negative' : 'trader-card';
          const pnlClass = pnl >= 0 ? 'value' : 'value negative';
          const pnlStr = (pnl >= 0 ? '+' : '') + '$' + Math.round(pnl).toLocaleString();
          const winRate = (t.win_rate || 0).toFixed(1);
          return '<div class="' + cardClass + '"><div class="trader-info"><h3>' + 
            (t.label || t.address.slice(0, 20) + '...') + '</h3><p>' + 
            t.address.slice(0, 30) + '...</p></div>' +
            '<div class="trader-stats">' +
            '<div class="stat-item"><span class="value">' + winRate + '%</span><span class="label">胜率</span></div>' +
            '<div class="stat-item"><span class="' + pnlClass + '">' + pnlStr + '</span><span class="label">盈亏</span></div>' +
            '<div class="stat-item"><span class="value">' + (t.trade_count || 0) + '</span><span class="label">交易</span></div>' +
            '</div></div>';
        }).join('');

        // 热门市场
        const marketsRes = await fetch('/api/markets');
        const markets = await marketsRes.json();
        const marketsList = document.getElementById('markets-list');
        marketsList.innerHTML = markets.slice(0, 5).map(m => {
          const vol = (parseFloat(m.volume || 0) / 1000000).toFixed(2);
          const liquidity = (parseFloat(m.liquidity || 0) / 1000).toFixed(1);
          return '<div class="trader-card"><div class="trader-info"><h3>' + 
            (m.question?.substring(0, 60) || 'Unknown') + '</h3><p>交易量: $' + vol + 'M | 流动性: $' + liquidity + 'K</p></div></div>';
        }).join('');

        // 赛道分类
        const catRes = await fetch('/api/categories');
        const categories = await catRes.json();
        const catList = document.getElementById('categories-list');
        catList.innerHTML = categories.map(c => {
          const pnlStr = (c.totalPnl >= 0 ? '+' : '') + '$' + Math.round(c.totalPnl).toLocaleString();
          return '<div class="category-card"><h3>' + c.name + '</h3><p>' + c.traders + ' 人交易</p><p>总盈亏: <span class="' + (c.totalPnl >= 0 ? 'best' : '') + '">' + pnlStr + '</span></p><p>最佳: ' + c.bestTrader + ' (+' + Math.round(c.bestPnl) + ')</p></div>';
        }).join('');

        // 交易时长
        const durRes = await fetch('/api/duration');
        const durations = await durRes.json();
        const durList = document.getElementById('duration-list');
        durList.innerHTML = durations.map(d => {
          const pnlStr = (d.avgPnl >= 0 ? '+' : '') + '$' + Math.round(d.avgPnl).toLocaleString();
          return '<div class="duration-card"><h3>' + d.name + '</h3><p>' + d.count + ' 人</p><p>平均盈亏: <span style="color:' + (d.avgPnl >= 0 ? '#00ff88' : '#ff4757') + '">' + pnlStr + '</span></p></div>';
        }).join('');

        // AI 分析
        const aiRes = await fetch('/api/ai-analysis');
        const ai = await aiRes.json();
        const aiBox = document.getElementById('ai-analysis');
        aiBox.innerHTML = '<div class="ai-box"><div class="ai-stats">' +
          '<div class="ai-stat"><div class="value">' + ai.overallWinRate + '%</div><div class="label">整体胜率</div></div>' +
          '<div class="ai-stat"><div class="value">' + ai.totalTrades.toLocaleString() + '</div><div class="label">总交易数</div></div>' +
          '<div class="ai-stat"><div class="value">' + (ai.bestCategory || '-') + '</div><div class="label">最佳赛道</div></div>' +
          '</div><div class="recommendation"><p>💡 ' + ai.recommendation + '</p></div></div>';

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
