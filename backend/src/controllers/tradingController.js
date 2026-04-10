// backend/src/controllers/tradingController.js  ── FIXED VERSION
const { supabase } = require('../config/supabase');
const kiteStreamService = require('../services/kiteStreamService');
const { isMarketOpen, getHolidayStatus, isCommoditySymbol } = require('../services/marketStatus');

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

/** Safely resolve a fresh live price for a symbol */
async function resolvePrice(symbol, side = 'buy') {
  const livePrice = kiteStreamService.getFreshPrice(symbol);
  const isFresh = !!livePrice;

  if (isFresh) {
    return side === 'buy'
      ? Number(livePrice.ask || livePrice.last || 0)
      : Number(livePrice.bid || livePrice.last || 0);
  }
  return 0;
}

/** Recalculate account fields after a trade close and persist */
async function settleAccount(accountId, netProfit, marginFreed, now) {
  const { data: acct } = await supabase
    .from('accounts')
    .select('balance, credit, margin')
    .eq('id', accountId)
    .single();

  if (!acct) return;

  // ── Balance NEVER changes (only admin deposits/withdrawals) ──
  const balance    = parseFloat(acct.balance || 0);
  // ── Credit accumulates realized P&L from closed trades ──
  const newCredit  = parseFloat(acct.credit || 0) + netProfit;
  const newMargin  = Math.max(0, parseFloat(acct.margin || 0) - marginFreed);
  // ── Equity = balance + credit (floating P&L recalculated by socket) ──
  const newEquity     = balance + newCredit;
  const newFreeMargin = newEquity - newMargin;

  await supabase
    .from('accounts')
    .update({
      // balance: NOT CHANGED — only admin can change this
      credit:      newCredit,
      equity:      newEquity,
      margin:      newMargin,
      free_margin: newFreeMargin,
      updated_at:  now,
    })
    .eq('id', accountId);
}

// ─────────────────────────────────────────────
//  GET POSITIONS
// ─────────────────────────────────────────────
exports.getPositions = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const { data: trades, error } = await supabase
      .from('trades').select('*').eq('account_id', accountId).eq('status', 'open')
      .order('open_time', { ascending: false });
    if (error) throw error;

    res.json({ success: true, data: trades || [] });
  } catch (err) {
    console.error('Get positions error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch positions' });
  }
};

// ─────────────────────────────────────────────
//  GET PENDING ORDERS
// ─────────────────────────────────────────────
exports.getPendingOrders = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const { data: orders, error } = await supabase
      .from('pending_orders').select('*').eq('account_id', accountId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) {
      console.log('Pending orders table may not exist:', error.message);
      return res.json({ success: true, data: [] });
    }
    res.json({ success: true, data: orders || [] });
  } catch (err) {
    console.error('Get pending orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pending orders' });
  }
};

