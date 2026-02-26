// // frontend/src/pages/Dashboard.jsx
// import { useEffect, useMemo, useRef, useState } from 'react';
// import { toast } from 'react-hot-toast';

// import useAuthStore from '../store/authStore';
// import useTradingStore from '../store/tradingStore';
// import useMarketStore from '../store/marketStore';
// import useWatchlistStore from '../store/watchlistStore';

// import socketService from '../services/socket';
// import api from '../services/api';

// import {
//   Search,
//   TrendingUp,
//   BarChart2,
//   List,
//   Clock,
//   Star,
//   Plus,
//   Wallet as WalletIcon,
//   ChevronDown,
//   Settings,
//   LogOut,
//   RefreshCw,
//   Eye,
//   EyeOff,
//   Trash2,
//   Edit3,
//   X,
//   Crosshair,
//   Maximize2,
//   Minimize2,
//   MessageSquare,
//   Bell,
//   Info,
//   User,
// } from 'lucide-react';

// import PriceChart from '../components/charts/PriceChart';
// import WalletPage from '../components/account/Wallet';

// // Desktop components (kept)
// import DesktopTerminal from '../components/mt5/DesktopTerminal';
// import MarketWatchPanel from '../components/mt5/MarketWatchPanel';
// import NavigatorPanel from '../components/mt5/NavigatorPanel';
// import ChartWorkspace from '../components/mt5/ChartWorkspace';
// import OrderDockPanel from '../components/mt5/OrderDockPanel';
// import ToolboxPanel from '../components/mt5/ToolboxPanel';

// // ============ CONSTANTS ============
// const TIMEFRAMES = [
//   { id: 'M1', label: 'M1', value: '1m' },
//   { id: 'M5', label: 'M5', value: '5m' },
//   { id: 'M15', label: 'M15', value: '15m' },
//   { id: 'M30', label: 'M30', value: '30m' },
//   { id: 'H1', label: 'H1', value: '1h' },
//   { id: 'H4', label: 'H4', value: '4h' },
//   { id: 'D1', label: 'D1', value: '1d' },
//   { id: 'W1', label: 'W1', value: '1w' },
//   { id: 'MN', label: 'MN', value: '1M' },
// ];

// const CHART_TYPES = [
//   { id: 'candles', label: 'Candles' },
//   { id: 'bars', label: 'Bars' },
//   { id: 'line', label: 'Line' },
// ];

// // Indian market only (no emojis)
// const SYMBOL_CATEGORIES = [
//   { id: 'all', label: 'All' },
//   { id: 'equity', label: 'Equity' },
//   { id: 'indices', label: 'Indices' },
//   { id: 'fno', label: 'F&O' },
//   { id: 'etf', label: 'ETF' },
// ];

// const HISTORY_PERIODS = [
//   { id: 'today', label: 'Today' },
//   { id: 'week', label: 'Last Week' },
//   { id: 'month', label: 'Last Month' },
//   { id: '3months', label: 'Last 3 Months' },
//   { id: '6months', label: 'Last 6 Months' },
//   { id: 'year', label: 'Last Year' },
// ];

// // ============ CATEGORY HELPERS (Indian Market) ============
// const norm = (v) => String(v || '').toLowerCase().trim();

// const inferIndianCategory = (sym) => {
//   const c = norm(sym.category);
//   const seg = norm(sym.segment);
//   const inst = norm(sym.instrument_type);
//   const name = norm(sym.display_name);
//   const s = String(sym.symbol || '').toUpperCase();

//   const looksLikeIndex =
//     /NIFTY|SENSEX|BANKNIFTY|FINNIFTY|MIDCPNIFTY/i.test(s) ||
//     c.includes('index') ||
//     c.includes('indices') ||
//     seg.includes('index') ||
//     inst.includes('index') ||
//     name.includes('nifty') ||
//     name.includes('sensex');

//   if (looksLikeIndex) return 'indices';

//   const looksLikeEtf =
//     c === 'etf' || seg === 'etf' || inst === 'etf' || name.includes('etf');
//   if (looksLikeEtf) return 'etf';

//   const looksLikeFno =
//     c.includes('future') ||
//     c.includes('option') ||
//     c === 'fno' ||
//     seg.includes('f&o') ||
//     seg.includes('derivative') ||
//     /FUT$/.test(s) ||
//     /(CE|PE)$/.test(s);

//   if (looksLikeFno) return 'fno';

//   return 'equity';
// };

// const matchesSelectedCategory = (sym, selectedCategory) => {
//   if (selectedCategory === 'all') return true;
//   return inferIndianCategory(sym) === selectedCategory;
// };

// const getPeriodStart = (periodId) => {
//   const now = new Date();
//   const d = new Date(now);

//   switch (periodId) {
//     case 'today':
//       d.setHours(0, 0, 0, 0);
//       return d;
//     case 'week':
//       d.setDate(d.getDate() - 7);
//       return d;
//     case 'month':
//       d.setMonth(d.getMonth() - 1);
//       return d;
//     case '3months':
//       d.setMonth(d.getMonth() - 3);
//       return d;
//     case '6months':
//       d.setMonth(d.getMonth() - 6);
//       return d;
//     case 'year':
//       d.setFullYear(d.getFullYear() - 1);
//       return d;
//     default:
//       return null;
//   }
// };

// // ============ MAIN DASHBOARD COMPONENT ============
// const Dashboard = () => {
//   const { user, accounts, logout } = useAuthStore();
//   const isAdmin = (user?.role || '').toLowerCase() === 'admin';

//   const {
//     openTrades,
//     pendingOrders,
//     tradeHistory,
//     fetchOpenTrades,
//     fetchPendingOrders,
//     fetchTradeHistory,
//     placeOrder,
//     closeTrade,
//     modifyTrade,
//     cancelOrder,
//   } = useTradingStore();

//   const { symbols, fetchSymbols, updatePrice } = useMarketStore();

//   const {
//     watchlists,
//     activeWatchlistId,
//     activeSymbols,
//     setActiveWatchlistId,
//     fetchWatchlists,
//     createWatchlist,
//     fetchWatchlistSymbols,
//     addSymbol,
//     removeSymbol,
//     deleteWatchlist,
//     renameWatchlist,
//   } = useWatchlistStore();

//   // Core
//   const [selectedAccount, setSelectedAccount] = useState(null);
//   const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE');
//   const [symbolData, setSymbolData] = useState(null);

//   // Tabs (mobile)
//   const [activeTab, setActiveTab] = useState('trade');

//   // Quotes
//   const [quotesViewMode, setQuotesViewMode] = useState('advanced'); // simple | advanced
//   const [selectedCategory, setSelectedCategory] = useState('all');
//   const [searchTerm, setSearchTerm] = useState('');

//   // UI dropdown
//   const [isWatchlistDropdownOpen, setIsWatchlistDropdownOpen] = useState(false);
//   const [editingWatchlistId, setEditingWatchlistId] = useState(null);
//   const [editingWatchlistName, setEditingWatchlistName] = useState('');
//   const watchlistDropdownRef = useRef(null);

//   // Chart
//   const [chartMode, setChartMode] = useState('candles');
//   const [timeframe, setTimeframe] = useState('15m');
//   const [crosshairEnabled, setCrosshairEnabled] = useState(false);
//   const [chartFullscreen, setChartFullscreen] = useState(false);

//   // Trade
//   const [orderType, setOrderType] = useState('market'); // backend currently supports market
//   const [quantity, setQuantity] = useState(1);
//   const [stopLoss, setStopLoss] = useState('');
//   const [takeProfit, setTakeProfit] = useState('');
//   const [entryPrice, setEntryPrice] = useState('');
//   const [showOrderModal, setShowOrderModal] = useState(false);
//   const [tradeTabSection, setTradeTabSection] = useState('positions');
//   const [modifyModal, setModifyModal] = useState(null);

//   // History
//   const [historyPeriod, setHistoryPeriod] = useState('month');
//   const [historyViewMode, setHistoryViewMode] = useState('positions'); // positions | orders | deals
//   const [historyFilter, setHistoryFilter] = useState('all'); // all | profit | loss

//   // Messages
//   const [messages, setMessages] = useState([]);
//   const [unreadCount, setUnreadCount] = useState(0);
//   const [messageCategory, setMessageCategory] = useState('all'); // all | system | trade | broker | news

//   // Socket init
//   const socketInitializedRef = useRef(false);

//   // ---------- Initialization ----------
//   useEffect(() => {
//     if (accounts?.length) {
//       const demo = accounts.find((a) => a.is_demo);
//       setSelectedAccount(demo || accounts[0]);
//     }
//     fetchSymbols();
//   }, [accounts, fetchSymbols]);

//   useEffect(() => {
//     if (!selectedAccount?.id) return;
//     fetchOpenTrades(selectedAccount.id);
//     fetchPendingOrders?.(selectedAccount.id);
//     fetchTradeHistory(selectedAccount.id);
//   }, [selectedAccount, fetchOpenTrades, fetchPendingOrders, fetchTradeHistory]);

//   useEffect(() => {
//     const initWatchlists = async () => {
//       try {
//         const list = await fetchWatchlists();

//         if (!list.length) {
//           const created = await createWatchlist('Default', true);
//           setActiveWatchlistId(created.id);
//           await fetchWatchlistSymbols(created.id);
//           return;
//         }

//         let activeId = activeWatchlistId;
//         if (!activeId || !list.some((w) => w.id === activeId)) {
//           const def = list.find((w) => w.is_default) || list[0];
//           activeId = def.id;
//           setActiveWatchlistId(activeId);
//         }

//         await fetchWatchlistSymbols(activeId);
//       } catch (e) {
//         console.error(e);
//         toast.error('Failed to initialize watchlists');
//       }
//     };

//     initWatchlists();
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, []);

//   // Quote poll (used for current bid/ask header)
//   useEffect(() => {
//     const fetchQuote = async () => {
//       try {
//         const res = await api.get(`/market/quote/${selectedSymbol}`);
//         setSymbolData(res.data?.data || null);
//       } catch (err) {
//         console.error(err);
//       }
//     };

//     if (selectedSymbol) fetchQuote();
//     const t = setInterval(fetchQuote, 2000);
//     return () => clearInterval(t);
//   }, [selectedSymbol]);

//   // Socket price updates + message feed
//   useEffect(() => {
//     const token = localStorage.getItem('token');
//     if (!token) return;

//     if (!socketInitializedRef.current) {
//       socketInitializedRef.current = true;
//       socketService.connect(token);
//     }

//     const onPrice = (data) => updatePrice(data);

//     const pushMessage = (m) => {
//       setMessages((prev) => [m, ...prev].slice(0, 200));
//       setUnreadCount((c) => c + 1);
//     };

//     const onConnected = (payload) => {
//       pushMessage({
//         id: `connected-${Date.now()}`,
//         type: 'system',
//         title: 'Connected',
//         message: payload?.message || 'Connected to server',
//         time: new Date().toISOString(),
//         read: false,
//       });
//     };

//     const onTradePnl = (payload) => {
//       pushMessage({
//         id: `pnl-${payload?.tradeId || Date.now()}`,
//         type: 'trade',
//         title: 'P&L Update',
//         message: `${payload?.symbol || ''} P&L: ${payload?.profit || ''}`,
//         time: new Date().toISOString(),
//         read: false,
//       });
//     };

//     const onTradeNotification = (payload) => {
//       pushMessage({
//         id: `trade-${Date.now()}`,
//         type: 'trade',
//         title: `Trade ${payload?.type || 'update'}`,
//         message: payload?.trade ? JSON.stringify(payload.trade) : 'Trade update received',
//         time: new Date().toISOString(),
//         read: false,
//       });
//     };

//     const onTxnNotification = (payload) => {
//       pushMessage({
//         id: `txn-${Date.now()}`,
//         type: 'system',
//         title: 'Transaction',
//         message: payload?.transaction ? JSON.stringify(payload.transaction) : 'Transaction update received',
//         time: new Date().toISOString(),
//         read: false,
//       });
//     };

