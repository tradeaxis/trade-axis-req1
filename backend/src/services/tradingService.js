// backend/src/services/tradingService.js
const { supabase } = require('../config/supabase');
const { isMarketOpen } = require('./marketStatus');
const {
  buildOffQuotesMessage,
  resolveTradeablePrice,
} = require('./quoteGuard');

class TradingService {
  async getBrokerageRate(userId) {
    if (!userId) return 0.0003;

    try {
      const { data: user } = await supabase
        .from('users')
        .select('brokerage_rate')
        .eq('id', userId)
        .single();

      return Number(user?.brokerage_rate || 0.0003);
    } catch (_) {
      return 0.0003;
    }
  }

  async settleAccount(accountId, netProfit, marginFreed, now) {
    const { data: account } = await supabase
      .from('accounts')
      .select('balance, credit, margin')
      .eq('id', accountId)
      .single();

    if (!account) return;

    const balance = Number(account.balance || 0);
    const currentCredit = Number(account.credit || 0);
    const currentMargin = Number(account.margin || 0);
    const newCredit = currentCredit + Number(netProfit || 0);
    const newMargin = Math.max(0, currentMargin - Number(marginFreed || 0));
    const newEquity = balance + newCredit;
    const newFreeMargin = newEquity - newMargin;

    await supabase
      .from('accounts')
      .update({
        credit: newCredit,
        equity: newEquity,
        margin: newMargin,
        free_margin: newFreeMargin,
        updated_at: now,
      })
      .eq('id', accountId);
  }

  async resolveCloseMarketData(trade, overrideClosePrice = null) {
    const manualClosePrice = Number(overrideClosePrice || 0);
    if (manualClosePrice > 0) {
      return {
        closePrice: manualClosePrice,
        lotSize: Number(trade.lot_size || 1) || 1,
      };
    }

    if (!isMarketOpen(trade.symbol, trade.exchange)) {
      return {
        closePrice: 0,
        lotSize: Number(trade.lot_size || 1) || 1,
        message: `${trade.symbol} market is closed. Positions can be closed only during market hours.`,
      };
    }

    const { data: symbolData, error } = await supabase
      .from('symbols')
      .select('symbol, bid, ask, last_price, last_update, lot_size')
      .eq('symbol', trade.symbol)
      .single();

    if (!error && symbolData) {
      const closePriceState = resolveTradeablePrice({
        symbol: trade.symbol,
        side: trade.trade_type === 'buy' ? 'sell' : 'buy',
        symbolRow: symbolData,
      });

      if (!closePriceState.isOffQuotes && closePriceState.price > 0) {
        return {
          closePrice: closePriceState.price,
          lotSize: Number(trade.lot_size || symbolData.lot_size || 1) || 1,
        };
      }

      return {
        closePrice: 0,
        lotSize: Number(trade.lot_size || symbolData.lot_size || 1) || 1,
        message: buildOffQuotesMessage(trade.symbol, closePriceState),
      };
    }

    return {
      closePrice: 0,
      lotSize: Number(trade.lot_size || 1) || 1,
      message: `${trade.symbol} quote is unavailable right now.`,
    };
  }

  async previewClosePosition(trade, options = {}) {
    const quantity = Number(options.quantity || trade.quantity || 0);
    if (quantity <= 0) {
      return { success: false, message: 'Invalid quantity' };
    }

    const brokerageRate = options.brokerageRate ?? await this.getBrokerageRate(trade.user_id);
    const { closePrice, lotSize, message } = await this.resolveCloseMarketData(trade, options.closePrice);

    if (!closePrice || Number.isNaN(closePrice) || closePrice <= 0) {
      return { success: false, message: message || `Cannot determine close price for ${trade.symbol}` };
    }

    const totalQuantity = Number(trade.quantity || 0);
    const direction = trade.trade_type === 'buy' ? 1 : -1;
    const openPrice = Number(trade.open_price || 0);
    const grossProfit = (closePrice - openPrice) * direction * quantity * lotSize;
    const totalBuyBrokerage = Number(trade.buy_brokerage || trade.brokerage || 0);
    const buyBrokerage = totalQuantity > 0 && quantity < totalQuantity
      ? (totalBuyBrokerage / totalQuantity) * quantity
      : totalBuyBrokerage;
    const sellBrokerage = closePrice * quantity * lotSize * brokerageRate;
    const totalBrokerage = buyBrokerage + sellBrokerage;
    const netProfit = grossProfit - totalBrokerage;
    const totalMargin = Number(trade.margin || 0);
    const marginFreed = totalQuantity > 0 && quantity < totalQuantity
      ? (totalMargin / totalQuantity) * quantity
      : totalMargin;

    return {
      success: true,
      brokerageRate,
      closePrice,
      lotSize,
      quantity,
      grossProfit,
      buyBrokerage,
      sellBrokerage,
      totalBrokerage,
      netProfit,
      marginFreed,
    };
  }

