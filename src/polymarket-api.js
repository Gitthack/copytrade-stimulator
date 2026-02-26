const { execSync } = require('child_process');

class PolymarketAPI {
  _run(cmd) {
    try {
      const output = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
      return JSON.parse(output);
    } catch (err) {
      // 如果命令失败但返回了输出，尝试解析
      if (err.stdout) {
        try {
          return JSON.parse(err.stdout);
        } catch {}
      }
      console.error(`Polymarket CLI error: ${err.message}`);
      return [];
    }
  }

  getMarkets(limit = 10) {
    return this._run(`polymarket markets list --limit ${limit} -o json`);
  }

  getActiveMarkets(limit = 10) {
    const markets = this._run(`polymarket markets list --limit ${limit} -o json`);
    return markets.filter(m => m.active === true && !m.closed);
  }

  searchMarkets(query, limit = 10) {
    return this._run(`polymarket markets search "${query}" --limit ${limit} -o json`);
  }

  categorizeMarket(question) {
    const q = (question || '').toLowerCase();
    
    if (/bitcoin|btc|ethereum|eth|crypto|defi|nft|blockchain|solana|cardano/.test(q)) 
      return '加密/DeFi';
    if (/election|trump|biden|vote|president|senate|congress|political|governor/.test(q)) 
      return '政治/选举';
    if (/super bowl|world cup|olympics|nba|nfl|fifa|tennis|ufc|boxing|championship/.test(q)) 
      return '体育/竞技';
    if (/ai|artificial intelligence|gpt|openai|tesla|spacex|elon|tech|google|apple/.test(q)) 
      return '科技/AI';
    if (/oscar|grammy|kanye|taylor swift|celebrity|movie|album|twitter|meta|facebook/.test(q)) 
      return '娱乐/名人';
    if (/weather|temperature|hurricane|earthquake|rain|snow|storm|climate/.test(q)) 
      return '天气/自然';
    if (/fed|interest rate|inflation|recession|gdp|unemployment|stock market|sp500|nasdaq/.test(q)) 
      return '经济/金融';
    
    return '其他';
  }
}

module.exports = PolymarketAPI;