//     socketService.subscribe('price:update', onPrice);
//     socketService.subscribe('connected', onConnected);
//     socketService.subscribe('trade:pnl', onTradePnl);
//     socketService.subscribe('trade:notification', onTradeNotification);
//     socketService.subscribe('transaction:notification', onTxnNotification);

//     if (activeSymbols?.length) socketService.subscribeSymbols(activeSymbols);

//     return () => {
//       socketService.unsubscribe('price:update');
//       socketService.unsubscribe('connected');
//       socketService.unsubscribe('trade:pnl');
//       socketService.unsubscribe('trade:notification');
//       socketService.unsubscribe('transaction:notification');
//     };
//   }, [updatePrice, activeSymbols]);

//   useEffect(() => {
//     return () => {
//       socketInitializedRef.current = false;
//       socketService.disconnect();
//     };
//   }, []);

//   // Close dropdown on outside click
//   useEffect(() => {
//     const onDocDown = (event) => {
//       if (watchlistDropdownRef.current && !watchlistDropdownRef.current.contains(event.target)) {
//         setIsWatchlistDropdownOpen(false);
//         setEditingWatchlistId(null);
//       }
//     };
//     document.addEventListener('mousedown', onDocDown);
//     return () => document.removeEventListener('mousedown', onDocDown);
//   }, []);

//   // ---------- Computed ----------
//   const bid = Number(symbolData?.bid || 0);
//   const ask = Number(symbolData?.ask || 0);
//   const totalPnL = (openTrades || []).reduce((sum, t) => sum + Number(t.profit || 0), 0);

//   const accountStats = useMemo(() => {
//     const balance = Number(selectedAccount?.balance || 0);
//     const equity = balance + totalPnL;
//     const margin = Number(selectedAccount?.margin || 0);
//     const freeMargin = equity - margin;
//     return { balance, equity, margin, freeMargin, leverage: selectedAccount?.leverage || 5 };
//   }, [selectedAccount, totalPnL]);

//   const currentWatchlist = watchlists.find((w) => w.id === activeWatchlistId);

//   const filteredSymbols = useMemo(() => {
//     let list = symbols || [];

//     list = list.filter((s) => matchesSelectedCategory(s, selectedCategory));

//     if (searchTerm.trim()) {
//       const term = searchTerm.trim().toLowerCase();
//       return list.filter((s) => {
//         const sym = String(s.symbol || '').toLowerCase();
//         const dn = String(s.display_name || '').toLowerCase();
//         return sym.includes(term) || dn.includes(term);
//       });
//     }

//     // no search => show watchlist symbols
//     const wl = new Set((activeSymbols || []).map((x) => String(x).toUpperCase()));
//     return list.filter((s) => wl.has(String(s.symbol).toUpperCase()));
//   }, [symbols, searchTerm, selectedCategory, activeSymbols]);

//   const filteredHistoryTrades = useMemo(() => {
//     const start = getPeriodStart(historyPeriod);
//     let list = tradeHistory || [];

//     if (start) {
//       list = list.filter((t) => {
//         const ct = t.close_time || t.closeTime;
//         if (!ct) return false;
//         return new Date(ct) >= start;
//       });
//     }

//     if (historyFilter === 'profit') list = list.filter((t) => Number(t.profit || 0) > 0);
//     if (historyFilter === 'loss') list = list.filter((t) => Number(t.profit || 0) < 0);

//     return list;
//   }, [tradeHistory, historyPeriod, historyFilter]);

//   const filteredMessages = useMemo(() => {
//     if (messageCategory === 'all') return messages;
//     return messages.filter((m) => m.type === messageCategory);
//   }, [messages, messageCategory]);

//   // ---------- Actions ----------
//   const handleCreateWatchlist = async (e) => {
//     e?.stopPropagation();
//     const name = window.prompt('New watchlist name?');
//     if (!name) return;
//     try {
//       const created = await createWatchlist(name.trim(), false);
//       setActiveWatchlistId(created.id);
//       await fetchWatchlistSymbols(created.id);
//       toast.success('Watchlist created');
//       setIsWatchlistDropdownOpen(false);
//     } catch (err) {
//       console.error(err);
//       toast.error('Failed to create watchlist');
//     }
//   };

//   const handleSwitchWatchlist = async (id, e) => {
//     e?.stopPropagation();
//     setActiveWatchlistId(id);
//     await fetchWatchlistSymbols(id);
//     setIsWatchlistDropdownOpen(false);
//   };

//   const startRename = (wl, e) => {
//     e?.stopPropagation();
//     setEditingWatchlistId(wl.id);
//     setEditingWatchlistName(wl.name);
//   };

//   const submitRename = async (wlId) => {
//     if (!editingWatchlistName.trim()) {
//       setEditingWatchlistId(null);
//       return;
//     }
//     const res = await renameWatchlist(wlId, editingWatchlistName.trim());
//     if (res?.success === false) toast.error(res.message || 'Rename failed');
//     else toast.success('Renamed');
//     setEditingWatchlistId(null);
//   };

//   const handleDeleteWatchlist = async (wlId, e) => {
//     e?.stopPropagation();
//     if (!window.confirm('Delete this watchlist?')) return;
//     const res = await deleteWatchlist(wlId);
//     if (res?.success === false) toast.error(res.message || 'Delete failed');
//     else toast.success('Deleted');
//   };

//   const toggleSymbolInWatchlist = async (sym) => {
//     if (!activeWatchlistId) return toast.error('No active watchlist');
//     const s = String(sym).toUpperCase();
//     const exists = (activeSymbols || []).includes(s);
//     const res = exists
//       ? await removeSymbol(activeWatchlistId, s)
//       : await addSymbol(activeWatchlistId, s);

//     if (res?.success === false) toast.error(res.message || 'Failed');
//   };

//   // Fix: was missing; used by desktop right panel too
//   const placeOrderWithQty = async (type, qty) => {
//     if (!selectedAccount?.id || !selectedSymbol) return;

//     const result = await placeOrder({
//       accountId: selectedAccount.id,
//       symbol: selectedSymbol,
//       type, // buy/sell
//       orderType: 'market', // backend supports market now
//       quantity: Number(qty || 1),
//       stopLoss: stopLoss ? Number(stopLoss) : 0,
//       takeProfit: takeProfit ? Number(takeProfit) : 0,
//       price: entryPrice ? Number(entryPrice) : 0,
//     });

//     if (result.success) {
//       toast.success(`${type.toUpperCase()} ${qty} ${selectedSymbol}`);
//       fetchOpenTrades(selectedAccount.id);
//       fetchPendingOrders?.(selectedAccount.id);
//       setShowOrderModal(false);
//     } else {
//       toast.error(result.message || 'Order failed');
//     }
//   };

//   const handleCloseTrade = async (tradeId) => {
//     const result = await closeTrade(tradeId, selectedAccount?.id);
//     if (result.success) toast.success('Position closed');
//     else toast.error(result.message || 'Close failed');
//   };

//   const handleModifyTrade = async (tradeId, newSL, newTP) => {
//     const result = await modifyTrade?.(tradeId, { stopLoss: newSL, takeProfit: newTP });
//     if (result?.success) {
//       toast.success('Modified');
//       setModifyModal(null);
//       fetchOpenTrades(selectedAccount.id);
//     } else {
//       toast.error(result?.message || 'Modify failed');
//     }
//   };

//   const markAllRead = () => {
//     setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
//     setUnreadCount(0);
//   };

//   // ============ MOBILE NAV ============
//   const MobileNav = () => {
//     const tabs = [
//       { id: 'quotes', icon: List, label: 'Quotes' },
//       { id: 'chart', icon: BarChart2, label: 'Chart' },
//       { id: 'trade', icon: TrendingUp, label: 'Trade' },
//       { id: 'history', icon: Clock, label: 'History' },
//       { id: 'messages', icon: MessageSquare, label: 'Messages', badge: unreadCount },
//       { id: 'settings', icon: Settings, label: 'Settings' },
//     ];

//     if (isAdmin) {
//       tabs.splice(5, 0, { id: 'admin', icon: User, label: 'Admin' });
//     }

//     return (
//       <div
//         className="fixed bottom-0 left-0 right-0 h-14 flex items-center justify-around border-t z-50 lg:hidden"
//         style={{ background: '#1e222d', borderColor: '#363a45' }}
//       >
//         {tabs.map((tab) => (
//           <button
//             key={tab.id}
//             onClick={() => setActiveTab(tab.id)}
//             className="flex flex-col items-center justify-center flex-1 h-full relative"
//             style={{ color: activeTab === tab.id ? '#2962ff' : '#787b86' }}
//           >
//             <tab.icon size={20} />
//             <span className="text-[10px] mt-0.5">{tab.label}</span>
//             {tab.badge > 0 && (
//               <span className="absolute top-1 right-1/4 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
//                 {tab.badge}
//               </span>
//             )}
//           </button>
//         ))}
//       </div>
//     );
//   };

//   // ============ QUOTES TAB ============
//   const QuotesTab = () => (
//     <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
//       <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//         {/* Watchlist dropdown */}
//         <div className="relative mb-3" ref={watchlistDropdownRef}>
//           <button
//             onClick={(e) => {
//               e.stopPropagation();
//               setIsWatchlistDropdownOpen((v) => !v);
//             }}
//             className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium"
//             style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
//           >
//             <div className="flex items-center gap-2">
//               <Star size={16} color="#f5c542" fill="#f5c542" />
//               <span>{currentWatchlist?.name || 'Select Watchlist'}</span>
//             </div>
//             <ChevronDown size={18} className={`transition-transform ${isWatchlistDropdownOpen ? 'rotate-180' : ''}`} />
//           </button>

//           {isWatchlistDropdownOpen && (
//             <div
//               className="absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-50 overflow-hidden"
//               style={{ background: '#2a2e39', borderColor: '#363a45' }}
//             >
//               <div className="max-h-60 overflow-y-auto">
//                 {(watchlists || []).map((wl) => (
//                   <div
//                     key={wl.id}
//                     className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 cursor-pointer border-b"
//                     style={{ borderColor: '#363a45' }}
//                     onClick={(e) => handleSwitchWatchlist(wl.id, e)}
//                   >
//                     {editingWatchlistId === wl.id ? (
//                       <input
//                         value={editingWatchlistName}
//                         onChange={(e) => setEditingWatchlistName(e.target.value)}
//                         onBlur={() => submitRename(wl.id)}
//                         onKeyDown={(e) => {
//                           if (e.key === 'Enter') submitRename(wl.id);
//                           if (e.key === 'Escape') setEditingWatchlistId(null);
//                         }}
//                         onClick={(e) => e.stopPropagation()}
//                         className="flex-1 bg-transparent border-b outline-none text-sm"
//                         style={{ color: '#d1d4dc', borderColor: '#2962ff' }}
//                         autoFocus
//                       />
//                     ) : (
//                       <div className="flex items-center gap-2 flex-1">
//                         <Star
//                           size={14}
//                           color={wl.id === activeWatchlistId ? '#f5c542' : '#787b86'}
//                           fill={wl.id === activeWatchlistId ? '#f5c542' : 'none'}
//                         />
//                         <span style={{ color: '#d1d4dc' }}>{wl.name}</span>
//                       </div>
//                     )}

//                     <div className="flex items-center gap-1">
//                       <button
//                         onClick={(e) => startRename(wl, e)}
//                         className="p-1.5 rounded hover:bg-white/10"
//                         title="Rename"
//                       >
//                         <Edit3 size={14} color="#787b86" />
//                       </button>

//                       {!wl.is_default && (
//                         <button
//                           onClick={(e) => handleDeleteWatchlist(wl.id, e)}
//                           className="p-1.5 rounded hover:bg-red-500/20"
//                           title="Delete"
//                         >
//                           <Trash2 size={14} color="#ef5350" />
//                         </button>
//                       )}
//                     </div>
//                   </div>
//                 ))}
//               </div>

