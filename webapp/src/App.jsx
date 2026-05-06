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
  History,
  Home,
  Landmark,
  LineChart,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquareStack,
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

const roleLabel = (role) => {
  if (role === 'admin') return 'Admin';
  if (role === 'sub_broker') return 'Sub Broker';
  return 'User';
};

const formatMoney = (value) =>
  `INR ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => (value ? new Date(value).toLocaleString('en-IN') : '-');

const getUserName = (user) => {
  const name = `${user?.first_name || user?.firstName || ''} ${user?.last_name || user?.lastName || ''}`.trim();
  return name || user?.login_id || user?.loginId || user?.email || 'User';
};

const getLoginId = (user) => user?.login_id || user?.loginId || '';

const getExpiryDate = (symbol) => {
  const raw = symbol?.expiry_date || symbol?.expiryDate || symbol?.expiry;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getMonthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

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

const getSymbolPrice = (symbol) =>
  firstPositiveNumber(
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
    symbol?.ask,
  );

const getSymbolBid = (symbol) => firstPositiveNumber(symbol?.bid, symbol?.bidPrice, getSymbolPrice(symbol));

const getSymbolAsk = (symbol) => firstPositiveNumber(symbol?.ask, symbol?.askPrice, getSymbolPrice(symbol));

const getLivePositionPrice = (position, symbols = []) => {
  const symbol = symbols.find((row) => String(row.symbol).toUpperCase() === String(position.symbol).toUpperCase());
  return getSymbolPrice(symbol) || Number(position.current_price || position.close_price || position.open_price || 0);
};

const getPositionPnl = (position, symbols = []) => {
  const currentPrice = getLivePositionPrice(position, symbols);
  const qty = Number(position.quantity || 0);
  const openPrice = Number(position.open_price || 0);
  const direction = position.trade_type === 'sell' ? -1 : 1;
  if (!qty || !openPrice || !currentPrice) return Number(position.profit || 0);
  return (currentPrice - openPrice) * qty * direction;
};

const loadTradableSymbols = async (params = {}) => {
  const res = await api.get('/market/symbols', { params: { limit: 5000, ...params } });
  return filterTradableSymbols(res.data?.symbols || []);
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
              placeholder="TA1000"
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

  const user = auth?.user || null;
  const role = String(user?.role || 'user').toLowerCase();
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || accounts[0] || null;

  const setActive = useCallback((tabId) => {
    setActiveState(tabId);
    localStorage.setItem(activeTabStorageKey, tabId);
  }, []);

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

  if (!auth) return <Login onLogin={handleLogin} />;

  const isOperator = role === 'admin' || role === 'sub_broker';
  const navTabs = isOperator
    ? [...adminTabs.filter((tab) => !tab.adminOnly || role === 'admin'), ...commonTabs]
    : commonTabs;
  const fallbackTab = isOperator ? 'adminPositions' : 'trade';
  const safeActive = navTabs.some((tab) => tab.id === active) ? active : fallbackTab;
  const renderedActive = safeActive === 'workspace' ? 'trade' : safeActive;
  const activeTab = navTabs.find((tab) => tab.id === safeActive) || navTabs[0];

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
              {adminTabs
                .filter((tab) => !tab.adminOnly || role === 'admin')
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
            {adminTabs
              .filter((tab) => !tab.adminOnly || role === 'admin')
              .map((tab) => (
                <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => setActive(tab.id)} />
              ))}
          </nav>
        )}

        <section className="content">
          {renderedActive === 'quotes' && <Quotes selectedAccount={selectedAccount} />}
          {renderedActive === 'chart' && <ChartWorkspace selectedAccount={selectedAccount} />}
          {renderedActive === 'trade' && <Trade selectedAccount={selectedAccount} />}
          {renderedActive === 'history' && <TradeHistory selectedAccount={selectedAccount} />}
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
            />
          )}
          {renderedActive === 'users' && <UsersPanel mode="user" role={role} />}
          {renderedActive === 'adminPositions' && <AdminPositionsPanel />}
          {renderedActive === 'adminOrders' && <AdminOrdersPanel />}
          {renderedActive === 'leverageMargin' && <LeverageMarginPanel />}
          {renderedActive === 'autoClose' && <AutoClosePanel />}
          {renderedActive === 'subBrokers' && <UsersPanel mode="sub_broker" role={role} />}
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

      {!isOperator && (
        <nav className="bottom-nav">
          {commonTabs.map((tab) => (
            <NavButton key={tab.id} tab={tab} active={safeActive === tab.id} onClick={() => setActive(tab.id)} />
          ))}
        </nav>
      )}

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
    const interval = setInterval(() => {
      if (status === 'open' || status === 'all') load();
    }, 5000);
    return () => clearInterval(interval);
  }, [load, status]);

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
        <Stat label="Pending Withdrawals" value={summary?.pendingWithdrawals || 0} />
        <Stat label="Pending QR Deposits" value={summary?.pendingDeposits || 0} />
      </div>
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

function Quotes({ selectedAccount }) {
  const [symbols, setSymbols] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [ticketSymbol, setTicketSymbol] = useState(null);

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

  useEffect(() => {
    load();
    const interval = setInterval(() => load({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [load]);

  const visible = symbols
    .filter((symbol) => {
      const term = query.toLowerCase();
      return String(symbol.symbol || '').toLowerCase().includes(term) ||
        String(symbol.display_name || '').toLowerCase().includes(term);
    })
    .slice(0, 120);

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div className="field" style={{ margin: 0, minWidth: 280 }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
              <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search script" style={{ paddingLeft: 38 }} />
            </div>
          </div>
        </div>
        <button className="btn subtle" onClick={load} disabled={loading}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Script</th>
              <th>Bid</th>
              <th>Ask</th>
              <th>Last</th>
              <th>Change</th>
              <th>Segment</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((symbol) => (
              <tr key={symbol.symbol} className="click-row" onClick={() => setTicketSymbol(symbol)}>
                <td><strong>{symbol.symbol}</strong><div className="meta">{symbol.display_name}</div></td>
                <td>{getSymbolBid(symbol).toFixed(2)}</td>
                <td>{getSymbolAsk(symbol).toFixed(2)}</td>
                <td>{getSymbolPrice(symbol).toFixed(2)}</td>
                <td className={Number(symbol.change_percent || 0) >= 0 ? 'positive' : 'negative'}>
                  {Number(symbol.change_percent || 0).toFixed(2)}%
                </td>
                <td>{symbol.category || symbol.exchange || '-'}</td>
              </tr>
            ))}
            {!visible.length && (
              <tr><td colSpan="6">No scripts found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {ticketSymbol && (
        <TradeTicketModal
          accountId={selectedAccount?.id}
          symbols={symbols}
          initialSymbol={ticketSymbol.symbol}
          title={ticketSymbol.symbol}
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
    const interval = setInterval(() => refreshSymbols(true), 5000);
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

function TradeTicketModal({ accountId, symbols, initialSymbol, title, subtitle, onClose, onDone }) {
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

function TradeTicket({ accountId, symbols, initialSymbol, onDone }) {
  const [form, setForm] = useState({
    symbol: initialSymbol || symbols?.[0]?.symbol || '',
    orderType: 'market',
    quantity: 1,
    price: '',
    stopLoss: '',
    takeProfit: '',
  });
  const [busy, setBusy] = useState(false);
  const selectedSymbol = symbols.find((row) => row.symbol === form.symbol);
  const runningPrice = getSymbolPrice(selectedSymbol);
  const sellPrice = getSymbolBid(selectedSymbol) || runningPrice;
  const buyPrice = getSymbolAsk(selectedSymbol) || runningPrice;

  useEffect(() => {
    if (initialSymbol) {
      setForm((prev) => ({ ...prev, symbol: initialSymbol }));
    } else if (!form.symbol && symbols?.[0]?.symbol) {
      setForm((prev) => ({ ...prev, symbol: symbols[0].symbol }));
    }
  }, [initialSymbol, symbols, form.symbol]);

  useEffect(() => {
    if ((form.orderType === 'market' || form.orderType === 'instant') && runningPrice && !Number(form.price || 0)) {
      setForm((prev) => ({ ...prev, price: String(runningPrice) }));
    }
  }, [form.orderType, form.price, runningPrice]);

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

      const orderPrice = Number(form.price || runningPrice || 0);
      const res = await api.post('/trading/order', {
        accountId,
        symbol: form.symbol,
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
      <OrderFields form={form} setForm={setForm} symbols={symbols} />
      <div className="grid-2">
        <button className="btn success" disabled={busy} onClick={() => place('buy')}>
          <ArrowDownCircle size={17} />Buy
        </button>
        <button className="btn danger" disabled={busy} onClick={() => place('sell')}>
          <ArrowUpCircle size={17} />Sell
        </button>
      </div>
    </div>
  );
}

function Trade({ selectedAccount }) {
  const [symbols, setSymbols] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [showOrder, setShowOrder] = useState(false);

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
    }, 5000);
    return () => clearInterval(interval);
  }, [accountId]);

  const closeTrade = async (tradeId) => {
    if (!window.confirm('Close this position?')) return;
    try {
      const res = await api.post(`/trading/close/${tradeId}`, { accountId });
      toast.success(res.data?.message || 'Position closed');
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

  const enrichedPositions = positions.map((position) => ({
    ...position,
    livePrice: getLivePositionPrice(position, symbols),
    livePnl: getPositionPnl(position, symbols),
  }));
  const floatingPnl = enrichedPositions.reduce((sum, row) => sum + Number(row.livePnl || 0), 0);
  const usedMargin = Number(selectedAccount?.margin || enrichedPositions.reduce((sum, row) => sum + Number(row.margin || 0), 0));
  const balance = Number(selectedAccount?.balance || 0);
  const credit = Number(selectedAccount?.credit || 0);
  const equity = balance + credit + floatingPnl;
  const freeMargin = Math.max(0, equity - usedMargin);
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

  return (
    <div className="trade-app-view">
      <div className="trade-summary-card">
        <div className="trade-account-line">
          <span>Trade Axis</span>
          <strong>{selectedAccount?.account_number || 'Account'}</strong>
          <span className={`pill ${selectedAccount?.is_demo ? 'gold' : 'teal'}`}>{selectedAccount?.is_demo ? 'Demo' : 'Live'}</span>
        </div>
        <div className="trade-metric-grid">
          <Stat label="Balance" value={formatMoney(balance)} />
          <Stat label="Equity" value={formatMoney(equity)} tone={equity >= balance ? 'positive' : 'negative'} />
          <Stat label="Floating P&L" value={formatMoney(floatingPnl)} tone={floatingPnl >= 0 ? 'positive' : 'negative'} />
          <Stat label="Free Margin" value={formatMoney(freeMargin)} tone="positive" />
          <Stat label="P&L" value={formatMoney(credit)} tone={credit >= 0 ? 'positive' : 'negative'} />
          <Stat label="Used Margin" value={formatMoney(usedMargin)} tone="gold" />
          <Stat label="Margin Level" value={usedMargin ? `${marginLevel.toFixed(2)}%` : '-'} tone="positive" />
        </div>
      </div>

      <div className="trade-action-bar">
        <button className="btn primary" onClick={() => setShowOrder(true)}><Plus size={16} />New Order</button>
        <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
        <button className="btn danger" onClick={closeAll} disabled={!positions.length}>Close All</button>
      </div>

      <div className="trade-position-tabs">
        <button className="tab active">Positions ({enrichedPositions.length})</button>
        <button className="tab">Pending ({orders.length})</button>
      </div>

      <div className="position-card-list">
        {enrichedPositions.map((position) => (
          <div className="position-card" key={position.id}>
            <div className="position-card-main">
              <div>
                <div className="position-title">
                  <strong>{position.symbol}</strong>
                  <span className={`pill ${position.trade_type === 'buy' ? 'teal' : 'red'}`}>{position.trade_type} {position.quantity}</span>
                </div>
                <div className="position-prices">
                  <span>Open: {Number(position.open_price || 0).toFixed(2)}</span>
                  <span>Current: {Number(position.livePrice || 0).toFixed(2)}</span>
                </div>
              </div>
              <strong className={Number(position.livePnl || 0) >= 0 ? 'positive' : 'negative'}>{formatMoney(position.livePnl)}</strong>
            </div>
            <div className="position-card-actions">
              <button className="btn primary" onClick={() => setShowOrder(true)}>New Order</button>
              <button className="btn subtle" onClick={() => partialCloseTrade(position)}>Partial</button>
              <button className="btn danger" onClick={() => closeTrade(position.id)}>Close</button>
            </div>
          </div>
        ))}
        {!enrichedPositions.length && <div className="empty-state compact-empty"><span>No open positions</span></div>}
      </div>

      {orders.length > 0 && (
        <div className="card pad">
          <div className="section-head"><div><h2>Pending Orders</h2><p>Limit and stop orders waiting for execution.</p></div></div>
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
          </div>
        </div>
      )}

      {showOrder && (
        <TradeTicketModal
          accountId={accountId}
          symbols={symbols}
          initialSymbol={selectedSymbol}
          title="New Order"
          subtitle="Trade Axis order ticket"
          onClose={() => setShowOrder(false)}
          onDone={() => { setShowOrder(false); load(); }}
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
            <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
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

function OrderFields({ form, setForm, symbols }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const isMarket = form.orderType === 'market' || form.orderType === 'instant';
  return (
    <>
      <div className="field">
        <label>Script</label>
        <select className="select" value={form.symbol} onChange={(event) => update('symbol', event.target.value)}>
          {symbols.map((row) => <option key={row.symbol} value={row.symbol}>{row.symbol}</option>)}
        </select>
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

function TradeHistory({ selectedAccount }) {
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
      const [historyRes, orderRes, dealsRes] = await Promise.all([
        api.get('/trading/history', { params: { accountId: selectedAccount.id, period } }),
        api.get(`/trading/pending-order-history/${selectedAccount.id}`),
        api.get('/transactions/deals', { params: { accountId: selectedAccount.id, period, limit: 500 } }),
      ]);
      setRows(historyRes.data?.data || []);
      setOrderRows(orderRes.data?.data || []);
      setDeals(dealsRes.data?.data?.deals || []);
      setDealsSummary(dealsRes.data?.data?.summary || null);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [selectedAccount?.id, period]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div className="tabs">
            {['today', 'week', 'month', '3months'].map((item) => (
              <button key={item} className={`tab ${period === item ? 'active' : ''}`} onClick={() => setPeriod(item)}>{item}</button>
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
        <button className="btn subtle" onClick={load} disabled={loading}><RefreshCw size={16} />Refresh</button>
      </div>

      {view === 'positions' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Ledger</th><th>Side</th><th>Qty</th><th>Open</th><th>Close</th><th>Commission</th><th>P&L</th></tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={trade.id}>
                  <td><strong>{trade.symbol}</strong><div className="meta">{formatDate(trade.open_time)} to {formatDate(trade.close_time)}</div><div className="meta mono">{trade.id}</div></td>
                  <td><span className={`pill ${trade.trade_type === 'buy' ? 'teal' : 'red'}`}>{trade.trade_type}</span></td>
                  <td>{trade.quantity}</td>
                  <td>{Number(trade.open_price || 0).toFixed(2)}</td>
                  <td>{Number(trade.close_price || 0).toFixed(2)}</td>
                  <td>{formatMoney(trade.brokerage)}</td>
                  <td className={Number(trade.profit || 0) >= 0 ? 'positive' : 'negative'}>{formatMoney(trade.profit)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="7">No closed positions found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'orders' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Order</th><th>Side</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th>Time</th></tr>
            </thead>
            <tbody>
              {orderRows.map((order) => (
                <tr key={order.id}>
                  <td><strong>{order.symbol}</strong><div className="meta mono">{order.id}</div></td>
                  <td><span className={`pill ${order.trade_type === 'buy' ? 'teal' : 'red'}`}>{order.trade_type || '-'}</span></td>
                  <td>{String(order.order_type || order.type || '-').replace('_', ' ')}</td>
                  <td>{order.quantity || '-'}</td>
                  <td>{Number(order.price || 0).toFixed(2)}</td>
                  <td><span className="pill gold">{order.status || '-'}</span></td>
                  <td>{formatDate(order.created_at || order.updated_at || order.executed_at)}</td>
                </tr>
              ))}
              {!orderRows.length && <tr><td colSpan="7">No order history found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'deals' && (
        <>
          <div className="stats-grid compact-stats">
            <Stat label="Profit" value={formatMoney(dealsSummary?.totalProfit || 0)} tone="positive" />
            <Stat label="Loss" value={formatMoney(dealsSummary?.totalLoss || 0)} tone="negative" />
            <Stat label="Commission" value={formatMoney(dealsSummary?.totalCommission || 0)} />
            <Stat label="Balance Settled" value={formatMoney(dealsSummary?.balanceSettled || 0)} tone={Number(dealsSummary?.balanceSettled || 0) >= 0 ? 'positive' : 'negative'} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Deal</th><th>Side</th><th>Qty</th><th>Price</th><th>Commission</th><th>Amount</th><th>Balance After</th></tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const amount = Number(deal.amount || deal.profit || 0);
                  return (
                    <tr key={deal.id}>
                      <td><strong>{deal.symbol || deal.dealLabel || deal.type}</strong><div className="meta">{formatDate(deal.time || deal.created_at)}</div><div className="meta">{deal.description || ''}</div></td>
                      <td><span className={`pill ${deal.side === 'entry' || deal.trade_type === 'buy' ? 'teal' : deal.side === 'settlement' ? 'gold' : 'red'}`}>{deal.side || deal.trade_type || deal.type || '-'}</span></td>
                      <td>{deal.quantity || '-'}</td>
                      <td>{deal.price ? Number(deal.price).toFixed(2) : '-'}</td>
                      <td>{formatMoney(deal.commission || deal.brokerage || 0)}</td>
                      <td className={amount >= 0 ? 'positive' : 'negative'}>{formatMoney(amount)}</td>
                      <td>{deal.balance_after !== undefined && deal.balance_after !== null ? formatMoney(deal.balance_after) : '-'}</td>
                    </tr>
                  );
                })}
                {!deals.length && <tr><td colSpan="7">No deals found</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Messages() {
  return (
    <div className="card pad">
      <div className="section-head">
        <div>
          <h2>Messages</h2>
          <p>Operational notifications and user announcements will appear here.</p>
        </div>
        <Bell size={22} color="var(--blue)" />
      </div>
      <div className="list">
        <div className="row"><div><strong>System status</strong><div className="meta">No active announcements.</div></div><span className="pill teal">Clear</span></div>
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
        <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
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

function UsersPanel({ mode, role }) {
  const [users, setUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    const res = await api.get('/web-admin/users', { params: { q, role: mode === 'sub_broker' ? 'sub_broker' : 'all' } });
    const data = res.data?.data || [];
    setAllUsers(data);
    setUsers(data.filter((user) => mode === 'sub_broker' ? user.role === 'sub_broker' : user.role !== 'sub_broker' && user.role !== 'admin'));
  }, [q, mode]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load users'));
  }, [load]);

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div style={{ position: 'relative', minWidth: 280 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
            <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search users" style={{ paddingLeft: 38 }} />
          </div>
        </div>
        <div className="right">
          <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
          <button className="btn primary" onClick={() => setShowCreate(true)}><Plus size={16} />Create {mode === 'sub_broker' ? 'Sub Broker' : 'User'}</button>
        </div>
      </div>
      <UsersTable
        users={users}
        brokers={allUsers.filter((user) => user.role === 'sub_broker')}
        showBroker={role === 'admin' && mode !== 'sub_broker'}
        onRefresh={load}
        onOpenDialog={setDialog}
      />
      {showCreate && <CreateUserModal mode={mode} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
      {dialog?.type === 'positions' && <UserPositionsModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'brokerage' && <BrokerageModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'ledger' && <LedgerModal user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.type === 'update' && <UserUpdateModal user={dialog.user} brokers={allUsers.filter((user) => user.role === 'sub_broker')} onClose={() => setDialog(null)} onSaved={load} />}
    </div>
  );
}

function UsersTable({ users, brokers = [], showBroker, onRefresh, onOpenDialog }) {
  const updateBroker = async (userId, brokerId) => {
    try {
      await api.post('/web-admin/assign-broker', { userId, brokerId: brokerId || null });
      toast.success('Broker assignment updated');
      onRefresh();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>P / B / L</th><th>User ID</th><th>Name</th><th>Ledger Bal</th><th>Equity</th><th>Open PNL</th><th>Closed P&L</th><th>M2M</th><th>Margin Used</th><th>Margin Lvl %</th><th>Margin Available</th><th>Sub Broker</th><th>Admin</th><th>Type</th><th>SL</th><th>Demo</th><th>Active</th><th>Created On</th><th>Update</th></tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const primary = (user.accounts || [])[0] || {};
            const openPnl = (user.accounts || []).reduce((sum, account) => sum + Number(account.equity || 0) - Number(account.balance || 0) - Number(account.credit || 0), 0);
            const closedPnl = (user.accounts || []).reduce((sum, account) => sum + Number(account.credit || 0), 0);
            const marginLevel = Number(primary.margin || 0) > 0 ? (Number(primary.equity || 0) / Number(primary.margin || 0)) * 100 : 0;
            return (
            <tr key={user.id}>
              <td>
                <div className="quick-actions">
                  <button className="mini-action purple" onClick={() => onOpenDialog({ type: 'positions', user })}>P</button>
                  <button className="mini-action orange" onClick={() => onOpenDialog({ type: 'brokerage', user })}>B</button>
                  <button className="mini-action blue" onClick={() => onOpenDialog({ type: 'ledger', user })}>L</button>
                </div>
              </td>
              <td><strong className="mono">{user.login_id}</strong></td>
              <td><strong>{getUserName(user)}</strong><div className="meta">{user.email || user.phone || '-'}</div></td>
              <td>{Number(primary.balance || 0).toLocaleString('en-IN')}</td>
              <td>{Number(primary.equity || 0).toLocaleString('en-IN')}</td>
              <td className={openPnl >= 0 ? 'positive' : 'negative'}>{openPnl.toFixed(2)}</td>
              <td className={closedPnl >= 0 ? 'positive' : 'negative'}>{closedPnl.toFixed(2)}</td>
              <td className={openPnl >= 0 ? 'positive' : 'negative'}>{openPnl.toFixed(2)}</td>
              <td>{Number(primary.margin || 0).toLocaleString('en-IN')}</td>
              <td>{marginLevel ? marginLevel.toFixed(2) : '-'}</td>
              <td>{Number(primary.free_margin || 0).toLocaleString('en-IN')}</td>
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
              <td>{(user.accounts || []).some((account) => account.is_demo) ? 'YES' : 'NO'}</td>
              <td>{user.is_active ? 'YES' : 'NO'}</td>
              <td>{formatDate(user.created_at)}</td>
              <td><button className="btn primary" onClick={() => onOpenDialog({ type: 'update', user })}>Update</button></td>
            </tr>
          )})}
          {!users.length && <tr><td colSpan="19">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function CreateUserModal({ mode, onClose, onCreated }) {
  const [form, setForm] = useState({
    loginId: '',
    password: 'TA1234',
    firstName: '',
    phone: '',
    role: mode === 'sub_broker' ? 'sub_broker' : 'user',
    leverage: 30,
    brokerageRate: 0.0006,
    demoBalance: 100000,
    createDemo: true,
    createLive: true,
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const create = async () => {
    try {
      const res = await api.post('/web-admin/users', form);
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
              ['leverage', 'Leverage'],
              ['brokerageRate', 'Brokerage Rate'],
              ['demoBalance', 'Demo Balance'],
            ].map(([key, label]) => (
              <div className="field" key={key}>
                <label>{label}</label>
                <input className="input" value={form[key]} onChange={(event) => update(key, key === 'loginId' ? event.target.value.toUpperCase() : event.target.value)} />
              </div>
            ))}
          </div>
          {mode !== 'sub_broker' && (
            <div className="grid-2">
              <label className="row"><span>Create Demo</span><input type="checkbox" checked={form.createDemo} onChange={(event) => update('createDemo', event.target.checked)} /></label>
              <label className="row"><span>Create Live</span><input type="checkbox" checked={form.createLive} onChange={(event) => update('createLive', event.target.checked)} /></label>
            </div>
          )}
          <button className="btn primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}

function AdminPositionsPanel() {
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
          <button className="btn subtle" onClick={load} disabled={loading}><RefreshCw size={16} />Refresh</button>
        </div>
      </div>
      <AdminPositionTable rows={rows} status={status} onReload={load} />
    </div>
  );
}

function UserPositionsModal({ user, onClose }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const res = await api.get('/web-admin/positions', { params: { userId: user.id, status, q } });
    setRows(res.data?.data || []);
  }, [user.id, status, q]);

  useEffect(() => {
    load().catch(() => toast.error('Failed to load user positions'));
  }, [load]);

  const openPnl = rows.filter((row) => row.status === 'open').reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const closedPnl = rows.filter((row) => row.status === 'closed').reduce((sum, row) => sum + Number(row.profit || 0), 0);
  const account = (user.accounts || [])[0] || {};
  const usedMargin = Number(account.margin || 0);
  const equity = Number(account.equity || account.balance || 0);
  const freeMargin = Number(account.free_margin || 0);
  const marginLevel = usedMargin > 0 ? (equity / usedMargin) * 100 : 0;

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="modal-head">
          <strong>Positions - {getUserName(user)}</strong>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="stats-grid compact-stats">
            <Stat label="User" value={user.login_id} />
            <Stat label="Balance" value={formatMoney(account.balance || 0)} />
            <Stat label="Equity" value={formatMoney(equity)} />
            <Stat label="Floating P&L" value={formatMoney(openPnl)} tone={openPnl >= 0 ? 'positive' : 'negative'} />
            <Stat label="Free Margin" value={formatMoney(freeMargin)} />
            <Stat label="P&L" value={formatMoney(closedPnl)} tone={closedPnl >= 0 ? 'positive' : 'negative'} />
            <Stat label="Used Margin" value={formatMoney(usedMargin)} />
            <Stat label="Margin Level" value={usedMargin ? `${marginLevel.toFixed(2)}%` : '-'} />
            <Stat label="Settlement Balance" value={formatMoney(account.balance || 0)} />
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
          </div>
          <AdminPositionTable rows={rows} status={status} onReload={load} />
        </div>
      </div>
    </div>
  );
}

function AdminPositionTable({ rows, status, onReload }) {
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
                    <button className="mini-action blue" onClick={() => setEditTrade(row)}>Edit</button>
                    {row.status === 'closed' ? (
                      <button className="mini-action orange" onClick={() => reopenTrade(row)}>Reopen</button>
                    ) : (
                      <button className="mini-action orange" onClick={() => setExitTrade(row)}>Exit</button>
                    )}
                    <button className="mini-action red" onClick={() => deleteTrade(row)}>Delete</button>
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
    comment: trade.comment || '',
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
            ].map(([key, label]) => (
              <div className="field" key={key}><label>{label}</label><input className="input" value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>
            ))}
            <div className="field">
              <label>Live P&L</label>
              <input className={`input ${livePnl >= 0 ? 'positive-input' : 'negative-input'}`} readOnly value={livePnl.toFixed(2)} />
            </div>
          </div>
          <div className="field"><label>Comment</label><textarea className="textarea" value={form.comment} onChange={(event) => update('comment', event.target.value)} /></div>
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
  const [reason, setReason] = useState('Manual close from web console');

  const close = async () => {
    try {
      await api.post('/web-admin/close-position', {
        tradeId: trade.id,
        closeQuantity: Number(quantity),
        closePrice: mode === 'manual' ? Number(closePrice) : undefined,
        reason,
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
          <div className="field"><label>Reason</label><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
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
      <div className="modal wide-modal">
        <div className="modal-head"><strong>Brokerage History - {getUserName(user)}</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="toolbar"><div className="tabs">{['today', 'week', 'month', '3months'].map((item) => <button key={item} className={`tab ${period === item ? 'active' : ''}`} onClick={() => setPeriod(item)}>{item}</button>)}</div><strong>Total Brokerage: {total.toFixed(2)}</strong></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Date & Time</th><th>Description</th><th>Amount</th><th>Balance After</th></tr></thead><tbody>{filtered.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{formatDate(row.close_time || row.open_time)}</td><td>[BROKERAGE] {row.symbol} ({row.trade_type})</td><td className="negative">-{Number(row.brokerage || 0).toFixed(2)}</td><td>{Number(row.account_balance || 0).toFixed(2)}</td></tr>)}{!filtered.length && <tr><td colSpan="5">No brokerage found</td></tr>}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}

function LedgerModal({ user, onClose }) {
  const [form, setForm] = useState({ crdr: 0, remarks: 'Adjustment' });
  const account = (user.accounts || [])[0] || {};

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="modal-head"><strong>Ledger Update</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">
          <div className="grid-2">
            <div className="field"><label>Username</label><input className="input" readOnly value={user.login_id || ''} /></div>
            <div className="field"><label>CRDR (Credit +ve / Debit -ve)</label><input className="input" value={form.crdr} onChange={(event) => setForm((prev) => ({ ...prev, crdr: event.target.value }))} /></div>
            <div className="field"><label>Deposit Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
            <div className="field"><label>Margin Available</label><input className="input" readOnly value={account.free_margin || 0} /></div>
            <div className="field"><label>Ledger Balance</label><input className="input" readOnly value={account.balance || 0} /></div>
            <div className="field"><label>Remarks</label><select className="select" value={form.remarks} onChange={(event) => setForm((prev) => ({ ...prev, remarks: event.target.value }))}>{['Register Balance', 'Deposit', 'Withdraw', 'Settlement', 'Adjustment'].map((item) => <option key={item}>{item}</option>)}</select></div>
          </div>
          <button className="btn primary block" onClick={() => toast.error('Ledger write endpoint is not enabled yet')}>Submit</button>
        </div>
      </div>
    </div>
  );
}

function UserUpdateModal({ user, brokers, onClose, onSaved }) {
  const [tab, setTab] = useState('details');

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal">
        <div className="modal-head"><strong>Update User - {getUserName(user)}</strong><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body user-update-shell">
          <div className="settings-menu">
            {['details', 'segment', 'script', 'ledger', 'copy', 'multiple', 'notifications', 'delete'].map((item) => (
              <button key={item} className={`settings-menu-item ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>{item}</button>
            ))}
          </div>
          <div className="settings-content">
            {tab === 'details' && <UserDetailsEditor user={user} brokers={brokers} onSaved={onSaved} />}
            {tab === 'segment' && <SegmentSettingsEditor user={user} />}
            {tab === 'notifications' && <NotificationEditor user={user} />}
            {tab !== 'details' && tab !== 'segment' && tab !== 'notifications' && (
              <div className="card pad"><h2>{tab}</h2><p className="meta">This section is prepared in the web UI. Backend write endpoints can be added next for full persistence.</p></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UserDetailsEditor({ user, brokers, onSaved }) {
  const [form, setForm] = useState({
    active: user.is_active !== false,
    brokerId: user.created_by || '',
  });

  const saveActive = async () => {
    try {
      await api.patch(`/admin/users/${user.id}/active`, { isActive: form.active });
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

  return (
    <div className="grid-2">
      <div className="card pad">
        <div className="section-head"><div><h2>User Settings</h2><p>Activation and password management.</p></div></div>
        <div className="field"><label>Username</label><input className="input" readOnly value={getUserName(user)} /></div>
        <label className="row"><span>Activation</span><input type="checkbox" checked={form.active} onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))} /></label>
        <button className="btn primary" onClick={saveActive}>Save Changes</button>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>Link User To Broker</h2><p>Assign client under a sub broker.</p></div></div>
        <div className="field"><label>Select Broker</label><select className="select" value={form.brokerId} onChange={(event) => setForm((prev) => ({ ...prev, brokerId: event.target.value }))}><option value="">Admin direct</option>{brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.login_id} - {getUserName(broker)}</option>)}</select></div>
        <button className="btn primary" onClick={saveBroker}>Transfer User</button>
      </div>
    </div>
  );
}

