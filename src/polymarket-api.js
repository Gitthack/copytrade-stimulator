const axios = require('axios');

// Polymarket Gamma API (公开，无需认证)
const GAMMA_API = 'https://gamma-api.polymarket.com';
// Polymarket CLOB API (公开行情)
const CLOB_API = 'https://clob.polymarket.com';

class PolymarketAPI {
  // 获取市场列表
  async getMarkets(limit = 100) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets`, {
        params: { limit, active: true },
        timeout: 10000
      });
      return res.data?.markets || [];
    } catch (err) {
      console.error('Gamma API error:', err.message);
      return [];
    }
  }

  // 获取用户交易历史 (通过 CLOB API)
  async getTraderHistory(address) {
    const allTrades = [];
    let nextCursor = null;
    
    console.log(`   📥 获取 ${address.slice(0, 20)}... 的交易历史`);
    
    try {
      // CLOB API 获取交易记录
      while (allTrades.length < 5000) { // 最多5000条
        const params = {
          address: address.toLowerCase(),
          limit: 100
        };
        if (nextCursor) params.cursor = nextCursor;
        
        const res = await axios.get(`${CLOB_API}/trades`, {
          params,
          timeout: 15000
        });
        
        const trades = res.data?.trades || [];
        if (trades.length === 0) break;
        
        allTrades.push(...trades);
        
        // 检查是否有下一页
        nextCursor = res.data?.next_cursor;
        if (!nextCursor || trades.length < 100) break;
        
        console.log(`     已获取 ${allTrades.length} 笔...`);
      }
      
      console.log(`   ✅ 共获取 ${allTrades.length} 笔交易`);
      return allTrades;
      
    } catch (err) {
      console.error('CLOB API error:', err.message);
      // 如果 CLOB 失败，尝试从 Gamma 获取有限数据
      return this.getTraderHistoryFromGamma(address);
    }
  }
  
  // 备用：从 Gamma 获取交易
  async getTraderHistoryFromGamma(address) {
    try {
      const res = await axios.get(`${GAMMA_API}/portfolio/${address.toLowerCase()}`, {
        timeout: 10000
      });
      
      // Gamma 返回的是持仓，需要转换
      const positions = res.data?.positions || [];
      const trades = [];
      
      for (const pos of positions) {
        if (pos.trades) {
          trades.push(...pos.trades.map(t => ({
            id: t.transactionHash,
            market: { id: t.marketId, question: pos.market?.question },
            amount: t.size,
            price: t.price,
            timestamp: Math.floor(new Date(t.timestamp).getTime() / 1000),
            profitLoss: t.profitLoss || 0,
            side: t.side
          })));
        }
      }
      
      return trades;
    } catch (err) {
      console.error('Gamma portfolio error:', err.message);
      return [];
    }
  }

  // 获取热门市场
  async getActiveMarkets(limit = 10) {
    try {
      const res = await axios.get(`${GAMMA_API}/markets`, {
        params: {
          limit,
          active: true,
          sort: 'volume',
          order: 'desc'
        },
        timeout: 10000
      });
      
      return (res.data?.markets || []).map(m => ({
        id: m.id,
        question: m.question,
        volume: m.volume || 0,
        liquidity: m.liquidity || 0,
        category: m.category
      }));
    } catch (err) {
      console.error('Gamma API error:', err.message);
      return [];
    }
  }

  // 转换数据格式
  parseTradeData(rawTrade) {
    return {
      txHash: rawTrade.id || rawTrade.transactionHash,
      marketId: rawTrade.market?.id || rawTrade.marketId,
      marketQuestion: rawTrade.market?.question,
      outcome: rawTrade.side || rawTrade.outcome,
      amount: parseFloat(rawTrade.amount || rawTrade.size || 0),
      price: parseFloat(rawTrade.price || 0),
      timestamp: typeof rawTrade.timestamp === 'string' 
        ? Math.floor(new Date(rawTrade.timestamp).getTime() / 1000)
        : parseInt(rawTrade.timestamp),
      profitLoss: parseFloat(rawTrade.profitLoss || 0)
    };
  }
}

module.exports = PolymarketAPI;