//               <button
//                 onClick={handleCreateWatchlist}
//                 className="w-full flex items-center gap-2 px-3 py-3 hover:bg-white/5 text-sm font-medium"
//                 style={{ color: '#2962ff', borderTop: '1px solid #363a45' }}
//               >
//                 <Plus size={16} />
//                 Create New Watchlist
//               </button>
//             </div>
//           )}
//         </div>

//         {/* View mode */}
//         <div className="flex items-center gap-2 mb-3">
//           <button
//             onClick={() => setQuotesViewMode('simple')}
//             className="flex-1 py-2 rounded-lg text-xs font-semibold"
//             style={{
//               background: quotesViewMode === 'simple' ? '#2962ff' : '#2a2e39',
//               color: quotesViewMode === 'simple' ? '#fff' : '#787b86',
//             }}
//           >
//             Simple
//           </button>
//           <button
//             onClick={() => setQuotesViewMode('advanced')}
//             className="flex-1 py-2 rounded-lg text-xs font-semibold"
//             style={{
//               background: quotesViewMode === 'advanced' ? '#2962ff' : '#2a2e39',
//               color: quotesViewMode === 'advanced' ? '#fff' : '#787b86',
//             }}
//           >
//             Advanced
//           </button>
//         </div>

//         {/* Category tabs */}
//         <div className="flex gap-1 overflow-x-auto pb-2">
//           {SYMBOL_CATEGORIES.map((cat) => (
//             <button
//               key={cat.id}
//               onClick={() => setSelectedCategory(cat.id)}
//               className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
//               style={{
//                 background: selectedCategory === cat.id ? '#2962ff' : '#2a2e39',
//                 color: selectedCategory === cat.id ? '#fff' : '#787b86',
//               }}
//             >
//               {cat.label}
//             </button>
//           ))}
//         </div>

//         {/* Search */}
//         <div className="relative mt-2">
//           <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#787b86' }} />
//           <input
//             type="text"
//             value={searchTerm}
//             onChange={(e) => setSearchTerm(e.target.value)}
//             placeholder="Search symbols..."
//             className="w-full pl-9 pr-9 py-2 rounded border text-sm"
//             style={{
//               background: '#2a2e39',
//               borderColor: '#363a45',
//               color: '#d1d4dc',
//             }}
//             autoCorrect="off"
//             autoCapitalize="none"
//             spellCheck={false}
//           />
//           {searchTerm?.length > 0 && (
//             <button
//               type="button"
//               onClick={() => setSearchTerm('')}
//               className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10"
//               aria-label="Clear search"
//             >
//               <X size={14} color="#787b86" />
//             </button>
//           )}
//         </div>
//       </div>

//       {/* Column headers */}
//       <div
//         className={`grid px-3 py-2 text-xs font-medium border-b ${
//           quotesViewMode === 'advanced' ? 'grid-cols-6' : 'grid-cols-3'
//         }`}
//         style={{ background: '#252832', borderColor: '#363a45', color: '#787b86' }}
//       >
//         <div>Symbol</div>
//         <div className="text-right">Bid</div>
//         <div className="text-right">Ask</div>
//         {quotesViewMode === 'advanced' && (
//           <>
//             <div className="text-right">Spread</div>
//             <div className="text-right">Low/High</div>
//             <div className="text-right">Chg%</div>
//           </>
//         )}
//       </div>

//       {/* List */}
//       <div className="flex-1 overflow-y-auto">
//         {filteredSymbols.length === 0 ? (
//           <div className="p-6 text-center" style={{ color: '#787b86' }}>
//             {searchTerm ? 'No symbols found' : 'Watchlist is empty'}
//           </div>
//         ) : (
//           filteredSymbols.map((sym) => {
//             const isSelected = selectedSymbol === sym.symbol;
//             const inWL = (activeSymbols || []).includes(String(sym.symbol).toUpperCase());
//             const change = Number(sym.change_percent || 0);

//             const symBid = Number(sym.bid || sym.last_price || 0);
//             const symAsk = Number(sym.ask || sym.last_price || 0);
//             const symSpread = Math.max(0, symAsk - symBid);

//             const symLow = Number(sym.low || 0);
//             const symHigh = Number(sym.high || 0);

//             return (
//               <div
//                 key={sym.symbol}
//                 onClick={() => {
//                   setSelectedSymbol(sym.symbol);
//                   setActiveTab('chart'); // FIX: redirect to chart
//                 }}
//                 className={`grid items-center px-3 py-3 border-b cursor-pointer hover:bg-white/5 ${
//                   quotesViewMode === 'advanced' ? 'grid-cols-6' : 'grid-cols-3'
//                 }`}
//                 style={{
//                   background: isSelected ? '#2a2e39' : 'transparent',
//                   borderColor: '#363a45',
//                   borderLeft: isSelected ? '3px solid #2962ff' : '3px solid transparent',
//                 }}
//               >
//                 <div className="flex items-center gap-2 min-w-0">
//                   <button
//                     onClick={(e) => {
//                       e.stopPropagation();
//                       toggleSymbolInWatchlist(sym.symbol);
//                     }}
//                     className="shrink-0"
//                     title={inWL ? 'Remove from watchlist' : 'Add to watchlist'}
//                   >
//                     <Star size={12} color={inWL ? '#f5c542' : '#787b86'} fill={inWL ? '#f5c542' : 'none'} />
//                   </button>
//                   <div className="min-w-0">
//                     <div className="font-semibold text-sm truncate" style={{ color: '#d1d4dc' }}>
//                       {sym.symbol}
//                     </div>
//                     {quotesViewMode === 'advanced' && (
//                       <div className="text-[10px] truncate" style={{ color: '#787b86' }}>
//                         {sym.display_name}
//                       </div>
//                     )}
//                   </div>
//                 </div>

//                 <div className="text-right text-sm font-mono" style={{ color: '#ef5350' }}>
//                   {symBid.toFixed(2)}
//                 </div>
//                 <div className="text-right text-sm font-mono" style={{ color: '#26a69a' }}>
//                   {symAsk.toFixed(2)}
//                 </div>

//                 {quotesViewMode === 'advanced' && (
//                   <>
//                     <div className="text-right text-xs" style={{ color: '#787b86' }}>
//                       {symSpread.toFixed(2)}
//                     </div>
//                     <div className="text-right text-[10px]" style={{ color: '#787b86' }}>
//                       <div>{symLow.toFixed(2)}</div>
//                       <div>{symHigh.toFixed(2)}</div>
//                     </div>
//                     <div className="text-right">
//                       <span className="text-xs font-semibold" style={{ color: change >= 0 ? '#26a69a' : '#ef5350' }}>
//                         {change >= 0 ? '+' : ''}
//                         {change.toFixed(2)}%
//                       </span>
//                     </div>
//                   </>
//                 )}
//               </div>
//             );
//           })
//         )}
//       </div>
//     </div>
//   );

//   // ============ CHART TAB ============
//   const ChartTab = () => {
//     const chartHeight = chartFullscreen ? window.innerHeight - 140 : 420;

//     return (
//       <div className={`flex flex-col h-full ${chartFullscreen ? 'fixed inset-0 z-50' : ''}`} style={{ background: '#131722' }}>
//         {/* Header */}
//         <div className="flex items-center justify-between p-2 border-b" style={{ borderColor: '#363a45', background: '#1e222d' }}>
//           <div className="flex items-center gap-2">
//             <span className="font-bold" style={{ color: '#d1d4dc' }}>{selectedSymbol}</span>
//             <span className="text-sm" style={{ color: '#787b86' }}>
//               {bid ? `Bid ${bid.toFixed(2)}` : ''}
//             </span>
//           </div>
//           <div className="flex items-center gap-1">
//             <button
//               onClick={() => setCrosshairEnabled((v) => !v)}
//               className="p-1.5 rounded"
//               style={{ background: crosshairEnabled ? '#2962ff' : 'transparent' }}
//               title="Crosshair"
//             >
//               <Crosshair size={16} color={crosshairEnabled ? '#fff' : '#787b86'} />
//             </button>
//             <button onClick={() => setChartFullscreen((v) => !v)} className="p-1.5 rounded" title="Fullscreen">
//               {chartFullscreen ? <Minimize2 size={16} color="#787b86" /> : <Maximize2 size={16} color="#787b86" />}
//             </button>
//           </div>
//         </div>

//         {/* Controls */}
//         <div className="flex items-center gap-1 p-2 overflow-x-auto border-b" style={{ borderColor: '#363a45', background: '#1e222d' }}>
//           {TIMEFRAMES.map((tf) => (
//             <button
//               key={tf.id}
//               onClick={() => setTimeframe(tf.value)}
//               className="px-2 py-1 rounded text-xs font-medium"
//               style={{
//                 background: timeframe === tf.value ? '#2962ff' : 'transparent',
//                 color: timeframe === tf.value ? '#fff' : '#787b86',
//               }}
//             >
//               {tf.label}
//             </button>
//           ))}

//           <div className="h-4 w-px mx-1" style={{ background: '#363a45' }} />

//           {CHART_TYPES.map((ct) => (
//             <button
//               key={ct.id}
//               onClick={() => setChartMode(ct.id)}
//               className="px-2 py-1 rounded text-xs font-medium"
//               style={{
//                 background: chartMode === ct.id ? '#2962ff' : 'transparent',
//                 color: chartMode === ct.id ? '#fff' : '#787b86',
//               }}
//             >
//               {ct.label}
//             </button>
//           ))}
//         </div>

//         {/* Chart */}
//         <div className="flex-1 relative">
//           {!selectedSymbol ? (
//             <div className="p-6 text-center" style={{ color: '#787b86' }}>
//               Select a symbol from Quotes.
//             </div>
//           ) : (
//             <PriceChart
//               symbol={selectedSymbol}
//               timeframe={timeframe}
//               mode={chartMode}
//               height={chartHeight}
//               crosshairEnabled={crosshairEnabled}
//             />
//           )}

//           {/* One-click trading (avoid bottom nav overlap) */}
//           <div
//             className="absolute left-4 right-4 rounded-lg p-3"
//             style={{ bottom: chartFullscreen ? 12 : 70, background: 'rgba(30, 34, 45, 0.95)', border: '1px solid #363a45' }}
//           >
//             <div className="flex items-center justify-between mb-2">
//               <span className="text-xs" style={{ color: '#787b86' }}>Quantity</span>
//               <input
//                 type="number"
//                 value={quantity}
//                 onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
//                 className="w-20 px-2 py-1 rounded text-xs text-center"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 min="1"
//               />
//             </div>

//             <div className="grid grid-cols-2 gap-2">
//               <button
//                 onClick={() => placeOrderWithQty('sell', quantity)}
//                 className="py-3 rounded-lg font-bold text-white"
//                 style={{ background: '#ef5350' }}
//               >
//                 SELL {bid.toFixed(2)}
//               </button>
//               <button
//                 onClick={() => placeOrderWithQty('buy', quantity)}
//                 className="py-3 rounded-lg font-bold text-white"
//                 style={{ background: '#26a69a' }}
//               >
//                 BUY {ask.toFixed(2)}
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>
//     );
//   };

//   // ============ ORDER MODAL ============
//   const OrderModal = () => (
//     <div className="fixed inset-0 z-50 bg-black/60 flex items-end lg:items-center justify-center">
//       <div
//         className="w-full lg:max-w-md lg:rounded-lg rounded-t-xl max-h-[90vh] overflow-hidden flex flex-col"
//         style={{ background: '#1e222d', border: '1px solid #363a45' }}
//       >
//         <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: '#363a45' }}>
//           <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>New Order</h3>
//           <button onClick={() => setShowOrderModal(false)}>
//             <X size={22} color="#787b86" />
//           </button>
//         </div>

//         <div className="p-4 space-y-4 overflow-y-auto">
//           <div>
//             <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Symbol</label>
//             <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: '#2a2e39' }}>
//               <span className="font-bold" style={{ color: '#d1d4dc' }}>{selectedSymbol}</span>
//               <div className="text-right">
//                 <div className="text-sm" style={{ color: '#ef5350' }}>{bid.toFixed(2)}</div>
//                 <div className="text-sm" style={{ color: '#26a69a' }}>{ask.toFixed(2)}</div>
//               </div>
//             </div>
//           </div>

