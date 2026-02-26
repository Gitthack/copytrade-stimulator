const WebSocket = require('ws');
const { CopytradeDB } = require('./db');
const TelegramNotifier = require('./telegram-notifier');

class RealtimeSync {
  constructor() {
    this.ws = null;
    this.db = new CopytradeDB();
    this.notifier = new TelegramNotifier();
    this.trackedAddresses = new Set();
    this.reconnectInterval = 5000;
    this.heartbeatInterval = null;
  }

  // 加载追踪的地址
  loadTrackedAddresses() {
    const traders = this.db.getAllAddresses();
    this.trackedAddresses = new Set(
      traders.map(t => t.address.toLowerCase())
    );
    console.log(`📊 已加载 ${this.trackedAddresses.size} 个追踪地址`);
  }

  // 连接 WebSocket
  connect() {
    // Polymarket CLOB WebSocket
    const wsUrl = 'wss://clob.polymarket.com/ws/market';
    
    console.log('🔌 连接 Polymarket WebSocket...');
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('✅ WebSocket 已连接');
      this.subscribeToTrades();
      this.startHeartbeat();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(message);
      } catch (err) {
        // 忽略非 JSON 消息
      }
    });

    this.ws.on('close', () => {
      console.log('⚠️ WebSocket 断开，准备重连...');
      this.stopHeartbeat();
      setTimeout(() => this.connect(), this.reconnectInterval);
    });

    this.ws.on('error', (err) => {
      console.error('WebSocket 错误:', err.message);
    });
  }

  // 订阅交易频道
  subscribeToTrades() {
    // 订阅所有市场交易
    const subscribeMsg = {
      type: 'subscribe',
      channel: 'trades',
      filters: {}
    };
    
    this.ws.send(JSON.stringify(subscribeMsg));
    console.log('📡 已订阅交易频道');
  }

  // 处理消息
  handleMessage(message) {
    if (message.type !== 'trade') return;
    
    const trade = message.data;
    if (!trade) return;

    // 检查是否是追踪的地址
    const maker = trade.maker?.toLowerCase();
    const taker = trade.taker?.toLowerCase();
    
    if (this.trackedAddresses.has(maker) || this.trackedAddresses.has(taker)) {
      this.handleTrackedTrade(trade, maker, taker);
    }
  }

  // 处理追踪地址的交易
  async handleTrackedTrade(trade, maker, taker) {
    const address = this.trackedAddresses.has(maker) ? maker : taker;
    const side = this.trackedAddresses.has(maker) ? 'SELL' : 'BUY';
    
    console.log(`\n🚨 检测到追踪交易员交易!`);
    console.log(`   地址: ${address.slice(0, 20)}...`);
    console.log(`   市场: ${trade.marketSlug || 'Unknown'}`);
    console.log(`   方向: ${side}`);
    console.log(`   金额: $${trade.size}`);
    console.log(`   价格: ${trade.price}`);

    // 保存到数据库
    const trader = this.db.getAllAddresses().find(
      t => t.address.toLowerCase() === address
    );
    
    if (trader) {
      try {
        this.db.addTrade({
          address_id: trader.id,
          tx_hash: trade.transactionHash || `ws_${Date.now()}`,
          token_in: side === 'BUY' ? 'USDC' : trade.marketSlug,
          token_out: side === 'SELL' ? 'USDC' : trade.marketSlug,
          amount_in: side === 'BUY' ? trade.size * trade.price : trade.size,
          amount_out: side === 'SELL' ? trade.size * trade.price : trade.size,
          timestamp: new Date().toISOString(),
          profit_loss: 0 // 实时交易暂不计算盈亏
        });
        console.log('   ✅ 已保存到数据库');
      } catch (err) {
        console.log('   ⚠️ 保存失败:', err.message);
      }
    }

    // Telegram 通知
    await this.notifier.sendLargeTradeAlert(
      { label: trader?.label || address.slice(0, 20) },
      { profit_loss: 0 },
      parseFloat(trade.size || 0)
    );
  }

  // 心跳保活
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // 启动实时同步
  start() {
    console.log('🚀 启动实时同步服务...\n');
    this.loadTrackedAddresses();
    this.connect();
    
    // 每小时刷新一次地址列表
    setInterval(() => {
      this.loadTrackedAddresses();
    }, 3600000);
  }

  stop() {
    console.log('🛑 停止实时同步服务');
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
    }
    this.db.close();
  }
}

module.exports = RealtimeSync;
