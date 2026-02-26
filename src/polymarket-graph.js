const axios = require('axios');

const GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/polymarket/matic-markets';

class PolymarketGraph {
  async query(query, variables = {}) {
    try {
      const response = await axios.post(GRAPH_URL, {
        query,
        variables
      });
      return response.data.data;
    } catch (err) {
      console.error('Graph API error:', err.message);
      return null;
    }
  }

  // 获取交易员历史
  async getTraderHistory(address) {
    const query = `
      query($address: String!) {
        user(id: $address) {
          id
          trades(first: 100, orderBy: timestamp, orderDirection: desc) {
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
    
    const data = await this.query(query, { address: address.toLowerCase() });
    return data?.user?.trades || [];
  }

  // 获取市场顶级交易员
  async getMarketTraders(marketId, limit = 10) {
    const query = `
      query($marketId: String!) {
        market(id: $marketId) {
          trades(first: 100, orderBy: timestamp, orderDirection: desc) {
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
      timestamp: new Date(rawTrade.timestamp * 1000).toISOString(),
      profitLoss: parseFloat(rawTrade.profitLoss || 0)
    };
  }
}

module.exports = PolymarketGraph;
