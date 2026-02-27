const cron = require('node-cron');
const PolymarketDataAPI = require('./polymarket-data-api');
const { CopytradeDB } = require('./db');

class SyncService {
  constructor() {
    this.api = new PolymarketDataAPI();
    this.db = new CopytradeDB();
    this.jobs = [];
  }

  // 启动定时同步
  start() {
    console.log('🔄 启动实时同步服务...\n');
    
    // 每 5 分钟同步一次
    const job = cron.schedule('*/5 * * * *', () => {
      this.syncAllTraders();
    });
    
    this.jobs.push(job);
    
    // 立即执行一次
    this.syncAllTraders();
    
    console.log('✅ 同步服务已启动 (每5分钟)');
    console.log('   按 Ctrl+C 停止\n');
  }

  async syncAllTraders() {
    console.log(`[${new Date().toLocaleTimeString()}] 同步中...`);
    
    const traders = this.db.getAllAddresses();
    
    for (const trader of traders) {
      try {
        await this.syncTrader(trader.address);
        console.log(`   ✅ ${trader.label || trader.address.slice(0, 20)}...`);
      } catch (err) {
        console.log(`   ❌ ${trader.label || trader.address.slice(0, 20)}... - ${err.message}`);
      }
    }
    
    console.log(`[${new Date().toLocaleTimeString()}] 同步完成\n`);
  }

  async syncTrader(address) {
    const trades = await this.api.getUserTrades(address);
    const trader = this.db.getAllAddresses().find(t => t.address === address);
    
    if (!trader || trades.length === 0) return;
    
    console.log(`   📥 ${trader.label}: 获取到 ${trades.length} 笔交易`);
    
    let added = 0;
    for (const trade of trades) {
      try {
        const parsed = this.api.parseTradeData(trade);
        this.db.addTrade({
          address_id: trader.id,
          tx_hash: parsed.txHash,
          token_in: parsed.side === 'BUY' ? 'USDC' : parsed.marketQuestion?.substring(0, 20) || 'MARKET',
          token_out: parsed.side === 'SELL' ? 'USDC' : parsed.marketQuestion?.substring(0, 20) || 'MARKET',
          amount_in: parsed.usdcSize,
          amount_out: parsed.usdcSize,
          timestamp: parsed.timestamp,
          profit_loss: parsed.profitLoss
        });
        added++;
      } catch (err) {
        // 重复交易会失败，忽略
      }
    }
    
    if (added > 0) {
      console.log(`   ✅ 新增 ${added} 笔交易`);
    }
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    this.db.close();
    console.log('🛑 同步服务已停止');
  }
}

module.exports = SyncService;
