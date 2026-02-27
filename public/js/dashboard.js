/**
 * CopyTrade Dashboard v5.0 - Enhanced Frontend
 */

// Global State
const state = {
  currentPage: 'dashboard',
  currentTrader: null,
  traders: [],
  trades: [],
  alerts: [],
  recommendations: [],
  refreshInterval: 30,
  refreshTimer: null,
  charts: {},
  pagination: { traders: { page: 1, limit: 20, total: 0 }, trades: { page: 1, limit: 50, total: 0 } },
  sort: { field: 'score.overall', order: 'desc' },
  theme: localStorage.getItem('theme') || 'dark',
  filter: 'all',
  keyboardShortcuts: true
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initEventListeners();
  initKeyboardShortcuts();
  initCharts();
  loadData();
  startAutoRefresh();
  connectWebSocket();
});

// Theme Management
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.textContent = state.theme === 'dark' ? '☀️' : '🌙';
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
  initTheme();
  Object.values(state.charts).forEach(chart => { if (chart) chart.dispose(); });
  initCharts();
  updateCharts();
}

// Keyboard Shortcuts
function initKeyboardShortcuts() {
  if (!state.keyboardShortcuts) return;
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'r': case 'R':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); loadData(); }
        break;
      case '1': navigateTo('dashboard'); break;
      case '2': navigateTo('traders'); break;
      case '3': navigateTo('markets'); break;
      case '4': navigateTo('alerts'); break;
      case 't': case 'T': toggleTheme(); break;
      case 'e': case 'E':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); exportToExcel(); }
        break;
    }
  });
}

// Event Listeners
function initEventListeners() {
  const menuToggle = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  if (menuToggle && sidebar) {
    menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  const themeToggle = document.getElementById('themeToggle');
  themeToggle?.addEventListener('click', toggleTheme);

  const refreshInterval = document.getElementById('refreshInterval');
  refreshInterval?.addEventListener('change', (e) => {
    state.refreshInterval = parseInt(e.target.value);
    startAutoRefresh();
  });

  document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);
  document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);

  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); navigateTo(item.dataset.page); });
  });

  document.querySelectorAll('.chart-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-btn[data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePnlChart(btn.dataset.range);
    });
  });

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (state.sort.field === field) {
        state.sort.order = state.sort.order === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.field = field;
        state.sort.order = 'desc';
      }
      updateSortIcons();
      renderTradersTable();
    });
  });

  const traderSearch = document.getElementById('traderSearch');
  traderSearch?.addEventListener('input', debounce(() => {
    state.pagination.traders.page = 1;
    renderTradersTable();
  }, 300));

  document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filter = btn.dataset.filter;
      renderTradesDetail();
    });
  });
}

// Navigation
function navigateTo(page, params = {}) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const targetPage = document.getElementById(`${page}-page`);
  if (targetPage) targetPage.style.display = 'block';
  
  const titles = { dashboard: 'Dashboard', traders: '交易员', markets: '市场分析', performance: '盈亏分析', alerts: '告警中心', 'trader-detail': '交易员详情' };
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.textContent = titles[page] || 'Dashboard';

  if (page === 'trader-detail' && params.traderId) loadTraderDetail(params.traderId);
  if (page === 'alerts') renderAlertsPage();

  document.getElementById('sidebar')?.classList.remove('open');
  setTimeout(() => Object.values(state.charts).forEach(chart => chart?.resize()), 100);
}

// Data Loading
async function loadData() {
  try {
    showLoading();
    const [tradersRes, recRes, statsRes, tradesRes, alertsRes] = await Promise.all([
      fetch('/api/traders?sort=score'),
      fetch('/api/traders/recommendations?limit=5'),
      fetch('/api/stats'),
      fetch('/api/trades/recent?limit=50'),
      fetch('/api/alerts?active=true')
    ]);

    state.traders = await tradersRes.json();
    state.recommendations = await recRes.json();
    const stats = await statsRes.json();
    state.trades = await tradesRes.json();
    state.alerts = await alertsRes.json();

    updateStats(stats);
    renderTradersTable();
    updateCharts();
    renderTradesStream();
    renderAlerts();
    renderRecommendations();
    updateAlertBadge();

    showToast('数据已更新', 'success');
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('数据加载失败', 'error');
  } finally {
    hideLoading();
  }
}

