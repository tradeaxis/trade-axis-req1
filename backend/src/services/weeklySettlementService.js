// backend/src/services/weeklySettlementService.js
// ═══════════════════════════════════════════════════════════════
//  Weekly M2M Settlement — Close & Re-open at SAME price
//
//  ▸ No brokerage on settlement (close or reopen)
//  ▸ Balance NEVER changes
//  ▸ Credit resets to 0 (weekly realized P&L settled offline by admin)
//  ▸ Equity resets to Balance
//  ▸ Floating P&L = 0 (reopened at same price)
//  ▸ Everything else preserved (qty, SL, TP, direction, leverage)
// ═══════════════════════════════════════════════════════════════

const { supabase } = require('../config/supabase');

const SETTLEMENT_TIMEZONE = process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata';

const formatDateInTimezone = (date, timeZone = SETTLEMENT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  return `${year}-${month}-${day}`;
};

class WeeklySettlementService {
  async runSettlement() {
    const now = new Date();
    const settlementWeek = formatDateInTimezone(now);
    const closeTime = now.toISOString();

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🧾 WEEKLY M2M SETTLEMENT STARTED');
    console.log(`   Time: ${now.toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');

    const settleDemo = String(process.env.SETTLE_DEMO || 'false') === 'true';

    // ── 1. Fetch all open trades with account info ──
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*, accounts!inner(id, user_id, is_demo, balance, credit, margin, leverage)')
      .eq('status', 'open');

    if (error) {
      console.error('❌ Settlement fetch error:', error.message);
      return { success: false, message: error.message };
    }

    if (!trades || trades.length === 0) {
      console.log('ℹ️  No open trades to settle.');
      return { success: true, settled: 0 };
    }

    // Filter demo unless SETTLE_DEMO=true
    const openTrades = settleDemo
      ? trades
      : trades.filter(
          (t) => !t.accounts?.is_demo && String(t.settlement_week || '') !== settlementWeek,
        );

    if (openTrades.length === 0) {
      console.log('ℹ️  No live-account trades to settle.');
      return { success: true, settled: 0 };
    }

    console.log(`📊 Found ${openTrades.length} open trade(s) to settle`);

    // ── 2. Group by account (so we update each account ONCE) ──
    const byAccount = {};
    for (const trade of openTrades) {
      const accId = trade.account_id;
      if (!byAccount[accId]) {
        byAccount[accId] = { account: trade.accounts, trades: [] };
      }
      byAccount[accId].trades.push(trade);
    }

    let settledCount = 0;
    let totalWeeklyPnL = 0;
    const errors = [];

    // ── 3. Process each account ──
    for (const accId of Object.keys(byAccount)) {
      const { account, trades: accountTrades } = byAccount[accId];
      const balance = Number(account.balance || 0);
      const creditBefore = Number(account.credit || 0);

      // Calculate equity BEFORE settlement (for admin record)
      const floatingBefore = accountTrades.reduce(
        (sum, t) => sum + Number(t.profit || 0),
        0
      );
      const equityBefore = balance + creditBefore + floatingBefore;
      const weeklyPnL = equityBefore - balance; // = credit + floating = total week P&L

      let newMarginTotal = 0; // Sum of reopened trades' margins

      for (const trade of accountTrades) {
        try {
          // ── Get settlement price ──
          const closePrice = await this._getSettlementPrice(trade);
          if (!closePrice || closePrice <= 0) {
            console.warn(`  ⚠️ Skipping ${trade.symbol} — no valid price`);
            continue;
          }

          const qty = Number(trade.quantity || 0);
          const openPrice = Number(trade.open_price || 0);
          const direction = trade.trade_type === 'buy' ? 1 : -1;

          // P&L = pure price difference × qty (NO brokerage)
          const grossPnL = (closePrice - openPrice) * direction * qty;

          // ── A) Close the old trade ──
          const { data: closedTrade, error: closeErr } = await supabase
            .from('trades')
            .update({
              close_price: closePrice,
              profit: grossPnL,        // gross — no brokerage on settlement
              sell_brokerage: 0,       // no exit brokerage
              brokerage: 0,            // no brokerage for settlement
              status: 'closed',
              close_time: closeTime,
              updated_at: closeTime,
              is_settlement_close: true,
              settlement_week: settlementWeek,
              comment: `Weekly settlement close. Gross P&L: ${grossPnL.toFixed(2)}`,
            })
            .eq('id', trade.id)
            .eq('status', 'open')
            .select('id')
            .maybeSingle();

          if (closeErr) {
            console.error(`  ❌ Close trade ${trade.id}:`, closeErr.message);
            errors.push({ tradeId: trade.id, error: closeErr.message });
            continue;
          }

          if (!closedTrade?.id) {
            console.log(`  ℹ️ Skipping ${trade.symbol} #${trade.id} — already settled in another run`);
            continue;
          }

          // ── B) Reopen at SAME close price ──
          const leverage = Number(account.leverage || 5);
          const reopenMargin = (closePrice * qty) / leverage;

          const reopenData = {
            user_id: trade.user_id,
            account_id: trade.account_id,
            symbol: trade.symbol,
            exchange: trade.exchange || 'NSE',
            trade_type: trade.trade_type,       // same direction
            quantity: qty,                       // same quantity
            open_price: closePrice,              // opens at settlement price
            current_price: closePrice,           // same → P&L = 0
            stop_loss: Number(trade.stop_loss || 0),    // preserved
            take_profit: Number(trade.take_profit || 0), // preserved
            margin: reopenMargin,
            brokerage: 0,                        // no brokerage
            buy_brokerage: 0,
            sell_brokerage: 0,
            profit: 0,                           // fresh start
            status: 'open',
            open_time: closeTime,
            updated_at: closeTime,
            settled_from_trade_id: trade.id,
            settlement_week: settlementWeek,
            comment: `M2M reopen from #${trade.id}`,
          };

          const { data: newTrade, error: reopenErr } = await supabase
            .from('trades')
            .insert(reopenData)
            .select()
            .single();

          if (reopenErr) {
            console.error(`  ❌ Reopen ${trade.symbol}:`, reopenErr.message);
            errors.push({ tradeId: trade.id, error: reopenErr.message });
            continue;
          }

          newMarginTotal += reopenMargin;
          settledCount++;

          const emoji = grossPnL >= 0 ? '🟢' : '🔴';
          console.log(
            `  ${emoji} ${trade.symbol} ${trade.trade_type.toUpperCase()} x${qty}` +
            ` | ${openPrice.toFixed(2)} → ${closePrice.toFixed(2)}` +
            ` | P&L: ${grossPnL >= 0 ? '+' : ''}${grossPnL.toFixed(2)}` +
            ` | Reopened #${newTrade.id}`
          );

          // ── C) Settlement record for admin ──
          try {
            await supabase.from('weekly_settlements').insert({
              user_id: trade.user_id,
              account_id: trade.account_id,
              old_trade_id: trade.id,
              new_trade_id: newTrade.id,
              settlement_date: settlementWeek,
              symbol: trade.symbol,
              trade_type: trade.trade_type,
              quantity: qty,
              open_price: openPrice,
              close_price: closePrice,
              profit_loss: grossPnL,
              commission: 0,           // no brokerage on settlement
              balance_before: balance,
              balance_after: balance,   // balance NEVER changes
              credit_before: creditBefore,
              credit_after: 0,          // credit resets to 0
              settlement_type: 'auto_m2m',
            });
          } catch (e) {
            console.warn(`  ⚠️ Settlement record warning: ${e.message}`);
          }
        } catch (e) {
          console.error(`  ❌ Trade ${trade.id} error:`, e.message);
          errors.push({ tradeId: trade.id, error: e.message });
        }
      }

      // ── D) Update account ONCE ──
      //   Balance:     NO CHANGE (only admin changes this)
      //   Credit:      Reset to 0 (weekly P&L settled offline by admin)
      //   Margin:      Recalculated from reopened trades
      //   Equity:      = Balance (since credit=0 and floating=0)
      //   Free Margin: = Balance - Margin
      //   Profit:      0
      try {
        const newEquity = balance;  // credit=0, floating=0
        const newFreeMargin = Math.max(0, balance - newMarginTotal);

        await supabase
          .from('accounts')
          .update({
            // balance: NOT TOUCHED — only admin changes this
            credit: 0,
            equity: newEquity,
            margin: newMarginTotal,
            free_margin: newFreeMargin,
            profit: 0,
            updated_at: closeTime,
          })
          .eq('id', accId);

        const emoji = weeklyPnL >= 0 ? '💰' : '💸';
        console.log(
          `  ${emoji} Account ${accId}:` +
          ` Weekly P&L: ${weeklyPnL >= 0 ? '+' : ''}${weeklyPnL.toFixed(2)}` +
          ` (credit ${creditBefore.toFixed(2)} + floating ${floatingBefore.toFixed(2)})` +
          ` | Credit reset to 0 | Equity reset to ${balance.toFixed(2)}`
        );
      } catch (e) {
        console.error(`  ❌ Account ${accId} update error:`, e.message);
      }

      totalWeeklyPnL += weeklyPnL;
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ WEEKLY SETTLEMENT COMPLETE');
    console.log(`   Trades settled:  ${settledCount}`);
    console.log(`   Total weekly P&L: ${totalWeeklyPnL >= 0 ? '+' : ''}₹${totalWeeklyPnL.toFixed(2)}`);
    console.log(`   Accounts:        ${Object.keys(byAccount).length}`);
    console.log(`   Balance changed:  NO (admin settles offline)`);
    if (errors.length) console.log(`   ⚠️ Errors: ${errors.length}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    return {
      success: true,
      settled: settledCount,
      totalWeeklyPnL,
      accounts: Object.keys(byAccount).length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ── Get best available price ──
  async _getSettlementPrice(trade) {
    // 1. Try live Kite price
    try {
      const kiteStreamService = require('./kiteStreamService');
      const livePrice = kiteStreamService.getPrice(trade.symbol);
      if (livePrice && livePrice.last > 0) {
        return Number(livePrice.last);
      }
    } catch (_) {}

    // 2. DB symbols table
    const { data: symRow } = await supabase
      .from('symbols')
      .select('last_price, previous_close, bid, ask')
      .eq('symbol', trade.symbol)
      .limit(1);

    const s = symRow?.[0];
    if (s) {
      const p = Number(s.last_price || 0) || Number(s.previous_close || 0) || Number(s.bid || 0) || Number(s.ask || 0);
      if (p > 0) return p;
    }

    // 3. Trade's current/open price (last resort)
    return Number(trade.current_price || 0) || Number(trade.open_price || 0);
  }
}

module.exports = new WeeklySettlementService();
