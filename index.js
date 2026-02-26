#!/usr/bin/env node

const Dashboard = require('./src/dashboard');
const SyncService = require('./src/sync-service');
const RealtimeSync = require('./src/realtime-sync');
const PolymarketDataAPI = require('./src/polymarket-data-api');
const { CopytradeDB } = require('./src/db');
const TelegramNotifier = require('./src/telegram-notifier');
const BacktestEngine = require('./src/backtest-engine');
const WebDashboard = require('./src/web-dashboard');

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'dashboard':
      new Dashboard().show();
      break;
      
    case 'sync':
      const sync = new SyncService();
      sync.start();
      process.on('SIGINT', () => sync.stop());
      break;
      
    case 'realtime':
      const realtime = new RealtimeSync();
      realtime.start();
      process.on('SIGINT', () => realtime.stop());
      break;
      
    case 'web':
      const web = new WebDashboard(args[1] || 3000);
      web.start();
      break;
      
    case 'add-trader':
      if (!args[1]) {
        console.log('Usage: add-trader <address> [name]');
        return;
      }
      const db = new CopytradeDB();
      const result = db.addAddress(args[1], args[2]);
      console.log(result ? '✅ Added' : '❌ Failed');
      db.close();
      break;
      
    case 'remove-trader':
      if (!args[1]) {
        console.log('Usage: remove-trader <id>');
        return;
      }
      const db2 = new CopytradeDB();
      db2.removeAddress(parseInt(args[1]));
      console.log('✅ Removed');
      db2.close();
      break;
      
    case 'fetch-real':
      console.log('🔍 Fetching real trader data from Polymarket Data API...\n');
      const dataAPI = new PolymarketDataAPI();
      const db3 = new CopytradeDB();
      const traders = db3.getAllAddresses();
      
      for (const trader of traders) {
        console.log(`Fetching ${trader.label || trader.address.slice(0, 20)}...`);
        
        // 1. 先获取 proxyWallet 映射
        const proxyWallet = await dataAPI.getProxyWallet(trader.address);
        if (proxyWallet) {
          console.log(`   Proxy wallet: ${proxyWallet.slice(0, 20)}...`);
          // 更新数据库记录 proxyWallet
          db3.db.prepare('UPDATE tracked_addresses SET proxy_wallet = ? WHERE id = ?')
            .run(proxyWallet, trader.id);
        }
        
        // 2. 获取所有交易历史（分页拉取）
        const queryAddress = proxyWallet || trader.address;
        const trades = await dataAPI.getAllTrades(queryAddress, 10);
        console.log(`   Found ${trades.length} trades`);
        
        // 3. 保存交易记录到数据库
        let totalPnl = 0;
        for (const trade of trades) {
          try {
            const parsed = dataAPI.parseTrade(trade);
            db3.addTrade({
              address_id: trader.id,
              tx_hash: parsed.txHash,
              token_in: parsed.side === 'BUY' ? 'USDC' : parsed.marketSlug,
              token_out: parsed.side === 'SELL' ? 'USDC' : parsed.marketSlug,
              amount_in: parsed.side === 'BUY' ? parsed.size * parsed.price : parsed.size,
              amount_out: parsed.side === 'SELL' ? parsed.size * parsed.price : parsed.size,
              timestamp: new Date(parsed.timestamp * 1000).toISOString(),
              profit_loss: parsed.profitLoss
            });
            totalPnl += parsed.profitLoss;
          } catch (err) {
            // 重复交易忽略
          }
        }
        
        if (trades.length > 0) {
          console.log(`   Total PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
        }
        console.log();
      }
      
      console.log('✅ Real data imported from Polymarket Data API!');
      db3.close();
      break;
      
    case 'backtest':
      if (!args[1]) {
        console.log('Usage: backtest <trader_id>');
        return;
      }
      const db4 = new CopytradeDB();
      const engine = new BacktestEngine(db4);
      engine.generateReport(parseInt(args[1]));
      db4.close();
      break;
      
    case 'export':
      const db5 = new CopytradeDB();
      const stats = db5.getAllAddressStats();
      console.log(JSON.stringify(stats, null, 2));
      db5.close();
      break;
      
    case 'notify-test':
      const notifier = new TelegramNotifier();
      await notifier.sendMessage('🧪 *Test Notification*\n\nCopyTrade Simulator is working!');
      console.log('✅ Notification sent');
      break;
      
    case 'help':
    default:
      console.log(`
📊 CopyTrade Simulator v2.0 - Complete

Commands:
  dashboard              Show CLI dashboard
  web [port]             Start web dashboard (default: 3000)
  sync                   Start Data API sync (full history)
  realtime               Start WebSocket realtime sync
  add-trader <addr>     Add trader
  remove-trader <id>     Remove trader
  fetch-real             Import real data from Polymarket
  backtest <id>          Run backtest for trader
  export                 Export data as JSON
  notify-test            Test Telegram notification
  help                   Show this help

Environment Variables:
  TELEGRAM_BOT_TOKEN     Telegram bot token
  TELEGRAM_CHAT_ID       Telegram chat ID
`);
  }
}

main().catch(console.error);