// ─────────────────────────────────────────────
//  PLACE ORDER  (market / pending)
// ─────────────────────────────────────────────
exports.placeOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      accountId, symbol, type, orderType = 'market', quantity,
      price = 0, stopLoss = 0, takeProfit = 0, slippage = 3, comment = '',
    } = req.body;

    if (!accountId || !symbol || !type || !quantity)
      return res.status(400).json({ success: false, message: 'Missing required fields: accountId, symbol, type, quantity' });
    if (quantity <= 0)
      return res.status(400).json({ success: false, message: 'Quantity must be greater than 0' });

    // ── Fetch user data first ──
    const { data: userData, error: userError } = await supabase
      .from('users').select('closing_mode, brokerage_rate').eq('id', userId).single();
    if (userError) throw userError;

    const closingMode = userData?.closing_mode || false;
    const userBrokerageRate = userData?.brokerage_rate || 0.0003;

    if (closingMode && type === 'buy')
      return res.status(403).json({
        success: false,
        message: 'Your account is in closing mode. You can only close existing positions (sell). Contact admin for assistance.',
      });

    // ── Fetch account ──
    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    // ── Fetch symbol data (MUST be before market hours check) ──
    const { data: symbolData, error: symbolError } = await supabase
      .from('symbols').select('*').eq('symbol', symbol.toUpperCase()).single();
    if (symbolError || !symbolData)
      return res.status(404).json({ success: false, message: 'Symbol not found' });

    if (symbolData.is_banned)
      return res.status(403).json({
        success: false,
        message: `Trading is disabled for ${symbolData.symbol}. ${symbolData.ban_reason || 'Contact admin.'}`,
      });

    // ── Market hours check (NOW symbolData is defined) ──
    if (!isMarketOpen(symbolData.symbol, symbolData.exchange)) {
      const holiday = getHolidayStatus();
      const isCommodity = isCommoditySymbol(symbolData.symbol, symbolData.exchange);
      let reason;

      if (holiday.isHoliday) {
        reason = `Market Holiday: ${holiday.message || 'Market is closed today by admin.'}`;
      } else if (isCommodity) {
        reason = 'Commodity market is closed. Trading hours: 9:00 AM – 11:30 PM IST, Monday to Friday.';
      } else {
        reason = 'Market is closed. Orders can only be placed between 9:15 AM and 3:30 PM IST, Monday to Friday.';
      }

      return res.status(400).json({ success: false, message: reason });
    }

    // ── Pending order types ───────────────────────────────────────
    if (orderType !== 'market' && orderType !== 'instant') {
      const validPendingTypes = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop'];
      if (!validPendingTypes.includes(orderType))
        return res.status(400).json({ success: false, message: `Invalid order type: ${orderType}` });
      if (!price || price <= 0)
        return res.status(400).json({ success: false, message: 'Price is required for limit/stop orders' });

      const livePrice = kiteStreamService.getFreshPrice(symbolData.symbol);
      const currentBid = Number(livePrice?.bid || livePrice?.last || 0);
      const currentAsk = Number(livePrice?.ask || livePrice?.last || 0);
      const cmp = type === 'buy' ? currentAsk : currentBid;

      if (!cmp || cmp <= 0) {
        return res.status(409).json({
          success: false,
          code: 'OFF_QUOTES',
          message: `${symbolData.symbol} is off quotes. Live price is older than 10 seconds.`,
        });
      }

      if (orderType === 'buy_limit' && price > cmp * 0.995)
        return res.status(400).json({
          success: false,
          message: `Buy Limit price must be at least 0.5% below current price. Max: ₹${(cmp * 0.995).toFixed(2)}`,
        });
      if (orderType === 'sell_limit' && price < cmp * 1.005)
        return res.status(400).json({
          success: false,
          message: `Sell Limit price must be at least 0.5% above current price. Min: ₹${(cmp * 1.005).toFixed(2)}`,
        });

      try {
        const pendingOrderData = {
          user_id: userId, account_id: accountId, symbol: symbolData.symbol,
          exchange: symbolData.exchange || 'NSE', order_type: orderType, trade_type: type,
          quantity: parseFloat(quantity), price: parseFloat(price),
          stop_loss: parseFloat(stopLoss) || 0, take_profit: parseFloat(takeProfit) || 0,
          status: 'pending', comment, created_at: new Date().toISOString(),
        };
        const { data: pendingOrder, error: poError } = await supabase
          .from('pending_orders').insert(pendingOrderData).select().single();
        if (poError) {
          console.error('Pending order insert error:', poError);
          return res.status(400).json({ success: false, message: 'Failed to create pending order.' });
        }
        return res.json({
          success: true, data: pendingOrder, pending: true,
          message: `${orderType.replace('_', ' ').toUpperCase()} order placed at ₹${parseFloat(price).toFixed(2)}`,
        });
      } catch (pendErr) {
        console.error('Pending order error:', pendErr);
        return res.status(400).json({ success: false, message: 'Pending orders not supported yet. Use market orders.' });
      }
    }

    // ── Market order — resolve price ──────────────────────────────
    const liveP = kiteStreamService.getFreshPrice(symbolData.symbol);
    const openPrice = type === 'buy'
      ? Number(liveP?.ask || liveP?.last || 0)
      : Number(liveP?.bid || liveP?.last || 0);

    if (!openPrice || openPrice <= 0)
      return res.status(409).json({
        success: false,
        code: 'OFF_QUOTES',
        message: `${symbolData.symbol} is off quotes. Live price is older than 10 seconds.`,
      });

    if (!openPrice || openPrice <= 0)
      return res.status(400).json({ success: false, message: 'Invalid price. Market may be closed.' });

    const lotSize = 1;
    const leverage = account.leverage || 5;
    const marginRequired = (openPrice * parseFloat(quantity) * lotSize) / leverage;
    const freeMargin = parseFloat(account.free_margin ?? account.balance);

    if (marginRequired > freeMargin)
      return res.status(400).json({
        success: false,
        message: `Insufficient margin. Required: ₹${marginRequired.toFixed(2)}, Available: ₹${freeMargin.toFixed(2)}`,
      });

    const brokerageRate = userBrokerageRate;
    const entryBrokerage = openPrice * parseFloat(quantity) * lotSize * brokerageRate;
    const now = new Date().toISOString();

    // ── NETTING: check for OPPOSITE-direction open position ───────
    const oppositeType = type === 'buy' ? 'sell' : 'buy';

    const { data: oppositeTrades } = await supabase
      .from('trades').select('*').eq('account_id', accountId)
      .eq('symbol', symbolData.symbol).eq('trade_type', oppositeType).eq('status', 'open');

    if (oppositeTrades && oppositeTrades.length > 0) {
      const existing = oppositeTrades[0];
      const existingQty = parseFloat(existing.quantity);
      const incomingQty = parseFloat(quantity);

      const exitBrokerage = openPrice * Math.min(incomingQty, existingQty) * lotSize * brokerageRate;

      if (incomingQty >= existingQty) {
        // Full close (+ possible flip)
        const direction = existing.trade_type === 'buy' ? 1 : -1;
        const priceDiff = (openPrice - parseFloat(existing.open_price)) * direction;
        const grossProfit = priceDiff * existingQty * lotSize;
        const buyBrok = parseFloat(existing.buy_brokerage || existing.brokerage || 0);
        const totalBrok = buyBrok + exitBrokerage;
        const netProfit = grossProfit - totalBrok;

        await supabase.from('trades').update({
          close_price: openPrice, profit: netProfit, sell_brokerage: exitBrokerage,
          brokerage: totalBrok, status: 'closed', close_time: now, updated_at: now,
        }).eq('id', existing.id);

        await settleAccount(accountId, netProfit, parseFloat(existing.margin || 0), now);

        const remainingQty = incomingQty - existingQty;
        if (remainingQty > 0) {
          // Flip: open new position in incoming direction
          const flipMargin = (openPrice * remainingQty * lotSize) / leverage;
          const flipBrokerage = openPrice * remainingQty * lotSize * brokerageRate;
          const flipData = {
            user_id: userId, account_id: accountId, symbol: symbolData.symbol,
            exchange: symbolData.exchange || 'NSE', trade_type: type,
            quantity: remainingQty, open_price: openPrice, current_price: openPrice,
            stop_loss: parseFloat(stopLoss) || 0, take_profit: parseFloat(takeProfit) || 0,
            margin: flipMargin, brokerage: flipBrokerage, buy_brokerage: flipBrokerage,
            sell_brokerage: 0, profit: -flipBrokerage, status: 'open',
            comment: `Flip from closing ${existing.id}`, open_time: now,
          };
          const { data: flipTrade, error: flipErr } = await supabase
            .from('trades').insert(flipData).select().single();
          if (flipErr) throw flipErr;

          // Add flip margin to account
          const { data: freshAcct } = await supabase.from('accounts').select('margin, balance, credit').eq('id', accountId).single();
          const newMrgn = parseFloat(freshAcct.margin || 0) + flipMargin;
          const newEquity = parseFloat(freshAcct.balance || 0) + parseFloat(freshAcct.credit || 0);
          await supabase.from('accounts').update({
            margin: newMrgn, free_margin: newEquity - newMrgn, updated_at: now,
          }).eq('id', accountId);

          return res.json({
            success: true, data: flipTrade,
            message: `Closed ${existingQty} ${oppositeType} and opened ${remainingQty} ${type} @ ${openPrice}`,
          });
        }

        return res.json({
          success: true, data: { closedTradeId: existing.id, profit: netProfit },
          message: `Position closed. ${existingQty} ${oppositeType} closed @ ${openPrice}. P&L: ₹${netProfit.toFixed(2)}`,
        });

      } else {
        // Partial reduce
        const remainingQty = existingQty - incomingQty;
        const direction = existing.trade_type === 'buy' ? 1 : -1;
        const priceDiff = (openPrice - parseFloat(existing.open_price)) * direction;
        const grossProfit = priceDiff * incomingQty * lotSize;
        const closedBuyBrok = (parseFloat(existing.buy_brokerage || existing.brokerage || 0) / existingQty) * incomingQty;
        const totalBrokerage = closedBuyBrok + exitBrokerage;
        const netProfit = grossProfit - totalBrokerage;

        const remainingBuyBrok = parseFloat(existing.buy_brokerage || existing.brokerage || 0) - closedBuyBrok;
        const remainingMargin = (parseFloat(existing.margin || 0) / existingQty) * remainingQty;
        const closedMargin = parseFloat(existing.margin || 0) - remainingMargin;

        // Update existing (reduce qty)
        await supabase.from('trades').update({
          quantity: remainingQty, margin: remainingMargin,
          buy_brokerage: remainingBuyBrok, brokerage: remainingBuyBrok, updated_at: now,
        }).eq('id', existing.id);

        // Create closed partial record
        await supabase.from('trades').insert({
          user_id: userId, account_id: accountId, symbol: existing.symbol,
          exchange: existing.exchange, trade_type: existing.trade_type,
          quantity: incomingQty, original_quantity: existingQty,
          open_price: parseFloat(existing.open_price), close_price: openPrice,
          current_price: openPrice, stop_loss: 0, take_profit: 0,
          margin: closedMargin, buy_brokerage: closedBuyBrok, sell_brokerage: exitBrokerage,
          brokerage: totalBrokerage, profit: netProfit, status: 'closed',
          open_time: existing.open_time, close_time: now, updated_at: now,
          comment: `Partial close: ${incomingQty} of ${existingQty} ${existing.trade_type}. Remaining: ${remainingQty}`,
        });

        await settleAccount(accountId, netProfit, closedMargin, now);

        return res.json({
          success: true,
          data: { reducedFrom: existingQty, remaining: remainingQty, profit: netProfit },
          message: `Reduced ${oppositeType} position by ${incomingQty}. Remaining: ${remainingQty}. P&L: ₹${netProfit.toFixed(2)}`,
        });
      }
    }

    // ── SAME direction → merge (average-up/down) ──────────────────
    const { data: existingTrades } = await supabase
      .from('trades').select('*').eq('account_id', accountId)
      .eq('symbol', symbolData.symbol).eq('trade_type', type).eq('status', 'open');

    if (existingTrades && existingTrades.length > 0) {
      const existing = existingTrades[0];
      const oldQty = parseFloat(existing.quantity);
      const oldPrice = parseFloat(existing.open_price);
      const addQty = parseFloat(quantity);
      const newQty = oldQty + addQty;
      const newAvgPrice = ((oldPrice * oldQty) + (openPrice * addQty)) / newQty;

      const additionalMargin = marginRequired;
      const additionalBrokerage = entryBrokerage;
      const newTotalMargin = parseFloat(existing.margin || 0) + additionalMargin;
      const newBuyBrokerage = parseFloat(existing.buy_brokerage || existing.brokerage || 0) + additionalBrokerage;

      const currentPrice = parseFloat(existing.current_price || openPrice);
      const direction = type === 'buy' ? 1 : -1;
      const newProfit = ((currentPrice - newAvgPrice) * direction * newQty * lotSize) - newBuyBrokerage;

      const { data: updatedTrade, error: updateError } = await supabase
        .from('trades').update({
          quantity: newQty, open_price: newAvgPrice, margin: newTotalMargin,
          brokerage: newBuyBrokerage, buy_brokerage: newBuyBrokerage,
          profit: newProfit, current_price: currentPrice,
          stop_loss: parseFloat(stopLoss) || parseFloat(existing.stop_loss) || 0,
          take_profit: parseFloat(takeProfit) || parseFloat(existing.take_profit) || 0,
          comment: `${existing.comment || ''} [+${addQty}@${openPrice.toFixed(2)}]`.trim(),
          updated_at: now,
        }).eq('id', existing.id).select().single();
      if (updateError) throw updateError;

      const newAccountMargin = parseFloat(account.margin || 0) + additionalMargin;
      const newFreeMargin = parseFloat(account.balance) - newAccountMargin;
      await supabase.from('accounts').update({
        margin: newAccountMargin, free_margin: Math.max(0, newFreeMargin), updated_at: now,
      }).eq('id', accountId);

      return res.json({
        success: true, data: updatedTrade, merged: true,
        message: `Merged into existing position. New qty: ${newQty}, Avg price: ₹${newAvgPrice.toFixed(2)}`,
      });
    }

    // ── Brand-new position ────────────────────────────────────────
    const tradeData = {
      user_id: userId, account_id: accountId, symbol: symbolData.symbol,
      exchange: symbolData.exchange || 'NSE', trade_type: type,
      quantity: parseFloat(quantity), open_price: openPrice, current_price: openPrice,
      stop_loss: parseFloat(stopLoss) || 0, take_profit: parseFloat(takeProfit) || 0,
      margin: marginRequired, brokerage: entryBrokerage, buy_brokerage: entryBrokerage,
      sell_brokerage: 0, profit: -entryBrokerage, status: 'open', comment,
      open_time: now,
    };

    const { data: trade, error: tradeError } = await supabase
      .from('trades').insert(tradeData).select().single();
    if (tradeError) {
      console.error('Supabase insert trade error:', tradeError);
      return res.status(400).json({ success: false, message: tradeError.message || 'Failed to create trade' });
    }

    const newMargin = parseFloat(account.margin || 0) + marginRequired;
    const newFreeMargin = parseFloat(account.balance) - newMargin;
    await supabase.from('accounts').update({
      margin: newMargin, free_margin: newFreeMargin, updated_at: now,
    }).eq('id', accountId);

    res.json({ success: true, data: trade, message: `${type.toUpperCase()} order executed at ${openPrice}` });
  } catch (err) {
    console.error('Place order error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to place order' });
  }
};