async function loadTraderDetail(traderId) {
  try {
    const res = await fetch(`/api/traders/${traderId}`);
    const trader = await res.json();
    state.currentTrader = trader;

    const avatarEl = document.getElementById('traderAvatar');
    if (avatarEl) avatarEl.textContent = (trader.label || 'T')[0].toUpperCase();
    
    const nameEl = document.getElementById('detailTraderName');
    if (nameEl) nameEl.textContent = trader.label || `交易员 #${trader.id}`;
    
    const addrEl = document.getElementById('detailTraderAddress');
    if (addrEl) addrEl.textContent = trader.address;
    
    const detailNameEl = document.getElementById('traderDetailName');
    if (detailNameEl) detailNameEl.textContent = trader.label || `交易员 #${trader.id}`;
    
    const pnlEl = document.getElementById('detailTotalPnl');
    if (pnlEl) {
      pnlEl.textContent = formatCurrency(trader.total_profit_loss);
      pnlEl.className = 'profile-stat-value ' + (trader.total_profit_loss >= 0 ? 'pnl-positive' : 'pnl-negative');
    }
    
    const winRateEl = document.getElementById('detailWinRate');
    if (winRateEl) winRateEl.textContent = `${trader.win_rate?.toFixed(1) || 0}%`;
    
    const tradeCountEl = document.getElementById('detailTradeCount');
    if (tradeCountEl) tradeCountEl.textContent = trader.trade_count || 0;
    
    const avgPnlEl = document.getElementById('detailAvgPnl');
    if (avgPnlEl) avgPnlEl.textContent = formatCurrency(trader.avg_profit_loss);

    renderScoreCard(trader.score);
    updateTraderCharts(trader);
    renderTradesDetail();
  } catch (error) {
    console.error('Failed to load trader detail:', error);
    showToast('加载交易员详情失败', 'error');
  }
}

function renderScoreCard(score) {
  const container = document.getElementById('scoreCard');
  if (!container || !score) return;
  
  container.innerHTML = `
    <div class="score-card ${score.riskLevel.level}">
      <div class="score-header">
        <div class="score-overall">
          <span class="score-number">${score.overall}</span>
          <span class="score-label">AI评分</span>
        </div>
        <div class="risk-badge large ${score.riskLevel.level}">${score.riskLevel.label}</div>
      </div>
      <div class="score-metrics">
        ${Object.entries(score.metrics).map(([key, m]) => `
          <div class="score-metric">
            <div class="metric-label">${getMetricLabel(key)}</div>
            <div class="metric-bar">
              <div class="metric-fill" style="width: ${m.score}%"></div>
            </div>
            <div class="metric-value">${m.description}</div>
          </div>
        `).join('')}
      </div>
      <div class="recommendation ${score.recommendation.action}">
        <strong>${score.recommendation.text}</strong>
        <p>${score.recommendation.reason}</p>
      </div>
    </div>
  `;
}

function getMetricLabel(key) {
  const labels = { winRate: '胜率', profitFactor: '盈亏比', sharpeRatio: '夏普比率', consistency: '稳定性', riskManagement: '风控', activity: '活跃度' };
  return labels[key] || key;
}

function renderRecommendations() {
  const container = document.getElementById('recommendationsList');
  if (!container) return;
  
  if (state.recommendations.length === 0) {
    container.innerHTML = '<p>暂无推荐</p>';
    return;
  }
  
  container.innerHTML = state.recommendations.map(t => `
    <div class="recommendation-card" onclick="viewTraderDetail(${t.id})">
      <div class="rec-header">
        <div class="rec-avatar">${(t.label || 'T')[0].toUpperCase()}</div>
        <div class="rec-info">
          <div class="rec-name">${t.label || '未命名'}</div>
          <div class="rec-pnl ${t.total_profit_loss >= 0 ? 'positive' : 'negative'}">${formatCurrency(t.total_profit_loss)}</div>
        </div>
        <div class="rec-score">
          <span class="rec-score-value">${t.score?.overall || 0}</span>
          <span class="rec-score-label">评分</span>
        </div>
      </div>
      <div class="rec-metrics">
        <span class="rec-metric">胜率 ${t.win_rate?.toFixed(1) || 0}%</span>
        <span class="rec-metric">${t.trade_count || 0} 笔交易</span>
        <span class="risk-badge ${t.score?.riskLevel?.level}">${t.score?.riskLevel?.label}</span>
      </div>
    </div>
  `).join('');
}

