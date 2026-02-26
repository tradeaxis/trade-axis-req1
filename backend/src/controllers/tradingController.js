// backend/src/controllers/tradingController.js
const { supabase } = require('../config/supabase');

// ============ GET POSITIONS ============
exports.getPositions = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get open trades
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'open')
      .order('open_time', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: trades || [],
    });
  } catch (error) {
    console.error('Get positions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch positions',
    });
  }
};

// ============ GET PENDING ORDERS ============
exports.getPendingOrders = async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = req.user.id;

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get pending orders
    const { data: orders, error } = await supabase
      .from('pending_orders')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet, return empty array
      console.log('Pending orders table may not exist:', error.message);
      return res.json({
        success: true,
        data: [],
      });
    }

    res.json({
      success: true,
      data: orders || [],
    });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending orders',
    });
  }
};

// ============ PLACE ORDER ============
exports.placeOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      accountId,
      symbol,
      type,
      orderType = 'market',
      quantity,
      price = 0,
      stopLoss = 0,
      takeProfit = 0,
      slippage = 3,
      comment = '',
    } = req.body;

    // Validation
    if (!accountId || !symbol || !type || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: accountId, symbol, type, quantity',
      });
    }

    if (quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be greater than 0',
      });
    }

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get symbol info
    const { data: symbolData, error: symbolError } = await supabase
      .from('symbols')
      .select('*')
      .eq('symbol', symbol.toUpperCase())
      .single();

    if (symbolError || !symbolData) {
      return res.status(404).json({
        success: false,
        message: 'Symbol not found',
      });
    }

    // For now, only support market orders
    if (orderType !== 'market') {
      return res.status(400).json({
        success: false,
        message: 'Only market orders are currently supported',
      });
    }

    // Get current price
    const openPrice = type === 'buy' 
      ? parseFloat(symbolData.ask || symbolData.last_price) 
      : parseFloat(symbolData.bid || symbolData.last_price);

    if (!openPrice || openPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid price. Market may be closed.',
      });
    }

    // Calculate margin required
    const lotSize = symbolData.lot_size || 1;
    const leverage = account.leverage || 5;
    const marginRequired = (openPrice * parseFloat(quantity) * lotSize) / leverage;

    // Check free margin
    const freeMargin = parseFloat(account.free_margin || account.balance);
    if (marginRequired > freeMargin) {
      return res.status(400).json({
        success: false,
        message: `Insufficient margin. Required: ₹${marginRequired.toFixed(2)}, Available: ₹${freeMargin.toFixed(2)}`,
      });
    }

    // Calculate brokerage
    const brokerageRate = 0.0003; // 0.03%
    const brokerage = openPrice * parseFloat(quantity) * lotSize * brokerageRate;

    // Create trade
    const tradeData = {
      user_id: userId,
      account_id: accountId,
      symbol: symbolData.symbol,
      // ✅ ADD THIS:
      exchange: symbolData.exchange || 'NSE',

      trade_type: type,
      quantity: parseFloat(quantity),
      open_price: openPrice,
      current_price: openPrice,
      stop_loss: parseFloat(stopLoss) || 0,
      take_profit: parseFloat(takeProfit) || 0,
      margin: marginRequired,
      brokerage,
      profit: 0,
      status: 'open',
      comment,
      open_time: new Date().toISOString(),
    };

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .insert(tradeData)
      .select()
      .single();

    if (tradeError) {
      console.error('Supabase insert trade error:', tradeError);
      return res.status(400).json({
        success: false,
        message: tradeError.message || 'Failed to create trade',
        details: tradeError,
      });
    }

    // Update account margin
    const newMargin = parseFloat(account.margin || 0) + marginRequired;
    const newFreeMargin = parseFloat(account.balance) - newMargin;

    await supabase
      .from('accounts')
      .update({
        margin: newMargin,
        free_margin: newFreeMargin,
        updated_at: new Date().toISOString(),
      })
      .eq('id', accountId);

    res.json({
      success: true,
      data: trade,
      message: `${type.toUpperCase()} order executed at ${openPrice}`,
    });
  } catch (error) {
    console.error('Place order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to place order',
    });
  }
};