// ─────────────────────────────────────────────
//  CLOSE POSITION  (full or partial)
// ─────────────────────────────────────────────
exports.closePosition = async (req, res) => {
  try {
    const { tradeId }  = req.params;
    const { accountId, closeQuantity } = req.body;
    const userId = req.user.id;

    if (!tradeId)    return res.status(400).json({ success: false, message: 'Trade ID is required' });
    if (!accountId)  return res.status(400).json({ success: false, message: 'Account ID is required' });

    const isAdminClose = req.headers['x-admin-close'] === 'true';

    // Lookup symbol for market-hours check
    let tradeSymbolForCheck = '';
    let tradeExchangeForCheck = '';
    try {
      const { data: tradeCheck } = await supabase
        .from('trades')
        .select('symbol, exchange')
        .eq('id', tradeId)
        .single();

      tradeSymbolForCheck = tradeCheck?.symbol || '';
      tradeExchangeForCheck = tradeCheck?.exchange || '';
    } catch (_) {}

    if (!isMarketOpen(tradeSymbolForCheck, tradeExchangeForCheck) && !isAdminClose) {
      const holiday = getHolidayStatus();
      const isCommodity = isCommoditySymbol(tradeSymbolForCheck, tradeExchangeForCheck);
      let reason;
      if (holiday.isHoliday)  reason = `Market Holiday: ${holiday.message || 'Market is closed today.'}`;
      else if (isCommodity)   reason = 'Commodity market is closed. Trading hours: 9:00 AM – 11:30 PM IST, Monday to Friday.';
      else                    reason = 'Market is closed. Positions cannot be closed outside trading hours.';
      return res.status(400).json({ success: false, message: reason });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id, balance, credit, margin)')
      .eq('id', tradeId).eq('status', 'open').single();
    if (tradeError || !trade)
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    if (trade.accounts.user_id !== userId)
      return res.status(403).json({ success: false, message: 'Unauthorized' });

    const { data: userData } = await supabase.from('users').select('brokerage_rate').eq('id', userId).single();
    const brokerageRate = userData?.brokerage_rate || 0.0003;

    // Resolve close price
    const liveP = kiteStreamService.getFreshPrice(trade.symbol);
    let closePrice = trade.trade_type === 'buy'
      ? Number(liveP?.bid || liveP?.last || 0)
      : Number(liveP?.ask || liveP?.last || 0);

    if ((!closePrice || isNaN(closePrice) || closePrice <= 0) && !isAdminClose)
      return res.status(409).json({
        success: false, code: 'OFF_QUOTES',
        message: `${trade.symbol} is off quotes. Live price is older than 10 seconds.`,
      });
    if ((!closePrice || isNaN(closePrice) || closePrice <= 0) && isAdminClose)
      closePrice = parseFloat(trade.current_price || trade.open_price || 0);
    if (!closePrice || isNaN(closePrice) || closePrice <= 0)
      return res.status(400).json({
        success: false,
        message: `Cannot determine close price for ${trade.symbol}. Market data unavailable.`,
      });

    const tradeQuantity  = parseFloat(trade.quantity);
    const quantityToClose = closeQuantity ? Math.min(parseFloat(closeQuantity), tradeQuantity) : tradeQuantity;
    const isFullClose    = quantityToClose >= tradeQuantity;

    const direction      = trade.trade_type === 'buy' ? 1 : -1;
    const lotSize        = 1;
    const priceDiff      = (closePrice - parseFloat(trade.open_price)) * direction;
    const grossProfit    = priceDiff * quantityToClose * lotSize;

    // Commission: proportional buy-side + full sell-side on closed qty
    const sellBrokerage  = closePrice * quantityToClose * lotSize * brokerageRate;
    const buyBrokerageProportional =
      (parseFloat(trade.buy_brokerage || trade.brokerage || 0) / tradeQuantity) * quantityToClose;
    const totalBrokerage = buyBrokerageProportional + sellBrokerage;
    const netProfit      = grossProfit - totalBrokerage;
    const closedMargin   = (parseFloat(trade.margin || 0) / tradeQuantity) * quantityToClose;
    const closeTime      = new Date().toISOString();

    if (isFullClose) {
      const { data: closedTrade, error: updateError } = await supabase
        .from('trades').update({
          close_price: closePrice, profit: netProfit, sell_brokerage: sellBrokerage,
          brokerage: totalBrokerage, status: 'closed', close_time: closeTime, updated_at: closeTime,
        }).eq('id', tradeId).select().single();
      if (updateError) throw updateError;

      await settleAccount(accountId, netProfit, parseFloat(trade.margin || 0), closeTime);

      return res.json({
        success: true, data: closedTrade,
        message: `Position closed at ${closePrice}. P&L: ₹${netProfit.toFixed(2)}`,
      });
    }

    // ── Partial close ─────────────────────────────────────────────
    // FIX: The quantity shown in Deals for a partial close must reflect:
    //   - trade_type  = original side (e.g. 'buy')
    //   - quantity    = how many shares WERE OPEN originally
    //   - The "closed" child record shows how many were sold
    // ─────────────────────────────────────────────────────────────
    const remainingQuantity   = tradeQuantity - quantityToClose;
    const remainingBuyBrokerage =
      parseFloat(trade.buy_brokerage || trade.brokerage || 0) - buyBrokerageProportional;
    const remainingMargin    = (parseFloat(trade.margin || 0) / tradeQuantity) * remainingQuantity;

    // Update existing open trade (reduced qty)
    await supabase.from('trades').update({
      quantity: remainingQuantity, margin: remainingMargin,
      buy_brokerage: remainingBuyBrokerage, brokerage: remainingBuyBrokerage, updated_at: closeTime,
    }).eq('id', tradeId);

    // Create closed record for the partial close
    const closedPartialRecord = {
      user_id:           trade.user_id,
      account_id:        trade.account_id,
      symbol:            trade.symbol,
      exchange:          trade.exchange,
      trade_type:        trade.trade_type,     // ← original side (buy/sell)
      quantity:          quantityToClose,       // ← how many were closed now
      original_quantity: tradeQuantity,         // ← how many were open before this close
      open_price:        parseFloat(trade.open_price),
      close_price:       closePrice,
      current_price:     closePrice,
      stop_loss:         parseFloat(trade.stop_loss || 0),
      take_profit:       parseFloat(trade.take_profit || 0),
      margin:            closedMargin,
      buy_brokerage:     buyBrokerageProportional,
      sell_brokerage:    sellBrokerage,
      brokerage:         totalBrokerage,
      profit:            netProfit,
      status:            'closed',
      open_time:         trade.open_time,
      close_time:        closeTime,
      updated_at:        closeTime,
      comment:           `Partial close: ${quantityToClose} of ${tradeQuantity}. Remaining: ${remainingQuantity}. ${trade.comment || ''}`.trim(),
    };

    try {
      await supabase.from('trades').insert(closedPartialRecord);
    } catch (insertErr) {
      console.warn('Could not insert partial close record:', insertErr.message);
    }

    await settleAccount(accountId, netProfit, closedMargin, closeTime);

    return res.json({
      success: true,
      message: `Partially closed ${quantityToClose} of ${tradeQuantity}. P&L: ₹${netProfit.toFixed(2)}. Remaining: ${remainingQuantity}`,
      data: { closedQuantity: quantityToClose, remainingQuantity, profit: netProfit },
    });
  } catch (err) {
    console.error('Close position error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to close position' });
  }
};

