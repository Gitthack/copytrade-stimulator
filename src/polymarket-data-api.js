const axios = require('axios');

const DATA_API_URL = 'https://data-api.polymarket.com';
const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

class PolymarketDataAPI {
  async getUserActivity(address, limit = 1000, offset = 0) {
    try {
      const response = await axios.get(
        `${DATA_API_URL}/activity?user=${address.toLowerCase()}&limit=${limit}&offset=${offset}`,
        { timeout: 30000 }
      );
      return response.data || [];
    } catch (err) {
      console.error('Data API error:', err.message);
      return [];
    }
  }

  async getUserTrades(address) {
    const allTrades = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    
    console.log(`   📥 获取 ${address.slice(0, 20)}... 的交易历史`);
    
    while (hasMore && offset < 100000) { // 最多10万条防止无限循环
      const activity = await this.getUserActivity(address, limit, offset);
      const trades = activity.filter(a => a.type === 'TRADE');
      
      if (trades.length === 0) {
        hasMore = false;
      } else {
        allTrades.push(...trades);
        offset += activity.length; // 使用 activity 长度作为偏移量
        
        if (activity.length < limit) {
          hasMore = false;
        } else {
          console.log(`     已获取 ${allTrades.length} 笔...`);
        }
      }
    }
    
    console.log(`   ✅ 共获取 ${allTrades.length} 笔交易`);
    return allTrades;
  }

  async getMarket(marketId) {
    try {
      const response = await axios.get(
        `${GAMMA_API_URL}/markets/${marketId}`,
        { timeout: 10000 }
      );
      return response.data;
    } catch (err) {
      return null;
    }
  }

  parseTradeData(rawTrade) {
    return {
      txHash: rawTrade.transactionHash,
      marketId: rawTrade.conditionId,
      marketQuestion: rawTrade.title,
      outcome: rawTrade.outcomeIndex === 0 ? 'Yes' : 'No',
      amount: parseFloat(rawTrade.size || 0),
      price: parseFloat(rawTrade.price || 0),
      timestamp: rawTrade.timestamp, // API 返回的已经是 Unix 秒
      profitLoss: 0,
      side: rawTrade.side,
      usdcSize: parseFloat(rawTrade.usdcSize || 0)
    };
  }
}

module.exports = PolymarketDataAPI;