//           {/* Backend supports market now; keep UI simple */}
//           <div>
//             <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Order Type</label>
//             <select
//               value={orderType}
//               onChange={(e) => setOrderType(e.target.value)}
//               className="w-full px-3 py-3 rounded-lg"
//               style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//             >
//               <option value="market">Market</option>
//             </select>
//             <div className="text-[11px] mt-1" style={{ color: '#787b86' }}>
//               Pending orders will be enabled after backend activation.
//             </div>
//           </div>

//           <div>
//             <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Quantity</label>
//             <div className="flex items-center gap-2">
//               <button
//                 onClick={() => setQuantity((q) => Math.max(1, q - 1))}
//                 className="w-12 h-12 rounded-lg text-xl"
//                 style={{ background: '#2a2e39', color: '#d1d4dc' }}
//               >
//                 -
//               </button>
//               <input
//                 type="number"
//                 value={quantity}
//                 onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
//                 className="flex-1 text-center py-3 rounded-lg text-lg font-bold"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 min="1"
//               />
//               <button
//                 onClick={() => setQuantity((q) => q + 1)}
//                 className="w-12 h-12 rounded-lg text-xl"
//                 style={{ background: '#2a2e39', color: '#d1d4dc' }}
//               >
//                 +
//               </button>
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-3">
//             <div>
//               <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Stop Loss</label>
//               <input
//                 type="number"
//                 value={stopLoss}
//                 onChange={(e) => setStopLoss(e.target.value)}
//                 className="w-full px-3 py-3 rounded-lg"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 placeholder="0"
//               />
//             </div>
//             <div>
//               <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Take Profit</label>
//               <input
//                 type="number"
//                 value={takeProfit}
//                 onChange={(e) => setTakeProfit(e.target.value)}
//                 className="w-full px-3 py-3 rounded-lg"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 placeholder="0"
//               />
//             </div>
//           </div>

//           <div className="p-3 rounded-lg" style={{ background: '#252832' }}>
//             <div className="flex justify-between text-sm">
//               <span style={{ color: '#787b86' }}>Est. Margin</span>
//               <span style={{ color: '#d1d4dc' }}>
//                 ₹{(((ask || 0) * (quantity || 1)) / (accountStats.leverage || 5)).toFixed(2)}
//               </span>
//             </div>
//           </div>
//         </div>

//         {/* FIX: Sticky execution buttons always visible */}
//         <div className="p-4 border-t shrink-0" style={{ borderColor: '#363a45', background: '#1e222d' }}>
//           <div className="grid grid-cols-2 gap-3">
//             <button
//               onClick={() => placeOrderWithQty('sell', quantity)}
//               className="py-4 rounded-lg font-bold text-white text-lg"
//               style={{ background: '#ef5350' }}
//             >
//               SELL
//             </button>
//             <button
//               onClick={() => placeOrderWithQty('buy', quantity)}
//               className="py-4 rounded-lg font-bold text-white text-lg"
//               style={{ background: '#26a69a' }}
//             >
//               BUY
//             </button>
//           </div>
//         </div>
//       </div>
//     </div>
//   );

//   // ============ MODIFY POSITION MODAL ============
//   const ModifyPositionModal = ({ trade }) => {
//     const [newSL, setNewSL] = useState(trade.stop_loss || '');
//     const [newTP, setNewTP] = useState(trade.take_profit || '');

//     return (
//       <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
//         <div className="w-full max-w-sm rounded-lg" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
//           <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
//             <h3 className="font-bold" style={{ color: '#d1d4dc' }}>Modify Position</h3>
//             <button onClick={() => setModifyModal(null)}>
//               <X size={20} color="#787b86" />
//             </button>
//           </div>

//           <div className="p-4 space-y-4">
//             <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
//               <div className="flex justify-between">
//                 <span style={{ color: '#787b86' }}>Symbol</span>
//                 <span style={{ color: '#d1d4dc' }}>{trade.symbol}</span>
//               </div>
//             </div>

//             <div>
//               <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Stop Loss</label>
//               <input
//                 type="number"
//                 value={newSL}
//                 onChange={(e) => setNewSL(e.target.value)}
//                 className="w-full px-3 py-3 rounded-lg"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 placeholder="0"
//               />
//             </div>

//             <div>
//               <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Take Profit</label>
//               <input
//                 type="number"
//                 value={newTP}
//                 onChange={(e) => setNewTP(e.target.value)}
//                 className="w-full px-3 py-3 rounded-lg"
//                 style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
//                 placeholder="0"
//               />
//             </div>

//             <button
//               onClick={() => handleModifyTrade(trade.id, newSL, newTP)}
//               className="w-full py-3 rounded-lg font-semibold"
//               style={{ background: '#2962ff', color: '#fff' }}
//             >
//               Modify
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   };

//   // ============ TRADE TAB ============
//   const TradeTab = () => (
//     <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
//       {/* Account summary */}
//       <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//         <div className="grid grid-cols-3 gap-2 text-center">
//           <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
//             <div className="text-[10px]" style={{ color: '#787b86' }}>Balance</div>
//             <div className="font-bold text-sm" style={{ color: '#d1d4dc' }}>₹{accountStats.balance.toFixed(2)}</div>
//           </div>
//           <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
//             <div className="text-[10px]" style={{ color: '#787b86' }}>Equity</div>
//             <div className="font-bold text-sm" style={{ color: '#d1d4dc' }}>₹{accountStats.equity.toFixed(2)}</div>
//           </div>
//           <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
//             <div className="text-[10px]" style={{ color: '#787b86' }}>P&L</div>
//             <div className="font-bold text-sm" style={{ color: totalPnL >= 0 ? '#26a69a' : '#ef5350' }}>
//               {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* Sections */}
//       <div className="flex border-b" style={{ borderColor: '#363a45' }}>
//         {[
//           { id: 'positions', label: `Positions (${openTrades.length})` },
//           { id: 'pending', label: `Pending (${pendingOrders?.length || 0})` },
//           { id: 'summary', label: 'Summary' },
//         ].map((tab) => (
//           <button
//             key={tab.id}
//             onClick={() => setTradeTabSection(tab.id)}
//             className="flex-1 py-3 text-xs font-medium border-b-2"
//             style={{
//               color: tradeTabSection === tab.id ? '#2962ff' : '#787b86',
//               borderColor: tradeTabSection === tab.id ? '#2962ff' : 'transparent',
//             }}
//           >
//             {tab.label}
//           </button>
//         ))}
//       </div>

//       <div className="flex-1 overflow-y-auto">
//         {tradeTabSection === 'positions' && (
//           <>
//             <div className="flex gap-2 p-3 border-b" style={{ borderColor: '#363a45' }}>
//               <button
//                 onClick={() => setShowOrderModal(true)}
//                 className="flex-1 py-2 rounded-lg text-xs font-semibold"
//                 style={{ background: '#2962ff', color: '#fff' }}
//               >
//                 New Order
//               </button>
//               <button
//                 onClick={() => {
//                   if (!openTrades.length) return;
//                   if (!window.confirm('Close all positions?')) return;
//                   openTrades.forEach((t) => closeTrade(t.id, selectedAccount?.id));
//                 }}
//                 className="px-3 py-2 rounded-lg text-xs"
//                 style={{ background: '#2a2e39', color: '#787b86' }}
//                 disabled={!openTrades.length}
//               >
//                 Close All
//               </button>
//             </div>

//             {openTrades.length === 0 ? (
//               <div className="p-6 text-center" style={{ color: '#787b86' }}>
//                 <div>No open positions</div>
//               </div>
//             ) : (
//               openTrades.map((trade) => {
//                 const pnl = Number(trade.profit || 0);
//                 const isProfit = pnl >= 0;

//                 return (
//                   <div key={trade.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//                     <div className="flex items-start justify-between mb-2">
//                       <div>
//                         <div className="flex items-center gap-2">
//                           <span className="font-bold" style={{ color: '#d1d4dc' }}>{trade.symbol}</span>
//                           <span
//                             className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
//                             style={{
//                               background: trade.trade_type === 'buy' ? 'rgba(38, 166, 154, 0.2)' : 'rgba(239, 83, 80, 0.2)',
//                               color: trade.trade_type === 'buy' ? '#26a69a' : '#ef5350',
//                             }}
//                           >
//                             {String(trade.trade_type || '').toUpperCase()}
//                           </span>
//                         </div>
//                         <div className="text-xs mt-1" style={{ color: '#787b86' }}>
//                           Qty {trade.quantity} @ {Number(trade.open_price || 0).toFixed(2)}
//                         </div>
//                       </div>

//                       <div className="text-right">
//                         <div className="font-bold" style={{ color: isProfit ? '#26a69a' : '#ef5350' }}>
//                           {isProfit ? '+' : ''}₹{pnl.toFixed(2)}
//                         </div>
//                       </div>
//                     </div>

//                     <div className="flex gap-2">
//                       <button
//                         onClick={() => setModifyModal(trade)}
//                         className="flex-1 py-2 rounded text-xs"
//                         style={{ background: '#2a2e39', color: '#d1d4dc' }}
//                       >
//                         Modify
//                       </button>
//                       <button
//                         onClick={() => handleCloseTrade(trade.id)}
//                         className="flex-1 py-2 rounded text-xs font-semibold"
//                         style={{ background: '#ef5350', color: '#fff' }}
//                       >
//                         Close
//                       </button>
//                     </div>
//                   </div>
//                 );
//               })
//             )}
//           </>
//         )}

//         {tradeTabSection === 'pending' && (
//           <div className="p-6 text-center" style={{ color: '#787b86' }}>
//             {pendingOrders?.length ? (
//               <div className="text-left">
//                 {pendingOrders.map((o) => (
//                   <div key={o.id} className="p-3 rounded-lg mb-2" style={{ background: '#2a2e39' }}>
//                     <div className="flex justify-between">
//                       <span style={{ color: '#d1d4dc', fontWeight: 700 }}>{o.symbol}</span>
//                       <button
//                         onClick={() => cancelOrder?.(o.id, selectedAccount?.id)}
//                         className="text-xs px-2 py-1 rounded"
//                         style={{ background: '#ef535020', color: '#ef5350' }}
//                       >
//                         Cancel
//                       </button>
//                     </div>
//                     <div className="text-xs mt-1" style={{ color: '#787b86' }}>
//                       {o.order_type} | Qty {o.quantity} | Price {Number(o.price || 0).toFixed(2)}
//                     </div>
//                   </div>
//                 ))}
//               </div>
//             ) : (
//               <div>No pending orders</div>
//             )}
//           </div>
//         )}

//         {tradeTabSection === 'summary' && (
//           <div className="p-4 space-y-3">
//             <div className="p-4 rounded-lg" style={{ background: '#2a2e39' }}>
//               <div className="flex justify-between text-sm">
//                 <span style={{ color: '#787b86' }}>Margin</span>
//                 <span style={{ color: '#d1d4dc' }}>₹{accountStats.margin.toFixed(2)}</span>
//               </div>
//               <div className="flex justify-between text-sm mt-2">
//                 <span style={{ color: '#787b86' }}>Free Margin</span>
//                 <span style={{ color: '#26a69a' }}>₹{accountStats.freeMargin.toFixed(2)}</span>
//               </div>
//             </div>
//           </div>
//         )}
//       </div>

//       {showOrderModal && <OrderModal />}
//       {modifyModal && <ModifyPositionModal trade={modifyModal} />}
//     </div>
//   );

//   // ============ HISTORY TAB ============
//   const HistoryTab = () => (
//     <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
//       <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//         <div className="flex gap-1 overflow-x-auto pb-2">
//           {HISTORY_PERIODS.map((p) => (
//             <button
//               key={p.id}
//               onClick={() => setHistoryPeriod(p.id)}
//               className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
//               style={{
//                 background: historyPeriod === p.id ? '#2962ff' : '#2a2e39',
//                 color: historyPeriod === p.id ? '#fff' : '#787b86',
//               }}
//             >
//               {p.label}
//             </button>
//           ))}
//         </div>