// ─────────────────────────────────────────────
//  PARTIAL CLOSE (proxy)
// ─────────────────────────────────────────────
exports.partialClose = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { accountId, volume } = req.body;
    if (!tradeId || !accountId || !volume)
      return res.status(400).json({ success: false, message: 'Trade ID, Account ID, and volume are required' });
    req.body.closeQuantity = volume;
    return exports.closePosition(req, res);
  } catch (err) {
    console.error('Partial close error:', err);
    res.status(500).json({ success: false, message: 'Failed to partial close position' });
  }
};

// ─────────────────────────────────────────────
//  MODIFY POSITION  (SL / TP only — no commission change)
// ─────────────────────────────────────────────
exports.modifyPosition = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { stopLoss, takeProfit } = req.body;
    const userId = req.user.id;

    if (!tradeId)
      return res.status(400).json({ success: false, message: 'Trade ID is required' });

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id)')
      .eq('id', tradeId).eq('status', 'open').single();
    if (tradeError || !trade)
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    if (trade.accounts.user_id !== userId)
      return res.status(403).json({ success: false, message: 'Unauthorized' });

    // Modify only adjusts SL/TP — commission is NOT re-applied.
    // Commission is captured at open and at close, not on modify.
    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades').update({
        stop_loss:  parseFloat(stopLoss)   || 0,
        take_profit: parseFloat(takeProfit) || 0,
        updated_at: new Date().toISOString(),
      }).eq('id', tradeId).select().single();
    if (updateError) throw updateError;

    res.json({ success: true, data: updatedTrade, message: 'Position modified successfully' });
  } catch (err) {
    console.error('Modify position error:', err);
    res.status(500).json({ success: false, message: 'Failed to modify position' });
  }
};

