const axios = require('axios');

const GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/matic-markets';

class PolymarketGraph {
  async query(query, variables = {}) {
    try {
      const response = await axios.post(GRAPH_URL, {
        query,
        variables
      }, {
        timeout: 30000
      });
      return response.data.data;
    } catch (err) {
      console.error('Graph API error:', err.message);
      return null;
    }
  }

  // 获取交易员所有历史（分页获取）
  async getTraderHistory(address) {
    const allTrades = [];
    let skip = 0;
    const first = 1000; // 每次获取1000条
    let hasMore = true;
    
    console.log(`   📥 获取 ${address.slice(0, 20)}... 的交易历史`);
    
    while (hasMore && skip < 10000) { // 最多10000条防止无限循环
      const query = `
        query($address: String!, $first: Int!, $skip: Int!) {
          user(id: $address) {
            id
            trades(first: $first, skip: $skip, orderBy: timestamp, orderDirection: desc) {
              id
              market {
                id
                question
              }
              outcome
              amount
              price
              timestamp
              profitLoss
            }
          }
        }
      `;
      
      const data = await this.query(query, { 
        address: address.toLowerCase(),
        first,
        skip
      });
      
      const trades = data?.user?.trades || [];
      
      if (trades.length === 0) {
        hasMore = false;
      } else {
        allTrades.push(...trades);
        skip += trades.length;
        
        if (trades.length < first) {
          hasMore = false;
        } else {
          console.log(`     已获取 ${allTrades.length} 笔...`);
        }
      }
    }
    
    console.log(`   ✅ 共获取 ${allTrades.length} 笔交易`);
    return allTrades;
  }

  // 获取市场顶级交易员
  async getMarketTraders(marketId, limit = 10) {
    const query = `
      query($marketId: String!) {
        market(id: $marketId) {
          trades(first: 1000, orderBy: timestamp, orderDirection: desc) {
            user {
              id
            }
            amount
            profitLoss
          }
        }
      }
    `;
    
    const data = await this.query(query, { marketId });
    const trades = data?.market?.trades || [];
    
    // 按用户聚合
    const traderMap = {};
    trades.forEach(t => {
      const addr = t.user.id;
      if (!traderMap[addr]) {
        traderMap[addr] = { address: addr, totalPnl: 0, trades: 0 };
      }
      traderMap[addr].totalPnl += parseFloat(t.profitLoss || 0);
      traderMap[addr].trades++;
    });
    
    return Object.values(traderMap)
      .sort((a, b) => b.totalPnl - a.totalPnl)
      .slice(0, limit);
  }

  // 转换数据格式
  parseTradeData(rawTrade) {
    return {
      txHash: rawTrade.id,
      marketId: rawTrade.market?.id,
      marketQuestion: rawTrade.market?.question,
      outcome: rawTrade.outcome,
      amount: parseFloat(rawTrade.amount || 0),
      price: parseFloat(rawTrade.price || 0),
      timestamp: parseInt(rawTrade.timestamp), // 保持数字格式
      profitLoss: parseFloat(rawTrade.profitLoss || 0)
    };
  }
}

module.exports = PolymarketGraph;