//         {/* View mode now actually switches dataset */}
//         <div className="flex gap-2 mt-2">
//           {[
//             { id: 'positions', label: 'Positions' },
//             { id: 'orders', label: 'Orders' },
//             { id: 'deals', label: 'Deals' },
//           ].map((m) => (
//             <button
//               key={m.id}
//               onClick={() => setHistoryViewMode(m.id)}
//               className="flex-1 py-2 rounded-lg text-xs font-medium"
//               style={{
//                 background: historyViewMode === m.id ? '#2a2e39' : 'transparent',
//                 color: historyViewMode === m.id ? '#d1d4dc' : '#787b86',
//                 border: `1px solid ${historyViewMode === m.id ? '#363a45' : 'transparent'}`,
//               }}
//             >
//               {m.label}
//             </button>
//           ))}
//         </div>
//       </div>

//       {/* Result filter */}
//       <div className="flex gap-2 p-3 border-b" style={{ borderColor: '#363a45' }}>
//         {[
//           { id: 'all', label: 'All' },
//           { id: 'profit', label: 'Profit' },
//           { id: 'loss', label: 'Loss' },
//         ].map((f) => (
//           <button
//             key={f.id}
//             onClick={() => setHistoryFilter(f.id)}
//             className="px-3 py-1.5 rounded text-xs"
//             style={{
//               background: historyFilter === f.id ? '#2a2e39' : 'transparent',
//               color: historyFilter === f.id ? '#d1d4dc' : '#787b86',
//               border: `1px solid ${historyFilter === f.id ? '#363a45' : 'transparent'}`,
//             }}
//           >
//             {f.label}
//           </button>
//         ))}
//       </div>

//       <div className="flex-1 overflow-y-auto">
//         {historyViewMode === 'positions' && (
//           <>
//             {filteredHistoryTrades.length === 0 ? (
//               <div className="p-6 text-center" style={{ color: '#787b86' }}>
//                 No closed positions for selected period.
//               </div>
//             ) : (
//               filteredHistoryTrades.map((t) => {
//                 const pnl = Number(t.profit || 0);
//                 return (
//                   <div key={t.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//                     <div className="flex items-start justify-between">
//                       <div>
//                         <div className="font-bold" style={{ color: '#d1d4dc' }}>{t.symbol}</div>
//                         <div className="text-xs" style={{ color: '#787b86' }}>
//                           {String(t.trade_type || '').toUpperCase()} | Qty {t.quantity} | {t.close_time ? new Date(t.close_time).toLocaleString() : ''}
//                         </div>
//                       </div>
//                       <div style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350', fontWeight: 800 }}>
//                         {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
//                       </div>
//                     </div>
//                   </div>
//                 );
//               })
//             )}
//           </>
//         )}

//         {historyViewMode === 'orders' && (
//           <div className="p-6" style={{ color: '#787b86' }}>
//             {/* Working: shows pending orders list as "orders" view (until order history endpoint exists) */}
//             <div className="font-semibold mb-2" style={{ color: '#d1d4dc' }}>Pending Orders</div>
//             {pendingOrders?.length ? (
//               pendingOrders.map((o) => (
//                 <div key={o.id} className="p-3 rounded-lg mb-2" style={{ background: '#2a2e39' }}>
//                   <div className="flex justify-between">
//                     <span style={{ color: '#d1d4dc', fontWeight: 700 }}>{o.symbol}</span>
//                     <span className="text-xs" style={{ color: '#787b86' }}>{o.status || 'pending'}</span>
//                   </div>
//                   <div className="text-xs mt-1">
//                     {o.order_type} | Qty {o.quantity} | Price {Number(o.price || 0).toFixed(2)}
//                   </div>
//                 </div>
//               ))
//             ) : (
//               <div>No pending orders.</div>
//             )}
//           </div>
//         )}

//         {historyViewMode === 'deals' && (
//           <div className="p-6 text-center" style={{ color: '#787b86' }}>
//             Deals view requires a dedicated deals/transactions feed. We can enable it next via backend.
//           </div>
//         )}
//       </div>
//     </div>
//   );

//   // ============ MESSAGES TAB ============
//   const MessagesTab = () => (
//     <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
//       <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
//         <div className="flex items-center justify-between mb-3">
//           <h2 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Messages</h2>
//           <button className="text-xs" style={{ color: '#2962ff' }} onClick={markAllRead}>
//             Mark All Read
//           </button>
//         </div>

//         <div className="flex gap-2 overflow-x-auto">
//           {[
//             { id: 'all', label: 'All' },
//             { id: 'system', label: 'System' },
//             { id: 'trade', label: 'Trade' },
//           ].map((c) => (
//             <button
//               key={c.id}
//               onClick={() => setMessageCategory(c.id)}
//               className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
//               style={{
//                 background: messageCategory === c.id ? '#2962ff' : '#2a2e39',
//                 color: messageCategory === c.id ? '#fff' : '#787b86',
//               }}
//             >
//               {c.label}
//             </button>
//           ))}
//         </div>
//       </div>

//       <div className="flex-1 overflow-y-auto">
//         {filteredMessages.length === 0 ? (
//           <div className="p-6 text-center" style={{ color: '#787b86' }}>
//             No messages yet.
//           </div>
//         ) : (
//           filteredMessages.map((m) => (
//             <div
//               key={m.id}
//               className="p-4 border-b"
//               style={{
//                 borderColor: '#363a45',
//                 background: m.read ? 'transparent' : 'rgba(41, 98, 255, 0.06)',
//               }}
//             >
//               <div className="flex items-start gap-3">
//                 <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#2a2e39' }}>
//                   {m.type === 'trade' ? <TrendingUp size={18} color="#26a69a" /> : <Bell size={18} color="#2962ff" />}
//                 </div>
//                 <div className="flex-1 min-w-0">
//                   <div className="flex items-center justify-between">
//                     <span className="font-semibold text-sm" style={{ color: '#d1d4dc' }}>
//                       {m.title}
//                     </span>
//                     <span className="text-xs" style={{ color: '#787b86' }}>
//                       {m.time ? new Date(m.time).toLocaleTimeString() : ''}
//                     </span>
//                   </div>
//                   <p className="text-sm mt-1" style={{ color: '#787b86', wordBreak: 'break-word' }}>
//                     {m.message}
//                   </p>
//                 </div>
//               </div>
//             </div>
//           ))
//         )}
//       </div>
//     </div>
//   );

//   // ============ SETTINGS TAB ============
//   const SettingsTab = () => {
//     const [showBalance, setShowBalance] = useState(true);

//     return (
//       <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
//         <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
//           <div className="flex items-center justify-between">
//             <div>
//               <div className="font-semibold" style={{ color: '#d1d4dc' }}>
//                 {user?.firstName} {user?.lastName}
//               </div>
//               <div className="text-xs" style={{ color: '#787b86' }}>
//                 {user?.email}
//               </div>
//             </div>
//             <button onClick={logout} className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
//               <LogOut size={16} color="#787b86" />
//             </button>
//           </div>
//         </div>

//         <div className="p-4 space-y-4 overflow-y-auto">
//           <div className="p-4 rounded-lg" style={{ background: '#2a2e39' }}>
//             <div className="flex items-center justify-between mb-2">
//               <span style={{ color: '#787b86' }}>Balance</span>
//               <button onClick={() => setShowBalance((v) => !v)}>
//                 {showBalance ? <Eye size={16} color="#787b86" /> : <EyeOff size={16} color="#787b86" />}
//               </button>
//             </div>
//             <div className="text-2xl font-bold" style={{ color: '#d1d4dc' }}>
//               {showBalance ? `₹${accountStats.balance.toFixed(2)}` : '••••••'}
//             </div>
//             <div className="text-xs mt-1" style={{ color: '#787b86' }}>
//               Leverage: 1:{accountStats.leverage}
//             </div>
//           </div>

//           <div className="grid grid-cols-2 gap-3">
//             <button
//               className="py-3 rounded-lg font-medium flex items-center justify-center gap-2"
//               style={{ background: '#26a69a', color: '#fff' }}
//             >
//               <Plus size={18} />
//               Deposit
//             </button>
//             <button
//               className="py-3 rounded-lg font-medium flex items-center justify-center gap-2"
//               style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
//             >
//               <RefreshCw size={18} />
//               Withdraw
//             </button>
//           </div>
//         </div>
//       </div>
//     );
//   };

//   // ============ ADMIN TAB (UI only, backend next) ============
//   const AdminTab = () => (
//     <div className="flex flex-col h-full p-6" style={{ background: '#1e222d', color: '#d1d4dc' }}>
//       <div className="text-lg font-bold mb-2">Admin Panel</div>
//       <div className="text-sm" style={{ color: '#787b86' }}>
//         Admin user management requires backend admin endpoints (create users, list users, roles). We can implement next.
//       </div>
//     </div>
//   );

//   // ============ MAIN RENDER ============
//   return (
//     <div className="h-screen flex flex-col" style={{ background: '#131722' }}>
//       {/* Header */}
//       <header
//         className="h-14 flex items-center justify-between px-3 border-b shrink-0"
//         style={{ background: '#1e222d', borderColor: '#363a45' }}
//       >
//         <div className="flex items-center gap-3">
//           <div
//             className="h-10 w-10 flex items-center justify-center rounded-lg overflow-hidden"
//             style={{ background: '#2a2e39' }}
//           >
//             <img src="/logo.png" alt="Trade Axis" className="h-8 w-8 object-contain" />
//           </div>
//           <div className="hidden sm:block">
//             <span className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
//               Trade Axis
//             </span>
//             <div className="text-[10px] -mt-0.5" style={{ color: '#787b86' }}>
//               Indian Markets Terminal
//             </div>
//           </div>
//         </div>

//         <div className="lg:hidden text-xs" style={{ color: '#787b86' }}>
//           <span style={{ color: totalPnL >= 0 ? '#26a69a' : '#ef5350', fontWeight: 800 }}>
//             {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
//           </span>
//         </div>

//         {/* Desktop quick logout */}
//         <div className="hidden lg:flex items-center gap-3">
//           <div className="text-xs" style={{ color: '#787b86' }}>
//             Account: <span style={{ color: '#d1d4dc' }}>{selectedAccount?.account_number || '-'}</span>
//           </div>
//           <button onClick={logout} className="px-3 py-2 rounded" style={{ background: '#2a2e39', color: '#d1d4dc' }}>
//             Logout
//           </button>
//         </div>
//       </header>

//       {/* Desktop terminal (unchanged, but now has placeOrderWithQty defined) */}
//       <div className="hidden lg:flex flex-1 overflow-hidden">
//         <DesktopTerminal
//           leftTop={
//             <MarketWatchPanel
//               symbols={symbols}
//               selectedSymbol={selectedSymbol}
//               onSelectSymbol={setSelectedSymbol}
//               watchlists={watchlists}
//               activeWatchlistId={activeWatchlistId}
//               activeSymbols={activeSymbols}
//               onSwitchWatchlist={handleSwitchWatchlist}
//               onCreateWatchlist={handleCreateWatchlist}
//               onToggleSymbol={toggleSymbolInWatchlist}
//             />
//           }
//           leftBottom={
//             <NavigatorPanel accounts={accounts} selectedAccount={selectedAccount} onSelectAccount={setSelectedAccount} />
//           }
//           centerTop={<ChartWorkspace symbol={selectedSymbol} />}
//           centerBottom={
//             <ToolboxPanel
//               accountId={selectedAccount?.id}
//               openTrades={openTrades}
//               tradeHistory={tradeHistory}
//               onCloseTrade={handleCloseTrade}
//             />
//           }
//           right={
//             <OrderDockPanel
//               symbol={selectedSymbol}
//               bid={bid}
//               ask={ask}
//               leverage={selectedAccount?.leverage || 5}
//               freeMargin={selectedAccount?.free_margin || 0}
//               onBuy={(qty) => placeOrderWithQty('buy', qty)}
//               onSell={(qty) => placeOrderWithQty('sell', qty)}
//             />
//           }
//         />
//       </div>