// ─────────────────────────────────────────────
//  CLOSE ALL POSITIONS
// ─────────────────────────────────────────────
exports.closeAllPositions = async (req, res) => {
  try {
    const { accountId, filterType = 'all', tradeIds = [] } = req.body;
    const userId = req.user.id;

    if (!accountId)
      return res.status(400).json({ success: false, message: 'Account ID is required' });

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const { data: userData } = await supabase.from('users').select('brokerage_rate').eq('id', userId).single();
    const brokerageRate = userData?.brokerage_rate || 0.0003;

    let query = supabase.from('trades').select('*').eq('account_id', accountId).eq('status', 'open');
    if (tradeIds.length > 0) query = query.in('id', tradeIds);

    const { data: trades, error: tradesError } = await query;
    if (tradesError) throw tradesError;
    if (!trades || trades.length === 0)
      return res.status(400).json({ success: false, message: 'No open positions to close' });

    let tradesToClose = trades;
    if (filterType === 'profitable') tradesToClose = trades.filter(t => parseFloat(t.profit || 0) > 0);
    else if (filterType === 'losing') tradesToClose = trades.filter(t => parseFloat(t.profit || 0) < 0);
    if (tradesToClose.length === 0)
      return res.status(400).json({ success: false, message: `No ${filterType} positions to close` });

    const closeTime = new Date().toISOString();
    let totalProfit = 0;
    let totalMarginFreed = 0;

    const closePlans = [];
    const staleSymbols = [];

    for (const trade of tradesToClose) {
      const liveP = kiteStreamService.getFreshPrice(trade.symbol);
      const closePrice = trade.trade_type === 'buy'
        ? Number(liveP?.bid || liveP?.last || 0)
        : Number(liveP?.ask || liveP?.last || 0);

      if (!closePrice || isNaN(closePrice) || closePrice <= 0) {
        staleSymbols.push(trade.symbol);
        continue;
      }

      closePlans.push({ trade, closePrice });
    }

    if (staleSymbols.length > 0) {
      const uniqueStale = [...new Set(staleSymbols)];
      return res.status(409).json({
        success: false,
        code: 'OFF_QUOTES',
        message: `${uniqueStale.join(', ')} is off quotes. Live price is older than 10 seconds.`,
      });
    }

    for (const { trade, closePrice } of closePlans) {

      const direction    = trade.trade_type === 'buy' ? 1 : -1;
      const priceDiff    = (closePrice - parseFloat(trade.open_price)) * direction;
      const grossProfit  = priceDiff * trade.quantity;
      const sellBrokerage= closePrice * trade.quantity * brokerageRate;
      const buyBrokerage = parseFloat(trade.buy_brokerage || trade.brokerage || 0);
      const totalBrok    = buyBrokerage + sellBrokerage;
      const netProfit    = grossProfit - totalBrok;

      totalProfit      += netProfit;
      totalMarginFreed += parseFloat(trade.margin || 0);

      await supabase.from('trades').update({
        close_price: closePrice, profit: netProfit, sell_brokerage: sellBrokerage,
        brokerage: totalBrok, status: 'closed', close_time: closeTime,
      }).eq('id', trade.id);
    }

    await settleAccount(accountId, totalProfit, totalMarginFreed, closeTime);

    res.json({
      success: true,
      data: { closedCount: tradesToClose.length, totalProfit },
      message: `Closed ${tradesToClose.length} position(s). Total P&L: ₹${totalProfit.toFixed(2)}`,
    });
  } catch (err) {
    console.error('Close all positions error:', err);
    res.status(500).json({ success: false, message: 'Failed to close positions' });
  }
};