function SegmentSettingsEditor({ user }) {
  const segments = ['NSE Index', 'NSE Index Options', 'MCX Futures', 'NSE Futures Options'];
  return (
    <div className="segment-settings">
      {segments.map((segment) => (
        <div className="card pad" key={segment}>
          <div className="section-head"><div><h2>{segment}</h2><p>0 means use global setting.</p></div><button className="btn primary" onClick={() => toast.error('Segment settings endpoint is not enabled yet')}>Save</button></div>
          <div className="grid-3">
            {['Intraday Margin %', 'Holding Margin %', 'Brokerage /Cr', 'Max Lots', 'Order Lots'].map((label) => <div className="field" key={label}><label>{label}</label><input className="input" defaultValue="0" /></div>)}
          </div>
          <div className="grid-2"><label className="row"><span>Option Buying Allowed</span><input type="checkbox" defaultChecked /></label><label className="row"><span>Option Selling Allowed</span><input type="checkbox" /></label></div>
        </div>
      ))}
    </div>
  );
}

function NotificationEditor({ user }) {
  const [form, setForm] = useState({ title: '', content: '' });
  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Send Notification</h2><p>Custom message to selected user.</p></div></div>
      <div className="field"><label>Title</label><input className="input" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} /></div>
      <div className="field"><label>Content</label><textarea className="textarea" value={form.content} onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))} /></div>
      <div className="meta">Selected client: {user.login_id} - {getUserName(user)}</div>
      <button className="btn primary" onClick={() => toast.error('Notification endpoint is not enabled yet')}>Send Message</button>
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
        <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
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
        <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
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
  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Leverage & Margin Settings</h2><p>Global margin, brokerage, lot size and option permissions.</p></div><button className="btn primary" onClick={() => toast.error('Global settings endpoint is not enabled yet')}>Save All</button></div>
      <div className="segment-settings">
        {groups.map((group) => (
          <div className="card pad" key={group}>
            <h2>{group}</h2>
            <div className="grid-3">
              {['Brokerage', 'Max Lots', 'Order Lots', 'Holding Margin %', 'Intraday Margin %'].map((field) => (
                <div className="field" key={field}><label>{field}</label><input className="input" defaultValue={field === 'Brokerage' ? 6000 : 30} /></div>
              ))}
            </div>
            <div className="grid-2"><label className="row"><span>Option Buying Allowed</span><input type="checkbox" defaultChecked /></label><label className="row"><span>Option Selling Allowed</span><input type="checkbox" /></label></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutoClosePanel() {
  const [globalClose, setGlobalClose] = useState(90);
  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Auto Close Settings</h2><p>Liquidate or illiquidate accounts when ledger loss reaches configured percentage.</p></div></div>
      <div className="card pad">
        <div className="field"><label>Ledger Balance Close (%)</label><input className="input" value={globalClose} onChange={(event) => setGlobalClose(event.target.value)} /></div>
        <button className="btn primary" onClick={() => toast.error('Auto close settings endpoint is not enabled yet')}>Apply to All Users</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}><table><thead><tr><th>User Email</th><th>Name</th><th>Auto Close %</th><th>Mode</th><th>Action</th></tr></thead><tbody><tr><td colSpan="5">User-specific settings will appear after backend endpoint is enabled.</td></tr></tbody></table></div>
    </div>
  );
}

function ActionLedgerPanel() {
  return (
    <div className="card pad">
      <div className="section-head"><div><h2>Action Logs</h2><p>Admin action ledger with date, user, actor and message.</p></div></div>
      <div className="toolbar"><input className="input" type="date" /><input className="input" type="date" /><button className="btn primary">Fetch Date</button><button className="btn success">Export Excel</button></div>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>User ID</th><th>By</th><th>Message</th></tr></thead><tbody><tr><td colSpan="4">Action log endpoint is not enabled yet.</td></tr></tbody></table></div>
    </div>
  );
}

function CustomerSupportPanel() {
  return (
    <div className="support-shell card">
      <div className="support-list">
        <div className="section-head"><div><h2>Support Inbox</h2><p>0 conversations</p></div></div>
        <div className="empty-state"><MessageSquare size={34} /><span>No support messages yet</span></div>
      </div>
      <div className="support-thread">
        <div className="empty-state"><span>Select a user query to respond.</span></div>
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
  const [form, setForm] = useState({ message: '', date: '' });

  const load = async () => {
    const res = await api.get('/web-admin/market-holiday');
    const data = res.data?.data || {};
    setStatus(data);
    setForm({ message: data.message || '', date: data.date || '' });
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

  const load = async () => {
    const res = await api.get('/market/symbols', { params: { limit: 5000 } });
    setSymbols(res.data?.symbols || []);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const toggle = async (symbol) => {
    const next = !symbol.is_banned;
    if (next && !reason.trim()) return toast.error('Enter ban reason');
    try {
      await api.post('/web-admin/symbol-ban', { symbol: symbol.symbol, isBanned: next, reason });
      toast.success(next ? 'Script banned' : 'Script unbanned');
      setReason('');
      load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Update failed');
    }
  };

  const rows = symbols.filter((s) => String(s.symbol).toLowerCase().includes(q.toLowerCase())).slice(0, 400);

  return (
    <div className="card pad">
      <div className="toolbar">
        <input className="input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search script" style={{ maxWidth: 320 }} />
        <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ban reason" style={{ maxWidth: 420 }} />
      </div>
      <div className="list">
        {rows.map((symbol) => (
          <div className="row" key={symbol.symbol}>
            <div><strong>{symbol.symbol}</strong><div className="meta">{symbol.display_name} {symbol.ban_reason ? `- ${symbol.ban_reason}` : ''}</div></div>
            <button className={`btn ${symbol.is_banned ? 'success' : 'danger'}`} onClick={() => toggle(symbol)}>{symbol.is_banned ? 'Unban' : 'Ban'}</button>
          </div>
        ))}
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
      </div>
    </div>
  );
}

function TradeOnBehalfPanel() {
  const [users, setUsers] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [form, setForm] = useState({ userId: '', accountId: '', symbol: '', side: 'buy', quantity: 1, openPrice: '', currentPrice: '', stopLoss: '', takeProfit: '', entryTime: '', exitPrice: '', exitTime: '', comment: '' });

  useEffect(() => {
    Promise.all([
      api.get('/web-admin/users'),
      api.get('/market/symbols', { params: { limit: 1000 } }),
    ]).then(([usersRes, symbolsRes]) => {
      const nextUsers = usersRes.data?.data || [];
      const nextSymbols = symbolsRes.data?.symbols || [];
      setUsers(nextUsers);
      setSymbols(nextSymbols);
      setForm((prev) => ({ ...prev, userId: nextUsers.find((u) => u.role === 'user')?.id || '', symbol: nextSymbols[0]?.symbol || '' }));
    }).catch(() => {});
  }, []);

  const selectedUser = users.find((user) => user.id === form.userId);
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    try {
      const res = await api.post('/web-admin/trade-on-behalf', form);
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
        <div className="field"><label>Script</label><select className="select" value={form.symbol} onChange={(event) => update('symbol', event.target.value)}>{symbols.map((symbol) => <option key={symbol.symbol} value={symbol.symbol}>{symbol.symbol}</option>)}</select></div>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>3. Trade Details</h2><p>Admin enters every execution detail.</p></div></div>
        <div className="side-switch">
          <button className={`btn ${form.side === 'buy' ? 'success' : 'subtle'}`} onClick={() => update('side', 'buy')}>Buy</button>
          <button className={`btn ${form.side === 'sell' ? 'danger' : 'subtle'}`} onClick={() => update('side', 'sell')}>Sell</button>
        </div>
        {[
          ['quantity', 'Quantity', 'number'],
          ['openPrice', 'Entry Price', 'number'],
          ['currentPrice', 'Current Price', 'number'],
          ['stopLoss', 'Stop Loss', 'number'],
          ['takeProfit', 'Target Price', 'number'],
          ['entryTime', 'Entry Date & Time', 'datetime-local'],
          ['exitPrice', 'Exit Price for closed trade', 'number'],
          ['exitTime', 'Exit Date & Time for closed trade', 'datetime-local'],
        ].map(([key, label, type]) => (
          <div className="field" key={key}><label>{label}</label><input className="input" type={type} value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>
        ))}
        <div className="field"><label>Comment</label><textarea className="textarea" value={form.comment} onChange={(event) => update('comment', event.target.value)} /></div>
        <button className="btn primary" onClick={submit}>Open Trade On Behalf</button>
      </div>
    </div>
  );
}

export default App;
