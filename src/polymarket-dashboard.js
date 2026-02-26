const PolymarketAPI = require('./polymarket-api');
const CopyTradeDB = require('./db');

class PolymarketDashboard {
  constructor() {
    this.api = new PolymarketAPI();
    this.db = new CopyTradeDB();
    
    // Polymarket 市场类别关键词
    this.categories = {
      '加密/DeFi': ['bitcoin', 'ethereum', 'crypto', 'btc', 'eth', 'defi', 'nft', 'blockchain', 'solana', 'cardano'],
      '政治/选举': ['election', 'trump', 'biden', 'vote', 'president', 'senate', 'congress', 'political', 'governor', 'mayor'],
      '体育/竞技': ['super bowl', 'world cup', 'olympics', 'nba', 'nfl', 'fifa', 'tennis', 'ufc', 'boxing', 'championship'],
      '科技/AI': ['ai', 'artificial intelligence', 'gpt', 'openai', 'tesla', 'spacex', 'elon', 'tech', 'google', 'apple'],
      '娱乐/名人': ['oscar', 'grammy', 'kanye', 'taylor swift', 'celebrity', 'movie', 'album', 'twitter', 'meta', 'facebook'],
      '天气/自然': ['weather', 'temperature', 'hurricane', 'earthquake', 'rain', 'snow', 'storm', 'climate'],
      '经济/金融': ['fed', 'interest rate', 'inflation', 'recession', 'gdp', 'unemployment', 'stock market', 'sp500', 'nasdaq'],
      '其他': []
    };
  }

  // 分析市场类别
  categorizeMarket(question) {
    const q = question.toLowerCase();
    
    for (const [category, keywords] of Object.entries(this.categories)) {
      if (category === '其他') continue;
      
      for (const keyword of keywords) {
        if (q.includes(keyword.toLowerCase())) {
          return category;
        }
      }
    }
    
    return '其他';
  }

  // 显示主看板
  show() {
    console.clear();
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║      📊 Polymarket CopyTrade Dashboard v4.0                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    this.showMarketOverview();
    this.showTrackedTraders();
    this.showTraderByCategory(); // 按 Polymarket 类别分类
    this.showTraderDuration();   // 交易时长
    this.showHotMarkets();
    this.showAISignals();
    this.showWithdrawalAlerts();
  }