  // Execute market order
  async executeMarketOrder({
    userId,
    account,
    symbolData,
    type,
    quantity,
    stopLoss = 0,
    takeProfit = 0,
    slippage = 3,
    comment = '',
    magicNumber = 0,
  }) {
    try {
      if (!isMarketOpen(symbolData.symbol, symbolData.exchange)) {
        return { success: false, message: `${symbolData.symbol} market is closed.` };
      }

      const openPriceState = resolveTradeablePrice({
        symbol: symbolData.symbol,
        side: type === 'buy' ? 'buy' : 'sell',
        symbolRow: symbolData,
      });
      const openPrice = openPriceState.price;

      if (!openPrice || openPrice <= 0) {
        return {
          success: false,
          code: 'OFF_QUOTES',
          message: buildOffQuotesMessage(symbolData.symbol, openPriceState),
        };
      }

      // Calculate margin required
      const lotSize = symbolData.lot_size || 1;
      const leverage = account.leverage || 5;
      const marginRequired = (openPrice * quantity * lotSize) / leverage;

      // Check free margin
      const freeMargin = parseFloat(account.free_margin || account.balance);
      if (marginRequired > freeMargin) {
        return {
          success: false,
          message: `Insufficient margin. Required: ₹${marginRequired.toFixed(2)}, Available: ₹${freeMargin.toFixed(2)}`,
        };
      }

      // Calculate brokerage
      const brokerageRate = 0.0003; // 0.03%
      const brokerage = openPrice * quantity * lotSize * brokerageRate;

      // Create trade
      const tradeData = {
        user_id: userId,
        account_id: account.id,
        symbol: symbolData.symbol,
        exchange: symbolData.exchange || 'NSE',
        trade_type: type,
        quantity,
        lot_size: lotSize,
        open_price: openPrice,
        current_price: openPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        margin: marginRequired,
        brokerage,
        buy_brokerage: brokerage,
        sell_brokerage: 0,
        profit: -brokerage,
        status: 'open',
        comment,
        magic_number: magicNumber,
        open_time: new Date().toISOString(),
      };

      const { data: trade, error: tradeError } = await supabase
        .from('trades')
        .insert(tradeData)
        .select()
        .single();

      if (tradeError) throw tradeError;

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
        .eq('id', account.id);

      return {
        success: true,
        trade,
        message: `${type.toUpperCase()} ${quantity} ${symbolData.symbol} @ ${openPrice}`,
      };
    } catch (error) {
      console.error('Execute market order error:', error);
      return { success: false, message: 'Failed to execute order' };
    }
  }

  // Create pending order
  async createPendingOrder({
    userId,
    account,
    symbolData,
    orderType,
    type,
    quantity,
    price,
    stopLoss = 0,
    takeProfit = 0,
    comment = '',
    expiration = 'gtc',
    expirationTime = null,
    magicNumber = 0,
  }) {
    try {
      if (!price || price <= 0) {
        return { success: false, message: 'Invalid price for pending order' };
      }

      const currentPrice = type === 'buy' ? parseFloat(symbolData.ask) : parseFloat(symbolData.bid);

      // Validate price based on order type
      const validationResult = this.validatePendingOrderPrice(orderType, type, price, currentPrice);
      if (!validationResult.valid) {
        return { success: false, message: validationResult.message };
      }

      // Calculate margin required (reserved for pending orders)
      const lotSize = symbolData.lot_size || 1;
      const leverage = account.leverage || 5;
      const marginRequired = (price * quantity * lotSize) / leverage;

      // Check free margin
      const freeMargin = parseFloat(account.free_margin || account.balance);
      if (marginRequired > freeMargin) {
        return {
          success: false,
          message: `Insufficient margin for pending order. Required: ₹${marginRequired.toFixed(2)}`,
        };
      }

      // Create pending order
      const orderData = {
        user_id: userId,
        account_id: account.id,
        symbol: symbolData.symbol,
        order_type: orderType,
        trade_type: type,
        quantity,
        price,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        margin_reserved: marginRequired,
        status: 'pending',
        comment,
        expiration,
        expiration_time: expirationTime,
        magic_number: magicNumber,
        created_at: new Date().toISOString(),
      };

      const { data: order, error: orderError } = await supabase
        .from('pending_orders')
        .insert(orderData)
        .select()
        .single();

      if (orderError) throw orderError;

      return {
        success: true,
        order,
        message: `Pending ${orderType.toUpperCase()} order created at ${price}`,
      };
    } catch (error) {
      console.error('Create pending order error:', error);
      return { success: false, message: 'Failed to create pending order' };
    }
  }

