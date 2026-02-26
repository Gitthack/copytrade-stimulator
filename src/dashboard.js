const PolymarketAPI = require('./polymarket-api');
const { CopytradeDB } = require('./db');
const PolymarketGraph = require('./polymarket-graph');

class Dashboard {
  constructor() {
    this.api = new PolymarketAPI();
    this.db = new CopytradeDB();
    this.graph = new PolymarketGraph();
  }

  show() {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║      📊 Polymarket CopyTrade Dashboard v2.0               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    this._showMarkets();
    this._showTraders();
    this._showCategories();
    this._showDuration();
    this._showAlerts();
    this._showAIAnalysis();
  }

  // 📈 热门市场
  _showMarkets() {
    console.log('📈 热门市场');
    console.log('─'.repeat(60));
    
    const markets = this.api.getActiveMarkets(5);
    if (markets.length === 0) {
      console.log('   从 Graph API 获取市场数据...\n');
      return;
    }

    markets.forEach((m, i) => {
      const cat = this.api.categorizeMarket(m.question);
      const vol = parseFloat(m.volume || 0);
      const catIcon = {
        '加密/DeFi': '₿',
        '政治/选举': '🗳️',
        '体育/竞技': '⚽',
        '科技/AI': '🤖',
        '娱乐/名人': '🎬',
        '天气/自然': '🌤️',
        '经济/金融': '📈'
      }[cat] || '📊';
      
      console.log(`${i+1}. ${catIcon} [${cat}] ${m.question?.substring(0, 35)}...`);
      console.log(`   交易量: $${(vol/1000).toFixed(1)}K | 流动性: ${m.liquidity || 'N/A'}\n`);
    });
  }