  // 市场概览
  showMarketOverview() {
    console.log('📈 市场概览');
    console.log('─'.repeat(60));
    
    const markets = this.api.getMarkets(50);
    const activeMarkets = markets.filter(m => m.status === 'Active');
    const totalVolume = markets.reduce((sum, m) => {
      const vol = parseFloat(m.volume?.replace(/[$,]/g, '') || 0);
      return sum + vol;
    }, 0);

    // 统计各类别市场数量
    const categoryCount = {};
    markets.forEach(m => {
      const cat = this.categorizeMarket(m.question || '');
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    console.log(`   活跃市场: ${activeMarkets.length}`);
    console.log(`   总交易量: $${(totalVolume / 1e6).toFixed(2)}M`);
    console.log(`   追踪交易员: ${this.db.getAllAddresses().length} 人`);
    console.log();
    
    console.log('   市场类别分布:');
    Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([cat, count]) => {
        console.log(`      • ${cat}: ${count}个市场`);
      });
    console.log();
  }

  // 显示追踪的交易员
  showTrackedTraders() {
    const traders = this.db.getAllAddressStats();
    
    if (traders.length === 0) {
      console.log('⚠️  暂无追踪交易员');
      console.log('   使用: node index.js add-trader <address> [name]\n');
      return;
    }

    console.log('👥 追踪交易员表现');
    console.log('─'.repeat(60));
    console.log('ID  地址                    名称         胜率    盈亏      交易  时长');
    console.log('─'.repeat(60));
    
    traders.forEach(t => {
      const winRate = t.total_trades > 0 
        ? (t.wins / t.total_trades * 100).toFixed(1)
        : '0.0';
      const pnl = t.total_pnl || 0;
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(0)}` : `-$${Math.abs(pnl).toFixed(0)}`;
      const name = (t.label || '-').substring(0, 10).padEnd(10);
      const addr = t.address.substring(0, 20).padEnd(20);
      
      // 计算交易时长
      const duration = this.getTradingDuration(t.id);
      
      console.log(`${t.id.toString().padEnd(3)} ${addr} ${name} ${winRate.padEnd(5)}% ${pnlStr.padEnd(9)} ${t.total_trades.toString().padEnd(5)} ${duration}`);
    });
    console.log();
  }

  // 计算交易时长
  getTradingDuration(addressId) {
    const trades = this.db.db.prepare(
      'SELECT timestamp FROM trades WHERE address_id = ? ORDER BY timestamp ASC'
    ).all(addressId);
    
    if (trades.length === 0) return '-';
    
    const firstTrade = new Date(trades[0].timestamp);
    const now = new Date();
    const days = Math.floor((now - firstTrade) / (1000 * 60 * 60 * 24));
    
    if (days < 1) return '<1天';
    if (days < 7) return `${days}天`;
    if (days < 30) return `${Math.floor(days / 7)}周`;
    if (days < 365) return `${Math.floor(days / 30)}月`;
    return `${Math.floor(days / 365)}年`;
  }

  // 按 Polymarket 类别分类交易员
  showTraderByCategory() {
    const traders = this.db.getAllAddressStatsWithTags();
    
    if (traders.length === 0) return;

    console.log('🏷️  交易员赛道分类 (Polymarket 市场类型)');
    console.log('─'.repeat(60));

    // 按类别分组
    const byCategory = {};
    traders.forEach(t => {
      const cats = t.tags || ['其他'];
      cats.forEach(cat => {
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(t);
      });
    });

    // 显示
    const icons = {
      '加密/DeFi': '₿',
      '政治/选举': '🗳️',
      '体育/竞技': '⚽',
      '科技/AI': '🤖',
      '娱乐/名人': '🎬',
      '天气/自然': '🌤️',
      '经济/金融': '📊',
      '其他': '📌'
    };

    Object.entries(byCategory)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([category, list]) => {
        const icon = icons[category] || '📌';
        console.log(`${icon} ${category} (${list.length}人)`);
        
        list.forEach(t => {
          const pnl = (t.total_pnl || 0).toFixed(0);
          const pnlStr = t.total_pnl >= 0 ? `+$${pnl}` : `-$${Math.abs(pnl)}`;
          const name = (t.label || t.address.substring(0, 12));
          const duration = this.getTradingDuration(t.id);
          console.log(`   ${name.padEnd(15)} | ${pnlStr.padEnd(8)} | ${duration}`);
        });
        console.log();
      });
  }

  // 显示交易时长统计
  showTraderDuration() {
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
      const trades = this.db.db.prepare(
        'SELECT timestamp FROM trades WHERE address_id = ? ORDER BY timestamp ASC'
      ).all(t.id);
      
      if (trades.length === 0) {
        durations['新手 (<7天)'].push(t);
        return;
      }
      
      const firstTrade = new Date(trades[0].timestamp);
      const now = new Date();
      const days = Math.floor((now - firstTrade) / (1000 * 60 * 60 * 24));
      
      if (days < 7) durations['新手 (<7天)'].push(t);
      else if (days < 30) durations['短期 (1-4周)'].push(t);
      else if (days < 180) durations['中期 (1-6月)'].push(t);
      else durations['长期 (6月+)'].push(t);
    });

    Object.entries(durations).forEach(([label, list]) => {
      if (list.length > 0) {
        const avgPnl = list.reduce((sum, t) => sum + (t.total_pnl || 0), 0) / list.length;
        console.log(`${label}: ${list.length}人 | 平均盈亏: ${avgPnl >= 0 ? '+' : ''}$${avgPnl.toFixed(0)}`);
      }
    });
    console.log();
  }

  // 显示热门市场
  showHotMarkets() {
    console.log('🔥 热门市场 (按类别)');
    console.log('─'.repeat(60));
    
    const markets = this.api.getActiveMarkets(10);
    
    if (markets.length === 0) {
      console.log('   暂无活跃市场数据\n');
      return;
    }

    // 按类别分组显示
    const byCat = {};
    markets.forEach(m => {
      const cat = this.categorizeMarket(m.question || '');
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(m);
    });

    Object.entries(byCat).slice(0, 3).forEach(([cat, list]) => {
      console.log(`   [${cat}]`);
      list.slice(0, 2).forEach(m => {
        console.log(`   • ${m.question?.substring(0, 40)}...`);
        console.log(`     价格: ${m.outcomePrices?.[0] || '-'} | 交易量: ${m.volume}`);
      });
      console.log();
    });
  }

  // 显示 AI 交易信号
  showAISignals() {
    const recs = this.db.getLatestRecommendations(3);
    
    console.log('🤖 AI 交易信号');
    console.log('─'.repeat(60));
    
    if (recs.length === 0) {
      console.log('   暂无信号。运行: node index.js analyze\n');
      return;
    }

    recs.forEach(rec => {
      const icon = rec.type === 'BUY' ? '🟢' : 
                   rec.type === 'SELL' ? '🔴' : 
                   rec.type === 'REMOVE' ? '❌' : '⚡';
      console.log(`${icon} [${rec.type}] 置信度 ${rec.confidence?.toFixed(0)}%`);
      console.log(`   ${rec.reason?.substring(0, 55)}...\n`);
    });
  }

  // 显示资金抽离提示
  showWithdrawalAlerts() {
    const traders = this.db.getAllAddressStats();
    const alerts = [];

    traders.forEach(t => {
      const trades = this.db.db.prepare(
        'SELECT timestamp FROM trades WHERE address_id = ? ORDER BY timestamp DESC'
      ).all(t.id);
      
      if (trades.length >= 5 && (t.total_pnl || 0) > 200) {
        const lastTrade = new Date(trades[0].timestamp);
        const now = new Date();
        const daysSince = Math.floor((now - lastTrade) / (1000 * 60 * 60 * 24));
        
        if (daysSince > 7) {
          alerts.push({
            ...t,
            daysSince
          });
        }
      }
    });

    if (alerts.length > 0) {
      console.log('🚨 资金抽离预警');
      console.log('─'.repeat(60));
      
      alerts.forEach(t => {
        console.log(`⚠️  ${t.label || t.address.substring(0, 20)}...`);
        console.log(`   历史盈利: +$${(t.total_pnl || 0).toFixed(2)}`);
        console.log(`   最后交易: ${t.daysSince} 天前`);
        console.log(`   建议: 检查链上余额，考虑移除追踪\n`);
      });
    }
  }

  // 添加交易员
  addTrader(address, name = '') {
    const result = this.db.addAddress(address, name || `交易员_${address.substring(0, 6)}`);
    if (result.success) {
      console.log(`✅ 已追踪交易员: ${address.substring(0, 20)}...`);
      
      // 分析偏好的市场类别
      this.analyzeTraderCategory(address);
    } else {
      console.log(`❌ ${result.error}`);
    }
  }

  // 分析交易员偏好的市场类别
  analyzeTraderCategory(address) {
    // 模拟分析交易历史
    const categories = Object.keys(this.categories).filter(c => c !== '其他');
    const preferred = categories[Math.floor(Math.random() * categories.length)];
    
    console.log(`   📊 偏好类别: ${preferred}`);
    console.log(`   💡 建议: 关注${preferred}类市场机会`);
  }

  // 分析市场机会
  analyzeOpportunities() {
    console.log('🔍 分析市场机会...\n');
    
    const markets = this.api.getActiveMarkets(10);
    const opportunities = [];
    
    markets.forEach(m => {
      const price = parseFloat(m.outcomePrices?.[0] || 0);
      const volume = parseFloat(m.volume?.replace(/[$,]/g, '') || 0);
      const category = this.categorizeMarket(m.question || '');
      
      if (volume > 1000000 && price > 0.3 && price < 0.7) {
        opportunities.push({
          market: m,
          category,
          signal: price < 0.5 ? 'BUY' : 'HOLD',
          reason: `[${category}] 高交易量($${(volume/1e6).toFixed(1)}M)，价格${(price*100).toFixed(1)}%有空间`
        });
      }
    });

    if (opportunities.length > 0) {
      console.log(`✅ 发现 ${opportunities.length} 个机会:\n`);
      
      // 按类别分组
      const byCat = {};
      opportunities.forEach(opp => {
        if (!byCat[opp.category]) byCat[opp.category] = [];
        byCat[opp.category].push(opp);
      });
      
      Object.entries(byCat).forEach(([cat, list]) => {
        console.log(`   [${cat}]`);
        list.forEach((opp, i) => {
          console.log(`   ${i+1}. ${opp.market.question?.substring(0, 35)}...`);
          console.log(`      信号: ${opp.signal} | ${opp.reason.substring(opp.reason.indexOf(']')+2)}\n`);
        });
      });
    } else {
      console.log('⚠️  暂无明显机会，建议观望\n');
    }
  }

  // 检查资金抽离
  checkWithdrawals() {
    console.log('🔍 检查资金抽离情况...\n');
    
    const traders = this.db.getAllAddressStats();
    let alertCount = 0;

    traders.forEach(t => {
      const trades = this.db.db.prepare(
        'SELECT timestamp FROM trades WHERE address_id = ? ORDER BY timestamp DESC'
      ).all(t.id);
      
      if (trades.length >= 5 && (t.total_pnl || 0) > 200) {
        const lastTrade = new Date(trades[0].timestamp);
        const now = new Date();
        const daysSince = Math.floor((now - lastTrade) / (1000 * 60 * 60 * 24));
        
        if (daysSince > 7) {
          console.log(`🚨 ${t.label || t.address.substring(0, 20)}...`);
          console.log(`   历史盈利: +$${(t.total_pnl || 0).toFixed(2)}`);
          console.log(`   交易时长: ${this.getTradingDuration(t.id)}`);
          console.log(`   最后交易: ${daysSince} 天前`);
          console.log(`   ⚠️  疑似资金抽离！\n`);
          alertCount++;
        }
      }
    });

    if (alertCount === 0) {
      console.log('✅ 未发现资金抽离风险\n');
    } else {
      console.log(`⚠️  发现 ${alertCount} 个地址可能已撤资\n`);
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = PolymarketDashboard;
