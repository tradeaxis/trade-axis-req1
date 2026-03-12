// frontend/src/pages/Dashboard.jsx
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
} from 'lucide-react';

import PriceChart from '../components/charts/PriceChart';
import WalletPage from '../components/account/Wallet';
import AdminUsers from '../components/admin/AdminUsers';
import AdminPanel from '../components/admin/AdminPanel';

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
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ============ EXPIRY FILTER HELPER ============
const filterByExpiry = (symbolsList) => {
  const now = new Date();

  const withExpiry = symbolsList.filter((s) => s.expiry_date);
  const withoutExpiry = symbolsList.filter((s) => !s.expiry_date);

  if (withExpiry.length === 0) return symbolsList;

  // Find future expiries sorted by date
  const futureExpiries = withExpiry
    .filter((s) => new Date(s.expiry_date) >= now)
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  if (futureExpiries.length === 0) return symbolsList;

  // Nearest expiry month
  const nearestExp = new Date(futureExpiries[0].expiry_date);
  const nearMonth = nearestExp.getMonth();
  const nearYear = nearestExp.getFullYear();

  // All expiries in the nearest month — find the LAST one
  const nearMonthDates = [
    ...new Set(
      futureExpiries
        .filter((s) => {
          const e = new Date(s.expiry_date);
          return e.getMonth() === nearMonth && e.getFullYear() === nearYear;
        })
        .map((s) => new Date(s.expiry_date).getTime())
    ),
  ].sort((a, b) => a - b);

  const lastNearExpiry =
    nearMonthDates.length > 0
      ? new Date(nearMonthDates[nearMonthDates.length - 1])
      : null;

  const daysToExpiry = lastNearExpiry
    ? (lastNearExpiry - now) / (1000 * 60 * 60 * 24)
    : Infinity;

  // Show next month only if within 2 days of current month's last expiry
  const showNextMonth = daysToExpiry <= 2;
  const nextMonth = (nearMonth + 1) % 12;
  const nextYear = nearMonth === 11 ? nearYear + 1 : nearYear;

  const filtered = withExpiry.filter((s) => {
    const exp = new Date(s.expiry_date);
    if (exp < now) return false;

    const expMonth = exp.getMonth();
    const expYear = exp.getFullYear();

    if (expMonth === nearMonth && expYear === nearYear) return true;
    if (showNextMonth && expMonth === nextMonth && expYear === nextYear) return true;

    return false;
  });

  return [...filtered, ...withoutExpiry];
};

// ============ MARKET HOURS CHECK (frontend) ============
const isMarketOpenNow = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

