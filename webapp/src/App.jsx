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

const commonTabs = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'quotes', label: 'Quotes', icon: Activity },
  { id: 'chart', label: 'Chart', icon: LineChart },
  { id: 'trade', label: 'Trade', icon: ArrowLeftRight },
  { id: 'history', label: 'History', icon: History },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const adminTabs = [
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'withdrawals', label: 'Withdrawals', icon: ArrowUpCircle },
  { id: 'qrDeposits', label: 'QR Deposit', icon: QrCode },
  { id: 'settlement', label: 'Settlement', icon: ClipboardList },
  { id: 'marketHoliday', label: 'Market Holiday', icon: CalendarDays },
  { id: 'manualClose', label: 'Manual Close', icon: Lock },
  { id: 'scriptBan', label: 'Script Ban', icon: Ban },
  { id: 'kiteSetup', label: 'Kite Setup', icon: Wifi },
  { id: 'tradeOnBehalf', label: 'Trade On Behalf', icon: BriefcaseBusiness },
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

const readAuth = () => {
  try {
    return JSON.parse(localStorage.getItem(authStorageKey) || 'null');
  } catch {
    return null;
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
      const body = new URLSearchParams({
        loginId: form.loginId.trim(),
        password: form.password,
      });
      const res = await api.post('/auth/login', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = res.data?.data || {};
      localStorage.setItem(tokenStorageKey, data.token);
      localStorage.setItem(authStorageKey, JSON.stringify({ user: data.user, accounts: data.accounts || [] }));
      onLogin({ user: data.user, accounts: data.accounts || [] });
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
  const [active, setActive] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accounts, setAccounts] = useState(cached?.accounts || []);

  const user = auth?.user || null;
  const role = String(user?.role || 'user').toLowerCase();
  const selectedAccount = accounts[0] || null;

  const refreshAuth = useCallback(async () => {
    const token = localStorage.getItem(tokenStorageKey);
    if (!token) return;
    try {
      const res = await api.get('/auth/me');
      const data = res.data?.data || {};
      setAuth({ user: data.user, accounts: data.accounts || [] });
      setAccounts(data.accounts || []);
      localStorage.setItem(authStorageKey, JSON.stringify({ user: data.user, accounts: data.accounts || [] }));
    } catch {
      localStorage.removeItem(tokenStorageKey);
      localStorage.removeItem(authStorageKey);
      setAuth(null);
    }
  }, []);

  useEffect(() => {
    if (auth) refreshAuth();
  }, []);

  const logout = () => {
    localStorage.removeItem(tokenStorageKey);
    localStorage.removeItem(authStorageKey);
    setAuth(null);
  };

  if (!auth) return <Login onLogin={setAuth} />;

  const navTabs = role === 'admin' || role === 'sub_broker'
    ? [...commonTabs, ...adminTabs.filter((tab) => !tab.adminOnly || role === 'admin')]
    : commonTabs;
  const activeTab = navTabs.find((tab) => tab.id === active) || navTabs[0];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark">TA</div>
          <span>Trade Axis</span>
        </div>

        <nav>
          <div className="nav-section-title">Workspace</div>
          {commonTabs.map((tab) => (
            <NavButton key={tab.id} tab={tab} active={active === tab.id} onClick={() => { setActive(tab.id); setSidebarOpen(false); }} />
          ))}

          {(role === 'admin' || role === 'sub_broker') && (
            <>
              <div className="nav-section-title">Operations</div>
              {adminTabs
                .filter((tab) => !tab.adminOnly || role === 'admin')
                .map((tab) => (
                  <NavButton key={tab.id} tab={tab} active={active === tab.id} onClick={() => { setActive(tab.id); setSidebarOpen(false); }} />
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
            <p>{roleLabel(role)} console with live trading controls</p>
          </div>
          <div className="topbar-actions">
            <AccountSelect accounts={accounts} selectedAccount={selectedAccount} />
            <button className="btn subtle" onClick={refreshAuth}>
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        </header>

        <section className="content">
          {active === 'overview' && <Overview role={role} selectedAccount={selectedAccount} />}
          {active === 'quotes' && <Quotes />}
          {active === 'chart' && <ChartWorkspace />}
          {active === 'trade' && <Trade selectedAccount={selectedAccount} />}
          {active === 'history' && <TradeHistory selectedAccount={selectedAccount} />}
          {active === 'messages' && <Messages />}
          {active === 'wallet' && <WalletPanel selectedAccount={selectedAccount} refreshAuth={refreshAuth} />}
          {active === 'settings' && <SettingsPanel user={user} />}
          {active === 'users' && <UsersPanel mode="user" role={role} />}
          {active === 'subBrokers' && <UsersPanel mode="sub_broker" role={role} />}
          {active === 'withdrawals' && <TransactionsPanel type="withdrawal" />}
          {active === 'qrDeposits' && <QrDepositsPanel />}
          {active === 'settlement' && <SettlementPanel />}
          {active === 'marketHoliday' && <MarketHolidayPanel />}
          {active === 'manualClose' && <ManualClosePanel />}
          {active === 'scriptBan' && <ScriptBanPanel />}
          {active === 'kiteSetup' && <KiteSetupPanel />}
          {active === 'tradeOnBehalf' && <TradeOnBehalfPanel />}
        </section>
      </main>

      {sidebarOpen && <button aria-label="Close menu" className="modal-backdrop" onClick={() => setSidebarOpen(false)} />}
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

function AccountSelect({ accounts, selectedAccount }) {
  return (
    <div className="pill blue">
      {selectedAccount?.account_number || accounts?.[0]?.account_number || 'No Account'}
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

function Quotes() {
  const [symbols, setSymbols] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/market/symbols', { params: { limit: 5000 } });
      setSymbols(res.data?.symbols || []);
    } catch {
      toast.error('Failed to load quotes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
              <tr key={symbol.symbol}>
                <td><strong>{symbol.symbol}</strong><div className="meta">{symbol.display_name}</div></td>
                <td>{Number(symbol.bid || 0).toFixed(2)}</td>
                <td>{Number(symbol.ask || 0).toFixed(2)}</td>
                <td>{Number(symbol.last_price || 0).toFixed(2)}</td>
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
    </div>
  );
}

function ChartWorkspace() {
  const [symbols, setSymbols] = useState([]);
  const [symbol, setSymbol] = useState('');

  useEffect(() => {
    api.get('/market/symbols', { params: { limit: 200 } }).then((res) => {
      const rows = res.data?.symbols || [];
      setSymbols(rows);
      setSymbol(rows[0]?.symbol || '');
    }).catch(() => {});
  }, []);

  return (
    <div className="card chart-box">
      <div className="chart-header">
        <div>
          <strong>{symbol || 'Select Script'}</strong>
          <div className="meta">15 minute candles</div>
        </div>
        <select className="select" value={symbol} onChange={(event) => setSymbol(event.target.value)} style={{ maxWidth: 260 }}>
          {symbols.map((row) => <option key={row.symbol} value={row.symbol}>{row.symbol}</option>)}
        </select>
      </div>
      <PriceChart symbol={symbol} />
    </div>
  );
}

function Trade({ selectedAccount }) {
  const [symbols, setSymbols] = useState([]);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ symbol: '', type: 'buy', orderType: 'market', quantity: 1, price: '', stopLoss: '', takeProfit: '' });
  const [busy, setBusy] = useState(false);

  const accountId = selectedAccount?.id;

  const load = useCallback(async () => {
    if (!accountId) return;
    const [symbolsRes, posRes, orderRes] = await Promise.all([
      api.get('/market/symbols', { params: { limit: 500 } }),
      api.get(`/trading/positions/${accountId}`),
      api.get(`/trading/pending-orders/${accountId}`),
    ]);
    const symbolRows = symbolsRes.data?.symbols || [];
    setSymbols(symbolRows);
    setPositions(posRes.data?.data || []);
    setOrders(orderRes.data?.data || []);
    setForm((prev) => ({ ...prev, symbol: prev.symbol || symbolRows[0]?.symbol || '' }));
  }, [accountId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const place = async () => {
    if (!accountId) return toast.error('Select an account first');
    setBusy(true);
    try {
      const res = await api.post('/trading/order', {
        accountId,
        symbol: form.symbol,
        type: form.type,
        orderType: form.orderType,
        quantity: Number(form.quantity),
        price: Number(form.price || 0),
        stopLoss: Number(form.stopLoss || 0),
        takeProfit: Number(form.takeProfit || 0),
      });
      toast.success(res.data?.message || 'Order placed');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Order failed');
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div className="trade-layout">
      <div className="card pad">
        <div className="section-head">
          <div>
            <h2>Market Watch</h2>
            <p>Select a script to trade.</p>
          </div>
        </div>
        <div className="list">
          {symbols.slice(0, 40).map((row) => (
            <button key={row.symbol} className={`row clickable ${form.symbol === row.symbol ? 'active' : ''}`} onClick={() => setForm((prev) => ({ ...prev, symbol: row.symbol }))}>
              <div><strong>{row.symbol}</strong><div className="meta">{row.display_name || row.exchange}</div></div>
              <div className="mono">{Number(row.last_price || row.bid || 0).toFixed(2)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card pad">
        <div className="section-head">
          <div>
            <h2>Open Positions</h2>
            <p>Monitor and close active trades.</p>
          </div>
          <button className="btn subtle" onClick={load}><RefreshCw size={16} />Refresh</button>
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
                  <td><button className="btn danger" onClick={() => closeTrade(position.id)}>Close</button></td>
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
              <span className="pill gold">{order.status}</span>
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
        <OrderFields form={form} setForm={setForm} symbols={symbols} />
        <div className="grid-2">
          <button className="btn success" disabled={busy} onClick={() => { setForm((prev) => ({ ...prev, type: 'buy' })); setTimeout(place, 0); }}>
            <ArrowDownCircle size={17} />Buy
          </button>
          <button className="btn danger" disabled={busy} onClick={() => { setForm((prev) => ({ ...prev, type: 'sell' })); setTimeout(place, 0); }}>
            <ArrowUpCircle size={17} />Sell
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderFields({ form, setForm, symbols }) {
  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
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
      <div className="grid-3">
        <div className="field">
          <label>Price</label>
          <input className="input" type="number" value={form.price} onChange={(event) => update('price', event.target.value)} placeholder="Market" />
        </div>
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
  const [period, setPeriod] = useState('month');

  useEffect(() => {
    if (!selectedAccount?.id) return;
    api.get('/trading/history', { params: { accountId: selectedAccount.id, period } })
      .then((res) => setRows(res.data?.data || []))
      .catch(() => toast.error('Failed to load history'));
  }, [selectedAccount?.id, period]);

  return (
    <div className="card pad">
      <div className="toolbar">
        <div className="left">
          <div className="tabs">
            {['today', 'week', 'month', '3months'].map((item) => (
              <button key={item} className={`tab ${period === item ? 'active' : ''}`} onClick={() => setPeriod(item)}>{item}</button>
            ))}
          </div>
        </div>
      </div>
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
            {!rows.length && <tr><td colSpan="7">No ledger entries found</td></tr>}
          </tbody>
        </table>
      </div>
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

function SettingsPanel({ user }) {
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
          <div><h2>Security</h2><p>Password changes remain available in the mobile app flow.</p></div>
          <Lock color="var(--blue)" />
        </div>
      </div>
    </div>
  );
}

function UsersPanel({ mode, role }) {
  const [users, setUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [q, setQ] = useState('');
  const [showCreate, setShowCreate] = useState(false);

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
      <UsersTable users={users} brokers={allUsers.filter((user) => user.role === 'sub_broker')} showBroker={role === 'admin' && mode !== 'sub_broker'} onRefresh={load} />
      {showCreate && <CreateUserModal mode={mode} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function UsersTable({ users, brokers = [], showBroker, onRefresh }) {
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
          <tr><th>User</th><th>Role</th><th>Status</th><th>Accounts</th><th>Broker</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td><strong>{user.login_id}</strong><div className="meta">{getUserName(user)} {user.email}</div></td>
              <td><span className="pill blue">{roleLabel(user.role)}</span></td>
              <td><span className={`pill ${user.is_active ? 'teal' : 'red'}`}>{user.is_active ? 'Active' : 'Blocked'}</span></td>
              <td>{(user.accounts || []).map((account) => <div key={account.id} className="meta">{account.account_number} - {formatMoney(account.equity)}</div>)}</td>
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
            </tr>
          ))}
          {!users.length && <tr><td colSpan="5">No users found</td></tr>}
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
        {['qrImage', 'upiId', 'accountName', 'bankName', 'accountNumber', 'ifscCode'].map((key) => (
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
  const [form, setForm] = useState({ userId: '', accountId: '', symbol: '', side: 'buy', quantity: 1, openPrice: '', currentPrice: '', stopLoss: '', takeProfit: '', comment: '' });

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
        <div className="field"><label>Side</label><select className="select" value={form.side} onChange={(event) => update('side', event.target.value)}><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
      </div>
      <div className="card pad">
        <div className="section-head"><div><h2>3. Trade Details</h2><p>Admin enters every execution detail.</p></div></div>
        {['quantity', 'openPrice', 'currentPrice', 'stopLoss', 'takeProfit'].map((key) => (
          <div className="field" key={key}><label>{key}</label><input className="input" value={form[key]} onChange={(event) => update(key, event.target.value)} /></div>
        ))}
        <div className="field"><label>Comment</label><textarea className="textarea" value={form.comment} onChange={(event) => update('comment', event.target.value)} /></div>
        <button className="btn primary" onClick={submit}>Open Trade On Behalf</button>
      </div>
    </div>
  );
}

export default App;