  // Validate pending order price
  validatePendingOrderPrice(orderType, type, price, currentPrice) {
    switch (orderType) {
      case 'buy_limit':
        if (price >= currentPrice) {
          return { valid: false, message: 'Buy Limit price must be below current price' };
        }
        break;
      case 'sell_limit':
        if (price <= currentPrice) {
          return { valid: false, message: 'Sell Limit price must be above current price' };
        }
        break;
      case 'buy_stop':
        if (price <= currentPrice) {
          return { valid: false, message: 'Buy Stop price must be above current price' };
        }
        break;
      case 'sell_stop':
        if (price >= currentPrice) {
          return { valid: false, message: 'Sell Stop price must be below current price' };
        }
        break;
    }
    return { valid: true };
  }

  // Close position
  async closePosition(trade) {
    try {
      const preview = await this.previewClosePosition(trade, {
        quantity: Number(trade.quantity || 0),
      });

      if (!preview.success) {
        return { success: false, message: preview.message || 'Failed to get current price' };
      }

      // Update trade
      const closeTime = new Date().toISOString();
      const { data: closedTrade, error: updateError } = await supabase
        .from('trades')
        .update({
          close_price: preview.closePrice,
          profit: preview.netProfit,
          sell_brokerage: preview.sellBrokerage,
          brokerage: preview.totalBrokerage,
          status: 'closed',
          close_time: closeTime,
          updated_at: closeTime,
        })
        .eq('id', trade.id)
        .select()
        .single();

      if (updateError) throw updateError;

      await this.settleAccount(
        trade.account_id,
        preview.netProfit,
        preview.marginFreed,
        closeTime,
      );

      return {
        success: true,
        trade: closedTrade,
        message: `Position closed at ${preview.closePrice}. P&L: ${preview.netProfit.toFixed(2)}`,
      };
    } catch (error) {
      console.error('Close position error:', error);
      return { success: false, message: 'Failed to close position' };
    }
  }