// Stats Update
function updateStats(stats) {
  const totalPnl = state.traders.reduce((sum, t) => sum + (t.total_profit_loss || 0), 0);
  const totalTrades = state.traders.reduce((sum, t) => sum + (t.trade_count || 0), 0);
  const bestTrader = state.traders.reduce((best, t) => (t.total_profit_loss || 0) > (best.total_profit_loss || 0) ? t : best, state.traders[0] || {});
  const bestWinRateTrader = state.traders.reduce((best, t) => (t.win_rate || 0) > (best.win_rate || 0) ? t : best, state.traders[0] || {});

  const totalPnlEl = document.getElementById('totalPnl');
  if (totalPnlEl) {
    totalPnlEl.textContent = formatCurrency(totalPnl);
    totalPnlEl.className = 'stat-value ' + (totalPnl >= 0 ? 'positive' : 'negative');
  }
  
  const totalTradesEl = document.getElementById('totalTrades');
  if (totalTradesEl) totalTradesEl.textContent = totalTrades.toLocaleString();
  
  const bestTraderEl = document.getElementById('bestTrader');
  if (bestTraderEl) bestTraderEl.textContent = bestTrader.label || (bestTrader.address ? bestTrader.address.slice(0, 8) + '...' : '-');
  
  const bestWinRateEl = document.getElementById('bestWinRate');
  if (bestWinRateEl) bestWinRateEl.textContent = bestWinRateTrader.win_rate ? `${bestWinRateTrader.win_rate.toFixed(1)}%` : '-';
}

// Charts
function initCharts() {
  const chartIds = ['pnlChart', 'winRateChart', 'categoryChart', 'traderPnlChart', 'positionChart', 'marketChart'];
  chartIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (state.charts[id]) state.charts[id].dispose();
      state.charts[id] = echarts.init(el, state.theme === 'dark' ? 'dark' : null);
    }
  });
  window.addEventListener('resize', () => Object.values(state.charts).forEach(chart => chart?.resize()));
}

function updateCharts() {
  updatePnlChart('7d');
  updateWinRateChart();
  updateCategoryChart();
}

function updatePnlChart(range) {
  const chart = state.charts.pnlChart;
  if (!chart) return;

  const dates = generateDateRange(range);
  const series = state.traders.slice(0, 5).map((trader, index) => ({
    name: trader.label || `交易员 ${index + 1}`,
    type: 'line',
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    data: generatePnlData(dates.length, trader.total_profit_loss || 0),
    lineStyle: { width: 2 }
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
      textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' }
    },
    legend: { data: series.map(s => s.name), textStyle: { color: state.theme === 'dark' ? '#a0a0b0' : '#4a4a5a' }, bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLine: { lineStyle: { color: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8' } },
      axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a' }
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: state.theme === 'dark' ? '#1a1a2e' : '#f0f2f5' } },
      axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a', formatter: value => `$${value.toFixed(0)}` }
    },
    series
  };

  chart.setOption(option, true);
}

function updateWinRateChart() {
  const chart = state.charts.winRateChart;
  if (!chart) return;

  const sortedTraders = [...state.traders].sort((a, b) => (b.win_rate || 0) - (a.win_rate || 0)).slice(0, 10);

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
      textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' },
      formatter: params => `${params[0].name}<br/>胜率: ${params[0].value.toFixed(1)}%`
    },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '3%', containLabel: true },
    xAxis: {
      type: 'value',
      max: 100,
      axisLine: { show: false },
      splitLine: { lineStyle: { color: state.theme === 'dark' ? '#1a1a2e' : '#f0f2f5' } },
      axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a', formatter: '{value}%' }
    },
    yAxis: {
      type: 'category',
      data: sortedTraders.map(t => t.label || t.address?.slice(0, 8) + '...'),
      axisLine: { lineStyle: { color: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8' } },
      axisLabel: { color: state.theme === 'dark' ? '#a0a0b0' : '#4a4a5a' }
    },
    series: [{
      type: 'bar',
      data: sortedTraders.map(t => ({
        value: t.win_rate || 0,
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#00d4ff' }, { offset: 1, color: '#00ff88' }]) }
      })),
      barWidth: '60%',
      itemStyle: { borderRadius: [0, 4, 4, 0] }
    }]
  };

  chart.setOption(option, true);
}

