// backend/src/websocket/socketHandler.js
const jwt                = require('jsonwebtoken');
const { supabase }       = require('../config/supabase');
const { queueDB }        = require('../config/dbQueue');
const marketDataService  = require('../services/marketDataService');
const kiteStreamService  = require('../services/kiteStreamService');
const tradingService     = require('../services/tradingService');
const { isMarketOpen, isAnyMarketOpen } = require('../services/marketStatus');
const {
  QUOTE_FRESHNESS_MS,
  getAgeMs,
  resolveTradeablePrice,
} = require('../services/quoteGuard');

const STOP_OUT_LEVEL            = Number(process.env.STOP_OUT_LEVEL || 10);
const AUTO_CLOSE_VANISH_PERCENT = Math.min(
  99, Math.max(0, Number(process.env.AUTO_CLOSE_VANISH_PERCENT || 95))
);

// ─── Timing constants (Pro plan can handle more frequent writes) ──────────────
const PNL_EMIT_INTERVAL_MS = 5_000;  // emit to sockets every 5s
const PNL_DB_WRITE_EVERY   = 4;      // write to DB every 4th tick = 20s
                                     // (was 6 = 30s on free tier)
const PENDING_CHECK_EVERY  = 6;      // check pending orders every 30s
const STOPOUT_CHECK_EVERY  = 4;      // stop-out check every 20s

class SocketHandler {
  constructor(io) {
    this.io               = io;
    this.connectedUsers   = new Map();    // userId → socket
    this.userSubscriptions = new Map();   // userId → Set<symbol>
    this.pnlUpdateInterval = null;
    this.pnlDbCounter     = 0;
    this.closingTrades    = new Set();    // trade IDs being closed right now

    // ── Per-user P&L cache to only emit when value actually changed ──────────
    // Prevents flooding sockets with identical data
    this._lastEmittedPnL  = new Map();   // tradeId → lastProfit
    this._lastEmittedAcct = new Map();   // accountId → lastEquity

    this.initialize();
  }