//       {/* Mobile content */}
//       <div className="lg:hidden flex-1 overflow-hidden pb-14">
//         {activeTab === 'quotes' && <QuotesTab />}
//         {activeTab === 'chart' && <ChartTab />}
//         {activeTab === 'trade' && <TradeTab />}
//         {activeTab === 'history' && <HistoryTab />}
//         {activeTab === 'messages' && <MessagesTab />}
//         {activeTab === 'settings' && <SettingsTab />}
//         {activeTab === 'admin' && isAdmin && <AdminTab />}
//       </div>

//       <MobileNav />
//     </div>
//   );
// };

// export default Dashboard;






// frontend/src/pages/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

import useAuthStore from '../store/authStore';
import useTradingStore from '../store/tradingStore';
import useMarketStore from '../store/marketStore';
import useWatchlistStore from '../store/watchlistStore';

import socketService from '../services/socket';
import api from '../services/api';

import {
  Search,
  TrendingUp,
  BarChart2,
  List,
  Clock,
  Star,
  Plus,
  Wallet as WalletIcon,
  ChevronDown,
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

// Indian market only (professional)
const SYMBOL_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'equity', label: 'Equity' },
  { id: 'indices', label: 'Indices' },
  { id: 'fno', label: 'F&O' },
  { id: 'etf', label: 'ETF' },
];

const HISTORY_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last Week' },
  { id: 'month', label: 'Last Month' },
  { id: '3months', label: 'Last 3 Months' },
  { id: '6months', label: 'Last 6 Months' },
  { id: 'year', label: 'Last Year' },
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