function updateCategoryChart() {
  const chart = state.charts.categoryChart;
  if (!chart) return;

  const categories = [
    { name: '政治/选举', value: 35, color: '#00d4ff' },
    { name: '加密货币', value: 28, color: '#00ff88' },
    { name: '体育竞技', value: 20, color: '#ffa502' },
    { name: '科技', value: 12, color: '#b829dd' },
    { name: '其他', value: 5, color: '#6a6a80' }
  ];

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
      textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' },
      formatter: params => `${params.name}<br/>${params.value}%`
    },
    legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: state.theme === 'dark' ? '#a0a0b0' : '#4a4a5a' } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['40%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 8, borderColor: state.theme === 'dark' ? '#1a1a2e' : '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold', color: state.theme === 'dark' ? '#fff' : '#1a1a2e' } },
      data: categories.map(c => ({ name: c.name, value: c.value, itemStyle: { color: c.color } }))
    }]
  };

  chart.setOption(option, true);
}

function updateTraderCharts(trader) {
  const pnlChart = state.charts.traderPnlChart;
  if (pnlChart) {
    const dates = generateDateRange('30d');
    const data = generatePnlData(dates.length, trader.total_profit_loss || 0);
    
    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
        textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8' } },
        axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a' }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: state.theme === 'dark' ? '#1a1a2e' : '#f0f2f5' } },
        axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a', formatter: value => `$${value.toFixed(0)}` }
      },
      series: [{
        type: 'line',
        smooth: true,
        data: data,
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0, 212, 255, 0.3)' }, { offset: 1, color: 'rgba(0, 212, 255, 0.05)' }]) },
        lineStyle: { color: '#00d4ff', width: 2 },
        itemStyle: { color: '#00d4ff' }
      }]
    };
    
    pnlChart.setOption(option, true);
  }

  const positionChart = state.charts.positionChart;
  if (positionChart) {
    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
        textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' }
      },
      series: [{
        type: 'pie',
        radius: '70%',
        data: [
          { value: 40, name: '政治', itemStyle: { color: '#00d4ff' } },
          { value: 30, name: '加密', itemStyle: { color: '#00ff88' } },
          { value: 20, name: '体育', itemStyle: { color: '#ffa502' } },
          { value: 10, name: '其他', itemStyle: { color: '#6a6a80' } }
        ],
        label: { color: state.theme === 'dark' ? '#a0a0b0' : '#4a4a5a' }
      }]
    };
    positionChart.setOption(option, true);
  }

  const marketChart = state.charts.marketChart;
  if (marketChart) {
    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: state.theme === 'dark' ? 'rgba(20, 20, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        borderColor: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8',
        textStyle: { color: state.theme === 'dark' ? '#fff' : '#1a1a2e' }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: ['市场A', '市场B', '市场C', '市场D', '市场E'],
        axisLine: { lineStyle: { color: state.theme === 'dark' ? '#2a2a40' : '#e0e0e8' } },
        axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a' }
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: state.theme === 'dark' ? '#1a1a2e' : '#f0f2f5' } },
        axisLabel: { color: state.theme === 'dark' ? '#6a6a80' : '#8a8a9a' }
      },
      series: [{
        type: 'bar',
        data: [120, 200, 150, 80, 70],
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#b829dd' }, { offset: 1, color: '#00d4ff' }]),
          borderRadius: [4, 4, 0, 0]
        }
      }]
    };
    marketChart.setOption(option, true);
  }
}