  // Partial close position
  async partialClosePosition(trade, closeVolume) {
    try {
      // Get current price
      const { data: symbolData, error: symbolError } = await supabase
        .from('symbols')
        .select('bid, ask, lot_size')
        .eq('symbol', trade.symbol)
        .single();

      if (symbolError || !symbolData) {
        return { success: false, message: 'Failed to get current price' };
      }

      const closePrice = trade.trade_type === 'buy' 
        ? parseFloat(symbolData.bid) 
        : parseFloat(symbolData.ask);

      const totalVolume = parseFloat(trade.quantity);
      const remainingVolume = totalVolume - closeVolume;

      // Calculate P&L for closed portion
      const direction = trade.trade_type === 'buy' ? 1 : -1;
      const priceDiff = (closePrice - parseFloat(trade.open_price)) * direction;
      const lotSize = trade.lot_size || symbolData.lot_size || 1;
      const closedProfit = priceDiff * closeVolume * lotSize;

      // Proportional brokerage and margin
      const closedBrokerage = (parseFloat(trade.brokerage || 0) / totalVolume) * closeVolume;
      const closedMargin = (parseFloat(trade.margin || 0) / totalVolume) * closeVolume;
      const netClosedProfit = closedProfit - closedBrokerage;

      const closeTime = new Date().toISOString();

      // Create closed trade record
      const { data: closedTrade, error: closedError } = await supabase
        .from('trades')
        .insert({
          user_id: trade.user_id,
          account_id: trade.account_id,
          symbol: trade.symbol,
          trade_type: trade.trade_type,
          quantity: closeVolume,
          lot_size: lotSize,
          open_price: trade.open_price,
          close_price: closePrice,
          stop_loss: 0,
          take_profit: 0,
          margin: closedMargin,
          brokerage: closedBrokerage,
          profit: netClosedProfit,
          status: 'closed',
          comment: `Partial close of #${trade.id}`,
          magic_number: trade.magic_number,
          open_time: trade.open_time,
          close_time: closeTime,
        })
        .select()
        .single();

      if (closedError) throw closedError;

      // Update original trade with remaining volume
      const remainingBrokerage = parseFloat(trade.brokerage || 0) - closedBrokerage;
      const remainingMargin = parseFloat(trade.margin || 0) - closedMargin;

      const { data: remainingTrade, error: updateError } = await supabase
        .from('trades')
        .update({
          quantity: remainingVolume,
          margin: remainingMargin,
          brokerage: remainingBrokerage,
          updated_at: closeTime,
        })
        .eq('id', trade.id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Update account
      const { data: account } = await supabase
        .from('accounts')
        .select('*')
        .eq('id', trade.account_id)
        .single();

      if (account) {
        const currentBalance = parseFloat(account.balance || 0);
        const currentCredit = parseFloat(account.credit || 0);
        const newCredit = currentCredit + netClosedProfit;
        const newMargin = Math.max(0, parseFloat(account.margin || 0) - closedMargin);
        const newEquity = currentBalance + newCredit;
        const newFreeMargin = newEquity - newMargin;

        await supabase
          .from('accounts')
          .update({
            credit: newCredit,
            equity: newEquity,
            margin: newMargin,
            free_margin: newFreeMargin,
            updated_at: closeTime,
          })
          .eq('id', account.id);
      }

      return {
        success: true,
        closedTrade,
        remainingTrade,
        message: `Closed ${closeVolume} lots at ${closePrice}. Remaining: ${remainingVolume} lots`,
      };
    } catch (error) {
      console.error('Partial close error:', error);
      return { success: false, message: 'Failed to partial close position' };
    }
  }

  // Check and trigger pending orders (called by background job)
  async checkPendingOrders() {
    try {
      // Get all pending orders
      const { data: orders, error } = await supabase
        .from('pending_orders')
        .select('*, accounts(*)')
        .eq('status', 'pending');

      if (error || !orders || orders.length === 0) return;

      const symbolsToResolve = [...new Set(
        (orders || [])
          .map((order) => String(order.symbol || '').toUpperCase())
          .filter(Boolean)
      )];
      const { data: symbolRows } = await supabase
        .from('symbols')
        .select('symbol, exchange, bid, ask, last_price, last_update, lot_size, tick_size, display_name')
        .in('symbol', symbolsToResolve);

      const symbolMap = new Map((symbolRows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));

      for (const order of orders) {
        // ── AUTO-EXPIRE when market is closed for this symbol/segment ──
        if (!isMarketOpen(order.symbol, order.exchange)) {
          const now = new Date().toISOString();

          await supabase
            .from('pending_orders')
            .update({
              status: 'expired',
              expired_at: now,
              updated_at: now,
              comment: `${order.comment || ''} [Auto-expired: market closed]`.trim(),
            })
            .eq('id', order.id);

          console.log(`⌛ Auto-expired pending order #${order.id} (${order.symbol}) — market closed`);
          continue;
        }

        const symbolData = symbolMap.get(String(order.symbol || '').toUpperCase());
        if (!symbolData) continue;

        const currentBidState = resolveTradeablePrice({
          symbol: order.symbol,
          side: 'sell',
          symbolRow: symbolData,
        });
        const currentAskState = resolveTradeablePrice({
          symbol: order.symbol,
          side: 'buy',
          symbolRow: symbolData,
        });

        if (currentBidState.isOffQuotes || currentAskState.isOffQuotes) {
          continue;
        }

        const currentBid = currentBidState.price;
        const currentAsk = currentAskState.price;
        const orderPrice = parseFloat(order.price);

        let shouldTrigger = false;

        switch (order.order_type) {
          case 'buy_limit':
            shouldTrigger = currentAsk <= orderPrice;
            break;
          case 'sell_limit':
            shouldTrigger = currentBid >= orderPrice;
            break;
          case 'buy_stop':
            shouldTrigger = currentAsk >= orderPrice;
            break;
          case 'sell_stop':
            shouldTrigger = currentBid <= orderPrice;
            break;
        }

        if (shouldTrigger) {
          // Execute the order
          const result = await this.executeMarketOrder({
            userId: order.user_id,
            account: order.accounts,
            symbolData,
            type: order.trade_type,
            quantity: order.quantity,
            stopLoss: order.stop_loss,
            takeProfit: order.take_profit,
            comment: `Triggered from pending order #${order.id}`,
            magicNumber: order.magic_number,
          });

          if (result.success) {
            // Update pending order status
            await supabase
              .from('pending_orders')
              .update({
                status: 'triggered',
                triggered_at: new Date().toISOString(),
                trade_id: result.trade.id,
              })
              .eq('id', order.id);

            console.log(`✅ Pending order #${order.id} triggered`);
          }
        }

        // Check expiration
        if (order.expiration === 'today') {
          const orderDate = new Date(order.created_at).toDateString();
          const today = new Date().toDateString();

          if (orderDate !== today) {
            await supabase
              .from('pending_orders')
              .update({
                status: 'expired',
                expired_at: new Date().toISOString(),
              })
              .eq('id', order.id);
          }
        } else if (order.expiration === 'specified' && order.expiration_time) {
          if (new Date() > new Date(order.expiration_time)) {
            await supabase
              .from('pending_orders')
              .update({
                status: 'expired',
                expired_at: new Date().toISOString(),
              })
              .eq('id', order.id);
          }
        }
      }
    } catch (error) {
      console.error('Check pending orders error:', error);
    }
  }

  // Check and trigger SL/TP (called by background job)
  async checkStopLossAndTakeProfit() {
    try {
      // Get all open trades with SL or TP
      const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'open')
        .or('stop_loss.gt.0,take_profit.gt.0');

      if (error || !trades || trades.length === 0) return;

      const symbolsToResolve = [...new Set(
        (trades || [])
          .map((trade) => String(trade.symbol || '').toUpperCase())
          .filter(Boolean)
      )];
      const { data: symbolRows } = await supabase
        .from('symbols')
        .select('symbol, exchange, bid, ask, last_price, last_update')
        .in('symbol', symbolsToResolve);

      const symbolMap = new Map((symbolRows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));

      for (const trade of trades) {
        if (!isMarketOpen(trade.symbol, trade.exchange)) continue;

        const symbolData = symbolMap.get(String(trade.symbol || '').toUpperCase());
        if (!symbolData) continue;

        const currentPriceState = resolveTradeablePrice({
          symbol: trade.symbol,
          side: trade.trade_type === 'buy' ? 'sell' : 'buy',
          symbolRow: symbolData,
        });

        if (currentPriceState.isOffQuotes) continue;

        const currentPrice = currentPriceState.price;

        const stopLoss = parseFloat(trade.stop_loss);
        const takeProfit = parseFloat(trade.take_profit);

        let shouldClose = false;
        let closeReason = '';

        // Check Stop Loss
        if (stopLoss > 0) {
          if (trade.trade_type === 'buy' && currentPrice <= stopLoss) {
            shouldClose = true;
            closeReason = 'Stop Loss triggered';
          } else if (trade.trade_type === 'sell' && currentPrice >= stopLoss) {
            shouldClose = true;
            closeReason = 'Stop Loss triggered';
          }
        }

        // Check Take Profit
        if (!shouldClose && takeProfit > 0) {
          if (trade.trade_type === 'buy' && currentPrice >= takeProfit) {
            shouldClose = true;
            closeReason = 'Take Profit triggered';
          } else if (trade.trade_type === 'sell' && currentPrice <= takeProfit) {
            shouldClose = true;
            closeReason = 'Take Profit triggered';
          }
        }

        if (shouldClose) {
          const result = await this.closePosition(trade);
          if (result.success) {
            console.log(`✅ ${closeReason} for trade #${trade.id}`);

            // Notify user via WebSocket (if available)
            // This would be done through the socketHandler
          }
        }
      }
    } catch (error) {
      console.error('Check SL/TP error:', error);
    }
  }
}

module.exports = new TradingService();
