const axios = require('axios');
const crypto = require('crypto');

const CLOB_API = 'https://clob.polymarket.com';

class PolymarketCLOB {
  constructor(apiKey, apiSecret, passphrase, walletAddress) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.walletAddress = walletAddress;
  }

  // 生成 HMAC-SHA256 签名
  _sign(timestamp, method, path, body = '') {
    const message = timestamp + method.toUpperCase() + path + body;
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');
    return signature;
  }

  // 获取请求头 - 修正版
  _headers(method, path, body = '') {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = timestamp + method.toUpperCase() + path + (body || '');
    
    const signature = crypto
      .createHmac('sha256', Buffer.from(this.apiSecret, 'base64'))
      .update(message)
      .digest('base64');
    
    return {
      'POLY_ADDRESS': this.walletAddress || '',
      'POLY_SIGNATURE': signature,
      'POLY_TIMESTAMP': timestamp,
      'POLY_API_KEY': this.apiKey,
      'POLY_PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json'
    };
  }

  // 获取地址的交易历史
  async getTrades(address, limit = 20) {
    try {
      const path = `/trades?taker_address=${address.toLowerCase()}&limit=${limit}`;
      const headers = this._headers('GET', path);
      
      const response = await axios.get(`${CLOB_API}${path}`, { headers });
      return response.data;
    } catch (err) {
      console.error('Get trades error:', err.response?.data || err.message);
      return null;
    }
  }

  // 获取市场列表
  async getMarkets() {
    try {
      const response = await axios.get(`${CLOB_API}/markets`);
      return response.data;
    } catch (err) {
      console.error('Get markets error:', err.message);
      return [];
    }
  }
}

module.exports = PolymarketCLOB;