// Table Rendering
function renderTradersTable() {
  const tbody = document.getElementById('tradersTableBody');
  if (!tbody) return;

  let filtered = [...state.traders];
  
  const searchTerm = document.getElementById('traderSearch')?.value.toLowerCase();
  if (searchTerm) {
    filtered = filtered.filter(t => 
      (t.label && t.label.toLowerCase().includes(searchTerm)) ||
      (t.address && t.address.toLowerCase().includes(searchTerm))
    );
  }

  filtered.sort((a, b) => {
    const getValue = (obj, path) => path.split('.').reduce((o, p) => o?.[p], obj);
    const aVal = getValue(a, state.sort.field) || 0;
    const bVal = getValue(b, state.sort.field) || 0;
    return state.sort.order === 'asc' ? aVal - bVal : bVal - aVal;
  });

  state.pagination.traders.total = filtered.length;
  const { page, limit } = state.pagination.traders;
  const start = (page - 1) * limit;
  const paginated = filtered.slice(start, start + limit);

  tbody.innerHTML = paginated.map(trader => `
    <tr>
      <td>
        <div class="trader-cell">
          <div class="trader-avatar">${(trader.label || 'T')[0].toUpperCase()}</div>
          <div class="trader-info">
            <span class="trader-name">${trader.label || '未命名'}</span>
            <span class="trader-address">${trader.address ? trader.address.slice(0, 12) + '...' : '-'}</span>
          </div>
          ${trader.score ? `<div class="risk-badge ${trader.score.riskLevel.level}">${trader.score.riskLevel.label}</div>` : ''}
        </div>
      </td>
      <td class="${trader.total_profit_loss >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatCurrency(trader.total_profit_loss)}</td>
      <td>
        <div class="win-rate">
          <span>${trader.win_rate?.toFixed(1) || 0}%</span>
          <div class="win-rate-bar">
            <div class="win-rate-fill ${trader.win_rate < 40 ? 'low' : trader.win_rate < 60 ? 'medium' : ''}" style="width: ${Math.min(trader.win_rate || 0, 100)}%"></div>
          </div>
        </div>
      </td>
      <td>${trader.trade_count || 0}</td>
      <td class="${trader.avg_profit_loss >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatCurrency(trader.avg_profit_loss)}</td>
      <td>
        ${trader.score ? `
          <div class="score-badge" title="AI评分: ${trader.score.overall}">
            <span class="score-value">${trader.score.overall}</span>
            <span class="score-stars">${'★'.repeat(trader.score.rank.stars)}</span>
          </div>
        ` : '-'}
      </td>
      <td><button class="action-btn" onclick="viewTraderDetail(${trader.id})">查看</button></td>
    </tr>
  `).join('');

  updatePagination('traders');
}

function renderTradesDetail() {
  const tbody = document.getElementById('tradesDetailBody');
  if (!tbody || !state.currentTrader) return;

  let trades = state.currentTrader.trades || [];
  
  if (state.filter !== 'all') {
    trades = trades.filter(t => t.side?.toLowerCase() === state.filter);
  }

  state.pagination.trades.total = trades.length;
  const { page, limit } = state.pagination.trades;
  const start = (page - 1) * limit;
  const paginated = trades.slice(start, start + limit);

  tbody.innerHTML = paginated.map(trade => `
    <tr>
      <td>${formatDate(trade.timestamp)}</td>
      <td>${trade.asset || 'Unknown'}</td>
      <td><span class="trade-side ${trade.side?.toLowerCase()}">${trade.side || '-'}</span></td>
      <td>${formatCurrency(trade.amount_in || trade.amount_out)}</td>
      <td class="${trade.profit_loss >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatCurrency(trade.profit_loss)}</td>
      <td><a href="https://polygonscan.com/tx/${trade.tx_hash}" target="_blank" class="tx-link">${trade.tx_hash ? trade.tx_hash.slice(0, 10) + '...' : '-'}</a></td>
    </tr>
  `).join('');

  updatePagination('trades', 'detail');
}

function updatePagination(type, prefix = '') {
  const infoEl = document.getElementById(`${prefix}${prefix ? 'PaginationInfo' : 'paginationInfo'}`);
  const controlsEl = document.getElementById(`${prefix}${prefix ? 'PaginationControls' : 'paginationControls'}`);
  
  if (!infoEl || !controlsEl) return;

  const { page, limit, total } = state.pagination[type];
  const totalPages = Math.ceil(total / limit);
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  infoEl.textContent = `显示 ${start}-${end} 共 ${total} 条`;

  let buttons = `<button class="page-btn" onclick="changePage('${type}', ${page - 1})" ${page === 1 ? 'disabled' : ''}>上一页</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      buttons += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="changePage('${type}', ${i})">${i}</button>`;
    } else if (i === page - 2 || i === page + 2) {
      buttons += `<span style="color: var(--text-muted);">...</span>`;
    }
  }

  buttons += `<button class="page-btn" onclick="changePage('${type}', ${page + 1})" ${page === totalPages || totalPages === 0 ? 'disabled' : ''}>下一页</button>`;

  controlsEl.innerHTML = buttons;
}

