// frontend/src/pages/Dashboard.jsx
// Line 1-10 (approximately):
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';

import useAuthStore from '../store/authStore';
import useTradingStore from '../store/tradingStore';
import useMarketStore from '../store/marketStore';
import useWatchlistStore from '../store/watchlistStore';
import useSettingsStore from '../store/settingsStore';
import AdminPanelPage from '../pages/AdminPanel';
import AdminWithdrawals from '../components/admin/AdminWithdrawals';

import socketService from '../services/socket';
import api from '../services/api';

import {
  Search,
  TrendingUp,
  TrendingDown,
  BarChart2,
  List,
  Clock,
  Star,
  Plus,
  Wallet as WalletIcon,
  ChevronDown,
  ChevronUp,
  Settings,
  LogOut,
  RefreshCw,
  Trash2,
  Edit3,
  X,
  Crosshair,
  Maximize2,
  Minimize2,
  MessageSquare,
  Bell,
  Info,
  User,
  Eye,
  EyeOff,
  UserPlus,
  Users,
  ArrowRightLeft,
  DollarSign,
  Percent,
  AlertTriangle,
  Lock,
  FolderPlus,
  MoreVertical,
  CalendarDays,
  Download,
} from 'lucide-react';

import PriceChart from '../components/charts/PriceChart';
import WalletPage from '../components/account/Wallet';
import AdminUsers from '../components/admin/AdminUsers';
import AdminPanel from '../components/admin/AdminPanel';
import { exportDealsPdf } from '../utils/dealsPdfExport';

// Desktop components
import DesktopTerminal from '../components/mt5/DesktopTerminal';
import MarketWatchPanel from '../components/mt5/MarketWatchPanel';
import NavigatorPanel from '../components/mt5/NavigatorPanel';
import ChartWorkspace from '../components/mt5/ChartWorkspace';
import OrderDockPanel from '../components/mt5/OrderDockPanel';
import ToolboxPanel from '../components/mt5/ToolboxPanel';

// ============ CONSTANTS ============
const TIMEFRAMES = [
  { id: 'M1', label: 'M1', value: '1m' },
  { id: 'M5', label: 'M5', value: '5m' },
  { id: 'M15', label: 'M15', value: '15m' },
  { id: 'M30', label: 'M30', value: '30m' },
  { id: 'H1', label: 'H1', value: '1h' },
  { id: 'H4', label: 'H4', value: '4h' },
  { id: 'D1', label: 'D1', value: '1d' },
  { id: 'W1', label: 'W1', value: '1w' },
  { id: 'MN', label: 'MN', value: '1M' },
];

const CHART_TYPES = [
  { id: 'candles', label: 'Candles' },
  { id: 'bars', label: 'Bars' },
  { id: 'line', label: 'Line' },
];

const SYMBOL_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'index_futures', label: 'Index Futures' },
  { id: 'stock_futures', label: 'Stock Futures' },
  { id: 'commodity_futures', label: 'Commodities' },
];

const HISTORY_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last Week' },
  { id: 'month', label: 'Last Month' },
  { id: '3months', label: 'Last 3 Months' },
];

const QUOTE_STALE_THRESHOLD_MS = 15000;
const DASHBOARD_TABS = new Set([
  'trade',
  'quotes',
  'chart',
  'history',
  'messages',
  'wallet',
  'settings',
  'admin',
]);

const normalizeDashboardTab = (value) => {
  const candidate = String(value || '').toLowerCase();
  return DASHBOARD_TABS.has(candidate) ? candidate : 'trade';
};

const getDashboardTabFromLocation = () => {
  if (typeof window === 'undefined') return 'trade';
  return normalizeDashboardTab(new URL(window.location.href).searchParams.get('tab'));
};

const syncDashboardTabHistory = (tab, replace = false) => {
  if (typeof window === 'undefined') return;

  const normalizedTab = normalizeDashboardTab(tab);
  const url = new URL(window.location.href);

  if (!replace && url.searchParams.get('tab') === normalizedTab) {
    return;
  }

  url.searchParams.set('tab', normalizedTab);
  const nextState = { ...(window.history.state || {}), dashboardTab: normalizedTab };

  if (replace) {
    window.history.replaceState(nextState, '', url);
    return;
  }

  window.history.pushState(nextState, '', url);
};

// ============ CATEGORY HELPERS ============
const norm = (v) => String(v || '').toLowerCase().trim();

const inferIndianCategory = (sym) => {
  const c = norm(sym.category);
  const seg = norm(sym.segment);
  const inst = norm(sym.instrument_type);
  const name = norm(sym.display_name);
  const s = String(sym.symbol || '').toUpperCase();

  const looksLikeIndex =
    /NIFTY|SENSEX|BANKNIFTY|FINNIFTY|MIDCPNIFTY/i.test(s) ||
    c.includes('index') ||
    c.includes('indices') ||
    seg.includes('index') ||
    inst.includes('index') ||
    name.includes('nifty') ||
    name.includes('sensex');

  if (looksLikeIndex) return 'indices';

  const looksLikeEtf =
    c === 'etf' || seg === 'etf' || inst === 'etf' || name.includes('etf');
  if (looksLikeEtf) return 'etf';

  const looksLikeFno =
    c.includes('future') ||
    c.includes('option') ||
    c === 'fno' ||
    seg.includes('f&o') ||
    seg.includes('derivative') ||
    /FUT$/.test(s) ||
    /(CE|PE)$/.test(s);

  if (looksLikeFno) return 'fno';

  return 'equity';
};

const matchesSelectedCategory = (sym, selectedCategory) => {
  if (selectedCategory === 'all') return true;
  return inferIndianCategory(sym) === selectedCategory;
};

const getPeriodStart = (periodId) => {
  const now = new Date();
  const d = new Date(now);

  switch (periodId) {
    case 'today':
      d.setHours(0, 0, 0, 0);
      return d;
    case 'week':
      d.setDate(d.getDate() - 7);
      return d;
    case 'month':
      d.setMonth(d.getMonth() - 1);
      return d;
    case '3months':
      d.setMonth(d.getMonth() - 3);
      return d;
    case '6months':
      d.setMonth(d.getMonth() - 6);
      return d;
    case 'year':
      d.setFullYear(d.getFullYear() - 1);
      return d;
    default:
      return null;
  }
};