// ─────────────────────────────────────────────
//  ADD QUANTITY TO EXISTING POSITION
// ─────────────────────────────────────────────
exports.addQuantity = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { accountId, quantity } = req.body;
    const userId = req.user.id;

    if (!tradeId || !accountId || !quantity || quantity <= 0)
      return res.status(400).json({ success: false, message: 'Trade ID, Account ID, and valid quantity are required' });

    const { data: userData, error: userError } = await supabase
      .from('users').select('closing_mode, brokerage_rate').eq('id', userId).single();
    if (userError) throw userError;
    if (userData?.closing_mode)
      return res.status(403).json({ success: false, message: 'Your account is in closing mode. You cannot add to positions.' });

    const brokerageRate = userData?.brokerage_rate || 0.0003;

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id, balance, margin, free_margin, leverage)')
      .eq('id', tradeId).eq('status', 'open').single();
    if (tradeError || !trade)
      return res.status(404).json({ success: false, message: 'Trade not found or already closed' });
    if (trade.accounts.user_id !== userId)
      return res.status(403).json({ success: false, message: 'Unauthorized' });

    const addPrice = await resolvePrice(trade.symbol, trade.trade_type);
    if (!addPrice || addPrice <= 0)
      return res.status(409).json({
        success: false, code: 'OFF_QUOTES',
        message: `${trade.symbol} is off quotes. Cannot add quantity without valid price.`,
      });

    const addQty      = parseFloat(quantity);
    const oldQty      = parseFloat(trade.quantity);
    const oldPrice    = parseFloat(trade.open_price);
    const leverage    = trade.accounts.leverage || 5;
    const lotSize     = 1;

    const additionalMargin    = (addPrice * addQty * lotSize) / leverage;
    const freeMargin           = parseFloat(trade.accounts.free_margin || 0);
    if (additionalMargin > freeMargin)
      return res.status(400).json({
        success: false,
        message: `Insufficient margin. Required: ₹${additionalMargin.toFixed(2)}, Available: ₹${freeMargin.toFixed(2)}`,
      });

    const newQty        = oldQty + addQty;
    const newAvgPrice   = ((oldPrice * oldQty) + (addPrice * addQty)) / newQty;
    const additionalBrok= addPrice * addQty * lotSize * brokerageRate;
    const newBuyBrokerage = parseFloat(trade.buy_brokerage || trade.brokerage || 0) + additionalBrok;
    const newTotalMargin  = parseFloat(trade.margin || 0) + additionalMargin;

    const currentPrice = parseFloat(trade.current_price || addPrice);
    const direction    = trade.trade_type === 'buy' ? 1 : -1;
    const newProfit    = ((currentPrice - newAvgPrice) * direction * newQty * lotSize) - newBuyBrokerage;
    const now          = new Date().toISOString();

    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades').update({
        quantity: newQty, open_price: newAvgPrice, margin: newTotalMargin,
        brokerage: newBuyBrokerage, buy_brokerage: newBuyBrokerage,
        profit: newProfit, current_price: currentPrice,
        comment: `${trade.comment || ''} [+${addQty}@${addPrice.toFixed(2)}]`.trim(), updated_at: now,
      }).eq('id', tradeId).select().single();
    if (updateError) throw updateError;

    const newAccountMargin = parseFloat(trade.accounts.margin || 0) + additionalMargin;
    const newFreeMargin    = parseFloat(trade.accounts.balance || 0) - newAccountMargin;
    await supabase.from('accounts').update({
      margin: newAccountMargin, free_margin: Math.max(0, newFreeMargin), updated_at: now,
    }).eq('id', accountId);

    res.json({
      success: true, data: updatedTrade,
      message: `Added ${addQty} to position at ₹${addPrice.toFixed(2)}. New qty: ${newQty}, Avg price: ₹${newAvgPrice.toFixed(2)}`,
    });
  } catch (err) {
    console.error('Add quantity error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to add quantity' });
  }
};