function changePage(type, page) {
  const totalPages = Math.ceil(state.pagination[type].total / state.pagination[type].limit);
  if (page < 1 || page > totalPages) return;
  
  state.pagination[type].page = page;
  
  if (type === 'traders') renderTradersTable();
  else if (type === 'trades') renderTradesDetail();
}

function viewTraderDetail(traderId) {
  navigateTo('trader-detail', { traderId });
}

// Live Trades Stream
function renderTradesStream() {
  const container = document.getElementById('tradesStream');
  if (!container) return;

  const trades = state.trades.slice(0, 10);
  
  container.innerHTML = trades.map(trade => `
    <div class="trade-item ${trade.side?.toLowerCase()}">
      <div class="trade-avatar">${(trade.trader_label || 'T')[0].toUpperCase()}</div>
      <div class="trade-info">
        <div class="trade-trader">${trade.trader_label || 'Unknown'}</div>
        <div class="trade-market" title="${trade.asset || 'Unknown'}">${trade.asset || 'Unknown'}</div>
      </div>
      <div class="trade-details">
        <span class="trade-side ${trade.side?.toLowerCase()}">${trade.side || '-'}</span>
        <span class="trade-amount">${formatCurrency(trade.amount_in || trade.amount_out)}</span>
        <span class="trade-time">${timeAgo(trade.timestamp)}</span>
      </div>
    </div>
  `).join('');
}

// Alerts
function renderAlerts() {
  const container = document.getElementById('alertsList');
  const countEl = document.getElementById('alertCount');
  if (!container || !countEl) return;

  countEl.textContent = state.alerts.length;

  if (state.alerts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <div class="empty-state-title">暂无告警</div>
        <p>所有指标正常</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.alerts.slice(0, 5).map(alert => `
    <div class="alert-item ${alert.type}">
      <div class="alert-icon">${alert.icon}</div>
      <div class="alert-content">
        <div class="alert-title">${alert.title}</div>
        <div class="alert-desc">${alert.description}</div>
      </div>
      <div class="alert-time">${timeAgo(alert.timestamp)}</div>
    </div>
  `).join('');
}

function renderAlertsPage() {
  const container = document.getElementById('alertsPageList');
  if (!container) return;

  if (state.alerts.length === 0) {
    container.innerHTML = '<p>暂无告警</p>';
    return;
  }

  container.innerHTML = state.alerts.map(alert => `
    <div class="alert-item ${alert.type} ${alert.acknowledged ? 'acknowledged' : ''}">
      <div class="alert-icon">${alert.icon}</div>
      <div class="alert-content">
        <div class="alert-title">${alert.title}</div>
        <div class="alert-desc">${alert.description}</div>
        <div class="alert-meta">${formatDate(alert.timestamp)}</div>
      </div>
      ${!alert.acknowledged ? `<button class="btn-ack" onclick="acknowledgeAlert('${alert.id}')">确认</button>` : ''}
    </div>
  `).join('');
}

function updateAlertBadge() {
  const badge = document.getElementById('alertBadge');
  if (badge) {
    const activeAlerts = state.alerts.filter(a => !a.acknowledged).length;
    badge.textContent = activeAlerts;
    badge.style.display = activeAlerts > 0 ? 'block' : 'none';
    
    if (activeAlerts > 0) {
      badge.classList.add('pulse');
      playAlertSound();
    }
  }
}

function playAlertSound() {
  const sound = document.getElementById('alertSound');
  if (sound && !sound.muted) {
    sound.play().catch(() => {});
  }
}

async function acknowledgeAlert(alertId) {
  try {
    await fetch(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
    await loadAlerts();
    renderAlertsPage();
  } catch (error) {
    console.error('Failed to acknowledge alert:', error);
  }
}

// Auto Refresh
function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);

  if (state.refreshInterval > 0) {
    document.getElementById('refreshIndicator')?.classList.remove('paused');
    state.refreshTimer = setInterval(() => loadData(), state.refreshInterval * 1000);
  } else {
    document.getElementById('refreshIndicator')?.classList.add('paused');
  }
}

