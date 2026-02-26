const axios = require('axios');

const POLYGON_RPC = 'https://polygon-rpc.com';

// Polymarket Exchange 合约地址
const EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';

class PolymarketOnChain {
  // 通过 Polygon 区块链获取交易历史
  async getAddressTrades(address) {
    try {
      // 使用 PolygonScan API 获取交易列表
      const url = `https://api.polygonscan.com/api?module=account&action=tokentx&address=${address.toLowerCase()}&startblock=0&endblock=99999999&sort=desc`;
      
      const response = await axios.get(url);
      const txs = response.data.result || [];
      
      // 过滤 Polymarket 相关交易 (USDC 转账到 Exchange 合约)
      const pmTrades = txs.filter(tx => 
        tx.to.toLowerCase() === EXCHANGE_ADDRESS.toLowerCase() ||
        tx.from.toLowerCase() === EXCHANGE_ADDRESS.toLowerCase()
      );
      
      return pmTrades.map(tx => ({
        txHash: tx.hash,
        timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
        token: tx.tokenSymbol,
        amount: parseFloat(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)),
        from: tx.from,
        to: tx.to,
        side: tx.from.toLowerCase() === address.toLowerCase() ? 'SELL' : 'BUY'
      }));
    } catch (err) {
      console.error('On-chain query error:', err.message);
      return [];
    }
  }

  // 获取地址的 USDC 余额
  async getUSDCBalance(address) {
    try {
      const USDC_CONTRACT = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
      const url = `https://api.polygonscan.com/api?module=stats&action=tokensupply&contractaddress=${USDC_CONTRACT}`;
      
      // 简化版，实际需要调用 balanceOf
      return null;
    } catch (err) {
      return null;
    }
  }
}

module.exports = PolymarketOnChain;