// ─────────────────────────────────────────────
//  MODIFY PENDING ORDER
// ─────────────────────────────────────────────
exports.modifyPendingOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { price, stopLoss, takeProfit } = req.body;
    const userId = req.user.id;

    if (!orderId)
      return res.status(400).json({ success: false, message: 'Order ID is required' });

    const { data: order, error } = await supabase
      .from('pending_orders').select('*').eq('id', orderId).eq('user_id', userId).eq('status', 'pending').single();
    if (error || !order)
      return res.status(404).json({ success: false, message: 'Pending order not found or already processed' });

    if (price !== undefined && price !== null) {
      const parsedPrice = parseFloat(price);
      if (!parsedPrice || parsedPrice <= 0)
        return res.status(400).json({ success: false, message: 'Invalid price' });

      const livePrice = kiteStreamService.getFreshPrice(order.symbol);
      const currentBid = Number(livePrice?.bid || livePrice?.last || 0);
      const currentAsk = Number(livePrice?.ask || livePrice?.last || 0);
      const cmp = order.trade_type === 'buy' ? currentAsk : currentBid;

      if (!cmp || cmp <= 0) {
        return res.status(409).json({
          success: false,
          code: 'OFF_QUOTES',
          message: `${order.symbol} is off quotes. Live price is older than 10 seconds.`,
        });
      }

      if (order.order_type === 'buy_limit' && parsedPrice > cmp * 0.995)
        return res.status(400).json({
          success: false,
          message: `Buy Limit price must be at least 0.5% below current price. Max: ₹${(cmp * 0.995).toFixed(2)}`,
        });
      if (order.order_type === 'sell_limit' && parsedPrice < cmp * 1.005)
        return res.status(400).json({
          success: false,
          message: `Sell Limit price must be at least 0.5% above current price. Min: ₹${(cmp * 1.005).toFixed(2)}`,
        });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (price !== undefined && price !== null) updates.price = parseFloat(price);
    if (stopLoss !== undefined) updates.stop_loss = parseFloat(stopLoss) || 0;
    if (takeProfit !== undefined) updates.take_profit = parseFloat(takeProfit) || 0;

    const { data: updatedOrder, error: updateError } = await supabase
      .from('pending_orders').update(updates).eq('id', orderId).select().single();
    if (updateError) throw updateError;

    res.json({ success: true, data: updatedOrder, message: 'Pending order modified successfully' });
  } catch (err) {
    console.error('Modify pending order error:', err);
    res.status(500).json({ success: false, message: 'Failed to modify pending order' });
  }
};