  // ══════════════════════════════════════════════════════════════════
  //  INIT
  // ══════════════════════════════════════════════════════════════════
  initialize() {
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.query?.token;

        if (!token) return next(new Error('Authentication required'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const { data: user, error } = await queueDB(() =>
          supabase
            .from('users')
            .select('id, email, first_name, last_name, role')
            .eq('id', decoded.id)
            .single()
        , 10); // High priority — auth must not be delayed

        if (error || !user) return next(new Error('User not found'));

        socket.userId = user.id;
        socket.user   = user;
        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', (socket) => this.handleConnection(socket));
    this.startPnLUpdates();
    console.log('📈 SocketHandler initialised (Pro plan mode)');
  }

  // ══════════════════════════════════════════════════════════════════
  //  CONNECTION
  // ══════════════════════════════════════════════════════════════════
  handleConnection(socket) {
    console.log(`✅ WS: ${socket.user.email}`);
    this.connectedUsers.set(socket.userId, socket);
    socket.join(`user:${socket.userId}`);

    socket.emit('connected', {
      message:    'Connected to Trade Axis',
      user:       socket.user,
      kiteStream: kiteStreamService.isRunning(),
      timestamp:  new Date().toISOString(),
    });

    socket.on('subscribe:symbols',   (s)  => this.handleSubscribe(socket, s));
    socket.on('unsubscribe:symbols', (s)  => this.handleUnsubscribe(socket, s));
    socket.on('subscribe:account',   (id) => {
      socket.join(`account:${id}`);
      socket.emit('account:subscribed', { accountId: id });
    });
    socket.on('get:quote',  (sym) => this.handleGetQuote(socket, sym));
    socket.on('ping',       ()    => socket.emit('pong', { timestamp: Date.now() }));
    socket.on('disconnect', ()    => this.handleDisconnect(socket));

    this.sendInitialData(socket);
  }

  async sendInitialData(socket) {
    try {
      const [accountsResult, tradesResult] = await Promise.all([
        queueDB(() =>
          supabase
            .from('accounts')
            .select('*')
            .eq('user_id', socket.userId)
            .eq('is_active', true)
        , 8),
        queueDB(() =>
          supabase
            .from('trades')
            .select('*')
            .eq('user_id', socket.userId)
            .eq('status', 'open')
        , 8),
      ]);

      socket.emit('accounts:update', accountsResult?.data || []);
      socket.emit('trades:update',   tradesResult?.data   || []);
    } catch (err) {
      console.error('Initial data error:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  SUBSCRIPTIONS
  // ══════════════════════════════════════════════════════════════════
  handleSubscribe(socket, symbols) {
    if (!Array.isArray(symbols)) symbols = [symbols];

    const subs     = this.userSubscriptions.get(socket.userId) || new Set();
    const snapshot = [];

    symbols.forEach((sym) => {
      const s = String(sym).toUpperCase();
      subs.add(s);
      socket.join(`symbol:${s}`);

      const cached = kiteStreamService.getPrice(s);
      if (cached) {
        snapshot.push({
          symbol:        s,
          bid:           cached.bid,
          ask:           cached.ask,
          last:          cached.last,
          open:          cached.open,
          high:          cached.high,
          low:           cached.low,
          change:        cached.change,
          changePercent: cached.changePct,
          volume:        cached.volume,
          timestamp:     cached.timestamp,
          source:        'kite',
        });
      }
    });

    this.userSubscriptions.set(socket.userId, subs);
    if (snapshot.length > 0) socket.emit('prices:snapshot', snapshot);
    socket.emit('subscribed', {
      symbols: Array.from(subs),
      message: `Subscribed to ${symbols.length} symbols`,
    });
  }

  handleUnsubscribe(socket, symbols) {
    if (!Array.isArray(symbols)) symbols = [symbols];
    const subs = this.userSubscriptions.get(socket.userId);
    if (subs) {
      symbols.forEach((sym) => {
        const s = String(sym).toUpperCase();
        subs.delete(s);
        socket.leave(`symbol:${s}`);
      });
    }
    socket.emit('unsubscribed', { symbols });
  }

  async handleGetQuote(socket, symbol) {
    try {
      const quote = await marketDataService.getQuote(symbol);
      socket.emit('quote', quote);
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  }

  handleDisconnect(socket) {
    console.log(`❌ WS disconnect: ${socket.user.email}`);
    this.connectedUsers.delete(socket.userId);
    this.userSubscriptions.delete(socket.userId);

    // Clean up P&L cache for disconnected user
    // (trades still in DB, just remove from memory cache)
  }

  // ══════════════════════════════════════════════════════════════════
  //  P&L LOOP — OPTIMIZED FOR 200 USERS ON PRO PLAN
  // ══════════════════════════════════════════════════════════════════
  startPnLUpdates() {
    this.pnlUpdateInterval = setInterval(
      () => this._runPnLCycle().catch((err) =>
        console.error('P&L loop error:', err.message)
      ),
      PNL_EMIT_INTERVAL_MS
    );

    console.log(
      `💹 P&L loop started ` +
      `(emit every ${PNL_EMIT_INTERVAL_MS / 1000}s, ` +
      `DB write every ${(PNL_EMIT_INTERVAL_MS * PNL_DB_WRITE_EVERY) / 1000}s)`
    );
  }

  async _runPnLCycle() {
    this.pnlDbCounter++;

    // ── Pending order check every 30s ─────────────────────────────────────────
    if (this.pnlDbCounter % PENDING_CHECK_EVERY === 0) {
      tradingService
        .checkPendingOrders()
        .catch((e) => console.error('Pending order check error:', e.message));
    }

    // ── Skip live P&L when all markets closed ─────────────────────────────────
    if (!isAnyMarketOpen()) return;

    // ── 1. Fetch all open trades (ONE query) ──────────────────────────────────
    const { data: openTrades, error } = await queueDB(() =>
      supabase
        .from('trades')
        .select('id, account_id, symbol, exchange, trade_type, open_price, current_price, quantity, buy_brokerage, brokerage, stop_loss, take_profit, profit, margin, accounts!inner(user_id, balance, credit, margin)')
        .eq('status', 'open')
    );

    if (error || !openTrades || openTrades.length === 0) return;

    // ── 2. Only process trades for CONNECTED users ────────────────────────────
    // KEY OPTIMIZATION: skip computing P&L for users who are not online
    // Reduces socket emissions and CPU work significantly
    const connectedUserIds = new Set(this.connectedUsers.keys());

    // Still write ALL trades to DB (for accuracy), but only emit connected users
    const allTradesForDB = openTrades;

    // ── 3. Resolve prices ─────────────────────────────────────────────────────
    const uniqueSymbols = [...new Set(allTradesForDB.map((t) => t.symbol))];
    const priceSources  = {};
    const missing       = [];

    for (const sym of uniqueSymbols) {
      const c = kiteStreamService.getPrice(sym);
      if (c) {
        priceSources[sym] = { liveQuote: c, symbolRow: null };
      }
      if (!c || getAgeMs(c.timestamp) > QUOTE_FRESHNESS_MS) {
        missing.push(sym);
      }
    }

    // ONE query for all missing symbols
    if (missing.length > 0) {
      const { data: rows } = await queueDB(() =>
        supabase
          .from('symbols')
          .select('symbol, bid, ask, last_price, last_update')
          .in('symbol', missing)
      );

      for (const r of rows || []) {
        priceSources[r.symbol] = {
          liveQuote: priceSources[r.symbol]?.liveQuote || null,
          symbolRow: r,
        };
      }
    }

    // ── 4. Compute P&L ────────────────────────────────────────────────────────
    const allTradeUpdates  = [];   // for DB batch write
    const activeTradeEmits = [];   // for socket emit (connected users only)
    const accountPnL       = {};   // all accounts (for DB write + stop-out)
    const slTpTriggers     = [];

    for (const trade of allTradesForDB) {
      const isTradeMarketOpen = isMarketOpen(trade.symbol, trade.exchange);
      const priceSource = priceSources[trade.symbol] || {};
      const currentPriceState = isTradeMarketOpen
        ? resolveTradeablePrice({
          symbol: trade.symbol,
          side: trade.trade_type === 'buy' ? 'sell' : 'buy',
          liveQuote: priceSource.liveQuote || null,
          symbolRow: priceSource.symbolRow || null,
        })
        : { price: 0, isOffQuotes: true };
      const hasFreshTradablePrice =
        isTradeMarketOpen &&
        !currentPriceState.isOffQuotes &&
        currentPriceState.price > 0;

      const currentPrice = hasFreshTradablePrice
        ? currentPriceState.price
        : Number(trade.current_price || trade.open_price || 0);

      if (!currentPrice || currentPrice <= 0) continue;

      const direction    = trade.trade_type === 'buy' ? 1 : -1;
      const openPrice    = parseFloat(trade.open_price    || 0);
      const quantity     = parseFloat(trade.quantity      || 0);
      const buyBrokerage = parseFloat(trade.buy_brokerage || trade.brokerage || 0);
      const floatingPnL  = hasFreshTradablePrice
        ? (currentPrice - openPrice) * direction * quantity - buyBrokerage
        : Number(trade.profit || 0);

      // Always add to DB update list
      if (hasFreshTradablePrice) {
        allTradeUpdates.push({
          id:           trade.id,
          currentPrice,
          profit:       floatingPnL,
          userId:       trade.accounts.user_id,
          accountId:    trade.account_id,
          symbol:       trade.symbol,
          tradeType:    trade.trade_type,
          openPrice,
          quantity,
        });
      }

      // Only add to emit list if user is connected
      if (hasFreshTradablePrice && connectedUserIds.has(trade.accounts.user_id)) {
        // ── Smart emit: only send if value changed by > ₹0.01 ─────────────
        const lastPnL  = this._lastEmittedPnL.get(trade.id) ?? null;
        const changed  = lastPnL === null || Math.abs(floatingPnL - lastPnL) >= 0.01;

        if (changed) {
          activeTradeEmits.push({
            id:           trade.id,
            currentPrice,
            profit:       floatingPnL,
            userId:       trade.accounts.user_id,
            accountId:    trade.account_id,
            symbol:       trade.symbol,
            tradeType:    trade.trade_type,
            openPrice,
            quantity,
          });
          this._lastEmittedPnL.set(trade.id, floatingPnL);
        }
      }

      // Aggregate account P&L (all trades, not just active)
      if (!accountPnL[trade.account_id]) {
        accountPnL[trade.account_id] = {
          userId:   trade.accounts.user_id,
          balance:  parseFloat(trade.accounts.balance || 0),
          credit:   parseFloat(trade.accounts.credit  || 0),
          margin:   parseFloat(trade.accounts.margin  || 0),
          totalPnL: 0,
          trades:   [],
        };
      }
      accountPnL[trade.account_id].totalPnL += floatingPnL;
      accountPnL[trade.account_id].trades.push({
        ...trade,
        _currentPrice: currentPrice,
        _netPnL:       floatingPnL,
      });

      // SL / TP check
      if (!hasFreshTradablePrice || this.closingTrades.has(trade.id)) continue;
      const sl = parseFloat(trade.stop_loss   || 0);
      const tp = parseFloat(trade.take_profit || 0);

      if (sl > 0) {
        if (
          (trade.trade_type === 'buy'  && currentPrice <= sl) ||
          (trade.trade_type === 'sell' && currentPrice >= sl)
        ) {
          slTpTriggers.push({ trade, reason: 'Stop Loss' });
          continue;
        }
      }
      if (tp > 0) {
        if (
          (trade.trade_type === 'buy'  && currentPrice >= tp) ||
          (trade.trade_type === 'sell' && currentPrice <= tp)
        ) {
          slTpTriggers.push({ trade, reason: 'Take Profit' });
        }
      }
    }

    // ── 5. Emit trade P&L (only changed values, only connected users) ─────────
    const byUser = {};
    for (const u of activeTradeEmits) {
      if (!byUser[u.userId]) byUser[u.userId] = [];
      byUser[u.userId].push(u);
    }

    for (const [userId, trades] of Object.entries(byUser)) {
      // ONE batch event per user (not N individual events)
      this.io.to(`user:${userId}`).emit('trades:pnl:batch', {
        trades: trades.map((t) => ({
          tradeId:      t.id,
          symbol:       t.symbol,
          tradeType:    t.tradeType,
          openPrice:    t.openPrice,
          currentPrice: t.currentPrice,
          quantity:     t.quantity,
          profit:       parseFloat(t.profit.toFixed(2)),
          timestamp:    Date.now(),
        })),
        timestamp: Date.now(),
      });
    }

    // ── 6. Emit account equity (only if changed, only connected users) ─────────
    for (const [accountId, d] of Object.entries(accountPnL)) {
      // Skip if user not connected
      if (!connectedUserIds.has(d.userId)) continue;

      const equity      = d.balance + d.credit + d.totalPnL;
      const freeMargin  = equity - d.margin;
      const marginLevel = d.margin > 0 ? (equity / d.margin) * 100 : 0;

      // Smart emit: only send if equity changed by > ₹1
      const lastEquity = this._lastEmittedAcct.get(accountId) ?? null;
      const changed    = lastEquity === null || Math.abs(equity - lastEquity) >= 1;

      if (changed) {
        const payload = {
          accountId,
          balance:     d.balance,
          credit:      d.credit,
          equity:      parseFloat(equity.toFixed(2)),
          profit:      parseFloat(d.totalPnL.toFixed(2)),
          freeMargin:  parseFloat(freeMargin.toFixed(2)),
          margin:      d.margin,
          marginLevel: parseFloat(marginLevel.toFixed(2)),
          timestamp:   Date.now(),
        };

        this.io.to(`user:${d.userId}`).emit('account:update', payload);
        this.io.to(`account:${accountId}`).emit('account:update', payload);
        this._lastEmittedAcct.set(accountId, equity);
      }
    }

    // ── 7. Batch DB write every 20s (Pro plan can handle 20s cadence) ─────────
    if (this.pnlDbCounter % PNL_DB_WRITE_EVERY === 0 && allTradeUpdates.length > 0) {
      this._batchWritePnL(allTradeUpdates, accountPnL);
    }

    // ── 8. SL/TP closures ─────────────────────────────────────────────────────
    for (const { trade, reason } of slTpTriggers) {
      if (this.closingTrades.has(trade.id)) continue;
      this.closingTrades.add(trade.id);

      tradingService
        .closePosition(trade)
        .then((result) => {
          if (result.success) {
            const uid = trade.accounts?.user_id || trade.user_id;
            console.log(`✅ ${reason} → trade #${trade.id} (${trade.symbol})`);
            this.io.to(`user:${uid}`).emit('trade:closed', {
              tradeId:   trade.id,
              symbol:    trade.symbol,
              reason,
              profit:    result.trade?.profit,
              timestamp: Date.now(),
            });
          }
        })
        .catch((e) => console.error(`SL/TP close err #${trade.id}:`, e.message))
        .finally(() => this.closingTrades.delete(trade.id));
    }

    // ── 9. Stop-out check every 20s ───────────────────────────────────────────
    if (this.pnlDbCounter % STOPOUT_CHECK_EVERY === 0) {
      this.checkStopOut(accountPnL).catch((e) =>
        console.error('Stop-out check error:', e.message)
      );
    }
  }

  // ── Batch DB write — always 2 queries regardless of user count ───────────────
  async _batchWritePnL(tradeUpdates, accountPnL) {
    try {
      // ONE upsert for all trades
      const tradeRows = tradeUpdates.map((t) => ({
        id:            t.id,
        current_price: t.currentPrice,
        profit:        parseFloat(t.profit.toFixed(4)),
      }));

      await queueDB(() =>
        supabase
          .from('trades')
          .upsert(tradeRows, { onConflict: 'id', ignoreDuplicates: false })
      , 0); // lowest priority — background write

      // ONE upsert for all accounts
      const accountRows = Object.entries(accountPnL).map(([id, d]) => {
        const eq = d.balance + d.credit + d.totalPnL;
        return {
          id,
          profit:      parseFloat(d.totalPnL.toFixed(4)),
          equity:      parseFloat(eq.toFixed(4)),
          free_margin: parseFloat((eq - d.margin).toFixed(4)),
        };
      });

      await queueDB(() =>
        supabase
          .from('accounts')
          .upsert(accountRows, { onConflict: 'id', ignoreDuplicates: false })
      , 0); // lowest priority — background write

    } catch (err) {
      console.error('Batch P&L DB write error:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  STOP-OUT — NO PER-ACCOUNT DB QUERIES
  // ══════════════════════════════════════════════════════════════════
  async checkStopOut(accountPnL) {
    const userIds = [...new Set(Object.values(accountPnL).map((d) => d.userId))];
    if (userIds.length === 0) return;

    // ONE query for all users
    const { data: usersData } = await queueDB(() =>
      supabase
        .from('users')
        .select('id, liquidation_type, login_id')
        .in('id', userIds)
    );

    const userMap = {};
    (usersData || []).forEach((u) => {
      userMap[u.id] = {
        liquidationType: u.liquidation_type || 'liquidate',
        loginId:         u.login_id || '—',
      };
    });

    for (const [accountId, d] of Object.entries(accountPnL)) {
      const equity      = d.balance + d.credit + d.totalPnL;
      const margin      = d.margin;
      const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;
      const usableFunds = Math.max(0, d.balance + d.credit);
      const protectionFloor =
        (usableFunds * Math.max(0, 100 - AUTO_CLOSE_VANISH_PERCENT)) / 100;

      const userInfo = userMap[d.userId];
      if (!userInfo) continue;

      // ── Pre-check: skip accounts nowhere near stop-out ────────────────────
      // Avoids wasted work for 95%+ of healthy accounts
      const nearMarginStop = margin > 0 && marginLevel < (STOP_OUT_LEVEL * 2);
      const nearEquityStop = equity < (protectionFloor * 1.1);
      if (!nearMarginStop && !nearEquityStop) continue;

      const candidateTrades = (d.trades || [])
        .filter((t) => !this.closingTrades.has(t.id))
        .sort((a, b) => a._netPnL - b._netPnL);

      if (candidateTrades.length === 0) continue;

      const worstTrade = candidateTrades[0];
      if (this.closingTrades.has(worstTrade.id)) continue;

      // ── Calculate preview IN MEMORY — no DB query needed ─────────────────
      const currentPrice   = worstTrade._currentPrice;
      const openPrice      = parseFloat(worstTrade.open_price || 0);
      const quantity       = parseFloat(worstTrade.quantity   || 0);
      const direction      = worstTrade.trade_type === 'buy' ? 1 : -1;
      const grossProfit    = (currentPrice - openPrice) * direction * quantity;
      const brokerageRate  = 0.0003;
      const sellBrokerage  = currentPrice * quantity * brokerageRate;
      const buyBrokerage   = parseFloat(worstTrade.buy_brokerage || worstTrade.brokerage || 0);
      const estimatedProfit = grossProfit - buyBrokerage - sellBrokerage;

      const projectedEquity = equity - Number(worstTrade._netPnL || 0) + estimatedProfit;

      const marginTriggered = margin > 0 && marginLevel < STOP_OUT_LEVEL;
      const equityTriggered = projectedEquity <= protectionFloor;

      if (!marginTriggered && !equityTriggered) continue;

      // ── Illiquidate: warn only ────────────────────────────────────────────
      if (userInfo.liquidationType === 'illiquidate') {
        this.io.to(`user:${d.userId}`).emit('margin:warning', {
          accountId,
          marginLevel:               parseFloat(marginLevel.toFixed(2)),
          equity:                    parseFloat(equity.toFixed(2)),
          margin:                    parseFloat(margin.toFixed(2)),
          projectedEquityAfterClose: parseFloat(projectedEquity.toFixed(2)),
          protectionFloor:           parseFloat(protectionFloor.toFixed(2)),
          message: equityTriggered
            ? `⚠️ Equity protection triggered — illiquidate (no auto-close)`
            : `⚠️ Margin level ${marginLevel.toFixed(1)}% — illiquidate (no auto-close)`,
          timestamp: Date.now(),
        });
        console.log(`⚠️ [ILLIQUIDATE] ${userInfo.loginId} — NOT closing`);
        continue;
      }

      // ── Auto-close ────────────────────────────────────────────────────────
      const triggerReason = equityTriggered
        ? `Equity protection (${AUTO_CLOSE_VANISH_PERCENT}% capital loss threshold)`
        : `Stop Out (Margin Level ${marginLevel.toFixed(1)}%)`;

      console.log(`🔴 [AUTO-CLOSE] ${userInfo.loginId} — ${triggerReason}`);

      this.io.to(`user:${d.userId}`).emit('margin:warning', {
        accountId,
        marginLevel:               parseFloat(marginLevel.toFixed(2)),
        equity:                    parseFloat(equity.toFixed(2)),
        margin:                    parseFloat(margin.toFixed(2)),
        projectedEquityAfterClose: parseFloat(projectedEquity.toFixed(2)),
        protectionFloor:           parseFloat(protectionFloor.toFixed(2)),
        message: equityTriggered
          ? `🔴 AUTO CLOSE: projected equity ₹${projectedEquity.toFixed(2)}`
          : `🔴 STOP OUT: Margin level ${marginLevel.toFixed(1)}%`,
        timestamp: Date.now(),
      });

      this.closingTrades.add(worstTrade.id);

      tradingService
        .closePosition(worstTrade)
        .then((result) => {
          if (result.success) {
            console.log(
              `✅ STOP-OUT closed #${worstTrade.id} ` +
              `(${worstTrade.symbol}) P&L: ${result.trade?.profit?.toFixed(2)}`
            );
            this.io.to(`user:${d.userId}`).emit('trade:closed', {
              tradeId:   worstTrade.id,
              symbol:    worstTrade.symbol,
              reason:    triggerReason,
              profit:    result.trade?.profit,
              timestamp: Date.now(),
            });
            this.io.to(`user:${d.userId}`).emit('stopout:executed', {
              accountId,
              tradeId:                  worstTrade.id,
              symbol:                   worstTrade.symbol,
              marginLevel:              parseFloat(marginLevel.toFixed(2)),
              projectedEquityAfterClose: parseFloat(projectedEquity.toFixed(2)),
              profit:                   result.trade?.profit,
              message: equityTriggered
                ? `Auto-close: ${worstTrade.symbol} closed before equity turned negative`
                : `Stop-out: ${worstTrade.symbol} closed at margin level ${marginLevel.toFixed(1)}%`,
              timestamp: Date.now(),
            });
          }
        })
        .catch((e) => console.error(`❌ STOP-OUT error #${worstTrade.id}:`, e.message))
        .finally(() => this.closingTrades.delete(worstTrade.id));
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  SHUTDOWN
  // ══════════════════════════════════════════════════════════════════
  stop() {
    if (this.pnlUpdateInterval) {
      clearInterval(this.pnlUpdateInterval);
      this.pnlUpdateInterval = null;
    }
    this.closingTrades.clear();
    this._lastEmittedPnL.clear();
    this._lastEmittedAcct.clear();
    console.log('WebSocket intervals stopped');
  }
}

module.exports = SocketHandler;
