const axios = require('axios');

const GAMMA_API = 'https://gamma-api.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

class PolymarketOfficialAPI {
  // 获取市场列表
  async getMarkets(limit = 10) {
    try {
      const response = await axios.get(`${GAMMA_API}/markets`, {
        params: { closed: false, limit }
      });
      return response.data;
    } catch (err) {
      console.error('Markets API error:', err.message);
      return [];
    }
  }

  // 获取单个市场
  async getMarket(conditionId) {
    try {
      const response = await axios.get(`${GAMMA_API}/markets/${conditionId}`);
      return response.data;
    } catch (err) {
      console.error('Market API error:', err.message);
      return null;
    }
  }

  // 获取地址的活动历史 (通过 Data API)
  async getAddressActivity(address) {
    try {
      const response = await axios.get(`${DATA_API}/portfolio/users/${address.toLowerCase()}`);
      return response.data;
    } catch (err) {
      console.error('Activity API error:', err.message);
      return null;
    }
  }

  // 获取地址的盈亏数据
  async getAddressPnL(address) {
    try {
      const response = await axios.get(`${DATA_API}/portfolio/users/${address.toLowerCase()}/profit`);
      return response.data;
    } catch (err) {
      console.error('PnL API error:', err.message);
      return null;
    }
  }

  // 获取地址的持仓
  async getAddressPositions(address) {
    try {
      const response = await axios.get(`${DATA_API}/portfolio/users/${address.toLowerCase()}/positions`);
      return response.data;
    } catch (err) {
      console.error('Positions API error:', err.message);
      return [];
    }
  }

  // 获取历史交易
  async getAddressTrades(address, limit = 50) {
    try {
      const response = await axios.get(`${DATA_API}/portfolio/users/${address.toLowerCase()}/trades`, {
        params: { limit }
      });
      return response.data || [];
    } catch (err) {
      console.error('Trades API error:', err.message);
      return [];
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
}

module.exports = PolymarketOfficialAPI;
