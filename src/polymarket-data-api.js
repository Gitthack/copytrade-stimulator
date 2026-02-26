const axios = require('axios');

const DATA_API = 'https://data-api.polymarket.com';

class PolymarketDataAPI {
  // 获取地址的交易历史
  async getTrades(address, limit = 100, offset = 0) {
    try {
      const params = {
        user: address.toLowerCase(),
        limit: Math.min(limit, 100),
        offset: offset
      };

      const response = await axios.get(`${DATA_API}/trades`, { params, timeout: 30000 });
      // Data API 直接返回数组
      const trades = Array.isArray(response.data) ? response.data : [];
      return { data: trades };
    } catch (err) {
      console.error('Data API trades error:', err.response?.data || err.message);
      return { data: [] };
    }
  }

  // 获取所有交易（分页循环，拉取全部历史）
  async getAllTrades(address, maxTrades = 5000) {
    const allTrades = [];
    let offset = 0;
    const pageSize = 100;

    console.log(`   开始拉取全部历史交易...`);

    while (allTrades.length < maxTrades) {
      const result = await this.getTrades(address, pageSize, offset);
      
      if (result.data && result.data.length > 0) {
        allTrades.push(...result.data);
        console.log(`   已获取: ${allTrades.length} 笔交易`);
        
        // 如果返回少于 pageSize，说明没有更多数据了
        if (result.data.length < pageSize) {
          console.log(`   已获取全部 ${allTrades.length} 笔交易`);
          break;
        }
        
        offset += pageSize;
      } else {
        console.log(`   已获取全部 ${allTrades.length} 笔交易`);
        break;
      }
      
      // 避免请求过快
      await new Promise(r => setTimeout(r, 200));
    }

    return allTrades;
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
  parseTrade(rawTrade, previousTrades = []) {
    const size = parseFloat(rawTrade.size || 0);
    const price = parseFloat(rawTrade.price || 0);
    const side = rawTrade.side; // BUY / SELL
    const asset = rawTrade.asset;
    
    // 计算真实盈亏
    // 如果是 SELL，找到之前同一资产的 BUY，计算差价
    let profitLoss = 0;
    
    if (side === 'SELL' && previousTrades.length > 0) {
      // 找到同一资产的最近 BUY
      const buyTrade = previousTrades
        .filter(t => t.side === 'BUY' && t.asset === asset)
        .pop();
      
      if (buyTrade) {
        // 盈亏 = (卖出价格 - 买入价格) * 数量
        profitLoss = size * (price - buyTrade.price);
      }
    }
    
    return {
      id: rawTrade.id,
      txHash: rawTrade.transactionHash,
      proxyWallet: rawTrade.proxyWallet,
      marketId: rawTrade.conditionId,
      marketSlug: rawTrade.slug,
      marketQuestion: rawTrade.title,
      asset: asset,
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