  // 👥 追踪交易员
  _showTraders() {
    const traders = this.db.getAllAddressStats();
    
    console.log('👥 追踪交易员');
    console.log('─'.repeat(60));
    
    if (traders.length === 0) {
      console.log('   暂无追踪交易员');
      console.log('   使用: node index.js add-trader <address> [name]\n');
      return;
    }

    console.log('ID  地址                    名称         胜率    盈亏      交易  时长');
    console.log('─'.repeat(60));
    
    traders.forEach(t => {
      const winRate = '0.0'; // 暂时无法计算胜率
      const pnl = t.total_profit_loss || 0;
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`;
      const name = (t.label || '-').substring(0, 10).padEnd(10);
      const addr = (t.address || '').substring(0, 20).padEnd(20);
      const id = (t.id || 0).toString().padEnd(3);
      const trades = (t.trade_count || 0).toString().padEnd(5);
      
      // 计算交易时长
      const firstTrade = this.db.db.prepare(
        'SELECT MIN(timestamp) as first FROM trades WHERE address_id = ?'
      ).get(t.id);
      const duration = this._formatDuration(firstTrade?.first);
      
      console.log(`${id} ${addr} ${name} ${winRate.padEnd(5)}% ${pnlStr.padEnd(9)} ${trades} ${duration}`);
    });
    console.log();
  }

  // 🏷️ Polymarket 赛道分类
  _showCategories() {
    const traders = this.db.getAllAddresses();
    if (traders.length === 0) return;

    console.log('🏷️  Polymarket 赛道分类');
    console.log('─'.repeat(60));
    
    // 获取每个交易员的市场分类
    const categories = {
      '₿ 加密预测': [],
      '🗳️ 政治/选举': [],
      '⚽ 体育/竞技': [],
      '🤖 科技/AI': [],
      '🎬 娱乐/名人': [],
      '🌤️ 天气/自然': [],
      '📈 经济/金融': [],
      '📊 其他': []
    };

    traders.forEach(t => {
      // 从该交易员的交易记录分析其偏好市场
      const trades = this.db.db.prepare(
        'SELECT token_out FROM trades WHERE address_id = ? LIMIT 10'
      ).all(t.id);
      
      // 分析市场偏好
      const marketTypes = trades.map(tr => this._categorizeFromTrade(tr.token_out));
      const dominantType = this._getDominantCategory(marketTypes);
      
      const stats = this.db.getAddressStats(t.id);
      categories[dominantType].push({
        name: t.label || t.address.slice(0, 15),
        pnl: stats?.total_pnl || 0,
        trades: stats?.total_trades || 0
      });
    });

    Object.entries(categories).forEach(([cat, list]) => {
      if (list.length > 0) {
        const totalPnl = list.reduce((sum, t) => sum + t.pnl, 0);
        const topTrader = list.sort((a, b) => b.pnl - a.pnl)[0];
        console.log(`${cat} (${list.length}人)`);
        console.log(`   总盈亏: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)} | 最佳: ${topTrader.name} (+$${topTrader.pnl.toFixed(0)})`);
      }
    });
    console.log();
  }

  // ⏱️ 交易时长分布
  _showDuration() {
    const traders = this.db.getAllAddressStats();
    if (traders.length === 0) return;

    console.log('⏱️  交易时长分布');
    console.log('─'.repeat(60));
    
    const durations = {
      '新手 (<7天)': [],
      '短期 (1-4周)': [],
      '中期 (1-6月)': [],
      '长期 (6月+)': []
    };

    traders.forEach(t => {
      const firstTrade = this.db.db.prepare(
        'SELECT MIN(timestamp) as first FROM trades WHERE address_id = ?'
      ).get(t.id);
      
      if (!firstTrade?.first) return;
      
      const days = Math.floor((Date.now() - new Date(firstTrade.first).getTime()) / (1000 * 60 * 60 * 24));
      const category = days < 7 ? '新手 (<7天)' : 
                       days < 28 ? '短期 (1-4周)' : 
                       days < 180 ? '中期 (1-6月)' : '长期 (6月+)';
      
      durations[category].push({ ...t, days });
    });

    Object.entries(durations).forEach(([cat, list]) => {
      if (list.length > 0) {
        const avgPnl = list.reduce((sum, t) => sum + (t.total_pnl || 0), 0) / list.length;
        console.log(`${cat}: ${list.length}人 | 平均盈亏: ${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(0)}`);
      }
    });
    console.log();
  }

  // 🚨 资金抽离预警
  _showAlerts() {
    const traders = this.db.getAllAddressStats();
    const now = Date.now();
    
    // 检测：高盈利 + 7天无新交易
    const alerts = traders.filter(t => {
      const highProfit = (t.total_pnl || 0) > 200;
      const lastTrade = this.db.db.prepare(
        'SELECT MAX(timestamp) as last FROM trades WHERE address_id = ?'
      ).get(t.id);
      
      if (!lastTrade?.last) return false;
      
      const daysSince = Math.floor((now - new Date(lastTrade.last).getTime()) / (1000 * 60 * 60 * 24));
      return highProfit && daysSince > 7;
    });
    
    if (alerts.length > 0) {
      console.log('🚨 资金抽离预警');
      console.log('─'.repeat(60));
      alerts.forEach(t => {
        const lastTrade = this.db.db.prepare(
          'SELECT MAX(timestamp) as last FROM trades WHERE address_id = ?'
        ).get(t.id);
        const daysSince = Math.floor((now - new Date(lastTrade.last).getTime()) / (1000 * 60 * 60 * 24));
        
        console.log(`⚠️  ${t.label || t.address.substring(0, 20)}...`);
        console.log(`   历史盈利: +$${(t.total_pnl || 0).toFixed(2)} | 最后交易: ${daysSince}天前`);
        console.log(`   🔴 建议: 检查链上余额，可能已撤资\n`);
      });
    }
  }

  // 🤖 AI 市场分析
  _showAIAnalysis() {
    const traders = this.db.getAllAddressStats();
    if (traders.length === 0) return;

    console.log('🤖 AI 市场分析');
    console.log('─'.repeat(60));
    
    // 按赛道统计胜率
    const categoryStats = {};
    
    traders.forEach(t => {
      const trades = this.db.db.prepare(
        'SELECT token_out, profit_loss FROM trades WHERE address_id = ?'
      ).all(t.id);
      
      trades.forEach(tr => {
        const cat = this._categorizeFromTrade(tr.token_out);
        if (!categoryStats[cat]) {
          categoryStats[cat] = { wins: 0, losses: 0, total: 0, pnl: 0 };
        }
        categoryStats[cat].total++;
        categoryStats[cat].pnl += tr.profit_loss || 0;
        if ((tr.profit_loss || 0) > 0) categoryStats[cat].wins++;
        else categoryStats[cat].losses++;
      });
    });

    console.log('赛道胜率分析:');
    Object.entries(categoryStats)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))
      .forEach(([cat, stats]) => {
        const winRate = stats.total > 0 ? (stats.wins / stats.total * 100).toFixed(1) : 0;
        const icon = winRate > 60 ? '✅' : winRate > 40 ? '⚡' : '❌';
        console.log(`   ${icon} ${cat}: ${winRate}% 胜率 | ${stats.total}笔交易 | ${stats.pnl >= 0 ? '+' : ''}$${stats.pnl.toFixed(0)}`);
      });
    
    // 推荐
    const bestCategory = Object.entries(categoryStats)
      .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0];
    
    if (bestCategory) {
      console.log(`\n💡 建议: 关注${bestCategory[0]}赛道的交易员`);
    }
    console.log();
  }

  // 辅助方法
  _formatDuration(timestamp) {
    if (!timestamp) return '-';
    const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24));
    if (days < 7) return `${days}天`;
    if (days < 28) return `${Math.floor(days/7)}周`;
    if (days < 180) return `${Math.floor(days/30)}月`;
    return `${Math.floor(days/365)}年`;
  }

  _categorizeFromTrade(tokenOut) {
    const text = (tokenOut || '').toLowerCase();
    
    // 政治/选举
    if (/election|trump|biden|vote|president|senate|congress|political|governor|midterms|republican|democrat/.test(text)) 
      return '🗳️ 政治/选举';
    
    // 体育/竞技
    if (/super bowl|world cup|olympics|nba|nfl|fifa|tennis|ufc|boxing|championship|playoff|finals|mlb|nhl|epl/.test(text)) 
      return '⚽ 体育/竞技';
    
    // 科技/AI
    if (/ai|artificial intelligence|gpt|openai|chatgpt|tesla|spacex|elon|tech|google|apple|meta|twitter|social media/.test(text)) 
      return '🤖 科技/AI';
    
    // 娱乐/名人
    if (/oscar|grammy|kanye|taylor swift|celebrity|movie|film|album|music|hollywood|netflix|disney/.test(text)) 
      return '🎬 娱乐/名人';
    
    // 经济/金融
    if (/fed|interest rate|inflation|recession|gdp|unemployment|stock market|sp500|nasdaq|dow jones|economy|revenue/.test(text)) 
      return '📈 经济/金融';
    
    // 天气/自然
    if (/weather|temperature|hurricane|earthquake|rain|snow|storm|climate|tornado|flood/.test(text)) 
      return '🌤️ 天气/自然';
    
    // 加密/区块链（价格预测，不是 DeFi 交易）
    if (/bitcoin|btc|ethereum|eth|solana|sol|xrp|ripple|crypto|blockchain|cardano|polygon|matic/.test(text)) 
      return '₿ 加密预测';
    
    return '📊 其他';
  }

  _getDominantCategory(types) {
    if (types.length === 0) return '📊 其他';
    const counts = {};
    types.forEach(t => counts[t] = (counts[t] || 0) + 1);
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  addTrader(address, name) {
    const result = this.db.addAddress(address, name || `交易员_${address.slice(0,6)}`);
    if (result) {
      console.log(`✅ 已添加: ${address.slice(0,20)}...`);
    } else {
      console.log(`❌ 添加失败`);
    }
  }

  removeTrader(id) {
    this.db.removeAddress(parseInt(id));
    console.log(`✅ 已删除 ID: ${id}`);
  }

  close() {
    this.db.close();
  }
}

module.exports = Dashboard;
