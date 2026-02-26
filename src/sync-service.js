const cron = require('node-cron');
const PolymarketGraph = require('./polymarket-graph');
const { CopytradeDB } = require('./db');

class SyncService {
  constructor() {
    this.graph = new PolymarketGraph();
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
    const trades = await this.graph.getTraderHistory(address);
    const trader = this.db.getAllAddresses().find(t => t.address === address);
    
    if (!trader) return;
    
    for (const trade of trades) {
      try {
        const parsed = this.graph.parseTradeData(trade);
        this.db.addTrade({
          address_id: trader.id,
          tx_hash: parsed.txHash,
          token_in: 'USDC',
          token_out: parsed.marketQuestion?.substring(0, 20) || 'MARKET',
          amount_in: parsed.amount,
          amount_out: parsed.amount * parsed.price,
          timestamp: parsed.timestamp,
          profit_loss: parsed.profitLoss
        });
      } catch (err) {
        // 重复交易会失败，忽略
      }
    }
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    this.db.close();
    console.log('🛑 同步服务已停止');
  }
}

module.exports = SyncService;