// ============ CLOSE POSITION ============
exports.closePosition = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { accountId } = req.body;
    const userId = req.user.id;

    if (!tradeId || !accountId) {
      return res.status(400).json({
        success: false,
        message: 'Trade ID and Account ID are required',
      });
    }

    // Verify trade ownership
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id, balance, margin)')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already closed',
      });
    }

    if (trade.accounts.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Get current price
    const { data: symbolData, error: symbolError } = await supabase
      .from('symbols')
      .select('bid, ask, lot_size')
      .eq('symbol', trade.symbol)
      .single();

    if (symbolError || !symbolData) {
      return res.status(400).json({
        success: false,
        message: 'Failed to get current price',
      });
    }

    // Close price is bid for buy, ask for sell
    const closePrice = trade.trade_type === 'buy' 
      ? parseFloat(symbolData.bid || symbolData.ask) 
      : parseFloat(symbolData.ask || symbolData.bid);

    // Calculate P&L
    const direction = trade.trade_type === 'buy' ? 1 : -1;
    const priceDiff = (closePrice - parseFloat(trade.open_price)) * direction;
    const lotSize = symbolData.lot_size || 1;
    const grossProfit = priceDiff * trade.quantity * lotSize;
    const netProfit = grossProfit - parseFloat(trade.brokerage || 0);

    // Update trade
    const closeTime = new Date().toISOString();
    const { data: closedTrade, error: updateError } = await supabase
      .from('trades')
      .update({
        close_price: closePrice,
        profit: netProfit,
        status: 'closed',
        close_time: closeTime,
        updated_at: closeTime,
      })
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update account
    const newBalance = parseFloat(trade.accounts.balance) + netProfit;
    const newMargin = Math.max(0, parseFloat(trade.accounts.margin) - parseFloat(trade.margin || 0));
    const newFreeMargin = newBalance - newMargin;

    await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        margin: newMargin,
        free_margin: newFreeMargin,
        updated_at: closeTime,
      })
      .eq('id', accountId);

    res.json({
      success: true,
      data: closedTrade,
      message: `Position closed at ${closePrice}. P&L: ₹${netProfit.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Close position error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close position',
    });
  }
};

// ============ PARTIAL CLOSE ============
exports.partialClose = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { accountId, volume } = req.body;
    const userId = req.user.id;

    if (!tradeId || !accountId || !volume) {
      return res.status(400).json({
        success: false,
        message: 'Trade ID, Account ID, and volume are required',
      });
    }

    // Verify trade ownership
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id)')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already closed',
      });
    }

    if (trade.accounts.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const closeVolume = parseFloat(volume);
    const tradeVolume = parseFloat(trade.quantity);

    if (closeVolume <= 0 || closeVolume >= tradeVolume) {
      return res.status(400).json({
        success: false,
        message: 'Invalid volume. Must be greater than 0 and less than position size.',
      });
    }

    // For partial close, just update the quantity
    const remainingVolume = tradeVolume - closeVolume;

    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades')
      .update({
        quantity: remainingVolume,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: updatedTrade,
      message: `Closed ${closeVolume} lots. Remaining: ${remainingVolume} lots`,
    });
  } catch (error) {
    console.error('Partial close error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to partial close position',
    });
  }
};

// ============ MODIFY POSITION ============
exports.modifyPosition = async (req, res) => {
  try {
    const { tradeId } = req.params;
    const { stopLoss, takeProfit } = req.body;
    const userId = req.user.id;

    if (!tradeId) {
      return res.status(400).json({
        success: false,
        message: 'Trade ID is required',
      });
    }

    // Verify trade ownership
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*, accounts!inner(user_id)')
      .eq('id', tradeId)
      .eq('status', 'open')
      .single();

    if (tradeError || !trade) {
      return res.status(404).json({
        success: false,
        message: 'Trade not found or already closed',
      });
    }

    if (trade.accounts.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Update trade
    const { data: updatedTrade, error: updateError } = await supabase
      .from('trades')
      .update({
        stop_loss: parseFloat(stopLoss) || 0,
        take_profit: parseFloat(takeProfit) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: updatedTrade,
      message: 'Position modified successfully',
    });
  } catch (error) {
    console.error('Modify position error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to modify position',
    });
  }
};

// ============ CLOSE ALL POSITIONS ============
exports.closeAllPositions = async (req, res) => {
  try {
    const { accountId, filterType = 'all', tradeIds = [] } = req.body;
    const userId = req.user.id;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: 'Account ID is required',
      });
    }

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get trades to close
    let query = supabase
      .from('trades')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'open');

    if (tradeIds.length > 0) {
      query = query.in('id', tradeIds);
    }

    const { data: trades, error: tradesError } = await query;

    if (tradesError) throw tradesError;

    if (!trades || trades.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No open positions to close',
      });
    }

    // Filter trades based on type
    let tradesToClose = trades;
    if (filterType === 'profitable') {
      tradesToClose = trades.filter((t) => parseFloat(t.profit || 0) > 0);
    } else if (filterType === 'losing') {
      tradesToClose = trades.filter((t) => parseFloat(t.profit || 0) < 0);
    }

    if (tradesToClose.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No ${filterType} positions to close`,
      });
    }

    // Close all trades
    const closeTime = new Date().toISOString();
    let totalProfit = 0;

    for (const trade of tradesToClose) {
      // Get current price
      const { data: symbolData } = await supabase
        .from('symbols')
        .select('bid, ask, lot_size')
        .eq('symbol', trade.symbol)
        .single();

      if (!symbolData) continue;

      const closePrice = trade.trade_type === 'buy' 
        ? parseFloat(symbolData.bid) 
        : parseFloat(symbolData.ask);

      const direction = trade.trade_type === 'buy' ? 1 : -1;
      const priceDiff = (closePrice - parseFloat(trade.open_price)) * direction;
      const lotSize = symbolData.lot_size || 1;
      const netProfit = priceDiff * trade.quantity * lotSize - parseFloat(trade.brokerage || 0);

      totalProfit += netProfit;

      await supabase
        .from('trades')
        .update({
          close_price: closePrice,
          profit: netProfit,
          status: 'closed',
          close_time: closeTime,
        })
        .eq('id', trade.id);
    }

    // Update account
    const newBalance = parseFloat(account.balance) + totalProfit;
    await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        margin: 0,
        free_margin: newBalance,
        updated_at: closeTime,
      })
      .eq('id', accountId);

    res.json({
      success: true,
      data: { closedCount: tradesToClose.length, totalProfit },
      message: `Closed ${tradesToClose.length} position(s). Total P&L: ₹${totalProfit.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Close all positions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close positions',
    });
  }
};

// ============ MODIFY PENDING ORDER ============
exports.modifyPendingOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { price, stopLoss, takeProfit } = req.body;
    const userId = req.user.id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required',
      });
    }

    // Verify order ownership
    const { data: order, error: orderError } = await supabase
      .from('pending_orders')
      .select('*, accounts!inner(user_id)')
      .eq('id', orderId)
      .eq('status', 'pending')
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Pending order not found',
      });
    }

    if (order.accounts.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Update order
    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (price !== undefined) updateData.price = parseFloat(price);
    if (stopLoss !== undefined) updateData.stop_loss = parseFloat(stopLoss);
    if (takeProfit !== undefined) updateData.take_profit = parseFloat(takeProfit);

    const { data: updatedOrder, error: updateError } = await supabase
      .from('pending_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: updatedOrder,
      message: 'Pending order modified successfully',
    });
  } catch (error) {
    console.error('Modify pending order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to modify pending order',
    });
  }
};

// ============ CANCEL PENDING ORDER ============
exports.cancelPendingOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required',
      });
    }

    // Verify order ownership
    const { data: order, error: orderError } = await supabase
      .from('pending_orders')
      .select('*, accounts!inner(user_id)')
      .eq('id', orderId)
      .eq('status', 'pending')
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Pending order not found',
      });
    }

    if (order.accounts.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    // Cancel order
    const { data: cancelledOrder, error: updateError } = await supabase
      .from('pending_orders')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: cancelledOrder,
      message: 'Pending order cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel pending order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel pending order',
    });
  }
};

// ============ CANCEL ALL PENDING ORDERS ============
exports.cancelAllPendingOrders = async (req, res) => {
  try {
    const { accountId, orderIds = [] } = req.body;
    const userId = req.user.id;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: 'Account ID is required',
      });
    }

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get orders to cancel
    let query = supabase
      .from('pending_orders')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'pending');

    if (orderIds.length > 0) {
      query = query.in('id', orderIds);
    }

    const { data: orders, error: ordersError } = await query;

    if (ordersError) {
      // Table might not exist
      return res.json({
        success: true,
        data: { cancelledCount: 0 },
        message: 'No pending orders to cancel',
      });
    }

    if (!orders || orders.length === 0) {
      return res.json({
        success: true,
        data: { cancelledCount: 0 },
        message: 'No pending orders to cancel',
      });
    }

    // Cancel all orders
    const { error: updateError } = await supabase
      .from('pending_orders')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', orders.map((o) => o.id));

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: { cancelledCount: orders.length },
      message: `${orders.length} pending order(s) cancelled`,
    });
  } catch (error) {
    console.error('Cancel all pending orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel pending orders',
    });
  }
};

// ============ GET TRADE HISTORY ============
exports.getTradeHistory = async (req, res) => {
  try {
    const { accountId, period, symbol, limit = 100 } = req.query;
    const userId = req.user.id;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: 'Account ID is required',
      });
    }

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Build query
    let query = supabase
      .from('trades')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'closed')
      .order('close_time', { ascending: false })
      .limit(parseInt(limit));

    // Apply filters
    if (symbol) {
      query = query.eq('symbol', symbol.toUpperCase());
    }

    // Date filters
    if (period) {
      const now = new Date();
      let startDate;

      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case 'month':
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        case '3months':
          startDate = new Date(now.setMonth(now.getMonth() - 3));
          break;
        case '6months':
          startDate = new Date(now.setMonth(now.getMonth() - 6));
          break;
        case 'year':
          startDate = new Date(now.setFullYear(now.getFullYear() - 1));
          break;
        default:
          startDate = null;
      }

      if (startDate) {
        query = query.gte('close_time', startDate.toISOString());
      }
    }

    const { data: trades, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: trades || [],
    });
  } catch (error) {
    console.error('Get trade history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trade history',
    });
  }
};

// ============ GET TRADE STATISTICS ============
exports.getTradeStats = async (req, res) => {
  try {
    const { accountId, period = 'all' } = req.query;
    const userId = req.user.id;

    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: 'Account ID is required',
      });
    }

    // Verify account ownership
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('*')
      .eq('id', accountId)
      .eq('user_id', userId)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get all closed trades
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'closed');

    if (error) throw error;

    // Calculate statistics
    const allTrades = trades || [];
    const winningTrades = allTrades.filter((t) => parseFloat(t.profit || 0) > 0);
    const losingTrades = allTrades.filter((t) => parseFloat(t.profit || 0) < 0);

    const totalProfit = winningTrades.reduce((sum, t) => sum + parseFloat(t.profit || 0), 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.profit || 0), 0));

    const stats = {
      totalTrades: allTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: allTrades.length > 0 ? (winningTrades.length / allTrades.length) * 100 : 0,
      totalProfit,
      totalLoss,
      netPnL: totalProfit - totalLoss,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get trade stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trade statistics',
    });
  }
};