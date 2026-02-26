const axios = require('axios');

const GAMMA_API = 'https://gamma-api.polymarket.com';

class PolymarketData {
  // 获取活跃市场
  async getActiveMarkets(limit = 10) {
    try {
      const response = await axios.get(`${GAMMA_API}/markets`, {
        params: { 
          closed: false, 
          active: true,
          limit 
        }
      });
      return response.data || [];
    } catch (err) {
      console.error('Markets API error:', err.message);
      return [];
    }
  }

  // 获取市场详情
  async getMarket(conditionId) {
    try {
      const response = await axios.get(`${GAMMA_API}/markets/${conditionId}`);
      return response.data;
    } catch (err) {
      return null;
    }
  }

  // 分类市场
  categorizeMarket(question) {
    const q = (question || '').toLowerCase();
    
    if (/bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|cardano/.test(q)) 
      return '₿ 加密/DeFi';
    if (/election|trump|biden|vote|president|senate|congress|political|governor/.test(q)) 
      return '🗳️ 政治/选举';
    if (/super bowl|world cup|olympics|nba|nfl|fifa|tennis|ufc|boxing|championship/.test(q)) 
      return '⚽ 体育/竞技';
    if (/ai|artificial intelligence|gpt|openai|tesla|spacex|elon|tech|google|apple/.test(q)) 
      return '🤖 科技/AI';
    if (/oscar|grammy|kanye|taylor swift|celebrity|movie|album|twitter|meta|facebook/.test(q)) 
      return '🎬 娱乐/名人';
    if (/weather|temperature|hurricane|earthquake|rain|snow|storm|climate/.test(q)) 
      return '🌤️ 天气/自然';
    if (/fed|interest rate|inflation|recession|gdp|unemployment|stock market|sp500|nasdaq/.test(q)) 
      return '📈 经济/金融';
    
    return '📊 其他';
  }

  // 获取市场流动性排名
  async getTopMarketsByLiquidity(limit = 10) {
    const markets = await this.getActiveMarkets(50);
    return markets
      .sort((a, b) => parseFloat(b.liquidity || 0) - parseFloat(a.liquidity || 0))
      .slice(0, limit);
  }

  // 获取市场交易量排名
  async getTopMarketsByVolume(limit = 10) {
    const markets = await this.getActiveMarkets(50);
    return markets
      .sort((a, b) => parseFloat(b.volume || 0) - parseFloat(a.volume || 0))
      .slice(0, limit);
  }
}

module.exports = PolymarketData;