// ============ DASHBOARD COMPONENT ============
const Dashboard = () => {
  const {
    user,
    accounts,
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
    tradeHistory,
    deals,
    dealsSummary,
    fetchOpenTrades,
    fetchPendingOrders,
    fetchTradeHistory,
    fetchDeals,
    placeOrder,
    closeTrade,
    modifyTrade,
    addQuantity,
    cancelOrder,
    updateTradePnL,
    updateTradesPnLBatch,
  } = useTradingStore();

  const { symbols, quotes, fetchSymbols, getQuote, updatePrice } = useMarketStore();

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

  // Theme
  const theme = useSettingsStore((s) => s.interface.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);

  // ── Core state ──
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('NIFTY-FUT');
  const [symbolData, setSymbolData] = useState(null);

  // Mobile tabs
  const [activeTab, setActiveTab] = useState('trade');

  // Wallet intent
  const [walletIntent, setWalletIntent] = useState('deposit');

  // Quotes
  const [quotesViewMode, setQuotesViewMode] = useState('advanced');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Watchlist dropdown
  const [isWatchlistDropdownOpen, setIsWatchlistDropdownOpen] = useState(false);
  const [editingWatchlistId, setEditingWatchlistId] = useState(null);
  const [editingWatchlistName, setEditingWatchlistName] = useState('');
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
  const [modifyModal, setModifyModal] = useState(null);
  const [expandedTradeId, setExpandedTradeId] = useState(null);
  const [closeConfirmTrade, setCloseConfirmTrade] = useState(null);
  const [partialCloseQty, setPartialCloseQty] = useState('');

  // Order symbol search
  const [orderSymbolSearch, setOrderSymbolSearch] = useState('');

  // History
  const [historyPeriod, setHistoryPeriod] = useState('month');
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

  // ── LIFTED from CloseConfirmModal ──
  const [closeQty, setCloseQty] = useState(1);
  const [isPartialClose, setIsPartialClose] = useState(false);

  // ──────────────────────────────────────
  //  EFFECTS
  // ──────────────────────────────────────

  // ── Debounced search ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(quotesLocalSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [quotesLocalSearch]);

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

  // ── Fetch ALL symbols once on mount (lifted from QuotesTab) ──
  const fetchAllFuturesSymbols = useCallback(async () => {
    setLoadingAllSymbols(true);
    try {
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });
      if (res.data.success && res.data.symbols) {
        setAllFuturesSymbols(res.data.symbols);
        setSymbolsLoaded(true);
        console.log(`📊 Loaded ${res.data.symbols.length} symbols`);
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

  // ── Set initial symbol when symbols become available ──
  const initialSymbolSetRef = useRef(false);
  useEffect(() => {
    if (initialSymbolSetRef.current) return;
    const allSyms = allFuturesSymbols.length > 0 ? allFuturesSymbols : symbols || [];
    if (!allSyms.length) return;

    initialSymbolSetRef.current = true;
    const exists = selectedSymbol && allSyms.some((s) => s.symbol === selectedSymbol);
    if (!exists) {
      const nifty = allSyms.find(
        (s) => s.symbol === 'NIFTY-I' || s.symbol?.includes('NIFTY')
      );
      setSelectedSymbol(nifty?.symbol || allSyms[0].symbol);
    }
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

    const onPrice = (data) => updatePrice(data);

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

    const subs = Array.from(
      new Set([...(activeSymbols || []), selectedSymbol].filter(Boolean))
    );
    if (subs.length) socketService.subscribeSymbols(subs);
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
  }, [updatePrice, activeSymbols, selectedAccount, updateTradePnL, updateTradesPnLBatch, fetchOpenTrades, fetchTradeHistory]);

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
  const totalPnL = (openTrades || []).reduce(
    (sum, t) => sum + Number(t.profit || 0),
    0
  );

  const accountStats = useMemo(() => {
    const balance = Number(selectedAccount?.balance || 0);
    const margin = Number(selectedAccount?.margin || 0);
    const equity = balance + totalPnL;
    const freeMargin = Math.max(0, equity - margin);
    const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;
    const leverage = selectedAccount?.leverage || 5;

    return { balance, equity, margin, freeMargin, marginLevel, leverage, totalPnL };
  }, [selectedAccount, totalPnL]);

  const currentWatchlist = watchlists.find((w) => w.id === activeWatchlistId);

  const filteredSymbols = useMemo(() => {
    let list = symbols || [];
    list = list.filter((s) => matchesSelectedCategory(s, selectedCategory));

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      return list.filter((s) => {
        const sym = String(s.symbol || '').toLowerCase();
        const dn = String(s.display_name || '').toLowerCase();
        return sym.includes(term) || dn.includes(term);
      });
    }

    const wl = new Set((activeSymbols || []).map((x) => String(x).toUpperCase()));
    return list.filter((s) => wl.has(String(s.symbol).toUpperCase()));
  }, [symbols, searchTerm, selectedCategory, activeSymbols]);

  const quotesDisplayedSymbols = useMemo(() => {
    const sourceList =
      allFuturesSymbols.length > 0 ? allFuturesSymbols : symbols || [];

    // 1) Category filter
    let list = sourceList;
    if (selectedCategory !== 'all') {
      list = list.filter((s) => {
        const cat = String(s.category || '').toLowerCase();
        const sym = String(s.symbol || '').toUpperCase();
        const seg = String(s.segment || '').toUpperCase();
        const underlying = String(s.underlying || '').toUpperCase();

        if (selectedCategory === 'index_futures') {
          return (
            cat === 'index_futures' ||
            /NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX/i.test(underlying)
          );
        }
        if (selectedCategory === 'stock_futures') {
          return (
            cat === 'stock_futures' ||
            (seg === 'NFO' &&
              !cat.includes('index') &&
              !cat.includes('commodity') &&
              !/NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX/i.test(underlying))
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

    // 2) Expiry filter — only current month (+ next month if within 2 days)
    list = filterByExpiry(list);

    // 3) If searching → search ALL visible symbols
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const results = list.filter((s) => {
        const symStr = String(s.symbol || '').toLowerCase();
        const name = String(s.display_name || '').toLowerCase();
        const underlying = String(s.underlying || '').toLowerCase();
        return symStr.includes(term) || name.includes(term) || underlying.includes(term);
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

      return results.slice(0, 200);
    }

    // 4) Not searching → show watchlist symbols only
    const wl = new Set((activeSymbols || []).map((x) => String(x).toUpperCase()));
    if (wl.size === 0) {
      return list.filter((s) => s.series === 'I').slice(0, 20);
    }
    return list.filter((s) => wl.has(String(s.symbol).toUpperCase()));
  }, [allFuturesSymbols, symbols, searchTerm, selectedCategory, activeSymbols]);

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
    const name = window.prompt('New watchlist name?');
    if (!name) return;
    try {
      const created = await createWatchlist(name.trim(), false);
      setActiveWatchlistId(created.id);
      await fetchWatchlistSymbols(created.id);
      toast.success('Watchlist created');
      setIsWatchlistDropdownOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create watchlist');
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

    if (res?.success === false) toast.error(res.message || 'Failed');
  };

  const placeOrderWithQty = async (type, qty, execType = 'instant', execPrice = 0) => {
    if (!selectedAccount?.id || !selectedSymbol) return;

    // Frontend market-hours check (backend also validates)
    if (!isMarketOpenNow()) {
      toast.error('Market is closed. Orders cannot be placed outside trading hours (9:15 AM – 3:30 PM IST, Mon–Fri).');
      return;
    }

    // Determine effective order type
    let effectiveOrderType = 'market';
    let effectivePrice = 0;

    if (execType === 'buy_limit' || execType === 'sell_limit' || execType === 'buy_stop' || execType === 'sell_stop') {
      effectiveOrderType = execType;
      effectivePrice = Number(execPrice);

      if (!effectivePrice || effectivePrice <= 0) {
        toast.error('Please enter a valid price for this order type.');
        return;
      }

      const cmp = type === 'buy' ? ask : bid;

      // Validate Buy Limit: must be ≤ 0.5% below CMP
      if (execType === 'buy_limit' && effectivePrice > cmp * 0.995) {
        toast.error(`Buy Limit price must be at least 0.5% below current price (≤ ${(cmp * 0.995).toFixed(2)})`);
        return;
      }
      // Validate Sell Limit: must be ≥ 0.5% above CMP
      if (execType === 'sell_limit' && effectivePrice < cmp * 1.005) {
        toast.error(`Sell Limit price must be at least 0.5% above current price (≥ ${(cmp * 1.005).toFixed(2)})`);
        return;
      }
    }

    // Immediate feedback
    const loadingId = toast.loading(`Placing ${type.toUpperCase()} order…`);

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

    toast.dismiss(loadingId);

    if (result.success) {
      const priceStr = result.data?.open_price ? ` @ ₹${Number(result.data.open_price).toFixed(2)}` : '';
      const mergedStr = result.merged ? ' (merged into existing position)' : '';
      toast.success(`${type.toUpperCase()} ${qty} ${selectedSymbol}${priceStr}${mergedStr}`, { duration: 3000 });
      fetchOpenTrades(selectedAccount.id);
      fetchPendingOrders?.(selectedAccount.id);
      setShowOrderModal(false);
      setLimitPrice('');
      setOrderExecType('instant');
    } else {
      toast.error(result.message || 'Order failed');
    }
  };

  const handleCloseTrade = async (tradeId) => {
    const result = await closeTrade(tradeId, selectedAccount?.id);
    if (result.success) {
      toast.success('Position closed');
      setExpandedTradeId(null);
      setCloseConfirmTrade(null);
    } else {
      toast.error(result.message || 'Close failed');
    }
  };

  const handleModifyTrade = async (tradeId, newSL, newTP) => {
    const result = await modifyTrade?.(tradeId, {
      stopLoss: newSL,
      takeProfit: newTP,
    });
    if (result?.success) {
      toast.success('Modified');
      setModifyModal(null);
      fetchOpenTrades(selectedAccount.id);
    } else {
      toast.error(result?.message || 'Modify failed');
    }
  };

  const markAllRead = () => {
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
    setUnreadCount(0);
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

  // ════════════════════════════════════════
  //  RENDER FUNCTIONS (not components — no hooks, no remount cycles)
  // ════════════════════════════════════════

  // ============ CLOSE CONFIRM MODAL ============
  const renderCloseConfirmModal = () => {
    if (!closeConfirmTrade) return null;

    const trade = closeConfirmTrade;
    const pnl = Number(trade.profit || 0);
    const isProfit = pnl >= 0;
    const maxQty = Number(trade.quantity);
    const partialPnL = isPartialClose ? (pnl / maxQty) * closeQty : pnl;

    const handleClose = async () => {
      if (isPartialClose && closeQty >= maxQty) {
        await handleCloseTrade(trade.id);
      } else if (isPartialClose && closeQty > 0 && closeQty < maxQty) {
        const result = await closeTrade(trade.id, selectedAccount?.id, closeQty);
        if (result.success) {
          toast.success(`Closed ${closeQty} of ${maxQty} positions`);
          setCloseConfirmTrade(null);
        } else {
          toast.error(result.message || 'Partial close failed');
        }
      } else {
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
                    onChange={(e) => {
                      const val = Math.max(
                        1,
                        Math.min(maxQty, Number(e.target.value || 1))
                      );
                      setCloseQty(val);
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
            marginBottom: '4rem',
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
        className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
        onClick={() => setShowWatchlistMenu(false)}
      >
        <div
          className="w-full max-w-lg rounded-t-xl"
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
              Watchlists
            </h3>
            <button onClick={() => setShowWatchlistMenu(false)}>
              <X size={24} color="#787b86" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {watchlists.map((wl) => (
              <button
                key={wl.id}
                onClick={async () => {
                  setShowWatchlistMenu(false);
                  await handleSwitchWatchlist(wl.id);
                }}
                className="w-full p-4 text-left flex items-center justify-between border-b"
                style={{
                  borderColor: '#363a45',
                  background:
                    wl.id === activeWatchlistId
                      ? '#2962ff20'
                      : 'transparent',
                }}
              >
                <div className="flex items-center gap-3">
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
                </div>
                {wl.id === activeWatchlistId && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#2962ff' }}
                  />
                )}
              </button>
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

  // ============ QUOTES TAB (render function — NO hooks) ============
  const renderQuotesTab = () => {
    return (
      <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
        {/* ── Fixed Header ── */}
        <div className="p-3 border-b shrink-0" style={{ borderColor: '#363a45' }}>
          {/* Watchlist Selector */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setShowWatchlistMenu(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: '#2a2e39', border: '1px solid #363a45' }}
            >
              <Star size={16} color="#f5c542" />
              <span className="font-medium" style={{ color: '#d1d4dc' }}>
                {currentWatchlist?.name || 'Select Watchlist'}
              </span>
              <ChevronDown size={16} color="#787b86" />
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  symbolsFetchedRef.current = false;
                  fetchAllFuturesSymbols();
                }}
                className="p-2 rounded-lg"
                style={{ background: '#2a2e39' }}
                title="Refresh Symbols"
              >
                <RefreshCw size={18} color="#787b86" className={loadingAllSymbols ? 'animate-spin' : ''} />
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
                  background: selectedCategory === cat.id ? '#2962ff' : '#2a2e39',
                  color: selectedCategory === cat.id ? '#fff' : '#787b86',
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mt-2">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#787b86' }} />
            <input
              ref={quotesSearchInputRef}
              type="text"
              value={quotesLocalSearch}
              onChange={(e) => setQuotesLocalSearch(e.target.value)}
              placeholder="Search all futures (RELIANCE, NIFTY, GOLD...)"
              className="w-full pl-10 pr-10 py-2.5 rounded border text-base"
              style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
            {quotesLocalSearch && (
              <button
                onClick={() => { setQuotesLocalSearch(''); quotesSearchInputRef.current?.focus(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X size={16} color="#787b86" />
              </button>
            )}
          </div>

          {searchTerm && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs" style={{ color: '#787b86' }}>
                {quotesDisplayedSymbols.length} results for "{searchTerm}"
              </span>
              <span className="text-xs" style={{ color: '#2962ff' }}>Tap to trade</span>
            </div>
          )}
        </div>

        {/* ── Column Headers ── */}
        <div
          className="grid px-3 py-2 text-xs font-semibold border-b shrink-0"
          style={{
            gridTemplateColumns: '2.2fr 1fr 1fr',
            background: '#252832',
            borderColor: '#363a45',
            color: '#787b86',
          }}
        >
          <div>Symbol</div>
          <div className="text-right">Bid</div>
          <div className="text-right">Ask</div>
        </div>

        {/* ── Symbol List ── */}
        <div className="flex-1 overflow-y-auto">
          {loadingAllSymbols && allFuturesSymbols.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#787b86' }}>
              <RefreshCw size={32} className="animate-spin mx-auto mb-3" />
              <div>Loading symbols...</div>
            </div>
          ) : quotesDisplayedSymbols.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#787b86' }}>
              {searchTerm ? (
                <>
                  <Search size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base mb-1">No symbols found for "{searchTerm}"</div>
                  <div className="text-sm">Try searching by underlying name (e.g., RELIANCE, TCS, GOLD)</div>
                </>
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
              const symLow = Number(
                quote?.low || quote?.day_low || quote?.ohlc_low ||
                sym.low || sym.day_low || sym.low_price || sym.ohlc_low ||
                (sym.ohlc && sym.ohlc.low) ||
                0
              );
              const symHigh = Number(
                quote?.high || quote?.day_high || quote?.ohlc_high ||
                sym.high || sym.day_high || sym.high_price || sym.ohlc_high ||
                (sym.ohlc && sym.ohlc.high) ||
                0
              );

              // Build display name: underlying-series or full symbol
              const displaySymbol = sym.series
                ? `${sym.underlying || sym.symbol}-${sym.series}`
                : sym.symbol;

              const expiry = sym.expiry_date
                ? new Date(sym.expiry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                : '';

              return (
                <div
                  key={sym.symbol}
                  onClick={(e) => handleSymbolTap(sym, e)}
                  className="grid items-center px-3 py-2.5 border-b cursor-pointer hover:bg-white/5"
                  style={{
                    gridTemplateColumns: '2.2fr 1fr 1fr',
                    background: isSelected ? '#2a2e39' : 'transparent',
                    borderColor: '#363a45',
                    borderLeft: isSelected ? '3px solid #2962ff' : '3px solid transparent',
                  }}
                >
                  {/* Symbol Column — full name visible */}
                  <div className="flex items-center gap-2 min-w-0">
                    <Star
                      size={14}
                      color={inWL ? '#f5c542' : '#787b86'}
                      fill={inWL ? '#f5c542' : 'none'}
                      onClick={(e) => { e.stopPropagation(); toggleSymbolInWatchlist(sym.symbol); }}
                      className="shrink-0 cursor-pointer"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm leading-tight" style={{ color: '#d1d4dc', wordBreak: 'break-word' }}>
                        {displaySymbol}
                      </div>
                      {expiry && (
                        <div className="text-[10px] leading-tight" style={{ color: '#787b86' }}>
                          {expiry}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bid Column + L: underneath */}
                  <div className="text-right">
                    <div className="text-sm font-mono font-semibold" style={{ color: '#ef5350' }}>
                      {symBid > 0 ? symBid.toFixed(2) : '—'}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: '#787b86' }}>
                      L: {symLow > 0 ? symLow.toFixed(2) : '—'}
                    </div>
                  </div>

                  {/* Ask Column + H: underneath */}
                  <div className="text-right">
                    <div className="text-sm font-mono font-semibold" style={{ color: '#26a69a' }}>
                      {symAsk > 0 ? symAsk.toFixed(2) : '—'}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: '#787b86' }}>
                      H: {symHigh > 0 ? symHigh.toFixed(2) : '—'}
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

  // Reset modify values when modal opens/changes
  useEffect(() => {
    if (modifyModal) {
      setModifySL(modifyModal.stop_loss || '');
      setModifyTP(modifyModal.take_profit || '');
      setModifyTab('sltp');
      setAddQty(1);
      setAddQtyLoading(false);
    }
  }, [modifyModal]);

  // History memos (lifted from HistoryTab)
  const historyUniqueSymbols = useMemo(() => {
    const syms = new Set((tradeHistory || []).map((t) => t.symbol));
    return Array.from(syms).sort();
  }, [tradeHistory]);

  const historyOverallStats = useMemo(() => {
    let filtered = filteredHistoryTrades;
    if (historyLocalSymbolFilter) {
      filtered = filtered.filter((t) => t.symbol === historyLocalSymbolFilter);
    }
    const totalProfit = filtered
      .filter((t) => Number(t.profit || 0) > 0)
      .reduce((sum, t) => sum + Number(t.profit || 0), 0);
    const totalLoss = Math.abs(
      filtered
        .filter((t) => Number(t.profit || 0) < 0)
        .reduce((sum, t) => sum + Number(t.profit || 0), 0)
    );
    const netPnL = totalProfit - totalLoss;
    return { totalProfit, totalLoss, netPnL, count: filtered.length };
  }, [filteredHistoryTrades, historyLocalSymbolFilter]);

  const historyDisplayTrades = useMemo(() => {
    if (!historyLocalSymbolFilter) return filteredHistoryTrades;
    return filteredHistoryTrades.filter(
      (t) => t.symbol === historyLocalSymbolFilter
    );
  }, [filteredHistoryTrades, historyLocalSymbolFilter]);

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

  // ── Position aggregates for history ──
  const positionAggregates = useMemo(() => {
    let totalBuyQty = 0;
    let totalSellQty = 0;
    (historyDisplayTrades || []).forEach((t) => {
      const q = Number(t.quantity || 0);
      if (t.trade_type === 'buy') totalBuyQty += q;
      else totalSellQty += q;
    });
    return { totalBuyQty, totalSellQty };
  }, [historyDisplayTrades]);

  // ══════════════════════════════════════════════════════════════
  //  RENDER FUNCTIONS (continued from Part 1)
  // ══════════════════════════════════════════════════════════════

  // ============ CHART TAB ============
  const renderChartTab = () => {
    const chartHeight = chartFullscreen ? window.innerHeight - 140 : 420;

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
            className="absolute left-4 right-4 rounded-lg p-4"
            style={{
              bottom: chartFullscreen ? 12 : 70,
              background: 'rgba(30, 34, 45, 0.95)',
              border: '1px solid #363a45',
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
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value || 1)))
                }
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
        className="fixed inset-0 z-[9999] bg-black/60 flex items-end lg:items-center justify-center"
        onClick={() => setShowOrderModal(false)}
      >
        <div
          className="w-full lg:max-w-md lg:rounded-xl rounded-t-xl max-h-[92vh] flex flex-col overflow-hidden"
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
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="h-10 w-10 flex items-center justify-center rounded-l-lg text-lg font-bold shrink-0"
                  style={{ background: '#363a45', color: '#d1d4dc', border: '1px solid #363a45' }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
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
                  onClick={() => setQuantity(quantity + 1)}
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
                    onChange={(e) => setDeviation(Math.max(0, Number(e.target.value || 0)))}
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

  // ============ MODIFY POSITION MODAL ============
  const renderModifyPositionModal = () => {
    if (!modifyModal) return null;

    const trade = modifyModal;
    const currentPrice = Number(
      trade.current_price || trade.open_price || 0
    );
    const leverage = accountStats.leverage || 5;
    const estimatedMargin =
      addQty > 0 ? (currentPrice * addQty) / leverage : 0;

    const handleAddQuantity = async () => {
      if (!addQty || addQty <= 0) {
        return toast.error('Enter a valid quantity');
      }

      setAddQtyLoading(true);
      const result = await addQuantity(
        trade.id,
        selectedAccount?.id,
        addQty
      );
      setAddQtyLoading(false);

      if (result.success) {
        toast.success(result.message);
        setModifyModal(null);
        fetchOpenTrades(selectedAccount.id);
      } else {
        toast.error(result.message || 'Failed to add quantity');
      }
    };

    return (
      <div
        className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
        onClick={() => setModifyModal(null)}
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
              Modify Position
            </h3>
            <button onClick={() => setModifyModal(null)}>
              <X size={22} color="#787b86" />
            </button>
          </div>

          <div className="p-4 pb-0">
            <div
              className="p-3 rounded-lg"
              style={{ background: '#2a2e39' }}
            >
              <div className="text-sm" style={{ color: '#787b86' }}>
                Symbol
              </div>
              <div
                className="font-bold text-lg"
                style={{ color: '#d1d4dc' }}
              >
                {trade.symbol}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span
                  className="text-sm"
                  style={{
                    color:
                      trade.trade_type === 'buy'
                        ? '#26a69a'
                        : '#ef5350',
                  }}
                >
                  {trade.trade_type?.toUpperCase()} • Qty:{' '}
                  {trade.quantity}
                </span>
                <span
                  className="text-sm"
                  style={{ color: '#787b86' }}
                >
                  @ {formatINR(trade.open_price)}
                </span>
              </div>
            </div>
          </div>

          <div
            className="flex mx-4 mt-3 rounded-lg overflow-hidden"
            style={{ border: '1px solid #363a45' }}
          >
            <button
              type="button"
              onClick={() => setModifyTab('sltp')}
              className="flex-1 py-2.5 text-sm font-medium transition-colors"
              style={{
                background:
                  modifyTab === 'sltp' ? '#2962ff' : '#2a2e39',
                color: modifyTab === 'sltp' ? '#fff' : '#787b86',
              }}
            >
              SL / TP
            </button>
            <button
              type="button"
              onClick={() => setModifyTab('addqty')}
              className="flex-1 py-2.5 text-sm font-medium transition-colors"
              style={{
                background:
                  modifyTab === 'addqty' ? '#2962ff' : '#2a2e39',
                color: modifyTab === 'addqty' ? '#fff' : '#787b86',
              }}
            >
              + Add Quantity
            </button>
          </div>

          <div className="p-4 space-y-4">
            {modifyTab === 'sltp' && (
              <>
                <div>
                  <label
                    className="block text-sm mb-2"
                    style={{ color: '#787b86' }}
                  >
                    Stop Loss
                  </label>
                  <input
                    type="number"
                    value={modifySL}
                    onChange={(e) => setModifySL(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-base"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      color: '#d1d4dc',
                    }}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label
                    className="block text-sm mb-2"
                    style={{ color: '#787b86' }}
                  >
                    Take Profit
                  </label>
                  <input
                    type="number"
                    value={modifyTP}
                    onChange={(e) => setModifyTP(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg text-base"
                    style={{
                      background: '#2a2e39',
                      border: '1px solid #363a45',
                      color: '#d1d4dc',
                    }}
                    placeholder="0.00"
                  />
                </div>
                <button
                  onClick={() =>
                    handleModifyTrade(trade.id, modifySL, modifyTP)
                  }
                  className="w-full py-3.5 rounded-lg font-semibold text-base"
                  style={{ background: '#2962ff', color: '#fff' }}
                >
                  Modify SL / TP
                </button>
              </>
            )}

            {modifyTab === 'addqty' && (
              <>
                {closingMode && (
                  <div
                    className="p-3 rounded-lg flex items-center gap-2"
                    style={{
                      background: '#ff980020',
                      border: '1px solid #ff980050',
                    }}
                  >
                    <AlertTriangle size={18} color="#ff9800" />
                    <div
                      className="text-sm"
                      style={{ color: '#ff9800' }}
                    >
                      Closing mode is active. You cannot add quantity.
                    </div>
                  </div>
                )}

                {!closingMode && (
                  <>
                    <div>
                      <label
                        className="block text-sm mb-2"
                        style={{ color: '#787b86' }}
                      >
                        Additional Quantity
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setAddQty(Math.max(1, addQty - 1))
                          }
                          className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
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
                          value={addQty}
                          onChange={(e) =>
                            setAddQty(
                              Math.max(
                                1,
                                Number(e.target.value || 1)
                              )
                            )
                          }
                          className="flex-1 px-4 py-3 rounded-lg text-xl font-bold text-center"
                          style={{
                            background: '#2a2e39',
                            border: '1px solid #363a45',
                            color: '#d1d4dc',
                          }}
                          min="1"
                        />
                        <button
                          type="button"
                          onClick={() => setAddQty(addQty + 1)}
                          className="w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold"
                          style={{
                            background: '#2a2e39',
                            border: '1px solid #363a45',
                            color: '#d1d4dc',
                          }}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {[1, 5, 10, 25, 50].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setAddQty(q)}
                          className="flex-1 py-2 rounded-lg text-sm font-medium"
                          style={{
                            background:
                              addQty === q ? '#2962ff' : '#2a2e39',
                            color:
                              addQty === q ? '#fff' : '#787b86',
                            border: '1px solid #363a45',
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>

                    <div
                      className="p-3 rounded-lg space-y-2"
                      style={{
                        background: '#252832',
                        border: '1px solid #363a45',
                      }}
                    >
                      <div className="flex justify-between text-sm">
                        <span style={{ color: '#787b86' }}>
                          Current Price
                        </span>
                        <span style={{ color: '#d1d4dc' }}>
                          {formatINR(currentPrice)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span style={{ color: '#787b86' }}>
                          Add Quantity
                        </span>
                        <span style={{ color: '#d1d4dc' }}>
                          {addQty}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span style={{ color: '#787b86' }}>
                          Est. Additional Margin
                        </span>
                        <span style={{ color: '#f5c542' }}>
                          {formatINR(estimatedMargin)}
                        </span>
                      </div>
                      <div
                        className="flex justify-between text-sm pt-2 border-t"
                        style={{ borderColor: '#363a45' }}
                      >
                        <span style={{ color: '#787b86' }}>
                          New Total Qty
                        </span>
                        <span
                          className="font-bold"
                          style={{ color: '#d1d4dc' }}
                        >
                          {Number(trade.quantity) + addQty}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span style={{ color: '#787b86' }}>
                          Free Margin
                        </span>
                        <span
                          style={{
                            color:
                              accountStats.freeMargin >=
                              estimatedMargin
                                ? '#26a69a'
                                : '#ef5350',
                          }}
                        >
                          {formatINR(accountStats.freeMargin)}
                        </span>
                      </div>
                    </div>

                    {estimatedMargin > accountStats.freeMargin && (
                      <div
                        className="p-2 rounded-lg flex items-center gap-2"
                        style={{ background: '#ef535020' }}
                      >
                        <AlertTriangle size={16} color="#ef5350" />
                        <span
                          className="text-xs"
                          style={{ color: '#ef5350' }}
                        >
                          Insufficient free margin
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleAddQuantity}
                      disabled={
                        addQtyLoading ||
                        addQty <= 0 ||
                        estimatedMargin > accountStats.freeMargin
                      }
                      className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
                      style={{
                        background:
                          trade.trade_type === 'buy'
                            ? '#26a69a'
                            : '#ef5350',
                        color: '#fff',
                      }}
                    >
                      {addQtyLoading
                        ? 'Adding...'
                        : `Add ${addQty} to ${trade.trade_type?.toUpperCase()} Position`}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============ TRADE TAB ============
  const renderTradeTab = () => (
    <div
      className="flex flex-col h-full"
      style={{ background: '#1e222d' }}
    >
      <div
        className="p-3 border-b"
        style={{ borderColor: '#363a45' }}
      >
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div
            className="p-3 rounded-lg"
            style={{ background: '#2a2e39' }}
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
            style={{ background: '#2a2e39' }}
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
            style={{ background: '#2a2e39' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Floating P&L
            </div>
            <div
              className="font-bold text-base"
              style={{
                color: totalPnL >= 0 ? '#26a69a' : '#ef5350',
              }}
            >
              {totalPnL >= 0 ? '+' : ''}
              {formatINR(totalPnL)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div
            className="p-2 rounded-lg"
            style={{ background: '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Margin
            </div>
            <div
              className="font-semibold text-sm"
              style={{ color: '#f5c542' }}
            >
              {formatINR(accountStats.margin)}
            </div>
          </div>
          <div
            className="p-2 rounded-lg"
            style={{ background: '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Free Margin
            </div>
            <div
              className="font-semibold text-sm"
              style={{ color: '#26a69a' }}
            >
              {formatINR(accountStats.freeMargin)}
            </div>
          </div>
          <div
            className="p-2 rounded-lg"
            style={{ background: '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Margin Lvl
            </div>
            <div
              className="font-semibold text-sm"
              style={{
                color:
                  accountStats.marginLevel > 100
                    ? '#26a69a'
                    : '#ef5350',
              }}
            >
              {accountStats.margin > 0
                ? `${accountStats.marginLevel.toFixed(0)}%`
                : '∞'}
            </div>
          </div>
          <div
            className="p-2 rounded-lg"
            style={{ background: '#252832' }}
          >
            <div
              className="text-xs font-medium"
              style={{ color: '#787b86' }}
            >
              Leverage
            </div>
            <div
              className="font-semibold text-sm"
              style={{ color: '#2962ff' }}
            >
              1:{accountStats.leverage}
            </div>
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
            <div
              className="flex gap-2 p-3 border-b"
              style={{ borderColor: '#363a45' }}
            >
              {closingMode && (
                <div
                  className="flex-1 p-2 rounded-lg flex items-center gap-2"
                  style={{ background: '#ff980020' }}
                >
                  <Lock size={16} color="#ff9800" />
                  <span
                    className="text-xs"
                    style={{ color: '#ff9800' }}
                  >
                    Closing mode active - You can only close existing
                    positions
                  </span>
                </div>
              )}
              {!closingMode && (
                <button
                  onClick={() => setShowOrderModal(true)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
                  style={{ background: '#2962ff', color: '#fff' }}
                >
                  + New Order
                </button>
              )}
            </div>

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
                const pnl = Number(trade.profit || 0);
                const isProfit = pnl >= 0;
                const isExpanded = expandedTradeId === trade.id;

                return (
                  <div
                    key={trade.id}
                    className="border-b"
                    style={{
                      borderColor: '#363a45',
                      background: isExpanded
                        ? '#252832'
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
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center"
                            style={{
                              background:
                                trade.trade_type === 'buy'
                                  ? '#26a69a20'
                                  : '#ef535020',
                            }}
                          >
                            {trade.trade_type === 'buy' ? (
                              <TrendingUp
                                size={16}
                                color="#26a69a"
                              />
                            ) : (
                              <TrendingDown
                                size={16}
                                color="#ef5350"
                              />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className="font-bold text-base"
                                style={{ color: '#d1d4dc' }}
                              >
                                {trade.symbol}
                              </span>
                              <span
                                className="font-bold text-base px-1.5 py-0.5 rounded"
                                style={{
                                  color: trade.trade_type === 'buy' ? '#26a69a' : '#ef5350',
                                  background: trade.trade_type === 'buy' ? '#26a69a15' : '#ef535015',
                                }}
                              >
                                {trade.quantity}
                              </span>
                            </div>
                            <div
                              className="text-xs"
                              style={{ color: '#787b86' }}
                            >
                              {String(trade.trade_type || '').toUpperCase()}
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
                        style={{ color: '#787b86' }}
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
                              setModifyModal(trade);
                            }}
                            className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                            style={{
                              background: '#2a2e39',
                              color: '#d1d4dc',
                              border: '1px solid #363a45',
                            }}
                          >
                            <Edit3 size={16} />
                            Modify
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
                            style={{ color: '#787b86' }}
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
          <div
            className="p-6 text-center"
            style={{ color: '#787b86' }}
          >
            {pendingOrders?.length ? (
              <div>
                {pendingOrders.map((o) => (
                  <div
                    key={o.id}
                    className="p-3 rounded-lg mb-2 text-left"
                    style={{ background: '#2a2e39' }}
                  >
                    <div className="flex justify-between">
                      <span
                        style={{
                          color: '#d1d4dc',
                          fontWeight: 700,
                        }}
                      >
                        {o.symbol}
                      </span>
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
                      {o.order_type} | Qty {o.quantity} | @{' '}
                      {Number(o.price || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
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
                  <span style={{ color: '#26a69a' }}>
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

      {renderModifyPositionModal()}
      {renderCloseConfirmModal()}
    </div>
  );

  // ============ HISTORY TAB ============
  const renderHistoryTab = () => {
    const periodLabel = HISTORY_PERIODS.find((p) => p.id === historyPeriod)?.label || 'Last Month';

    return (
      <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
        {/* ── Header ── */}
        <div className="p-3 border-b shrink-0" style={{ borderColor: '#363a45' }}>
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
                    background: historyViewMode === m.id ? '#2a2e39' : 'transparent',
                    color: historyViewMode === m.id ? '#d1d4dc' : '#787b86',
                    border: `1px solid ${historyViewMode === m.id ? '#363a45' : 'transparent'}`,
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
                style={{ background: '#2a2e39', border: '1px solid #363a45' }}
              >
                <CalendarDays size={16} color="#787b86" />
                <span className="text-xs font-medium" style={{ color: '#d1d4dc' }}>{periodLabel}</span>
                <ChevronDown size={14} color="#787b86" />
              </button>

              {showHistoryCalendar && (
                <div
                  className="absolute top-full right-0 mt-1 rounded-lg overflow-hidden z-30 w-44"
                  style={{ background: '#2a2e39', border: '1px solid #363a45' }}
                >
                  {HISTORY_PERIODS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setHistoryPeriod(p.id); setShowHistoryCalendar(false); }}
                      className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/5"
                      style={{ color: historyPeriod === p.id ? '#2962ff' : '#d1d4dc' }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(historyViewMode === 'positions' || historyViewMode === 'deals') && (
            <div className="relative" ref={historyViewMode === 'deals' ? dealsDropdownRef : historyDropdownRef}>
              <button
                onClick={() => {
                  if (historyViewMode === 'deals') setShowDealsSymbolDropdown(!showDealsSymbolDropdown);
                  else setShowHistorySymbolDropdown(!showHistorySymbolDropdown);
                }}
                className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              >
                <span>
                  {historyViewMode === 'deals'
                    ? dealsSymbolFilter || 'All Symbols'
                    : historyLocalSymbolFilter || 'All Symbols'}
                </span>
                <ChevronDown size={16} color="#787b86" />
              </button>

              {historyViewMode === 'positions' && showHistorySymbolDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-60 overflow-y-auto" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
                  <button onClick={() => { setHistoryLocalSymbolFilter(''); setShowHistorySymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: !historyLocalSymbolFilter ? '#2962ff' : '#d1d4dc' }}>All Symbols</button>
                  {historyUniqueSymbols.map((sym) => (
                    <button key={sym} onClick={() => { setHistoryLocalSymbolFilter(sym); setShowHistorySymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: historyLocalSymbolFilter === sym ? '#2962ff' : '#d1d4dc' }}>{sym}</button>
                  ))}
                </div>
              )}

              {historyViewMode === 'deals' && showDealsSymbolDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 rounded-lg overflow-hidden z-20 max-h-60 overflow-y-auto" style={{ background: '#2a2e39', border: '1px solid #363a45' }}>
                  <button onClick={() => { setDealsSymbolFilter(''); setShowDealsSymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: !dealsSymbolFilter ? '#2962ff' : '#d1d4dc' }}>All Symbols</button>
                  {dealsUniqueSymbols.map((sym) => (
                    <button key={sym} onClick={() => { setDealsSymbolFilter(sym); setShowDealsSymbolDropdown(false); }} className="w-full px-3 py-2 text-left text-sm hover:bg-white/5" style={{ color: dealsSymbolFilter === sym ? '#2962ff' : '#d1d4dc' }}>{sym}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Positions Stats ── */}
        {historyViewMode === 'positions' && (
          <div className="p-3 border-b shrink-0" style={{ borderColor: '#363a45', background: '#252832' }}>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-xs" style={{ color: '#787b86' }}>Trades</div>
                <div className="font-bold text-sm" style={{ color: '#d1d4dc' }}>{historyOverallStats.count}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: '#787b86' }}>Total Buy</div>
                <div className="font-bold text-sm" style={{ color: '#26a69a' }}>{positionAggregates.totalBuyQty}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: '#787b86' }}>Total Sell</div>
                <div className="font-bold text-sm" style={{ color: '#ef5350' }}>{positionAggregates.totalSellQty}</div>
              </div>
              <div>
                <div className="text-xs" style={{ color: '#787b86' }}>Net P&L</div>
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
              {historyDisplayTrades.length === 0 ? (
                <div className="p-8 text-center" style={{ color: '#787b86' }}>
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base">No closed positions</div>
                </div>
              ) : (
                historyDisplayTrades.map((t) => {
                  const pnl = Number(t.profit || 0);
                  return (
                    <div key={t.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base" style={{ color: '#d1d4dc' }}>{t.symbol}</span>
                            <span className="font-bold text-sm px-1.5 py-0.5 rounded" style={{ color: t.trade_type === 'buy' ? '#26a69a' : '#ef5350', background: t.trade_type === 'buy' ? '#26a69a15' : '#ef535015' }}>
                              {t.quantity}
                            </span>
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: '#787b86' }}>
                            {String(t.trade_type || '').toUpperCase()} • {t.close_time ? new Date(t.close_time).toLocaleString() : ''}
                          </div>
                        </div>
                        <div className="font-bold text-lg" style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350' }}>
                          {pnl >= 0 ? '+' : ''}{formatINR(pnl)}
                        </div>
                      </div>
                      <div className="flex gap-4 mt-2 text-xs" style={{ color: '#787b86' }}>
                        <span>Open: {Number(t.open_price || 0).toFixed(2)}</span>
                        <span>Close: {Number(t.close_price || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {historyViewMode === 'orders' && (
            <>
              {(historyDisplayTrades || []).length === 0 ? (
                <div className="p-8 text-center" style={{ color: '#787b86' }}>
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base">No orders found</div>
                </div>
              ) : (
                (historyDisplayTrades || []).map((o) => (
                  <div key={o.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm" style={{ color: '#d1d4dc' }}>{o.symbol}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: o.trade_type === 'buy' ? '#26a69a20' : '#ef535020', color: o.trade_type === 'buy' ? '#26a69a' : '#ef5350' }}>
                          {String(o.trade_type || '').toUpperCase()} {o.quantity}
                        </span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: '#26a69a20', color: '#26a69a' }}>
                        executed
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs" style={{ color: '#787b86' }}>@ {Number(o.open_price || 0).toFixed(2)}</div>
                      <div className="text-xs" style={{ color: '#787b86' }}>{o.open_time ? new Date(o.open_time).toLocaleString() : ''}</div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {historyViewMode === 'deals' && (
            <>
              {dealsSummary && (
                <div className="p-3 border-b shrink-0" style={{ borderColor: '#363a45', background: '#252832' }}>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex justify-between">
                      <span style={{ color: '#787b86' }}>Profit:</span>
                      <span style={{ color: '#26a69a' }}>+{formatINR(dealsSummary.totalProfit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#787b86' }}>Loss:</span>
                      <span style={{ color: '#ef5350' }}>-{formatINR(dealsSummary.totalLoss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#787b86' }}>Deposits:</span>
                      <span style={{ color: '#26a69a' }}>+{formatINR(dealsSummary.totalDeposits)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: '#787b86' }}>Withdrawals:</span>
                      <span style={{ color: '#ef5350' }}>-{formatINR(dealsSummary.totalWithdrawals)}</span>
                    </div>
                    <div className="flex justify-between col-span-2 pt-2 border-t" style={{ borderColor: '#363a45' }}>
                      <span style={{ color: '#787b86' }}>Commission:</span>
                      <span className="font-bold" style={{ color: '#f5c542' }}>{formatINR(dealsSummary.totalCommission)}</span>
                    </div>
                  </div>
                </div>
              )}

              {filteredDeals.length === 0 ? (
                <div className="p-8 text-center" style={{ color: '#787b86' }}>
                  <Clock size={48} className="mx-auto mb-3 opacity-30" />
                  <div className="text-base">No deals found</div>
                </div>
              ) : (
                filteredDeals.map((d, idx) => {
                  const dp = Number(d.profit || 0);
                  const dt = d.time || d.close_time || d.open_time || d.created_at;
                  return (
                    <div key={d.id || idx} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm" style={{ color: '#d1d4dc' }}>{d.symbol || '—'}</span>
                          {d.type && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: d.type === 'buy' ? '#26a69a20' : d.type === 'sell' ? '#ef535020' : '#2962ff20', color: d.type === 'buy' ? '#26a69a' : d.type === 'sell' ? '#ef5350' : '#2962ff' }}>
                              {String(d.type).toUpperCase()}
                            </span>
                          )}
                        </div>
                        {dp !== 0 && (
                          <span className="font-bold text-sm" style={{ color: dp >= 0 ? '#26a69a' : '#ef5350' }}>
                            {dp >= 0 ? '+' : ''}{formatINR(dp)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          {d.quantity ? `Qty: ${d.quantity}` : ''}{d.price ? ` @ ${Number(d.price).toFixed(2)}` : ''}
                          {d.commission ? ` | Comm: ${formatINR(d.commission)}` : ''}
                        </div>
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          {dt ? new Date(dt).toLocaleString() : ''}
                        </div>
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
  const renderMessagesTab = () => (
    <div
      className="flex flex-col h-full"
      style={{ background: '#1e222d' }}
    >
      <div
        className="p-4 border-b"
        style={{ borderColor: '#363a45' }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            className="font-bold text-xl"
            style={{ color: '#d1d4dc' }}
          >
            Messages
          </h2>
          <button
            className="text-sm font-medium px-3 py-1.5 rounded-lg"
            style={{ background: '#2a2e39', color: '#2962ff' }}
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
                background:
                  messageCategory === c.id ? '#2962ff' : '#2a2e39',
                color:
                  messageCategory === c.id ? '#fff' : '#787b86',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div
            className="p-8 text-center"
            style={{ color: '#787b86' }}
          >
            <MessageSquare
              size={48}
              className="mx-auto mb-3 opacity-30"
            />
            <div className="text-base">No messages yet</div>
          </div>
        ) : (
          filteredMessages.map((m) => (
            <div
              key={m.id}
              className="p-4 border-b"
              style={{
                borderColor: '#363a45',
                background: m.read
                  ? 'transparent'
                  : 'rgba(41, 98, 255, 0.06)',
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: '#2a2e39' }}
                >
                  {m.type === 'trade' ? (
                    <TrendingUp size={20} color="#26a69a" />
                  ) : (
                    <Bell size={20} color="#2962ff" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span
                      className="font-semibold text-base"
                      style={{ color: '#d1d4dc' }}
                    >
                      {m.title}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: '#787b86' }}
                    >
                      {m.time
                        ? new Date(m.time).toLocaleTimeString()
                        : ''}
                    </span>
                  </div>
                  <p
                    className="text-sm mt-1"
                    style={{
                      color: '#787b86',
                      wordBreak: 'break-word',
                    }}
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
                Login with another account to save it for quick
                switching. Max {getMaxSavedAccounts()} accounts
                allowed.
              </div>
            </div>

            <div>
              <label
                className="block text-sm mb-2"
                style={{ color: '#787b86' }}
              >
                Email
              </label>
              <input
                type="email"
                value={addAccountEmail}
                onChange={(e) =>
                  setAddAccountEmail(e.target.value)
                }
                className="w-full px-4 py-3 rounded-lg text-base"
                style={{
                  background: '#2a2e39',
                  border: '1px solid #363a45',
                  color: '#d1d4dc',
                }}
                placeholder="user@example.com"
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
    const maxAccounts = getMaxSavedAccounts();

    return (
      <div
        className="flex flex-col h-full"
        style={{ background: '#1e222d' }}
      >
        <div
          className="p-4 border-b"
          style={{ borderColor: '#363a45' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div
                className="font-semibold text-lg"
                style={{ color: '#d1d4dc' }}
              >
                {user?.firstName} {user?.lastName}
              </div>
              <div
                className="text-sm"
                style={{ color: '#787b86' }}
              >
                {user?.email}
              </div>
            </div>

            <button
              onClick={logout}
              className="p-2.5 rounded-lg"
              style={{ background: '#2a2e39' }}
            >
              <LogOut size={18} color="#787b86" />
            </button>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={switchToDemo}
              className="flex-1 py-3 rounded-lg text-base font-semibold"
              style={{
                background: selectedAccount?.is_demo
                  ? '#2962ff'
                  : '#2a2e39',
                color: selectedAccount?.is_demo
                  ? '#fff'
                  : '#787b86',
                border: '1px solid #363a45',
              }}
            >
              DEMO
            </button>

            <button
              onClick={switchToLive}
              className="flex-1 py-3 rounded-lg text-base font-semibold"
              style={{
                background: !selectedAccount?.is_demo
                  ? '#26a69a'
                  : '#2a2e39',
                color: !selectedAccount?.is_demo
                  ? '#fff'
                  : '#787b86',
                border: '1px solid #363a45',
              }}
            >
              LIVE
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div
            className="p-4 rounded-xl"
            style={{ background: '#2a2e39' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm"
                style={{ color: '#787b86' }}
              >
                Balance
              </span>
              <button
                onClick={() => setShowBalance((v) => !v)}
              >
                {showBalance ? (
                  <Eye size={18} color="#787b86" />
                ) : (
                  <EyeOff size={18} color="#787b86" />
                )}
              </button>
            </div>

            <div
              className="text-3xl font-bold"
              style={{ color: '#d1d4dc' }}
            >
              {showBalance
                ? formatINR(accountStats.balance)
                : '••••••'}
            </div>

            <div
              className="text-sm mt-2"
              style={{ color: '#787b86' }}
            >
              Account: {selectedAccount?.account_number || '-'} •
              Leverage: 1:{accountStats.leverage}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setWalletIntent('deposit');
                setActiveTab('wallet');
              }}
              className="py-3.5 rounded-xl font-medium text-base flex items-center justify-center gap-2"
              style={{ background: '#26a69a', color: '#fff' }}
            >
              <Plus size={20} />
              Deposit
            </button>

            <button
              onClick={() => {
                setWalletIntent('withdraw');
                setActiveTab('wallet');
              }}
              className="py-3.5 rounded-xl font-medium text-base flex items-center justify-center gap-2"
              style={{
                background: '#2a2e39',
                color: '#d1d4dc',
                border: '1px solid #363a45',
              }}
            >
              <RefreshCw size={20} />
              Withdraw
            </button>
          </div>

          <div
            className="p-4 rounded-xl"
            style={{ background: '#2a2e39' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div
                  className="font-medium"
                  style={{ color: '#d1d4dc' }}
                >
                  Theme
                </div>
                <div
                  className="text-xs"
                  style={{ color: '#787b86' }}
                >
                  Currently:{' '}
                  {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className="px-4 py-2 rounded-lg font-medium text-sm"
                style={{
                  background:
                    theme === 'dark'
                      ? '#f5c54220'
                      : '#2962ff20',
                  color:
                    theme === 'dark' ? '#f5c542' : '#2962ff',
                  border: `1px solid ${theme === 'dark' ? '#f5c54250' : '#2962ff50'}`,
                }}
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
            <div
              className="text-xs mt-2 p-2 rounded"
              style={{ background: '#252832', color: '#787b86' }}
            >
              Mode applied!.
            </div>
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: '#2a2e39',
              border: '1px solid #363a45',
            }}
          >
            <div
              className="p-4 border-b"
              style={{ borderColor: '#363a45' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users size={18} color="#2962ff" />
                  <span
                    className="font-semibold text-base"
                    style={{ color: '#d1d4dc' }}
                  >
                    Saved Accounts
                  </span>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: '#2962ff20',
                    color: '#2962ff',
                  }}
                >
                  {savedAccounts.length}/{maxAccounts}
                </span>
              </div>
              <div
                className="text-xs mt-1"
                style={{ color: '#787b86' }}
              >
                Switch between accounts quickly without re-entering
                password
              </div>
            </div>

            <div
              className="divide-y"
              style={{ borderColor: '#363a45' }}
            >
              {savedAccounts.map((acc, idx) => {
                const isActive =
                  user?.loginId === acc.loginId ||
                  user?.email === acc.email;

                return (
                  <div
                    key={acc.loginId || `${acc.email}-${idx}`}
                    className="p-3 flex items-center justify-between"
                    style={{
                      background: isActive
                        ? '#2962ff10'
                        : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{
                          background: isActive
                            ? '#2962ff'
                            : '#363a45',
                          color: '#fff',
                        }}
                      >
                        {acc.firstName?.[0]}
                        {acc.lastName?.[0]}
                      </div>
                      <div>
                        <div
                          className="text-sm font-medium"
                          style={{ color: '#d1d4dc' }}
                        >
                          {acc.firstName} {acc.lastName}
                          {isActive && (
                            <span
                              className="ml-2 text-xs px-1.5 py-0.5 rounded"
                              style={{
                                background: '#26a69a20',
                                color: '#26a69a',
                              }}
                            >
                              Active
                            </span>
                          )}
                        </div>
                        <div
                          className="text-xs"
                          style={{ color: '#787b86' }}
                        >
                          {acc.email}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isActive && (
                        <button
                          onClick={() =>
                            handleSwitchToSavedAccount(acc)
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{
                            background: '#2962ff',
                            color: '#fff',
                          }}
                        >
                          Switch
                        </button>
                      )}
                      {!isActive && (
                        <button
                          onClick={() =>
                            handleRemoveSavedAccount(
                              acc.loginId || acc.email
                            )
                          }
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
                <div
                  className="p-4 text-center text-sm"
                  style={{ color: '#787b86' }}
                >
                  No saved accounts yet
                </div>
              )}
            </div>

            {savedAccounts.length < maxAccounts && (
              <div
                className="p-3 border-t"
                style={{ borderColor: '#363a45' }}
              >
                <button
                  onClick={() => setShowAddAccountModal(true)}
                  className="w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                  style={{
                    background: '#1e222d',
                    color: '#2962ff',
                    border: '1px dashed #2962ff50',
                  }}
                >
                  <UserPlus size={18} />
                  Add Another Account
                </button>
              </div>
            )}
          </div>

          <div
            className="p-4 rounded-xl flex items-start gap-3"
            style={{ background: '#2a2e39' }}
          >
            <Info
              size={18}
              color="#787b86"
              className="shrink-0 mt-0.5"
            />
            <div
              className="text-sm"
              style={{ color: '#787b86' }}
            >
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
            color: totalPnL >= 0 ? '#26a69a' : '#ef5350',
          }}
        >
          {totalPnL >= 0 ? '+' : ''}
          {formatINR(totalPnL)}
        </div>

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
        className="lg:hidden flex-1 overflow-hidden"
        style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}
      >
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
    </div>
  );
};

export default Dashboard;