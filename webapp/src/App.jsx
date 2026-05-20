import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Activity,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Ban,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  History,
  Home,
  Landmark,
  LineChart,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
  Send,
  Star,
  Sun,
  Trash2,
  UserCog,
  Users,
  Wallet,
  Wifi,
  X,
  XCircle,
} from 'lucide-react';
import { createChart } from 'lightweight-charts';
import api from './services/api';

const authStorageKey = 'trade_axis_web_auth';
const tokenStorageKey = 'trade_axis_web_token';
const savedSessionsKey = 'trade_axis_web_saved_sessions';
const activeTabStorageKey = 'trade_axis_web_active_tab';
const themeStorageKey = 'trade_axis_web_theme';

const commonTabs = [
  { id: 'quotes', label: 'Quotes', icon: Activity },
  { id: 'chart', label: 'Chart', icon: LineChart },
  { id: 'trade', label: 'Trade', icon: ArrowLeftRight },
  { id: 'history', label: 'History', icon: History },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const adminTabs = [
  { id: 'workspace', label: 'Workspace', icon: Home },
  { id: 'adminPositions', label: 'Positions', icon: SquareStack },
  { id: 'adminOrders', label: 'Orders', icon: ClipboardList },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'leverageMargin', label: 'Leverage & Margin', icon: SlidersHorizontal },
  { id: 'autoClose', label: 'Auto Close', icon: XCircle },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpCircle },
  { id: 'qrDeposits', label: 'QR Deposit', icon: QrCode },
  { id: 'settlement', label: 'Settlement', icon: ClipboardList },
  { id: 'marketHoliday', label: 'Market Holiday', icon: CalendarDays },
  { id: 'manualClose', label: 'Manual Close', icon: Lock },
  { id: 'scriptBan', label: 'Script Ban', icon: Ban },
  { id: 'kiteSetup', label: 'Kite Setup', icon: Wifi },
  { id: 'tradeOnBehalf', label: 'Trade On Behalf', icon: BriefcaseBusiness },
  { id: 'actionLedger', label: 'Action Ledger', icon: History },
  { id: 'customerSupport', label: 'Customer Support', icon: MessageSquare },
  { id: 'subBrokers', label: 'Sub Broker Management', icon: UserCog, adminOnly: true },
];

const subBrokerFeatureTabs = adminTabs.filter((tab) => !tab.adminOnly);
const defaultSubBrokerPermissions = subBrokerFeatureTabs.reduce((acc, tab) => {
  acc[tab.id] = true;
  return acc;
}, {
  usersPositions: true,
  usersLedger: true,
  usersCreate: true,
  usersUpdate: true,
  usersDelete: true,
  adminPositionsEdit: true,
  adminPositionsExit: true,
  adminPositionsDelete: true,
  adminPositionsReopen: true,
});

const normalizeSubBrokerPermissions = (permissions = {}) => (
  subBrokerFeatureTabs.reduce((acc, tab) => {
    acc[tab.id] = permissions?.[tab.id] !== false;
    return acc;
  }, {
    usersPositions: permissions?.usersPositions !== false,
    usersLedger: permissions?.usersLedger !== false,
    usersCreate: permissions?.usersCreate !== false,
    usersUpdate: permissions?.usersUpdate !== false,
    usersDelete: permissions?.usersDelete !== false,
    adminPositionsEdit: permissions?.adminPositionsEdit !== false,
    adminPositionsExit: permissions?.adminPositionsExit !== false,
    adminPositionsDelete: permissions?.adminPositionsDelete !== false,
    adminPositionsReopen: permissions?.adminPositionsReopen !== false,
  })
);

const roleLabel = (role) => {
  if (role === 'admin') return 'Admin';
  if (role === 'sub_broker') return 'Sub Broker';
  return 'User';
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatPlainMoney = (value) =>
  Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-IN') : '-');
const toDateTimeLocal = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const getUserName = (user) => {
  const name = `${user?.first_name || user?.firstName || ''} ${user?.last_name || user?.lastName || ''}`.trim();
  return name || user?.login_id || user?.loginId || user?.email || 'User';
};

const getLoginId = (user) => user?.login_id || user?.loginId || '';

const monthAbbrs = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const parseContractMonth = (value = '') => {
  const raw = String(value || '').toUpperCase().trim();
  if (!raw) return null;

  const monthPattern = monthAbbrs.join('|');
  const spaced = raw.replace(/\s+/g, '');
  const labelMatch = spaced.match(new RegExp(`[-_](${monthPattern})$`, 'i'));
  if (labelMatch) return { month: monthAbbrs.indexOf(labelMatch[1].toUpperCase()), year: new Date().getFullYear() };

  const compact = spaced.replace(/[-_]/g, '');
  const kiteMatch = compact.match(new RegExp(`(\\d{2})(${monthPattern})(\\d{2})?FUT$`, 'i'));
  if (kiteMatch) {
    const yearToken = kiteMatch[3] || kiteMatch[1];
    return {
      month: monthAbbrs.indexOf(kiteMatch[2].toUpperCase()),
      year: 2000 + Number(yearToken),
    };
  }

  const displayMatch = compact.match(new RegExp(`(${monthPattern})(\\d{2})?FUT$`, 'i'));
  if (displayMatch) {
    return {
      month: monthAbbrs.indexOf(displayMatch[1].toUpperCase()),
      year: displayMatch[2] ? 2000 + Number(displayMatch[2]) : new Date().getFullYear(),
    };
  }

  return null;
};

const getExpiryDate = (symbol) => {
  const raw = symbol?.expiry_date || symbol?.expiryDate || symbol?.expiry;
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const source = [
    symbol?.symbol,
    symbol?.kite_tradingsymbol,
    symbol?.display_name,
    symbol?.underlying,
    typeof symbol === 'string' ? symbol : '',
  ].filter(Boolean).join(' ').toUpperCase();
  if (!source) return null;

  const parsed = parseContractMonth(source);
  if (!parsed || parsed.month < 0) return null;
  return new Date(parsed.year, parsed.month, 1);
};

const getMonthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const isCommoditySymbol = (symbol = {}) => {
  const source = `${symbol.category || ''} ${symbol.segment || ''} ${symbol.exchange || ''} ${symbol.instrument_type || ''} ${symbol.symbol || ''} ${symbol.kite_tradingsymbol || ''} ${symbol.display_name || ''} ${symbol.underlying || ''}`.toUpperCase();
  return /MCX|COMMODITY|CRUDE|GOLD|SILVER|COPPER|NATURALGAS|ALUMINI|ALUMINIUM|ZINC|LEAD|NICKEL/.test(source);
};

const isVisibleContract = (symbol, referenceDate = new Date()) => {
  const expiry = getExpiryDate(symbol);
  if (!expiry) return true;

  const allowedMonths = new Set([getMonthKey(referenceDate)]);
  if (referenceDate.getDate() >= 20) {
    allowedMonths.add(getMonthKey(addMonths(referenceDate, 1)));
  }

  return allowedMonths.has(getMonthKey(expiry));
};

const filterTradableSymbols = (symbols = []) => {
  const seen = new Set();
  return (symbols || [])
    .filter((symbol) => symbol?.is_active !== false && isVisibleContract(symbol))
    .filter((symbol) => {
      const key = String(symbol?.symbol || '').toUpperCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};

const normalizeLiveUnderlyingKey = (value = '') =>
  String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(new RegExp(`[-_](${monthAbbrs.join('|')})$`, 'i'), '')
    .replace(/[-_][IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[-_]/g, '')
    .replace(/[^A-Z0-9]/g, '');

const getSymbolPrice = (symbol) => {
  const isLive = String(symbol?.source || '').includes('kite_live') || symbol?.timestamp;
  if (isLive) {
    return firstPositiveNumber(
      symbol?.last,
      symbol?.last_price,
      symbol?.lastPrice,
      symbol?.current_price,
      symbol?.currentPrice,
      symbol?.bid,
      symbol?.ask,
      symbol?.previous_close,
      symbol?.previousClose,
      symbol?.close_price,
      symbol?.closePrice,
      symbol?.ohlc?.close,
    );
  }

  return firstPositiveNumber(
    symbol?.previous_close,
    symbol?.previousClose,
    symbol?.close_price,
    symbol?.closePrice,
    symbol?.last,
    symbol?.last_price,
    symbol?.lastPrice,
    symbol?.current_price,
    symbol?.currentPrice,
    symbol?.ohlc?.close,
    symbol?.bid,
    symbol?.ask,
  );
};

const getSymbolBid = (symbol) => firstPositiveNumber(symbol?.bid, symbol?.bidPrice, getSymbolPrice(symbol));

const getSymbolAsk = (symbol) => firstPositiveNumber(symbol?.ask, symbol?.askPrice, getSymbolPrice(symbol));

const findPositionSymbol = (position, symbols = []) => {
  return findSymbolByInput(position?.symbol, symbols);
};

const findSymbolByInput = (input, symbols = []) => {
  const raw = String(input || '').toUpperCase().trim();
  if (!raw) return null;

  const exact = symbols.find((row) => [
    row?.symbol,
    row?.kite_tradingsymbol,
    row?.display_name,
  ].some((value) => String(value || '').toUpperCase().trim() === raw));
  if (exact) return exact;

  const labelExact = symbols.find((row) => getTradeAxisSymbolLabel(row, symbols).toUpperCase() === raw);
  if (labelExact) return labelExact;

  const requestedExpiry = getExpiryDate(raw);
  const requestedMonth = requestedExpiry ? getMonthKey(requestedExpiry) : '';
  const positionKey = normalizeLiveUnderlyingKey(raw);
  return symbols.find((row) => {
    const symbolKey = normalizeLiveUnderlyingKey(row?.symbol);
    const underlyingKey = normalizeLiveUnderlyingKey(row?.underlying || row?.display_name || row?.name);
    const rowExpiry = getExpiryDate(row);
    const rowMonth = rowExpiry ? getMonthKey(rowExpiry) : '';
    const monthMatches = !requestedMonth || !rowMonth || requestedMonth === rowMonth;
    return monthMatches && (symbolKey === positionKey || underlyingKey === positionKey);
  }) || null;
};

const getLivePositionPrice = (position, symbols = []) => {
  const symbol = findPositionSymbol(position, symbols);

  return firstPositiveNumber(
    symbol?.last,
    symbol?.last_price,
    symbol?.lastPrice,
    symbol?.current_price,
    symbol?.currentPrice,
    symbol?.previous_close,
    symbol?.previousClose,
    symbol?.close_price,
    symbol?.closePrice,
    symbol?.ohlc?.close,
    symbol?.bid,
    symbol?.bidPrice,
    symbol?.ask,
    symbol?.askPrice,
    position?.current_price,
    position?.close_price,
    position?.open_price,
  );
};

const getPositionPnl = (position, symbols = []) => {
  const currentPrice = getLivePositionPrice(position, symbols);
  const qty = Number(position.quantity || 0);
  const openPrice = Number(position.open_price || 0);
  const lotSize = Number(position.lot_size || 1) || 1;
  const brokerage = Number(position.buy_brokerage ?? position.brokerage ?? 0);
  const direction = position.trade_type === 'sell' ? -1 : 1;
  if (!qty || !openPrice || !currentPrice) return Number(position.profit || 0);
  return (currentPrice - openPrice) * qty * lotSize * direction - brokerage;
};

const getDisplayAccount = (accounts = []) => {
  const rows = Array.isArray(accounts) ? accounts : [];
  return (
    rows.find((account) => account?.is_demo === false && (Number(account.balance || 0) || Number(account.dashboard_margin || account.margin || 0) || Number(account.total_dr_cr || 0))) ||
    rows.find((account) => account?.is_demo === false) ||
    rows[0] ||
    {}
  );
};

const getAccountTotalDrCr = (account = {}) => {
  const balance = Number(account.balance || 0);
  const equityValue = account.dashboard_equity ?? account.equity;
  if (equityValue !== undefined && equityValue !== null) return Number(equityValue || 0) - balance;
  if (account.total_dr_cr !== undefined && account.total_dr_cr !== null) return Number(account.total_dr_cr || 0);
  if (account.open_pnl !== undefined && account.open_pnl !== null) return Number(account.open_pnl || 0);
  return 0;
};

const getAccountMetrics = (account = {}) => {
  const balance = Number(account.balance || 0);
  const credit = Number(account.credit || 0);
  const margin = Number(account.dashboard_margin ?? account.margin ?? 0);
  const equity = Number(account.dashboard_equity ?? account.equity ?? (balance + credit + getAccountTotalDrCr(account)));
  const totalDrCr = equity - balance;
  const freeMargin = Number(account.dashboard_free_margin ?? (equity - margin));
  const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;
  return {
    balance,
    credit,
    totalDrCr,
    equity,
    margin,
    freeMargin,
    marginLevel,
    settlementBalance: Number(account.settlement_balance ?? account.account_settlement_balance ?? 0),
  };
};

const loadTradableSymbols = async (params = {}) => {
  const res = await api.get('/market/symbols', { params: { limit: 5000, ...params } });
  return dedupeTradableSymbols(filterTradableSymbols(res.data?.symbols || []));
};

const getQuoteAgeMs = (symbol = {}) => {
  const raw = symbol.last_update || symbol.updated_at || symbol.timestamp;
  const time = typeof raw === 'number' ? raw : Date.parse(raw || '');
  return Number.isFinite(time) && time > 0 ? Date.now() - time : Number.POSITIVE_INFINITY;
};

const isQuoteStale = (symbol = {}) => getQuoteAgeMs(symbol) > 10_000;

const getQuoteSegmentKind = (symbol = {}) => {
  const source = `${symbol.category || ''} ${symbol.segment || ''} ${symbol.exchange || ''} ${symbol.instrument_type || ''} ${symbol.symbol || ''} ${symbol.underlying || ''}`.toUpperCase();
  if (isCommoditySymbol(symbol)) return 'mcx';
  if (/NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|SENSEX|BANKEX|INDEX|IDX/.test(source)) return 'indices';
  return 'stocks';
};

const getTradeAxisSymbolLabel = (symbolOrRow, symbols = []) => {
  const row = typeof symbolOrRow === 'string'
    ? findSymbolByInput(symbolOrRow, symbols)
    : symbolOrRow;
  const raw = typeof symbolOrRow === 'string' ? symbolOrRow : row?.symbol;
  if (!row && !raw) return '-';

  const expiry = getExpiryDate(row);
  if (expiry) {
    const base = String(row?.underlying || row?.display_name || raw || '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[-_][IVX]+$/i, '')
      .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
      .replace(/\d{2}[A-Z]{3}FUT$/i, '')
      .replace(/FUT$/i, '')
      .replace(/[^A-Z0-9]/g, '');
    return `${base}-${monthAbbrs[expiry.getMonth()] || ''}`;
  }

  return String(raw || row?.display_name || '').toUpperCase().replace(/[-_][IVX]+$/i, '').replace(/FUT$/i, '');
};

const getContractFamily = (symbol = {}) => {
  const base = symbol.underlying || symbol.symbol || symbol.display_name || '';
  return String(base || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-I$/i, '')
    .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');
};

const getSymbolIdentityKey = (symbol = {}) => {
  const underlying = getContractFamily(symbol);
  const expiryDate = getExpiryDate(symbol);
  const expiry = expiryDate ? expiryDate.toISOString().slice(0, 10) : '';
  return `${symbol.category || symbol.exchange || ''}|${underlying}|${expiry}`;
};

const isAliasSymbol = (value = '') => /-[A-Z]$/i.test(String(value || ''));

const dedupeTradableSymbols = (rows = []) => {
  const map = new Map();
  rows.forEach((row) => {
    const key = getSymbolIdentityKey(row);
    const current = map.get(key);
    if (!current) {
      map.set(key, row);
      return;
    }

    const currentAlias = isAliasSymbol(current.symbol);
    const nextAlias = isAliasSymbol(row.symbol);
    if (currentAlias && !nextAlias) map.set(key, row);
  });
  return Array.from(map.values());
};

const readAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(authStorageKey) || 'null');
  } catch {
    return null;
  }
};

const readSavedSessions = () => {
  try {
    return JSON.parse(localStorage.getItem(savedSessionsKey) || '[]');
  } catch {
    return [];
  }
};

const writeSavedSession = (session) => {
  if (!session?.token || !session?.user) return;
  const loginId = getLoginId(session.user) || session.user.email;
  const next = [
    { ...session, savedAt: new Date().toISOString() },
    ...readSavedSessions().filter((item) => (getLoginId(item.user) || item.user?.email) !== loginId),
  ];
  localStorage.setItem(savedSessionsKey, JSON.stringify(next));
};

const createSessionFromLogin = async (loginId, password) => {
  const body = new URLSearchParams({ loginId: loginId.trim(), password });
  const res = await api.post('/auth/login', body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  const data = res.data?.data || {};
  localStorage.setItem(tokenStorageKey, data.token);

  try {
    const me = await api.get('/auth/me');
    const fresh = me.data?.data || {};
    return { user: fresh.user || data.user, accounts: fresh.accounts || data.accounts || [], token: data.token };
  } catch {
    return { user: data.user, accounts: data.accounts || [], token: data.token };
  }
};

function Login({ onLogin }) {
  const [form, setForm] = useState({ loginId: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.loginId.trim() || !form.password) {
      toast.error('Enter login ID and password');
      return;
    }

    setLoading(true);
    try {
      const session = await createSessionFromLogin(form.loginId, form.password);
      localStorage.setItem(authStorageKey, JSON.stringify(session));
      writeSavedSession(session);
      onLogin(session);
      toast.success('Login successful');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="brand-lockup">
          <div className="brand-mark">TA</div>
          <span>Trade Axis</span>
        </div>
        <div className="auth-copy">
          <h1>Professional trading control for every role.</h1>
          <p>
            A clean web console for clients, admins and sub brokers with live quotes,
            trading, wallet review and operational controls.
          </p>
        </div>
      </div>

      <div className="auth-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p>Use the same Trade Axis login ID and password.</p>

          <div className="field">
            <label htmlFor="loginId">Login ID</label>
            <input
              id="loginId"
              className="input mono"
              value={form.loginId}
              onChange={(event) => setForm((prev) => ({ ...prev, loginId: event.target.value.toUpperCase() }))}
              placeholder="Login ID"
              autoCapitalize="characters"
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-input">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                placeholder="Enter password"
              />
              <button type="button" className="icon-btn" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button className="btn primary block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PriceChart({ symbol }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: ref.current.clientHeight,
      layout: {
        background: { type: 'solid', color: '#101828' },
        textColor: '#d5dbe7',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      rightPriceScale: { borderColor: '#344054' },
      timeScale: { borderColor: '#344054', timeVisible: true },
    });

    chartRef.current = chart;
    seriesRef.current = chart.addCandlestickSeries({
      upColor: '#14b8a6',
      downColor: '#ef4444',
      borderUpColor: '#14b8a6',
      borderDownColor: '#ef4444',
      wickUpColor: '#14b8a6',
      wickDownColor: '#ef4444',
    });

    const resize = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resize.observe(ref.current);

    return () => {
      resize.disconnect();
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!symbol || !seriesRef.current) return;
    setLoading(true);
    api
      .get(`/market/candles/${symbol}`, { params: { timeframe: '15m', count: 240 } })
      .then((res) => {
        const candles = res.data?.candles || [];
        if (candles.length) {
          seriesRef.current.setData(candles);
        } else {
          const base = Date.now() / 1000;
          const seed = Array.from({ length: 80 }, (_, index) => {
            const price = 1000 + Math.sin(index / 4) * 24 + index * 1.2;
            return {
              time: Math.floor(base - (80 - index) * 900),
              open: price - 5,
              high: price + 12,
              low: price - 12,
              close: price,
            };
          });
          seriesRef.current.setData(seed);
        }
        chartRef.current?.timeScale().fitContent();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  return (
    <div className="chart-stage" ref={ref}>
      {loading && <div className="meta" style={{ padding: 14, color: '#d5dbe7' }}>Loading chart...</div>}
    </div>
  );
}

function App() {
  const cached = readAuth();
  const [auth, setAuth] = useState(cached);
  const [active, setActiveState] = useState(() => localStorage.getItem(activeTabStorageKey) || 'trade');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accounts, setAccounts] = useState(cached?.accounts || []);
  const [selectedAccountId, setSelectedAccountId] = useState(cached?.selectedAccountId || cached?.accounts?.[0]?.id || '');
  const [savedSessions, setSavedSessions] = useState(readSavedSessions());
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem(themeStorageKey) || 'light');
  const [subBrokerPermissions, setSubBrokerPermissions] = useState(defaultSubBrokerPermissions);
  const tabHistoryReadyRef = useRef(false);
  const lastBackTapRef = useRef(0);

  const user = auth?.user || null;
  const role = String(user?.role || 'user').toLowerCase();
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null;

  const setActive = useCallback((tabId, options = {}) => {
    setActiveState(tabId);
    localStorage.setItem(activeTabStorageKey, tabId);
    if (tabHistoryReadyRef.current && !options.replace && window.history?.pushState) {
      window.history.pushState({ tradeAxisApp: true, tab: tabId }, '', window.location.href);
    }
  }, []);

  useEffect(() => {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(themeStorageKey, nextTheme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    if (role !== 'sub_broker') {
      setSubBrokerPermissions(defaultSubBrokerPermissions);
      return;
    }

    let mounted = true;
    api.get('/web-admin/sub-broker-permissions')
      .then((res) => {
        if (mounted) setSubBrokerPermissions(normalizeSubBrokerPermissions(res.data?.data?.permissions));
      })
      .catch(() => {
        if (mounted) setSubBrokerPermissions(defaultSubBrokerPermissions);
      });

    return () => {
      mounted = false;
    };
  }, [role, user?.id]);

  const applySession = (session) => {
    const nextAccountId = session?.selectedAccountId || session?.accounts?.[0]?.id || '';
    const nextRole = String(session?.user?.role || 'user').toLowerCase();
    const nextTab = nextRole === 'admin' || nextRole === 'sub_broker' ? 'adminPositions' : 'trade';
    localStorage.setItem(tokenStorageKey, session.token);
    localStorage.setItem(authStorageKey, JSON.stringify({ ...session, selectedAccountId: nextAccountId }));
    setAuth(session);
    setAccounts(session?.accounts || []);
    setSelectedAccountId(nextAccountId);
    setSavedSessions(readSavedSessions());
    setActive(nextTab);
    setSidebarOpen(false);
  };

  const handleLogin = (session) => {
    applySession(session);
  };

  const refreshAuth = useCallback(async () => {
    const token = localStorage.getItem(tokenStorageKey);
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      const data = res.data?.data || {};
      const nextAccounts = data.accounts || [];
      const nextAccountId = nextAccounts.some((account) => account.id === selectedAccountId)
        ? selectedAccountId
        : nextAccounts[0]?.id || '';
      const nextSession = { user: data.user, accounts: nextAccounts, token, selectedAccountId: nextAccountId };
      setAuth(nextSession);
      setAccounts(data.accounts || []);
      setSelectedAccountId(nextAccountId);
      localStorage.setItem(authStorageKey, JSON.stringify(nextSession));
    } catch {
      localStorage.removeItem(tokenStorageKey);
      localStorage.removeItem(authStorageKey);
      setAuth(null);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (auth) refreshAuth();
  }, []);

  const logout = () => {
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(authStorageKey);
    setAuth(null);
    setAccounts([]);
    setSelectedAccountId('');
    setActive('trade');
    setSidebarOpen(false);
  };

  const switchSavedSession = async (sessionIndex) => {
    const session = savedSessions[Number(sessionIndex)];
    if (!session?.token) return;
    try {
      localStorage.setItem(tokenStorageKey, session.token);
      const res = await api.post('/auth/switch-account', {
        loginId: getLoginId(session.user),
        email: session.user?.email,
        token: session.token,
      }, { skipAuth: true });
      const data = res.data?.data || {};
      const nextSession = { user: data.user, accounts: data.accounts || [], token: data.token };
      writeSavedSession(nextSession);
      applySession(nextSession);
      toast.success('Account switched');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Saved account switch failed');
    }
  };

  const selectAccount = (id) => {
    setSelectedAccountId(id);
    localStorage.setItem(authStorageKey, JSON.stringify({
      ...auth,
      accounts,
      token: localStorage.getItem(tokenStorageKey),
      selectedAccountId: id,
    }));
  };

  const isOperator = role === 'admin' || role === 'sub_broker';
  const operatorTabs = useMemo(() => adminTabs.filter((tab) => {
    if (tab.adminOnly && role !== 'admin') return false;
    if (role !== 'sub_broker') return true;
    return subBrokerPermissions?.[tab.id] !== false;
  }), [role, subBrokerPermissions]);
  const navTabs = useMemo(() => (isOperator
    ? [...operatorTabs, ...commonTabs]
    : commonTabs), [isOperator, operatorTabs]);
  const fallbackTab = isOperator ? operatorTabs[0]?.id || 'trade' : 'trade';
  const safeActive = navTabs.some((tab) => tab.id === active) ? active : fallbackTab;
  const renderedActive = safeActive;
  const activeTab = navTabs.find((tab) => tab.id === safeActive) || navTabs[0];

  useEffect(() => {
    if (!auth || !window.history?.replaceState) return undefined;

    const isMobileViewport = window.matchMedia?.('(max-width: 768px)').matches;
    if (!tabHistoryReadyRef.current) {
      window.history.replaceState({ tradeAxisApp: true, tab: safeActive, exitGuard: true }, '', window.location.href);
      if (isMobileViewport) {
        window.history.pushState({ tradeAxisApp: true, tab: safeActive }, '', window.location.href);
      }
      tabHistoryReadyRef.current = true;
    } else {
      window.history.replaceState({ tradeAxisApp: true, tab: safeActive }, '', window.location.href);
    }

    const handleBack = (event) => {
      const isMobile = window.matchMedia?.('(max-width: 768px)').matches;
      if (event.state?.exitGuard && isMobile) {
        const now = Date.now();
        if (now - lastBackTapRef.current < 1600) {
          window.history.back();
          return;
        }
        lastBackTapRef.current = now;
        toast('Tap back again to exit');
        window.history.pushState({ tradeAxisApp: true, tab: safeActive }, '', window.location.href);
        return;
      }

      const nextTab = event.state?.tab;
      if (nextTab && navTabs.some((tab) => tab.id === nextTab)) {
        setActiveState(nextTab);
        localStorage.setItem(activeTabStorageKey, nextTab);
        setSidebarOpen(false);
        return;
      }

      if (!isMobile) return;

      const now = Date.now();
      if (now - lastBackTapRef.current < 1600) {
        window.history.back();
        return;
      }

      lastBackTapRef.current = now;
      toast('Tap back again to exit');
      window.history.pushState({ tradeAxisApp: true, tab: safeActive }, '', window.location.href);
    };

    window.addEventListener('popstate', handleBack);
    return () => window.removeEventListener('popstate', handleBack);
  }, [auth, safeActive, navTabs]);

  if (!auth) return <Login onLogin={handleLogin} />;

  return (
    <div className={`app-shell ${isOperator ? 'operator-shell' : 'user-shell'}`}>
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark">TA</div>
          <span>Trade Axis</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">Workspace</div>
          {commonTabs.map((tab) => (
            <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => { setActive(tab.id); setSidebarOpen(false); }} />
          ))}

          {(role === 'admin' || role === 'sub_broker') && (
            <>
              <div className="nav-section-title">Operations</div>
              {operatorTabs
                .map((tab) => (
                  <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => { setActive(tab.id); setSidebarOpen(false); }} />
                ))}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>{getUserName(user)}</strong>
            <span>{roleLabel(role)} {getLoginId(user) ? `- ${getLoginId(user)}` : ''}</span>
          </div>
          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={21} />
          </button>
          <div className="topbar-title">
            <h1>{activeTab.label}</h1>
            <p>Trade Axis {getLoginId(user) ? getLoginId(user) : roleLabel(role)}</p>
          </div>
          <div className="topbar-actions">
            <button className="btn subtle theme-toggle" type="button" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <AccountSelect
              accounts={accounts}
              selectedAccount={selectedAccount}
              selectedAccountId={selectedAccount?.id || ''}
              onSelectAccount={selectAccount}
              savedSessions={savedSessions}
              onSwitchSavedSession={switchSavedSession}
              onAddAccount={() => setShowAddAccount(true)}
            />
            <button className="btn subtle topbar-logout" type="button" onClick={logout}>
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </header>

        {isOperator && (
          <nav className="operator-top-nav">
            {operatorTabs
              .map((tab) => (
                <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => setActive(tab.id)} />
              ))}
          </nav>
        )}

        <section className="content">
          {renderedActive === 'workspace' && <Overview role={role} selectedAccount={selectedAccount} />}
          {renderedActive === 'quotes' && <Quotes selectedAccount={selectedAccount} refreshAuth={refreshAuth} />}
          {renderedActive === 'chart' && <ChartWorkspace selectedAccount={selectedAccount} />}
          {renderedActive === 'trade' && <Trade selectedAccount={selectedAccount} refreshAuth={refreshAuth} />}
          {renderedActive === 'history' && <TradeHistory selectedAccount={selectedAccount} refreshAuth={refreshAuth} />}
          {renderedActive === 'messages' && <Messages user={user} />}
          {renderedActive === 'wallet' && <WalletPanel selectedAccount={selectedAccount} refreshAuth={refreshAuth} />}
          {renderedActive === 'settings' && (
            <SettingsPanel
              user={user}
              accounts={accounts}
              selectedAccount={selectedAccount}
              selectedAccountId={selectedAccount?.id || ''}
              onSelectAccount={selectAccount}
              savedSessions={savedSessions}
              onSwitchSavedSession={switchSavedSession}
              onAddAccount={() => setShowAddAccount(true)}
              onRefresh={refreshAuth}
              onLogout={logout}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}
          {renderedActive === 'users' && <UsersPanel mode="user" role={role} currentUser={user} permissions={subBrokerPermissions} />}
          {renderedActive === 'adminPositions' && <AdminPositionsPanel role={role} permissions={subBrokerPermissions} />}
          {renderedActive === 'adminOrders' && <AdminOrdersPanel />}
          {renderedActive === 'leverageMargin' && <LeverageMarginPanel />}
          {renderedActive === 'autoClose' && <AutoClosePanel />}
          {renderedActive === 'subBrokers' && <UsersPanel mode="sub_broker" role={role} currentUser={user} />}
          {renderedActive === 'withdrawals' && <TransactionsPanel type="withdrawal" />}
          {renderedActive === 'qrDeposits' && <QrDepositsPanel />}
          {renderedActive === 'settlement' && <SettlementPanel />}
          {renderedActive === 'marketHoliday' && <MarketHolidayPanel />}
          {renderedActive === 'manualClose' && <ManualClosePanel />}
          {renderedActive === 'scriptBan' && <ScriptBanPanel />}
          {renderedActive === 'kiteSetup' && <KiteSetupPanel />}
          {renderedActive === 'tradeOnBehalf' && <TradeOnBehalfPanel />}
          {renderedActive === 'actionLedger' && <ActionLedgerPanel />}
          {renderedActive === 'customerSupport' && <CustomerSupportPanel />}
        </section>
      </main>

      <nav className="bottom-nav">
        {commonTabs.map((tab) => (
          <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => setActive(tab.id)} />
        ))}
      </nav>

      {sidebarOpen && <button aria-label="Close menu" className="modal-backdrop" onClick={() => setSidebarOpen(false)} />}
      {showAddAccount && (
        <AddAccountModal
          onClose={() => setShowAddAccount(false)}
          onAdded={(session) => {
            writeSavedSession(session);
            applySession(session);
            setShowAddAccount(false);
          }}
        />
      )}
    </div>
  );
}

function NavButton({ tab, active, onClick }) {
  const Icon = tab.icon;
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Icon size={18} />
      {tab.label}
    </button>
  );
}

function AccountSelect({
  accounts,
  selectedAccount,
  selectedAccountId,
  onSelectAccount,
  savedSessions,
  onSwitchSavedSession,
  onAddAccount,
}) {
  return (
    <div className={`account-switcher ${onAddAccount ? 'has-account-action' : ''}`}>
      <select className="select compact-select" value={selectedAccountId || ''} onChange={(event) => onSelectAccount(event.target.value)}>
        {(accounts || []).map((account) => (
          <option key={account.id} value={account.id}>
            {account.account_number} - {account.is_demo ? 'Demo' : 'Live'}
          </option>
        ))}
        {!accounts?.length && <option value="">No Account</option>}
      </select>
      <select className="select compact-select" defaultValue="" onChange={(event) => {
        if (event.target.value !== '') onSwitchSavedSession(event.target.value);
        event.target.value = '';
      }}>
        <option value="">Switch Login</option>
        {savedSessions.map((session, index) => (
          <option key={`${getLoginId(session.user) || session.user?.email}-${index}`} value={index}>
            {getLoginId(session.user) || session.user?.email || 'Saved account'}
          </option>
        ))}
      </select>
      {onAddAccount && (
        <button className="btn subtle" type="button" onClick={onAddAccount}>
          <Plus size={16} />
          Add Account
        </button>
      )}
    </div>
  );
}

function AddAccountModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ loginId: '', password: '' });
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.loginId.trim() || !form.password) {
      toast.error('Enter login ID and password');
      return;
    }
    setLoading(true);
    try {
      const session = await createSessionFromLogin(form.loginId, form.password);
      toast.success('Account added');
      onAdded(session);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Add account failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal small-modal" onSubmit={submit}>
        <div className="modal-head">
          <strong>Add Account</strong>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Login ID</label>
            <input className="input mono" value={form.loginId} onChange={(event) => setForm((prev) => ({ ...prev, loginId: event.target.value.toUpperCase() }))} />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          </div>
          <button className="btn primary block" disabled={loading}>{loading ? 'Adding...' : 'Add Account'}</button>
        </div>
      </form>
    </div>
  );
}