// ─────────────────────────────────────────────
//  CANCEL PENDING ORDER
// ─────────────────────────────────────────────
exports.cancelPendingOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    if (!orderId)
      return res.status(400).json({ success: false, message: 'Order ID is required' });

    const { data: order, error } = await supabase
      .from('pending_orders').select('*').eq('id', orderId).eq('user_id', userId).eq('status', 'pending').single();
    if (error || !order)
      return res.status(404).json({ success: false, message: 'Pending order not found or already processed' });

    const { data: cancelledOrder, error: updateError } = await supabase
      .from('pending_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', orderId).select().single();
    if (updateError) throw updateError;

    res.json({
      success: true, data: cancelledOrder,
      message: `${order.order_type.replace('_', ' ').toUpperCase()} order for ${order.symbol} cancelled`,
    });
  } catch (err) {
    console.error('Cancel pending order error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel order' });
  }
};

// ─────────────────────────────────────────────
//  CANCEL ALL PENDING ORDERS
// ─────────────────────────────────────────────
exports.cancelAllPendingOrders = async (req, res) => {
  try {
    const { accountId } = req.body;
    const userId = req.user.id;

    if (!accountId)
      return res.status(400).json({ success: false, message: 'Account ID is required' });

    const { data: orders, error } = await supabase
      .from('pending_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('account_id', accountId).eq('user_id', userId).eq('status', 'pending').select();
    if (error) throw error;

    res.json({ success: true, data: orders || [], message: `${(orders || []).length} order(s) cancelled` });
  } catch (err) {
    console.error('Cancel all pending orders error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel orders' });
  }
};

// ─────────────────────────────────────────────
//  TRADE HISTORY
// ─────────────────────────────────────────────
exports.getTradeHistory = async (req, res) => {
  try {
    const { accountId, period, symbol, limit = 500 } = req.query;
    const userId = req.user.id;

    if (!accountId)
      return res.status(400).json({ success: false, message: 'Account ID is required' });

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    let query = supabase.from('trades').select('*').eq('account_id', accountId).eq('status', 'closed')
      .order('close_time', { ascending: false }).limit(parseInt(limit));

    if (symbol) query = query.eq('symbol', symbol.toUpperCase());

    if (period) {
      const now = new Date();
      let startDate;
      switch (period) {
        case 'today':   startDate = new Date(now.setHours(0, 0, 0, 0)); break;
        case 'week':    startDate = new Date(now.setDate(now.getDate() - 7)); break;
        case 'month':   startDate = new Date(now.setMonth(now.getMonth() - 1)); break;
        case '3months': startDate = new Date(now.setMonth(now.getMonth() - 3)); break;
        default:        startDate = new Date(now.setMonth(now.getMonth() - 3));
      }
      if (startDate) query = query.gte('close_time', startDate.toISOString());
    } else {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      query = query.gte('close_time', threeMonthsAgo.toISOString());
    }

    const { data: trades, error } = await query;
    if (error) throw error;

    res.json({ success: true, data: trades || [] });
  } catch (err) {
    console.error('Get trade history error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch trade history' });
  }
};

// ─────────────────────────────────────────────
//  TRADE STATS
// ─────────────────────────────────────────────
exports.getTradeStats = async (req, res) => {
  try {
    const { accountId } = req.query;
    const userId = req.user.id;

    if (!accountId)
      return res.status(400).json({ success: false, message: 'Account ID is required' });

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const { data: trades, error } = await supabase
      .from('trades').select('*').eq('account_id', accountId).eq('status', 'closed');
    if (error) throw error;

    const allTrades    = trades || [];
    const winning      = allTrades.filter(t => parseFloat(t.profit || 0) > 0);
    const losing       = allTrades.filter(t => parseFloat(t.profit || 0) < 0);
    const totalProfit  = winning.reduce((s, t) => s + parseFloat(t.profit || 0), 0);
    const totalLoss    = Math.abs(losing.reduce((s, t) => s + parseFloat(t.profit || 0), 0));
    const totalComm    = allTrades.reduce((s, t) => s + parseFloat(t.brokerage || 0), 0);

    res.json({
      success: true,
      data: {
        totalTrades:  allTrades.length,
        winningTrades: winning.length,
        losingTrades:  losing.length,
        winRate:       allTrades.length > 0 ? (winning.length / allTrades.length) * 100 : 0,
        totalProfit, totalLoss, netPnL: totalProfit - totalLoss,
        totalCommission: totalComm,
        profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
      },
    });
  } catch (err) {
    console.error('Get trade stats error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch trade statistics' });
  }
};

// ─────────────────────────────────────────────
//  PENDING ORDER HISTORY
// ─────────────────────────────────────────────
exports.getPendingOrderHistory = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    const { data: account, error: accountError } = await supabase
      .from('accounts').select('id').eq('id', accountId).eq('user_id', userId).single();
    if (accountError || !account)
      return res.status(404).json({ success: false, message: 'Account not found' });

    const { data: orders, error } = await supabase
      .from('pending_orders').select('*').eq('account_id', accountId).eq('user_id', userId)
      .neq('status', 'pending').order('updated_at', { ascending: false }).limit(200);
    if (error) {
      console.log('Pending order history query error:', error.message);
      return res.json({ success: true, data: [] });
    }

    res.json({ success: true, data: orders || [] });
  } catch (err) {
    console.error('Get pending order history error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch order history' });
  }
};
