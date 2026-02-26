const axios = require('axios');

const DATA_API = 'https://data-api.polymarket.com';

class PolymarketDataAPI {
  // 获取地址的交易历史
  async getTrades(address, limit = 100, cursor = null) {
    try {
      const params = {
        user: address.toLowerCase(),
        limit: Math.min(limit, 100)
      };
      if (cursor) params.cursor = cursor;

      const response = await axios.get(`${DATA_API}/trades`, { params });
      // Data API 直接返回数组
      const trades = Array.isArray(response.data) ? response.data : [];
      return { data: trades, next_cursor: null }; // 简化处理，不处理分页
    } catch (err) {
      console.error('Data API trades error:', err.response?.data || err.message);
      return { data: [], next_cursor: null };
    }
  }

  // 获取所有交易（分页循环，拉取全部历史）
  async getAllTrades(address, maxPages = 100) {
    const allTrades = [];
    let cursor = null;
    let pages = 0;

    console.log(`   开始拉取全部历史交易...`);

    while (pages < maxPages) {
      const result = await this.getTrades(address, 100, cursor);
      
      if (result.data && result.data.length > 0) {
        allTrades.push(...result.data);
        console.log(`   第 ${pages + 1} 页: ${result.data.length} 笔交易 (累计: ${allTrades.length})`);
      } else {
        console.log(`   第 ${pages + 1} 页: 无更多数据`);
        break;
      }
      
      // 检查是否有下一页
      if (result.data.length < 100) {
        console.log(`   已获取全部 ${allTrades.length} 笔交易`);
        break;
      }
      
      pages++;
      
      // 避免请求过快
      await new Promise(r => setTimeout(r, 300));
    }

    return allTrades;
  }

  // 获取地址的持仓
  async getPositions(address) {
    try {
      const response = await axios.get(`${DATA_API}/positions`, {
        params: { user: address.toLowerCase() }
      });
      return response.data || [];
    } catch (err) {
      console.error('Data API positions error:', err.message);
      return [];
    }
  }

  // 获取地址的活动记录
  async getActivity(address, limit = 100) {
    try {
      const response = await axios.get(`${DATA_API}/activity`, {
        params: { 
          user: address.toLowerCase(),
          limit 
        }
      });
      return response.data || [];
    } catch (err) {
      console.error('Data API activity error:', err.message);
      return [];
    }
  }

  // 获取 proxyWallet 映射
  async getProxyWallet(address) {
    try {
      const trades = await this.getTrades(address, 1);
      if (trades.data && trades.data.length > 0) {
        return trades.data[0].proxyWallet || null;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  // 转换交易数据格式
  parseTrade(rawTrade) {
    const size = parseFloat(rawTrade.size || 0);
    const price = parseFloat(rawTrade.price || 0);
    const side = rawTrade.side; // BUY / SELL
    
    // 估算盈亏：BUY 时付出 USDC，SELL 时获得 USDC
    // 简化计算：假设所有交易都是独立的，不计算持仓成本
    const profitLoss = side === 'SELL' ? size * (1 - price) : 0;
    
    return {
      id: rawTrade.id,
      txHash: rawTrade.transactionHash,
      proxyWallet: rawTrade.proxyWallet,
      marketId: rawTrade.conditionId,
      marketSlug: rawTrade.slug,
      marketQuestion: rawTrade.title,
      side: side,
      size: size,
      price: price,
      profitLoss: profitLoss,
      timestamp: rawTrade.timestamp,
      outcome: rawTrade.outcome,
      status: 'confirmed'
    };
  }
}

module.exports = PolymarketDataAPI;