const formatINR = (amount) => {
  const num = Number(amount || 0);
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ============ DISPLAY SYMBOL FORMATTER ============
// Converts raw symbol like "HDFCBANK-I" to "HDFCBANK-MAR" format
const formatDisplaySymbol = (rawSymbol, allSyms) => {
  if (!rawSymbol) return '—';
  // Try to find the symbol in our known symbols list to get expiry
  const symData = (allSyms || []).find((s) => s.symbol === rawSymbol);
  if (symData && symData.expiry_date) {
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const d = new Date(symData.expiry_date);
    const monthAbbr = months[d.getMonth()] || '';
    const base = (symData.underlying || rawSymbol)
      .toUpperCase()
      .replace(/\d{2}[A-Z]{3}FUT$/i, '')
      .replace(/FUT$/i, '')
      .replace(/-I+$/, '')
      .replace(/-$/, '');
    return `${base}-${monthAbbr}`;
  }
  // Fallback: just clean up the -I suffix
  return rawSymbol.replace(/-I+$/, '').replace(/FUT$/i, '');
};

const normalizeLiveUnderlyingKey = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/-[IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

const findScrollableParent = (element) => {
  let node = element;

  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      const isScrollable = overflowY === 'auto' || overflowY === 'scroll';

      if (isScrollable && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }

    node = node.parentElement;
  }

  return null;
};

const getSeriesPriority = (series = '') => {
  const value = String(series || '').toUpperCase();
  if (value === 'I') return 0;
  if (value === 'II') return 1;
  if (value === 'III') return 2;
  if (!value) return 3;
  return 4;
};

const getUpcomingLiveContractRows = (rows = [], now = new Date(), maxContracts = 2) => {
  if (!rows.length) return [];

  const today = now.toISOString().slice(0, 10);

  const sorted = [...rows].sort((a, b) => {
    const aExpiry = String(a?.expiry_date || '9999-12-31');
    const bExpiry = String(b?.expiry_date || '9999-12-31');
    if (aExpiry !== bExpiry) return aExpiry.localeCompare(bExpiry);

    const aPriority = getSeriesPriority(a?.series);
    const bPriority = getSeriesPriority(b?.series);
    if (aPriority !== bPriority) return aPriority - bPriority;

    return String(a?.symbol || '').localeCompare(String(b?.symbol || ''));
  });

  const upcoming = sorted.filter((row) => !row?.expiry_date || String(row.expiry_date) >= today);
  const sourceRows = upcoming.length > 0 ? upcoming : sorted;
  const targetCount = Math.max(1, maxContracts);
  const selectedRows = [];
  const seenExpiryKeys = new Set();

  for (const row of sourceRows) {
    const expiryKey = String(row?.expiry_date || row?.kite_instrument_token || row?.symbol || '');
    if (seenExpiryKeys.has(expiryKey)) continue;

    selectedRows.push(row);
    seenExpiryKeys.add(expiryKey);

    if (selectedRows.length >= targetCount) break;
  }

  return selectedRows;
};

const pickLiveContractRows = (symbolsList = []) => {
  const rowsByUnderlying = new Map();

  for (const row of symbolsList) {
    const key = normalizeLiveUnderlyingKey(row?.underlying || row?.symbol);
    if (!key) continue;
    if (!rowsByUnderlying.has(key)) rowsByUnderlying.set(key, []);
    rowsByUnderlying.get(key).push(row);
  }

  const now = new Date();
  const preferredVisibleContracts = now.getDate() >= 20 ? 2 : 1;
  const picked = [];

  for (const rows of rowsByUnderlying.values()) {
    const visibleRows = getUpcomingLiveContractRows(rows, now, preferredVisibleContracts);
    if (visibleRows.length > 0) {
      picked.push(...visibleRows);
    }
  }

  return picked.sort((a, b) => {
    const aUnderlying = String(a?.underlying || a?.symbol || '');
    const bUnderlying = String(b?.underlying || b?.symbol || '');
    if (aUnderlying !== bUnderlying) return aUnderlying.localeCompare(bUnderlying);

    const aExpiry = String(a?.expiry_date || '9999-12-31');
    const bExpiry = String(b?.expiry_date || '9999-12-31');
    if (aExpiry !== bExpiry) return aExpiry.localeCompare(bExpiry);

    return String(a?.symbol || '').localeCompare(String(b?.symbol || ''));
  });
};

const inferHistoryOriginalQuantity = (trade) => {
  const explicit = Number(trade?.original_quantity);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  const comment = String(trade?.comment || '');
  const partialMatch = comment.match(/partial close:\s*([\d.]+)\s+of\s+([\d.]+)/i);
  if (partialMatch) {
    const parsed = Number(partialMatch[2]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return Number(trade?.quantity || 0);
};

const buildHistoryPositionGroups = (closedTrades = []) => {
  const groups = new Map();

  (closedTrades || []).forEach((trade) => {
    const symbol = String(trade.symbol || '').toUpperCase();
    if (!symbol) return;

    const rawOpenTime = trade.open_time || trade.created_at || trade.updated_at || '';
    const openDate = rawOpenTime ? new Date(rawOpenTime) : null;
    const openKey =
      openDate && !Number.isNaN(openDate.getTime())
        ? openDate.toISOString()
        : `${symbol}-${trade.id || 'unknown'}`;

    const key = `${symbol}::${trade.trade_type || ''}::${openKey}`;

    if (!groups.has(key)) {
      groups.set(key, {
        id: trade.id || key,
        symbol,
        tradeType: String(trade.trade_type || '').toLowerCase(),
        openTime: rawOpenTime || null,
        latestCloseTime: trade.close_time || trade.closeTime || null,
        openQuantity: 0,
        closedQuantity: 0,
        openPrice: 0,
        closeValue: 0,
        totalProfit: 0,
        totalCommission: 0,
        trades: [],
      });
    }

    const group = groups.get(key);
    const closedQty = Number(trade.quantity || 0);
    const openQty = inferHistoryOriginalQuantity(trade);
    const openPrice = Number(trade.open_price || 0);
    const closePrice = Number(trade.close_price || 0);
    const closeTime = trade.close_time || trade.closeTime || null;

    group.openQuantity = Math.max(group.openQuantity, openQty);
    group.closedQuantity += closedQty;
    if (!group.openPrice && openPrice > 0) group.openPrice = openPrice;
    group.closeValue += closePrice * closedQty;
    group.totalProfit += Number(trade.profit || 0);
    group.totalCommission += Number(trade.brokerage || 0);
    if (
      closeTime &&
      (!group.latestCloseTime || new Date(closeTime) > new Date(group.latestCloseTime))
    ) {
      group.latestCloseTime = closeTime;
    }
    group.trades.push(trade);
  });

  return Array.from(groups.values())
    .map((group) => {
      const avgClosePrice =
        group.closedQuantity > 0 ? group.closeValue / group.closedQuantity : 0;
      const isLong = group.tradeType !== 'sell';
      const buyQty = isLong ? group.openQuantity : group.closedQuantity;
      const sellQty = isLong ? group.closedQuantity : group.openQuantity;
      const remainingQty = Math.max(group.openQuantity - group.closedQuantity, 0);

      return {
        ...group,
        buyQty,
        sellQty,
        buyPrice: isLong ? group.openPrice : avgClosePrice,
        sellPrice: isLong ? avgClosePrice : group.openPrice,
        remainingQty,
        tradeCount: group.trades.length,
        totalProfit: Number(group.totalProfit.toFixed(2)),
        totalCommission: Number(group.totalCommission.toFixed(2)),
        trades: [...group.trades].sort(
          (a, b) =>
            new Date(b.close_time || b.closeTime || 0) -
            new Date(a.close_time || a.closeTime || 0)
        ),
      };
    })
    .sort(
      (a, b) => new Date(b.latestCloseTime || 0) - new Date(a.latestCloseTime || 0)
    );
};
// ============ MARKET HOURS CHECK (frontend) ============
const isMarketOpenNow = (symbol = null) => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();

  // Check if the symbol belongs to commodity (MCX) segment
  if (symbol) {
    const sym = String(symbol).toUpperCase();
    const isCommodity =
      /GOLD|SILVER|SILVERM|SILVERMIC|GOLDM|GOLDGUINEA|GOLDPETAL|CRUDE|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL|COTTON|MCX/i.test(sym);
    if (isCommodity) {
      // MCX commodity market: 9:00 AM to 11:30 PM IST (Mon-Fri)
      return mins >= 9 * 60 && mins <= 23 * 60 + 30;
    }
  }

  // Default: Equity/Index market 9:15 AM to 3:30 PM IST
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

// ============ DASHBOARD COMPONENT ============
const Dashboard = () => {
  const {
    user,
    accounts,
    setAccounts,
    logout,
    savedAccounts,
    addAccount,
    switchToAccount,
    removeSavedAccount,
    getMaxSavedAccounts,
  } = useAuthStore();

  const isAdmin = (user?.role || '').toLowerCase() === 'admin';

  const {
    openTrades,
    pendingOrders,
    pendingOrderHistory,
    tradeHistory,
    deals,
    dealsSummary,
    fetchOpenTrades,
    fetchPendingOrders,
    fetchPendingOrderHistory,
    fetchTradeHistory,
    fetchDeals,
    placeOrder,
    closeTrade,
    cancelOrder,
    updateTradePnL,
    updateTradesPnLBatch,
  } = useTradingStore();

  const { symbols, quotes, refreshSymbols, getQuote, updatePrice } = useMarketStore();

  const {
    watchlists,
    activeWatchlistId,
    activeSymbols,
    setActiveWatchlistId,
    fetchWatchlists,
    createWatchlist,
    fetchWatchlistSymbols,
    addSymbol,
    removeSymbol,
    deleteWatchlist,
    renameWatchlist,
  } = useWatchlistStore();

  // ── All-symbols state (lifted from old QuotesTab) ──
  const [allFuturesSymbols, setAllFuturesSymbols] = useState([]);
  const [loadingAllSymbols, setLoadingAllSymbols] = useState(false);
  const [symbolsLoaded, setSymbolsLoaded] = useState(false);
  const symbolsFetchedRef = useRef(false);
  const quotesSearchInputRef = useRef(null);
  const refreshingRef = useRef(false);
  const mobilePullRef = useRef({ startY: 0, eligible: false, triggered: false });

  // Theme
  const theme = useSettingsStore((s) => s.interface.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);

  // ── Core state ──
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [symbolData, setSymbolData] = useState(null);
  const [marketStatus, setMarketStatus] = useState({
    isHoliday: false,
    message: '',
    marketOpen: true,
  });

  // Mobile tabs
  const [activeTab, setActiveTabState] = useState(() => getDashboardTabFromLocation());
  const setActiveTab = useCallback((nextTab, options = {}) => {
    const normalizedTab = normalizeDashboardTab(nextTab);
    setActiveTabState(normalizedTab);
    syncDashboardTabHistory(normalizedTab, options.replace === true);
  }, []);

  // Wallet intent
  const [walletIntent, setWalletIntent] = useState('deposit');

  // Quotes
  const [quotesViewMode, setQuotesViewMode] = useState('advanced');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const visibleQuoteSubscriptionsRef = useRef(new Set());

  // Watchlist dropdown
  const [isWatchlistDropdownOpen, setIsWatchlistDropdownOpen] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState(null);
  const [editingWatchlistName, setEditingWatchlistName] = useState('');
  const [showWatchlistCreateModal, setShowWatchlistCreateModal] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [watchlistCreateLoading, setWatchlistCreateLoading] = useState(false);
  const watchlistDropdownRef = useRef(null);

  // Chart
  const [chartMode, setChartMode] = useState('candles');
  const [timeframe, setTimeframe] = useState('15m');
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const [chartFullscreen, setChartFullscreen] = useState(false);

  // Trade
  const [orderType, setOrderType] = useState('market');
  const [quantity, setQuantity] = useState(1);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [tradeTabSection, setTradeTabSection] = useState('positions');
  // const [modifyModal, setModifyModal] = useState(null);
  const [expandedTradeId, setExpandedTradeId] = useState(null);
  const [closeConfirmTrade, setCloseConfirmTrade] = useState(null);
  const [partialCloseQty, setPartialCloseQty] = useState('');

  // Order symbol search
  const [orderSymbolSearch, setOrderSymbolSearch] = useState('');

  // Full-screen order confirmation overlay
  const [orderConfirmation, setOrderConfirmation] = useState(null);

  // History
  const [historyPeriod, setHistoryPeriod] = useState('today');
  const [historyViewMode, setHistoryViewMode] = useState('positions');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [historySymbolFilter, setHistorySymbolFilter] = useState('');
  const [isHistoryDropdownOpen, setIsHistoryDropdownOpen] = useState(false);

  // Messages
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageCategory, setMessageCategory] = useState('all');

  // Add Account Modal
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [changePassCurrent, setChangePassCurrent] = useState('');
  const [changePassNew, setChangePassNew] = useState('');
  const [changePassConfirm, setChangePassConfirm] = useState('');
  const [changePassLoading, setChangePassLoading] = useState(false);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  const [addAccountEmail, setAddAccountEmail] = useState('');
  const [addAccountPassword, setAddAccountPassword] = useState('');
  const [addAccountLoading, setAddAccountLoading] = useState(false);

  // Socket init
  const socketInitializedRef = useRef(false);
  const closingMode = user?.closingMode || false;

  // ── LIFTED from QuotesTab ──
  const [quotesLocalSearch, setQuotesLocalSearch] = useState('');
  const [showWatchlistMenu, setShowWatchlistMenu] = useState(false);
  const [showSymbolActionMenu, setShowSymbolActionMenu] = useState(false);
  const [selectedSymbolForAction, setSelectedSymbolForAction] = useState(null);

  // ── LIFTED from ModifyPositionModal ──
  const [modifyTab, setModifyTab] = useState('sltp');
  const [addQty, setAddQty] = useState(1);
  const [addQtyLoading, setAddQtyLoading] = useState(false);

  // ── LIFTED from HistoryTab ──
  const [historyLocalSymbolFilter, setHistoryLocalSymbolFilter] = useState('');
  const [showHistorySymbolDropdown, setShowHistorySymbolDropdown] = useState(false);
  const historyDropdownRef = useRef(null);
  const [expandedHistoryPositionId, setExpandedHistoryPositionId] = useState(null);

  // ── LIFTED from CloseConfirmModal ──
  const [closeQty, setCloseQty] = useState(1);
  // ── Staleness ticker — re-renders every 5s to update grey/off-quotes status ──
  const [staleTick, setStaleTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setStaleTick((v) => v + 1), 5000);
    return () => clearInterval(interval);
  }, []);
  const [isPartialClose, setIsPartialClose] = useState(false);

  // ── Refresh state ──
  const [isRefreshing, setIsRefreshing] = useState(false);

    // ── Modify Pending Order Modal ──
  const [modifyPendingModal, setModifyPendingModal] = useState(null);
  const [modifyPendingPrice, setModifyPendingPrice] = useState('');
  const [modifyPendingSL, setModifyPendingSL] = useState('');
  const [modifyPendingTP, setModifyPendingTP] = useState('');

  // ──────────────────────────────────────
  //  EFFECTS
  // ──────────────────────────────────────

  // ── Debounced search ──
  // ── Debounced search + backend fallback ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(quotesLocalSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [quotesLocalSearch]);

  // // ── Backend search when user types a search term ──
  // useEffect(() => {
  //   if (backendSearchTimerRef.current) clearTimeout(backendSearchTimerRef.current);

  //   if (!searchTerm || searchTerm.trim().length < 2) {
  //     setBackendSearchResults([]);
  //     setBackendSearchLoading(false);
  //     return;
  //   }

  //   setBackendSearchLoading(true);

  //   backendSearchTimerRef.current = setTimeout(async () => {
  //     try {
  //       const res = await api.get('/market/search', {
  //         params: { q: searchTerm.trim(), limit: 100 },
  //       });
  //       if (res.data.success && res.data.symbols) {
  //         setBackendSearchResults(res.data.symbols);
  //         console.log(`🔍 Backend search "${searchTerm}": ${res.data.symbols.length} results`);
  //       } else {
  //         setBackendSearchResults([]);
  //       }
  //     } catch (err) {
  //       console.error('Backend search error:', err);
  //       setBackendSearchResults([]);
  //     } finally {
  //       setBackendSearchLoading(false);
  //     }
  //   }, 400);

  //   return () => {
  //     if (backendSearchTimerRef.current) clearTimeout(backendSearchTimerRef.current);
  //   };
  // }, [searchTerm]);

  // ── History dropdown outside-click ──
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(e.target)) {
        setShowHistorySymbolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ═══ ADD THIS BLOCK RIGHT HERE ═══

  // ── Calendar & deals dropdown outside-click ──
  useEffect(() => {
    const handleClick = (e) => {
      if (historyCalendarRef.current && !historyCalendarRef.current.contains(e.target)) {
        setShowHistoryCalendar(false);
      }
      if (dealsDropdownRef.current && !dealsDropdownRef.current.contains(e.target)) {
        setShowDealsSymbolDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Account init ──
  useEffect(() => {
    if (accounts?.length) {
      const demo = accounts.find((a) => a.is_demo);
      setSelectedAccount(demo || accounts[0]);
    }
  }, [accounts]);

  // ── First login password change prompt ──
  useEffect(() => {
    if (user?.mustChangePassword) {
      setShowFirstLoginPrompt(true);
      setShowChangePasswordModal(true);
    }
  }, [user?.mustChangePassword]);

  // ── Fetch ALL symbols once on mount (lifted from QuotesTab) ──
  const fetchAllFuturesSymbols = useCallback(async () => {
    setLoadingAllSymbols(true);
    try {
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });
      if (res.data.success && res.data.symbols) {
        const syms = res.data.symbols;
        setAllFuturesSymbols(syms);
        setSymbolsLoaded(true);
        console.log(`📊 Loaded ${syms.length} symbols`);
      }
    } catch (error) {
      console.error('Failed to fetch symbols:', error);
    } finally {
      setLoadingAllSymbols(false);
    }
  }, []);

  useEffect(() => {
    if (symbolsFetchedRef.current) return;
    symbolsFetchedRef.current = true;
    fetchAllFuturesSymbols();
  }, [fetchAllFuturesSymbols]);

  const fetchMarketStatus = useCallback(async () => {
    try {
      const res = await api.get('/market/status');
      if (res.data?.success) {
        setMarketStatus(res.data.data || {});
      }
    } catch (error) {
      console.error('Failed to fetch market status:', error);
    }
  }, []);

  useEffect(() => {
    fetchMarketStatus();
    const interval = setInterval(fetchMarketStatus, 60000);
    return () => clearInterval(interval);
  }, [fetchMarketStatus]);

  useEffect(() => {
    syncDashboardTabHistory(activeTab, true);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePopState = () => {
      setActiveTabState(getDashboardTabFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

    // ── Backend search fallback for QuotesTab ──
  const [backendSearchResults, setBackendSearchResults] = useState([]);
  const [backendSearchLoading, setBackendSearchLoading] = useState(false);
  const backendSearchTimerRef = useRef(null);

  const searchBackend = useCallback(async (term) => {
    if (!term || term.trim().length < 2) {
      setBackendSearchResults([]);
      return;
    }
    setBackendSearchLoading(true);
    try {
      const res = await api.get('/market/search', { params: { q: term.trim(), limit: 100 } });
      if (res.data.success && res.data.symbols) {
        setBackendSearchResults(res.data.symbols);
        console.log(`🔍 Backend search "${term}": ${res.data.symbols.length} results`);
      } else {
        setBackendSearchResults([]);
      }
    } catch (err) {
      console.error('Backend search error:', err);
      setBackendSearchResults([]);
    } finally {
      setBackendSearchLoading(false);
    }
  }, []);

  // Trigger backend search when local search yields no results
  useEffect(() => {
    if (backendSearchTimerRef.current) clearTimeout(backendSearchTimerRef.current);

    if (!searchTerm || searchTerm.trim().length < 2) {
      setBackendSearchResults([]);
      return;
    }

    backendSearchTimerRef.current = setTimeout(() => {
      searchBackend(searchTerm);
    }, 400);

    return () => {
      if (backendSearchTimerRef.current) clearTimeout(backendSearchTimerRef.current);
    };
  }, [searchTerm, searchBackend]);

  // ── Set initial symbol when symbols become available ──
  const initialSymbolSetRef = useRef(false);
  useEffect(() => {
    if (initialSymbolSetRef.current) return;
    const allSyms = allFuturesSymbols.length > 0 ? allFuturesSymbols : symbols || [];
    if (!allSyms.length) return;
 
    initialSymbolSetRef.current = true;
 
    // If already have a valid symbol, keep it
    if (selectedSymbol && allSyms.some(s => s.symbol === selectedSymbol)) return;
 
    // Prefer NIFTY index series alias (series = 'I' = nearest month)
    const nifty = allSyms.find(s =>
      (s.underlying === 'NIFTY' || s.symbol.startsWith('NIFTY')) &&
      s.series === 'I'
    ) || allSyms.find(s =>
      s.symbol.startsWith('NIFTY') && !s.symbol.includes('BANK') && !s.symbol.includes('FIN') && !s.symbol.includes('MID')
    ) || allSyms.find(s => s.underlying === 'NIFTY')
      || allSyms[0];
 
    if (nifty) setSelectedSymbol(nifty.symbol);
  }, [allFuturesSymbols, symbols]);

  // ── Fetch trades when account changes ──
  useEffect(() => {
    if (!selectedAccount?.id) return;
    fetchOpenTrades(selectedAccount.id);
    fetchPendingOrders?.(selectedAccount.id);
    fetchTradeHistory(selectedAccount.id);
  }, [selectedAccount, fetchOpenTrades, fetchPendingOrders, fetchTradeHistory]);

  // ── Fetch deals for history tab ──
  useEffect(() => {
    if (activeTab === 'history' && historyViewMode === 'deals' && selectedAccount?.id) {
      fetchDeals(selectedAccount.id, historyPeriod);
    }
  }, [activeTab, historyViewMode, historyPeriod, selectedAccount, fetchDeals]);

  // ── Watchlists init ──
  const watchlistsInitRef = useRef(false);
  useEffect(() => {
    if (watchlistsInitRef.current) return;
    watchlistsInitRef.current = true;

    const initWatchlists = async () => {
      try {
        const list = await fetchWatchlists();

        if (!list.length) {
          const created = await createWatchlist('Default', true);
          setActiveWatchlistId(created.id);
          await fetchWatchlistSymbols(created.id);
          return;
        }

        let activeId = activeWatchlistId;
        if (!activeId || !list.some((w) => w.id === activeId)) {
          const def = list.find((w) => w.is_default) || list[0];
          activeId = def.id;
          setActiveWatchlistId(activeId);
        }

        await fetchWatchlistSymbols(activeId);
      } catch (e) {
        console.error(e);
        toast.error('Failed to initialize watchlists');
      }
    };

    initWatchlists();
  }, []);

  // ── Quote for selected symbol ──
  useEffect(() => {
    if (!selectedSymbol) return;
    getQuote(selectedSymbol);
  }, [selectedSymbol, getQuote]);

  // ── Socket ──
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    if (!socketInitializedRef.current) {
      socketInitializedRef.current = true;
      socketService.connect(token);
    }

    const pushMessage = (m) => {
      setMessages((prev) => [m, ...prev].slice(0, 200));
      setUnreadCount((c) => c + 1);
    };

    const onPrice = (data) => {
      if (data?.symbol) {
        console.log('📡 Price tick:', data.symbol, 'bid:', data.bid, 'ask:', data.ask, 'last:', data.last);
      }
      updatePrice(data);
    };

    const onConnected = (payload) => {
      pushMessage({
        id: `connected-${Date.now()}`,
        type: 'system',
        title: 'Connected',
        message: payload?.message || 'Connected to server',
        time: new Date().toISOString(),
        read: false,
      });
    };

    const onTradePnl = (payload) => {
      if (payload?.tradeId && payload?.profit !== undefined) {
        updateTradePnL(payload.tradeId, payload.currentPrice, payload.profit);
      }
    };

    const onTradesPnlBatch = (payload) => {
      if (payload?.trades && Array.isArray(payload.trades)) {
        updateTradesPnLBatch(payload.trades);
      }
    };

    const onAccountUpdate = (payload) => {
      if (payload?.accountId && selectedAccount?.id === payload.accountId) {
        setSelectedAccount((prev) => ({
          ...prev,
          balance: payload.balance,
          credit: payload.credit,
          equity: payload.equity,
          profit: payload.profit,
          free_margin: payload.freeMargin,
          margin: payload.margin,
        }));
      }
    };

    // ✅ Handle batch price snapshot (sent on subscribe)
    const onPricesSnapshot = (prices) => {
      if (Array.isArray(prices)) {
        updatePrice(prices);
      }
    };

    // ✅ Handle SL/TP auto-close notifications
    const onTradeClosed = (payload) => {
      if (payload?.tradeId) {
        toast.success(
          `${payload.reason || 'Auto-closed'}: ${payload.symbol} | P&L: ₹${Number(payload.profit || 0).toFixed(2)}`,
          { duration: 5000, icon: '🎯' }
        );
        if (selectedAccount?.id) {
          fetchOpenTrades(selectedAccount.id);
          fetchTradeHistory(selectedAccount.id);
        }
      }
    };

    socketService.subscribe('price:update', onPrice);
    socketService.subscribe('prices:snapshot', onPricesSnapshot);
    socketService.subscribe('connected', onConnected);
    socketService.subscribe('trade:pnl', onTradePnl);
    socketService.subscribe('trades:pnl:batch', onTradesPnlBatch);
    socketService.subscribe('account:update', onAccountUpdate);
    socketService.subscribe('trade:closed', onTradeClosed);

    // ✅ Subscribe watchlist symbols + selected symbol + all open trade symbols
    const tradeSymbols = (openTrades || []).map(t => t.symbol).filter(Boolean);
    const subs = Array.from(
      new Set([...(activeSymbols || []), selectedSymbol, ...tradeSymbols].filter(Boolean))
    );
    if (subs.length) {
      console.log('📡 Subscribing to', subs.length, 'symbols:', subs.slice(0, 10).join(', '), subs.length > 10 ? '...' : '');
      socketService.subscribeSymbols(subs);
    }
    if (selectedAccount?.id) socketService.subscribeAccount(selectedAccount.id);

    return () => {
      socketService.unsubscribe('price:update');
      socketService.unsubscribe('prices:snapshot');
      socketService.unsubscribe('connected');
      socketService.unsubscribe('trade:pnl');
      socketService.unsubscribe('trades:pnl:batch');
      socketService.unsubscribe('account:update');
      socketService.unsubscribe('trade:closed');
    };
  }, [updatePrice, activeSymbols, selectedAccount, updateTradePnL, updateTradesPnLBatch, fetchOpenTrades, fetchTradeHistory, openTrades, selectedSymbol]);

  useEffect(() => {
    return () => {
      socketInitializedRef.current = false;
      socketService.disconnect();
    };
  }, []);

  useEffect(() => {
    const onDocDown = (event) => {
      if (
        watchlistDropdownRef.current &&
        !watchlistDropdownRef.current.contains(event.target)
      ) {
        setIsWatchlistDropdownOpen(false);
        setEditingWatchlistId(null);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  // ──────────────────────────────────────
  //  COMPUTED VALUES
  // ──────────────────────────────────────

  const currentQuote =
    quotes?.[selectedSymbol] ||
    symbols?.find((s) => s.symbol === selectedSymbol) ||
    null;

  const bid = Number(currentQuote?.bid || 0);
  const ask = Number(currentQuote?.ask || 0);
  // ✅ Net Floating P&L (already includes brokerage deduction in DB)
  const totalPnL = (openTrades || []).reduce(
    (sum, t) => sum + Number(t.profit || 0),  // ← profit already net of entry brokerage
    0
  );

  // Total commission from open trades (for display purposes only)
  const totalCommission = (openTrades || []).reduce(
    (sum, t) => sum + Number(t.brokerage || 0),
    0
  );

const accountStats = useMemo(() => {
  const balance = Number(selectedAccount?.balance || 0);
  const credit = Number(selectedAccount?.credit || 0);
  const margin = Number(selectedAccount?.margin || 0);
  const leverage = selectedAccount?.leverage || 5;

  // ✅ Use the same totalPnL variable (not recalculated)
  const pnl = totalPnL;  // ← Changed from recalculating

  const equity = balance + credit + pnl;
  const freeMargin = equity - margin;
  const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;

  return {
    balance,
    credit,
    pnl,           // ← Same as totalPnL
    equity,
    margin,
    freeMargin,
    marginLevel,
    leverage,
    totalCommission,
  };
}, [selectedAccount, totalPnL, totalCommission]);  // ← Add totalPnL dependency

  const headlinePnL = accountStats.equity - accountStats.balance;

  const currentWatchlist = watchlists.find((w) => w.id === activeWatchlistId);

  const filteredSymbols = useMemo(() => {
    let list = symbols || [];
    list = list.filter((s) => matchesSelectedCategory(s, selectedCategory));

    if (searchTerm.trim()) {
      const rawTerm = searchTerm.trim().toLowerCase();
      const term = rawTerm.replace(/[\s_-]/g, '');

      const results = list.filter((s) => {
        const symStr = String(s.symbol || '').toLowerCase().replace(/[\s_-]/g, '');
        const name = String(s.display_name || '').toLowerCase().replace(/[\s_-]/g, '');
        const underlying = String(s.underlying || '').toLowerCase().replace(/[\s_-]/g, '');

        return (
          symStr.includes(term) ||
          name.includes(term) ||
          underlying.includes(term)
        );
      });
    }

    const wl = new Set((activeSymbols || []).map((x) => String(x).toUpperCase()));
    const wlF = list.filter((s) => wl.has(String(s.symbol).toUpperCase()));
    const seenW = new Set();
    return wlF.filter((s) => {
      const u = (s.underlying || s.symbol || '').replace(/\d{2}[A-Z]{3}FUT$/i,'').replace(/FUT$/i,'').replace(/-I+$/,'').toUpperCase();
      const m = s.expiry_date ? new Date(s.expiry_date).getMonth()+'-'+new Date(s.expiry_date).getFullYear() : 'x';
      const k = u+'|'+m;
      if (seenW.has(k)) return false;
      seenW.add(k);
      return true;
    });
  }, [symbols, searchTerm, selectedCategory, activeSymbols]);

  const quotesDisplayedSymbols = useMemo(() => {
    // Merge local symbols + backend search results (deduped)
    const localList = allFuturesSymbols.length > 0 ? allFuturesSymbols : symbols || [];
    const localSet = new Set(localList.map(s => s.symbol));
    const merged = [...localList];
    for (const bs of backendSearchResults) {
      if (!localSet.has(bs.symbol)) {
        merged.push(bs);
        localSet.add(bs.symbol);
      }
    }
    const sourceList = merged;

    // 0) STRICT FUTURES ONLY

    // 0) STRICT FUTURES ONLY — exclude equity/cash, include Gift Nifty
    let list = sourceList.filter((s) => {
      const cat = String(s.category || '').toLowerCase();
      const sym = String(s.symbol || '').toUpperCase();
      const seg = String(s.segment || '').toUpperCase();
      const inst = String(s.instrument_type || '').toUpperCase();
      const exch = String(s.exchange || '').toUpperCase();

      // Always include Gift Nifty
      if (sym.includes('GIFTNIFTY') || sym.includes('GIFT_NIFTY')) return true;

      // Include futures only
      if (cat.includes('future')) return true;
      if (cat.includes('commodity')) return true;
      if (inst.includes('FUT')) return true;
      if (/FUT$/.test(sym)) return true;
      if (s.series === 'I' || s.series === 'II' || s.series === 'III') return true;
      if (seg === 'NFO' || seg === 'MCX' || seg === 'CDS' || seg === 'BFO') return true;
      if (exch === 'MCX' || exch === 'CDS') return true;
      if (/GOLD|SILVER|CRUDE|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL|COTTON/i.test(sym)) return true;

      return false;
    });

    // 1) Category filter
    if (selectedCategory !== 'all') {
      list = list.filter((s) => {
        const cat = String(s.category || '').toLowerCase();
        const sym = String(s.symbol || '').toUpperCase();
        const seg = String(s.segment || '').toUpperCase();
        const underlying = String(s.underlying || '').toUpperCase();

        if (selectedCategory === 'index_futures') {
          return (
            cat === 'index_futures' ||
            /NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX|GIFTNIFTY/i.test(underlying) ||
            sym.includes('GIFTNIFTY')
          );
        }
        if (selectedCategory === 'stock_futures') {
          return (
            cat === 'stock_futures' ||
            (seg === 'NFO' &&
              !cat.includes('index') &&
              !cat.includes('commodity') &&
              !/NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX|GIFTNIFTY/i.test(underlying))
          );
        }
        if (selectedCategory === 'commodity_futures') {
          return (
            cat === 'commodity_futures' ||
            seg === 'MCX' ||
            String(s.exchange || '').toUpperCase() === 'MCX'
          );
        }
        return true;
      });
    }

    // 2) Expiry filter is now applied conditionally below.
    //    Previously it ran here unconditionally when not searching,
    //    which removed watchlist symbols whose expiry wasn't in the
    //    nearest 3 dates — causing "star marked but not in watchlist" bug.

    // 3) If searching → search ALL visible symbols (local + backend)
    if (searchTerm.trim()) {
      const rawTerm = searchTerm.trim().toLowerCase();
      const term = rawTerm.replace(/[\s_-]/g, '');

      const results = list.filter((s) => {
        const symStr = String(s.symbol || '').toLowerCase().replace(/[\s_-]/g, '');
        const name = String(s.display_name || '').toLowerCase().replace(/[\s_-]/g, '');
        const underlying = String(s.underlying || '').toLowerCase().replace(/[\s_-]/g, '');

        return (
          symStr.includes(term) ||
          name.includes(term) ||
          underlying.includes(term)
        );
      });

      results.sort((a, b) => {
        const aU = String(a.underlying || '').toLowerCase();
        const bU = String(b.underlying || '').toLowerCase();
        const aExact = aU === term;
        const bExact = bU === term;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        if (aU !== bU) return aU.localeCompare(bU);
        const aS = a.series || '';
        const bS = b.series || '';
        if (aS && !bS) return -1;
        if (!aS && bS) return 1;
        const aE = a.expiry_date || '9999';
        const bE = b.expiry_date || '9999';
        return aE.localeCompare(bE);
      });

      return pickLiveContractRows(results).slice(0, 200);
    }

    // 4) Not searching → show backend live contracts by default, or the exact
    // watchlist symbols in watchlist order when a watchlist is active.
    const watchlistSymbols = (activeSymbols || [])
      .map((value) => String(value || '').toUpperCase())
      .filter(Boolean);

    if (watchlistSymbols.length === 0) {
      return pickLiveContractRows(list).slice(0, 20);
    }

    const symbolsByKey = new Map(
      list.map((row) => [String(row.symbol || '').toUpperCase(), row]),
    );

    return watchlistSymbols
      .map((symbolKey) => symbolsByKey.get(symbolKey))
      .filter(Boolean);
  }, [allFuturesSymbols, symbols, searchTerm, selectedCategory, activeSymbols, backendSearchResults]);

  const displayedQuoteSymbolSet = useMemo(
    () =>
      new Set(
        (quotesDisplayedSymbols || [])
          .map((sym) => String(sym?.symbol || '').toUpperCase())
          .filter(Boolean),
      ),
    [quotesDisplayedSymbols],
  );

  useEffect(() => {
    const nextSymbols = new Set(
      (quotesDisplayedSymbols || [])
        .map((sym) => String(sym?.symbol || '').toUpperCase())
        .filter(Boolean),
    );

    const prevSymbols = visibleQuoteSubscriptionsRef.current || new Set();
    const toSubscribe = [...nextSymbols].filter((sym) => !prevSymbols.has(sym));
    const toUnsubscribe = [...prevSymbols].filter((sym) => !nextSymbols.has(sym));

    if (toUnsubscribe.length > 0) {
      socketService.unsubscribeSymbols(toUnsubscribe);
    }
    if (toSubscribe.length > 0) {
      socketService.subscribeSymbols(toSubscribe);
    }

    visibleQuoteSubscriptionsRef.current = nextSymbols;
  }, [quotesDisplayedSymbols]);

  const filteredHistoryTrades = useMemo(() => {
    const start = getPeriodStart(historyPeriod);
    let list = tradeHistory || [];

    if (start) {
      list = list.filter((t) => {
        const ct = t.close_time || t.closeTime;
        if (!ct) return false;
        return new Date(ct) >= start;
      });
    }

    if (historyFilter === 'profit')
      list = list.filter((t) => Number(t.profit || 0) > 0);
    if (historyFilter === 'loss')
      list = list.filter((t) => Number(t.profit || 0) < 0);

    return list;
  }, [tradeHistory, historyPeriod, historyFilter]);

  const filteredMessages = useMemo(() => {
    if (messageCategory === 'all') return messages;
    return messages.filter((m) => m.type === messageCategory);
  }, [messages, messageCategory]);

  // ──────────────────────────────────────
  //  ACTIONS
  // ──────────────────────────────────────

  const switchToDemo = () => {
    const demo = accounts?.find((a) => a.is_demo);
    if (demo) setSelectedAccount(demo);
    else toast.error('No demo account found');
  };

  const switchToLive = () => {
    const live = accounts?.find((a) => !a.is_demo);
    if (live) setSelectedAccount(live);
    else toast.error('No live account found');
  };

  const handleCreateWatchlist = async (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setShowWatchlistCreateModal(true);
    setNewWatchlistName('');
    setIsWatchlistDropdownOpen(false);
    setShowWatchlistMenu(false);
  };

  const submitCreateWatchlist = async () => {
    const name = newWatchlistName.trim();
    if (!name) {
      toast.error('Watchlist name is required');
      return;
    }

    setWatchlistCreateLoading(true);
    try {
      const created = await createWatchlist(name, false);
      setActiveWatchlistId(created.id);
      await fetchWatchlistSymbols(created.id);
      toast.success('Watchlist created');
      setIsWatchlistDropdownOpen(false);
      setShowWatchlistCreateModal(false);
      setNewWatchlistName('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to create watchlist');
    } finally {
      setWatchlistCreateLoading(false);
    }
  };

  const handleSwitchWatchlist = async (id, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setActiveWatchlistId(id);
    await fetchWatchlistSymbols(id);
    setIsWatchlistDropdownOpen(false);
  };

  const startRename = (wl, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    setEditingWatchlistId(wl.id);
    setEditingWatchlistName(wl.name);
  };

  const submitRename = async (wlId) => {
    if (!editingWatchlistName.trim()) {
      setEditingWatchlistId(null);
      return;
    }
    const res = await renameWatchlist(wlId, editingWatchlistName.trim());
    if (res?.success === false) toast.error(res.message || 'Rename failed');
    else toast.success('Renamed');
    setEditingWatchlistId(null);
  };

  const handleDeleteWatchlist = async (wlId, e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (!window.confirm('Delete this watchlist?')) return;
    const res = await deleteWatchlist(wlId);
    if (res?.success === false) toast.error(res.message || 'Delete failed');
    else toast.success('Deleted');
  };

  const toggleSymbolInWatchlist = async (sym) => {
    if (!activeWatchlistId) return toast.error('No active watchlist');
    const s = String(sym).toUpperCase();
    const exists = (activeSymbols || []).includes(s);
    const res = exists
      ? await removeSymbol(activeWatchlistId, s)
      : await addSymbol(activeWatchlistId, s);

    if (res?.success === false) {
      toast.error(res.message || 'Failed');
    } else if (res?.success) {
      toast.success(exists ? 'Removed from watchlist' : 'Added to watchlist', { duration: 1500 });
    }
  };

  const refreshAccountActivity = useCallback(
    async (accountId = selectedAccount?.id) => {
      if (!accountId) return;

      await Promise.allSettled([
        fetchOpenTrades(accountId),
        fetchPendingOrders?.(accountId),
        fetchTradeHistory(accountId),
        fetchDeals(accountId, historyPeriod),
      ]);
    },
    [
      selectedAccount?.id,
      fetchOpenTrades,
      fetchPendingOrders,
      fetchTradeHistory,
      fetchDeals,
      historyPeriod,
    ],
  );

const placeOrderWithQty = async (type, qty, execType = 'instant', execPrice = 0) => {
    if (!selectedAccount?.id || !selectedSymbol) return;

    // ── 1. Off-Quotes check ──
    // Try to get a fresh quote first
    let currentQ = quotes?.[selectedSymbol];
    if (!currentQ || !currentQ.timestamp || (Date.now() - currentQ.timestamp > 30000)) {
      // Fetch fresh quote from server
      try {
        await getQuote(selectedSymbol);
        currentQ = useMarketStore.getState().quotes?.[selectedSymbol];
      } catch (e) {
        // ignore, use what we have
      }
    }
    
    // ✅ CHANGED: Check both price data AND staleness (>15s = off quotes)
    const quoteTs = Number(currentQ?.timestamp || 0);
    const quoteAgeMs = Date.now() - quoteTs;
    const hasPriceData = currentQ && (Number(currentQ.bid) > 0 || Number(currentQ.ask) > 0 || Number(currentQ.last) > 0);
    const isStalePrice = quoteAgeMs > QUOTE_STALE_THRESHOLD_MS;
    const isOffQuotes = !hasPriceData || isStalePrice;

    if (isOffQuotes) {
      setOrderConfirmation({
        phase: 'offquotes',
        symbol: selectedSymbol,
        message: isStalePrice 
          ? `Prices have not updated for ${Math.round(quoteAgeMs / 1000)} seconds. Please wait for live quotes.`
          : 'No price data available. Please wait for live quotes.',
      });
      setTimeout(() => setOrderConfirmation(null), 3000);
      return;
    }

    // ── 2. Market-hours check (symbol-aware for commodities) ──
    if (!isMarketOpenNow(selectedSymbol)) {
      const isCommodity = /GOLD|SILVER|CRUDE|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL|COTTON/i.test(selectedSymbol);
      setOrderConfirmation({
        phase: 'rejected',
        type: type.toUpperCase(),
        symbol: selectedSymbol,
        message: isCommodity
          ? 'Commodity market is closed. Trading hours: 9:00 AM – 11:30 PM IST, Mon–Fri.'
          : 'Market is closed. Trading hours: 9:15 AM – 3:30 PM IST, Mon–Fri.',
      });
      setTimeout(() => setOrderConfirmation(null), 4000);
      return;
    }

    // ── 3. Determine effective order type ──
    let effectiveOrderType = 'market';
    let effectivePrice = 0;

    if (execType === 'buy_limit' || execType === 'sell_limit' || execType === 'buy_stop' || execType === 'sell_stop') {
      effectiveOrderType = execType;
      effectivePrice = Number(execPrice);

      if (!effectivePrice || effectivePrice <= 0) {
        setOrderConfirmation({
          phase: 'rejected',
          type: type.toUpperCase(),
          symbol: selectedSymbol,
          message: 'Please enter a valid price for this order type.',
        });
        setTimeout(() => setOrderConfirmation(null), 3000);
        return;
      }

      const cmp = type === 'buy' ? ask : bid;

      if (execType === 'buy_limit' && effectivePrice > cmp * 0.995) {
        setOrderConfirmation({
          phase: 'rejected',
          type: 'BUY LIMIT',
          symbol: selectedSymbol,
          message: `Price must be at least 0.5% below current price (≤ ${(cmp * 0.995).toFixed(2)})`,
        });
        setTimeout(() => setOrderConfirmation(null), 3000);
        return;
      }
      if (execType === 'sell_limit' && effectivePrice < cmp * 1.005) {
        setOrderConfirmation({
          phase: 'rejected',
          type: 'SELL LIMIT',
          symbol: selectedSymbol,
          message: `Price must be at least 0.5% above current price (≥ ${(cmp * 1.005).toFixed(2)})`,
        });
        setTimeout(() => setOrderConfirmation(null), 3000);
        return;
      }
    }

    // ── 4. Show full-screen "Executing..." overlay ──
    setOrderConfirmation({
      phase: 'executing',
      type: type.toUpperCase(),
      symbol: selectedSymbol,
      quantity: qty,
    });

    // ── 5. API call ──
    const result = await placeOrder({
      accountId: selectedAccount.id,
      symbol: selectedSymbol,
      type,
      orderType: effectiveOrderType,
      quantity: Number(qty || 1),
      stopLoss: stopLoss ? Number(stopLoss) : 0,
      takeProfit: takeProfit ? Number(takeProfit) : 0,
      price: effectivePrice || (entryPrice ? Number(entryPrice) : 0),
    });

    // ── 6. Show result in full-screen overlay ──
    if (result.success) {
      const resultPrice = result.data?.open_price ? Number(result.data.open_price).toFixed(2) : '';

      setOrderConfirmation({
        phase: 'success',
        type: type.toUpperCase(),
        symbol: selectedSymbol,
        quantity: qty,
        price: resultPrice,
        merged: result.merged || false,
        pending: result.pending || false,
        message: result.pending
          ? `${type.toUpperCase()} LIMIT order placed`
          : `Order Executed`,
      });

      await refreshAccountActivity(selectedAccount.id);
      setShowOrderModal(false);
      setLimitPrice('');
      setOrderExecType('instant');
      setTimeout(() => setOrderConfirmation(null), 3000);
    } else {
      setOrderConfirmation({
        phase: 'rejected',
        type: type.toUpperCase(),
        symbol: selectedSymbol,
        message: result.message || 'Order failed',
      });
      setTimeout(() => setOrderConfirmation(null), 3000);
    }
  };
  const handleCloseTrade = async (tradeId) => {
    // Show executing overlay
    const trade = openTrades.find(t => t.id === tradeId);
    setOrderConfirmation({
      phase: 'executing',
      type: 'CLOSE',
      symbol: trade?.symbol || '',
    });

    const result = await closeTrade(tradeId, selectedAccount?.id);
    if (result.success) {
      await refreshAccountActivity(selectedAccount?.id);
      setOrderConfirmation({
        phase: 'success',
        type: 'CLOSE',
        symbol: trade?.symbol || '',
        message: result.message || 'Position closed successfully',
      });
      setExpandedTradeId(null);
      setCloseConfirmTrade(null);
      setTimeout(() => setOrderConfirmation(null), 3000);
    } else {
      setOrderConfirmation({
        phase: 'rejected',
        type: 'CLOSE',
        symbol: trade?.symbol || '',
        message: result.message || 'Close failed',
      });
      setTimeout(() => setOrderConfirmation(null), 4000);
    }
  };

  const markAllRead = () => {
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
    setUnreadCount(0);
  };

    const handleChangePassword = async () => {
    if (!changePassCurrent) return toast.error('Enter current password');
    if (!changePassNew) return toast.error('Enter new password');
    if (changePassNew.length < 4) return toast.error('New password must be at least 4 characters');
    if (changePassNew !== changePassConfirm) return toast.error('Passwords do not match');
    if (changePassCurrent === changePassNew) return toast.error('New password must be different');

    setChangePassLoading(true);
    try {
      const res = await api.post('/auth/change-password', {
        currentPassword: changePassCurrent,
        newPassword: changePassNew,
      });
      if (res.data.success) {
        toast.success('Password changed successfully!');
        setShowChangePasswordModal(false);
        setShowFirstLoginPrompt(false);
        setChangePassCurrent('');
        setChangePassNew('');
        setChangePassConfirm('');
      } else {
        toast.error(res.data.message || 'Failed to change password');
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to change password');
    } finally {
      setChangePassLoading(false);
    }
  };

  const renderChangePasswordModal = () => {
    if (!showChangePasswordModal) return null;

    return (
      <div
        className="fixed inset-0 bg-black/70 flex items-center justify-center p-4"
        style={{ zIndex: 10001 }}
        onClick={() => {
          if (!showFirstLoginPrompt) {
            setShowChangePasswordModal(false);
          }
        }}
      >
        <div
          className="w-full max-w-sm rounded-xl"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
            <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
              {showFirstLoginPrompt ? '🔐 Change Default Password' : 'Change Password'}
            </h3>
            {!showFirstLoginPrompt && (
              <button onClick={() => setShowChangePasswordModal(false)}>
                <X size={22} color="#787b86" />
              </button>
            )}
          </div>

          <div className="p-4 space-y-4">
            {showFirstLoginPrompt && (
              <div className="p-3 rounded-lg" style={{ background: '#ff980020', border: '1px solid #ff980050' }}>
                <div className="text-sm font-medium" style={{ color: '#ff9800' }}>
                  This is your first login. Please change your default password for security.
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Current Password</label>
              <input
                type="password"
                value={changePassCurrent}
                onChange={(e) => setChangePassCurrent(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-4 py-3 rounded-lg text-sm"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: '#787b86' }}>New Password</label>
              <input
                type="password"
                value={changePassNew}
                onChange={(e) => setChangePassNew(e.target.value)}
                placeholder="Enter new password (min 4 chars)"
                className="w-full px-4 py-3 rounded-lg text-sm"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            <div>
              <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Confirm New Password</label>
              <input
                type="password"
                value={changePassConfirm}
                onChange={(e) => setChangePassConfirm(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full px-4 py-3 rounded-lg text-sm"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              />
            </div>

            <button
              onClick={handleChangePassword}
              disabled={changePassLoading}
              className="w-full py-3.5 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ background: '#2962ff' }}
            >
              {changePassLoading ? 'Changing...' : 'Change Password'}
            </button>

            {showFirstLoginPrompt && (
              <button
                onClick={() => {
                  setShowChangePasswordModal(false);
                  setShowFirstLoginPrompt(false);
                }}
                className="w-full py-2 rounded-lg text-sm font-medium"
                style={{ background: '#2a2e39', color: '#787b86' }}
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };
  const handleAddAccount = async () => {
    if (!addAccountEmail || !addAccountPassword) {
      return toast.error('Email and password required');
    }

    setAddAccountLoading(true);
    const result = await addAccount(addAccountEmail, addAccountPassword);
    setAddAccountLoading(false);

    if (result.success) {
      toast.success('Account added successfully');
      setShowAddAccountModal(false);
      setAddAccountEmail('');
      setAddAccountPassword('');
    } else {
      toast.error(result.message);
    }
  };

  const handleSwitchToSavedAccount = async (savedAcc) => {
    const loadingToast = toast.loading('Switching account...');
    const result = await switchToAccount(savedAcc);
    toast.dismiss(loadingToast);

    if (result.success) {
      toast.success(`Switched to ${savedAcc.email}`);
    } else {
      if (result.requiresLogin) {
        toast.error('Session expired. Please login again.');
        removeSavedAccount(savedAcc.email);
      } else {
        toast.error(result.message);
      }
    }
  };

  const handleRemoveSavedAccount = (identifier) => {
    if (user?.loginId === identifier || user?.email === identifier) {
      return toast.error('Cannot remove currently active account');
    }

    if (!window.confirm('Remove this account from saved accounts?')) return;

    const result = removeSavedAccount(identifier);
    if (result.success) {
      toast.success('Account removed');
    } else {
      toast.error(result.message);
    }
  };

  const handleSymbolTap = useCallback((sym, e) => {
    e.stopPropagation();
    setSelectedSymbolForAction(sym);
    setShowSymbolActionMenu(true);
  }, []);

  const handleRefreshData = useCallback(async () => {
    // Use ref to prevent multiple simultaneous refreshes
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshing(true);

    try {
      // Refresh account data
      try {
        const { data: authRes } = await api.get('/auth/me');
        const refreshedAccounts = authRes?.data?.accounts || [];
        if (authRes?.success && refreshedAccounts.length > 0) {
          setAccounts(refreshedAccounts);
          const refreshed = refreshedAccounts.find((a) => a.id === selectedAccount?.id);
          if (refreshed) setSelectedAccount(refreshed);
        }
      } catch (_) {}

      await Promise.allSettled([
        fetchMarketStatus(),
        refreshAccountActivity(selectedAccount?.id),
        refreshSymbols(),
        fetchAllFuturesSymbols(),
        activeWatchlistId ? fetchWatchlistSymbols(activeWatchlistId) : Promise.resolve(),
        selectedSymbol ? getQuote(selectedSymbol) : Promise.resolve(),
      ]);

      toast.success('Refreshed', { duration: 1200, icon: '🔄' });
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
      refreshingRef.current = false;
    }
  }, [
    selectedAccount?.id,
    activeWatchlistId,
    selectedSymbol,
    setAccounts,
    fetchWatchlistSymbols,
    fetchMarketStatus,
    refreshAccountActivity,
    refreshSymbols,
    fetchAllFuturesSymbols,
    getQuote,
  ]);

  useEffect(() => {
    const refreshOnResume = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      handleRefreshData();
    };

    document.addEventListener('visibilitychange', refreshOnResume);
    window.addEventListener('focus', refreshOnResume);

    return () => {
      document.removeEventListener('visibilitychange', refreshOnResume);
      window.removeEventListener('focus', refreshOnResume);
    };
  }, [handleRefreshData]);

  const handleMobileTouchStart = useCallback((event) => {
    const touchY = event.touches?.[0]?.clientY;
    if (touchY == null) return;

    const scrollParent = findScrollableParent(event.target);
    const scrollTop = scrollParent
      ? scrollParent.scrollTop
      : window.scrollY || document.documentElement.scrollTop || 0;

    mobilePullRef.current = {
      startY: touchY,
      eligible: scrollTop <= 0,
      triggered: false,
    };
  }, []);

  const handleMobileTouchMove = useCallback((event) => {
    const touchY = event.touches?.[0]?.clientY;
    if (touchY == null) return;

    const state = mobilePullRef.current;
    if (!state.eligible || refreshingRef.current) return;

    if (touchY - state.startY >= 90) {
      mobilePullRef.current = {
        ...state,
        triggered: true,
      };
    }
  }, []);

  const handleMobileTouchEnd = useCallback(async () => {
    const state = mobilePullRef.current;
    mobilePullRef.current = { startY: 0, eligible: false, triggered: false };

    if (!state.eligible || !state.triggered || refreshingRef.current) return;
    await handleRefreshData();
  }, [handleRefreshData]);

  // ════════════════════════════════════════
  //  RENDER FUNCTIONS (not components — no hooks, no remount cycles)
  // ════════════════════════════════════════

  // ============ CLOSE CONFIRM MODAL ============
  const renderCloseConfirmModal = () => {
    if (!closeConfirmTrade) return null;

    const trade = closeConfirmTrade;
    const pnl = Number(trade.profit || 0) + Number(trade.brokerage || 0);
    const isProfit = pnl >= 0;
    const maxQty = Number(trade.quantity);
    const partialPnL = isPartialClose ? (pnl / maxQty) * closeQty : pnl;

    const handleClose = async () => {
      if (isPartialClose && closeQty > 0 && closeQty < maxQty) {
        // Partial close
        setOrderConfirmation({
          phase: 'executing',
          type: 'CLOSE',
          symbol: trade.symbol,
        });
        const result = await closeTrade(trade.id, selectedAccount?.id, closeQty);
        if (result.success) {
          await refreshAccountActivity(selectedAccount?.id);
          setOrderConfirmation({
            phase: 'success',
            type: 'CLOSE',
            symbol: trade.symbol,
            quantity: closeQty,
            message: `Closed ${closeQty} of ${maxQty}`,
          });
          setCloseConfirmTrade(null);
          setTimeout(() => setOrderConfirmation(null), 3000);
        } else {
          setOrderConfirmation({
            phase: 'rejected',
            type: 'CLOSE',
            symbol: trade.symbol,
            message: result.message || 'Partial close failed',
          });
          setTimeout(() => setOrderConfirmation(null), 3000);
        }
      } else {
        // Full close (handleCloseTrade already uses full dialog)
        await handleCloseTrade(trade.id);
      }
    };

    return (
      <div
        className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
        onClick={() => setCloseConfirmTrade(null)}
      >
        <div
          className="w-full max-w-sm rounded-xl"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: '#363a45' }}
          >
            <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
              Close Position
            </h3>
            <button onClick={() => setCloseConfirmTrade(null)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="p-4">
            <div
              className="p-4 rounded-lg mb-4"
              style={{ background: '#2a2e39' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="font-bold text-lg"
                  style={{ color: '#d1d4dc' }}
                >
                  {trade.symbol}
                </span>
                <span
                  className="px-2 py-1 rounded text-xs font-semibold"
                  style={{
                    background:
                      trade.trade_type === 'buy' ? '#26a69a20' : '#ef535020',
                    color:
                      trade.trade_type === 'buy' ? '#26a69a' : '#ef5350',
                  }}
                >
                  {String(trade.trade_type || '').toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div style={{ color: '#787b86' }}>Total Quantity</div>
                  <div className="font-bold" style={{ color: '#d1d4dc' }}>
                    {maxQty}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#787b86' }}>Open Price</div>
                  <div style={{ color: '#d1d4dc' }}>
                    {formatINR(trade.open_price)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#787b86' }}>Current Price</div>
                  <div style={{ color: '#d1d4dc' }}>
                    {formatINR(trade.current_price || trade.open_price)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#787b86' }}>Total P&L</div>
                  <div
                    className="font-bold"
                    style={{ color: isProfit ? '#26a69a' : '#ef5350' }}
                  >
                    {isProfit ? '+' : ''}
                    {formatINR(pnl)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label
                className="flex items-center gap-2 cursor-pointer p-3 rounded-lg"
                style={{ background: '#2a2e39' }}
              >
                <input
                  type="checkbox"
                  checked={isPartialClose}
                  onChange={(e) => {
                    setIsPartialClose(e.target.checked);
                    if (!e.target.checked) setCloseQty(maxQty);
                  }}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: '#2962ff' }}
                />
                <span
                  className="text-sm font-medium"
                  style={{ color: '#d1d4dc' }}
                >
                  Partial Close (Close specific quantity)
                </span>
              </label>
            </div>

            {isPartialClose && (
              <div className="mb-4">
                <label
                  className="block text-sm mb-2"
                  style={{ color: '#787b86' }}
                >
                  Quantity to Close
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCloseQty(Math.max(1, closeQty - 1))}
                    disabled={closeQty <= 1}
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold disabled:opacity-30"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      color: '#d1d4dc',
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={closeQty}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setCloseQty('');
                      } else {
                        setCloseQty(Math.max(1, Math.min(maxQty, Number(raw))));
                      }
                    }}
                    onBlur={() => {
                      if (!closeQty || Number(closeQty) < 1) setCloseQty(1);
                    }}
                    className="flex-1 px-4 py-3 rounded-lg text-xl font-bold text-center"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      color: '#d1d4dc',
                    }}
                    min="1"
                    max={maxQty}
                  />
                  <button
                    onClick={() =>
                      setCloseQty(Math.min(maxQty, closeQty + 1))
                    }
                    disabled={closeQty >= maxQty}
                    className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold disabled:opacity-30"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      color: '#d1d4dc',
                    }}
                  >
                    +
                  </button>
                </div>

                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() =>
                      setCloseQty(Math.max(1, Math.floor(maxQty / 4)))
                    }
                    className="flex-1 py-2 rounded-lg text-xs font-medium"
                    style={{
                      background: '#2a2e39',
                      color: '#787b86',
                      border: '1px solid #363a45',
                    }}
                  >
                    25% ({Math.max(1, Math.floor(maxQty / 4))})
                  </button>
                  <button
                    onClick={() =>
                      setCloseQty(Math.max(1, Math.floor(maxQty / 2)))
                    }
                    className="flex-1 py-2 rounded-lg text-xs font-medium"
                    style={{
                      background: '#2a2e39',
                      color: '#787b86',
                      border: '1px solid #363a45',
                    }}
                  >
                    Half ({Math.max(1, Math.floor(maxQty / 2))})
                  </button>
                  <button
                    onClick={() => setCloseQty(maxQty)}
                    className="flex-1 py-2 rounded-lg text-xs font-medium"
                    style={{
                      background: '#2a2e39',
                      color: '#787b86',
                      border: '1px solid #363a45',
                    }}
                  >
                    All ({maxQty})
                  </button>
                </div>

                <div
                  className="mt-3 p-3 rounded-lg"
                  style={{
                    background: '#252832',
                    border: '1px solid #363a45',
                  }}
                >
                  <div className="flex justify-between text-sm">
                    <span style={{ color: '#787b86' }}>Closing</span>
                    <span style={{ color: '#d1d4dc' }}>
                      {closeQty} of {maxQty}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span style={{ color: '#787b86' }}>Remaining</span>
                    <span style={{ color: '#d1d4dc' }}>
                      {maxQty - closeQty}
                    </span>
                  </div>
                  <div
                    className="flex justify-between text-sm mt-2 pt-2 border-t"
                    style={{ borderColor: '#363a45' }}
                  >
                    <span style={{ color: '#787b86' }}>
                      Est. P&L from Close
                    </span>
                    <span
                      className="font-bold"
                      style={{
                        color: partialPnL >= 0 ? '#26a69a' : '#ef5350',
                      }}
                    >
                      {partialPnL >= 0 ? '+' : ''}
                      {formatINR(partialPnL)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <p className="text-sm mb-4" style={{ color: '#787b86' }}>
              {isPartialClose && closeQty < maxQty
                ? `This will close ${closeQty} of ${maxQty} positions. ${maxQty - closeQty} will remain open.`
                : 'This will close the entire position. This action cannot be undone.'}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setCloseConfirmTrade(null)}
                className="py-3 rounded-lg font-medium"
                style={{
                  background: '#2a2e39',
                  color: '#d1d4dc',
                  border: '1px solid #363a45',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleClose}
                className="py-3 rounded-lg font-semibold text-white"
                style={{ background: '#ef5350' }}
              >
                Close{' '}
                {isPartialClose && closeQty < maxQty
                  ? `${closeQty} Positions`
                  : 'Position'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============ MOBILE NAV ============
  const renderMobileNav = () => {
    const tabs = [
      { id: 'quotes', icon: List, label: 'Quotes' },
      { id: 'chart', icon: BarChart2, label: 'Chart' },
      { id: 'trade', icon: TrendingUp, label: 'Trade' },
      { id: 'history', icon: Clock, label: 'History' },
      {
        id: 'messages',
        icon: MessageSquare,
        label: 'Messages',
        badge: unreadCount,
      },
      { id: 'wallet', icon: WalletIcon, label: 'Wallet' },
      { id: 'settings', icon: Settings, label: 'Settings' },
    ];

    if (isAdmin) {
      tabs.splice(6, 0, { id: 'admin', icon: User, label: 'Admin' });
    }

    return (
      <div
        className="fixed bottom-0 left-0 right-0 flex items-center justify-around border-t z-50 lg:hidden"
        style={{
          background: theme === 'light' ? '#ffffff' : '#1e222d',
          borderColor: theme === 'light' ? '#e2e8f0' : '#363a45',
          height: 'calc(4rem + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex flex-col items-center justify-center flex-1 h-full relative"
            style={{
              color: activeTab === tab.id ? '#2962ff' : '#787b86',
            }}
          >
            <tab.icon size={22} />
            <span className="text-xs mt-1 font-medium">{tab.label}</span>
            {tab.badge > 0 && (
              <span className="absolute top-2 right-1/4 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                {tab.badge > 9 ? '9+' : tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  // ============ SYMBOL ACTION MENU (lifted from QuotesTab) ============
  const renderSymbolActionMenu = () => {
    if (!showSymbolActionMenu || !selectedSymbolForAction) return null;
    const sym = selectedSymbolForAction;
    const inWL = (activeSymbols || []).includes(String(sym.symbol).toUpperCase());
    const quote = quotes?.[sym.symbol] || sym;
    const symBid = Number(quote.bid || quote.last_price || 0);
    const symAsk = Number(quote.ask || quote.last_price || 0);
    const change = Number(quote.change_percent || sym.change_percent || 0);
    const spread = Math.abs(symAsk - symBid);

    const expiry = sym.expiry_date
      ? new Date(sym.expiry_date).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric',
        })
      : '';

    return (
      <div
        className="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
        onClick={() => { setShowSymbolActionMenu(false); setSelectedSymbolForAction(null); }}
      >
        <div
          className="w-full max-w-lg rounded-t-xl overflow-hidden"
          style={{
            background: '#1e222d',
            border: '1px solid #363a45',
            marginBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Symbol Header ── */}
          <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                  {sym.symbol}
                </div>
                <div className="text-sm" style={{ color: '#787b86' }}>
                  {sym.display_name}
                </div>
                {expiry && (
                  <div className="text-xs mt-0.5" style={{ color: '#787b86' }}>
                    {sym.exchange} • Expiry: {expiry} • Lot: {sym.lot_size || 1}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
                  {(symBid || symAsk).toFixed(2)}
                </div>
                <div
                  className="text-sm font-medium"
                  style={{ color: change >= 0 ? '#26a69a' : '#ef5350' }}
                >
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </div>
                <div className="text-xs" style={{ color: '#787b86' }}>
                  Spread: {spread.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Menu Options (MT5 style) ── */}
          <div className="py-1">
            {/* New Order */}
            <button
              onClick={() => {
                setSelectedSymbol(sym.symbol);
                setShowSymbolActionMenu(false);
                setSelectedSymbolForAction(null);
                // Reset order modal state
                setOrderExecType('instant');
                setLimitPrice('');
                setQuantity(1);
                setStopLoss('');
                setTakeProfit('');
                setShowOrderModal(true);
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
            >
              <TrendingUp size={20} color="#2962ff" />
              <span className="text-base font-medium" style={{ color: '#d1d4dc' }}>New Order</span>
            </button>

            {/* Divider */}
            <div className="h-px mx-4" style={{ background: '#363a45' }} />

            {/* Chart */}
            <button
              onClick={() => {
                setSelectedSymbol(sym.symbol);
                setActiveTab('chart');
                setShowSymbolActionMenu(false);
                setSelectedSymbolForAction(null);
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
            >
              <BarChart2 size={20} color="#787b86" />
              <span className="text-base font-medium" style={{ color: '#d1d4dc' }}>Chart</span>
            </button>

            {/* Divider */}
            <div className="h-px mx-4" style={{ background: '#363a45' }} />

            {/* Add/Remove Watchlist */}
            <button
              onClick={() => {
                toggleSymbolInWatchlist(sym.symbol);
                setShowSymbolActionMenu(false);
                setSelectedSymbolForAction(null);
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-white/5 active:bg-white/10"
            >
              <Star
                size={20}
                color={inWL ? '#f5c542' : '#787b86'}
                fill={inWL ? '#f5c542' : 'none'}
              />
              <span className="text-base font-medium" style={{ color: '#d1d4dc' }}>
                {inWL ? 'Remove from Watchlist' : 'Add to Watchlist'}
              </span>
            </button>
          </div>

          {/* ── Cancel ── */}
          <div className="p-3 border-t" style={{ borderColor: '#363a45' }}>
            <button
              onClick={() => { setShowSymbolActionMenu(false); setSelectedSymbolForAction(null); }}
              className="w-full py-3 rounded-lg font-medium text-center"
              style={{ background: '#2a2e39', color: '#787b86' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ WATCHLIST MENU (lifted from QuotesTab) ============
  const renderWatchlistMenu = () => {
    if (!showWatchlistMenu) return null;

    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={() => setShowWatchlistMenu(false)}
      >
        <div
          className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: '#1e222d',
            border: '1px solid #363a45',
            maxHeight: '70vh',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: '#363a45' }}
          >
            <h3
              className="font-bold text-lg"
              style={{ color: '#d1d4dc' }}
            >
              Watchlists
            </h3>
            <button onClick={() => setShowWatchlistMenu(false)}>
              <X size={24} color="#787b86" />
            </button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {watchlists.map((wl) => (
              <div
                key={wl.id}
                className="flex items-center justify-between border-b px-4 py-3"
                style={{
                  borderColor: '#363a45',
                  background:
                    wl.id === activeWatchlistId
                      ? '#2962ff20'
                      : 'transparent',
                }}
              >
                <button
                  onClick={async () => {
                    setShowWatchlistMenu(false);
                    await handleSwitchWatchlist(wl.id);
                  }}
                  className="flex items-center gap-3 flex-1 text-left"
                >
                  <Star
                    size={18}
                    color={
                      wl.id === activeWatchlistId
                        ? '#2962ff'
                        : '#787b86'
                    }
                  />
                  <span style={{ color: '#d1d4dc' }}>{wl.name}</span>
                  {wl.is_default && (
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: '#26a69a20',
                        color: '#26a69a',
                      }}
                    >
                      Default
                    </span>
                  )}
                  {wl.id === activeWatchlistId && (
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: '#2962ff' }}
                    />
                  )}
                </button>
                {/* Remove button — only for non-default watchlists */}
                {!wl.is_default && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteWatchlist(wl.id, e);
                      setShowWatchlistMenu(false);
                    }}
                    className="p-2 rounded-lg hover:bg-red-500/20 ml-2 shrink-0"
                    title="Remove watchlist"
                  >
                    <Trash2 size={16} color="#ef5350" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div
            className="p-4 border-t"
            style={{ borderColor: '#363a45' }}
          >
            <button
              onClick={(e) => {
                setShowWatchlistMenu(false);
                handleCreateWatchlist(e);
              }}
              className="w-full py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              <FolderPlus size={20} />
              Create New Watchlist
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderWatchlistCreateModal = () => {
    if (!showWatchlistCreateModal) return null;

    return (
      <div
        className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4"
        onClick={() => {
          if (watchlistCreateLoading) return;
          setShowWatchlistCreateModal(false);
        }}
      >
        <div
          className="w-full max-w-sm rounded-2xl overflow-hidden"
          style={{
            background: theme === 'light' ? '#ffffff' : '#1e222d',
            border: `1px solid ${theme === 'light' ? '#e2e8f0' : '#363a45'}`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: theme === 'light' ? '#e2e8f0' : '#363a45' }}
          >
            <div>
              <div className="font-bold text-lg" style={{ color: theme === 'light' ? '#1e293b' : '#d1d4dc' }}>
                Create Watchlist
              </div>
              <div className="text-xs mt-1" style={{ color: theme === 'light' ? '#64748b' : '#787b86' }}>
                Add a new watchlist without leaving the quotes screen.
              </div>
            </div>
            <button
              onClick={() => setShowWatchlistCreateModal(false)}
              disabled={watchlistCreateLoading}
            >
              <X size={22} color={theme === 'light' ? '#64748b' : '#787b86'} />
            </button>
          </div>

          <div className="p-4">
            <input
              type="text"
              value={newWatchlistName}
              onChange={(e) => setNewWatchlistName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreateWatchlist();
              }}
              placeholder="Watchlist name"
              autoFocus
              className="w-full px-4 py-3 rounded-lg text-sm"
              style={{
                background: theme === 'light' ? '#f8fafc' : '#131722',
                border: `1px solid ${theme === 'light' ? '#cbd5e1' : '#363a45'}`,
                color: theme === 'light' ? '#1e293b' : '#d1d4dc',
              }}
            />
          </div>

          <div
            className="p-4 border-t flex gap-3"
            style={{ borderColor: theme === 'light' ? '#e2e8f0' : '#363a45' }}
          >
            <button
              onClick={() => setShowWatchlistCreateModal(false)}
              disabled={watchlistCreateLoading}
              className="flex-1 py-3 rounded-lg font-medium"
              style={{
                background: theme === 'light' ? '#f1f5f9' : '#2a2e39',
                color: theme === 'light' ? '#475569' : '#d1d4dc',
              }}
            >
              Cancel
            </button>
            <button
              onClick={submitCreateWatchlist}
              disabled={watchlistCreateLoading}
              className="flex-1 py-3 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ background: '#2962ff' }}
            >
              {watchlistCreateLoading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ QUOTES TAB (render function — NO hooks) ============
  const renderQuotesTab = () => {
    // ── Theme-aware colors ──
    const bg = theme === 'light' ? '#ffffff' : '#1e222d';
    const bgAlt = theme === 'light' ? '#f1f5f9' : '#2a2e39';
    const bgAlt2 = theme === 'light' ? '#f1f5f9' : '#252832';
    const border = theme === 'light' ? '#e2e8f0' : '#363a45';
    const textPrimary = theme === 'light' ? '#1e293b' : '#d1d4dc';
    const textMuted = theme === 'light' ? '#64748b' : '#787b86';

    return (
      <div className="flex flex-col h-full" style={{ background: bg }}>
        {/* ── Fixed Header ── */}
        <div className="p-3 border-b shrink-0" style={{ borderColor: border }}>
          {/* Watchlist Selector */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowWatchlistMenu(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: bgAlt, border: `1px solid ${border}` }}
            >
              <Star size={16} color="#f5c542" />
              <span className="font-medium" style={{ color: textPrimary }}>
                {currentWatchlist?.name || 'Select Watchlist'}
              </span>
              <ChevronDown size={16} color={textMuted} />
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  symbolsFetchedRef.current = false;
                  fetchAllFuturesSymbols();
                }}
                className="p-2 rounded-lg"
                style={{ background: bgAlt }}
                title="Refresh Symbols"
              >
                <RefreshCw size={18} color={textMuted} className={loadingAllSymbols ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={(e) => handleCreateWatchlist(e)}
                className="p-2 rounded-lg"
                style={{ background: '#2962ff' }}
              >
                <Plus size={20} color="#fff" />
              </button>
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex gap-1 overflow-x-auto pb-2">
            {SYMBOL_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
                style={{
                  background: selectedCategory === cat.id ? '#2962ff' : bgAlt,
                  color: selectedCategory === cat.id ? '#fff' : textMuted,
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mt-2">
            <Search
              size={16}
              className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: textMuted, left: '14px' }}
            />
            <input
              ref={quotesSearchInputRef}
              type="text"
              value={quotesLocalSearch}
              onChange={(e) => setQuotesLocalSearch(e.target.value)}
              placeholder="Find symbol"
              className="w-full pr-10 rounded-lg border font-medium"
              style={{
                background: bgAlt,
                borderColor: border,
                color: textPrimary,
                fontSize: '16px',
                paddingLeft: '42px',
                paddingTop: '14px',
                paddingBottom: '14px',
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            {quotesLocalSearch && (
              <button
                onClick={() => { setQuotesLocalSearch(''); quotesSearchInputRef.current?.focus(); }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2"
              >
                <X size={18} color={textMuted} />
              </button>
            )}
          </div>

          {searchTerm && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs" style={{ color: textMuted }}>
                {quotesDisplayedSymbols.length} results for &quot;{searchTerm}&quot;
              </span>
              <span className="text-xs" style={{ color: '#2962ff' }}>Tap to trade</span>
            </div>
          )}

          {(marketStatus?.isHoliday || marketStatus?.marketOpen === false) && (
            <div
              className="mt-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: bgAlt2, border: `1px solid ${border}`, color: textMuted }}
            >
              {marketStatus?.isHoliday
                ? (marketStatus?.message || 'Market holiday')
                : 'Market is currently closed'}
            </div>
          )}
        </div>

        {/* ── Column Headers ── */}
        <div
          className="grid px-3 py-2 text-xs font-semibold border-b shrink-0"
          style={{
            gridTemplateColumns: 'minmax(0, 2.7fr) minmax(76px, 1fr) minmax(76px, 1fr)',
            background: bgAlt2,
            borderColor: border,
            color: textMuted,
          }}
        >
          <div>Symbol</div>
          <div className="text-right">Bid</div>
          <div className="text-right">Ask</div>
        </div>

        {/* ── Symbol List ── */}
        <div className="flex-1 overflow-y-auto">
          {loadingAllSymbols && allFuturesSymbols.length === 0 ? (
            <div className="p-8 text-center" style={{ color: textMuted }}>
              <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
              <div>Loading symbols...</div>
            </div>
          ) : quotesDisplayedSymbols.length === 0 ? (
            <div className="p-8 text-center" style={{ color: textMuted }}>
              {searchTerm ? (
                backendSearchLoading ? (
                  <>
                    <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
                    <div className="text-base">Searching for &quot;{searchTerm}&quot;...</div>
                  </>
                ) : (
                  <>
                    <Search size={48} className="mx-auto mb-3 opacity-30" />
                    <div className="text-base mb-1">No symbols found for &quot;{searchTerm}&quot;</div>
                    <div className="text-sm">Try searching by underlying name (e.g., RELIANCE, TCS, GOLD)</div>
                  </>
                )
              ) : (
                <>
                  <Star size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base mb-1">Watchlist is empty</div>
                  <div className="text-sm">Use the search bar above to find and add symbols</div>
                </>
              )}
            </div>
          ) : (
            quotesDisplayedSymbols.map((sym) => {
              const isSelected = selectedSymbol === sym.symbol;
              const inWL = (activeSymbols || []).includes(String(sym.symbol).toUpperCase());
              const quote = quotes?.[sym.symbol] || sym;
              const symBid = Number(quote.bid || sym.bid || sym.last_price || 0);
              const symAsk = Number(quote.ask || sym.ask || sym.last_price || 0);
              // Correct field names from marketStore updatePrice():
              //   quote.high = from item.high (set by kiteStreamService: dayHigh)
              //   quote.low  = from item.low  (set by kiteStreamService: dayLow)
              // DB fallback: high_price, low_price columns
              const symHigh = Number(
                quote?.high       ||   // live from socket (priceData.high)
                sym.high_price    ||   // DB column
                0
              );
              const symLow = Number(
                quote?.low        ||   // live from socket (priceData.low)
                sym.low_price     ||   // DB column
                0
              );
              const symChange = Number(quote?.change ?? quote?.change_value ?? sym.change_value ?? 0);
              const symChangePercent = Number(quote?.change_percent ?? sym.change_percent ?? 0);
              const marketOpen = !marketStatus?.isHoliday && isMarketOpenNow(sym.symbol);

              const quoteTs = Number(quote?.timestamp || 0);
              const symbolKey = String(sym.symbol).toUpperCase();
              const isSubscribed =
                displayedQuoteSymbolSet.has(symbolKey) ||
                (activeSymbols || []).includes(symbolKey);
              const quoteAgeMs = quoteTs > 0 ? (Date.now() - quoteTs) : Number.POSITIVE_INFINITY;
              const isStale = marketOpen && isSubscribed && quoteAgeMs > QUOTE_STALE_THRESHOLD_MS;
              void staleTick;

              const staleColor = '#9aa0a6';
              const hasAnyPrice = symBid > 0 || symAsk > 0;
              const priceShouldBeGrey = marketStatus?.isHoliday || !marketOpen || isStale || !hasAnyPrice;
              const trendColor = symChange >= 0 ? '#2962ff' : '#ef5350';
              const bidColor = priceShouldBeGrey ? staleColor : trendColor;
              const askColor = priceShouldBeGrey ? staleColor : trendColor;
              const changeColor = priceShouldBeGrey ? staleColor : trendColor;
              const nameColor = textPrimary;
              const statusLabel = marketStatus?.isHoliday
                ? (marketStatus?.message || 'Holiday')
                : (!marketOpen ? 'Closed' : (isStale ? 'Off Quotes' : ''));

              const getMonthAbbr = (dateStr) => {
                if (!dateStr) return '';
                const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
                const d = new Date(dateStr);
                return months[d.getMonth()] || '';
              };

              let base = (sym.underlying || sym.symbol || '').toUpperCase()
                .replace(/\d{2}[A-Z]{3}FUT$/i, '')
                .replace(/FUT$/i, '')
                .replace(/-I+$/, '')
                .replace(/-$/, '');

              const displaySymbol = sym.expiry_date
                ? `${base}-${getMonthAbbr(sym.expiry_date)}`
                : base;

              const expiry = sym.expiry_date
                ? new Date(sym.expiry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                : '';

              return (
                <div
                  key={sym.symbol}
                  onClick={(e) => handleSymbolTap(sym, e)}
                  className="grid items-center px-3 py-3 border-b cursor-pointer"
                  style={{
                    gridTemplateColumns: 'minmax(0, 2.7fr) minmax(76px, 1fr) minmax(76px, 1fr)',
                    background: isSelected ? bgAlt : 'transparent',
                    borderColor: border,
                    borderLeft: isSelected ? '3px solid #2962ff' : '3px solid transparent',
                    opacity: 1,
                  }}
                >
                  {/* Symbol Column */}
                  <div className="flex items-start gap-2 min-w-0">
                    <Star
                      size={14}
                      color={inWL ? '#f5c542' : textMuted}
                      fill={inWL ? '#f5c542' : 'none'}
                      onClick={(e) => { e.stopPropagation(); toggleSymbolInWatchlist(sym.symbol); }}
                      className="shrink-0 cursor-pointer mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold leading-tight" style={{ color: nameColor, fontSize: '14px', lineHeight: '18px', wordBreak: 'break-word' }}>
                        {displaySymbol}
                      </div>
                      <div className="flex items-center gap-1" style={{ marginTop: '2px' }}>
                        <span
                          className="font-semibold"
                          style={{ color: changeColor, fontSize: '12px' }}
                        >
                          {symChange >= 0 ? '+' : ''}{symChange.toFixed(2)}
                        </span>
                        <span
                          className="font-medium"
                          style={{ color: changeColor, fontSize: '12px' }}
                        >
                          ({symChangePercent >= 0 ? '+' : ''}{symChangePercent.toFixed(2)}%)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-nowrap overflow-hidden" style={{ marginTop: '2px' }}>
                        {statusLabel && (
                          <span style={{ color: staleColor, fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel}</span>
                        )}
                        {expiry && (
                          <span style={{ color: textMuted, fontSize: '10px', whiteSpace: 'nowrap' }}>{expiry}</span>
                        )}
                        {sym.lot_size && (
                          <span style={{ color: '#f5c542', fontSize: '10px', whiteSpace: 'nowrap' }}>Lot:{sym.lot_size}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-nowrap overflow-hidden" style={{ marginTop: '3px' }}>
                        <span className="font-mono shrink-0" style={{ fontSize: '10px', color: textMuted, whiteSpace: 'nowrap' }}>
                          L: <span style={{ color: textMuted, fontWeight: 600 }}>{symLow > 0 ? symLow.toFixed(2) : '—'}</span>
                        </span>
                        <span className="font-mono shrink-0" style={{ fontSize: '10px', color: textMuted, whiteSpace: 'nowrap' }}>
                          H: <span style={{ color: textMuted, fontWeight: 600 }}>{symHigh > 0 ? symHigh.toFixed(2) : '—'}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Bid */}
                  <div className="text-right">
                    <div className="font-bold font-mono" style={{ fontSize: '15px', lineHeight: '20px', color: bidColor }}>
                      {symBid > 0 ? symBid.toFixed(2) : '—'}
                    </div>
                  </div>

                  {/* Ask */}
                  <div className="text-right">
                    <div className="font-bold font-mono" style={{ fontSize: '15px', lineHeight: '20px', color: askColor }}>
                      {symAsk > 0 ? symAsk.toFixed(2) : '—'}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {renderSymbolActionMenu()}
        {renderWatchlistMenu()}
      </div>
    );
  };

  // ══════════════════════════════════════════════════════════════
  //  ADD THESE to the state section in Part 1 (after existing state declarations)
  // ══════════════════════════════════════════════════════════════

  // Modify modal SL/TP (lifted from ModifyPositionModal)
  const [modifySL, setModifySL] = useState('');
  const [modifyTP, setModifyTP] = useState('');
  const [showBalance, setShowBalance] = useState(true);

  // ── Order execution types (for new order modal) ──
  const [orderExecType, setOrderExecType] = useState('instant');
  // instant | buy_limit | sell_limit | buy_stop | sell_stop
  const [limitPrice, setLimitPrice] = useState('');
  const [deviation, setDeviation] = useState(10);

  // ── History tab: calendar dropdown + orders sub-tab ──
  const [showHistoryCalendar, setShowHistoryCalendar] = useState(false);
  const historyCalendarRef = useRef(null);

  // ── Deals symbol filter ──
  const [dealsSymbolFilter, setDealsSymbolFilter] = useState('');
  const [showDealsSymbolDropdown, setShowDealsSymbolDropdown] = useState(false);
  const dealsDropdownRef = useRef(null);

  // Reset modify-pending values when modal opens
  useEffect(() => {
    if (modifyPendingModal) {
      setModifyPendingPrice(Number(modifyPendingModal.price || 0).toFixed(2));
      setModifyPendingSL(modifyPendingModal.stop_loss || '');
      setModifyPendingTP(modifyPendingModal.take_profit || '');
    }
  }, [modifyPendingModal]);

  // Fetch pending order history for Orders sub-tab
  useEffect(() => {
    if (activeTab === 'history' && historyViewMode === 'orders' && selectedAccount?.id) {
      fetchPendingOrderHistory(selectedAccount.id);
    }
  }, [activeTab, historyViewMode, selectedAccount, fetchPendingOrderHistory]);

  // History memos (lifted from HistoryTab)
  const historyUniqueSymbols = useMemo(() => {
    const syms = new Set((filteredHistoryTrades || []).map((t) => t.symbol));
    return Array.from(syms).sort();
  }, [filteredHistoryTrades]);

  const historyDisplayTrades = useMemo(() => {
    if (!historyLocalSymbolFilter) return filteredHistoryTrades;
    return filteredHistoryTrades.filter(
      (t) => t.symbol === historyLocalSymbolFilter
    );
  }, [filteredHistoryTrades, historyLocalSymbolFilter]);

  const historyPositionGroups = useMemo(
    () => buildHistoryPositionGroups(historyDisplayTrades),
    [historyDisplayTrades]
  );

  const historyOverallStats = useMemo(() => {
    const totalProfit = historyPositionGroups
      .filter((group) => group.totalProfit > 0)
      .reduce((sum, group) => sum + group.totalProfit, 0);
    const totalLoss = Math.abs(
      historyPositionGroups
        .filter((group) => group.totalProfit < 0)
        .reduce((sum, group) => sum + group.totalProfit, 0)
    );
    const netPnL = historyPositionGroups.reduce(
      (sum, group) => sum + group.totalProfit,
      0
    );
    return { totalProfit, totalLoss, netPnL, count: historyPositionGroups.length };
  }, [historyPositionGroups]);

  // ═══ ADD THESE 3 BLOCKS RIGHT HERE ═══

  // ── Deals unique symbols for filter ──
  const dealsUniqueSymbols = useMemo(() => {
    const syms = new Set((deals || []).map((d) => d.symbol).filter(Boolean));
    return Array.from(syms).sort();
  }, [deals]);

  // ── Filtered deals ──
  const filteredDeals = useMemo(() => {
    if (!dealsSymbolFilter) return deals || [];
    return (deals || []).filter((d) => d.symbol === dealsSymbolFilter);
  }, [deals, dealsSymbolFilter]);

  const currentDealsSummary = useMemo(() => {
    if (!dealsSummary) {
      return null;
    }

    if (!dealsSymbolFilter) {
      return dealsSummary;
    }

    const exitDeals = filteredDeals.filter((deal) => deal.source === 'trade' && deal.side === 'exit');

    return {
      totalProfit: exitDeals
        .filter((deal) => Number(deal.amount || 0) > 0)
        .reduce((sum, deal) => sum + Number(deal.amount || 0), 0),
      totalLoss: Math.abs(
        exitDeals
          .filter((deal) => Number(deal.amount || 0) < 0)
          .reduce((sum, deal) => sum + Number(deal.amount || 0), 0),
      ),
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalCommission: filteredDeals.reduce(
        (sum, deal) => sum + Number(deal.commission || deal.brokerage || 0),
        0,
      ),
      balanceSettled: 0,
      currentBalance: Number(dealsSummary.currentBalance || 0),
    };
  }, [dealsSummary, filteredDeals, dealsSymbolFilter]);

  const formatPdfCurrency = (value) => {
    const numericValue = Number(value || 0);
    return `INR ${Math.abs(numericValue).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatSignedPdfCurrency = (value) => {
    const numericValue = Number(value || 0);
    const prefix = numericValue > 0 ? '+' : numericValue < 0 ? '-' : '';
    return `${prefix}${formatPdfCurrency(numericValue)}`;
  };

  const formatPdfDateTime = (value) => {
    if (!value) {
      return 'Unknown Time';
    }

    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const handleExportDealsPdf = async () => {
    if (!filteredDeals.length) {
      toast.error('No deals available for this filter');
      return;
    }

    const periodLabel =
      HISTORY_PERIODS.find((periodOption) => periodOption.id === historyPeriod)?.label ||
      historyPeriod;
    const symbolLabel = dealsSymbolFilter
      ? formatDisplaySymbol(dealsSymbolFilter, allFuturesSymbols)
      : 'All Symbols';
    const exportedAt = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const entries = filteredDeals.map((deal) => {
      const commission = Number(deal.commission || deal.brokerage || 0);
      const isEntryDeal = deal.source === 'trade' && deal.side === 'entry';
      const rawAmount = Number(isEntryDeal ? 0 : (deal.amount ?? deal.profit ?? 0));
      const dealTime = deal.time || deal.close_time || deal.open_time || deal.created_at;
      const dealPrice = Number(deal.price || deal.open_price || deal.close_price || 0);
      const dealLabel =
        deal.dealLabel ||
        (deal.type ? String(deal.type).replace(/_/g, ' ').toUpperCase() : 'DEAL');
      const symbolLabelText = deal.symbol
        ? formatDisplaySymbol(deal.symbol, allFuturesSymbols)
        : dealLabel;

      const lines = [`${formatPdfDateTime(dealTime)} | ${symbolLabelText} | ${dealLabel}`];
      const metaParts = [];

      if (deal.quantity !== null && deal.quantity !== undefined) {
        metaParts.push(`Qty: ${deal.quantity}`);
      }
      if (dealPrice > 0) {
        metaParts.push(`Price: ${dealPrice.toFixed(2)}`);
      }
      if (!isEntryDeal) {
        metaParts.push(`Amount: ${formatSignedPdfCurrency(rawAmount)}`);
      }
      if (metaParts.length) {
        lines.push(metaParts.join(' | '));
      }
      if (commission > 0) {
        lines.push(`Commission: ${formatPdfCurrency(commission)}`);
      }
      if (deal.balance_after !== undefined && deal.balance_after !== null) {
        lines.push(`Balance After: ${formatPdfCurrency(Number(deal.balance_after || 0))}`);
      }
      if (deal.description) {
        lines.push(`Note: ${deal.description}`);
      }

      return { lines };
    });

    try {
      const result = await exportDealsPdf({
        fileName: `trade-axis-deals-${String(historyPeriod).toLowerCase().replace(/[^a-z0-9]+/g, '-')}${
          dealsSymbolFilter
            ? `-${String(dealsSymbolFilter).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
            : ''
        }.pdf`,
        title: 'Trade Axis Deals Report',
        subtitleLines: [
          `Period: ${periodLabel}`,
          `Symbol Filter: ${symbolLabel}`,
          `Exported At: ${exportedAt}`,
        ],
        summaryLines: currentDealsSummary
          ? [
              `Profit: ${formatPdfCurrency(currentDealsSummary.totalProfit || 0)} | Loss: ${formatPdfCurrency(currentDealsSummary.totalLoss || 0)}`,
              `Deposits: ${formatPdfCurrency(currentDealsSummary.totalDeposits || 0)} | Withdrawals: ${formatPdfCurrency(currentDealsSummary.totalWithdrawals || 0)}`,
              `Commission: ${formatPdfCurrency(currentDealsSummary.totalCommission || 0)} | Balance Settled: ${formatSignedPdfCurrency(currentDealsSummary.balanceSettled || 0)}`,
              `Current Balance: ${formatPdfCurrency(currentDealsSummary.currentBalance || 0)}`,
            ]
          : [],
        entries,
      });

      toast.success(
        result?.method === 'share'
          ? 'Deals PDF ready to share'
          : result?.method === 'preview'
          ? 'Deals PDF opened'
          : 'Deals PDF download started',
      );
    } catch (error) {
      if (error?.name === 'AbortError') {
        return;
      }

      console.error('Deals PDF export failed:', error);
      toast.error('Failed to export deals PDF');
    }
  };

  // ── Position aggregates for history ──
  const positionAggregates = useMemo(() => {
    const totalBuyQty = historyPositionGroups.reduce(
      (sum, group) => sum + Number(group.buyQty || 0),
      0
    );
    const totalSellQty = historyPositionGroups.reduce(
      (sum, group) => sum + Number(group.sellQty || 0),
      0
    );
    return { totalBuyQty, totalSellQty };
  }, [historyPositionGroups]);

  // ══════════════════════════════════════════════════════════════
  //  RENDER FUNCTIONS (continued from Part 1)
  // ══════════════════════════════════════════════════════════════

  // ============ CHART TAB ============
  const renderChartTab = () => {
    const chartHeight = chartFullscreen ? window.innerHeight - 140 : 300;

    return (
      <div
        className={`flex flex-col h-full ${chartFullscreen ? 'fixed inset-0 z-50' : ''}`}
        style={{ background: '#131722' }}
      >
        <div
          className="flex items-center justify-between p-3 border-b"
          style={{ borderColor: '#363a45', background: '#1e222d' }}
        >
          <div className="flex items-center gap-3">
            <span className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
              {selectedSymbol}
            </span>
            <span className="text-base" style={{ color: '#787b86' }}>
              {bid ? `Bid ${bid.toFixed(2)}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCrosshairEnabled((v) => !v)}
              className="p-2 rounded"
              style={{
                background: crosshairEnabled ? '#2962ff' : 'transparent',
              }}
              title="Crosshair"
            >
              <Crosshair
                size={18}
                color={crosshairEnabled ? '#fff' : '#787b86'}
              />
            </button>
            <button
              onClick={() => setChartFullscreen((v) => !v)}
              className="p-2 rounded"
              title="Fullscreen"
            >
              {chartFullscreen ? (
                <Minimize2 size={18} color="#787b86" />
              ) : (
                <Maximize2 size={18} color="#787b86" />
              )}
            </button>
          </div>
        </div>

        <div
          className="flex items-center gap-1 p-2 overflow-x-auto border-b"
          style={{ borderColor: '#363a45', background: '#1e222d' }}
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.value)}
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{
                background:
                  timeframe === tf.value ? '#2962ff' : 'transparent',
                color: timeframe === tf.value ? '#fff' : '#787b86',
              }}
            >
              {tf.label}
            </button>
          ))}

          <div
            className="h-4 w-px mx-2"
            style={{ background: '#363a45' }}
          />

          {CHART_TYPES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => setChartMode(ct.id)}
              className="px-3 py-1.5 rounded text-sm font-medium"
              style={{
                background:
                  chartMode === ct.id ? '#2962ff' : 'transparent',
                color: chartMode === ct.id ? '#fff' : '#787b86',
              }}
            >
              {ct.label}
            </button>
          ))}
        </div>

        <div className="flex-1 relative">
          <PriceChart
            symbol={selectedSymbol}
            timeframe={timeframe}
            mode={chartMode}
            height={chartHeight}
            crosshairEnabled={crosshairEnabled}
          />

          <div
            className="absolute left-4 right-4 rounded-lg p-3"
            style={{
              bottom: chartFullscreen ? 12 : 8,
              background: 'rgba(30, 34, 45, 0.97)',
              border: '1px solid #363a45',
              zIndex: 10,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-sm font-medium"
                style={{ color: '#787b86' }}
              >
                Quantity
              </span>
              <input
                type="number"
                value={quantity}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') setQuantity('');
                  else setQuantity(Math.max(1, Number(raw)));
                }}
                onBlur={() => {
                  if (!quantity || Number(quantity) < 1) setQuantity(1);
                }}
                className="w-24 px-3 py-1.5 rounded text-base text-center font-medium"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
                min="1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => placeOrderWithQty('sell', quantity)}
                className="py-3.5 rounded-lg font-bold text-white text-lg"
                style={{ background: '#ef5350' }}
              >
                SELL {bid.toFixed(2)}
              </button>
              <button
                onClick={() => placeOrderWithQty('buy', quantity)}
                className="py-3.5 rounded-lg font-bold text-white text-lg"
                style={{ background: '#26a69a' }}
              >
                BUY {ask.toFixed(2)}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============ ORDER MODAL ============
  const renderOrderModal = () => {
    if (!showOrderModal) return null;

    const ORDER_EXEC_TYPES = [
      { id: 'instant', label: 'Instant Execution' },
      { id: 'buy_limit', label: 'Buy Limit' },
      { id: 'sell_limit', label: 'Sell Limit' },
      { id: 'buy_stop', label: 'Buy Stop' },
      { id: 'sell_stop', label: 'Sell Stop' },
    ];

    const isInstant = orderExecType === 'instant';
    const needsPrice = !isInstant;

    // For limit/stop orders, infer direction
    const inferredType =
      orderExecType === 'buy_limit' || orderExecType === 'buy_stop' ? 'buy' :
      orderExecType === 'sell_limit' || orderExecType === 'sell_stop' ? 'sell' :
      null;

    // Tick size for +/- buttons
    const currentSymbolData = (symbols || []).find((s) => s.symbol === selectedSymbol);
    const tickSize = Number(currentSymbolData?.tick_size || 0.05);

    // SL/TP step helpers
    const stepSL = (dir) => {
      const current = Number(stopLoss) || bid || 0;
      setStopLoss((current + dir * tickSize).toFixed(2));
    };
    const stepTP = (dir) => {
      const current = Number(takeProfit) || ask || 0;
      setTakeProfit((current + dir * tickSize).toFixed(2));
    };
    const stepPrice = (dir) => {
      const current = Number(limitPrice) || (inferredType === 'buy' ? ask : bid) || 0;
      setLimitPrice((current + dir * tickSize).toFixed(2));
    };

    return (
      <div
        className="fixed inset-0 bg-black/70 flex items-center justify-center p-4"
        style={{ zIndex: 10000 }}
        onClick={() => setShowOrderModal(false)}
      >
        <div
          className="w-full max-w-md rounded-xl max-h-[85vh] flex flex-col overflow-hidden"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div
            className="flex items-center justify-between p-4 border-b shrink-0"
            style={{ borderColor: '#363a45' }}
          >
            <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
              Order
            </h3>
            <button onClick={() => setShowOrderModal(false)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          {/* ── Scrollable Body ── */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* ── Symbol Display ── */}
            <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-base" style={{ color: '#d1d4dc' }}>
                    {selectedSymbol}
                  </div>
                  <div className="text-xs" style={{ color: '#787b86' }}>
                    {currentSymbolData?.display_name || ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="text-[10px]" style={{ color: '#787b86' }}>Bid</div>
                      <div className="font-bold text-sm" style={{ color: '#ef5350' }}>
                        {bid.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px]" style={{ color: '#787b86' }}>Ask</div>
                      <div className="font-bold text-sm" style={{ color: '#26a69a' }}>
                        {ask.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Execution Type Dropdown ── */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                Type
              </label>
              <select
                value={orderExecType}
                onChange={(e) => {
                  setOrderExecType(e.target.value);
                  setLimitPrice('');
                }}
                className="w-full px-3 py-2.5 rounded-lg text-sm appearance-none cursor-pointer"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23787b86' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                }}
              >
                {ORDER_EXEC_TYPES.map((ot) => (
                  <option key={ot.id} value={ot.id}>{ot.label}</option>
                ))}
              </select>
            </div>

            {/* ── Volume (Quantity) ── */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                Volume
              </label>
              <div className="flex items-center gap-0">
                <button
                  onClick={() => setQuantity(Math.max(1, (Number(quantity) || 1) - 1))}
                  className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      setQuantity('');
                    } else {
                      setQuantity(Math.max(1, Number(raw)));
                    }
                  }}
                  onBlur={() => {
                    if (!quantity || Number(quantity) < 1) setQuantity(1);
                  }}
                  className="flex-1 h-10 px-2 text-center text-base font-bold"
                  style={{
                    background: '#2a2e39',
                    border: '1px solid #363a45',
                    borderLeft: 'none',
                    borderRight: 'none',
                    color: '#d1d4dc',
                  }}
                  min="1"
                />
                <button
                  onClick={() => setQuantity((Number(quantity) || 0) + 1)}
                  className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  +
                </button>
              </div>
              <div className="flex gap-1 mt-1.5">
                {[1, 5, 10, 25, 50, 100].map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className="flex-1 py-1 rounded text-[11px] font-medium"
                    style={{
                      background: quantity === q ? '#2962ff' : '#2a2e39',
                      color: quantity === q ? '#fff' : '#787b86',
                      border: `1px solid ${quantity === q ? '#2962ff' : '#363a45'}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Price (only for Limit/Stop orders) ── */}
            {needsPrice && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                  Price
                  {orderExecType === 'buy_limit' && (
                    <span className="ml-1" style={{ color: '#f5c542' }}>
                      (≤ {(ask * 0.995).toFixed(2)})
                    </span>
                  )}
                  {orderExecType === 'sell_limit' && (
                    <span className="ml-1" style={{ color: '#f5c542' }}>
                      (≥ {(bid * 1.005).toFixed(2)})
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-0">
                  <button
                    onClick={() => stepPrice(-1)}
                    className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                    style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder={
                      orderExecType === 'buy_limit' ? (ask * 0.995).toFixed(2) :
                      orderExecType === 'sell_limit' ? (bid * 1.005).toFixed(2) :
                      orderExecType === 'buy_stop' ? (ask * 1.005).toFixed(2) :
                      (bid * 0.995).toFixed(2)
                    }
                    className="flex-1 h-10 px-2 text-center text-base font-bold"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      borderLeft: 'none',
                      borderRight: 'none',
                      color: '#d1d4dc',
                    }}
                  />
                  <button
                    onClick={() => stepPrice(1)}
                    className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0"
                    style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* ── Stop Loss ── */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                Stop Loss
              </label>
              <div className="flex items-center gap-0">
                <button
                  onClick={() => stepSL(-1)}
                  className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 h-10 px-2 text-center text-base font-bold"
                  style={{
                    background: '#2a2e39',
                    border: '1px solid #363a45',
                    borderLeft: 'none',
                    borderRight: 'none',
                    color: '#d1d4dc',
                  }}
                />
                <button
                  onClick={() => stepSL(1)}
                  className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* ── Take Profit ── */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                Take Profit
              </label>
              <div className="flex items-center gap-0">
                <button
                  onClick={() => stepTP(-1)}
                  className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={takeProfit}
                  onChange={(e) => setTakeProfit(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 h-10 px-2 text-center text-base font-bold"
                  style={{
                    background: '#2a2e39',
                    border: '1px solid #363a45',
                    borderLeft: 'none',
                    borderRight: 'none',
                    color: '#d1d4dc',
                  }}
                />
                <button
                  onClick={() => stepTP(1)}
                  className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* ── Deviation (only for Instant Execution) ── */}
            {isInstant && (
              <div>
                <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                  Deviation (points)
                </label>
                <div className="flex items-center gap-0">
                  <button
                    onClick={() => setDeviation(Math.max(0, deviation - 1))}
                    className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                    style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={deviation}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setDeviation('');
                      } else {
                        setDeviation(Math.max(0, Number(raw)));
                      }
                    }}
                    onBlur={() => {
                      if (deviation === '' || isNaN(Number(deviation))) setDeviation(0);
                    }}
                    className="flex-1 h-10 px-2 text-center text-base font-bold"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      borderLeft: 'none',
                      borderRight: 'none',
                      color: '#d1d4dc',
                    }}
                    min="0"
                  />
                  <button
                    onClick={() => setDeviation(deviation + 1)}
                    className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0"
                    style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* ── Comment (optional, like MT5) ── */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>
                Comment
              </label>
              <input
                type="text"
                placeholder=""
                className="w-full px-3 py-2.5 rounded-lg text-sm"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
              />
            </div>

          </div>

          {/* ── Sticky Footer — Buy/Sell Buttons ── */}
          <div
            className="p-4 border-t shrink-0"
            style={{ borderColor: '#363a45', background: '#1e222d' }}
          >
            {closingMode ? (
              <div className="p-3 rounded-lg flex items-center gap-2" style={{ background: '#ff980020' }}>
                <Lock size={16} color="#ff9800" />
                <span className="text-sm" style={{ color: '#ff9800' }}>
                  Closing mode — new orders disabled
                </span>
              </div>
            ) : isInstant ? (
              <>
                {/* Instant Execution — Two buttons side by side like MT5 */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => placeOrderWithQty('sell', quantity)}
                    className="py-3.5 rounded-lg font-bold text-white flex flex-col items-center"
                    style={{ background: '#ef5350' }}
                  >
                    <span className="text-xs font-normal opacity-80">Sell by Market</span>
                    <span className="text-lg">{bid.toFixed(2)}</span>
                  </button>
                  <button
                    onClick={() => placeOrderWithQty('buy', quantity)}
                    className="py-3.5 rounded-lg font-bold text-white flex flex-col items-center"
                    style={{ background: '#26a69a' }}
                  >
                    <span className="text-xs font-normal opacity-80">Buy by Market</span>
                    <span className="text-lg">{ask.toFixed(2)}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Limit/Stop — Single place button */}
                <button
                  onClick={() => {
                    const dir = inferredType;
                    if (!dir) return toast.error('Select an order type');
                    placeOrderWithQty(dir, quantity, orderExecType, limitPrice);
                  }}
                  className="w-full py-3.5 rounded-lg font-bold text-white text-base"
                  style={{
                    background: inferredType === 'buy' ? '#26a69a' : '#ef5350',
                  }}
                >
                  Place {ORDER_EXEC_TYPES.find((o) => o.id === orderExecType)?.label || ''}
                </button>

                {/* Validation hint */}
                {orderExecType === 'buy_limit' && (
                  <div className="text-xs mt-2 text-center" style={{ color: '#787b86' }}>
                    Price must be below {(ask * 0.995).toFixed(2)} (0.5% below Ask)
                  </div>
                )}
                {orderExecType === 'sell_limit' && (
                  <div className="text-xs mt-2 text-center" style={{ color: '#787b86' }}>
                    Price must be above {(bid * 1.005).toFixed(2)} (0.5% above Bid)
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // // ============ MODIFY POSITION MODAL ============
  // const renderModifyPositionModal = () => {
  //   if (!modifyModal) return null;

  //   const trade = modifyModal;
  //   const currentPrice = Number(
  //     trade.current_price || trade.open_price || 0
  //   );
  //   const leverage = accountStats.leverage || 5;
  //   const estimatedMargin =
  //     addQty > 0 ? (currentPrice * addQty) / leverage : 0;

  //   const handleAddQuantity = async () => {
  //     if (!addQty || addQty <= 0) {
  //       return toast.error('Enter a valid quantity');
  //     }

  //     setAddQtyLoading(true);
  //     const result = await addQuantity(
  //       trade.id,
  //       selectedAccount?.id,
  //       addQty
  //     );
  //     setAddQtyLoading(false);

  //     if (result.success) {
  //       toast.success(result.message);
  //       setModifyModal(null);
  //       fetchOpenTrades(selectedAccount.id);
  //     } else {
  //       toast.error(result.message || 'Failed to add quantity');
  //     }
  //   };

  //   return (
  //     <div
  //       className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
  //       onClick={() => setModifyModal(null)}
  //     >
  //       <div
  //         className="w-full max-w-sm rounded-xl"
  //         style={{
  //           background: '#1e222d',
  //           border: '1px solid #363a45',
  //         }}
  //         onClick={(e) => e.stopPropagation()}
  //       >
  //         <div
  //           className="flex items-center justify-between p-4 border-b"
  //           style={{ borderColor: '#363a45' }}
  //         >
  //           <h3
  //             className="font-bold text-lg"
  //             style={{ color: '#d1d4dc' }}
  //           >
  //             Modify Position
  //           </h3>
  //           <button onClick={() => setModifyModal(null)}>
  //             <X size={22} color="#787b86" />
  //           </button>
  //         </div>

  //         <div className="p-4 pb-0">
  //           <div
  //             className="p-3 rounded-lg"
  //             style={{ background: '#2a2e39' }}
  //           >
  //             <div className="text-sm" style={{ color: '#787b86' }}>
  //               Symbol
  //             </div>
  //             <div
  //               className="font-bold text-lg"
  //               style={{ color: '#d1d4dc' }}
  //             >
  //               {trade.symbol}
  //             </div>
  //             <div className="flex items-center justify-between mt-1">
  //               <span
  //                 className="text-sm"
  //                 style={{
  //                   color:
  //                     trade.trade_type === 'buy'
  //                       ? '#26a69a'
  //                       : '#ef5350',
  //                 }}
  //               >
  //                 {trade.trade_type?.toUpperCase()} • Qty:{' '}
  //                 {trade.quantity}
  //               </span>
  //               <span
  //                 className="text-sm"
  //                 style={{ color: '#787b86' }}
  //               >
  //                 @ {formatINR(trade.open_price)}
  //               </span>
  //             </div>
  //           </div>
  //         </div>

  //         <div
  //           className="flex mx-4 mt-3 rounded-lg overflow-hidden"
  //           style={{ border: '1px solid #363a45' }}
  //         >
  //           <button
  //             type="button"
  //             onClick={() => setModifyTab('sltp')}
  //             className="flex-1 py-2.5 text-sm font-medium transition-colors"
  //             style={{
  //               background:
  //                 modifyTab === 'sltp' ? '#2962ff' : '#2a2e39',
  //               color: modifyTab === 'sltp' ? '#fff' : '#787b86',
  //             }}
  //           >
  //             SL / TP
  //           </button>
  //           <button
  //             type="button"
  //             onClick={() => setModifyTab('addqty')}
  //             className="flex-1 py-2.5 text-sm font-medium transition-colors"
  //             style={{
  //               background:
  //                 modifyTab === 'addqty' ? '#2962ff' : '#2a2e39',
  //               color: modifyTab === 'addqty' ? '#fff' : '#787b86',
  //             }}
  //           >
  //             + Add Quantity
  //           </button>
  //         </div>

  //         <div className="p-4 space-y-4">
  //           {modifyTab === 'sltp' && (
  //             <>
  //               <div>
  //                 <label
  //                   className="block text-sm mb-2"
  //                   style={{ color: '#787b86' }}
  //                 >
  //                   Stop Loss
  //                 </label>
  //                 <input
  //                   type="number"
  //                   value={modifySL}
  //                   onChange={(e) => setModifySL(e.target.value)}
  //                   className="w-full px-4 py-3 rounded-lg text-base"
  //                   style={{
  //                     background: '#2a2e39',
  //                     border: '1px solid #363a45',
  //                     color: '#d1d4dc',
  //                   }}
  //                   placeholder="0.00"
  //                 />
  //               </div>
  //               <div>
  //                 <label
  //                   className="block text-sm mb-2"
  //                   style={{ color: '#787b86' }}
  //                 >
  //                   Take Profit
  //                 </label>
  //                 <input
  //                   type="number"
  //                   value={modifyTP}
  //                   onChange={(e) => setModifyTP(e.target.value)}
  //                   className="w-full px-4 py-3 rounded-lg text-base"
  //                   style={{
  //                     background: '#2a2e39',
  //                     border: '1px solid #363a45',
  //                     color: '#d1d4dc',
  //                   }}
  //                   placeholder="0.00"
  //                 />
  //               </div>
  //               <button
  //                 onClick={() =>
  //                   handleModifyTrade(trade.id, modifySL, modifyTP)
  //                 }
  //                 className="w-full py-3.5 rounded-lg font-semibold text-base"
  //                 style={{ background: '#2962ff', color: '#fff' }}
  //               >
  //                 Modify SL / TP
  //               </button>
  //             </>
  //           )}

  //           {modifyTab === 'addqty' && (
  //             <>
  //               {closingMode && (
  //                 <div
  //                   className="p-3 rounded-lg flex items-center gap-2"
  //                   style={{
  //                     background: '#ff980020',
  //                     border: '1px solid #ff980050',
  //                   }}
  //                 >
  //                   <AlertTriangle size={18} color="#ff9800" />
  //                   <div
  //                     className="text-sm"
  //                     style={{ color: '#ff9800' }}
  //                   >
  //                     Closing mode is active. You cannot add quantity.
  //                   </div>
  //                 </div>
  //               )}

  //               {!closingMode && (
  //                 <>
  //                   <div>
  //                     <label
  //                       className="block text-sm mb-2"
  //                       style={{ color: '#787b86' }}
  //                     >
  //                       Additional Quantity
  //                     </label>
  //                     <div className="flex items-center gap-2">
  //                       <button
  //                         type="button"
  //                         onClick={() =>
  //                           setAddQty(Math.max(1, addQty - 1))
  //                         }
  //                         className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
  //                         style={{
  //                           background: '#2a2e39',
  //                           border: '1px solid #363a45',
  //                           color: '#d1d4dc',
  //                         }}
  //                       >
  //                         −
  //                       </button>
  //                       <input
  //                         type="number"
  //                         value={addQty}
  //                         onChange={(e) =>
  //                           setAddQty(
  //                             Math.max(
  //                               1,
  //                               Number(e.target.value || 1)
  //                             )
  //                           )
  //                         }
  //                         className="flex-1 px-4 py-3 rounded-lg text-xl font-bold text-center"
  //                         style={{
  //                           background: '#2a2e39',
  //                           border: '1px solid #363a45',
  //                           color: '#d1d4dc',
  //                         }}
  //                         min="1"
  //                       />
  //                       <button
  //                         type="button"
  //                         onClick={() => setAddQty(addQty + 1)}
  //                         className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
  //                         style={{
  //                           background: '#2a2e39',
  //                           border: '1px solid #363a45',
  //                           color: '#d1d4dc',
  //                         }}
  //                       >
  //                         +
  //                       </button>
  //                     </div>
  //                   </div>

  //                   <div className="flex gap-2">
  //                     {[1, 5, 10, 25, 50].map((q) => (
  //                       <button
  //                         key={q}
  //                         type="button"
  //                         onClick={() => setAddQty(q)}
  //                         className="flex-1 py-2 rounded-lg text-sm font-medium"
  //                         style={{
  //                           background:
  //                             addQty === q ? '#2962ff' : '#2a2e39',
  //                           color:
  //                             addQty === q ? '#fff' : '#787b86',
  //                           border: '1px solid #363a45',
  //                         }}
  //                       >
  //                         {q}
  //                       </button>
  //                     ))}
  //                   </div>

  //                   <div
  //                     className="p-3 rounded-lg space-y-2"
  //                     style={{
  //                       background: '#252832',
  //                       border: '1px solid #363a45',
  //                     }}
  //                   >
  //                     <div className="flex justify-between text-sm">
  //                       <span style={{ color: '#787b86' }}>
  //                         Current Price
  //                       </span>
  //                       <span style={{ color: '#d1d4dc' }}>
  //                         {formatINR(currentPrice)}
  //                       </span>
  //                     </div>
  //                     <div className="flex justify-between text-sm">
  //                       <span style={{ color: '#787b86' }}>
  //                         Add Quantity
  //                       </span>
  //                       <span style={{ color: '#d1d4dc' }}>
  //                         {addQty}
  //                       </span>
  //                     </div>
  //                     <div className="flex justify-between text-sm">
  //                       <span style={{ color: '#787b86' }}>
  //                         Est. Additional Margin
  //                       </span>
  //                       <span style={{ color: '#f5c542' }}>
  //                         {formatINR(estimatedMargin)}
  //                       </span>
  //                     </div>
  //                     <div
  //                       className="flex justify-between text-sm pt-2 border-t"
  //                       style={{ borderColor: '#363a45' }}
  //                     >
  //                       <span style={{ color: '#787b86' }}>
  //                         New Total Qty
  //                       </span>
  //                       <span
  //                         className="font-bold"
  //                         style={{ color: '#d1d4dc' }}
  //                       >
  //                         {Number(trade.quantity) + addQty}
  //                       </span>
  //                     </div>
  //                     <div className="flex justify-between text-sm">
  //                       <span style={{ color: '#787b86' }}>
  //                         Free Margin
  //                       </span>
  //                       <span
  //                         style={{
  //                           color:
  //                             accountStats.freeMargin >=
  //                             estimatedMargin
  //                               ? '#26a69a'
  //                               : '#ef5350',
  //                         }}
  //                       >
  //                         {formatINR(accountStats.freeMargin)}
  //                       </span>
  //                     </div>
  //                   </div>

  //                   {estimatedMargin > accountStats.freeMargin && (
  //                     <div
  //                       className="p-2 rounded-lg flex items-center gap-2"
  //                       style={{ background: '#ef535020' }}
  //                     >
  //                       <AlertTriangle size={16} color="#ef5350" />
  //                       <span
  //                         className="text-xs"
  //                         style={{ color: '#ef5350' }}
  //                       >
  //                         Insufficient free margin
  //                       </span>
  //                     </div>
  //                   )}

  //                   <button
  //                     type="button"
  //                     onClick={handleAddQuantity}
  //                     disabled={
  //                       addQtyLoading ||
  //                       addQty <= 0 ||
  //                       estimatedMargin > accountStats.freeMargin
  //                     }
  //                     className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
  //                     style={{
  //                       background:
  //                         trade.trade_type === 'buy'
  //                           ? '#26a69a'
  //                           : '#ef5350',
  //                       color: '#fff',
  //                     }}
  //                   >
  //                     {addQtyLoading
  //                       ? 'Adding...'
  //                       : `Add ${addQty} to ${trade.trade_type?.toUpperCase()} Position`}
  //                   </button>
  //                 </>
  //               )}
  //             </>
  //           )}
  //         </div>
  //       </div>
  //     </div>
  //   );
  // };

    // ============ MODIFY PENDING ORDER MODAL (MT5 Style) ============
  const renderModifyPendingOrderModal = () => {
    if (!modifyPendingModal) return null;

    const order = modifyPendingModal;
    const currentSymbolData = (symbols || []).find((s) => s.symbol === order.symbol);
    const tickSize = Number(currentSymbolData?.tick_size || 0.05);

    const stepPrice = (dir) => {
      const current = Number(modifyPendingPrice) || Number(order.price) || 0;
      setModifyPendingPrice((current + dir * tickSize).toFixed(2));
    };
    const stepSL = (dir) => {
      const current = Number(modifyPendingSL) || 0;
      setModifyPendingSL((current + dir * tickSize).toFixed(2));
    };
    const stepTP = (dir) => {
      const current = Number(modifyPendingTP) || 0;
      setModifyPendingTP((current + dir * tickSize).toFixed(2));
    };

    const handleModify = async () => {
      const result = await useTradingStore.getState().modifyPendingOrder(order.id, {
        price: Number(modifyPendingPrice),
        stopLoss: Number(modifyPendingSL) || 0,
        takeProfit: Number(modifyPendingTP) || 0,
      });
      if (result?.success) {
        toast.success('Pending order modified');
        setModifyPendingModal(null);
        fetchPendingOrders?.(selectedAccount?.id);
      } else {
        toast.error(result?.message || 'Modify failed');
      }
    };

    return (
      <div
        className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
        onClick={() => setModifyPendingModal(null)}
      >
        <div
          className="w-full max-w-sm rounded-xl"
          style={{ background: '#1e222d', border: '1px solid #363a45' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
            <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Modify Order</h3>
            <button onClick={() => setModifyPendingModal(null)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Order Info */}
            <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>{order.symbol}</div>
                  <span className="text-xs px-2 py-0.5 rounded font-medium" style={{
                    background: order.trade_type === 'buy' ? '#26a69a20' : '#ef535020',
                    color: order.trade_type === 'buy' ? '#26a69a' : '#ef5350',
                  }}>
                    {String(order.order_type || '').replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm" style={{ color: '#787b86' }}>Qty: {order.quantity}</div>
                </div>
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>Price</label>
              <div className="flex items-center gap-0">
                <button onClick={() => stepPrice(-1)} className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>−</button>
                <input type="number" value={modifyPendingPrice} onChange={(e) => setModifyPendingPrice(e.target.value)} className="flex-1 h-10 px-2 text-center text-base font-bold" style={{ background: '#2a2e39', border: '1px solid #363a45', borderLeft: 'none', borderRight: 'none', color: '#d1d4dc' }} />
                <button onClick={() => stepPrice(1)} className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>+</button>
              </div>
            </div>

            {/* Stop Loss */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>Stop Loss</label>
              <div className="flex items-center gap-0">
                <button onClick={() => stepSL(-1)} className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>−</button>
                <input type="number" value={modifyPendingSL} onChange={(e) => setModifyPendingSL(e.target.value)} placeholder="0.00" className="flex-1 h-10 px-2 text-center text-base font-bold" style={{ background: '#2a2e39', border: '1px solid #363a45', borderLeft: 'none', borderRight: 'none', color: '#d1d4dc' }} />
                <button onClick={() => stepSL(1)} className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>+</button>
              </div>
            </div>

            {/* Take Profit */}
            <div>
              <label className="block text-xs mb-1.5 font-medium" style={{ color: '#787b86' }}>Take Profit</label>
              <div className="flex items-center gap-0">
                <button onClick={() => stepTP(-1)} className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>−</button>
                <input type="number" value={modifyPendingTP} onChange={(e) => setModifyPendingTP(e.target.value)} placeholder="0.00" className="flex-1 h-10 px-2 text-center text-base font-bold" style={{ background: '#2a2e39', border: '1px solid #363a45', borderLeft: 'none', borderRight: 'none', color: '#d1d4dc' }} />
                <button onClick={() => stepTP(1)} className="h-10 w-10 flex items-center justify-center rounded-r-lg text-lg font-bold shrink-0" style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}>+</button>
              </div>
            </div>

            <button
              onClick={handleModify}
              className="w-full py-3.5 rounded-lg font-semibold text-base text-white"
              style={{ background: '#2962ff' }}
            >
              Modify Order
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ TRADE TAB ============
  const renderTradeTab = () => (
      <div
        className="flex flex-col h-full"
        style={{ background: theme === 'light' ? '#ffffff' : '#1e222d' }}
      >
        <div
          className="p-3 border-b"
          style={{ borderColor: theme === 'light' ? '#e2e8f0' : '#363a45' }}
        >
          {/* Trade Axis ID */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: theme === 'light' ? '#64748b' : '#787b86' }}>
                Trade Axis
              </span>
              <span className="font-bold text-sm font-mono" style={{ color: '#2962ff' }}>
                {user?.loginId || user?.login_id || '—'}
              </span>
            </div>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: selectedAccount?.is_demo ? '#f5c54220' : '#26a69a20',
                color: selectedAccount?.is_demo ? '#f5c542' : '#26a69a',
              }}
            >
              {selectedAccount?.is_demo ? 'DEMO' : 'LIVE'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div
            className="p-3 rounded-lg"
            style={{ background: theme === 'light' ? '#f1f5f9' : '#2a2e39' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Balance
            </div>
            <div
              className="font-bold text-base"
              style={{ color: '#d1d4dc' }}
            >
              {formatINR(accountStats.balance)}
            </div>
          </div>
          <div
            className="p-3 rounded-lg"
            style={{ background: theme === 'light' ? '#f1f5f9' : '#2a2e39' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Equity
            </div>
            <div
              className="font-bold text-base"
              style={{ color: '#d1d4dc' }}
            >
              {formatINR(accountStats.equity)}
            </div>
          </div>
          <div
            className="p-3 rounded-lg"
            style={{ background: theme === 'light' ? '#f1f5f9' : '#2a2e39' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Floating P&L
            </div>
            <div
              className="font-bold text-base"
              style={{ color: accountStats.pnl >= 0 ? '#26a69a' : '#ef5350' }}
            >
              {accountStats.pnl >= 0 ? '+' : ''}{formatINR(accountStats.pnl)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div
            className="p-2 rounded-lg"
            style={{ background: theme === 'light' ? '#e2e8f0' : '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Free Margin
            </div>
            <div
              className="font-semibold text-sm"
              style={{ color: accountStats.freeMargin >= 0 ? '#26a69a' : '#ef5350' }}
            >
              {formatINR(accountStats.freeMargin)}
            </div>
          </div>
          <div
            className="p-2 rounded-lg"
            style={{ background: theme === 'light' ? '#e2e8f0' : '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              P&L
            </div>
            <div
              className="font-semibold text-sm"
              style={{
                color: accountStats.credit >= 0 ? '#26a69a' : '#ef5350',
              }}
            >
              {accountStats.credit >= 0 ? '+' : ''}
              {formatINR(accountStats.credit)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div
            className="px-3 py-2 rounded-lg flex items-center justify-between"
            style={{ background: theme === 'light' ? '#e2e8f0' : '#252832' }}
          >
            <span className="text-[11px] font-medium" style={{ color: '#787b86' }}>
              Margin
            </span>
            <span className="font-semibold text-xs" style={{ color: '#f5c542' }}>
              {formatINR(accountStats.margin)}
            </span>
          </div>
          <div
            className="px-3 py-2 rounded-lg flex items-center justify-between"
            style={{ background: theme === 'light' ? '#e2e8f0' : '#252832' }}
          >
            <span className="text-[11px] font-medium" style={{ color: '#787b86' }}>
              Margin Level
            </span>
            <span
              className="font-semibold text-xs"
              style={{
                color:
                  accountStats.margin > 0
                    ? (accountStats.marginLevel >= 100 ? '#26a69a' : '#ef5350')
                    : '#787b86',
              }}
            >
              {accountStats.margin > 0
                ? `${accountStats.marginLevel.toFixed(2)}%`
                : '0.00%'}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex border-b"
        style={{ borderColor: '#363a45' }}
      >
      {[
          {
            id: 'positions',
            label: `Positions (${openTrades.length})`,
          },
          {
            id: 'pending',
            label: `Pending (${pendingOrders?.length || 0})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTradeTabSection(tab.id)}
            className="flex-1 py-3 text-sm font-medium border-b-2"
            style={{
              color:
                tradeTabSection === tab.id ? '#2962ff' : '#787b86',
              borderColor:
                tradeTabSection === tab.id
                  ? '#2962ff'
                  : 'transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tradeTabSection === 'positions' && (
          <>
            {closingMode && (
              <div
                className="flex gap-2 p-3 border-b"
                style={{ borderColor: '#363a45' }}
              >
                <div
                  className="flex-1 p-2 rounded-lg flex items-center gap-2"
                  style={{ background: '#ff980020' }}
                >
                  <Lock size={16} color="#ff9800" />
                  <span className="text-xs" style={{ color: '#ff9800' }}>
                    Closing mode active - You can only close existing positions
                  </span>
                </div>
              </div>
            )}

            {openTrades.length === 0 ? (
              <div
                className="p-8 text-center"
                style={{ color: '#787b86' }}
              >
                <TrendingUp
                  size={48}
                  className="mx-auto mb-3 opacity-30"
                />
                <div className="text-base">No open positions</div>
              </div>
            ) : (
              openTrades.map((trade) => {
                // Gross P&L without commission
                const pnl = Number(trade.profit || 0) + Number(trade.brokerage || 0);
                const isProfit = pnl >= 0;
                const isExpanded = expandedTradeId === trade.id;

                return (
                  <div
                    key={trade.id}
                    className="border-b"
                    style={{
                      borderColor: theme === 'light' ? '#e2e8f0' : '#363a45',
                      background: isExpanded
                        ? (theme === 'light' ? '#f8fafc' : '#252832')
                        : 'transparent',
                    }}
                  >
                    <div
                      className="p-3 cursor-pointer"
                      onClick={() =>
                        setExpandedTradeId(
                          isExpanded ? null : trade.id
                        )
                      }
                    >
                      <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className="font-bold text-base"
                                style={{ color: theme === 'light' ? '#1e293b' : '#d1d4dc' }}
                              >
                                {formatDisplaySymbol(trade.symbol, allFuturesSymbols)}
                              </span>
                              <span
                                className="font-bold text-sm px-2 py-1 rounded"
                                style={{
                                  color: trade.trade_type === 'buy' ? '#26a69a' : '#ef5350',
                                  background: trade.trade_type === 'buy' ? '#26a69a20' : '#ef535020',
                                }}
                              >
                                {String(trade.trade_type || '').toUpperCase()} {trade.quantity}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <div
                            className="font-bold text-lg"
                            style={{
                              color: isProfit
                                ? '#26a69a'
                                : '#ef5350',
                            }}
                          >
                            {isProfit ? '+' : ''}
                            {formatINR(pnl)}
                          </div>
                          <div
                            className="text-xs"
                            style={{ color: '#787b86' }}
                          >
                            {isExpanded ? (
                              <ChevronUp
                                size={14}
                                className="inline"
                              />
                            ) : (
                              <ChevronDown
                                size={14}
                                className="inline"
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      <div
                        className="flex justify-between text-sm mt-2"
                        style={{ color: theme === 'light' ? '#64748b' : '#787b86' }}
                      >
                        <span>
                          Open: {formatINR(trade.open_price)}
                        </span>
                        <span>
                          Current:{' '}
                          {formatINR(
                            trade.current_price || trade.open_price
                          )}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div
                        className="px-3 pb-3 pt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSymbol(trade.symbol);
                              setOrderExecType('instant');
                              setLimitPrice('');
                              setQuantity(1);
                              setStopLoss('');
                              setTakeProfit('');
                              setShowOrderModal(true);
                            }}
                            className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                            style={{
                              background: '#2962ff',
                              color: '#fff',
                            }}
                          >
                            <Plus size={16} />
                            New Order
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsPartialClose(false);
                              setCloseQty(Number(trade.quantity));
                              setCloseConfirmTrade(trade);
                            }}
                            className="flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2"
                            style={{
                              background: '#ef5350',
                              color: '#fff',
                            }}
                          >
                            <X size={16} />
                            Close
                          </button>
                        </div>

                        {(trade.stop_loss > 0 ||
                          trade.take_profit > 0) && (
                          <div
                            className="flex gap-4 mt-2 text-xs"
                            style={{ color: theme === 'light' ? '#64748b' : '#787b86' }}
                          >
                            {trade.stop_loss > 0 && (
                              <span>
                                SL:{' '}
                                <span style={{ color: '#ef5350' }}>
                                  {formatINR(trade.stop_loss)}
                                </span>
                              </span>
                            )}
                            {trade.take_profit > 0 && (
                              <span>
                                TP:{' '}
                                <span style={{ color: '#26a69a' }}>
                                  {formatINR(trade.take_profit)}
                                </span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {tradeTabSection === 'pending' && (
          <div style={{ color: '#787b86' }}>
            {pendingOrders?.length ? (
              <div className="p-3 space-y-2">
                {pendingOrders.map((o) => (
                  <div
                    key={o.id}
                    className="p-3 rounded-lg"
                    style={{ background: '#2a2e39', border: '1px solid #363a45' }}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            color: '#d1d4dc',
                            fontWeight: 700,
                          }}
                        >
                          {o.symbol}
                        </span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{
                            background: o.trade_type === 'buy' ? '#26a69a20' : '#ef535020',
                            color: o.trade_type === 'buy' ? '#26a69a' : '#ef5350',
                          }}
                        >
                          {String(o.trade_type || o.order_type || '').toUpperCase()}
                        </span>
                      </div>
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{
                          background: '#f5c54220',
                          color: '#f5c542',
                        }}
                      >
                        {o.status || 'pending'}
                      </span>
                    </div>
                    <div
                      className="text-sm mt-1"
                      style={{ color: '#787b86' }}
                    >
                      {o.order_type} | Qty {o.quantity} | @ {Number(o.price || 0).toFixed(2)}
                    </div>
                    {/* Modify & Cancel buttons */}
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setModifyPendingModal(o);
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                        style={{ background: '#2962ff20', color: '#2962ff', border: '1px solid #2962ff50' }}
                      >
                        <Edit3 size={14} />
                        Modify
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!window.confirm(`Cancel ${o.order_type} order for ${o.symbol}?`)) return;
                          cancelOrder(o.id, selectedAccount?.id).then((res) => {
                            if (res?.success) {
                              toast.success('Order cancelled');
                            } else {
                              toast.error(res?.message || 'Cancel failed');
                            }
                          });
                        }}
                        className="flex-1 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                        style={{ background: '#ef535020', color: '#ef5350', border: '1px solid #ef535050' }}
                      >
                        <X size={14} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center">
                <Clock
                  size={48}
                  className="mx-auto mb-3 opacity-30"
                />
                <div className="text-base">No pending orders</div>
              </div>
            )}
          </div>
        )}

        {/* {tradeTabSection === 'summary' && (
          <div className="p-4 space-y-3">
            <div
              className="p-4 rounded-lg"
              style={{ background: '#2a2e39' }}
            >
              <div
                className="text-sm font-semibold mb-3"
                style={{ color: '#d1d4dc' }}
              >
                Account Summary
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>Balance</span>
                  <span style={{ color: '#d1d4dc' }}>
                    {formatINR(accountStats.balance)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>Equity</span>
                  <span style={{ color: '#d1d4dc' }}>
                    {formatINR(accountStats.equity)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>
                    Used Margin
                  </span>
                  <span style={{ color: '#f5c542' }}>
                    {formatINR(accountStats.margin)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>
                    Free Margin
                  </span>
                  <span style={{ color: accountStats.freeMargin >= 0 ? '#26a69a' : '#ef5350' }}>
                    {formatINR(accountStats.freeMargin)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>
                    Margin Level
                  </span>
                  <span
                    style={{
                      color:
                        accountStats.marginLevel > 100
                          ? '#26a69a'
                          : '#ef5350',
                    }}
                  >
                    {accountStats.margin > 0
                      ? `${accountStats.marginLevel.toFixed(2)}%`
                      : '∞'}
                  </span>
                </div>
                <div className="text-[10px] text-right" style={{ color: '#787b86' }}>
                  Formula: (Equity / Total Margin) × 100
                </div>
                <div className="flex justify-between text-sm">
                  <span style={{ color: '#787b86' }}>Leverage</span>
                  <span style={{ color: '#2962ff' }}>
                    1:{accountStats.leverage}
                  </span>
                </div>
                <div
                  className="flex justify-between text-sm pt-2 border-t"
                  style={{ borderColor: '#363a45' }}
                >
                  <span style={{ color: '#787b86' }}>
                    Floating P&L
                  </span>
                  <span
                    className="font-bold"
                    style={{
                      color:
                        totalPnL >= 0 ? '#26a69a' : '#ef5350',
                    }}
                  >
                    {totalPnL >= 0 ? '+' : ''}
                    {formatINR(totalPnL)}
                  </span>
                </div>
              </div>
            </div>

            {accountStats.margin > 0 &&
              accountStats.marginLevel < 150 && (
                <div
                  className="p-3 rounded-lg flex items-center gap-2"
                  style={{
                    background: '#ef535020',
                    border: '1px solid #ef535050',
                  }}
                >
                  <AlertTriangle size={20} color="#ef5350" />
                  <div
                    className="text-sm"
                    style={{ color: '#ef5350' }}
                  >
                    Low margin level. Consider closing some
                    positions.
                  </div>
                </div>
              )}
          </div>
        )} */}
      </div>

      {renderModifyPendingOrderModal()}
      {renderCloseConfirmModal()}
    </div>
  );

  // ============ ORDER CONFIRMATION OVERLAY ============
const renderOrderConfirmation = () => {
    if (!orderConfirmation) return null;
    const oc = orderConfirmation;

    // ── Phase: Executing ──
    if (oc.phase === 'executing') {
      return (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-6"
          style={{ background: 'rgba(30, 34, 45, 0.97)' }}
        >
          <div className="text-center text-white">
            <div
              className="w-16 h-16 border-4 rounded-full animate-spin mx-auto mb-6"
              style={{ borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }}
            />
            <div className="text-2xl font-bold mb-2">Executing Order...</div>
            <div className="text-xl opacity-90">
              {oc.type} {oc.symbol}
            </div>
            {oc.quantity && (
              <div className="text-lg opacity-70 mt-1">Qty: {oc.quantity}</div>
            )}
          </div>
        </div>
      );
    }

    // ── Phase: Off Quotes ──
    if (oc.phase === 'offquotes') {
      return (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-6"
          style={{ background: 'rgba(120, 123, 134, 0.95)' }}
          onClick={() => setOrderConfirmation(null)}
        >
          <div className="text-center text-white">
            <div className="text-6xl mb-4">⚠️</div>
            <div className="text-3xl font-bold mb-3">Off Quotes</div>
            <div className="text-xl font-semibold">{oc.symbol}</div>
            <div className="text-base mt-4 opacity-80 max-w-xs mx-auto">
              Prices are not updating. Please wait for live quotes before placing orders.
            </div>
            <div className="mt-8 text-sm opacity-50">Tap anywhere to dismiss</div>
          </div>
        </div>
      );
    }

    // ── Phase: Rejected ──
    if (oc.phase === 'rejected') {
      return (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-6"
          style={{ background: 'rgba(239, 83, 80, 0.95)' }}
          onClick={() => setOrderConfirmation(null)}
        >
          <div className="text-center text-white">
            <div className="text-6xl mb-4">❌</div>
            <div className="text-3xl font-bold mb-2">
              {oc.type ? `${oc.type} REJECTED` : 'REJECTED'}
            </div>
            {oc.symbol && (
              <div className="text-xl font-semibold mb-1">{oc.symbol}</div>
            )}
            <div className="text-base mt-3 opacity-90 max-w-xs mx-auto">
              {oc.message}
            </div>
            <div className="mt-8 text-sm opacity-50">Tap anywhere to dismiss</div>
          </div>
        </div>
      );
    }

    // ── Phase: Success (buy/sell/close/modify) ──
    const isBuy = oc.type === 'BUY';
    const isSell = oc.type === 'SELL';
    const isClose = oc.type === 'CLOSE';
    const isModify = oc.type === 'MODIFY';

    let bgColor = 'rgba(38, 166, 154, 0.95)';
    if (isSell || isClose) bgColor = 'rgba(239, 83, 80, 0.95)';
    if (isModify) bgColor = 'rgba(41, 98, 255, 0.95)';

    let emoji = '📈';
    if (isSell) emoji = '📉';
    if (isClose) emoji = '✅';
    if (isModify) emoji = '✏️';

    let title = `${oc.type} ${oc.pending ? 'ORDER PLACED' : 'EXECUTED'}`;
    if (isClose) title = 'POSITION CLOSED';
    if (isModify) title = 'POSITION MODIFIED';

    return (
      <div
        className="fixed inset-0 z-[10001] flex items-center justify-center p-6"
        style={{ background: bgColor }}
        onClick={() => setOrderConfirmation(null)}
      >
        <div className="text-center text-white" onClick={(e) => e.stopPropagation()}>
          <div className="text-6xl mb-4">{emoji}</div>
          <div className="text-3xl font-bold mb-2">{title}</div>
          <div className="text-xl font-semibold mb-1">{oc.symbol}</div>
          {oc.quantity && (
            <div className="text-lg opacity-90 mb-1">Qty: {oc.quantity}</div>
          )}
          {oc.price && (
            <div className="text-2xl font-bold mt-3">@ ₹{oc.price}</div>
          )}
          {oc.merged && (
            <div className="text-sm mt-2 opacity-80">(Merged into existing position)</div>
          )}
          <div className="mt-6 text-sm opacity-70">Tap anywhere to dismiss</div>
        </div>
      </div>
    );
  };

  // ============ HISTORY TAB ============
  const renderHistoryTab = () => {
    const periodLabel = HISTORY_PERIODS.find((p) => p.id === historyPeriod)?.label || 'Today';

    // ── Theme-aware colors ──
    const bg = theme === 'light' ? '#ffffff' : '#1e222d';
    const bgAlt = theme === 'light' ? '#f1f5f9' : '#2a2e39';
    const bgAlt2 = theme === 'light' ? '#f1f5f9' : '#252832';
    const border = theme === 'light' ? '#e2e8f0' : '#363a45';
    const textPrimary = theme === 'light' ? '#1e293b' : '#d1d4dc';
    const textMuted = theme === 'light' ? '#64748b' : '#787b86';

    return (
      <div className="flex flex-col h-full" style={{ background: bg }}>
        {/* ── Header ── */}
        <div className="p-3 border-b shrink-0" style={{ borderColor: border }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              {[
                { id: 'positions', label: 'Positions' },
                { id: 'orders', label: 'Orders' },
                { id: 'deals', label: 'Deals' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setHistoryViewMode(m.id)}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background: historyViewMode === m.id ? bgAlt : 'transparent',
                    color: historyViewMode === m.id ? textPrimary : textMuted,
                    border: `1px solid ${historyViewMode === m.id ? border : 'transparent'}`,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="relative" ref={historyCalendarRef}>
              <button
                onClick={() => setShowHistoryCalendar(!showHistoryCalendar)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{ background: bgAlt, border: `1px solid ${border}` }}
              >
                <CalendarDays size={16} color={textMuted} />
                <span className="text-xs font-medium" style={{ color: textPrimary }}>{periodLabel}</span>
                <ChevronDown size={14} color={textMuted} />
              </button>

              {showHistoryCalendar && (
                <div
                  className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden z-30 w-44"
                  style={{ background: bgAlt, border: `1px solid ${border}` }}
                >
                  {HISTORY_PERIODS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setHistoryPeriod(p.id); setShowHistoryCalendar(false); }}
                      className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/5"
                      style={{ color: historyPeriod === p.id ? '#2962ff' : textPrimary }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(historyViewMode === 'positions' || historyViewMode === 'deals') && (
            <div
              className={
                historyViewMode === 'deals'
                  ? 'flex items-stretch gap-2'
                  : 'space-y-2'
              }
            >
              <div
                className={historyViewMode === 'deals' ? 'relative flex-1 min-w-0' : 'relative'}
                ref={historyViewMode === 'deals' ? dealsDropdownRef : historyDropdownRef}
              >
                <button
                  onClick={() => {
                    if (historyViewMode === 'deals') setShowDealsSymbolDropdown(!showDealsSymbolDropdown);
                    else setShowHistorySymbolDropdown(!showHistorySymbolDropdown);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between"
                  style={{ background: bgAlt, border: `1px solid ${border}`, color: textPrimary }}
                >
                  <span>
                    {historyViewMode === 'deals'
                      ? (dealsSymbolFilter ? formatDisplaySymbol(dealsSymbolFilter, allFuturesSymbols) : 'All Symbols')
                      : (historyLocalSymbolFilter ? formatDisplaySymbol(historyLocalSymbolFilter, allFuturesSymbols) : 'All Symbols')}
                  </span>
                  <ChevronDown size={16} color={textMuted} />
                </button>

                {historyViewMode === 'positions' && showHistorySymbolDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-60 overflow-y-auto" style={{ background: bgAlt, border: `1px solid ${border}` }}>
                    <button onClick={() => { setHistoryLocalSymbolFilter(''); setShowHistorySymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: !historyLocalSymbolFilter ? '#2962ff' : textPrimary }}>All Symbols</button>
                    {historyUniqueSymbols.map((sym) => (
                      <button key={sym} onClick={() => { setHistoryLocalSymbolFilter(sym); setShowHistorySymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: historyLocalSymbolFilter === sym ? '#2962ff' : textPrimary }}>
                        {formatDisplaySymbol(sym, allFuturesSymbols)}
                      </button>
                    ))}
                  </div>
                )}

                {historyViewMode === 'deals' && showDealsSymbolDropdown && (
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-60 overflow-y-auto" style={{ background: bgAlt, border: `1px solid ${border}` }}>
                    <button onClick={() => { setDealsSymbolFilter(''); setShowDealsSymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: !dealsSymbolFilter ? '#2962ff' : textPrimary }}>All Symbols</button>
                    {dealsUniqueSymbols.map((sym) => (
                      <button key={sym} onClick={() => { setDealsSymbolFilter(sym); setShowDealsSymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: dealsSymbolFilter === sym ? '#2962ff' : textPrimary }}>
                        {formatDisplaySymbol(sym, allFuturesSymbols)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {historyViewMode === 'deals' && (
                <button
                  type="button"
                  onClick={handleExportDealsPdf}
                  disabled={!filteredDeals.length}
                  className="px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 shrink-0"
                  style={{ background: bgAlt, border: `1px solid ${border}`, color: '#2962ff' }}
                >
                  <Download size={16} />
                  <span className="hidden sm:inline">Export PDF</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Positions Stats ── */}
        {historyViewMode === 'positions' && (
          <div className="p-3 border-b shrink-0" style={{ borderColor: border, background: bgAlt2 }}>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-xs" style={{ color: textMuted }}>Trades</div>
                <div className="font-bold text-sm" style={{ color: textPrimary }}>{historyOverallStats.count}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: textMuted }}>Total Buy</div>
                <div className="font-bold text-sm" style={{ color: '#26a69a' }}>{positionAggregates.totalBuyQty}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: textMuted }}>Total Sell</div>
                <div className="font-bold text-sm" style={{ color: '#ef5350' }}>{positionAggregates.totalSellQty}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: textMuted }}>Net P&L</div>
                <div className="font-bold text-sm" style={{ color: historyOverallStats.netPnL >= 0 ? '#26a69a' : '#ef5350' }}>
                  {historyOverallStats.netPnL >= 0 ? '+' : ''}{formatINR(historyOverallStats.netPnL)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Scrollable Content ── */}
        <div className="flex-1 overflow-y-auto">
          {historyViewMode === 'positions' && (
            <>
              {historyPositionGroups.length === 0 ? (
                <div className="p-8 text-center" style={{ color: textMuted }}>
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base">No closed positions</div>
                </div>
              ) : (
                historyPositionGroups.map((group) => {
                  const isExpanded = expandedHistoryPositionId === group.id;
                  const pnl = Number(group.totalProfit || 0);

                  return (
                    <div key={group.id} className="border-b" style={{ borderColor: border }}>
                      <button
                        type="button"
                        className="w-full p-3 text-left"
                        onClick={() =>
                          setExpandedHistoryPositionId((current) =>
                            current === group.id ? null : group.id
                          )
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-base" style={{ color: textPrimary }}>
                                {formatDisplaySymbol(group.symbol, allFuturesSymbols)}
                              </span>
                              <span
                                className="text-[11px] px-2 py-0.5 rounded font-medium"
                                style={{ background: '#2962ff20', color: '#2962ff' }}
                              >
                                {group.tradeCount} close{group.tradeCount > 1 ? 's' : ''}
                              </span>
                              {group.remainingQty > 0 && (
                                <span
                                  className="text-[11px] px-2 py-0.5 rounded font-medium"
                                  style={{ background: '#f5c54220', color: '#f5c542' }}
                                >
                                  Remaining {group.remainingQty}
                                </span>
                              )}
                            </div>

                            <div
                              className="mt-2 grid grid-cols-3 gap-2 rounded-lg p-2 text-xs"
                              style={{ background: bgAlt2 }}
                            >
                              <div>
                                <div style={{ color: '#f5c542' }}>Buy</div>
                                <div className="font-semibold" style={{ color: '#f5c542' }}>
                                  {group.buyQty || 0}
                                </div>
                                {group.buyPrice > 0 && (
                                  <div style={{ color: '#f5c542' }}>@ {group.buyPrice.toFixed(2)}</div>
                                )}
                              </div>
                              <div>
                                <div style={{ color: '#f5c542' }}>Sell</div>
                                <div className="font-semibold" style={{ color: '#f5c542' }}>
                                  {group.sellQty || 0}
                                </div>
                                {group.sellPrice > 0 && (
                                  <div style={{ color: '#f5c542' }}>@ {group.sellPrice.toFixed(2)}</div>
                                )}
                              </div>
                              <div>
                                <div style={{ color: textMuted }}>Net</div>
                                <div className="font-semibold" style={{ color: textPrimary }}>
                                  {group.remainingQty}
                                </div>
                                <div style={{ color: textMuted }}>
                                  Comm {formatINR(group.totalCommission)}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-2 text-[11px]">
                              <span style={{ color: textMuted }}>
                                {group.latestCloseTime
                                  ? new Date(group.latestCloseTime).toLocaleString()
                                  : ''}
                              </span>
                              <span style={{ color: textMuted }}>
                                {isExpanded ? 'Hide breakdown' : 'Show breakdown'}
                              </span>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div
                              className="font-bold text-lg"
                              style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}
                            >
                              {pnl >= 0 ? '+' : ''}
                              {formatINR(pnl)}
                            </div>
                            <div className="text-xs mt-1" style={{ color: textMuted }}>
                              {group.tradeType === 'sell' ? 'Short' : 'Long'}
                            </div>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3">
                          <div
                            className="rounded-lg overflow-hidden"
                            style={{ border: `1px solid ${border}`, background: bgAlt }}
                          >
                            {group.trades.map((trade, idx) => {
                              const closeQty = Number(trade.quantity || 0);
                              const openQty = inferHistoryOriginalQuantity(trade);
                              const tradePnL = Number(trade.profit || 0);
                              const tradeCommission = Number(trade.brokerage || 0);
                              const closeTime = trade.close_time || trade.closeTime;

                              return (
                                <div
                                  key={trade.id || `${group.id}-${idx}`}
                                  className="px-3 py-2 border-b last:border-b-0"
                                  style={{ borderColor: border }}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span
                                          className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                                          style={{
                                            background:
                                              group.tradeType === 'sell'
                                                ? '#2962ff20'
                                                : '#ef535020',
                                            color:
                                              group.tradeType === 'sell'
                                                ? '#2962ff'
                                                : '#ef5350',
                                          }}
                                        >
                                          {group.tradeType === 'sell' ? 'Buy Out' : 'Sell Out'}
                                        </span>
                                        <span className="text-sm font-medium" style={{ color: textPrimary }}>
                                          Qty {closeQty}
                                          {openQty !== closeQty ? ` of ${openQty}` : ''}
                                        </span>
                                      </div>
                                      <div className="text-xs mt-1" style={{ color: textMuted }}>
                                        {Number(trade.open_price || 0).toFixed(2)} to{' '}
                                        {Number(trade.close_price || 0).toFixed(2)}
                                      </div>
                                      <div className="text-[11px] mt-1" style={{ color: textMuted }}>
                                        Commission {formatINR(tradeCommission)}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="text-xs" style={{ color: textMuted }}>
                                        {closeTime ? new Date(closeTime).toLocaleString() : ''}
                                      </div>
                                      <div
                                        className="font-bold text-sm mt-1"
                                        style={{ color: tradePnL >= 0 ? '#26a69a' : '#ef5350' }}
                                      >
                                        {tradePnL >= 0 ? '+' : ''}
                                        {formatINR(tradePnL)}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          )}

          {historyViewMode === 'orders' && (() => {
            const orderPeriodStart = getPeriodStart(historyPeriod);
            const executedOrders = (tradeHistory || []).map((o) => ({
              ...o, _source: 'trade', _status: o.trade_type, _time: o.open_time,
            }));
            const pendingHistory = (pendingOrderHistory || []).map((o) => ({
              ...o, _source: 'pending', _status: o.status, _time: o.created_at || o.updated_at,
            }));
            const allOrders = [...executedOrders, ...pendingHistory]
              .filter((order) => {
                if (!orderPeriodStart) return true;
                if (!order._time) return false;
                return new Date(order._time) >= orderPeriodStart;
              })
              .sort((a, b) => new Date(b._time || 0) - new Date(a._time || 0));

            const getStatusStyle = (status) => {
              switch (status) {
                case 'buy': return { bg: '#26a69a20', color: '#26a69a', label: 'Buy' };
                case 'sell': return { bg: '#ef535020', color: '#ef5350', label: 'Sell' };
                case 'cancelled': return { bg: '#ff980020', color: '#ff9800', label: 'Cancelled' };
                case 'triggered': return { bg: '#2962ff20', color: '#2962ff', label: 'Filled' };
                case 'expired': return { bg: '#787b8620', color: '#787b86', label: 'Expired' };
                case 'rejected': return { bg: '#ef535020', color: '#ef5350', label: 'Rejected' };
                case 'modified': return { bg: '#f5c54220', color: '#f5c542', label: 'Modified' };
                default: return { bg: '#787b8620', color: '#787b86', label: String(status || 'unknown').toUpperCase() };
              }
            };

            return (
              <>
                {allOrders.length === 0 ? (
                  <div className="p-8 text-center" style={{ color: textMuted }}>
                    <Clock size={48} className="mx-auto mb-3 opacity-30" />
                    <div className="text-base">No orders found</div>
                  </div>
                ) : (
                  allOrders.map((o, idx) => {
                    const st = getStatusStyle(o._status);
                    const orderTypeLabel = o._source === 'pending'
                      ? String(o.order_type || '').replace('_', ' ').toUpperCase()
                      : String(o.trade_type || '').toUpperCase();
                    const price = o._source === 'pending' ? Number(o.price || 0) : Number(o.open_price || 0);
                    const time = o._time ? new Date(o._time).toLocaleString() : '';

                    return (
                      <div key={`${o._source}-${o.id}-${idx}`} className="p-3 border-b" style={{ borderColor: border }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm" style={{ color: textPrimary }}>
                              {formatDisplaySymbol(o.symbol, allFuturesSymbols)}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{
                              background: (o.trade_type === 'buy' || o._status === 'buy') ? '#26a69a20' : '#ef535020',
                              color: (o.trade_type === 'buy' || o._status === 'buy') ? '#26a69a' : '#ef5350',
                            }}>
                              {orderTypeLabel} {o.quantity}
                            </span>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="text-xs" style={{ color: textMuted }}>@ {price.toFixed(2)}</div>
                          <div className="text-xs" style={{ color: textMuted }}>{time}</div>
                        </div>
                        {o._source === 'pending' && o.comment && (
                          <div className="text-[10px] mt-0.5" style={{ color: textMuted }}>{o.comment}</div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            );
          })()}

          {historyViewMode === 'deals' && (
            <>
              {dealsSummary && (
                <div className="p-3 border-b shrink-0" style={{ borderColor: border, background: bgAlt2 }}>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: textMuted }}>Profit:</span>
                      <span style={{ color: '#26a69a' }}>+{formatINR(
                        dealsSymbolFilter
                          ? filteredDeals.filter(d => d.source === 'trade' && d.side === 'exit' && d.amount > 0).reduce((s, d) => s + d.amount, 0)
                          : dealsSummary.totalProfit
                      )}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: textMuted }}>Loss:</span>
                      <span style={{ color: '#ef5350' }}>-{formatINR(
                        dealsSymbolFilter
                          ? Math.abs(filteredDeals.filter(d => d.source === 'trade' && d.side === 'exit' && d.amount < 0).reduce((s, d) => s + d.amount, 0))
                          : dealsSummary.totalLoss
                      )}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: textMuted }}>Deposits:</span>
                      <span style={{ color: '#26a69a' }}>+{formatINR(dealsSymbolFilter ? 0 : dealsSummary.totalDeposits)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: textMuted }}>Withdrawals:</span>
                      <span style={{ color: '#ef5350' }}>-{formatINR(dealsSymbolFilter ? 0 : dealsSummary.totalWithdrawals)}</span>
                    </div>
                    <div className="flex justify-between col-span-2 pt-2 border-t" style={{ borderColor: border }}>
                      <span style={{ color: textMuted }}>
                        Commission{dealsSymbolFilter ? ` (${formatDisplaySymbol(dealsSymbolFilter, allFuturesSymbols)})` : ''}:
                      </span>
                      <span className="font-bold" style={{ color: textMuted }}>{formatINR(
                        dealsSymbolFilter
                          ? filteredDeals.reduce((s, d) => s + Number(d.commission || 0), 0)
                          : dealsSummary.totalCommission
                      )}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span style={{ color: textMuted }}>Balance Settled:</span>
                      <span
                        className="font-bold"
                        style={{
                          color:
                            dealsSymbolFilter
                              ? textMuted
                              : Number(dealsSummary.balanceSettled || 0) >= 0
                              ? '#26a69a'
                              : '#ef5350',
                        }}
                      >
                        {!dealsSymbolFilter && Number(dealsSummary.balanceSettled || 0) > 0 ? '+' : ''}
                        {!dealsSymbolFilter && Number(dealsSummary.balanceSettled || 0) < 0 ? '-' : ''}
                        {formatINR(
                          Math.abs(
                            dealsSymbolFilter ? 0 : Number(dealsSummary.balanceSettled || 0)
                          )
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span style={{ color: textMuted }}>Balance:</span>
                      <span className="font-bold" style={{ color: textPrimary }}>{formatINR(dealsSummary.currentBalance)}</span>
                    </div>
                  </div>
                </div>
              )}

              {filteredDeals.length === 0 ? (
                <div className="p-8 text-center" style={{ color: textMuted }}>
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base">No deals found</div>
                </div>
              ) : (
                filteredDeals.map((d, idx) => {
                  const commission = Number(d.commission || d.brokerage || 0);
                  const isEntryDeal = d.source === 'trade' && d.side === 'entry';
                  const rawAmount = Number(
                    isEntryDeal ? -commission : (d.amount ?? d.profit ?? 0)
                  );
                  const dt = d.time || d.close_time || d.open_time || d.created_at;
                  const dealPrice = Number(d.price || d.open_price || d.close_price || 0);
                  const dealLabel =
                    d.dealLabel ||
                    (d.type ? String(d.type).replace(/_/g, ' ').toUpperCase() : 'DEAL');
                  const symbolLabel = d.symbol
                    ? formatDisplaySymbol(d.symbol, allFuturesSymbols)
                    : null;
                  const badgeTone = (() => {
                    if (String(d.type || '').toLowerCase() === 'deposit') {
                      return { bg: '#26a69a20', color: '#26a69a' };
                    }
                    if (
                      ['withdrawal', 'withdraw'].includes(
                        String(d.type || '').toLowerCase()
                      )
                    ) {
                      return { bg: '#ef535020', color: '#ef5350' };
                    }
                    if (String(d.type || '').toLowerCase() === 'settlement') {
                      return { bg: '#2962ff20', color: '#2962ff' };
                    }
                    if (isEntryDeal) {
                      return {
                        bg:
                          String(d.type || '').toLowerCase() === 'buy'
                            ? '#26a69a20'
                            : '#ef535020',
                        color:
                          String(d.type || '').toLowerCase() === 'buy'
                            ? '#26a69a'
                            : '#ef5350',
                      };
                    }
                    if (d.source === 'trade' && d.side === 'exit') {
                      return {
                        bg:
                          String(d.type || '').toLowerCase() === 'buy'
                            ? '#26a69a20'
                            : '#ef535020',
                        color:
                          String(d.type || '').toLowerCase() === 'buy'
                            ? '#26a69a'
                            : '#ef5350',
                      };
                    }
                    return { bg: '#787b8620', color: textMuted };
                  })();

                  const meta = [];
                  if (d.quantity !== null && d.quantity !== undefined) {
                    let qtyLabel = `Qty ${d.quantity}`;
                    if (
                      d.original_quantity !== null &&
                      d.original_quantity !== undefined &&
                      Number(d.original_quantity) !== Number(d.quantity)
                    ) {
                      qtyLabel += ` of ${d.original_quantity}`;
                    }
                    meta.push({ label: qtyLabel, tone: '#f5c542' });
                  }
                  if (dealPrice > 0) meta.push({ label: `Price ${dealPrice.toFixed(2)}`, tone: '#f5c542' });
                  if (d.balance_after !== undefined && d.balance_after !== null) {
                    meta.push({ label: `Bal ${formatINR(d.balance_after)}`, tone: textMuted });
                  }

                  return (
                    <div key={d.id || idx} className="p-3 border-b" style={{ borderColor: border }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm" style={{ color: textPrimary }}>
                              {symbolLabel || dealLabel}
                            </span>
                            {symbolLabel && (
                              <span
                                className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                                style={{ background: badgeTone.bg, color: badgeTone.color }}
                              >
                                {dealLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-xs mt-1" style={{ color: textMuted }}>
                            {dt ? new Date(dt).toLocaleString() : ''}
                          </div>
                          {meta.length > 0 && (
                            <div
                              className="flex flex-wrap gap-x-3 gap-y-1 text-xs mt-1"
                            >
                              {meta.map((item) => (
                                <span
                                  key={`${d.id || idx}-${item.label}`}
                                  style={{ color: item.tone || textMuted }}
                                >
                                  {item.label}
                                </span>
                              ))}
                            </div>
                          )}
                          {d.description && (
                            <div className="text-[11px] mt-1" style={{ color: textMuted }}>
                              {d.description}
                            </div>
                          )}
                          {commission > 0 && (
                            <div className="text-[11px] mt-1" style={{ color: textMuted }}>
                              Commission {formatINR(commission)}
                            </div>
                          )}
                        </div>

                        {!isEntryDeal && (
                          <div className="text-right shrink-0">
                            <div
                              className="font-bold text-sm"
                              style={{
                                color:
                                  rawAmount > 0
                                    ? '#26a69a'
                                    : rawAmount < 0
                                    ? '#ef5350'
                                    : textPrimary,
                              }}
                            >
                              {rawAmount > 0 ? '+' : rawAmount < 0 ? '-' : ''}
                              {formatINR(Math.abs(rawAmount))}
                            </div>
                            <div className="text-[10px] mt-1" style={{ color: textMuted }}>
                              {d.source === 'trade' && d.side === 'exit'
                                ? 'Net result'
                                : 'Account movement'}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // ============ MESSAGES TAB ============
  const renderMessagesTab = () => {
    // ── Theme-aware colors ──
    const bg = theme === 'light' ? '#ffffff' : '#1e222d';
    const bgAlt = theme === 'light' ? '#f1f5f9' : '#2a2e39';
    const border = theme === 'light' ? '#e2e8f0' : '#363a45';
    const textPrimary = theme === 'light' ? '#1e293b' : '#d1d4dc';
    const textMuted = theme === 'light' ? '#64748b' : '#787b86';

    return (
      <div className="flex flex-col h-full" style={{ background: bg }}>
        <div className="p-4 border-b" style={{ borderColor: border }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-xl" style={{ color: textPrimary }}>
              Messages
            </h2>
            <button
              className="text-sm font-medium px-3 py-1.5 rounded-lg"
              style={{ background: bgAlt, color: '#2962ff' }}
              onClick={markAllRead}
            >
              Mark All Read
            </button>
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {[
              { id: 'all', label: 'All' },
              { id: 'system', label: 'System' },
              { id: 'trade', label: 'Trade' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setMessageCategory(c.id)}
                className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
                style={{
                  background: messageCategory === c.id ? '#2962ff' : bgAlt,
                  color: messageCategory === c.id ? '#fff' : textMuted,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredMessages.length === 0 ? (
            <div className="p-8 text-center" style={{ color: textMuted }}>
              <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
              <div className="text-base">No messages yet</div>
            </div>
          ) : (
            filteredMessages.map((m) => (
              <div
                key={m.id}
                className="p-4 border-b"
                style={{
                  borderColor: border,
                  background: m.read
                    ? 'transparent'
                    : (theme === 'light' ? 'rgba(41, 98, 255, 0.04)' : 'rgba(41, 98, 255, 0.06)'),
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: bgAlt }}
                  >
                    {m.type === 'trade' ? (
                      <TrendingUp size={20} color="#26a69a" />
                    ) : (
                      <Bell size={20} color="#2962ff" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-base" style={{ color: textPrimary }}>
                        {m.title}
                      </span>
                      <span className="text-xs" style={{ color: textMuted }}>
                        {m.time ? new Date(m.time).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <p
                      className="text-sm mt-1"
                      style={{ color: textMuted, wordBreak: 'break-word' }}
                    >
                      {m.message}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============ ADD ACCOUNT MODAL ============
  const renderAddAccountModal = () => {
    if (!showAddAccountModal) return null;

    return (
      <div
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={() => setShowAddAccountModal(false)}
      >
        <div
          className="w-full max-w-sm rounded-xl"
          style={{
            background: '#1e222d',
            border: '1px solid #363a45',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: '#363a45' }}
          >
            <h3
              className="font-bold text-lg"
              style={{ color: '#d1d4dc' }}
            >
              Add Account
            </h3>
            <button onClick={() => setShowAddAccountModal(false)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div
              className="p-3 rounded-lg flex items-start gap-2"
              style={{
                background: '#2962ff20',
                border: '1px solid #2962ff50',
              }}
            >
              <Info
                size={18}
                color="#2962ff"
                className="shrink-0 mt-0.5"
              />
              <div
                className="text-sm"
                style={{ color: '#2962ff' }}
              >
                Login with another account to save it for quick switching.
              </div>
            </div>

            <div>
              <label
                className="block text-sm mb-2"
                style={{ color: '#787b86' }}
              >
                User ID
              </label>
              <input
                type="text"
                value={addAccountEmail}
                onChange={(e) =>
                  setAddAccountEmail(e.target.value.toUpperCase())
                }
                className="w-full px-4 py-3 rounded-lg text-base font-mono"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
                placeholder="TA1000"
                autoCapitalize="characters"
              />
            </div>

            <div>
              <label
                className="block text-sm mb-2"
                style={{ color: '#787b86' }}
              >
                Password
              </label>
              <input
                type="password"
                value={addAccountPassword}
                onChange={(e) =>
                  setAddAccountPassword(e.target.value)
                }
                className="w-full px-4 py-3 rounded-lg text-base"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
                placeholder="••••••••"
              />
            </div>

            <button
              onClick={handleAddAccount}
              disabled={addAccountLoading}
              className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              {addAccountLoading ? 'Adding...' : 'Add Account'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ SETTINGS TAB ============
  const renderSettingsTab = () => {
    // ── Theme-aware colors ──
    const bg = theme === 'light' ? '#ffffff' : '#1e222d';
    const bgAlt = theme === 'light' ? '#f1f5f9' : '#2a2e39';
    const bgAlt2 = theme === 'light' ? '#e2e8f0' : '#252832';
    const border = theme === 'light' ? '#e2e8f0' : '#363a45';
    const textPrimary = theme === 'light' ? '#1e293b' : '#d1d4dc';
    const textMuted = theme === 'light' ? '#64748b' : '#787b86';

    return (
      <div className="flex flex-col h-full" style={{ background: bg }}>
        <div className="p-4 border-b" style={{ borderColor: border }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold text-lg font-mono" style={{ color: '#2962ff' }}>
                {user?.loginId || user?.login_id || '—'}
              </div>
              {(user?.firstName || user?.lastName) && (
                <div className="text-sm mt-0.5" style={{ color: textPrimary }}>
                  {user?.firstName} {user?.lastName}
                </div>
              )}
            </div>

            <button
              onClick={logout}
              className="p-2.5 rounded-lg"
              style={{ background: bgAlt }}
            >
              <LogOut size={18} color={textMuted} />
            </button>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={switchToDemo}
              className="flex-1 py-3 rounded-lg text-base font-semibold"
              style={{
                background: selectedAccount?.is_demo ? '#2962ff' : bgAlt,
                color: selectedAccount?.is_demo ? '#fff' : textMuted,
                border: `1px solid ${border}`,
              }}
            >
              DEMO
            </button>

            <button
              onClick={switchToLive}
              className="flex-1 py-3 rounded-lg text-base font-semibold"
              style={{
                background: !selectedAccount?.is_demo ? '#26a69a' : bgAlt,
                color: !selectedAccount?.is_demo ? '#fff' : textMuted,
                border: `1px solid ${border}`,
              }}
            >
              LIVE
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="p-4 rounded-xl" style={{ background: bgAlt }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm" style={{ color: textMuted }}>Credit</span>
              <button onClick={() => setShowBalance((v) => !v)}>
                {showBalance ? (
                  <Eye size={18} color={textMuted} />
                ) : (
                  <EyeOff size={18} color={textMuted} />
                )}
              </button>
            </div>

            <div className="text-3xl font-bold" style={{ color: textPrimary }}>
              {showBalance ? formatINR(accountStats.credit) : '••••••'}
            </div>

            <div className="text-sm mt-2" style={{ color: textMuted }}>
              Account: {selectedAccount?.account_number || '-'} •
              Leverage: 1:{accountStats.leverage}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setWalletIntent('deposit'); setActiveTab('wallet'); }}
              className="py-3.5 rounded-xl font-medium text-base flex items-center justify-center gap-2"
              style={{ background: '#26a69a', color: '#fff' }}
            >
              <Plus size={20} />
              Deposit
            </button>

            <button
              onClick={() => { setWalletIntent('withdraw'); setActiveTab('wallet'); }}
              className="py-3.5 rounded-xl font-medium text-base flex items-center justify-center gap-2"
              style={{ background: bgAlt, color: textPrimary, border: `1px solid ${border}` }}
            >
              <RefreshCw size={20} />
              Withdraw
            </button>
          </div>

          {/* Change Password */}
          <div className="p-4 rounded-xl" style={{ background: bgAlt }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: textPrimary }}>Password</div>
                <div className="text-xs" style={{ color: textMuted }}>Change your login password</div>
              </div>
              <button
                onClick={() => {
                  setShowFirstLoginPrompt(false);
                  setChangePassCurrent('');
                  setChangePassNew('');
                  setChangePassConfirm('');
                  setShowChangePasswordModal(true);
                }}
                className="px-4 py-2 rounded-lg font-medium text-sm"
                style={{ background: '#2962ff20', color: '#2962ff', border: '1px solid #2962ff50' }}
              >
                Change Password
              </button>
            </div>
          </div>

          {/* Theme Toggle */}
          <div className="p-4 rounded-xl" style={{ background: bgAlt }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium" style={{ color: textPrimary }}>Theme</div>
                <div className="text-xs" style={{ color: textMuted }}>
                  Currently: {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className="px-4 py-2 rounded-lg font-medium text-sm"
                style={{
                  background: theme === 'dark' ? '#f5c54220' : '#2962ff20',
                  color: theme === 'dark' ? '#f5c542' : '#2962ff',
                  border: `1px solid ${theme === 'dark' ? '#f5c54250' : '#2962ff50'}`,
                }}
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
            <div
              className="text-xs mt-2 p-2 rounded"
              style={{ background: bgAlt2, color: textMuted }}
            >
              Mode applied!
            </div>
          </div>

          {/* Saved Accounts */}
          <div className="rounded-xl overflow-hidden" style={{ background: bgAlt, border: `1px solid ${border}` }}>
            <div className="p-4 border-b" style={{ borderColor: border }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={18} color="#2962ff" />
                  <span className="font-semibold text-base" style={{ color: textPrimary }}>
                    Saved Accounts
                  </span>
                </div>
                <span className="text-xs px-2 py-1 rounded" style={{ background: '#2962ff20', color: '#2962ff' }}>
                  {savedAccounts.length} saved
                </span>
              </div>
              <div className="text-xs mt-1" style={{ color: textMuted }}>
                Switch between accounts quickly without re-entering password
              </div>
            </div>

            <div className="divide-y" style={{ borderColor: border }}>
              {savedAccounts.map((acc, idx) => {
                const isActive = user?.loginId === acc.loginId || user?.email === acc.email;

                return (
                  <div
                    key={acc.loginId || `${acc.email}-${idx}`}
                    className="p-3 flex items-center justify-between"
                    style={{
                      background: isActive
                        ? (theme === 'light' ? 'rgba(41, 98, 255, 0.05)' : '#2962ff10')
                        : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{
                          background: isActive ? '#2962ff' : (theme === 'light' ? '#cbd5e1' : '#363a45'),
                          color: '#fff',
                        }}
                      >
                        {acc.firstName?.[0]}{acc.lastName?.[0]}
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: textPrimary }}>
                          {acc.firstName} {acc.lastName}
                          {isActive && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded" style={{ background: '#26a69a20', color: '#26a69a' }}>
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: textMuted }}>{acc.email}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isActive && (
                        <button
                          onClick={() => handleSwitchToSavedAccount(acc)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{ background: '#2962ff', color: '#fff' }}
                        >
                          Switch
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() => handleRemoveSavedAccount(acc.loginId || acc.email)}
                          className="p-1.5 rounded hover:bg-red-500/20"
                        >
                          <Trash2 size={16} color="#ef5350" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {savedAccounts.length === 0 && (
                <div className="p-4 text-center text-sm" style={{ color: textMuted }}>
                  No saved accounts yet
                </div>
              )}
            </div>

            <div className="p-3 border-t" style={{ borderColor: border }}>
              <button
                onClick={() => setShowAddAccountModal(true)}
                className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                style={{
                  background: theme === 'light' ? '#f8fafc' : '#1e222d',
                  color: '#2962ff',
                  border: '1px dashed #2962ff50',
                }}
              >
                <UserPlus size={18} />
                Add Another Account
              </button>
            </div>
          </div>

          <div
            className="p-4 rounded-xl border flex items-center gap-3"
            style={{ background: bgAlt, border: `1px solid ${border}` }}
          >
            <img
              src="/arisetech-logo.png"
              alt="Arise Tech Services"
              className="h-11 w-11 object-contain rounded-lg"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: textMuted }}>
                Developed By
              </div>
              <div className="text-sm font-semibold" style={{ color: textPrimary }}>
                Arise Tech Services
              </div>
              <div className="text-xs mt-0.5" style={{ color: textMuted }}>
                Application delivery and technology support
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: bgAlt }}>
            <Info size={18} color={textMuted} className="shrink-0 mt-0.5" />
            <div className="text-sm" style={{ color: textMuted }}>
              You can log in from multiple devices simultaneously.
              Each device maintains its own session.
            </div>
          </div>
        </div>

        {renderAddAccountModal()}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: theme === 'light' ? '#f6f7fb' : '#131722' }}
    >
      <header
        className="h-16 flex items-center justify-between px-4 border-b shrink-0"
        style={{ 
          background: theme === 'light' ? '#ffffff' : '#1e222d', 
          borderColor: theme === 'light' ? '#e2e8f0' : '#363a45' 
        }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Trade Axis"
            className="h-10 w-auto object-contain"
            style={{ maxWidth: '44px' }}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <div
            className="h-10 w-10 rounded-lg items-center justify-center hidden"
            style={{
              background:
                'linear-gradient(135deg, #26a69a 0%, #2962ff 100%)',
            }}
          >
            <span className="text-xl font-bold text-white">TA</span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span
                className="font-bold text-xl"
                style={{ color: '#26a69a' }}
              >
                Trade
              </span>
              <span
                className="font-bold text-xl"
                style={{ color: '#2962ff' }}
              >
                Axis
              </span>
            </div>
            <div
              className="text-[10px] -mt-1 hidden sm:block"
              style={{ color: '#787b86' }}
            >
              Indian Markets Terminal
            </div>
          </div>
        </div>

        <div
          className="text-lg font-bold lg:text-base"
          style={{
            color: headlinePnL >= 0 ? '#26a69a' : '#ef5350',
          }}
        >
          {headlinePnL >= 0 ? '+' : ''}
          {formatINR(headlinePnL)}
        </div>

        {/* Mobile refresh button */}
        <button
          onClick={handleRefreshData}
          disabled={isRefreshing}
          className="lg:hidden p-2 rounded-lg disabled:opacity-50"
          style={{ background: theme === 'light' ? '#f1f5f9' : '#2a2e39' }}
          title="Refresh"
        >
          <RefreshCw
            size={18}
            color={theme === 'light' ? '#64748b' : '#787b86'}
            className={isRefreshing ? 'animate-spin' : ''}
          />
        </button>

        <div className="hidden lg:flex items-center gap-4">
          <div className="text-sm" style={{ color: '#787b86' }}>
            <span style={{ color: '#d1d4dc' }}>
              {selectedAccount?.account_number}
            </span>
            <span
              className="ml-2 px-2 py-0.5 rounded text-xs"
              style={{
                background: selectedAccount?.is_demo
                  ? '#f5c54220'
                  : '#26a69a20',
                color: selectedAccount?.is_demo
                  ? '#f5c542'
                  : '#26a69a',
              }}
            >
              {selectedAccount?.is_demo ? 'DEMO' : 'LIVE'}
            </span>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: '#2a2e39', color: '#d1d4dc' }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Desktop */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        <DesktopTerminal
          leftTop={
            <MarketWatchPanel
              symbols={symbols}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={setSelectedSymbol}
              watchlists={watchlists}
              activeWatchlistId={activeWatchlistId}
              activeSymbols={activeSymbols}
              onSwitchWatchlist={handleSwitchWatchlist}
              onCreateWatchlist={handleCreateWatchlist}
              onToggleSymbol={toggleSymbolInWatchlist}
            />
          }
          leftBottom={
            <NavigatorPanel
              accounts={accounts}
              selectedAccount={selectedAccount}
              onSelectAccount={setSelectedAccount}
            />
          }
          centerTop={<ChartWorkspace symbol={selectedSymbol} />}
          centerBottom={
            <ToolboxPanel
              accountId={selectedAccount?.id}
              openTrades={openTrades}
              tradeHistory={tradeHistory}
              onCloseTrade={handleCloseTrade}
            />
          }
          right={
            <OrderDockPanel
              symbol={selectedSymbol}
              bid={bid}
              ask={ask}
              leverage={selectedAccount?.leverage || 5}
              freeMargin={selectedAccount?.free_margin || 0}
              onBuy={(qty) => placeOrderWithQty('buy', qty)}
              onSell={(qty) => placeOrderWithQty('sell', qty)}
            />
          }
        />
      </div>

      {/* Mobile — all render functions, no <Component /> */}
      <div
        className="lg:hidden flex-1 overflow-hidden relative"
        style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
        onTouchStart={handleMobileTouchStart}
        onTouchMove={handleMobileTouchMove}
        onTouchEnd={handleMobileTouchEnd}
        onTouchCancel={handleMobileTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {isRefreshing && (
          <div
            className="absolute top-0 left-0 right-0 flex items-center justify-center py-3 z-10"
            style={{ background: theme === 'light' ? '#f1f5f9' : '#2a2e39' }}
          >
            <RefreshCw size={16} className="animate-spin mr-2" color="#2962ff" />
            <span className="text-xs font-medium" style={{ color: '#2962ff' }}>Refreshing...</span>
          </div>
        )}
        
        {activeTab === 'quotes' && renderQuotesTab()}
        {activeTab === 'chart' && renderChartTab()}
        {activeTab === 'trade' && renderTradeTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'messages' && renderMessagesTab()}
        {activeTab === 'wallet' && (
          <WalletPage
            selectedAccount={selectedAccount}
            user={user}
            intent={walletIntent}
          />
        )}
        {activeTab === 'settings' && renderSettingsTab()}
        {activeTab === 'admin' && isAdmin && <AdminPanelPage />}
      </div>

      {renderMobileNav()}
      {renderOrderModal()}
      {renderOrderConfirmation()}
      {renderChangePasswordModal()}
      {renderWatchlistCreateModal()}
    </div>
  );
};

export default Dashboard;