function Overview({ role, selectedAccount }) {
  const [summary, setSummary] = useState(null);
  const [symbols, setSymbols] = useState([]);
  const [showOrder, setShowOrder] = useState(false);
  const isOperator = role === 'admin' || role === 'sub_broker';

  const load = useCallback(async () => {
    if (!isOperator) return;
    try {
      const res = await api.get('/web-admin/summary');
      setSummary(res.data?.data || null);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load overview');
    }
  }, [isOperator]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isOperator) return;
    loadTradableSymbols({ limit: 5000 }).then(setSymbols).catch(() => {});
  }, [isOperator]);

  useEffect(() => {
    const interval = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (!isOperator) {
    return (
      <>
        <div className="stats-grid">
          <Stat label="Balance" value={formatMoney(selectedAccount?.balance)} />
          <Stat label="Equity" value={formatMoney(selectedAccount?.equity)} />
          <Stat label="Margin" value={formatMoney(selectedAccount?.margin)} />
          <Stat label="Free Margin" value={formatMoney(selectedAccount?.free_margin)} />
        </div>
        <div className="card pad">
          <div className="section-head">
            <div>
              <h2>Account Summary</h2>
              <p>Your web workspace uses the same trading account and backend as the mobile app.</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="stats-grid">
        <Stat label="Clients" value={summary?.users || 0} />
        <Stat label="Sub Brokers" value={summary?.subBrokers || 0} />
        <Stat label="Open Trades" value={summary?.openTrades || 0} />
        <Stat label="Open P&L" value={formatMoney(summary?.openPnL || 0)} tone={summary?.openPnL >= 0 ? 'positive' : 'negative'} />
      </div>
      <div className="stats-grid">
        <Stat label="Total Equity" value={formatMoney(summary?.equity || 0)} />
        <Stat label="Used Margin" value={formatMoney(summary?.margin || 0)} />
        <Stat label="Margin Level" value={summary?.margin ? `${Number(summary?.marginLevel || 0).toFixed(2)}%` : '-'} />
        <Stat label="Total Dr/Cr" value={formatMoney(summary?.totalDrCr || 0)} tone={summary?.totalDrCr >= 0 ? 'positive-blue' : 'negative'} />
      </div>
      <div className="stats-grid">
        <Stat label="Pending Withdrawals" value={summary?.pendingWithdrawals || 0} />
        <Stat label="Pending QR Deposits" value={summary?.pendingDeposits || 0} />
      </div>
      <div className="card pad compact-action-card">
        <div className="section-head">
          <div>
            <h2>Workspace Order</h2>
            <p>Place an order from the operator workspace.</p>
          </div>
          <button className="btn primary" disabled={!selectedAccount?.id || !symbols.length} onClick={() => setShowOrder(true)}>
            <Plus size={16} />
            New Order
          </button>
        </div>
      </div>
      {showOrder && (
        <TradeTicketModal
          accountId={selectedAccount?.id}
          symbols={symbols}
          initialSymbol={symbols[0]?.symbol}
          title="New Order"
          subtitle="Workspace order ticket"
          lockedSymbol={false}
          onClose={() => setShowOrder(false)}
          onDone={() => { setShowOrder(false); load(); }}
        />
      )}
    </>
  );
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function Quotes({ selectedAccount, refreshAuth }) {
  const [symbols, setSymbols] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [watchlistSymbols, setWatchlistSymbols] = useState([]);
  const [activeWatchlistId, setActiveWatchlistId] = useState('all');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [newWatchlistName, setNewWatchlistName] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState(null);
  const [staleTick, setStaleTick] = useState(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setSymbols(await loadTradableSymbols());
    } catch {
      if (!silent) toast.error('Failed to load quotes');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadWatchlists = useCallback(async () => {
    try {
      const res = await api.get('/watchlists');
      const rows = res.data?.data || [];
      setWatchlists(rows);
      if (activeWatchlistId !== 'all' && !rows.some((row) => row.id === activeWatchlistId)) {
        setActiveWatchlistId('all');
      }
    } catch {
      toast.error('Failed to load watchlists');
    }
  }, [activeWatchlistId]);

  const loadWatchlistSymbols = useCallback(async () => {
    if (!activeWatchlistId || activeWatchlistId === 'all') {
      setWatchlistSymbols([]);
      return;
    }
    try {
      const res = await api.get(`/watchlists/${activeWatchlistId}/symbols`);
      setWatchlistSymbols((res.data?.data || []).map((row) => String(row.symbol || '').toUpperCase()));
    } catch {
      toast.error('Failed to load watchlist scripts');
    }
  }, [activeWatchlistId]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load({ silent: true }), 1000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    loadWatchlists();
  }, [loadWatchlists]);

  useEffect(() => {
    loadWatchlistSymbols();
  }, [loadWatchlistSymbols]);

  useEffect(() => {
    const interval = setInterval(() => setStaleTick((value) => value + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  const refreshQuotes = async () => {
    await Promise.all([
      load(),
      loadWatchlists(),
      loadWatchlistSymbols(),
      refreshAuth?.(),
    ]);
    toast.success('Quotes refreshed');
  };

  const createWatchlist = async () => {
    const name = newWatchlistName.trim();
    if (!name) return toast.error('Enter watchlist name');
    try {
      const res = await api.post('/watchlists', { name });
      const watchlist = res.data?.data;
      toast.success('Watchlist created');
      setNewWatchlistName('');
      await loadWatchlists();
      if (watchlist?.id) setActiveWatchlistId(watchlist.id);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Create watchlist failed');
    }
  };

  const deleteWatchlist = async (id) => {
    if (!window.confirm('Delete this watchlist?')) return;
    try {
      await api.delete(`/watchlists/${id}`);
      toast.success('Watchlist deleted');
      setActiveWatchlistId('all');
      await loadWatchlists();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Delete watchlist failed');
    }
  };

  const toggleWatchlistSymbol = async (symbol) => {
    if (activeWatchlistId === 'all') return toast.error('Select or create a watchlist first');
    const normalized = String(symbol || '').toUpperCase();
    const exists = watchlistSymbols.includes(normalized);
    try {
      if (exists) {
        await api.delete(`/watchlists/${activeWatchlistId}/symbols/${normalized}`);
        toast.success('Removed from watchlist');
      } else {
        await api.post(`/watchlists/${activeWatchlistId}/symbols`, { symbol: normalized });
        toast.success('Added to watchlist');
      }
      await loadWatchlistSymbols();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Watchlist update failed');
    }
  };

  const visible = symbols
    .filter((symbol) => {
      const term = query.toLowerCase().trim();
      const matchesSearch = !term ||
        String(symbol.symbol || '').toLowerCase().includes(term) ||
        String(symbol.display_name || '').toLowerCase().includes(term) ||
        String(symbol.underlying || '').toLowerCase().includes(term) ||
        getTradeAxisSymbolLabel(symbol).toLowerCase().includes(term);
      if (!matchesSearch) return false;
      if (segmentFilter !== 'all' && getQuoteSegmentKind(symbol) !== segmentFilter) return false;
      if (activeWatchlistId === 'all') return true;
      if (term) return true;
      return watchlistSymbols.includes(String(symbol.symbol || '').toUpperCase());
    })
    .slice(0, 120);
  const getQuotePriceTone = (symbol) => {
    if (isQuoteStale(symbol)) return 'price-stale';
    const movement = Number(symbol.change_percent ?? symbol.change ?? symbol.change_value ?? 0);
    if (movement > 0) return 'price-positive';
    if (movement < 0) return 'price-negative';
    return '';
  };

  return (
    <div className="card pad quotes-panel">
      <div className="toolbar">
        <div className="left">
          <div className="field" style={{ margin: 0, minWidth: 280 }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search script" style={{ paddingLeft: 38 }} />
            </div>
          </div>
        </div>
        <button type="button" className="btn subtle" onClick={refreshQuotes} disabled={loading}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="watchlist-bar">
        <div className="tabs scroll-tabs">
          <button className={`tab ${activeWatchlistId === 'all' ? 'active' : ''}`} onClick={() => setActiveWatchlistId('all')}>All Scripts</button>
          {watchlists.map((watchlist) => (
            <button key={watchlist.id} className={`tab ${activeWatchlistId === watchlist.id ? 'active' : ''}`} onClick={() => setActiveWatchlistId(watchlist.id)}>
              {watchlist.name}
            </button>
          ))}
        </div>
        <div className="watchlist-create">
          <input className="input" value={newWatchlistName} onChange={(event) => setNewWatchlistName(event.target.value)} placeholder="New watchlist" />
          <button className="btn primary" onClick={createWatchlist}><Plus size={16} />Create</button>
          {activeWatchlistId !== 'all' && (
            <button className="icon-btn danger-text" onClick={() => deleteWatchlist(activeWatchlistId)} title="Delete watchlist"><Trash2 size={16} /></button>
          )}
        </div>
      </div>

      <div className="tabs scroll-tabs compact-segment-tabs">
        {[
          ['all', 'All'],
          ['stocks', 'Future Stocks'],
          ['mcx', 'MCX'],
          ['indices', 'Indices'],
        ].map(([id, label]) => (
          <button key={id} className={`tab ${segmentFilter === id ? 'active' : ''}`} onClick={() => setSegmentFilter(id)}>{label}</button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Script</th>
              <th>Bid</th>
              <th>Ask</th>
              <th>Last</th>
              <th>Change</th>
              <th>Segment</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((symbol) => {
              const priceTone = getQuotePriceTone(symbol);
              const inWatchlist = watchlistSymbols.includes(String(symbol.symbol || '').toUpperCase());
              const stale = isQuoteStale(symbol);
              return (
                <tr key={symbol.symbol} className={`click-row ${stale ? 'quote-stale-row' : ''}`} onClick={() => setTicketSymbol(symbol)}>
                  <td>
                    <button className={`icon-btn watch-star ${inWatchlist ? 'active' : ''}`} onClick={(event) => { event.stopPropagation(); toggleWatchlistSymbol(symbol.symbol); }} title={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}>
                      <Star size={16} />
                    </button>
                  </td>
                  <td><strong>{getTradeAxisSymbolLabel(symbol)}</strong><div className="meta">{symbol.display_name || symbol.symbol}</div></td>
                  <td className={priceTone}>{getSymbolBid(symbol).toFixed(2)}</td>
                  <td className={priceTone}>{getSymbolAsk(symbol).toFixed(2)}</td>
                  <td className={priceTone}>{getSymbolPrice(symbol).toFixed(2)}</td>
                  <td className={priceTone || 'muted-value'}>
                    {Number(symbol.change_percent || 0).toFixed(2)}%
                  </td>
                  <td>{symbol.category || symbol.exchange || '-'}</td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr><td colSpan="7">{activeWatchlistId === 'all' || query.trim() ? 'No scripts found' : 'Search scripts above and use the star to add them to this watchlist'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ticketSymbol && (
        <TradeTicketModal
          accountId={selectedAccount?.id}
          symbols={symbols}
          initialSymbol={ticketSymbol.symbol}
          title={getTradeAxisSymbolLabel(ticketSymbol)}
          subtitle={ticketSymbol.display_name || 'Quote trade ticket'}
          onClose={() => setTicketSymbol(null)}
          onDone={load}
        />
      )}
    </div>
  );
}

function ChartWorkspace({ selectedAccount }) {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState('');
  const [showTicket, setShowTicket] = useState(false);

  const refreshSymbols = useCallback((silent = true) => {
    loadTradableSymbols({ limit: 5000 }).then((rows) => {
      setSymbols(rows);
      setSymbol((prev) => prev || rows[0]?.symbol || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSymbols(false);
    const interval = setInterval(() => refreshSymbols(true), 1000);
    return () => clearInterval(interval);
  }, [refreshSymbols]);

  return (
    <div className="chart-workspace">
      <div className="card chart-box">
      <div className="chart-header">
        <div>
          <strong>{symbol || 'Select Script'}</strong>
          <div className="meta">15 minute candles</div>
        </div>
        <div className="chart-actions">
          <select className="select" value={symbol} onChange={(event) => setSymbol(event.target.value)} style={{ maxWidth: 260 }}>
            {symbols.map((row) => <option key={row.symbol} value={row.symbol}>{row.symbol}</option>)}
          </select>
          <button className="btn primary" disabled={!symbol} onClick={() => setShowTicket(true)}>
            <ArrowLeftRight size={16} />
            Trade
          </button>
        </div>
      </div>
      <PriceChart symbol={symbol} />
      </div>
      <div className="card pad chart-side-panel">
        <div className="section-head">
          <div>
            <h2>Market Watch</h2>
            <p>Current and next month from the same contract rules.</p>
          </div>
        </div>
        <div className="list compact-list">
          {symbols.slice(0, 18).map((row) => (
            <button key={row.symbol} className={`row clickable ${symbol === row.symbol ? 'active' : ''}`} onClick={() => setSymbol(row.symbol)}>
              <div><strong>{row.symbol}</strong><div className="meta">{row.display_name || row.exchange}</div></div>
              <div className="mono">{getSymbolPrice(row).toFixed(2)}</div>
            </button>
          ))}
        </div>
      </div>
      {showTicket && (
        <TradeTicketModal
          accountId={selectedAccount?.id}
          symbols={symbols}
          initialSymbol={symbol}
          title={symbol}
          subtitle="Chart trade ticket"
          onClose={() => setShowTicket(false)}
        />
      )}
    </div>
  );
}

function TradeTicketModal({ accountId, symbols, initialSymbol, title, subtitle, onClose, onDone, lockedSymbol }) {
  return (
    <div className="modal-backdrop">
      <div className="modal ticket-modal">
        <div className="modal-head">
          <div>
            <strong>{title || 'Trade Ticket'}</strong>
            <div className="meta">{subtitle || 'Place market, limit or stop orders'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <TradeTicket
            accountId={accountId}
            symbols={symbols}
            initialSymbol={initialSymbol}
            lockedSymbol={lockedSymbol}
            onDone={async () => {
              await onDone?.();
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TradeTicket({ accountId, symbols, initialSymbol, onDone, lockedSymbol = Boolean(initialSymbol) }) {
  const [form, setForm] = useState({
    symbol: findSymbolByInput(initialSymbol, symbols)?.symbol || initialSymbol || symbols?.[0]?.symbol || '',
    orderType: 'market',
    quantity: 1,
    price: '',
    stopLoss: '',
    takeProfit: '',
  });
  const [busy, setBusy] = useState(false);
  const selectedSymbol = findSymbolByInput(form.symbol, symbols);
  const runningPrice = getSymbolPrice(selectedSymbol);
  const sellPrice = getSymbolBid(selectedSymbol) || runningPrice;
  const buyPrice = getSymbolAsk(selectedSymbol) || runningPrice;

  useEffect(() => {
    if (initialSymbol) {
      const row = findSymbolByInput(initialSymbol, symbols);
      setForm((prev) => ({ ...prev, symbol: row?.symbol || initialSymbol }));
    }
  }, [initialSymbol, symbols]);

  useEffect(() => {
    if (!form.symbol && symbols?.[0]?.symbol) {
      setForm((prev) => ({ ...prev, symbol: symbols[0].symbol }));
    }
  }, [symbols, form.symbol]);

  useEffect(() => {
    if ((form.orderType === 'market' || form.orderType === 'instant') && runningPrice) {
      setForm((prev) => ({ ...prev, price: String(runningPrice) }));
    }
  }, [form.orderType, form.symbol, runningPrice]);

  const place = async (side) => {
    if (!accountId) return toast.error('Select an account first');
    if (!form.symbol) return toast.error('Select a script');

    setBusy(true);
    try {
      const orderType = form.orderType || 'market';
      const resolvedSide =
        orderType.startsWith('buy_') ? 'buy' :
        orderType.startsWith('sell_') ? 'sell' :
        side;

      const orderPrice = orderType === 'market' || orderType === 'instant'
        ? Number((resolvedSide === 'sell' ? sellPrice : buyPrice) || runningPrice || 0)
        : Number(form.price || runningPrice || 0);
      const res = await api.post('/trading/order', {
        accountId,
        symbol: selectedSymbol?.symbol || form.symbol,
        type: resolvedSide,
        orderType,
        quantity: Number(form.quantity),
        price: orderPrice,
        stopLoss: Number(form.stopLoss || 0),
        takeProfit: Number(form.takeProfit || 0),
      });
      toast.success(res.data?.message || 'Order placed');
      await onDone?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Order failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ticket-stack">
      <OrderFields form={form} setForm={setForm} symbols={symbols} lockedSymbol={lockedSymbol} />
      <div className="deal-price-strip">
        <button className="deal-price sell" type="button" disabled={busy} onClick={() => place('sell')}>
          <span>Sell by Market</span>
          <strong>{sellPrice ? sellPrice.toFixed(2) : '0.00'}</strong>
        </button>
        <button className="deal-price buy" type="button" disabled={busy} onClick={() => place('buy')}>
          <span>Buy by Market</span>
          <strong>{buyPrice ? buyPrice.toFixed(2) : '0.00'}</strong>
        </button>
      </div>
    </div>
  );
}

function Trade({ selectedAccount, refreshAuth }) {
  const [symbols, setSymbols] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [showOrder, setShowOrder] = useState(false);
  const [orderSymbol, setOrderSymbol] = useState('');
  const [expandedPositionId, setExpandedPositionId] = useState('');
  const [closeTarget, setCloseTarget] = useState(null);
  const [tradeView, setTradeView] = useState('positions');
  const [modifyOrder, setModifyOrder] = useState(null);

  const accountId = selectedAccount?.id;

  const load = useCallback(async () => {
    if (!accountId) return;
    const [symbolsRes, posRes, orderRes] = await Promise.all([
      loadTradableSymbols(),
      api.get(`/trading/positions/${accountId}`),
      api.get(`/trading/pending-orders/${accountId}`),
    ]);
    const symbolRows = Array.isArray(symbolsRes) ? symbolsRes : [];
    setSymbols(symbolRows);
    setPositions(posRes.data?.data || []);
    setOrders(orderRes.data?.data || []);
    setSelectedSymbol((prev) => prev || symbolRows[0]?.symbol || '');
  }, [accountId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!accountId) return undefined;
    const interval = setInterval(async () => {
      try {
        const rows = await loadTradableSymbols();
        setSymbols(rows);
        setSelectedSymbol((prev) => prev || rows[0]?.symbol || '');
      } catch {}
    }, 750);
    return () => clearInterval(interval);
  }, [accountId]);

  const closeTrade = async (trade, quantity) => {
    const closeQty = Number(quantity || trade.quantity || 0);
    if (!closeQty || closeQty <= 0) return toast.error('Enter quantity to close');
    try {
      const totalQty = Number(trade.quantity || 0);
      const childTrades = Array.isArray(trade.childTrades) && trade.childTrades.length ? trade.childTrades : [trade];
      if (childTrades.length > 1) {
        let remainingQty = closeQty;
        for (const child of childTrades) {
          if (remainingQty <= 0) break;
          const childQty = Number(child.quantity || 0);
          const qtyForChild = Math.min(remainingQty, childQty);
          if (qtyForChild <= 0) continue;
          if (qtyForChild < childQty) await api.post(`/trading/partial-close/${child.id}`, { accountId, volume: qtyForChild });
          else await api.post(`/trading/close/${child.id}`, { accountId });
          remainingQty -= qtyForChild;
        }
        toast.success(closeQty < totalQty ? 'Position partially closed' : 'Position closed');
      } else {
        const targetTrade = childTrades[0] || trade;
        const res = closeQty < totalQty
          ? await api.post(`/trading/partial-close/${targetTrade.id}`, { accountId, volume: closeQty })
          : await api.post(`/trading/close/${targetTrade.id}`, { accountId });
        toast.success(res.data?.message || (closeQty < totalQty ? 'Position partially closed' : 'Position closed'));
      }
      setCloseTarget(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Close failed');
    }
  };

  const partialCloseTrade = async (trade) => {
    const volume = window.prompt('Enter quantity to close', String(trade.quantity || ''));
    if (!volume) return;
    try {
      const res = await api.post(`/trading/partial-close/${trade.id}`, { accountId, volume: Number(volume) });
      toast.success(res.data?.message || 'Position partially closed');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Partial close failed');
    }
  };

  const closeAll = async () => {
    if (!positions.length) return;
    if (!window.confirm('Close all open positions?')) return;
    try {
      const res = await api.post('/trading/close-all', { accountId, filterType: 'all' });
      toast.success(res.data?.message || 'All positions closed');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Close all failed');
    }
  };

  const refreshTrade = async () => {
    try {
      await Promise.all([load(), refreshAuth?.()]);
      toast.success('Trade refreshed');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Refresh failed');
    }
  };

  const cancelOrder = async (orderId) => {
    if (!window.confirm('Cancel this pending order?')) return;
    try {
      const res = await api.delete(`/trading/pending-order/${orderId}`);
      toast.success(res.data?.message || 'Pending order cancelled');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Cancel failed');
    }
  };

  const modifyPendingOrder = async (order, values) => {
    try {
      const res = await api.put(`/trading/pending-order/${order.id}`, values);
      toast.success(res.data?.message || 'Pending order modified');
      setModifyOrder(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Modify failed');
    }
  };

  const openPositionRows = positions.filter((position) => {
    const status = String(position.status || 'open').toLowerCase();
    return status === 'open' || status === 'active';
  });
  const enrichedPositions = openPositionRows.map((position) => ({
    ...position,
    livePrice: getLivePositionPrice(position, symbols),
    livePnl: getPositionPnl(position, symbols),
  }));
  const groupedPositions = Array.from(enrichedPositions.reduce((map, position) => {
    const key = `${String(position.symbol || '').toUpperCase()}-${String(position.trade_type || '').toLowerCase()}`;
    const qty = Number(position.quantity || 0);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...position,
        id: key,
        childTrades: [position],
        quantity: qty,
        openValue: Number(position.open_price || 0) * qty,
        margin: Number(position.margin || 0),
        livePnl: Number(position.livePnl || 0),
        brokerage: Number(position.brokerage || 0),
      });
      return map;
    }
    const nextQty = Number(existing.quantity || 0) + qty;
    existing.childTrades.push(position);
    existing.quantity = nextQty;
    existing.openValue += Number(position.open_price || 0) * qty;
    existing.open_price = nextQty ? existing.openValue / nextQty : existing.open_price;
    existing.livePrice = position.livePrice || existing.livePrice;
    existing.livePnl = Number(existing.livePnl || 0) + Number(position.livePnl || 0);
    existing.margin = Number(existing.margin || 0) + Number(position.margin || 0);
    existing.brokerage = Number(existing.brokerage || 0) + Number(position.brokerage || 0);
    if (!Number(existing.stop_loss || 0) && Number(position.stop_loss || 0)) existing.stop_loss = position.stop_loss;
    if (!Number(existing.take_profit || 0) && Number(position.take_profit || 0)) existing.take_profit = position.take_profit;
    return map;
  }, new Map()).values());
  const floatingPnl = groupedPositions.reduce((sum, row) => sum + Number(row.livePnl || 0), 0);
  const usedMargin = Number(selectedAccount?.margin || groupedPositions.reduce((sum, row) => sum + Number(row.margin || 0), 0));
  const balance = Number(selectedAccount?.balance || 0);
  const credit = Number(selectedAccount?.credit || 0);
  const equity = balance + credit + floatingPnl;
  const freeMargin = Math.max(0, equity - usedMargin);
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;
  const totalDrCr = equity - balance;

  return (
    <div className="trade-app-view">
      <div className="trade-summary-card">
        <div className="trade-account-line">
          <span>Trade Axis</span>
          <span className={`pill ${selectedAccount?.is_demo ? 'gold' : 'teal'}`}>{selectedAccount?.is_demo ? 'Demo' : 'Live'}</span>
        </div>
        <div className="trade-metric-grid">
          <Stat label="Balance" value={formatPlainMoney(balance)} />
          <Stat label="Equity" value={formatPlainMoney(equity)} tone={equity >= balance ? 'positive-blue' : 'negative'} />
          <Stat label="Total Dr/Cr" value={formatPlainMoney(totalDrCr)} tone={totalDrCr >= 0 ? 'positive-blue' : 'negative'} />
          <Stat label="Floating P&L" value={formatPlainMoney(floatingPnl)} tone={floatingPnl >= 0 ? 'positive-blue' : 'negative'} />
          <Stat label="Free Margin" value={formatPlainMoney(freeMargin)} tone="positive" />
          <Stat label="P&L" value={formatPlainMoney(credit)} tone={credit >= 0 ? 'positive' : 'negative'} />
          <Stat label="Used Margin" value={formatPlainMoney(usedMargin)} tone="gold" />
          <Stat label="Margin Level" value={usedMargin ? `${marginLevel.toFixed(2)}%` : '-'} tone="positive" />
        </div>
      </div>

      <div className="trade-position-tabs">
        <button type="button" className={`tab ${tradeView === 'positions' ? 'active' : ''}`} onClick={() => setTradeView('positions')}>Positions ({groupedPositions.length})</button>
        <button type="button" className={`tab ${tradeView === 'pending' ? 'active' : ''}`} onClick={() => setTradeView('pending')}>Pending ({orders.length})</button>
      </div>
      <div className="trade-refresh-row">
        <button type="button" className="btn subtle" onClick={refreshTrade}><RefreshCw size={16} />Refresh</button>
      </div>

      {tradeView === 'positions' && (
        <div className="position-card-list">
        {groupedPositions.map((position) => {
          const isExpanded = expandedPositionId === position.id;
          const stopLoss = Number(position.stop_loss || 0);
          const takeProfit = Number(position.take_profit || 0);
          return (
          <div className={`position-card ${isExpanded ? 'expanded' : ''}`} key={position.id}>
            <button
              type="button"
              className="position-card-main"
              onClick={() => setExpandedPositionId(isExpanded ? '' : position.id)}
            >
              <div>
                <div className="position-title">
                  <strong>{getTradeAxisSymbolLabel(position.symbol, symbols)}</strong>
                  <span className={`pill ${position.trade_type === 'buy' ? 'teal' : 'red'}`}>{position.trade_type} {position.quantity}</span>
                </div>
                <div className="position-prices">
                  <span>Open: {Number(position.open_price || 0).toFixed(2)}</span>
                  <span>Current: {Number(position.livePrice || 0).toFixed(2)}</span>
                </div>
              </div>
              <strong className={Number(position.livePnl || 0) >= 0 ? 'positive-blue' : 'negative'}>{formatPlainMoney(position.livePnl)}</strong>
            </button>
            {isExpanded && (
              <>
                {(stopLoss > 0 || takeProfit > 0) && (
                  <div className="position-protection-row">
                    {stopLoss > 0 && <span>SL: {stopLoss.toFixed(2)}</span>}
                    {takeProfit > 0 && <span>TP: {takeProfit.toFixed(2)}</span>}
                  </div>
                )}
                <div className="position-card-actions">
                  <button
                    className="btn primary"
                    onClick={() => {
                      const row = findSymbolByInput(position.symbol, symbols);
                      setOrderSymbol(row?.symbol || position.symbol);
                      setShowOrder(true);
                    }}
                  >
                    New Order
                  </button>
                  <button className="btn danger" onClick={() => setCloseTarget(position)}>Close</button>
                </div>
              </>
            )}
          </div>
          );
        })}
        {!groupedPositions.length && <div className="empty-state compact-empty"><span>No open positions</span></div>}
        </div>
      )}

      {tradeView === 'pending' && (
        <div className="position-card-list">
          {orders.map((order) => (
            <div className="position-card" key={order.id}>
              <div className="position-card-main">
                <div>
                  <div className="position-title">
                    <strong>{getTradeAxisSymbolLabel(order.symbol, symbols)}</strong>
                    <span className="pill gold">{order.status || 'pending'}</span>
                  </div>
                  <div className="position-prices">
                    <span>{String(order.order_type || '-').replace('_', ' ')} at {Number(order.price || 0).toFixed(2)}</span>
                    <span>Qty: {order.quantity || '-'}</span>
                  </div>
                </div>
                <div className="action-row">
                  <button className="btn primary" onClick={() => setModifyOrder(order)}>Modify</button>
                  <button className="btn subtle" onClick={() => cancelOrder(order.id)}>Cancel</button>
                </div>
              </div>
            </div>
          ))}
          {!orders.length && <div className="empty-state compact-empty"><span>No pending orders</span></div>}
        </div>
      )}

      {showOrder && (
        <TradeTicketModal
          accountId={accountId}
          symbols={symbols}
          initialSymbol={orderSymbol || selectedSymbol}
          title="New Order"
          subtitle="Trade Axis order ticket"
          onClose={() => { setShowOrder(false); setOrderSymbol(''); }}
          onDone={() => { setShowOrder(false); setOrderSymbol(''); load(); }}
        />
      )}
      {modifyOrder && (
        <ModifyPendingOrderModal
          order={modifyOrder}
          onClose={() => setModifyOrder(null)}
          onSubmit={(values) => modifyPendingOrder(modifyOrder, values)}
        />
      )}
      {closeTarget && (
        <ClosePositionModal
          trade={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSubmit={(quantity) => closeTrade(closeTarget, quantity)}
        />
      )}
    </div>
  );

  return (
    <div className="trade-layout">
      <div className="card pad">
        <div className="section-head">
          <div>
            <h2>Market Watch</h2>
            <p>Select a script to trade.</p>
          </div>
        </div>
        <div className="field sticky-search">
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
            <input className="input" value={marketQuery} onChange={(event) => setMarketQuery(event.target.value)} placeholder="Search script" style={{ paddingLeft: 38 }} />
          </div>
        </div>
        <div className="list">
          {visibleSymbols.map((row) => (
            <button key={row.symbol} className={`row clickable ${selectedSymbol === row.symbol ? 'active' : ''}`} onClick={() => setSelectedSymbol(row.symbol)}>
              <div><strong>{row.symbol}</strong><div className="meta">{row.display_name || row.exchange}</div></div>
              <div className="mono">{getSymbolPrice(row).toFixed(2)}</div>
            </button>
          ))}
          {!visibleSymbols.length && <div className="meta">No scripts found</div>}
        </div>
      </div>

      <div className="card pad">
        <div className="section-head">
          <div>
            <h2>Open Positions</h2>
            <p>Monitor and close active trades.</p>
          </div>
          <div className="right">
            <button type="button" className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
            <button className="btn danger" onClick={closeAll} disabled={!positions.length}>Close All</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Script</th><th>Side</th><th>Qty</th><th>Open</th><th>Current</th><th>P&L</th><th>Action</th></tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id}>
                  <td><strong>{position.symbol}</strong><div className="meta">{position.id}</div></td>
                  <td><span className={`pill ${position.trade_type === 'buy' ? 'teal' : 'red'}`}>{position.trade_type}</span></td>
                  <td>{position.quantity}</td>
                  <td>{Number(position.open_price || 0).toFixed(2)}</td>
                  <td>{Number(position.current_price || 0).toFixed(2)}</td>
                  <td className={Number(position.profit || 0) >= 0 ? 'positive' : 'negative'}>{formatMoney(position.profit)}</td>
                  <td>
                    <div className="action-row">
                      <button className="btn subtle" onClick={() => partialCloseTrade(position)}>Partial</button>
                      <button className="btn danger" onClick={() => closeTrade(position.id)}>Close</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!positions.length && <tr><td colSpan="7">No open positions</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="section-head" style={{ marginTop: 18 }}>
          <div>
            <h2>Pending Orders</h2>
            <p>Limit and stop orders waiting for execution.</p>
          </div>
        </div>
        <div className="list">
          {orders.map((order) => (
            <div className="row" key={order.id}>
              <div><strong>{order.symbol}</strong><div className="meta">{order.order_type} at {Number(order.price || 0).toFixed(2)}</div></div>
              <div className="action-row">
                <span className="pill gold">{order.status}</span>
                <button className="btn subtle" onClick={() => cancelOrder(order.id)}>Cancel</button>
              </div>
            </div>
          ))}
          {!orders.length && <div className="meta">No pending orders</div>}
        </div>
      </div>

      <div className="card pad order-column">
        <div className="section-head">
          <div>
            <h2>Order Ticket</h2>
            <p>Place market or pending orders.</p>
          </div>
        </div>
        <TradeTicket accountId={accountId} symbols={symbols} initialSymbol={selectedSymbol} onDone={load} />
      </div>
    </div>
  );
}

function OrderFields({ form, setForm, symbols, lockedSymbol = false }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isMarket = form.orderType === 'market' || form.orderType === 'instant';
  return (
    <>
      <div className="field">
        <label>Script</label>
        {lockedSymbol ? (
          <div className="locked-script-field">{getTradeAxisSymbolLabel(form.symbol, symbols)}</div>
        ) : (
          <select className="select" value={form.symbol} onChange={(event) => update('symbol', event.target.value)}>
            {symbols.map((row) => <option key={row.symbol} value={row.symbol}>{getTradeAxisSymbolLabel(row)}</option>)}
          </select>
        )}
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Order Type</label>
          <select className="select" value={form.orderType} onChange={(event) => update('orderType', event.target.value)}>
            <option value="market">Market</option>
            <option value="buy_limit">Buy Limit</option>
            <option value="sell_limit">Sell Limit</option>
            <option value="buy_stop">Buy Stop</option>
            <option value="sell_stop">Sell Stop</option>
          </select>
        </div>
        <div className="field">
          <label>Quantity</label>
          <input className="input" type="number" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} />
        </div>
      </div>
      <div className={isMarket ? 'grid-2' : 'grid-3'}>
        {!isMarket && (
          <div className="field">
            <label>Price</label>
            <input className="input" type="number" value={form.price} onChange={(event) => update('price', event.target.value)} placeholder="Limit or stop price" />
          </div>
        )}
        <div className="field">
          <label>Stop Loss</label>
          <input className="input" type="number" value={form.stopLoss} onChange={(event) => update('stopLoss', event.target.value)} />
        </div>
        <div className="field">
          <label>Take Profit</label>
          <input className="input" type="number" value={form.takeProfit} onChange={(event) => update('takeProfit', event.target.value)} />
        </div>
      </div>
    </>
  );
}

function ClosePositionModal({ trade, onClose, onSubmit }) {
  const [quantity, setQuantity] = useState(String(trade?.quantity || 1));
  const qty = Number(quantity || 0);
  const totalQty = Number(trade?.quantity || 0);
  const closePrice = Number(trade?.livePrice || trade?.current_price || trade?.open_price || 0);
  const isPartial = qty > 0 && qty < totalQty;

  return (
    <div className="modal-backdrop">
      <div className="modal close-modal">
        <div className="modal-head">
          <div>
            <strong>Close Position</strong>
            <div className="meta">{trade?.symbol}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="close-preview">
            <div><span>Side</span><strong className={trade?.trade_type === 'buy' ? 'positive-blue' : 'negative'}>{String(trade?.trade_type || '').toUpperCase()}</strong></div>
            <div><span>Open Qty</span><strong>{totalQty}</strong></div>
            <div><span>Market Price</span><strong>{closePrice.toFixed(2)}</strong></div>
            <div><span>Live P&L</span><strong className={Number(trade?.livePnl || 0) >= 0 ? 'positive-blue' : 'negative'}>{formatMoney(trade?.livePnl)}</strong></div>
          </div>
          <div className="field">
            <label>Quantity to Close</label>
            <input className="input" type="number" min="1" max={totalQty} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            <div className="meta">{isPartial ? 'This will partially close the position.' : 'This will close the full position.'}</div>
          </div>
          <div className="grid-2">
            <button className="btn subtle" onClick={onClose}>Cancel</button>
            <button className="btn danger" disabled={!qty || qty > totalQty} onClick={() => onSubmit(qty)}>
              {isPartial ? 'Partial Close' : 'Close Position'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModifyPendingOrderModal({ order, onClose, onSubmit }) {
  const [form, setForm] = useState({
    quantity: String(order?.quantity || 1),
    price: Number(order?.price || 0) ? Number(order.price).toFixed(2) : '',
    stopLoss: Number(order?.stop_loss || 0) ? String(order.stop_loss) : '',
    takeProfit: Number(order?.take_profit || 0) ? String(order.take_profit) : '',
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const qty = Number(form.quantity || 0);
  const price = Number(form.price || 0);

  return (
    <div className="modal-backdrop">
      <div className="modal close-modal">
        <div className="modal-head">
          <div>
            <strong>Modify Pending Order</strong>
            <div className="meta">{order?.symbol} - {String(order?.order_type || '').replace('_', ' ')}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="close-preview">
            <div><span>Side</span><strong className={order?.trade_type === 'buy' ? 'positive-blue' : 'negative'}>{String(order?.trade_type || '').toUpperCase()}</strong></div>
            <div><span>Status</span><strong>{order?.status || 'pending'}</strong></div>
            <div><span>Current Qty</span><strong>{order?.quantity || '-'}</strong></div>
            <div><span>Order Price</span><strong>{Number(order?.price || 0).toFixed(2)}</strong></div>
          </div>
          <div className="grid-2">
            <div className="field">
              <label>Quantity</label>
              <input className="input" type="number" min="1" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} />
            </div>
            <div className="field">
              <label>Price</label>
              <input className="input" type="number" value={form.price} onChange={(event) => update('price', event.target.value)} />
            </div>
            <div className="field">
              <label>Stop Loss</label>
              <input className="input" type="number" value={form.stopLoss} onChange={(event) => update('stopLoss', event.target.value)} placeholder="0.00" />
            </div>
            <div className="field">
              <label>Take Profit</label>
              <input className="input" type="number" value={form.takeProfit} onChange={(event) => update('takeProfit', event.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="grid-2">
            <button className="btn subtle" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!qty || !price} onClick={() => onSubmit({
              quantity: qty,
              price,
              stopLoss: Number(form.stopLoss || 0),
              takeProfit: Number(form.takeProfit || 0),
            })}>Modify Order</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeHistory({ selectedAccount, refreshAuth }) {
  const [rows, setRows] = useState([]);
  const [orderRows, setOrderRows] = useState([]);
  const [deals, setDeals] = useState([]);
  const [dealsSummary, setDealsSummary] = useState(null);
  const [period, setPeriod] = useState('month');
  const [view, setView] = useState('positions');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!selectedAccount?.id) return;
    setLoading(true);
    try {
      const [historyRes, orderRes, pendingRes, dealsRes] = await Promise.all([
        api.get('/trading/history', { params: { accountId: selectedAccount.id, period } }),
        api.get(`/trading/pending-order-history/${selectedAccount.id}`),
        api.get(`/trading/pending-orders/${selectedAccount.id}`),
        api.get('/transactions/deals', { params: { accountId: selectedAccount.id, period, limit: 500 } }),
      ]);
      const historyRows = historyRes.data?.data || [];
      const pendingHistoryRows = orderRes.data?.data || [];
      const pendingRows = pendingRes.data?.data || [];
      const rawDeals = dealsRes.data?.data?.deals || [];
      const executedRows = historyRows.map((trade) => ({
        ...trade,
        order_type: 'market',
        status: 'executed',
        trade_type: trade.trade_type,
        price: trade.open_price,
        created_at: trade.open_time || trade.created_at,
        updated_at: trade.close_time || trade.updated_at,
      }));
      const cutoff = getPeriodCutoff(period);
      const isInPeriod = (row) => {
        const value = row.close_time || row.closed_at || row.exit_time || row.executed_at || row.time || row.updated_at || row.created_at || row.open_time || row.date;
        return value ? new Date(value) >= cutoff : true;
      };
      const filteredHistoryRows = historyRows.filter(isInPeriod);
      const filteredDeals = rawDeals.filter(isInPeriod);
      const orderMap = new Map();
      [...pendingRows, ...pendingHistoryRows, ...executedRows].forEach((row) => {
        if (!isInPeriod(row)) return;
        orderMap.set(`${row.id}-${row.status || row.order_status || ''}`, row);
      });
      setRows(filteredHistoryRows);
      setOrderRows([...orderMap.values()].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)));
      setDeals(filteredDeals);
      setDealsSummary(buildFilteredDealsSummary(filteredDeals, dealsRes.data?.data?.summary, selectedAccount));
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [selectedAccount?.id, period]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshHistory = async () => {
    try {
      await Promise.all([load(), refreshAuth?.()]);
      toast.success('History refreshed');
    } catch {
      toast.error('Failed to refresh history');
    }
  };

  return (
    <div className="card pad history-panel compact-workspace-panel">
      <div className="toolbar">
        <div className="left">
          <div className="tabs">
            {[
              ['today', 'Day'],
              ['week', 'Week'],
              ['month', 'Month'],
              ['3months', '3 Months'],
            ].map(([item, label]) => (
              <button key={item} className={`tab ${period === item ? 'active' : ''}`} onClick={() => setPeriod(item)}>{label}</button>
            ))}
          </div>
          <div className="tabs">
            {[
              ['positions', 'Positions'],
              ['orders', 'Orders'],
              ['deals', 'Deals'],
            ].map(([id, label]) => (
              <button key={id} className={`tab ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>{label}</button>
            ))}
          </div>
        </div>
        <button type="button" className="btn subtle" onClick={refreshHistory} disabled={loading}><RefreshCw size={16} />Refresh</button>
      </div>

      {view === 'positions' && (
        <div className="history-position-list">
          <div className="history-position-summary">
            <div><span>Trades</span><strong>{rows.length}</strong></div>
            <div><span>Total Buy</span><strong className="positive-blue">{rows.filter((trade) => trade.trade_type === 'buy').reduce((sum, trade) => sum + Number(trade.quantity || 0), 0)}</strong></div>
            <div><span>Total Sell</span><strong className="negative">{rows.filter((trade) => trade.trade_type === 'sell').reduce((sum, trade) => sum + Number(trade.quantity || 0), 0)}</strong></div>
            <div><span>Net P&L</span><strong className={rows.reduce((sum, trade) => sum + Number(trade.profit || 0), 0) >= 0 ? 'positive-blue' : 'negative'}>{formatMoney(rows.reduce((sum, trade) => sum + Number(trade.profit || 0), 0))}</strong></div>
          </div>
          {rows.map((trade) => {
            const pnl = Number(trade.profit || 0);
            const qty = Number(trade.quantity || 0);
            const openPrice = Number(trade.open_price || 0);
            const closePrice = Number(trade.close_price || 0);
            const brokerage = Number(trade.brokerage || trade.buy_brokerage || 0);
            const isBuy = trade.trade_type === 'buy';
            return (
              <div className="history-position-row" key={trade.id}>
                <div className="history-position-head">
                  <div>
                    <strong>{trade.symbol}</strong>
                    <span>{trade.close_count || 1} close</span>
                  </div>
                  <div className={pnl >= 0 ? 'positive-blue' : 'negative'}>{formatMoney(pnl)}</div>
                </div>
                <div className="history-position-grid">
                  <div>
                    <span>Buy</span>
                    <strong>{isBuy ? qty : qty}</strong>
                    <em>@ {(isBuy ? openPrice : closePrice).toFixed(2)}</em>
                  </div>
                  <div>
                    <span>Sell</span>
                    <strong>{isBuy ? qty : qty}</strong>
                    <em>@ {(isBuy ? closePrice : openPrice).toFixed(2)}</em>
                  </div>
                  <div>
                    <span>Net</span>
                    <strong>{Number(trade.net_quantity || 0)}</strong>
                    <em className="commission-muted">Commission {brokerage.toFixed(2)}</em>
                  </div>
                  <div className="history-position-side">
                    <span>{isBuy ? 'Long' : 'Short'}</span>
                  </div>
                </div>
                <div className="history-position-foot">
                  <span>{formatDate(trade.close_time || trade.updated_at || trade.open_time || trade.created_at)}</span>
                  <button type="button">Show breakdown</button>
                </div>
              </div>
            );
          })}
          {!rows.length && <div className="empty-state compact-empty"><span>No closed positions found</span></div>}
        </div>
      )}

      {view === 'orders' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order ID</th><th>Script</th><th>Side</th><th>Order Type</th><th>Qty</th><th>Price</th>
                <th>Stop Loss</th><th>Take Profit</th><th>Status</th><th>Created</th><th>Updated</th><th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {orderRows.map((order) => (
                <tr key={order.id}>
                  <td className="mono">{order.id}</td>
                  <td><strong>{order.symbol}</strong></td>
                  <td><span className={`pill ${order.trade_type === 'buy' ? 'teal' : 'red'}`}>{order.trade_type || '-'}</span></td>
                  <td>{String(order.order_type || order.type || '-').replace('_', ' ')}</td>
                  <td>{order.quantity || '-'}</td>
                  <td>{Number(order.price || 0).toFixed(2)}</td>
                  <td>{Number(order.stop_loss || 0) > 0 ? Number(order.stop_loss).toFixed(2) : '-'}</td>
                  <td>{Number(order.take_profit || 0) > 0 ? Number(order.take_profit).toFixed(2) : '-'}</td>
                  <td><span className="pill gold">{order.status || '-'}</span></td>
                  <td>{formatDate(order.created_at || order.updated_at || order.executed_at)}</td>
                  <td>{formatDate(order.updated_at || order.executed_at)}</td>
                  <td>{order.rejection_reason || order.comment || '-'}</td>
                </tr>
              ))}
              {!orderRows.length && <tr><td colSpan="12">No order history found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'deals' && (
        <>
          <div className="deals-summary-strip">
            <div><span>Profit:</span><strong className="positive-blue">{formatMoney(dealsSummary?.totalProfit || 0)}</strong></div>
            <div><span>Loss:</span><strong className="negative">{formatMoney(dealsSummary?.totalLoss || 0)}</strong></div>
            <div><span>Deposits:</span><strong className="positive-blue">{formatMoney(dealsSummary?.totalDeposits || 0)}</strong></div>
            <div><span>Withdrawals:</span><strong className="negative">{formatMoney(dealsSummary?.totalWithdrawals || 0)}</strong></div>
            <div><span>Commission:</span><strong>{formatMoney(dealsSummary?.totalCommission || 0)}</strong></div>
            <div><span>Balance Settled:</span><strong className={Number(dealsSummary?.balanceSettled || 0) >= 0 ? 'positive-blue' : 'negative'}>{formatMoney(dealsSummary?.balanceSettled || 0)}</strong></div>
            <div><span>Balance:</span><strong>{formatMoney(dealsSummary?.balance || selectedAccount?.balance || 0)}</strong></div>
          </div>
          <div className="deal-ledger-list">
            {deals.map((deal) => {
              const amount = Number(deal.amount || deal.profit || 0);
              const side = deal.side || deal.trade_type || deal.type || '-';
              const qty = Number(deal.quantity || 0);
              const price = Number(deal.price || 0);
              const actionLabel = deal.dealLabel || (
                deal.symbol
                  ? (String(side).toLowerCase() === 'buy' ? 'Buy In' : String(side).toLowerCase() === 'sell' ? 'Sell Out' : String(side).replace('_', ' '))
                  : ''
              );
              return (
                <div className="deal-ledger-row" key={deal.id}>
                  <div className="deal-ledger-main">
                    <div>
                      <strong>
                        {deal.symbol || deal.dealLabel || deal.description || '-'}
                        {deal.symbol && actionLabel ? <span className={`pill ${String(actionLabel).toLowerCase().includes('buy') ? 'teal' : 'red'}`}>{actionLabel}</span> : null}
                      </strong>
                      <div className="meta">{formatDate(deal.time || deal.created_at)}</div>
                      <div className="deal-detail-line">
                        {qty ? <span>Qty {qty}</span> : null}
                        {price ? <span>Price {price.toFixed(2)}</span> : null}
                        {Number(deal.commission || deal.brokerage || 0) ? <span>Commission {Number(deal.commission || deal.brokerage || 0).toFixed(2)}</span> : null}
                      </div>
                      <div className="meta">{deal.description || deal.remarks || side}</div>
                    </div>
                    <div className="deal-ledger-amount">
                      <strong className={amount >= 0 ? 'positive-blue' : 'negative'}>{formatMoney(amount)}</strong>
                      <span>{String(side).replace('_', ' ')}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {!deals.length && <div className="empty-state compact-empty"><span>No deals found</span></div>}
          </div>
        </>
      )}
    </div>
  );
}

function Messages() {
  const [rows, setRows] = useState([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/messages');
      setRows(res.data?.data || []);
    } catch {
      toast.error('Failed to load messages');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    if (!content.trim()) return toast.error('Enter your message');
    setLoading(true);
    try {
      await api.post('/messages', { title: 'Support Query', content });
      setContent('');
      toast.success('Message sent');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Message failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="messages-layout">
      <div className="card pad message-compose-card">
      <div className="section-head">
        <div>
          <h2>Messages</h2>
          <p>Contact support for account, trade or settlement queries.</p>
        </div>
        <MessageSquare size={22} color="var(--blue)" />
      </div>
        <div className="field">
          <label>Your Query</label>
          <textarea className="input textarea" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write your message to Trade Axis support" />
        </div>
        <button className="btn primary" onClick={send} disabled={loading}><Send size={16} />Send Message</button>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>Inbox</h2><p>{rows.length} messages</p></div></div>
        <div className="message-thread">
          {rows.map((row) => {
            const mine = row.sender_role === 'user';
            return (
              <div key={row.id} className={`message-bubble ${mine ? 'mine' : 'support'}`}>
                <div className="message-bubble-head">
                  <strong>{mine ? 'You' : 'Trade Axis Support'}</strong>
                  <span>{formatDate(row.created_at)}</span>
                </div>
                <div>{row.content}</div>
              </div>
            );
          })}
          {!rows.length && <div className="empty-state compact-empty"><span>No messages yet</span></div>}
        </div>
      </div>
    </div>
  );
}

function WalletPanel({ selectedAccount, refreshAuth }) {
  const [tab, setTab] = useState('deposit');
  const [txns, setTxns] = useState([]);
  const [qr, setQr] = useState(null);
  const [deposit, setDeposit] = useState({ amount: '', reference: '', note: '' });
  const [withdraw, setWithdraw] = useState({ amount: '', accountHolderName: '', bankName: '', accountNumber: '', ifscCode: '' });

  const load = useCallback(async () => {
    if (!selectedAccount?.id) return;
    const [txnRes, qrRes] = await Promise.all([
      api.get('/transactions', { params: { accountId: selectedAccount.id, limit: 100 } }),
      api.get('/transactions/qr-settings').catch(() => ({ data: {} })),
    ]);
    setTxns(txnRes.data?.data || []);
    setQr(qrRes.data?.data || qrRes.data?.settings || null);
  }, [selectedAccount?.id]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const refreshWallet = async () => {
    try {
      await Promise.all([load(), refreshAuth?.()]);
      toast.success('Wallet refreshed');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Refresh failed');
    }
  };

  const submitQr = async () => {
    try {
      await api.post('/transactions/qr-deposit-request', {
        accountId: selectedAccount.id,
        amount: Number(deposit.amount),
        paymentReference: deposit.reference,
        note: deposit.note,
      });
      toast.success('QR deposit request submitted');
      setDeposit({ amount: '', reference: '', note: '' });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Deposit request failed');
    }
  };

  const submitWithdraw = async () => {
    try {
      await api.post('/transactions/withdraw', {
        accountId: selectedAccount.id,
        amount: Number(withdraw.amount),
        bankName: withdraw.bankName,
        accountNumber: withdraw.accountNumber,
        ifscCode: withdraw.ifscCode,
        accountHolderName: withdraw.accountHolderName,
      });
      toast.success('Withdrawal request submitted');
      setWithdraw({ amount: '', accountHolderName: '', bankName: '', accountNumber: '', ifscCode: '' });
      await load();
      await refreshAuth();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Withdrawal failed');
    }
  };

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="tabs">
          {['deposit', 'withdraw', 'history'].map((item) => (
            <button key={item} className={`tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
        <button type="button" className="btn subtle" onClick={refreshWallet}><RefreshCw size={16} />Refresh</button>
      </div>

      {tab === 'deposit' && (
        <div className="grid-2">
          <div>
            <div className="field"><label>Amount</label><input className="input" type="number" value={deposit.amount} onChange={(event) => setDeposit((prev) => ({ ...prev, amount: event.target.value }))} /></div>
            <div className="field"><label>UTR or Reference</label><input className="input" value={deposit.reference} onChange={(event) => setDeposit((prev) => ({ ...prev, reference: event.target.value }))} /></div>
            <div className="field"><label>Note</label><textarea className="textarea" value={deposit.note} onChange={(event) => setDeposit((prev) => ({ ...prev, note: event.target.value }))} /></div>
            <button className="btn primary" onClick={submitQr}>Submit QR Deposit Request</button>
          </div>
          <div className="card pad">
            <h2>QR Payment Details</h2>
            {qr?.qrImage && <img src={qr.qrImage} alt="Deposit QR" style={{ width: '100%', maxWidth: 280, background: '#fff', border: '1px solid var(--border)', borderRadius: 8 }} />}
            <div className="list" style={{ marginTop: 12 }}>
              <div className="row"><div><strong>UPI ID</strong><div className="meta">{qr?.upiId || '-'}</div></div></div>
              <div className="row"><div><strong>Bank</strong><div className="meta">{qr?.bankName || '-'} {qr?.accountNumber || ''}</div></div></div>
              <div className="row"><div><strong>IFSC</strong><div className="meta">{qr?.ifscCode || '-'}</div></div></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'withdraw' && (
        <div className="grid-2">
          {[
            ['amount', 'Amount'],
            ['accountHolderName', 'Account Holder Name'],
            ['bankName', 'Bank Name'],
            ['accountNumber', 'Account Number'],
            ['ifscCode', 'IFSC Code'],
          ].map(([key, label]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <input className="input" value={withdraw[key]} onChange={(event) => setWithdraw((prev) => ({ ...prev, [key]: event.target.value }))} />
            </div>
          ))}
          <button className="btn danger" onClick={submitWithdraw}>Request Withdrawal</button>
        </div>
      )}

      {tab === 'history' && <TransactionTable rows={txns} />}
    </div>
  );
}

function SettingsPanel({
  user,
  accounts,
  selectedAccount,
  selectedAccountId,
  onSelectAccount,
  savedSessions,
  onSwitchSavedSession,
  onAddAccount,
  onRefresh,
  onLogout,
  theme,
  onToggleTheme,
}) {
  return (
    <div className="grid-2">
      <div className="card pad">
        <div className="section-head">
          <div><h2>Profile</h2><p>Login and role details.</p></div>
          <ShieldCheck color="var(--teal)" />
        </div>
        <div className="list">
          <div className="row"><div><strong>Name</strong><div className="meta">{getUserName(user)}</div></div></div>
          <div className="row"><div><strong>Login ID</strong><div className="meta mono">{getLoginId(user)}</div></div></div>
          <div className="row"><div><strong>Role</strong><div className="meta">{roleLabel(user?.role)}</div></div></div>
        </div>
      </div>
      <div className="card pad">
        <div className="section-head">
          <div><h2>Security</h2><p>Change your dashboard password.</p></div>
          <Lock color="var(--blue)" />
        </div>
        <ChangePasswordForm />
      </div>
      <div className="card pad">
        <div className="section-head">
          <div><h2>Accounts</h2><p>Switch account, add another login, or refresh account details.</p></div>
          <button className="btn subtle" type="button" onClick={onRefresh}><RefreshCw size={16} />Refresh</button>
        </div>
        <div className="settings-account-panel">
          <AccountSelect
            accounts={accounts}
            selectedAccount={selectedAccount}
            selectedAccountId={selectedAccountId}
            onSelectAccount={onSelectAccount}
            savedSessions={savedSessions}
            onSwitchSavedSession={onSwitchSavedSession}
            onAddAccount={onAddAccount}
          />
          <button className="btn subtle mobile-settings-logout" type="button" onClick={onLogout}>
            <LogOut size={16} />
            Logout
          </button>
          <div className="list account-list">
            {(accounts || []).map((account) => (
              <div className={`row ${account.id === selectedAccountId ? 'active' : ''}`} key={account.id}>
                <div>
                  <strong>{account.account_number}</strong>
                  <div className="meta">{account.is_demo ? 'Demo account' : 'Live account'}</div>
                </div>
                {account.id === selectedAccountId && <span className="pill blue">Selected</span>}
              </div>
            ))}
            {!accounts?.length && (
              <div className="row">
                <div><strong>No accounts found</strong><div className="meta">Add an account to start using the dashboard.</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="card pad">
        <div className="section-head">
          <div><h2>Appearance</h2><p>Switch the full dashboard between light and dark mode.</p></div>
          {theme === 'dark' ? <Moon color="var(--blue)" /> : <Sun color="var(--gold)" />}
        </div>
        <label className="row">
          <span>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          <button className="btn subtle" type="button" onClick={onToggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            Switch to {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </label>
      </div>
    </div>
  );
}

function ChangePasswordForm() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.currentPassword || !form.newPassword) return toast.error('Enter current and new password');
    if (form.newPassword !== form.confirmPassword) return toast.error('New password confirmation does not match');
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success('Password changed');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Password change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list">
      <div className="field"><label>Current Password</label><input className="input" type="password" value={form.currentPassword} onChange={(event) => update('currentPassword', event.target.value)} /></div>
      <div className="field"><label>New Password</label><input className="input" type="password" value={form.newPassword} onChange={(event) => update('newPassword', event.target.value)} /></div>
      <div className="field"><label>Confirm Password</label><input className="input" type="password" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} /></div>
      <button className="btn primary" onClick={submit} disabled={busy}>Change Password</button>
    </div>
  );
}

function UsersPanel({ mode, role, currentUser, brokerScope = null, permissions = defaultSubBrokerPermissions }) {
  const [users, setUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [q, setQ] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [autoCloseSettings, setAutoCloseSettings] = useState({ percent: 90, applyAll: true, userIds: [], userSettings: [] });

  const load = useCallback(async () => {
    const [res, autoCloseRes] = await Promise.all([
      api.get('/web-admin/users', { params: { q, role: 'all' } }),
      api.get('/web-admin/auto-close-settings').catch(() => ({ data: { data: null } })),
    ]);
    const data = res.data?.data || [];
    if (autoCloseRes.data?.data) setAutoCloseSettings(autoCloseRes.data.data);
    setAllUsers(data);
    setUsers(data.filter((user) => {
      if (mode === 'sub_broker') return user.role === 'sub_broker';
      if (brokerScope?.id) return user.role === 'user' && user.created_by === brokerScope.id;
      if (role === 'admin') return user.role === 'user' && !user.created_by;
      return user.role === 'user';
    }));
  }, [q, mode, role, brokerScope?.id]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load users'));
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load().catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const displayedUsers = userFilter ? users.filter((user) => user.id === userFilter) : users;
  const totals = displayedUsers.reduce((acc, user) => {
    const metrics = getAccountMetrics(getDisplayAccount(user.accounts));
    acc.balance += metrics.balance;
    acc.equity += metrics.equity;
    acc.openPnl += metrics.totalDrCr;
    acc.closedPnl += metrics.credit;
    acc.totalDrCr += metrics.totalDrCr;
    acc.margin += metrics.margin;
    acc.freeMargin += metrics.freeMargin;
    return acc;
  }, {
    balance: 0,
    equity: 0,
    openPnl: 0,
    closedPnl: 0,
    totalDrCr: 0,
    margin: 0,
    freeMargin: 0,
  });
  totals.marginLevel = totals.margin > 0 ? (totals.equity / totals.margin) * 100 : 0;

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div style={{ position: 'relative', minWidth: 280 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
            <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search users" style={{ paddingLeft: 38 }} />
          </div>
          <select className="select" value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
            <option value="">All users</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}
          </select>
        </div>
        <div className="right">
          <button type="button" className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
          {(role !== 'sub_broker' || permissions.usersCreate !== false) && (
            <button className="btn primary" onClick={() => setShowCreate(true)}><Plus size={16} />Create {mode === 'sub_broker' ? 'Sub Broker' : 'User'}</button>
          )}
        </div>
      </div>
      {brokerScope && (
        <div className="scope-banner">
          Managing clients under <strong>{getUserName(brokerScope)}</strong>
          <span>{brokerScope.login_id || brokerScope.email}</span>
        </div>
      )}
      <UserManagementTotals totals={totals} />
      <UsersTable
        users={displayedUsers}
        brokers={allUsers.filter((user) => user.role === 'sub_broker')}
        showBroker={role === 'admin' && mode !== 'sub_broker'}
        autoCloseSettings={autoCloseSettings}
        canPositions={role !== 'sub_broker' || permissions.usersPositions !== false}
        canLedger={role !== 'sub_broker' || permissions.usersLedger !== false}
        canCreate={role !== 'sub_broker' || permissions.usersCreate !== false}
        canUpdate={role !== 'sub_broker' || permissions.usersUpdate !== false}
        canDelete={role !== 'sub_broker' || permissions.usersDelete !== false}
        onRefresh={load}
        onOpenDialog={setDialog}
      />
      {showCreate && <CreateUserModal mode={mode} role={role} brokerScope={brokerScope} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {dialog?.type === 'positions' && <UserPositionsModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'brokerage' && <BrokerageModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'ledger' && <LedgerModal user={dialog.user} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.type === 'update' && <UserUpdateModal mode={mode} user={dialog.user} users={allUsers} brokers={allUsers.filter((user) => user.role === 'sub_broker')} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.type === 'brokerUsers' && <SubBrokerUsersModal broker={dialog.user} role={role} currentUser={currentUser} onClose={() => setDialog(null)} />}
      {dialog?.type === 'permissions' && <SubBrokerPermissionsModal broker={dialog.user} onClose={() => setDialog(null)} />}
    </div>
  );
}

function UserManagementTotals({ totals }) {
  const items = [
    ['Ledger Balance', totals.balance],
    ['Equity', totals.equity],
    ['Open P&L', totals.openPnl, true],
    ['Closed P&L', totals.closedPnl, true],
    ['Total Dr/Cr', totals.totalDrCr, true],
    ['Margin Used', totals.margin],
    ['Margin Lvl %', totals.marginLevel, true, '%'],
    ['Margin Available', totals.freeMargin],
  ];

  return (
    <div className="management-totals-strip">
      {items.map(([label, value, signed, suffix]) => {
        const numeric = Number(value || 0);
        const text = suffix === '%'
          ? `${numeric.toFixed(2)}%`
          : numeric.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
        return (
          <div key={label}>
            <span>{label}</span>
            <strong className={signed ? (numeric >= 0 ? 'positive-blue' : 'negative') : ''}>{text}</strong>
          </div>
        );
      })}
    </div>
  );
}

function SubBrokerUsersModal({ broker, role, currentUser, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal full-screen-modal">
        <div className="modal-head">
          <div>
            <strong>User Management - {getUserName(broker)}</strong>
            <p>{broker.login_id || broker.email} sub broker clients</p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <UsersPanel mode="user" role={role} currentUser={currentUser} brokerScope={broker} />
        </div>
      </div>
    </div>
  );
}

function SubBrokerPermissionsModal({ broker, onClose }) {
  const [permissions, setPermissions] = useState(defaultSubBrokerPermissions);
  const [expandedPermission, setExpandedPermission] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get('/web-admin/sub-broker-permissions', { params: { brokerId: broker.id } })
      .then((res) => {
        if (mounted) setPermissions(normalizeSubBrokerPermissions(res.data?.data?.permissions));
      })
      .catch(() => toast.error('Failed to load permissions'))
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [broker.id]);

  const updatePermission = (key, checked) => {
    setPermissions((prev) => ({ ...prev, [key]: checked }));
  };

  const save = async () => {
    try {
      const res = await api.post('/web-admin/sub-broker-permissions', { brokerId: broker.id, permissions });
      toast.success(res.data?.message || 'Permissions saved');
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Save failed');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-head">
          <div>
            <strong>Feature Access - {getUserName(broker)}</strong>
            <p>{broker.login_id || broker.email}</p>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="permission-grid">
            {subBrokerFeatureTabs.map((tab) => {
              if (tab.id === 'users') {
                const expanded = expandedPermission === 'users';
                return (
                  <div className={`permission-card permission-card-expand ${expanded ? 'expanded' : ''}`} key={tab.id}>
                    <button type="button" className="permission-card-toggle" onClick={() => setExpandedPermission(expanded ? '' : 'users')}>
                      <span>
                        <strong>{tab.label}</strong>
                        <small>Expand to control the tab, Create, P, L, Update, and Delete buttons.</small>
                      </span>
                      <span className="permission-expand-indicator">{expanded ? 'Hide' : 'Manage'}</span>
                    </button>
                    {expanded && (
                      <div className="permission-sub-options">
                        <label>
                          <span>Complete User Management</span>
                          <input type="checkbox" checked={permissions.users !== false} onChange={(event) => updatePermission('users', event.target.checked)} />
                        </label>
                        <label>
                          <span>Create Button</span>
                          <input type="checkbox" checked={permissions.usersCreate !== false} onChange={(event) => updatePermission('usersCreate', event.target.checked)} />
                        </label>
                        <label>
                          <span>P Button</span>
                          <input type="checkbox" checked={permissions.usersPositions !== false} onChange={(event) => updatePermission('usersPositions', event.target.checked)} />
                        </label>
                        <label>
                          <span>L Button</span>
                          <input type="checkbox" checked={permissions.usersLedger !== false} onChange={(event) => updatePermission('usersLedger', event.target.checked)} />
                        </label>
                        <label>
                          <span>Update Button</span>
                          <input type="checkbox" checked={permissions.usersUpdate !== false} onChange={(event) => updatePermission('usersUpdate', event.target.checked)} />
                        </label>
                        <label>
                          <span>Delete Button</span>
                          <input type="checkbox" checked={permissions.usersDelete !== false} onChange={(event) => updatePermission('usersDelete', event.target.checked)} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              }

              if (tab.id === 'adminPositions') {
                const expanded = expandedPermission === 'adminPositions';
                return (
                  <div className={`permission-card permission-card-expand ${expanded ? 'expanded' : ''}`} key={tab.id}>
                    <button type="button" className="permission-card-toggle" onClick={() => setExpandedPermission(expanded ? '' : 'adminPositions')}>
                      <span>
                        <strong>{tab.label}</strong>
                        <small>Expand to control the tab and Edit, Exit, Reopen, Delete actions.</small>
                      </span>
                      <span className="permission-expand-indicator">{expanded ? 'Hide' : 'Manage'}</span>
                    </button>
                    {expanded && (
                      <div className="permission-sub-options">
                        <label>
                          <span>Complete Positions</span>
                          <input type="checkbox" checked={permissions.adminPositions !== false} onChange={(event) => updatePermission('adminPositions', event.target.checked)} />
                        </label>
                        <label>
                          <span>Edit Button</span>
                          <input type="checkbox" checked={permissions.adminPositionsEdit !== false} onChange={(event) => updatePermission('adminPositionsEdit', event.target.checked)} />
                        </label>
                        <label>
                          <span>Exit Button</span>
                          <input type="checkbox" checked={permissions.adminPositionsExit !== false} onChange={(event) => updatePermission('adminPositionsExit', event.target.checked)} />
                        </label>
                        <label>
                          <span>Reopen Button</span>
                          <input type="checkbox" checked={permissions.adminPositionsReopen !== false} onChange={(event) => updatePermission('adminPositionsReopen', event.target.checked)} />
                        </label>
                        <label>
                          <span>Delete Button</span>
                          <input type="checkbox" checked={permissions.adminPositionsDelete !== false} onChange={(event) => updatePermission('adminPositionsDelete', event.target.checked)} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <label className="permission-card" key={tab.id}>
                  <span>
                    <strong>{tab.label}</strong>
                    <small>{permissions[tab.id] === false ? 'Disabled for this sub broker' : 'Enabled for this sub broker'}</small>
                  </span>
                  <input type="checkbox" checked={permissions[tab.id] !== false} onChange={(event) => updatePermission(tab.id, event.target.checked)} />
                </label>
              );
            })}
          </div>
          <div className="modal-actions">
            <button className="btn subtle" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={loading}>Save Permissions</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getAutoClosePercentForUser(user, settings = {}) {
  if (!settings || settings.applyAll !== false) {
    return settings?.percent ?? user.auto_close_percent ?? user.stop_loss_percent ?? '-';
  }
  const userSettings = Array.isArray(settings.userSettings) ? settings.userSettings : [];
  const row = userSettings.find((item) => item.userId === user.id);
  if (row?.percent !== undefined && row?.percent !== null) return row.percent;
  const selectedIds = settings.userIds || settings.selectedUserIds || [];
  if (Array.isArray(selectedIds) && selectedIds.includes(user.id)) return settings.percent ?? '-';
  return user.auto_close_percent ?? user.stop_loss_percent ?? '-';
}

function UsersTable({ users, brokers = [], showBroker, autoCloseSettings, canPositions = true, canLedger = true, canUpdate = true, canDelete = true, onRefresh, onOpenDialog }) {
  const updateBroker = async (userId, brokerId) => {
    try {
      await api.post('/web-admin/assign-broker', { userId, brokerId: brokerId || null });
      toast.success('Broker assignment updated');
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  const deleteUser = async (user) => {
    if (!window.confirm(`Delete ${user.login_id || getUserName(user)}?`)) return;
    try {
      await api.delete(`/web-admin/users/${user.id}`);
      toast.success('User deleted');
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Delete failed');
    }
  };

  const deleteDemoAccount = async (user) => {
    const demoAccount = (user.accounts || []).find((account) => account.is_demo);
    if (!demoAccount) return toast.error('No demo account found');
    if (!window.confirm(`Delete demo account ${demoAccount.account_number}?`)) return;
    try {
      await api.delete(`/web-admin/accounts/${demoAccount.id}/demo`);
      toast.success('Demo account deleted');
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Demo delete failed');
    }
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>P / B / L</th><th>User ID</th><th>Name</th><th>Ledger Bal</th><th>Equity</th><th>Open PNL</th><th>Closed P&L</th><th>Total Dr/Cr</th><th>Margin Used</th><th>Margin Lvl %</th><th>Margin Available</th><th>Sub Broker</th><th>Admin</th><th>Type</th><th>L</th><th>SL</th><th>Demo</th><th>Active</th><th>Created On</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const primary = getDisplayAccount(user.accounts);
            const metrics = getAccountMetrics(primary);
            const openPnl = metrics.totalDrCr;
            const closedPnl = metrics.credit;
            return (
            <tr key={user.id}>
              <td>
                <div className="quick-actions">
                  {canPositions && <button className="mini-action purple" onClick={() => onOpenDialog({ type: 'positions', user })}>P</button>}
                  <button className="mini-action orange" onClick={() => onOpenDialog({ type: 'brokerage', user })}>B</button>
                  {canLedger && <button className="mini-action blue" onClick={() => onOpenDialog({ type: 'ledger', user })}>L</button>}
                </div>
              </td>
              <td><strong className="mono">{user.login_id}</strong></td>
              <td><strong>{getUserName(user)}</strong><div className="meta">{user.email || user.phone || '-'}</div></td>
              <td>{metrics.balance.toLocaleString('en-IN')}</td>
              <td>{metrics.equity.toLocaleString('en-IN')}</td>
              <td className={openPnl >= 0 ? 'positive-blue' : 'negative'}>{openPnl.toFixed(2)}</td>
              <td className={closedPnl >= 0 ? 'positive' : 'negative'}>{closedPnl.toFixed(2)}</td>
              <td className={openPnl >= 0 ? 'positive-blue' : 'negative'}>{openPnl.toFixed(2)}</td>
              <td>{metrics.margin.toLocaleString('en-IN')}</td>
              <td>{metrics.marginLevel ? metrics.marginLevel.toFixed(2) : '-'}</td>
              <td>{metrics.freeMargin.toLocaleString('en-IN')}</td>
              <td>
                {showBroker ? (
                  <select className="select" value={user.created_by || ''} onChange={(event) => updateBroker(user.id, event.target.value)}>
                    <option value="">Admin direct</option>
                    {brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.login_id}</option>)}
                  </select>
                ) : (
                  <span className="meta">{user.created_by ? 'Assigned' : '-'}</span>
                )}
              </td>
              <td>{user.role === 'admin' ? 'YES' : 'NO'}</td>
              <td><span className="pill blue">{user.closing_mode ? 'Closing' : 'Exposure'}</span></td>
              <td>{user.leverage || primary.leverage || '-'}</td>
              <td>{getAutoClosePercentForUser(user, autoCloseSettings)}</td>
              <td>{(user.accounts || []).some((account) => account.is_demo) ? 'YES' : 'NO'}</td>
              <td>{user.is_active ? 'YES' : 'NO'}</td>
              <td>{formatDate(user.created_at)}</td>
              <td>
                <div className="action-pair">
                  {user.role === 'sub_broker' && (
                    <>
                      <button className="btn subtle" onClick={() => onOpenDialog({ type: 'brokerUsers', user })}>User Management</button>
                      <button className="btn subtle" onClick={() => onOpenDialog({ type: 'permissions', user })}>Permissions</button>
                    </>
                  )}
                  {canUpdate && <button className="btn primary" onClick={() => onOpenDialog({ type: 'update', user })}>Update</button>}
                  {canDelete && (user.accounts || []).some((account) => account.is_demo) && <button className="btn subtle" onClick={() => deleteDemoAccount(user)}>Delete Demo</button>}
                  {canDelete && <button className="btn danger" onClick={() => deleteUser(user)}>Delete</button>}
                </div>
              </td>
            </tr>
          )})}
          {!users.length && <tr><td colSpan="20">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserModal({ mode, role, brokerScope = null, onClose, onCreated }) {
  const [form, setForm] = useState({
    loginId: '',
    password: 'TA1234',
    firstName: '',
    phone: '',
    role: mode === 'sub_broker' ? 'sub_broker' : 'user',
    leverage: 30,
    brokerageRate: 0.0006,
    demoBalance: 100000,
    createDemo: false,
    createLive: true,
    liquidationType: 'liquidate',
  });

  const creatingAdmin = mode !== 'sub_broker' && role === 'admin' && !brokerScope && form.role === 'admin';
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const create = async () => {
    try {
      const res = await api.post('/web-admin/users', brokerScope?.id ? { ...form, createdBy: brokerScope.id } : form);
      toast.success(res.data?.message || 'Created');
      onCreated();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Create failed');
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <strong>Create {mode === 'sub_broker' ? 'Sub Broker' : 'User'}</strong>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="grid-2">
            {[
              ['loginId', 'Login ID'],
              ['password', 'Password'],
              ['firstName', 'Name'],
              ['phone', 'Phone'],
              ...(!creatingAdmin ? [
                ['leverage', 'Leverage'],
                ['brokerageRate', 'Brokerage Rate'],
                ['demoBalance', 'Demo Balance'],
              ] : []),
            ].map(([key, label]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <input className="input" value={form[key]} onChange={(event) => update(key, key === 'loginId' ? event.target.value.toUpperCase() : event.target.value)} />
              </div>
            ))}
          </div>
          {mode !== 'sub_broker' && role === 'admin' && !brokerScope && (
            <div className="field">
              <label>Role</label>
              <select className="select" value={form.role} onChange={(event) => update('role', event.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          )}
          {mode !== 'sub_broker' && !creatingAdmin && (
            <div className="grid-2">
              <label className="row"><span>Create Demo</span><input type="checkbox" checked={form.createDemo} onChange={(event) => update('createDemo', event.target.checked)} /></label>
              <label className="row"><span>Create Live</span><input type="checkbox" checked={form.createLive} onChange={(event) => update('createLive', event.target.checked)} /></label>
            </div>
          )}
          {!creatingAdmin && (
            <div className="field">
              <label>Account Liquidation Mode</label>
              <select className="select" value={form.liquidationType} onChange={(event) => update('liquidationType', event.target.value)}>
                <option value="liquidate">Liquidate</option>
                <option value="illiquidate">Illiquidate</option>
              </select>
            </div>
          )}
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

function AdminPositionsPanel({ role = 'admin', permissions = defaultSubBrokerPermissions }) {
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('open');
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, posRes] = await Promise.all([
        api.get('/web-admin/users'),
        api.get('/web-admin/positions', { params: { status, userId, q } }),
      ]);
      setUsers(usersRes.data?.data || []);
      setRows(posRes.data?.data || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  }, [status, userId, q]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPnl = rows.reduce((sum, row) => sum + Number(row.profit || 0), 0);

  return (
    <div className="card pad">
      <div className="toolbar admin-console-toolbar">
        <div className="left">
          <select className="select" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">All Users</option>
            {users.filter((user) => user.role === 'user').map((user) => (
              <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>
            ))}
          </select>
          <div className="tabs">
            {['all', 'open', 'closed'].map((item) => (
              <button key={item} className={`tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item}</button>
            ))}
          </div>
          <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search script" />
        </div>
        <div className="right">
          <span className={`pill ${totalPnl >= 0 ? 'teal' : 'red'}`}>Overall P&L {totalPnl.toFixed(2)}</span>
          <button type="button" className="btn subtle" onClick={load} disabled={loading}><RefreshCw size={16} />Refresh</button>
        </div>
      </div>
      <AdminPositionTable
        rows={rows}
        status={status}
        onReload={load}
        canEdit={role !== 'sub_broker' || permissions.adminPositionsEdit !== false}
        canExit={role !== 'sub_broker' || permissions.adminPositionsExit !== false}
        canReopen={role !== 'sub_broker' || permissions.adminPositionsReopen !== false}
        canDelete={role !== 'sub_broker' || permissions.adminPositionsDelete !== false}
      />
    </div>
  );
}

function UserPositionsModal({ user, onClose }) {
  const [rows, setRows] = useState([]);
  const [statsRows, setStatsRows] = useState([]);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const [res, statsRes] = await Promise.all([
      api.get('/web-admin/positions', { params: { userId: user.id, status, q } }),
      api.get('/web-admin/positions', { params: { userId: user.id, status: 'open' } }),
    ]);
    setRows(res.data?.data || []);
    setStatsRows(statsRes.data?.data || []);
  }, [user.id, status, q]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load user positions'));
  }, [load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load().catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [load]);

  const fallbackAccount = getDisplayAccount(user.accounts);
  const accountRow =
    statsRows.find((row) => row.account_id === fallbackAccount.id) ||
    statsRows[0] ||
    rows.find((row) => row.account_id === fallbackAccount.id) ||
    rows[0] ||
    {};
  const account = {
    ...fallbackAccount,
    balance: accountRow.account_balance ?? fallbackAccount.balance,
    credit: accountRow.account_credit ?? fallbackAccount.credit,
  };
  const openPnl = statsRows.length
    ? statsRows.reduce((sum, row) => sum + Number(row.profit || 0), 0)
    : getAccountTotalDrCr(fallbackAccount);
  const usedMargin = statsRows.length
    ? statsRows.reduce((sum, row) => sum + Number(row.margin || 0), 0)
    : Number(fallbackAccount.dashboard_margin ?? fallbackAccount.margin ?? 0);
  const balance = Number(account.balance || 0);
  const credit = Number(account.credit || 0);
  const equity = balance + credit + openPnl;
  const totalDrCr = equity - balance;
  const freeMargin = equity - usedMargin;
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;
  const settlementBalance = Number(
    accountRow.account_settlement_balance ??
    fallbackAccount.settlement_balance ??
    0
  );

  return (
    <div className="modal-backdrop">
      <div className="modal full-screen-modal">
        <div className="modal-head">
          <strong>Positions - {getUserName(user)}</strong>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="stats-grid compact-stats p-dashboard-grid">
            <Stat label="User" value={user.login_id} />
            <Stat label="Balance" value={formatPlainMoney(balance)} />
            <Stat label="Equity" value={formatPlainMoney(equity)} />
            <Stat label="Total Dr/Cr" value={formatPlainMoney(totalDrCr)} tone={totalDrCr >= 0 ? 'positive-blue' : 'negative'} />
            <Stat label="Free Margin" value={formatPlainMoney(freeMargin)} />
            <Stat label="P&L" value={formatPlainMoney(credit)} tone={credit >= 0 ? 'positive' : 'negative'} />
            <Stat label="Used Margin" value={formatPlainMoney(usedMargin)} />
            <Stat label="Margin Level" value={usedMargin ? `${marginLevel.toFixed(2)}%` : '-'} />
            <Stat label="Settlement Balance" value={formatPlainMoney(settlementBalance)} />
            <Stat label="Floating P&L" value={formatPlainMoney(openPnl)} tone={openPnl >= 0 ? 'positive-blue' : 'negative'} />
          </div>
          <div className="toolbar">
            <div className="left">
              <div className="tabs">
                {['all', 'open', 'closed'].map((item) => (
                  <button key={item} className={`tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item}</button>
                ))}
              </div>
              <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search" />
            </div>
            <div className="right">
              <button type="button" className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
            </div>
          </div>
          <AdminPositionTable rows={rows} status={status} onReload={load} />
        </div>
      </div>
    </div>
  );
}

function AdminPositionTable({ rows, status, onReload, canEdit = true, canExit = true, canReopen = true, canDelete = true }) {
  const [editTrade, setEditTrade] = useState(null);
  const [exitTrade, setExitTrade] = useState(null);

  const deleteTrade = async (trade) => {
    if (!window.confirm(`Delete ${trade.symbol} position?`)) return;
    try {
      await api.delete(`/web-admin/positions/${trade.id}`);
      toast.success('Position deleted');
      onReload();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Delete failed');
    }
  };

  const reopenTrade = async (trade) => {
    if (!window.confirm(`Reopen ${trade.symbol} position?`)) return;
    try {
      await api.post(`/web-admin/positions/${trade.id}/reopen`);
      toast.success('Position reopened');
      onReload();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Reopen failed');
    }
  };

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>User ID</th><th>Order ID</th><th>Type</th><th>Script</th><th>B/S</th><th>Qty</th><th>Entry Time</th><th>Exit Time</th><th>Entry Price</th><th>Exit Price</th><th>Current Price</th><th>Live P&L</th><th>Brokerage</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><strong className="mono">{row.user_login_id || row.user_id}</strong></td>
                <td className="mono">{String(row.id).slice(0, 14)}</td>
                <td>{row.status || status}</td>
                <td><strong>{row.symbol}</strong></td>
                <td><span className={row.trade_type === 'buy' ? 'positive' : 'negative'}>{String(row.trade_type || '').toUpperCase()}</span></td>
                <td>{row.quantity}</td>
                <td>{formatDate(row.open_time)}</td>
                <td>{formatDate(row.close_time)}</td>
                <td>{Number(row.open_price || 0).toFixed(2)}</td>
                <td>{row.close_price ? Number(row.close_price).toFixed(2) : '-'}</td>
                <td>{Number(row.current_price || row.close_price || row.open_price || 0).toFixed(2)}</td>
                <td className={Number(row.profit || 0) >= 0 ? 'positive' : 'negative'}>{Number(row.profit || 0).toFixed(2)}</td>
                <td>{Number(row.brokerage || 0).toFixed(2)}</td>
                <td>
                  <div className="quick-actions">
                    {canEdit && <button className="mini-action blue" onClick={() => setEditTrade(row)}>Edit</button>}
                    {row.status === 'closed' && canReopen ? (
                      <button className="mini-action orange" onClick={() => reopenTrade(row)}>Reopen</button>
                    ) : canExit ? (
                      <button className="mini-action orange" onClick={() => setExitTrade(row)}>Exit</button>
                    ) : (
                      null
                    )}
                    {canDelete && <button className="mini-action red" onClick={() => deleteTrade(row)}>Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan="14">No positions found</td></tr>}
          </tbody>
        </table>
      </div>
      {editTrade && <EditPositionModal trade={editTrade} onClose={() => setEditTrade(null)} onSaved={() => { setEditTrade(null); onReload(); }} />}
      {exitTrade && <ExitPositionModal trade={exitTrade} onClose={() => setExitTrade(null)} onSaved={() => { setExitTrade(null); onReload(); }} />}
    </>
  );
}

function EditPositionModal({ trade, onClose, onSaved }) {
  const [form, setForm] = useState({
    quantity: trade.quantity || '',
    openPrice: trade.open_price || '',
    currentPrice: trade.current_price || trade.open_price || '',
    stopLoss: trade.stop_loss || '',
    takeProfit: trade.take_profit || '',
    openTime: toDateTimeLocal(trade.open_time),
    closeTime: toDateTimeLocal(trade.close_time),
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const qty = Number(form.quantity || 0);
  const entryRate = Number(form.openPrice || 0);
  const exitRate = Number(form.currentPrice || 0);
  const direction = trade.trade_type === 'sell' ? -1 : 1;
  const livePnl = qty && entryRate && exitRate ? (exitRate - entryRate) * direction * qty : 0;
  const save = async () => {
    try {
      await api.patch(`/web-admin/positions/${trade.id}`, form);
      toast.success('Position updated');
      onSaved();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  return (
    <div className="modal-backdrop nested">
      <div className="modal small-modal">
        <div className="modal-head"><strong>Trade Edit</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="meta">{trade.symbol}</div>
          <div className="grid-2">
            {[
              ['quantity', 'Quantity'],
              ['openPrice', 'Entry Rate'],
              ['currentPrice', 'Exit Rate'],
              ['stopLoss', 'Stop Loss'],
              ['takeProfit', 'Take Profit'],
              ['openTime', 'Entry Time'],
              ['closeTime', 'Exit Time'],
            ].map(([key, label]) => (
              <div className="field" key={key}><label>{label}</label><input className="input" type={key.endsWith('Time') ? 'datetime-local' : 'text'} value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>
            ))}
            <div className="field">
              <label>Live P&L</label>
              <input className={`input ${livePnl >= 0 ? 'positive-input' : 'negative-input'}`} readOnly value={livePnl.toFixed(2)} />
            </div>
          </div>
          <div className="grid-2"><button className="btn primary" onClick={save}>Submit</button><button className="btn subtle" onClick={onClose}>Cancel</button></div>
        </div>
      </div>
    </div>
  );
}

function ExitPositionModal({ trade, onClose, onSaved }) {
  const [mode, setMode] = useState('market');
  const [quantity, setQuantity] = useState(trade.quantity || '');
  const [closePrice, setClosePrice] = useState('');

  const close = async () => {
    try {
      await api.post('/web-admin/close-position', {
        tradeId: trade.id,
        closeQuantity: Number(quantity),
        closePrice: mode === 'manual' ? Number(closePrice) : undefined,
      });
      toast.success('Position closed');
      onSaved();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Close failed');
    }
  };

  return (
    <div className="modal-backdrop nested">
      <div className="modal small-modal">
        <div className="modal-head"><strong>Exit Position</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="meta">{trade.symbol} - {String(trade.trade_type).toUpperCase()} x{trade.quantity}</div>
          <div className="tabs modal-tabs">
            <button className={`tab ${mode === 'market' ? 'active' : ''}`} onClick={() => setMode('market')}>Market Price</button>
            <button className={`tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>Manual Price</button>
          </div>
          <div className="field"><label>Quantity</label><input className="input" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div>
          {mode === 'manual' && <div className="field"><label>Close Price</label><input className="input" value={closePrice} onChange={(event) => setClosePrice(event.target.value)} /></div>}
          <button className="btn danger block" onClick={close}>Close Position</button>
        </div>
      </div>
    </div>
  );
}

function BrokerageModal({ user, onClose }) {
  const [rows, setRows] = useState([]);
  const [period, setPeriod] = useState('today');

  const load = useCallback(async () => {
    const res = await api.get('/web-admin/positions', { params: { userId: user.id, status: 'all', limit: 1500 } });
    setRows(res.data?.data || []);
  }, [user.id]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load brokerage'));
  }, [load]);

  const cutoff = getPeriodCutoff(period);
  const filtered = rows.filter((row) => new Date(row.close_time || row.open_time || row.created_at || 0) >= cutoff);
  const total = filtered.reduce((sum, row) => sum + Number(row.brokerage || 0), 0);

  return (
    <div className="modal-backdrop">
      <div className="modal full-screen-modal">
        <div className="modal-head"><strong>Brokerage History - {getUserName(user)}</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="toolbar"><div className="tabs">{['today', 'week', 'month', '3months'].map((item) => <button key={item} className={`tab ${period === item ? 'active' : ''}`} onClick={() => setPeriod(item)}>{item}</button>)}</div><strong>Total Brokerage: {total.toFixed(2)}</strong></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Date & Time</th><th>Description</th><th>Amount</th><th>Balance After</th></tr></thead><tbody>{filtered.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{formatDate(row.close_time || row.open_time)}</td><td>[BROKERAGE] {row.symbol} ({row.trade_type})</td><td className="negative">-{Number(row.brokerage || 0).toFixed(2)}</td><td>{Number(row.account_balance || 0).toFixed(2)}</td></tr>)}{!filtered.length && <tr><td colSpan="5">No brokerage found</td></tr>}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}

function LedgerModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ crdr: 0, remarks: 'Select Type' });
  const account = getDisplayAccount(user.accounts);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amount = Number(form.crdr || 0);
    if (!amount) return toast.error('Enter CRDR amount');
    if (!form.remarks || form.remarks === 'Select Type') return toast.error('Select remarks type');
    setSaving(true);
    try {
      await api.post(`/web-admin/users/${user.id}/add-balance`, {
        accountId: account.id,
        amount,
        note: form.remarks,
        remarks: form.remarks,
      });
      toast.success('Ledger updated');
      onSaved?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Ledger update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal full-screen-modal positions-full-modal">
        <div className="modal-head"><strong>Ledger Update</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="grid-2">
            <div className="field"><label>Username</label><input className="input" readOnly value={user.login_id || ''} /></div>
            <div className="field"><label>CRDR (Credit +ve / Debit -ve)</label><input className="input" value={form.crdr} onChange={(event) => setForm((prev) => ({ ...prev, crdr: event.target.value }))} /></div>
            <div className="field"><label>Deposit Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
            <div className="field"><label>Margin Available</label><input className="input" readOnly value={account.free_margin || 0} /></div>
            <div className="field"><label>Ledger Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
            <div className="field"><label>Remarks</label><select className="select" value={form.remarks} onChange={(event) => setForm((prev) => ({ ...prev, remarks: event.target.value }))}>{['Select Type', 'Register Balance', 'Deposit', 'Withdraw', 'Settlement', 'Adjustment'].map((item) => <option key={item}>{item}</option>)}</select></div>
          </div>
          <button className="btn primary block" onClick={submit} disabled={saving}>{saving ? 'Submitting...' : 'Submit'}</button>
        </div>
      </div>
    </div>
  );
}

function UserUpdateModal({ mode = 'users', user, users = [], brokers = [], onClose, onSaved }) {
  const [tab, setTab] = useState('details');
  const isBrokerUpdate = mode === 'sub_broker' || user.role === 'sub_broker';
  const tabItems = [
    ['details', isBrokerUpdate ? 'Sub Broker Details' : 'User Details'],
    ['segment', 'Segment Settings'],
    ['script', 'Script Settings'],
    ['ledger', 'Ledger Update'],
    ['copy', isBrokerUpdate ? 'Client Transfer' : 'Copy Settings'],
    ['multiple', 'Multiple Settings'],
    ['notifications', 'Notifications'],
    ['delete', isBrokerUpdate ? 'Delete Sub Broker' : 'Delete User'],
  ];

  return (
    <div className="modal-backdrop">
      <div className="modal admin-update-modal">
        <div className="modal-head dark-modal-head">
          <div>
            <strong>{isBrokerUpdate ? 'Update Sub Broker' : 'Update User'} - {getUserName(user)}</strong>
            <div className="meta">{user.login_id} {isBrokerUpdate ? 'broker console controls' : 'client trading controls'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body user-update-shell">
          <div className="settings-menu">
            {tabItems.map(([item, label]) => (
              <button key={item} className={`settings-menu-item ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{label}</button>
            ))}
          </div>
          <div className="settings-content">
            {tab === 'details' && <UserDetailsEditor user={user} users={users} brokers={brokers} isBrokerUpdate={isBrokerUpdate} onSaved={onSaved} />}
            {tab === 'segment' && <SegmentSettingsEditor user={user} isBrokerUpdate={isBrokerUpdate} />}
            {tab === 'script' && <ScriptSettingsEditor user={user} />}
            {tab === 'ledger' && <LedgerUpdateEditor user={user} onSaved={onSaved} />}
            {tab === 'copy' && <CopySettingsEditor user={user} users={users} brokers={brokers} isBrokerUpdate={isBrokerUpdate} onSaved={onSaved} />}
            {tab === 'multiple' && <MultipleSettingsEditor users={users} isBrokerUpdate={isBrokerUpdate} />}
            {tab === 'notifications' && <NotificationEditor user={user} users={users} brokers={brokers} />}
            {tab === 'delete' && <DeleteUserEditor user={user} users={users} isBrokerUpdate={isBrokerUpdate} onSaved={onSaved} onClose={onClose} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserDetailsEditor({ user, users = [], brokers, isBrokerUpdate, onSaved }) {
  const primary = (user.accounts || [])[0] || {};
  const [form, setForm] = useState({
    active: user.is_active !== false,
    brokerId: user.created_by || '',
    leverage: user.leverage || primary.leverage || 30,
    brokerageRate: user.brokerage_rate ?? 0.0006,
    maxSavedAccounts: user.max_saved_accounts ?? 10,
    closingMode: Boolean(user.closing_mode),
    liquidationType: user.liquidation_type === 'illiquidate' ? 'illiquidate' : 'liquidate',
    password: '',
  });

  const saveActive = async () => {
    try {
      await api.patch(`/web-admin/users/${user.id}/active`, { isActive: form.active });
      toast.success('User activation updated');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Activation update failed');
    }
  };

  const saveBroker = async () => {
    try {
      await api.post('/web-admin/assign-broker', { userId: user.id, brokerId: form.brokerId || null });
      toast.success('Broker link updated');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Broker update failed');
    }
  };

  const resetPassword = async () => {
    if (form.password && String(form.password).length < 4) return toast.error('Password must be at least 4 characters');
    try {
      const res = await api.post(`/web-admin/users/${user.id}/reset-password`, form.password ? { newPassword: form.password } : {});
      toast.success(`Password updated${res.data?.data?.tempPassword ? `: ${res.data.data.tempPassword}` : ''}`);
      setForm((prev) => ({ ...prev, password: '' }));
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Password reset failed');
    }
  };

  const saveTradingSettings = async () => {
    try {
      await Promise.all([
        api.patch(`/web-admin/users/${user.id}/leverage`, { leverage: Number(form.leverage) }),
        api.patch(`/web-admin/users/${user.id}/brokerage`, { brokerageRate: Number(form.brokerageRate) }),
        api.patch(`/web-admin/users/${user.id}/max-saved-accounts`, { maxSavedAccounts: Number(form.maxSavedAccounts) }),
        api.patch(`/web-admin/users/${user.id}/closing-mode`, { closingMode: Boolean(form.closingMode) }),
        api.patch(`/web-admin/users/${user.id}/liquidation-mode`, { liquidationType: form.liquidationType }),
      ]);
      toast.success('Trading settings updated');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Settings update failed');
    }
  };

  const deleteDemoAccount = async (account) => {
    if (!window.confirm(`Delete demo account ${account.account_number}?`)) return;
    try {
      await api.delete(`/web-admin/accounts/${account.id}/demo`);
      toast.success('Demo account deleted');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Demo delete failed');
    }
  };

  return (
    <div className="update-grid">
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>{isBrokerUpdate ? 'Sub Broker Settings' : 'User Settings'}</h2><p>Activation, password and role level controls.</p></div></div>
        <div className="field"><label>Username</label><input className="input" readOnly value={getUserName(user)} /></div>
        <div className="field"><label>Login ID</label><input className="input" readOnly value={user.login_id || ''} /></div>
        <label className="row"><span>Activation</span><input type="checkbox" checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} /></label>
        <div className="action-row left-actions"><button className="btn primary" onClick={saveActive}>Save Activation</button></div>
        <div className="field"><label>Current Password</label><input className="input" readOnly value={user.current_password || 'Not stored yet'} /></div>
        <div className="field"><label>New Password</label><input className="input" type="password" placeholder="Enter password or leave blank for temp password" value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} /></div>
        <button className="btn success block" onClick={resetPassword}>Reset Password</button>
      </div>
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>Trading Controls</h2><p>Leverage, brokerage, saved accounts and closing mode.</p></div></div>
        <div className="grid-2 tight-grid">
          <div className="field"><label>Leverage</label><input className="input" value={form.leverage} onChange={(event) => setForm((prev) => ({ ...prev, leverage: event.target.value }))} /></div>
          <div className="field"><label>Brokerage Rate (% of turnover)</label><input className="input" value={form.brokerageRate} onChange={(event) => setForm((prev) => ({ ...prev, brokerageRate: event.target.value }))} /></div>
          <div className="field"><label>Max Saved Accounts</label><input className="input" value={form.maxSavedAccounts} onChange={(event) => setForm((prev) => ({ ...prev, maxSavedAccounts: event.target.value }))} /></div>
          <div className="field"><label>Liquidation Mode</label><select className="select" value={form.liquidationType} onChange={(event) => setForm((prev) => ({ ...prev, liquidationType: event.target.value }))}><option value="liquidate">Liquidate</option><option value="illiquidate">Illiquidate</option></select></div>
          <label className="row"><span>Closing Mode</span><input type="checkbox" checked={form.closingMode} onChange={(event) => setForm((prev) => ({ ...prev, closingMode: event.target.checked }))} /></label>
        </div>
        <button className="btn primary block" onClick={saveTradingSettings}>Save Trading Settings</button>
      </div>
      {!isBrokerUpdate && (
        <div className="admin-dark-panel full-span">
          <div className="section-head"><div><h2>Accounts</h2><p>Manage demo and live account access.</p></div></div>
          <div className="list">
            {(user.accounts || []).map((account) => (
              <div className="row" key={account.id}>
                <div><strong>{account.account_number}</strong><div className="meta">{account.is_demo ? 'Demo' : 'Live'} - Balance {formatMoney(account.balance)}</div></div>
                {account.is_demo && <button className="btn danger" onClick={() => deleteDemoAccount(account)}>Delete Demo</button>}
              </div>
            ))}
            {!(user.accounts || []).length && <div className="empty-state compact-empty"><span>No accounts found</span></div>}
          </div>
        </div>
      )}
      {!isBrokerUpdate && (
        <div className="admin-dark-panel full-span">
          <div className="section-head"><div><h2>Link User To Broker</h2><p>Assign this client under a sub broker or keep direct under admin.</p></div></div>
          <div className="field"><label>Select Broker</label><select className="select" value={form.brokerId} onChange={(event) => setForm((prev) => ({ ...prev, brokerId: event.target.value }))}><option value="">Admin direct</option>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.login_id} - {getUserName(broker)}</option>)}</select></div>
          <button className="btn primary" onClick={saveBroker}>Transfer User</button>
        </div>
      )}
      {isBrokerUpdate && (
        <div className="admin-dark-panel full-span">
          <div className="section-head"><div><h2>Broker Scope</h2><p>Sub broker manages only assigned clients and their positions.</p></div></div>
          <div className="stats-grid compact-stats">
            <Stat label="Role" value="Sub Broker" />
            <Stat label="Clients" value={users.filter((client) => client.created_by === user.id && client.role === 'user').length || 0} />
            <Stat label="Created On" value={formatDate(user.created_at)} />
          </div>
        </div>
      )}
    </div>
  );
}

function LedgerUpdateEditor({ user, onSaved }) {
  const account = (user.accounts || [])[0] || {};
  const [form, setForm] = useState({ crdr: 0, remarks: 'Select Type' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const amount = Number(form.crdr || 0);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/web-admin/action-ledger', {
        params: { scope: 'selected', userId: user.id, limit: 5000 },
      });
      setRows((res.data?.data || []).filter((row) => row.source === 'Transaction'));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Ledger history failed');
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const submit = async () => {
    if (!amount) return toast.error('Enter CRDR amount');
    if (!form.remarks || form.remarks === 'Select Type') return toast.error('Select remarks type');
    try {
      await api.post(`/web-admin/users/${user.id}/add-balance`, {
        accountId: account.id,
        amount,
        note: form.remarks,
        remarks: form.remarks,
      });
      toast.success('Ledger updated');
      setForm((prev) => ({ ...prev, crdr: 0 }));
      await loadRows();
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Ledger update failed');
    }
  };

  return (
    <div className="admin-dark-panel">
      <div className="section-head"><div><h2>Ledger Update</h2><p>Credit positive amount or debit negative amount.</p></div></div>
      <div className="update-grid">
        <div className="field"><label>Username</label><input className="input" readOnly value={user.login_id || ''} /></div>
        <div className="field"><label>CRDR (Credit +ve / Debit -ve)</label><input className="input" value={form.crdr} onChange={(event) => setForm((prev) => ({ ...prev, crdr: event.target.value }))} /></div>
        <div className="field"><label>Deposit Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
        <div className="field"><label>Margin Available</label><input className="input" readOnly value={account.free_margin || 0} /></div>
        <div className="field"><label>Ledger Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
        <div className="field"><label>Pnl (-) Settlement</label><input className="input" readOnly value={account.credit || 0} /></div>
        <div className="field"><label>Margin Used</label><input className="input" readOnly value={account.margin || 0} /></div>
        <div className="field"><label>Remarks</label><select className="select" value={form.remarks} onChange={(event) => setForm((prev) => ({ ...prev, remarks: event.target.value }))}>{['Select Type', 'Register Balance', 'Deposit', 'Withdraw', 'Settlement', 'Adjustment'].map((item) => <option key={item}>{item}</option>)}</select></div>
      </div>
      <button className="btn primary block" onClick={submit}>Submit</button>
      <div className="table-wrap update-table">
        <table>
          <thead><tr><th>Date</th><th>CR/DR</th><th>Amount</th><th>Balance</th><th>Remarks</th><th>Status</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan="6">Loading ledger...</td></tr>}
            {!loading && rows.map((row) => {
              const isDebit = String(row.action || '').includes('WITHDRAW') || Number(row.balanceAfter) < Number(row.balanceBefore);
              const signedAmount = isDebit ? -Math.abs(Number(row.amount || 0)) : Math.abs(Number(row.amount || 0));
              return (
                <tr key={row.id}>
                  <td>{formatDate(row.date)}</td>
                  <td className={isDebit ? 'negative' : 'positive'}>{isDebit ? 'DR' : 'CR'}</td>
                  <td>{signedAmount.toFixed(2)}</td>
                  <td>{row.balanceAfter === null || row.balanceAfter === undefined ? '-' : Number(row.balanceAfter).toFixed(2)}</td>
                  <td>{row.message || row.action}</td>
                  <td>{row.status || '-'}</td>
                </tr>
              );
            })}
            {!loading && !rows.length && <tr><td colSpan="6">No ledger records found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SegmentSettingsEditor({ user }) {
  const segments = ['NSE Index (NSEFUT)', 'NSE Index Options (NSEOPT)', 'MCX Futures (MCXFUT)', 'NSE Futures Options'];
  const fields = ['Intraday Margin %', 'Holding Margin %', 'Brokerage /Cr', 'Max Lots', 'Order Lots'];
  const [settings, setSettings] = useState({});

  useEffect(() => {
    api.get(`/web-admin/users/${user.id}/segment-settings`)
      .then((res) => setSettings(res.data?.data || {}))
      .catch(() => {});
  }, [user.id]);

  const setSegmentValue = (segment, key, value) => {
    setSettings((prev) => ({
      ...prev,
      [segment]: {
        ...(prev[segment] || {}),
        [key]: value,
      },
    }));
  };

  const saveSegment = async (segment) => {
    try {
      const res = await api.post(`/web-admin/users/${user.id}/segment-settings`, {
        segment,
        values: settings[segment] || {},
      });
      toast.success(res.data?.message || 'Segment settings saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Segment settings save failed');
    }
  };

  return (
    <div className="segment-settings">
      {segments.map((segment) => (
        <div className="admin-dark-panel segment-card" key={segment}>
          <div className="section-head"><div><h2>{segment}</h2><p>0 means use global setting.</p></div><button className="btn primary" onClick={() => saveSegment(segment)}>Save</button></div>
          <div className="grid-3">
            {fields.map((label) => <div className="field" key={label}><label>{label}</label><input className="input" value={settings[segment]?.[label] ?? '0'} onChange={(event) => setSegmentValue(segment, label, event.target.value)} /></div>)}
          </div>
          <div className="grid-2"><label className="row"><span>Option Buying Allowed</span><input type="checkbox" checked={settings[segment]?.optionBuyingAllowed !== false} onChange={(event) => setSegmentValue(segment, 'optionBuyingAllowed', event.target.checked)} /></label><label className="row"><span>Option Selling Allowed</span><input type="checkbox" checked={settings[segment]?.optionSellingAllowed === true} onChange={(event) => setSegmentValue(segment, 'optionSellingAllowed', event.target.checked)} /></label></div>
        </div>
      ))}
    </div>
  );
}

function ScriptSettingsEditor({ user }) {
  const [symbols, setSymbols] = useState([]);
  const [symbolSearch, setSymbolSearch] = useState('');
  const filtered = symbols.filter((row) => String(row.symbol || '').toLowerCase().includes(symbolSearch.toLowerCase())).slice(0, 8);

  useEffect(() => {
    loadTradableSymbols({ limit: 5000 }).then(setSymbols).catch(() => {});
  }, []);

  return (
    <div className="admin-dark-panel">
      <div className="section-head"><div><h2>Create New Setting</h2><p>Custom symbol-level rule for {user.login_id}.</p></div></div>
      <div className="update-grid">
        <div className="field"><label>Type Select</label><select className="select" defaultValue="NSE"><option>NSE</option><option>MCX</option><option>NSEOPT</option><option>MCXOPT</option><option>Crypto</option></select></div>
        <div className="field"><label>Symbol ({symbols.length} available)</label><input className="input" placeholder="Search symbol" value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} /></div>
        <div className="field"><label>Type Select</label><select className="select" defaultValue="Value Settings"><option>Value Settings</option><option>Quantity Settings</option><option>Block Settings</option></select></div>
        <div className="field"><label>Select Symbol</label><select className="select">{filtered.map((row) => <option key={row.symbol}>{row.symbol}</option>)}</select></div>
        <div className="field"><label>Per Order Value</label><input className="input" placeholder="Per Order Value" /></div>
        <div className="field"><label>Max Value Holding</label><input className="input" placeholder="Max Value Holding" /></div>
        <div className="field"><label>Fix OPTSELL HO</label><input className="input" defaultValue="0" /></div>
        <div className="field"><label>Fix OPTSELL INT</label><input className="input" defaultValue="0" /></div>
      </div>
      <button className="btn primary block" onClick={() => toast.error('Script settings endpoint is not enabled yet')}>Submit</button>
      <div className="table-wrap update-table">
        <table>
          <thead><tr><th>Symbol</th><th>Max/Order/Min Lot</th><th>Max/Order Qty</th><th>Max/Order Value</th><th>Fix INT/HO</th><th>Per Crore/Lot</th><th>Spread</th><th>Limit Point</th><th>Block</th><th>OPT Block</th></tr></thead>
          <tbody><tr><td colSpan="10">No settings configured yet</td></tr></tbody>
        </table>
      </div>
    </div>
  );
}

function CopySettingsEditor({ user, users, brokers, isBrokerUpdate, onSaved }) {
  const [copyFrom, setCopyFrom] = useState('');
  const [brokerId, setBrokerId] = useState(user.created_by || '');

  const transfer = async () => {
    try {
      await api.post('/web-admin/assign-broker', { userId: user.id, brokerId: brokerId || null });
      toast.success('Broker assignment updated');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Transfer failed');
    }
  };

  return (
    <div className="update-grid">
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>Transfer Settings</h2><p>Copy trading controls from another client.</p></div></div>
        <div className="field"><label>UserId</label><input className="input" readOnly value={user.email || user.login_id || ''} /></div>
        <div className="field"><label>User to Copy From</label><select className="select" value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}><option value="">Select or search a user</option>{users.filter((row) => row.id !== user.id && row.role !== 'admin').map((row) => <option key={row.id} value={row.id}>{row.login_id} - {getUserName(row)}</option>)}</select></div>
        <button className="btn primary block" onClick={() => toast.error('Copy settings endpoint is not enabled yet')}>Copy User</button>
      </div>
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>{isBrokerUpdate ? 'Broker Client Scope' : 'Link User to Broker'}</h2><p>{isBrokerUpdate ? 'Use Sub Broker Management to assign clients under this broker.' : 'Move this client under a selected broker.'}</p></div></div>
        <div className="field"><label>Username</label><input className="input" readOnly value={user.email || user.login_id || ''} /></div>
        {!isBrokerUpdate && <div className="field"><label>Select Broker</label><select className="select" value={brokerId} onChange={(event) => setBrokerId(event.target.value)}><option value="">Admin direct</option>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.login_id} - {getUserName(broker)}</option>)}</select></div>}
        <button className="btn primary block" disabled={isBrokerUpdate} onClick={transfer}>Transfer User</button>
      </div>
    </div>
  );
}

function MultipleSettingsEditor({ users, isBrokerUpdate }) {
  const clientRows = users.filter((row) => isBrokerUpdate ? row.role === 'user' && row.created_by : row.role === 'user');
  return (
    <div className="multiple-settings-grid">
      <div className="admin-dark-panel multiple-main-panel">
        <div className="section-head"><div><h2>Multiple Settings</h2><p>Apply risk settings to multiple users and symbols at once.</p></div></div>
        <div className="risk-settings-grid">
          <div className="field"><label>Ledger Balance Close (%)</label><input className="input" placeholder="Input in %, e.g. 80" /></div>
          <div className="field"><label>Profit Trade Hold Min Seconds</label><input className="input" placeholder="Minimum seconds for profitable trade" /></div>
          <div className="field"><label>Loss Trade Hold Min Seconds</label><input className="input" placeholder="Minimum seconds for losing trade" /></div>
        </div>
      </div>
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>Segment Filter</h2><p>Choose market segments before applying multiple settings.</p></div></div>
        <div className="segment-filter-grid">
          {['Show MCX', 'Show MCXOPTBUY', 'Show MCXOPTSELL', 'Show MCXOPT', 'Show NSE', 'Show IDXNSE', 'Show IDXOPTBUY', 'Show IDXOPTSELL'].map((label) => <button className="btn subtle" key={label}>{label}</button>)}
        </div>
      </div>
      <div className="admin-dark-panel">
        <div className="section-head"><div><h2>Block Limits</h2><p>Limit blocking rules for high-low price conditions.</p></div></div>
        <div className="risk-settings-grid">
          <label className="row"><span>Block Limit Above/Below High Low</span><input type="checkbox" /></label>
          <label className="row"><span>Block Limit Between High Low</span><input type="checkbox" /></label>
        </div>
      </div>
      <div className="admin-dark-panel user-select-panel">
        <div className="section-head"><div><h2>Select Users</h2><p>{clientRows.length} clients available.</p></div><button className="btn subtle">Select All</button></div>
        <input className="input" placeholder="Search Client" />
        <div className="table-wrap update-table user-select-table">
          <table><thead><tr><th>Checkbox</th><th>UserId</th><th>Username</th></tr></thead><tbody>{clientRows.slice(0, 12).map((row) => <tr key={row.id}><td><input type="checkbox" /></td><td className="gold-text">{row.login_id}</td><td>{getUserName(row)}</td></tr>)}{!clientRows.length && <tr><td colSpan="3">No clients found</td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}

function NotificationEditor({ user, users = [], brokers = [] }) {
  const [form, setForm] = useState({ title: '', content: '' });
  const send = async () => {
    if (!form.content.trim()) return toast.error('Enter message content');
    try {
      await api.post('/web-admin/support-messages', {
        userId: user.id,
        title: form.title || 'Trade Axis Support',
        content: form.content,
      });
      toast.success('Message sent');
      setForm({ title: '', content: '' });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Message send failed');
    }
  };

  return (
    <div className="admin-dark-panel">
      <div className="section-head"><div><h2>Send Notification</h2><p>Custom message to selected user.</p></div></div>
      <div className="field"><label>Title</label><input className="input" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} /></div>
      <div className="field"><label>Content</label><textarea className="textarea" value={form.content} onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))} /></div>
      <div className="stats-grid compact-stats">
        <Stat label="Selected" value={`${user.login_id} - ${getUserName(user)}`} />
        <Stat label="Clients" value={users.filter((row) => row.role === 'user').length} />
        <Stat label="Brokers" value={brokers.length} />
      </div>
      <button className="btn primary" onClick={send}>Send Message</button>
    </div>
  );
}

function DeleteUserEditor({ user, users, isBrokerUpdate, onSaved, onClose }) {
  const [confirm, setConfirm] = useState('');
  const rows = isBrokerUpdate ? users.filter((row) => row.role === 'sub_broker') : users.filter((row) => row.role !== 'admin' && row.role !== 'sub_broker');

  const remove = async (target) => {
    if (confirm !== target.login_id) return toast.error(`Type ${target.login_id} to confirm delete`);
    if (!window.confirm(`Delete ${target.login_id}? This cannot be undone.`)) return;
    try {
      await api.delete(`/web-admin/users/${target.id}`);
      toast.success('Deleted');
      onSaved?.();
      if (target.id === user.id) onClose?.();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Delete failed');
    }
  };

  return (
    <div className="admin-dark-panel">
      <div className="section-head"><div><h2>{isBrokerUpdate ? 'Delete Sub Broker' : 'Delete User'}</h2><p>Type the Login ID before deleting. This action cannot be undone.</p></div></div>
      <div className="field"><label>Confirm Login ID</label><input className="input" value={confirm} onChange={(event) => setConfirm(event.target.value.toUpperCase())} placeholder={user.login_id} /></div>
      <div className="delete-list">
        {rows.map((row) => (
          <div className="delete-row" key={row.id}>
            <div><strong>{getUserName(row)}</strong><div className="meta">{row.login_id} {row.email || ''}</div></div>
            <button className="mini-action red" onClick={() => remove(row)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function getPeriodCutoff(period) {
  const date = new Date();
  if (period === 'today') date.setHours(0, 0, 0, 0);
  else if (period === 'week') date.setDate(date.getDate() - 7);
  else if (period === '3months') date.setMonth(date.getMonth() - 3);
  else date.setMonth(date.getMonth() - 1);
  return date;
}

function buildFilteredDealsSummary(deals = [], fallback = {}, selectedAccount = {}) {
  return deals.reduce((summary, deal) => {
    const type = String(deal.type || deal.transaction_type || deal.side || deal.trade_type || '').toLowerCase();
    const description = String(deal.description || deal.remarks || '').toLowerCase();
    const amount = Number(deal.amount ?? deal.profit ?? 0);
    const commission = Number(deal.commission ?? deal.brokerage ?? 0);

    if (type.includes('deposit') || description.includes('deposit')) summary.totalDeposits += Math.abs(amount);
    else if (type.includes('withdraw') || description.includes('withdraw')) summary.totalWithdrawals += Math.abs(amount);
    else if (amount >= 0) summary.totalProfit += amount;
    else summary.totalLoss += Math.abs(amount);

    summary.totalCommission += commission;
    if (description.includes('settlement') || type.includes('settlement')) summary.balanceSettled += amount;
    return summary;
  }, {
    totalProfit: 0,
    totalLoss: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalCommission: 0,
    balanceSettled: Number(fallback?.balanceSettled || 0),
    balance: Number(selectedAccount?.balance ?? fallback?.balance ?? 0),
  });
}

function TransactionsPanel({ type }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('pending');

  const load = useCallback(async () => {
    const res = await api.get('/web-admin/transactions', { params: { type, status } });
    setRows(res.data?.data || []);
  }, [type, status]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load transactions'));
  }, [load]);

  const action = async (id, nextAction) => {
    const adminNote = window.prompt('Admin note', nextAction === 'approve' ? 'Approved from web console' : 'Rejected from web console');
    if (adminNote === null) return;
    try {
      await api.post(`/web-admin/transactions/${id}/action`, { action: nextAction, adminNote });
      toast.success(`Transaction ${nextAction}d`);
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Action failed');
    }
  };

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="tabs">
          {['all', 'pending', 'completed', 'rejected'].map((item) => (
            <button key={item} className={`tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item}</button>
          ))}
        </div>
        <button type="button" className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
      </div>
      <TransactionTable rows={rows} onAction={action} />
    </div>
  );
}

function TransactionTable({ rows, onAction }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Request</th><th>User</th><th>Account</th><th>Amount</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.reference || row.id}</strong><div className="meta">{formatDate(row.created_at)}</div></td>
              <td>{row.user_login_id || row.user_name || row.user_email || '-'}</td>
              <td>{row.account_number || '-'}</td>
              <td>{formatMoney(row.amount)}</td>
              <td><span className={`pill ${row.status === 'completed' ? 'teal' : row.status === 'pending' ? 'gold' : 'red'}`}>{row.status}</span></td>
              <td>
                {onAction && row.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn success" onClick={() => onAction(row.id, 'approve')}><CheckCircle2 size={15} />Approve</button>
                    <button className="btn danger" onClick={() => onAction(row.id, 'reject')}><XCircle size={15} />Reject</button>
                  </div>
                ) : <span className="meta">No action</span>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan="6">No records found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AdminOrdersPanel() {
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('executed');
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [usersRes, ordersRes] = await Promise.all([
        api.get('/web-admin/users'),
        api.get('/web-admin/orders', { params: { status, userId, q } }),
      ]);
      setUsers(usersRes.data?.data || []);
      setRows(ordersRes.data?.data || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to load orders');
    }
  }, [status, userId, q]);

  useEffect(() => {
    load();
  }, [load]);

  const buyCount = rows.filter((row) => String(row.trade_type || row.type || '').toLowerCase() === 'buy').length;
  const sellCount = rows.filter((row) => String(row.trade_type || row.type || '').toLowerCase() === 'sell').length;

  return (
    <div className="card pad">
      <div className="grid-3 compact-stats">
        <Stat label="User" value={userId ? users.find((user) => user.id === userId)?.login_id || 'Selected' : 'All Users'} />
        <Stat label="Buy Trades" value={buyCount} />
        <Stat label="Sell Trades" value={sellCount} />
      </div>
      <div className="toolbar">
        <div className="left">
          <select className="select" value={userId} onChange={(event) => setUserId(event.target.value)}>
            <option value="">All Users</option>
            {users.filter((user) => user.role === 'user').map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}
          </select>
          <div className="tabs">
            {['executed', 'pending', 'rejected'].map((item) => <button key={item} className={`tab ${status === item ? 'active' : ''}`} onClick={() => setStatus(item)}>{item}</button>)}
          </div>
          <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search" />
        </div>
        <button type="button" className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>User ID</th><th>Trade Type</th><th>Time</th><th>Type</th><th>Script</th><th>Quantity</th><th>Rate</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.id}-${row.status}`}><td><strong className="mono">{row.user_login_id || row.user_id}</strong></td><td>{String(row.order_type || 'market').toUpperCase()}</td><td>{formatDate(row.time || row.created_at || row.open_time)}</td><td><span className={String(row.trade_type).toLowerCase() === 'sell' ? 'negative' : 'positive'}>{String(row.trade_type || row.type || '').toUpperCase()}</span></td><td>{row.symbol}</td><td>{row.quantity}</td><td>{Number(row.rate || row.price || row.open_price || 0).toFixed(2)}</td><td>{row.order_status || row.status}</td></tr>)}
            {!rows.length && <tr><td colSpan="8">No orders found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeverageMarginPanel() {
  const groups = ['NSE Index Settings', 'NSE Index Options Settings', 'NSE Future Settings', 'NSE Future Options Settings', 'MCX Settings'];
  const fields = ['Brokerage / Cr', 'Max Lots', 'Order Lots', 'Holding Margin %', 'Intraday Margin %'];
  const [settings, setSettings] = useState({});

  useEffect(() => {
    api.get('/web-admin/leverage-margin-settings')
      .then((res) => setSettings(res.data?.data?.groups || {}))
      .catch(() => {});
  }, []);

  const updateSetting = (group, key, value) => {
    setSettings((prev) => ({
      ...prev,
      [group]: {
        ...(prev[group] || {}),
        [key]: value,
      },
    }));
  };

  const saveAll = async () => {
    try {
      const res = await api.post('/web-admin/leverage-margin-settings', { groups: settings });
      toast.success(res.data?.message || 'Global settings saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Global settings save failed');
    }
  };

  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Leverage & Margin Settings</h2><p>Global margin, brokerage per crore, lot size and option permissions.</p></div><button className="btn primary" onClick={saveAll}>Save All</button></div>
      <div className="segment-settings">
        {groups.map((group) => (
          <div className="card pad" key={group}>
            <h2>{group}</h2>
            <div className="grid-3">
              {fields.map((field) => (
                <div className="field" key={field}><label>{field}</label><input className="input" value={settings[group]?.[field] ?? (field.includes('Brokerage') ? 6000 : 30)} onChange={(event) => updateSetting(group, field, event.target.value)} /></div>
              ))}
            </div>
            <div className="grid-2"><label className="row"><span>Option Buying Allowed</span><input type="checkbox" checked={settings[group]?.optionBuyingAllowed !== false} onChange={(event) => updateSetting(group, 'optionBuyingAllowed', event.target.checked)} /></label><label className="row"><span>Option Selling Allowed</span><input type="checkbox" checked={settings[group]?.optionSellingAllowed === true} onChange={(event) => updateSetting(group, 'optionSellingAllowed', event.target.checked)} /></label></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutoClosePanel() {
  const [globalClose, setGlobalClose] = useState(90);
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [userPercents, setUserPercents] = useState({});
  const [applyAll, setApplyAll] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/web-admin/users'),
      api.get('/web-admin/auto-close-settings'),
    ]).then(([usersRes, settingsRes]) => {
      setUsers((usersRes.data?.data || []).filter((user) => user.role === 'user'));
      const settings = settingsRes.data?.data || {};
      setGlobalClose(settings.percent ?? 90);
      setApplyAll(settings.applyAll !== false);
      const savedIds = Array.isArray(settings.userIds)
        ? settings.userIds
        : Array.isArray(settings.selectedUserIds)
          ? settings.selectedUserIds
          : settings.userId
            ? [settings.userId]
            : [];
      setSelectedUserIds(savedIds);
      setUserId(savedIds[0] || settings.userId || '');
      const savedPercents = {};
      (settings.userSettings || []).forEach((item) => {
        if (item.userId) savedPercents[item.userId] = item.percent ?? settings.percent ?? 90;
      });
      savedIds.forEach((id) => {
        if (savedPercents[id] === undefined) savedPercents[id] = settings.percent ?? 90;
      });
      setUserPercents(savedPercents);
    }).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const ids = applyAll ? [] : selectedUserIds;
      if (!applyAll && !ids.length) return toast.error('Select at least one user');
      const userSettings = ids.map((id) => ({ userId: id, percent: Number(userPercents[id] || globalClose) }));
      const res = await api.post('/web-admin/auto-close-settings', {
        percent: Number(globalClose),
        applyAll,
        userId: ids[0] || '',
        userIds: ids,
        selectedUserIds: ids,
        userSettings,
      });
      toast.success(res.data?.message || 'Auto close settings saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Auto close save failed');
    }
  };

  const selectedUsers = users.filter((user) => selectedUserIds.includes(user.id));
  const selectUsers = (event) => {
    const ids = Array.from(event.target.selectedOptions).map((option) => option.value);
    setSelectedUserIds(ids);
    setUserId(ids[0] || '');
    setUserPercents((prev) => {
      const next = {};
      ids.forEach((id) => {
        next[id] = prev[id] ?? globalClose;
      });
      return next;
    });
  };

  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Auto Close Settings</h2><p>Liquidate or illiquidate accounts when ledger loss reaches configured percentage.</p></div></div>
      <div className="card pad">
        <div className="field"><label>Ledger Balance Close (%)</label><input className="input" value={globalClose} onChange={(event) => setGlobalClose(event.target.value)} /></div>
        <div className="grid-2">
          <label className="row"><span>Apply to all users</span><input type="checkbox" checked={applyAll} onChange={(event) => setApplyAll(event.target.checked)} /></label>
          <div className="field">
            <label>Select Multiple Users</label>
            <select className="select multi-select" multiple value={selectedUserIds} disabled={applyAll} onChange={selectUsers}>
              {users.map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}
            </select>
          </div>
        </div>
        <button className="btn primary" onClick={save}>{applyAll ? 'Apply to All Users' : 'Apply to Selected Users'}</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>User ID</th><th>Name</th><th>Auto Close %</th><th>Mode</th><th>Action</th></tr></thead>
          <tbody>
            {applyAll && <tr><td colSpan="5">All users will use {Number(globalClose || 0)}% auto close.</td></tr>}
            {!applyAll && selectedUsers.map((user) => (
              <tr key={user.id}>
                <td><strong className="mono">{user.login_id}</strong></td>
                <td>{getUserName(user)}</td>
                <td><input className="input compact-number" value={userPercents[user.id] ?? globalClose} onChange={(event) => setUserPercents((prev) => ({ ...prev, [user.id]: event.target.value }))} /></td>
                <td>Selected User</td>
                <td><button className="btn subtle" onClick={() => setSelectedUserIds((prev) => prev.filter((id) => id !== user.id))}>Remove</button></td>
              </tr>
            ))}
            {!applyAll && !selectedUsers.length && <tr><td colSpan="5">Select one or more users above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const safeFilePart = (value) => String(value || 'trade-axis').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

const downloadBlob = (content, filename, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const getLedgerExportRows = (rows = []) =>
  rows.map((row) => {
    const amount = Number(row.amount || 0);
    const brokerage = Number(row.brokerage || row.commission || 0);
    const debit = amount < 0 ? Math.abs(amount) : 0;
    const credit = amount > 0 ? amount : 0;
    return {
      frDate: formatDate(row.from_date || row.date || row.created_at || row.updated_at),
      toDate: formatDate(row.to_date || row.processed_at || row.date || row.updated_at || row.created_at),
      tradeDate: formatDate(row.date || row.created_at || row.updated_at),
      id: row.user_login_id || row.user_id || '-',
      name: row.user_name || '-',
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      brokerage: brokerage.toFixed(2),
      netAmount: (credit - debit - brokerage).toFixed(2),
      remarks: row.message || row.action || row.status || '-',
      date: formatDate(row.date || row.created_at || row.updated_at),
      userId: row.user_login_id || row.user_id || '-',
      userName: row.user_name || '-',
      account: row.account_number || '-',
      source: row.source || '-',
      action: row.action || '-',
      amount: amount.toFixed(2),
      status: row.status || '-',
      message: row.message || '-',
    };
  });

const exportLedgerExcel = (rows, label) => {
  const exportRows = getLedgerExportRows(rows);
  const columns = [
    ['FR DATE', 'frDate', 120],
    ['TO DATE', 'toDate', 120],
    ['TR DATE', 'tradeDate', 120],
    ['ID', 'id', 90],
    ['NAME', 'name', 150],
    ['DEBIT', 'debit', 95],
    ['CREDIT', 'credit', 95],
    ['BROKERAGE', 'brokerage', 95],
    ['NET AMT', 'netAmount', 95],
    ['REMARKS', 'remarks', 360],
  ];
  const totalDebit = exportRows.reduce((sum, row) => sum + Number(row.debit || 0), 0).toFixed(2);
  const totalCredit = exportRows.reduce((sum, row) => sum + Number(row.credit || 0), 0).toFixed(2);
  const totalBrokerage = exportRows.reduce((sum, row) => sum + Number(row.brokerage || 0), 0).toFixed(2);
  const totalNet = exportRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0).toFixed(2);
  const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
    body{font-family:Arial,sans-serif;color:#172033;background:#fff}
    h1{margin:0;color:#10213f;font-size:22px}
    .sub{margin:6px 0 16px;color:#657083;font-size:12px}
    .summary td{border:0;padding:6px 14px 10px 0;font-weight:700}
    table.report{border-collapse:collapse;width:100%;table-layout:fixed}
    .report th,.report td{border:1px solid #cdd6e4;padding:8px;text-align:left;font-size:12px;vertical-align:top;white-space:normal}
    .report th{background:#10213f;color:#fff;font-weight:700}
    .report tr:nth-child(even) td{background:#f6f8fb}
    .amount-pos{color:#2457d6;font-weight:700;mso-number-format:"0.00"}
    .amount-neg{color:#b4232f;font-weight:700;mso-number-format:"0.00"}
    .status{font-weight:700}
  </style></head><body>
    <h1>Trade Axis Action Ledger</h1>
    <div class="sub">${escapeHtml(label)} &nbsp; | &nbsp; Generated: ${escapeHtml(formatDate(new Date()))}</div>
    <table class="summary"><tr><td>Total Rows: ${exportRows.length}</td><td>Debit: ${escapeHtml(totalDebit)}</td><td>Credit: ${escapeHtml(totalCredit)}</td><td>Brokerage: ${escapeHtml(totalBrokerage)}</td><td>Net: ${escapeHtml(totalNet)}</td></tr></table>
    <table class="report">
      <colgroup>${columns.map(([, , width]) => `<col style="width:${width}px" />`).join('')}</colgroup>
      <thead><tr>${columns.map(([header]) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${exportRows.map((row) => `<tr>${columns.map(([, key]) => {
        const value = row[key];
        if (['debit', 'credit', 'brokerage', 'netAmount', 'amount'].includes(key)) {
          const isDebit = key === 'debit' || (key === 'netAmount' && Number(value) < 0);
          return `<td class="${isDebit ? 'amount-neg' : 'amount-pos'}">${escapeHtml(value)}</td>`;
        }
        if (key === 'status') return `<td class="status">${escapeHtml(value)}</td>`;
        return `<td>${escapeHtml(value)}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
    </table>
  </body></html>`;
  downloadBlob(html, `trade-axis-action-ledger-${safeFilePart(label)}.xls`, 'application/vnd.ms-excel;charset=utf-8');
};

const escapePdfText = (value) => String(value ?? '').replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, ' ');

const splitText = (value, maxChars, maxLines = 2) => {
  const words = String(value ?? '-').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  if (!lines.length) lines.push('-');
  const limited = lines.slice(0, maxLines);
  if (lines.length > maxLines) limited[maxLines - 1] = `${limited[maxLines - 1].slice(0, Math.max(0, maxChars - 3))}...`;
  return limited;
};

const pdfText = (text, x, y, size = 8, font = 'F1', color = '0.09 0.13 0.20') =>
  `${color} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;

const pdfRect = (x, y, width, height, fill = '1 1 1', stroke = '0.80 0.84 0.89') =>
  `${fill} rg ${x} ${y} ${width} ${height} re f ${stroke} RG ${x} ${y} ${width} ${height} re S`;

const buildPdfPageStream = ({ pageRows, pageNumber, pageCount, label, generatedAt, totalRows, totalAmount }) => {
  const columns = [
    { key: 'frDate', label: 'FR DATE', x: 28, width: 76, max: 12 },
    { key: 'toDate', label: 'TO DATE', x: 104, width: 76, max: 12 },
    { key: 'id', label: 'ID', x: 180, width: 62, max: 10 },
    { key: 'name', label: 'NAME', x: 242, width: 92, max: 15 },
    { key: 'debit', label: 'DEBIT', x: 334, width: 72, max: 11 },
    { key: 'credit', label: 'CREDIT', x: 406, width: 72, max: 11 },
    { key: 'brokerage', label: 'BROKERAGE', x: 478, width: 76, max: 11 },
    { key: 'netAmount', label: 'NET AMT', x: 554, width: 76, max: 11 },
    { key: 'remarks', label: 'REMARKS', x: 630, width: 184, max: 32 },
  ];

  const commands = [
    pdfRect(0, 0, 842, 595, '1 1 1', '1 1 1'),
    pdfText('Trade Axis Action Ledger', 28, 562, 16, 'F2', '0.06 0.13 0.25'),
    pdfText(label, 28, 544, 8, 'F1', '0.34 0.40 0.50'),
    pdfText(`Generated: ${generatedAt}`, 28, 531, 8, 'F1', '0.34 0.40 0.50'),
    pdfText(`Rows: ${totalRows}`, 660, 562, 9, 'F2', '0.06 0.13 0.25'),
    pdfText(`Total Amount: ${totalAmount}`, 660, 546, 9, 'F2', Number(totalAmount) >= 0 ? '0.14 0.34 0.84' : '0.71 0.14 0.18'),
    pdfRect(28, 502, 786, 22, '0.06 0.13 0.25', '0.06 0.13 0.25'),
  ];

  columns.forEach((column) => {
    commands.push(pdfText(column.label, column.x + 5, 510, 7, 'F2', '1 1 1'));
  });

  let y = 470;
  pageRows.forEach((row, index) => {
    const fill = index % 2 === 0 ? '0.98 0.99 1' : '0.94 0.96 0.99';
    commands.push(pdfRect(28, y - 7, 786, 32, fill, '0.80 0.84 0.89'));
    columns.forEach((column) => {
      const value = row[column.key];
      const color = ['debit', 'credit', 'brokerage', 'netAmount'].includes(column.key)
        ? ((column.key !== 'debit' && Number(value) >= 0) ? '0.14 0.34 0.84' : '0.71 0.14 0.18')
        : '0.09 0.13 0.20';
      splitText(value, column.max, column.key === 'remarks' ? 2 : 1).forEach((line, lineIndex) => {
        commands.push(pdfText(line, column.x + 5, y + 10 - (lineIndex * 10), 7, ['debit', 'credit', 'brokerage', 'netAmount'].includes(column.key) ? 'F2' : 'F1', color));
      });
    });
    y -= 32;
  });

  commands.push(pdfText(`Page ${pageNumber} of ${pageCount}`, 760, 24, 8, 'F1', '0.34 0.40 0.50'));
  return commands.join('\n');
};

const exportLedgerPdf = (rows, label) => {
  const exportRows = getLedgerExportRows(rows);
  const generatedAt = formatDate(new Date());
  const totalAmount = exportRows.reduce((sum, row) => sum + Number(row.netAmount || 0), 0).toFixed(2);
  const pages = [];
  const rowsPerPage = 13;
  const sourceRows = exportRows.length ? exportRows : [{ frDate: '-', toDate: '-', id: '-', name: '-', debit: '0.00', credit: '0.00', brokerage: '0.00', netAmount: '0.00', remarks: 'No ledger rows found for this filter.' }];
  for (let i = 0; i < sourceRows.length; i += rowsPerPage) pages.push(sourceRows.slice(i, i + rowsPerPage));
  const objects = [];
  const addObject = (id, body) => objects.push({ id, body });
  const fontId = 3;
  const boldFontId = 4;
  const pageIds = pages.map((_, index) => 4 + index);
  const contentIds = pages.map((_, index) => 4 + pages.length + index);

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObject(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  addObject(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  addObject(boldFontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  pages.forEach((pageRows, index) => {
    const stream = buildPdfPageStream({
      pageRows,
      pageNumber: index + 1,
      pageCount: pages.length,
      label,
      generatedAt,
      totalRows: exportRows.length,
      totalAmount,
    });
    addObject(pageIds[index], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`);
    addObject(contentIds[index], `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const ordered = objects.sort((a, b) => a.id - b.id);
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  ordered.forEach((object) => {
    offsets[object.id] = pdf.length;
    pdf += `${object.id} 0 obj\n${object.body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  const maxId = Math.max(...ordered.map((object) => object.id));
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  downloadBlob(pdf, `trade-axis-action-ledger-${safeFilePart(label)}.pdf`, 'application/pdf');
};

function ActionLedgerPanel() {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: today, to: today, scope: 'all', userId: '' });
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await api.get('/web-admin/users', { params: { role: 'user', limit: 2000 } });
    setUsers(res.data?.data || []);
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/web-admin/action-ledger', { params: filters });
      const nextRows = res.data?.data || [];
      setRows(nextRows);
      return nextRows;
    } catch (error) {
      toast.error(error.response?.data?.message || 'Action ledger failed');
      return [];
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadUsers().catch(() => {});
  }, [loadUsers]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const update = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const label = `${filters.scope === 'all' ? 'All Users' : filters.scope === 'own' ? 'Own Account' : (users.find((user) => user.id === filters.userId)?.login_id || 'Selected User')} ${filters.from || 'start'} to ${filters.to || 'today'}`;
  const exportRows = async (format) => {
    const currentRows = rows.length ? rows : await fetchRows();
    if (!currentRows.length) return toast.error('No rows available for this filter');
    if (format === 'pdf') exportLedgerPdf(currentRows, label);
    else exportLedgerExcel(currentRows, label);
  };

  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Action Logs</h2><p>Admin action ledger with date, user, actor and message.</p></div></div>
      <div className="toolbar admin-console-toolbar">
        <input className="input" type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} />
        <input className="input" type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} />
        <select className="select" value={filters.scope} onChange={(event) => update('scope', event.target.value)}>
          <option value="all">All users ledger</option>
          <option value="own">Own account ledger</option>
          <option value="selected">Select users</option>
        </select>
        {filters.scope === 'selected' && (
          <select className="select" value={filters.userId} onChange={(event) => update('userId', event.target.value)}>
            <option value="">Select user</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}
          </select>
        )}
        <button type="button" className="btn primary" onClick={fetchRows} disabled={loading}><RefreshCw size={16} />Fetch Date</button>
        <button className="btn subtle" onClick={() => exportRows('pdf')} disabled={loading}><FileText size={16} />Export PDF</button>
        <button className="btn success" onClick={() => exportRows('excel')} disabled={loading}><FileSpreadsheet size={16} />Export Excel</button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>User ID</th><th>User</th><th>Account</th><th>Source</th><th>Action</th><th>Amount</th><th>Status</th><th>Message</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.user_login_id || row.user_id || '-'}</td><td>{row.user_name || '-'}</td><td>{row.account_number || '-'}</td><td>{row.source}</td><td>{row.action}</td><td className={Number(row.amount || 0) >= 0 ? 'positive-blue' : 'negative'}>{Number(row.amount || 0).toFixed(2)}</td><td>{row.status}</td><td>{row.message}</td></tr>)}{!rows.length && <tr><td colSpan="9">{loading ? 'Loading action ledger...' : 'No ledger rows found'}</td></tr>}</tbody></table></div>
    </div>
  );
}

function CustomerSupportPanel() {
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [sendToAll, setSendToAll] = useState(false);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [msgRes, userRes] = await Promise.all([
        api.get('/web-admin/support-messages'),
        api.get('/web-admin/users'),
      ]);
      setMessages(msgRes.data?.data || []);
      const userRows = userRes.data?.data || userRes.data?.users || [];
      setUsers(userRows);
      setSelectedUserId((prev) => prev || userRows[0]?.id || '');
    } catch {
      toast.error('Failed to load support');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    if (!sendToAll && !selectedUserId) return toast.error('Select user');
    if (!content.trim()) return toast.error('Enter message');
    setLoading(true);
    try {
      if (sendToAll) {
        await api.post('/web-admin/support-messages/broadcast', { title: 'Trade Axis Support', content });
      } else {
        await api.post('/web-admin/support-messages', { userId: selectedUserId, title: 'Trade Axis Support', content });
      }
      setContent('');
      toast.success('Message sent');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Message failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="support-shell card">
      <div className="support-list">
        <div className="section-head"><div><h2>Support Inbox</h2><p>{messages.length} messages</p></div></div>
        <div className="support-message-list">
          {messages.map((row) => (
            <button key={row.id} className={`support-message-item ${row.sender_role === 'user' ? 'needs-reply' : ''}`} onClick={() => setSelectedUserId(row.user_id)}>
              <strong>{row.user_login_id || row.user_name || 'User'}</strong>
              <span>{row.content}</span>
              <small>{formatDate(row.created_at)}</small>
            </button>
          ))}
          {!messages.length && <div className="empty-state"><MessageSquare size={34} /><span>No support messages yet</span></div>}
        </div>
      </div>
      <div className="support-thread">
        <div className="section-head"><div><h2>Send Message</h2><p>Reply to a selected user or send a support update.</p></div></div>
        <label className="row"><span>Send to all users</span><input type="checkbox" checked={sendToAll} onChange={(event) => setSendToAll(event.target.checked)} /></label>
        <div className="field">
          <label>User</label>
          <select className="select" value={selectedUserId} disabled={sendToAll} onChange={(event) => setSelectedUserId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{getUserName(user)} - {user.login_id || user.email}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Message</label>
          <textarea className="input textarea" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write support response" />
        </div>
        <button className="btn primary" onClick={send} disabled={loading}><Send size={16} />Send Message</button>
      </div>
    </div>
  );
}

function QrDepositsPanel() {
  const [settings, setSettings] = useState({ enabled: false, qrImage: '', upiId: '', accountName: '', bankName: '', accountNumber: '', ifscCode: '', instructions: '' });

  const load = async () => {
    const res = await api.get('/web-admin/qr-settings');
    setSettings(res.data?.data || settings);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const save = async () => {
    try {
      await api.post('/web-admin/qr-settings', settings);
      toast.success('QR settings saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Save failed');
    }
  };

  const uploadQr = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSettings((prev) => ({ ...prev, qrImage: reader.result || '' }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid-2">
      <div className="card pad">
        <div className="section-head">
          <div><h2>QR Settings</h2><p>Shown to users during QR deposit.</p></div>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
        <label className="row" style={{ marginBottom: 12 }}>
          <span>Enable QR deposit</span>
          <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings((prev) => ({ ...prev, enabled: event.target.checked }))} />
        </label>
        <div className="field">
          <label>QR Image</label>
          <input className="input" type="file" accept="image/*" onChange={(event) => uploadQr(event.target.files?.[0])} />
          {settings.qrImage && <img className="qr-preview" src={settings.qrImage} alt="QR preview" />}
        </div>
        {['upiId', 'accountName', 'bankName', 'accountNumber', 'ifscCode'].map((key) => (
          <div className="field" key={key}>
            <label>{key}</label>
            <input className="input" value={settings[key] || ''} onChange={(event) => setSettings((prev) => ({ ...prev, [key]: event.target.value }))} />
          </div>
        ))}
        <div className="field"><label>Instructions</label><textarea className="textarea" value={settings.instructions || ''} onChange={(event) => setSettings((prev) => ({ ...prev, instructions: event.target.value }))} /></div>
      </div>
      <TransactionsPanel type="deposit" />
    </div>
  );
}

function SettlementPanel() {
  const [status, setStatus] = useState(null);

  const load = async () => {
    const res = await api.get('/web-admin/settlement-status');
    setStatus(res.data || {});
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const run = async () => {
    if (!window.confirm('Run weekly settlement now?')) return;
    try {
      const res = await api.post('/web-admin/trigger-settlement');
      toast.success(res.data?.message || 'Settlement completed');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Settlement failed');
    }
  };

  return (
    <div className="card pad">
      <div className="section-head">
        <div><h2>Weekly Settlement</h2><p>Manual fallback for the automatic settlement job.</p></div>
        <button className="btn primary" onClick={run}>Run Settlement</button>
      </div>
      <div className="grid-3">
        <Stat label="Last Run" value={formatDate(status?.lastRun)} />
        <Stat label="Next Scheduled" value={formatDate(status?.nextScheduled)} />
        <Stat label="Timezone" value={status?.timezone || 'Asia/Kolkata'} />
      </div>
    </div>
  );
}

function MarketHolidayPanel() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    message: '',
    date: '',
    segments: { nseBseClosed: true, mcxClosed: true, mcxMorningOnly: false },
  });

  const load = async () => {
    const res = await api.get('/web-admin/market-holiday');
    const data = res.data?.data || {};
    setStatus(data);
    setForm({
      message: data.message || '',
      date: data.date || '',
      segments: {
        nseBseClosed: data.segments?.nseBseClosed !== false,
        mcxClosed: data.segments?.mcxClosed !== false,
        mcxMorningOnly: !!data.segments?.mcxMorningOnly,
      },
    });
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const save = async (enabled) => {
    try {
      const res = await api.post('/web-admin/market-holiday', { isHoliday: enabled, ...form });
      toast.success(res.data?.message || 'Updated');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  return (
    <div className="card pad">
      <div className="section-head">
        <div><h2>Market Holiday</h2><p>Disable trading globally during holiday or emergency closure.</p></div>
        <span className={`pill ${status?.isHoliday ? 'red' : 'teal'}`}>{status?.isHoliday ? 'Holiday Active' : 'Market Normal'}</span>
      </div>
      <div className="grid-2">
        <div className="field"><label>Message</label><input className="input" value={form.message} onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))} /></div>
        <div className="field"><label>Date</label><input className="input" type="date" value={form.date || ''} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} /></div>
      </div>
      <div className="holiday-segment-grid">
        <label className="row"><span>NSE/BSE Full Close</span><input type="checkbox" checked={form.segments.nseBseClosed} onChange={(event) => setForm((prev) => ({ ...prev, segments: { ...prev.segments, nseBseClosed: event.target.checked } }))} /></label>
        <label className="row"><span>MCX Closed</span><input type="checkbox" checked={form.segments.mcxClosed} onChange={(event) => setForm((prev) => ({ ...prev, segments: { ...prev.segments, mcxClosed: event.target.checked } }))} /></label>
        <label className="row"><span>MCX Morning Only</span><input type="checkbox" checked={form.segments.mcxMorningOnly} onChange={(event) => setForm((prev) => ({ ...prev, segments: { ...prev.segments, mcxMorningOnly: event.target.checked } }))} /></label>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn danger" onClick={() => save(true)}>Enable Holiday</button>
        <button className="btn success" onClick={() => save(false)}>Disable Holiday</button>
      </div>
    </div>
  );
}

function ManualClosePanel() {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [positions, setPositions] = useState([]);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState({ closePrice: '', reason: '' });

  useEffect(() => {
    api.get('/web-admin/users').then((res) => setUsers(res.data?.data || [])).catch(() => {});
  }, []);

  const loadPositions = async () => {
    const res = await api.get('/web-admin/open-positions', { params: { userId } });
    setPositions(res.data?.data || []);
  };

  useEffect(() => {
    if (userId) loadPositions().catch(() => {});
  }, [userId]);

  const close = async () => {
    if (!selected) return toast.error('Select a position first');
    try {
      const res = await api.post('/web-admin/close-position', { tradeId: selected, closePrice: Number(form.closePrice || 0) || undefined, reason: form.reason });
      toast.success(res.data?.message || 'Position closed');
      setSelected('');
      loadPositions();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Close failed');
    }
  };

  return (
    <div className="grid-2">
      <div className="card pad">
        <div className="field"><label>Select User</label><select className="select" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">Select user</option>{users.filter((u) => u.role === 'user').map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}</select></div>
        <div className="list">
          {positions.map((position) => (
            <button className={`row clickable ${selected === position.id ? 'active' : ''}`} key={position.id} onClick={() => setSelected(position.id)}>
              <div><strong>{position.symbol}</strong><div className="meta">{position.trade_type} x {position.quantity} at {Number(position.open_price).toFixed(2)}</div></div>
              <span className={Number(position.profit) >= 0 ? 'positive' : 'negative'}>{formatMoney(position.profit)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>Close Details</h2><p>Close selected position with optional manual price.</p></div></div>
        <div className="field"><label>Selected Trade ID</label><input className="input mono" value={selected} onChange={(event) => setSelected(event.target.value)} /></div>
        <div className="field"><label>Manual Close Price</label><input className="input" value={form.closePrice} onChange={(event) => setForm((prev) => ({ ...prev, closePrice: event.target.value }))} /></div>
        <div className="field"><label>Reason</label><input className="input" value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} /></div>
        <button className="btn danger" onClick={close}>Close Selected Position</button>
      </div>
    </div>
  );
}

function ScriptBanPanel() {
  const [symbols, setSymbols] = useState([]);
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('unbanned');

  const load = async () => {
    const res = await api.get('/web-admin/symbols', { params: { limit: 20000 } });
    setSymbols(res.data?.symbols || res.data?.data || []);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const toggle = async (symbol) => {
    const next = !symbol.is_banned;
    try {
      await api.post('/web-admin/symbol-ban', { symbol: symbol.symbol, isBanned: next, reason });
      toast.success(next ? 'Script banned' : 'Script unbanned');
      setReason('');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  const rows = symbols
    .filter((s) => (tab === 'banned' ? s.is_banned : !s.is_banned))
    .filter((s) => {
      const term = q.toLowerCase();
      return String(s.symbol || '').toLowerCase().includes(term)
        || String(s.display_name || '').toLowerCase().includes(term)
        || String(s.underlying || '').toLowerCase().includes(term);
    });

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div className="tabs">
            <button className={`tab ${tab === 'unbanned' ? 'active' : ''}`} onClick={() => setTab('unbanned')}>Unbanned Scripts</button>
            <button className={`tab ${tab === 'banned' ? 'active' : ''}`} onClick={() => setTab('banned')}>Banned Scripts</button>
          </div>
          <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search script" style={{ maxWidth: 320 }} />
        </div>
        {tab === 'unbanned' && <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ban reason optional" style={{ maxWidth: 420 }} />}
      </div>
      <div className="list">
        {rows.map((symbol) => (
          <div className="row" key={symbol.symbol}>
            <div><strong>{symbol.symbol}</strong><div className="meta">{symbol.display_name} {symbol.ban_reason ? `- ${symbol.ban_reason}` : ''}</div></div>
            <button className={`btn ${symbol.is_banned ? 'success' : 'danger'}`} onClick={() => toggle(symbol)}>{symbol.is_banned ? 'Unban' : 'Ban'}</button>
          </div>
        ))}
        {!rows.length && (
          <div className="row">
            <div><strong>No {tab === 'banned' ? 'banned' : 'unbanned'} scripts found</strong><div className="meta">Refresh after changing a script status.</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function KiteSetupPanel() {
  const [status, setStatus] = useState(null);
  const [loginUrl, setLoginUrl] = useState('');
  const [requestToken, setRequestToken] = useState('');

  const load = async () => {
    const res = await api.get('/web-admin/kite/status');
    setStatus(res.data || {});
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const getLogin = async () => {
    const res = await api.get('/web-admin/kite/login-url');
    setLoginUrl(res.data?.loginUrl || '');
  };

  const setToken = async () => {
    try {
      await api.post('/web-admin/kite/create-session', { requestToken });
      toast.success('Kite session created');
      setRequestToken('');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Token failed');
    }
  };

  const runKiteAction = async (path, successMessage) => {
    try {
      const res = await api.post(path);
      toast.success(res.data?.message || successMessage);
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Kite action failed');
    }
  };

  return (
    <div className="grid-2">
      <div className="card pad">
        <div className="grid-2">
          <Stat label="API Configured" value={status?.configured ? 'Yes' : 'No'} />
          <Stat label="Session Ready" value={status?.sessionReady ? 'Yes' : 'No'} />
          <Stat label="Stream" value={status?.stream?.running ? 'Running' : 'Stopped'} />
          <Stat label="Tokens" value={status?.stream?.tokenCount || 0} />
        </div>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>Daily Setup</h2><p>Generate login URL and enter request token.</p></div></div>
        <button className="btn primary" onClick={getLogin}>Get Login URL</button>
        {loginUrl && <textarea className="textarea mono" readOnly value={loginUrl} style={{ marginTop: 12 }} />}
        <div className="field" style={{ marginTop: 12 }}><label>Request Token</label><input className="input" value={requestToken} onChange={(event) => setRequestToken(event.target.value)} /></div>
        <button className="btn success" onClick={setToken}>Set Token</button>
        <div className="kite-action-grid">
          <button className="btn primary" onClick={() => runKiteAction('/web-admin/kite/start-stream', 'Stream started')}>Start Stream</button>
          <button className="btn subtle" onClick={() => runKiteAction('/web-admin/kite/stop-stream', 'Stream stopped')}>Stop Stream</button>
          <button className="btn success" onClick={() => runKiteAction('/web-admin/kite/sync-symbols', 'Symbols synced')}>Sync Symbols</button>
        </div>
      </div>
    </div>
  );
}

function TradeOnBehalfPanel() {
  const [users, setUsers] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [form, setForm] = useState({
    userId: '',
    accountId: '',
    symbol: '',
    side: 'buy',
    quantity: 1,
    openPrice: '',
    stopLoss: '',
    takeProfit: '',
    entryTime: '',
    exitPrice: '',
    exitTime: '',
    includeEntryBrokerage: true,
    includeExitBrokerage: true,
  });

  useEffect(() => {
    Promise.all([
      api.get('/web-admin/users'),
      api.get('/web-admin/symbols', { params: { limit: 20000, active: 'true', banned: 'false' } }),
    ]).then(([usersRes, symbolsRes]) => {
      const nextUsers = usersRes.data?.data || [];
      const nextSymbols = dedupeTradableSymbols(filterTradableSymbols(symbolsRes.data?.symbols || symbolsRes.data?.data || []));
      setUsers(nextUsers);
      setSymbols(nextSymbols);
      setForm((prev) => ({ ...prev, userId: nextUsers.find((u) => u.role === 'user')?.id || '', symbol: nextSymbols[0]?.symbol || '' }));
    }).catch(() => {});
  }, []);

  const selectedUser = users.find((user) => user.id === form.userId);
  const selectedSymbol = findSymbolByInput(form.symbol, symbols);
  const visibleSymbols = symbols.filter((symbol) => {
    const term = symbolSearch.toLowerCase().trim();
    if (!term) return true;
    return String(symbol.symbol || '').toLowerCase().includes(term)
      || String(symbol.display_name || '').toLowerCase().includes(term)
      || String(symbol.underlying || '').toLowerCase().includes(term)
      || getTradeAxisSymbolLabel(symbol).toLowerCase().includes(term);
  });
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    try {
      const res = await api.post('/web-admin/trade-on-behalf', {
        ...form,
        symbol: selectedSymbol?.symbol || form.symbol,
      });
      toast.success(res.data?.message || 'Trade opened');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Trade failed');
    }
  };

  return (
    <div className="grid-3">
      <div className="card pad">
        <div className="section-head"><div><h2>1. Select User</h2><p>Choose the client account.</p></div></div>
        <div className="field"><label>User</label><select className="select" value={form.userId} onChange={(event) => { update('userId', event.target.value); update('accountId', ''); }}><option value="">Select user</option>{users.filter((u) => u.role === 'user').map((user) => <option key={user.id} value={user.id}>{user.login_id} - {getUserName(user)}</option>)}</select></div>
        <div className="field"><label>Account</label><select className="select" value={form.accountId} onChange={(event) => update('accountId', event.target.value)}><option value="">Default live account</option>{(selectedUser?.accounts || []).map((account) => <option key={account.id} value={account.id}>{account.account_number} - {account.is_demo ? 'Demo' : 'Live'}</option>)}</select></div>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>2. Select Script</h2><p>Pick the market instrument.</p></div></div>
        <div className="field">
          <label>Search Script</label>
          <input
            className="input"
            value={symbolSearch}
            onChange={(event) => setSymbolSearch(event.target.value)}
            placeholder="Search script"
          />
        </div>
        <div className="field">
          <label>Script</label>
          <select className="select" value={form.symbol} onChange={(event) => update('symbol', event.target.value)}>
            {visibleSymbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{getTradeAxisSymbolLabel(symbol)}</option>)}
          </select>
        </div>
        <div className="meta">{visibleSymbols.length} matching scripts</div>
        {selectedSymbol && (
          <div className="quote-strip">
            <div><span>Last</span><strong>{getSymbolPrice(selectedSymbol).toFixed(2)}</strong></div>
            <div><span>Bid</span><strong>{getSymbolBid(selectedSymbol).toFixed(2)}</strong></div>
            <div><span>Ask</span><strong>{getSymbolAsk(selectedSymbol).toFixed(2)}</strong></div>
          </div>
        )}
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>3. Trade Details</h2><p>Admin enters every execution detail.</p></div></div>
        <div className="side-switch">
          <button className={`btn ${form.side === 'buy' ? 'success' : 'subtle'}`} onClick={() => update('side', 'buy')}>Buy</button>
          <button className={`btn ${form.side === 'sell' ? 'danger' : 'subtle'}`} onClick={() => update('side', 'sell')}>Sell</button>
        </div>
        <div className="grid-2">
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.includeEntryBrokerage}
              onChange={(event) => update('includeEntryBrokerage', event.target.checked)}
            />
            <span>Apply entry brokerage</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.includeExitBrokerage}
              onChange={(event) => update('includeExitBrokerage', event.target.checked)}
            />
            <span>Apply exit brokerage</span>
          </label>
        </div>
        {[
          ['quantity', 'Quantity', 'number'],
          ['openPrice', 'Entry Price', 'number'],
          ['stopLoss', 'Stop Loss', 'number'],
          ['takeProfit', 'Target Price', 'number'],
          ['entryTime', 'Entry Date & Time', 'datetime-local'],
          ['exitPrice', 'Exit Price for closed trade', 'number'],
          ['exitTime', 'Exit Date & Time for closed trade', 'datetime-local'],
        ].map(([key, label, type]) => (
          <div className="field" key={key}><label>{label}</label><input className="input" type={type} value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>
        ))}
        <button className="btn primary" onClick={submit}>Open Trade On Behalf</button>
      </div>
    </div>
  );
}

export default App;