const Dashboard = () => {
  const { user, accounts, logout } = useAuthStore();
  const isAdmin = (user?.role || '').toLowerCase() === 'admin';

  const {
    openTrades,
    pendingOrders,
    tradeHistory,
    fetchOpenTrades,
    fetchPendingOrders,
    fetchTradeHistory,
    placeOrder,
    closeTrade,
    modifyTrade,
    cancelOrder,
  } = useTradingStore();

  const { symbols, fetchSymbols, updatePrice } = useMarketStore();

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

  // Core
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE');
  const [symbolData, setSymbolData] = useState(null);

  // Mobile tabs
  const [activeTab, setActiveTab] = useState('trade');

  // Wallet intent (from Settings Deposit/Withdraw)
  const [walletIntent, setWalletIntent] = useState('deposit'); // 'deposit' | 'withdraw' | 'history'

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
  const [orderType, setOrderType] = useState('market'); // backend supports market now
  const [quantity, setQuantity] = useState(1);
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [tradeTabSection, setTradeTabSection] = useState('positions');
  const [modifyModal, setModifyModal] = useState(null);

  // History
  const [historyPeriod, setHistoryPeriod] = useState('month');
  const [historyViewMode, setHistoryViewMode] = useState('positions'); // positions | orders | deals
  const [historyFilter, setHistoryFilter] = useState('all'); // all | profit | loss

  // Messages
  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageCategory, setMessageCategory] = useState('all'); // all | system | trade

  // Socket init
  const socketInitializedRef = useRef(false);

  // ---------- Account init ----------
  useEffect(() => {
    if (accounts?.length) {
      const demo = accounts.find((a) => a.is_demo);
      setSelectedAccount(demo || accounts[0]);
    }
    fetchSymbols();
  }, [accounts, fetchSymbols]);

  // Load trades when account changes
  useEffect(() => {
    if (!selectedAccount?.id) return;
    fetchOpenTrades(selectedAccount.id);
    fetchPendingOrders?.(selectedAccount.id);
    fetchTradeHistory(selectedAccount.id);
  }, [selectedAccount, fetchOpenTrades, fetchPendingOrders, fetchTradeHistory]);

  // Watchlists init
  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quote poll
  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const res = await api.get(`/market/quote/${selectedSymbol}`);
        setSymbolData(res.data?.data || null);
      } catch (err) {
        console.error(err);
      }
    };

    if (selectedSymbol) fetchQuote();
    const t = setInterval(fetchQuote, 2000);
    return () => clearInterval(t);
  }, [selectedSymbol]);

  // Socket: price updates + message feed
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
      pushMessage({
        id: `pnl-${payload?.tradeId || Date.now()}`,
        type: 'trade',
        title: 'P&L Update',
        message: `${payload?.symbol || ''} P&L: ${payload?.profit || ''}`,
        time: new Date().toISOString(),
        read: false,
      });
    };

    socketService.subscribe('price:update', onPrice);
    socketService.subscribe('connected', onConnected);
    socketService.subscribe('trade:pnl', onTradePnl);

    if (activeSymbols?.length) socketService.subscribeSymbols(activeSymbols);

    return () => {
      socketService.unsubscribe('price:update');
      socketService.unsubscribe('connected');
      socketService.unsubscribe('trade:pnl');
    };
  }, [updatePrice, activeSymbols]);

  useEffect(() => {
    return () => {
      socketInitializedRef.current = false;
      socketService.disconnect();
    };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocDown = (event) => {
      if (watchlistDropdownRef.current && !watchlistDropdownRef.current.contains(event.target)) {
        setIsWatchlistDropdownOpen(false);
        setEditingWatchlistId(null);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  // ---------- Computed ----------
  const bid = Number(symbolData?.bid || 0);
  const ask = Number(symbolData?.ask || 0);
  const totalPnL = (openTrades || []).reduce((sum, t) => sum + Number(t.profit || 0), 0);

  const accountStats = useMemo(() => {
    const balance = Number(selectedAccount?.balance || 0);
    const equity = balance + totalPnL;
    const margin = Number(selectedAccount?.margin || 0);
    const freeMargin = equity - margin;
    return { balance, equity, margin, freeMargin, leverage: selectedAccount?.leverage || 5 };
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

    // no search => show watchlist
    const wl = new Set((activeSymbols || []).map((x) => String(x).toUpperCase()));
    return list.filter((s) => wl.has(String(s.symbol).toUpperCase()));
  }, [symbols, searchTerm, selectedCategory, activeSymbols]);

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

    if (historyFilter === 'profit') list = list.filter((t) => Number(t.profit || 0) > 0);
    if (historyFilter === 'loss') list = list.filter((t) => Number(t.profit || 0) < 0);

    return list;
  }, [tradeHistory, historyPeriod, historyFilter]);

  const filteredMessages = useMemo(() => {
    if (messageCategory === 'all') return messages;
    return messages.filter((m) => m.type === messageCategory);
  }, [messages, messageCategory]);

  // ---------- Actions ----------
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
    setActiveWatchlistId(id);
    await fetchWatchlistSymbols(id);
    setIsWatchlistDropdownOpen(false);
  };

  const startRename = (wl, e) => {
    e?.stopPropagation();
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

  const placeOrderWithQty = async (type, qty) => {
    if (!selectedAccount?.id || !selectedSymbol) return;

    const result = await placeOrder({
      accountId: selectedAccount.id,
      symbol: selectedSymbol,
      type, // buy/sell
      orderType: 'market',
      quantity: Number(qty || 1),
      stopLoss: stopLoss ? Number(stopLoss) : 0,
      takeProfit: takeProfit ? Number(takeProfit) : 0,
      price: entryPrice ? Number(entryPrice) : 0,
    });

    if (result.success) {
      toast.success(`${type.toUpperCase()} ${qty} ${selectedSymbol}`);
      fetchOpenTrades(selectedAccount.id);
      fetchPendingOrders?.(selectedAccount.id);
      setShowOrderModal(false);
    } else {
      toast.error(result.message || 'Order failed');
    }
  };

  const handleCloseTrade = async (tradeId) => {
    const result = await closeTrade(tradeId, selectedAccount?.id);
    if (result.success) toast.success('Position closed');
    else toast.error(result.message || 'Close failed');
  };

  const handleModifyTrade = async (tradeId, newSL, newTP) => {
    const result = await modifyTrade?.(tradeId, { stopLoss: newSL, takeProfit: newTP });
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

  // ============ MOBILE NAV ============
  const MobileNav = () => {
    const tabs = [
      { id: 'quotes', icon: List, label: 'Quotes' },
      { id: 'chart', icon: BarChart2, label: 'Chart' },
      { id: 'trade', icon: TrendingUp, label: 'Trade' },
      { id: 'history', icon: Clock, label: 'History' },
      { id: 'messages', icon: MessageSquare, label: 'Messages', badge: unreadCount },
      { id: 'wallet', icon: WalletIcon, label: 'Wallet' }, // ✅ added
      { id: 'settings', icon: Settings, label: 'Settings' },
    ];

    if (isAdmin) {
      tabs.splice(6, 0, { id: 'admin', icon: User, label: 'Admin' });
    }

    return (
      <div
        className="fixed bottom-0 left-0 right-0 h-14 flex items-center justify-around border-t z-50 lg:hidden"
        style={{ background: '#1e222d', borderColor: '#363a45' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex flex-col items-center justify-center flex-1 h-full relative"
            style={{ color: activeTab === tab.id ? '#2962ff' : '#787b86' }}
          >
            <tab.icon size={20} />
            <span className="text-[10px] mt-0.5">{tab.label}</span>
            {tab.badge > 0 && (
              <span className="absolute top-1 right-1/4 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  };

  // ============ QUOTES TAB ============
  const QuotesTab = () => (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        {/* Watchlist dropdown */}
        <div className="relative mb-3" ref={watchlistDropdownRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsWatchlistDropdownOpen((v) => !v);
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm font-medium"
            style={{ background: '#2a2e39', borderColor: '#363a45', color: '#d1d4dc' }}
          >
            <div className="flex items-center gap-2">
              <Star size={16} color="#f5c542" fill="#f5c542" />
              <span>{currentWatchlist?.name || 'Select Watchlist'}</span>
            </div>
            <ChevronDown size={18} className={`transition-transform ${isWatchlistDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isWatchlistDropdownOpen && (
            <div
              className="absolute top-full left-0 right-0 mt-1 rounded-lg border shadow-xl z-50 overflow-hidden"
              style={{ background: '#2a2e39', borderColor: '#363a45' }}
            >
              <div className="max-h-60 overflow-y-auto">
                {(watchlists || []).map((wl) => (
                  <div
                    key={wl.id}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-white/5 cursor-pointer border-b"
                    style={{ borderColor: '#363a45' }}
                    onClick={(e) => handleSwitchWatchlist(wl.id, e)}
                  >
                    {editingWatchlistId === wl.id ? (
                      <input
                        value={editingWatchlistName}
                        onChange={(e) => setEditingWatchlistName(e.target.value)}
                        onBlur={() => submitRename(wl.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitRename(wl.id);
                          if (e.key === 'Escape') setEditingWatchlistId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-transparent border-b outline-none text-sm"
                        style={{ color: '#d1d4dc', borderColor: '#2962ff' }}
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <Star
                          size={14}
                          color={wl.id === activeWatchlistId ? '#f5c542' : '#787b86'}
                          fill={wl.id === activeWatchlistId ? '#f5c542' : 'none'}
                        />
                        <span style={{ color: '#d1d4dc' }}>{wl.name}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => startRename(wl, e)}
                        className="p-1.5 rounded hover:bg-white/10"
                        title="Rename"
                      >
                        <Edit3 size={14} color="#787b86" />
                      </button>

                      {!wl.is_default && (
                        <button
                          onClick={(e) => handleDeleteWatchlist(wl.id, e)}
                          className="p-1.5 rounded hover:bg-red-500/20"
                          title="Delete"
                        >
                          <Trash2 size={14} color="#ef5350" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleCreateWatchlist}
                className="w-full flex items-center gap-2 px-3 py-3 hover:bg-white/5 text-sm font-medium"
                style={{ color: '#2962ff', borderTop: '1px solid #363a45' }}
              >
                <Plus size={16} />
                Create New Watchlist
              </button>
            </div>
          )}
        </div>

        {/* View mode */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setQuotesViewMode('simple')}
            className="flex-1 py-2 rounded-lg text-xs font-semibold"
            style={{
              background: quotesViewMode === 'simple' ? '#2962ff' : '#2a2e39',
              color: quotesViewMode === 'simple' ? '#fff' : '#787b86',
            }}
          >
            Simple
          </button>
          <button
            onClick={() => setQuotesViewMode('advanced')}
            className="flex-1 py-2 rounded-lg text-xs font-semibold"
            style={{
              background: quotesViewMode === 'advanced' ? '#2962ff' : '#2a2e39',
              color: quotesViewMode === 'advanced' ? '#fff' : '#787b86',
            }}
          >
            Advanced
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 overflow-x-auto pb-2">
          {SYMBOL_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#787b86' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search symbols..."
            className="w-full pl-9 pr-9 py-2 rounded border text-sm"
            style={{
              background: '#2a2e39',
              borderColor: '#363a45',
              color: '#d1d4dc',
            }}
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {searchTerm?.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10"
              aria-label="Clear search"
            >
              <X size={14} color="#787b86" />
            </button>
          )}
        </div>
      </div>

      {/* Column headers */}
      <div
        className={`grid px-3 py-2 text-xs font-medium border-b ${
          quotesViewMode === 'advanced' ? 'grid-cols-6' : 'grid-cols-3'
        }`}
        style={{ background: '#252832', borderColor: '#363a45', color: '#787b86' }}
      >
        <div>Symbol</div>
        <div className="text-right">Bid</div>
        <div className="text-right">Ask</div>
        {quotesViewMode === 'advanced' && (
          <>
            <div className="text-right">Spread</div>
            <div className="text-right">Low/High</div>
            <div className="text-right">Chg%</div>
          </>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filteredSymbols.length === 0 ? (
          <div className="p-6 text-center" style={{ color: '#787b86' }}>
            {searchTerm ? 'No symbols found' : 'Watchlist is empty'}
          </div>
        ) : (
          filteredSymbols.map((sym) => {
            const isSelected = selectedSymbol === sym.symbol;
            const inWL = (activeSymbols || []).includes(String(sym.symbol).toUpperCase());
            const change = Number(sym.change_percent || 0);

            const symBid = Number(sym.bid || sym.last_price || 0);
            const symAsk = Number(sym.ask || sym.last_price || 0);
            const symSpread = Math.max(0, symAsk - symBid);

            const symLow = Number(sym.low || 0);
            const symHigh = Number(sym.high || 0);

            return (
              <div
                key={sym.symbol}
                onClick={() => {
                  setSelectedSymbol(sym.symbol);
                  setActiveTab('chart'); // ✅ redirect to chart
                }}
                className={`grid items-center px-3 py-3 border-b cursor-pointer hover:bg-white/5 ${
                  quotesViewMode === 'advanced' ? 'grid-cols-6' : 'grid-cols-3'
                }`}
                style={{
                  background: isSelected ? '#2a2e39' : 'transparent',
                  borderColor: '#363a45',
                  borderLeft: isSelected ? '3px solid #2962ff' : '3px solid transparent',
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSymbolInWatchlist(sym.symbol);
                    }}
                    className="shrink-0"
                    title={inWL ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    <Star size={12} color={inWL ? '#f5c542' : '#787b86'} fill={inWL ? '#f5c542' : 'none'} />
                  </button>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate" style={{ color: '#d1d4dc' }}>
                      {sym.symbol}
                    </div>
                    {quotesViewMode === 'advanced' && (
                      <div className="text-[10px] truncate" style={{ color: '#787b86' }}>
                        {sym.display_name}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right text-sm font-mono" style={{ color: '#ef5350' }}>
                  {symBid.toFixed(2)}
                </div>
                <div className="text-right text-sm font-mono" style={{ color: '#26a69a' }}>
                  {symAsk.toFixed(2)}
                </div>

                {quotesViewMode === 'advanced' && (
                  <>
                    <div className="text-right text-xs" style={{ color: '#787b86' }}>
                      {symSpread.toFixed(2)}
                    </div>
                    <div className="text-right text-[10px]" style={{ color: '#787b86' }}>
                      <div>{symLow.toFixed(2)}</div>
                      <div>{symHigh.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold" style={{ color: change >= 0 ? '#26a69a' : '#ef5350' }}>
                        {change >= 0 ? '+' : ''}
                        {change.toFixed(2)}%
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  // ============ CHART TAB ============
  const ChartTab = () => {
    const chartHeight = chartFullscreen ? window.innerHeight - 140 : 420;

    return (
      <div className={`flex flex-col h-full ${chartFullscreen ? 'fixed inset-0 z-50' : ''}`} style={{ background: '#131722' }}>
        <div className="flex items-center justify-between p-2 border-b" style={{ borderColor: '#363a45', background: '#1e222d' }}>
          <div className="flex items-center gap-2">
            <span className="font-bold" style={{ color: '#d1d4dc' }}>{selectedSymbol}</span>
            <span className="text-sm" style={{ color: '#787b86' }}>
              {bid ? `Bid ${bid.toFixed(2)}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCrosshairEnabled((v) => !v)}
              className="p-1.5 rounded"
              style={{ background: crosshairEnabled ? '#2962ff' : 'transparent' }}
              title="Crosshair"
            >
              <Crosshair size={16} color={crosshairEnabled ? '#fff' : '#787b86'} />
            </button>
            <button onClick={() => setChartFullscreen((v) => !v)} className="p-1.5 rounded" title="Fullscreen">
              {chartFullscreen ? <Minimize2 size={16} color="#787b86" /> : <Maximize2 size={16} color="#787b86" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 p-2 overflow-x-auto border-b" style={{ borderColor: '#363a45', background: '#1e222d' }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.value)}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{
                background: timeframe === tf.value ? '#2962ff' : 'transparent',
                color: timeframe === tf.value ? '#fff' : '#787b86',
              }}
            >
              {tf.label}
            </button>
          ))}

          <div className="h-4 w-px mx-1" style={{ background: '#363a45' }} />

          {CHART_TYPES.map((ct) => (
            <button
              key={ct.id}
              onClick={() => setChartMode(ct.id)}
              className="px-2 py-1 rounded text-xs font-medium"
              style={{
                background: chartMode === ct.id ? '#2962ff' : 'transparent',
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

          {/* One click */}
          <div
            className="absolute left-4 right-4 rounded-lg p-3"
            style={{ bottom: chartFullscreen ? 12 : 70, background: 'rgba(30, 34, 45, 0.95)', border: '1px solid #363a45' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: '#787b86' }}>Quantity</span>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
                className="w-20 px-2 py-1 rounded text-xs text-center"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                min="1"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => placeOrderWithQty('sell', quantity)}
                className="py-3 rounded-lg font-bold text-white"
                style={{ background: '#ef5350' }}
              >
                SELL {bid.toFixed(2)}
              </button>
              <button
                onClick={() => placeOrderWithQty('buy', quantity)}
                className="py-3 rounded-lg font-bold text-white"
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

  // ✅ Order Modal (sticky footer BUY/SELL always visible)
  const OrderModal = () => (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end lg:items-center justify-center">
      <div
        className="w-full lg:max-w-md lg:rounded-lg rounded-t-xl max-h-[92vh] flex flex-col overflow-hidden"
        style={{ background: '#1e222d', border: '1px solid #363a45' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: '#363a45' }}>
          <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>New Order</h3>
          <button onClick={() => setShowOrderModal(false)}>
            <X size={22} color="#787b86" />
          </button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 pb-28">
          {/* Symbol */}
          <div className="mb-4">
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Symbol</label>
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: '#2a2e39' }}>
              <span className="font-bold" style={{ color: '#d1d4dc' }}>{selectedSymbol}</span>
              <div className="text-right">
                <div className="text-sm" style={{ color: '#ef5350' }}>{bid.toFixed(2)}</div>
                <div className="text-sm" style={{ color: '#26a69a' }}>{ask.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Order Type (keep only Market until pending orders are live) */}
          <div className="mb-4">
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full px-3 py-3 rounded-lg"
              style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
            >
              <option value="market">Market</option>
            </select>
            <div className="text-[11px] mt-1" style={{ color: '#787b86' }}>
              Pending orders will be enabled after backend activation.
            </div>
          </div>

          {/* Quantity */}
          <div className="mb-4">
            <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Quantity</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
              className="w-full px-3 py-3 rounded-lg text-lg font-bold text-center"
              style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
              min="1"
            />
          </div>

          {/* SL / TP */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Stop Loss</label>
              <input
                type="number"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                className="w-full px-3 py-3 rounded-lg"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Take Profit</label>
              <input
                type="number"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                className="w-full px-3 py-3 rounded-lg"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* ✅ Sticky Footer */}
        <div
          className="sticky bottom-0 p-4 border-t shrink-0"
          style={{ borderColor: '#363a45', background: '#1e222d' }}
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => placeOrderWithQty('sell', quantity)}
              className="py-4 rounded-lg font-bold text-white text-lg"
              style={{ background: '#ef5350' }}
            >
              SELL
            </button>
            <button
              onClick={() => placeOrderWithQty('buy', quantity)}
              className="py-4 rounded-lg font-bold text-white text-lg"
              style={{ background: '#26a69a' }}
            >
              BUY
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // ============ MODIFY POSITION MODAL ============
  const ModifyPositionModal = ({ trade }) => {
    const [newSL, setNewSL] = useState(trade.stop_loss || '');
    const [newTP, setNewTP] = useState(trade.take_profit || '');

    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-lg" style={{ background: '#1e222d', border: '1px solid #363a45' }}>
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
            <h3 className="font-bold" style={{ color: '#d1d4dc' }}>Modify Position</h3>
            <button onClick={() => setModifyModal(null)}>
              <X size={20} color="#787b86" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Stop Loss</label>
              <input
                type="number"
                value={newSL}
                onChange={(e) => setNewSL(e.target.value)}
                className="w-full px-3 py-3 rounded-lg"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: '#787b86' }}>Take Profit</label>
              <input
                type="number"
                value={newTP}
                onChange={(e) => setNewTP(e.target.value)}
                className="w-full px-3 py-3 rounded-lg"
                style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                placeholder="0"
              />
            </div>

            <button
              onClick={() => handleModifyTrade(trade.id, newSL, newTP)}
              className="w-full py-3 rounded-lg font-semibold"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              Modify
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============ TRADE TAB ============
  const TradeTab = () => (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="text-[10px]" style={{ color: '#787b86' }}>Balance</div>
            <div className="font-bold text-sm" style={{ color: '#d1d4dc' }}>₹{accountStats.balance.toFixed(2)}</div>
          </div>
          <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="text-[10px]" style={{ color: '#787b86' }}>Equity</div>
            <div className="font-bold text-sm" style={{ color: '#d1d4dc' }}>₹{accountStats.equity.toFixed(2)}</div>
          </div>
          <div className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="text-[10px]" style={{ color: '#787b86' }}>P&L</div>
            <div className="font-bold text-sm" style={{ color: totalPnL >= 0 ? '#26a69a' : '#ef5350' }}>
              {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex border-b" style={{ borderColor: '#363a45' }}>
        {[
          { id: 'positions', label: `Positions (${openTrades.length})` },
          { id: 'pending', label: `Pending (${pendingOrders?.length || 0})` },
          { id: 'summary', label: 'Summary' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTradeTabSection(tab.id)}
            className="flex-1 py-3 text-xs font-medium border-b-2"
            style={{
              color: tradeTabSection === tab.id ? '#2962ff' : '#787b86',
              borderColor: tradeTabSection === tab.id ? '#2962ff' : 'transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tradeTabSection === 'positions' && (
          <>
            <div className="flex gap-2 p-3 border-b" style={{ borderColor: '#363a45' }}>
              <button
                onClick={() => setShowOrderModal(true)}
                className="flex-1 py-2 rounded-lg text-xs font-semibold"
                style={{ background: '#2962ff', color: '#fff' }}
              >
                New Order
              </button>
            </div>

            {openTrades.length === 0 ? (
              <div className="p-6 text-center" style={{ color: '#787b86' }}>
                No open positions
              </div>
            ) : (
              openTrades.map((trade) => {
                const pnl = Number(trade.profit || 0);
                const isProfit = pnl >= 0;

                return (
                  <div key={trade.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-bold" style={{ color: '#d1d4dc' }}>{trade.symbol}</div>
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          {String(trade.trade_type || '').toUpperCase()} | Qty {trade.quantity}
                        </div>
                      </div>
                      <div style={{ color: isProfit ? '#26a69a' : '#ef5350', fontWeight: 800 }}>
                        {isProfit ? '+' : ''}₹{pnl.toFixed(2)}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => setModifyModal(trade)}
                        className="flex-1 py-2 rounded text-xs"
                        style={{ background: '#2a2e39', color: '#d1d4dc' }}
                      >
                        Modify
                      </button>
                      <button
                        onClick={() => handleCloseTrade(trade.id)}
                        className="flex-1 py-2 rounded text-xs font-semibold"
                        style={{ background: '#ef5350', color: '#fff' }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {tradeTabSection === 'pending' && (
          <div className="p-6 text-center" style={{ color: '#787b86' }}>
            {pendingOrders?.length ? 'Pending orders loaded' : 'No pending orders'}
          </div>
        )}

        {tradeTabSection === 'summary' && (
          <div className="p-4 space-y-3">
            <div className="p-4 rounded-lg" style={{ background: '#2a2e39' }}>
              <div className="flex justify-between text-sm">
                <span style={{ color: '#787b86' }}>Margin</span>
                <span style={{ color: '#d1d4dc' }}>₹{accountStats.margin.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mt-2">
                <span style={{ color: '#787b86' }}>Free Margin</span>
                <span style={{ color: '#26a69a' }}>₹{accountStats.freeMargin.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {showOrderModal && <OrderModal />}
      {modifyModal && <ModifyPositionModal trade={modifyModal} />}
    </div>
  );

  // ============ HISTORY TAB ============
  const HistoryTab = () => (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex gap-1 overflow-x-auto pb-2">
          {HISTORY_PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setHistoryPeriod(p.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
              style={{
                background: historyPeriod === p.id ? '#2962ff' : '#2a2e39',
                color: historyPeriod === p.id ? '#fff' : '#787b86',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          {[
            { id: 'positions', label: 'Positions' },
            { id: 'orders', label: 'Orders' },
            { id: 'deals', label: 'Deals' },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setHistoryViewMode(m.id)}
              className="flex-1 py-2 rounded-lg text-xs font-medium"
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
      </div>

      <div className="flex gap-2 p-3 border-b" style={{ borderColor: '#363a45' }}>
        {[
          { id: 'all', label: 'All' },
          { id: 'profit', label: 'Profit' },
          { id: 'loss', label: 'Loss' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setHistoryFilter(f.id)}
            className="px-3 py-1.5 rounded text-xs"
            style={{
              background: historyFilter === f.id ? '#2a2e39' : 'transparent',
              color: historyFilter === f.id ? '#d1d4dc' : '#787b86',
              border: `1px solid ${historyFilter === f.id ? '#363a45' : 'transparent'}`,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {historyViewMode === 'positions' && (
          <>
            {filteredHistoryTrades.length === 0 ? (
              <div className="p-6 text-center" style={{ color: '#787b86' }}>
                No closed positions for selected period.
              </div>
            ) : (
              filteredHistoryTrades.map((t) => {
                const pnl = Number(t.profit || 0);
                return (
                  <div key={t.id} className="p-3 border-b" style={{ borderColor: '#363a45' }}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-bold" style={{ color: '#d1d4dc' }}>{t.symbol}</div>
                        <div className="text-xs" style={{ color: '#787b86' }}>
                          {String(t.trade_type || '').toUpperCase()} | Qty {t.quantity} |{' '}
                          {t.close_time ? new Date(t.close_time).toLocaleString() : ''}
                        </div>
                      </div>
                      <div style={{ color: pnl >= 0 ? '#26a69a' : '#ef5350', fontWeight: 800 }}>
                        {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {historyViewMode === 'orders' && (
          <div className="p-6" style={{ color: '#787b86' }}>
            <div className="font-semibold mb-2" style={{ color: '#d1d4dc' }}>Pending Orders</div>
            {pendingOrders?.length ? (
              pendingOrders.map((o) => (
                <div key={o.id} className="p-3 rounded-lg mb-2" style={{ background: '#2a2e39' }}>
                  <div className="flex justify-between">
                    <span style={{ color: '#d1d4dc', fontWeight: 700 }}>{o.symbol}</span>
                    <span className="text-xs" style={{ color: '#787b86' }}>{o.status || 'pending'}</span>
                  </div>
                  <div className="text-xs mt-1">
                    {o.order_type} | Qty {o.quantity} | Price {Number(o.price || 0).toFixed(2)}
                  </div>
                </div>
              ))
            ) : (
              <div>No pending orders.</div>
            )}
          </div>
        )}

        {historyViewMode === 'deals' && (
          <div className="p-6 text-center" style={{ color: '#787b86' }}>
            Deals view requires a dedicated deals/transactions feed (backend). We can enable next.
          </div>
        )}
      </div>
    </div>
  );

  // ============ MESSAGES TAB ============
  const MessagesTab = () => (
    <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
      <div className="p-3 border-b" style={{ borderColor: '#363a45' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Messages</h2>
          <button className="text-xs" style={{ color: '#2962ff' }} onClick={markAllRead}>
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
              className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
              style={{
                background: messageCategory === c.id ? '#2962ff' : '#2a2e39',
                color: messageCategory === c.id ? '#fff' : '#787b86',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredMessages.length === 0 ? (
          <div className="p-6 text-center" style={{ color: '#787b86' }}>
            No messages yet.
          </div>
        ) : (
          filteredMessages.map((m) => (
            <div
              key={m.id}
              className="p-4 border-b"
              style={{
                borderColor: '#363a45',
                background: m.read ? 'transparent' : 'rgba(41, 98, 255, 0.06)',
              }}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#2a2e39' }}>
                  {m.type === 'trade' ? <TrendingUp size={18} color="#26a69a" /> : <Bell size={18} color="#2962ff" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm" style={{ color: '#d1d4dc' }}>
                      {m.title}
                    </span>
                    <span className="text-xs" style={{ color: '#787b86' }}>
                      {m.time ? new Date(m.time).toLocaleTimeString() : ''}
                    </span>
                  </div>
                  <p className="text-sm mt-1" style={{ color: '#787b86', wordBreak: 'break-word' }}>
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

  // ============ SETTINGS TAB (FIXED: DEMO/LIVE + WORKING Deposit/Withdraw) ============
  const SettingsTab = () => {
    const [showBal, setShowBal] = useState(true);

    return (
      <div className="flex flex-col h-full" style={{ background: '#1e222d' }}>
        <div className="p-4 border-b" style={{ borderColor: '#363a45' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold" style={{ color: '#d1d4dc' }}>
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-xs" style={{ color: '#787b86' }}>
                {user?.email}
              </div>
            </div>

            <button onClick={logout} className="p-2 rounded-lg" style={{ background: '#2a2e39' }}>
              <LogOut size={16} color="#787b86" />
            </button>
          </div>

          {/* ✅ DEMO/LIVE switch in settings */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={switchToDemo}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
              style={{
                background: selectedAccount?.is_demo ? '#2962ff' : '#2a2e39',
                color: selectedAccount?.is_demo ? '#fff' : '#787b86',
                border: '1px solid #363a45',
              }}
            >
              DEMO
            </button>

            <button
              onClick={switchToLive}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold"
              style={{
                background: !selectedAccount?.is_demo ? '#26a69a' : '#2a2e39',
                color: !selectedAccount?.is_demo ? '#fff' : '#787b86',
                border: '1px solid #363a45',
              }}
            >
              LIVE
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="p-4 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: '#787b86' }}>Balance</span>
              <button onClick={() => setShowBal((v) => !v)}>
                {showBal ? <Eye size={16} color="#787b86" /> : <EyeOff size={16} color="#787b86" />}
              </button>
            </div>

            <div className="text-2xl font-bold" style={{ color: '#d1d4dc' }}>
              {showBal ? `₹${accountStats.balance.toFixed(2)}` : '••••••'}
            </div>

            <div className="text-xs mt-1" style={{ color: '#787b86' }}>
              Account: {selectedAccount?.account_number || '-'} | Leverage: 1:{accountStats.leverage}
            </div>
          </div>

          {/* ✅ Deposit/Withdraw now navigate to Wallet tab */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => {
                setWalletIntent('deposit');
                setActiveTab('wallet');
              }}
              className="py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              style={{ background: '#26a69a', color: '#fff' }}
            >
              <Plus size={18} />
              Deposit
            </button>

            <button
              onClick={() => {
                setWalletIntent('withdraw');
                setActiveTab('wallet');
              }}
              className="py-3 rounded-lg font-medium flex items-center justify-center gap-2"
              style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
            >
              <RefreshCw size={18} />
              Withdraw
            </button>
          </div>

          <div className="p-4 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="flex items-center gap-2">
              <Info size={16} color="#787b86" />
              <div className="text-sm" style={{ color: '#787b86' }}>
                More settings will be added next (security, alerts, UI preferences).
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const AdminTab = () => <AdminUsers />;

  // ============ MAIN RENDER ============
  return (
    <div className="h-screen flex flex-col" style={{ background: '#131722' }}>
      {/* Header */}
      <header
        className="h-14 flex items-center justify-between px-3 border-b shrink-0"
        style={{ background: '#1e222d', borderColor: '#363a45' }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex items-center justify-center rounded-lg overflow-hidden" style={{ background: '#2a2e39' }}>
            <img src="/logo.png" alt="Trade Axis" className="h-8 w-8 object-contain" />
          </div>
          <div className="hidden sm:block">
            <span className="font-bold text-lg" style={{ color: '#d1d4dc' }}>
              Trade Axis
            </span>
            <div className="text-[10px] -mt-0.5" style={{ color: '#787b86' }}>
              Indian Markets Terminal
            </div>
          </div>
        </div>

        <div className="lg:hidden text-xs" style={{ color: '#787b86' }}>
          <span style={{ color: totalPnL >= 0 ? '#26a69a' : '#ef5350', fontWeight: 800 }}>
            {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
          </span>
        </div>

        {/* Desktop quick logout */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="text-xs" style={{ color: '#787b86' }}>
            Account: <span style={{ color: '#d1d4dc' }}>{selectedAccount?.account_number || '-'}</span>
          </div>
          <button onClick={logout} className="px-3 py-2 rounded" style={{ background: '#2a2e39', color: '#d1d4dc' }}>
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
          leftBottom={<NavigatorPanel accounts={accounts} selectedAccount={selectedAccount} onSelectAccount={setSelectedAccount} />}
          centerTop={<ChartWorkspace symbol={selectedSymbol} />}
          centerBottom={<ToolboxPanel accountId={selectedAccount?.id} openTrades={openTrades} tradeHistory={tradeHistory} onCloseTrade={handleCloseTrade} />}
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

      {/* Mobile */}
      <div className="lg:hidden flex-1 overflow-hidden pb-14">
        {activeTab === 'quotes' && <QuotesTab />}
        {activeTab === 'chart' && <ChartTab />}
        {activeTab === 'trade' && <TradeTab />}
        {activeTab === 'history' && <HistoryTab />}
        {activeTab === 'messages' && <MessagesTab />}

        {/* ✅ Wallet tab render */}
        {activeTab === 'wallet' && (
          <WalletPage selectedAccount={selectedAccount} user={user} intent={walletIntent} />
        )}

        {activeTab === 'settings' && <SettingsTab />}
        {activeTab === 'admin' && isAdmin && <AdminPanel />}
        {activeTab === 'admin' && isAdmin && <AdminUsers />}
        {activeTab === 'admin' && isAdmin && <AdminTab />}
      </div>

      <MobileNav />
    </div>
  );
};

export default Dashboard;