// WebSocket
function connectWebSocket() {
  const ws = new WebSocket(`ws://${window.location.host}/ws`);
  
  ws.onopen = () => console.log('WebSocket connected');
  
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'new_trade') {
      state.trades.unshift(data.trade);
      state.trades = state.trades.slice(0, 20);
      renderTradesStream();
      showToast('新交易信号', 'info');
    } else if (data.type === 'alerts') {
      state.alerts = [...data.alerts, ...state.alerts].slice(0, 100);
      renderAlerts();
      updateAlertBadge();
      showToast('新告警', 'warning');
    }
  };
  
  ws.onclose = () => setTimeout(connectWebSocket, 5000);
  ws.onerror = (error) => console.error('WebSocket error:', error);
}

// Export Functions
function exportToCSV() {
  const headers = ['ID', 'Label', 'Address', 'Total PnL', 'Win Rate', 'Trade Count', 'Avg PnL', 'AI Score', 'Risk Level'];
  const rows = state.traders.map(t => [
    t.id, t.label || '', t.address, t.total_profit_loss || 0, t.win_rate?.toFixed(2) || 0,
    t.trade_count || 0, t.avg_profit_loss?.toFixed(2) || 0, t.score?.overall || 0, t.score?.riskLevel?.label || ''
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `traders_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV导出成功', 'success');
}

async function exportToExcel() {
  try {
    const res = await fetch('/api/export/excel');
    const data = await res.json();
    
    // Create XLSX content
    let xlsx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xlsx += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">\n';
    
    Object.entries(data.sheets).forEach(([sheetName, rows]) => {
      xlsx += `<Worksheet ss:Name="${sheetName}">\n<Table>\n`;
      if (rows.length > 0) {
        xlsx += '<Row>' + Object.keys(rows[0]).map(k => `<Cell><Data ss:Type="String">${k}</Data></Cell>`).join('') + '</Row>\n';
        rows.forEach(row => {
          xlsx += '<Row>' + Object.values(row).map(v => {
            const type = typeof v === 'number' ? 'Number' : 'String';
            return `<Cell><Data ss:Type="${type}">${v}</Data></Cell>`;
          }).join('') + '</Row>\n';
        });
      }
      xlsx += '</Table>\n</Worksheet>\n';
    });
    
    xlsx += '</Workbook>';
    
    const blob = new Blob([xlsx], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `copytrade_report_${new Date().toISOString().split('T')[0]}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Excel导出成功', 'success');
  } catch (error) {
    console.error('Export failed:', error);
    showToast('导出失败', 'error');
  }
}

// Utilities
function formatCurrency(value) {
  if (value === null || value === undefined) return '-';
  const num = parseFloat(value);
  const prefix = num >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(timestamp) {
  if (!timestamp) return '-';
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
  return `${Math.floor(seconds / 86400)}天前`;
}

function generateDateRange(range) {
  const dates = [];
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 30;
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }));
  }
  return dates;
}

function generatePnlData(count, finalValue) {
  const data = [];
  let current = 0;
  const step = finalValue / count;
  for (let i = 0; i < count; i++) {
    current += step + (Math.random() - 0.5) * Math.abs(step) * 0.5;
    data.push(Math.round(current * 100) / 100);
  }
  return data;
}

function updateSortIcons() {
  document.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sort.field) {
      th.classList.add(state.sort.order === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function debounce(fn, ms) {
  let timeout;
  return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), ms); };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span><span>${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showLoading() {
  document.body.classList.add('loading');
}

function hideLoading() {
  document.body.classList.remove('loading');
}

function showModal(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body">${content}</div>
    </div>
  `;
  document.body.appendChild(modal);
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(m => m.remove());
}

// Expose functions to global scope
window.viewTraderDetail = viewTraderDetail;
window.changePage = changePage;
window.acknowledgeAlert = acknowledgeAlert;
