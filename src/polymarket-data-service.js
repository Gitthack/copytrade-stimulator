/**
 * Polymarket Data Service with Caching
 * Optimized for real-time data sync with API rate limiting
 */

const axios = require('axios');
const NodeCache = require('node-cache');

// Polymarket APIs
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// Cache configuration
const CACHE_TTL = {
  markets: 60,        // 1 minute
  traderHistory: 120, // 2 minutes
  stats: 30,          // 30 seconds
  prices: 10,         // 10 seconds
};

class PolymarketDataService {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });
    this.requestQueue = [];
    this.isProcessing = false;
    this.rateLimitDelay = 100; // ms between requests
    
    // Request debouncing
    this.debounceTimers = new Map();
    
    // WebSocket simulation (fallback to polling)
    this.pollingIntervals = new Map();
    this.subscribers = new Map();
  }

  // Debounced request wrapper
  async debouncedRequest(key, requestFn, ttl = 5000) {
    return new Promise((resolve, reject) => {
      // Clear existing timer
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }

      // Set new timer
      const timer = setTimeout(async () => {
        this.debounceTimers.delete(key);
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, ttl);

      this.debounceTimers.set(key, timer);
    });
  }

  // Rate-limited request with retry
  async request(url, options = {}, retries = 3) {
    const cacheKey = `${url}_${JSON.stringify(options.params || {})}`;
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && !options.skipCache) {
      return cached;
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        url,
        options,
        cacheKey,
        resolve,
        reject,
        retries
      });
      
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.isProcessing || this.requestQueue.length === 0) return;
    
    this.isProcessing = true;
    
    while (this.requestQueue.length > 0) {
      const { url, options, cacheKey, resolve, reject, retries } = this.requestQueue.shift();
      
      try {
        const res = await axios.get(url, {
          timeout: 15000,
          ...options
        });
        
        // Cache result
        const ttl = options.cacheTTL || CACHE_TTL.markets;
        this.cache.set(cacheKey, res.data, ttl);
        
        resolve(res.data);
        
        // Rate limiting delay
        await this.sleep(this.rateLimitDelay);
      } catch (error) {
        if (retries > 0 && this.isRetryableError(error)) {
          this.requestQueue.push({ url, options, cacheKey, resolve, reject, retries: retries - 1 });
        } else {
          reject(error);
        }
      }
    }
    
    this.isProcessing = false;
  }

  isRetryableError(error) {
    return error.code === 'ECONNRESET' || 
           error.code === 'ETIMEDOUT' ||
           (error.response && error.response.status >= 500);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============ Market Data ============
  
  async getMarkets(limit = 100, options = {}) {
    const cacheKey = `markets_${limit}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && !options.skipCache) {
      return cached;
    }

    try {
      const data = await this.request(`${GAMMA_API}/markets`, {
        params: { limit, active: true },
        cacheTTL: CACHE_TTL.markets
      });
      
      const markets = (data.markets || []).map(m => ({
        id: m.id,
        question: m.question,
        description: m.description,
        volume: parseFloat(m.volume || 0),
        liquidity: parseFloat(m.liquidity || 0),
        category: m.category,
        endDate: m.endDate,
        outcomes: m.outcomes,
        prices: m.prices,
        icon: m.icon
      }));
      
      this.cache.set(cacheKey, markets, CACHE_TTL.markets);
      return markets;
    } catch (error) {
      console.error('Failed to fetch markets:', error.message);
      return cached || [];
    }
  }

  async getMarketById(marketId) {
    const cacheKey = `market_${marketId}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) return cached;

    try {
      const data = await this.request(`${GAMMA_API}/markets/${marketId}`, {
        cacheTTL: CACHE_TTL.markets
      });
      
      this.cache.set(cacheKey, data, CACHE_TTL.markets);
      return data;
    } catch (error) {
      console.error(`Failed to fetch market ${marketId}:`, error.message);
      return null;
    }
  }

  async getTopMarketsByVolume(limit = 10) {
    const markets = await this.getMarkets(100);
    return markets
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  }

  async getMarketsByCategory(category, limit = 20) {
    const markets = await this.getMarkets(200);
    return markets
      .filter(m => m.category?.toLowerCase() === category.toLowerCase())
      .slice(0, limit);
  }

  // ============ Trader Data ============
  
  async getTraderHistory(address, options = {}) {
    const cacheKey = `trader_${address.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && !options.skipCache) {
      return cached;
    }

    const allTrades = [];
    let nextCursor = null;
    const maxTrades = options.maxTrades || 5000;

    try {
      while (allTrades.length < maxTrades) {
        const params = {
          address: address.toLowerCase(),
          limit: 100
        };
        if (nextCursor) params.cursor = nextCursor;

        const data = await this.request(`${CLOB_API}/trades`, {
          params,
          cacheTTL: CACHE_TTL.traderHistory
        });

        const trades = data.trades || [];
        if (trades.length === 0) break;

        allTrades.push(...trades.map(t => this.normalizeTrade(t, address)));

        nextCursor = data.next_cursor;
        if (!nextCursor || trades.length < 100) break;
      }

      // Sort by timestamp desc
      allTrades.sort((a, b) => b.timestamp - a.timestamp);
      
      this.cache.set(cacheKey, allTrades, CACHE_TTL.traderHistory);
      return allTrades;

    } catch (error) {
      console.error(`Failed to fetch trader history for ${address}:`, error.message);
      return cached || [];
    }
  }

  normalizeTrade(rawTrade, address) {
    return {
      id: rawTrade.id || rawTrade.transactionHash,
      txHash: rawTrade.transactionHash || rawTrade.id,
      marketId: rawTrade.market?.id || rawTrade.marketId,
      marketQuestion: rawTrade.market?.question,
      side: rawTrade.side?.toUpperCase(),
      outcome: rawTrade.outcome,
      amount: parseFloat(rawTrade.size || rawTrade.amount || 0),
      price: parseFloat(rawTrade.price || 0),
      timestamp: this.parseTimestamp(rawTrade.timestamp),
      profitLoss: parseFloat(rawTrade.profitLoss || 0),
      fee: parseFloat(rawTrade.fee || 0),
      trader: address.toLowerCase()
    };
  }

  parseTimestamp(ts) {
    if (typeof ts === 'string') {
      return Math.floor(new Date(ts).getTime() / 1000);
    }
    return parseInt(ts) || Math.floor(Date.now() / 1000);
  }

  // ============ Real-time Sync ============
  
  subscribeToTrader(address, callback, intervalMs = 30000) {
    const key = `trader_${address.toLowerCase()}`;
    
    // Add subscriber
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(callback);

    // Start polling if not already
    if (!this.pollingIntervals.has(key)) {
      const interval = setInterval(async () => {
        try {
          const trades = await this.getTraderHistory(address, { skipCache: true });
          const subscribers = this.subscribers.get(key);
          if (subscribers) {
            subscribers.forEach(cb => cb(trades));
          }
        } catch (error) {
          console.error(`Polling error for ${address}:`, error.message);
        }
      }, intervalMs);
      
      this.pollingIntervals.set(key, interval);
    }

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.unsubscribe(key);
        }
      }
    };
  }

  unsubscribe(key) {
    const interval = this.pollingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(key);
    }
    this.subscribers.delete(key);
  }

  // ============ Price Data ============
  
  async getMarketPrices(marketId) {
    const cacheKey = `prices_${marketId}`;
    
    try {
      const data = await this.request(`${CLOB_API}/markets/${marketId}/prices`, {
        cacheTTL: CACHE_TTL.prices
      });
      
      this.cache.set(cacheKey, data, CACHE_TTL.prices);
      return data;
    } catch (error) {
      console.error(`Failed to fetch prices for ${marketId}:`, error.message);
      return this.cache.get(cacheKey) || null;
    }
  }

  // ============ Cache Management ============
  
  clearCache(pattern) {
    if (pattern) {
      const keys = this.cache.keys().filter(k => k.includes(pattern));
      this.cache.del(keys);
    } else {
      this.cache.flushAll();
    }
  }

  getCacheStats() {
    return {
      keys: this.cache.keys().length,
      stats: this.cache.getStats()
    };
  }
}

module.exports = PolymarketDataService;
