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
const {
  buildOpenTradeSnapshots,
  filterSupersededSettlementTrades,
} = require('./openTradeSnapshot');
const { isMarketOpen } = require('./marketStatus');
const kiteService = require('./kiteService');

const SETTLEMENT_TIMEZONE = process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata';
const SETTLEMENT_REQUIRE_KITE_QUOTE = String(process.env.SETTLEMENT_REQUIRE_KITE_QUOTE || 'true').toLowerCase() !== 'false';
const CONTRACT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SETTLEMENT_SYMBOL_FIELDS = [
  'id',
  'symbol',
  'display_name',
  'underlying',
  'exchange',
  'kite_exchange',
  'kite_tradingsymbol',
  'kite_instrument_token',
  'expiry_date',
  'bid',
  'ask',
  'last_price',
  'previous_close',
  'close_price',
].join(', ');

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

const toNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const roundMoney = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
};

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};

const parseContractMonth = (value = '') => {
  const raw = String(value || '').toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';

  const monthPattern = CONTRACT_MONTHS.join('|');
  const labelMatch = raw.match(new RegExp(`[-_](${monthPattern})$`, 'i'));
  if (labelMatch) return labelMatch[1].toUpperCase();

  const compact = raw.replace(/[-_]/g, '');
  const kiteMatch = compact.match(new RegExp(`\\d{2}(${monthPattern})(\\d{2})?FUT$`, 'i'));
  if (kiteMatch) return kiteMatch[1].toUpperCase();

  const displayMatch = compact.match(new RegExp(`(${monthPattern})(\\d{2})?FUT$`, 'i'));
  return displayMatch ? displayMatch[1].toUpperCase() : '';
};

const normalizeUnderlyingKey = (value = '') =>
  String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_](JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i, '')
    .replace(/[-_][IVX]+$/i, '')
    .replace(/\d{2}[A-Z]{3}\d{2}FUT$/i, '')
    .replace(/\d{2}[A-Z]{3}FUT$/i, '')
    .replace(/FUT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

const getRowContractMonth = (row = {}) => {
  const parsed = parseContractMonth(row.symbol)
    || parseContractMonth(row.kite_tradingsymbol)
    || parseContractMonth(row.display_name);
  if (parsed) return parsed;

  const expiry = row.expiry_date ? new Date(row.expiry_date) : null;
  if (expiry && !Number.isNaN(expiry.getTime())) {
    return CONTRACT_MONTHS[expiry.getMonth()] || '';
  }
  return '';
};

const getSymbolExactKeys = (row = {}) => (
  [row.symbol, row.kite_tradingsymbol, row.display_name]
    .map((value) => String(value || '').toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean)
);

const scoreSettlementSymbolRow = (trade, row) => {
  const requested = String(trade?.symbol || '').toUpperCase().replace(/\s+/g, '');
  const requestedMonth = parseContractMonth(requested);
  const requestedBase = normalizeUnderlyingKey(requested);
  const rowMonth = getRowContractMonth(row);
  const exactMatch = getSymbolExactKeys(row).includes(requested);
  const rowBases = [
    row.underlying,
    row.display_name,
    row.symbol,
    row.kite_tradingsymbol,
  ].map(normalizeUnderlyingKey).filter(Boolean);
  const baseMatch = requestedBase && rowBases.includes(requestedBase);

  if (requestedMonth && rowMonth && rowMonth !== requestedMonth) return -1;
  if (requestedBase && !baseMatch && !exactMatch) return -1;

  let score = 0;
  if (Number(row.kite_instrument_token || 0) > 0) score += 100;
  if (row.kite_tradingsymbol) score += 40;
  if (exactMatch) score += 40;
  if (baseMatch) score += 30;
  if (requestedMonth && rowMonth === requestedMonth) score += 30;
  if (row.expiry_date) score += 5;
  return score;
};

const inferKiteExchange = (row = {}) => {
  const direct = String(row.kite_exchange || row.exchange || '').toUpperCase();
  if (['NFO', 'MCX', 'BFO'].includes(direct)) return direct;

  const text = String(`${row.symbol || ''} ${row.display_name || ''} ${row.underlying || ''}`).toUpperCase();
  if (/CRUDE|NATURALGAS|GOLD|SILVER|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL/.test(text)) return 'MCX';
  return 'NFO';
};

const settlementGroupKey = (trade) => [
  trade?.account_id || '',
  String(trade?.symbol || '').toUpperCase(),
  String(trade?.trade_type || '').toLowerCase(),
].join('|');

const tradeDirection = (trade) => (
  String(trade?.trade_type || '').toLowerCase() === 'buy' ? 1 : -1
);

const normalizeIdList = (value) => {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
};

class WeeklySettlementService {
  constructor() {
    this._settlementSymbolCache = new Map();
    this._settlementKitePriceCache = new Map();
  }

  async runSettlement(options = {}) {
    const now = new Date();
    const settlementWeek = formatDateInTimezone(now);
    const closeTime = now.toISOString();
    const scopedUserIds = new Set(normalizeIdList(options.userIds));
    const scopedAccountIds = new Set(normalizeIdList(options.accountIds));
    this._settlementSymbolCache.clear();
    this._settlementKitePriceCache.clear();

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🧾 WEEKLY M2M SETTLEMENT STARTED');
    console.log(`   Time: ${now.toISOString()}`);
    console.log('═══════════════════════════════════════════════════════');

    const settleDemo = String(process.env.SETTLE_DEMO || 'true') === 'true';

    // ── 1. Fetch all open trades with account info ──
    const { data: trades, error } = await supabase
      .from('trades')
      .select('*, accounts!inner(id, user_id, is_demo, balance, credit, margin, leverage)')
      .eq('status', 'open');

    if (error) {
      console.error('❌ Settlement fetch error:', error.message);
      return { success: false, message: error.message };
    }

    let scopedTrades = trades || [];
    if (scopedUserIds.size > 0 || scopedAccountIds.size > 0) {
      scopedTrades = scopedTrades.filter((trade) => {
        const userId = String(trade.user_id || trade.accounts?.user_id || '');
        const accountId = String(trade.account_id || trade.accounts?.id || '');
        const userAllowed = scopedUserIds.size === 0 || scopedUserIds.has(userId);
        const accountAllowed = scopedAccountIds.size === 0 || scopedAccountIds.has(accountId);
        return userAllowed && accountAllowed;
      });
    }

    if (!scopedTrades || scopedTrades.length === 0) {
      console.log('No open trades to settle for selected scope.');
      return {
        success: true,
        settled: 0,
        scoped: scopedUserIds.size > 0 || scopedAccountIds.size > 0,
        userIds: [...scopedUserIds],
        accountIds: [...scopedAccountIds],
      };
    }

    // Filter demo only if explicitly disabled. Manual settlement can be run whenever admin needs it,
    // including multiple times in the same week/day, so do not skip current settlement_week rows.
    const eligibleTrades = settleDemo ? scopedTrades : scopedTrades.filter((t) => !t.accounts?.is_demo);
    const snapshotTrades = await buildOpenTradeSnapshots(eligibleTrades);
    const openTrades = filterSupersededSettlementTrades(snapshotTrades);

    if (openTrades.length === 0) {
      console.log('ℹ️  No live-account trades to settle.');
      return { success: true, settled: 0 };
    }

    console.log(`📊 Found ${openTrades.length} open trade(s) to settle`);

    // ── 2. Group by account (so we update each account ONCE) ──
    const settlementPrices = new Map();
    const missingPrices = [];
    for (const trade of openTrades) {
      const closePrice = await this._getSettlementPrice(trade);
      if (!closePrice || closePrice <= 0) {
        missingPrices.push({ tradeId: trade.id, symbol: trade.symbol });
      } else {
        settlementPrices.set(String(trade.id), Number(closePrice));
      }
    }

    if (missingPrices.length > 0) {
      const message = `Settlement aborted before changes: ${missingPrices.length} open trade(s) have no valid settlement price.`;
      console.error(message);
      return {
        success: false,
        message,
        settled: 0,
        totalWeeklyPnL: 0,
        accounts: 0,
        errors: missingPrices,
      };
    }

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
      const creditBefore = await this._getRealizedPnlSinceLastSettlement(
        accId,
        closeTime,
        Number(account.credit || 0),
      );

      // Calculate equity BEFORE settlement (for admin record)
      const floatingBefore = accountTrades.reduce(
        (sum, t) => sum + Number(t.profit || 0),
        0
      );
      const weeklyPnL = roundMoney(creditBefore + floatingBefore);
      const equityBefore = balance + weeklyPnL;

      let newMarginTotal = 0; // Sum of reopened trades' margins
      const reopenedMarginById = new Map();
      const applyReopenedMargin = (tradeId, marginValue) => {
        const key = String(tradeId);
        const nextMargin = roundMoney(marginValue);
        const previousMargin = reopenedMarginById.get(key) || 0;
        newMarginTotal += nextMargin - previousMargin;
        reopenedMarginById.set(key, nextMargin);
      };
      const errorsBeforeAccount = errors.length;

      for (const trade of accountTrades) {
        try {
          // ── Get settlement price ──
          const closePrice = settlementPrices.get(String(trade.id)) || await this._getSettlementPrice(trade);
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
              current_price: closePrice,
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

          // B) Reopen at the same settlement price, merged by account + script + side.
          const leverage = Number(account.leverage || 5);
          const reopenMargin = (closePrice * qty) / leverage;
          let newTrade = null;

          const rollbackClosedTrade = async () => {
            await supabase
              .from('trades')
              .update({
                close_price: null,
                close_time: null,
                status: 'open',
                current_price: closePrice,
                profit: grossPnL,
                sell_brokerage: Number(trade.sell_brokerage || 0),
                brokerage: Number(trade.brokerage || 0),
                is_settlement_close: false,
                settlement_week: null,
                updated_at: closeTime,
                comment: trade.comment || null,
              })
              .eq('id', trade.id);
          };

          const { data: existingReopens, error: existingReopenErr } = await supabase
            .from('trades')
            .select('id, margin')
            .eq('settled_from_trade_id', trade.id)
            .eq('status', 'open')
            .limit(1);

          if (existingReopenErr) {
            console.error(`  Reopen lookup ${trade.symbol}:`, existingReopenErr.message);
            errors.push({ tradeId: trade.id, error: existingReopenErr.message });
            continue;
          }

          const existingReopen = existingReopens?.[0] || null;
          if (existingReopen?.id) {
            newTrade = existingReopen;
            console.log(`  ${trade.symbol} #${trade.id} already reopened as #${existingReopen.id}`);
          }

          if (!newTrade) {
            const { data: groupedReopens, error: groupedReopenErr } = await supabase
              .from('trades')
              .select('id, quantity, open_price, current_price, margin')
              .eq('account_id', trade.account_id)
              .eq('symbol', trade.symbol)
              .eq('trade_type', trade.trade_type)
              .eq('status', 'open')
              .eq('settlement_week', settlementWeek)
              .not('settled_from_trade_id', 'is', null)
              .limit(1);

            if (groupedReopenErr) {
              console.error(`  Reopen group lookup ${trade.symbol}:`, groupedReopenErr.message);
              errors.push({ tradeId: trade.id, error: groupedReopenErr.message });
              continue;
            }

            const groupedReopen = groupedReopens?.[0] || null;
            if (groupedReopen?.id) {
              const existingQty = Number(groupedReopen.quantity || 0);
              const mergedQty = existingQty + qty;
              const existingPrice = Number(groupedReopen.open_price || groupedReopen.current_price || closePrice);
              const mergedPrice = mergedQty > 0
                ? ((existingPrice * existingQty) + (closePrice * qty)) / mergedQty
                : closePrice;
              const mergedMargin = (mergedPrice * mergedQty) / leverage;

              const { error: mergeErr } = await supabase
                .from('trades')
                .update({
                  quantity: roundMoney(mergedQty),
                  open_price: roundMoney(mergedPrice),
                  current_price: roundMoney(mergedPrice),
                  margin: roundMoney(mergedMargin),
                  profit: 0,
                  brokerage: 0,
                  buy_brokerage: 0,
                  sell_brokerage: 0,
                  updated_at: closeTime,
                  comment: `M2M reopen merged for ${settlementWeek}`,
                })
                .eq('id', groupedReopen.id)
                .eq('status', 'open');

              if (mergeErr) {
                console.error(`  Merge reopen ${trade.symbol}:`, mergeErr.message);
                errors.push({ tradeId: trade.id, error: mergeErr.message });
                await rollbackClosedTrade();
                continue;
              }

              newTrade = {
                id: groupedReopen.id,
                margin: roundMoney(mergedMargin),
              };
            }
          }

          if (!newTrade) {
            const reopenData = {
              user_id: trade.user_id,
              account_id: trade.account_id,
              symbol: trade.symbol,
              exchange: trade.exchange || 'NSE',
              trade_type: trade.trade_type,
              quantity: qty,
              open_price: closePrice,
              current_price: closePrice,
              stop_loss: Number(trade.stop_loss || 0),
              take_profit: Number(trade.take_profit || 0),
              margin: reopenMargin,
              brokerage: 0,
              buy_brokerage: 0,
              sell_brokerage: 0,
              profit: 0,
              status: 'open',
              open_time: closeTime,
              updated_at: closeTime,
              settled_from_trade_id: trade.id,
              settlement_week: settlementWeek,
              comment: `M2M reopen from #${trade.id}`,
            };

            const { data: insertedTrade, error: reopenErr } = await supabase
              .from('trades')
              .insert(reopenData)
              .select()
              .single();

            if (reopenErr) {
              console.error(`  Reopen ${trade.symbol}:`, reopenErr.message);
              errors.push({ tradeId: trade.id, error: reopenErr.message });
              await rollbackClosedTrade();
              continue;
            }

            newTrade = insertedTrade;
          }

          applyReopenedMargin(newTrade.id, Number(newTrade.margin || reopenMargin || 0));
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
            const settlementRecord = {
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
              credit_before: weeklyPnL,
              credit_after: 0,          // credit resets to 0
              settlement_type: 'auto_m2m',
              created_at: closeTime,
            };

            const { error: settlementInsertError } = await supabase
              .from('weekly_settlements')
              .insert(settlementRecord);

            if (settlementInsertError && /old_trade_id|new_trade_id|created_at|updated_at/i.test(settlementInsertError.message || '')) {
              const {
                old_trade_id,
                new_trade_id,
                created_at,
                ...legacySettlementRecord
              } = settlementRecord;
              const { error: legacyInsertError } = await supabase
                .from('weekly_settlements')
                .insert(legacySettlementRecord);
              if (legacyInsertError) throw legacyInsertError;
            } else if (settlementInsertError) {
              throw settlementInsertError;
            }
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
      if (errors.length > errorsBeforeAccount) {
        console.error(`  ❌ Account ${accId}: settlement had trade errors, skipping account reset`);
        totalWeeklyPnL += weeklyPnL;
        continue;
      }

      try {
        const newEquity = balance;  // credit=0, floating=0
        const newFreeMargin = Math.max(0, balance - newMarginTotal);

        const { error: accountUpdateError } = await supabase
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

        if (accountUpdateError) throw accountUpdateError;

        const emoji = weeklyPnL >= 0 ? '💰' : '💸';
        console.log(
          `  ${emoji} Account ${accId}:` +
          ` Weekly P&L: ${weeklyPnL >= 0 ? '+' : ''}${weeklyPnL.toFixed(2)}` +
          ` (credit ${creditBefore.toFixed(2)} + floating ${floatingBefore.toFixed(2)})` +
          ` | Credit reset to 0 | Equity reset to ${balance.toFixed(2)}`
        );
      } catch (e) {
        console.error(`  ❌ Account ${accId} update error:`, e.message);
        errors.push({ accountId: accId, error: e.message });
      }

      totalWeeklyPnL += weeklyPnL;
    }

    const normalized = await this._normalizeSettlementOpenRows(
      settlementWeek,
      new Set(Object.keys(byAccount)),
      closeTime,
      errors,
    );
    const staleRepair = await this._closeSupersededSettlementParents(
      settlementWeek,
      new Set([...(normalized.accountIds || []), ...Object.keys(byAccount)]),
      closeTime,
      errors,
    );
    const normalizedAccounts = new Set([
      ...Object.keys(byAccount),
      ...(normalized.accountIds || []),
      ...(staleRepair.accountIds || []),
    ]);
    if (normalizedAccounts.size > 0) {
      await this._recalculateAccounts([...normalizedAccounts], closeTime, errors);
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
      success: errors.length === 0,
      settled: settledCount,
      totalWeeklyPnL,
      accounts: Object.keys(byAccount).length,
      scoped: scopedUserIds.size > 0 || scopedAccountIds.size > 0,
      userIds: [...scopedUserIds],
      accountIds: [...scopedAccountIds],
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ── Get best available price ──
  async repairSettlementState({ settlementDate, userIds, userId, accountIds: inputAccountIds, accountId, reprice = false } = {}) {
    const targetDate = settlementDate || await this._getLatestSettlementDate();
    if (!targetDate) {
      return { success: false, message: 'No weekly settlement rows found to repair.' };
    }
    this._settlementSymbolCache.clear();
    this._settlementKitePriceCache.clear();
    const shouldReprice = reprice === true || String(reprice).toLowerCase() === 'true';

    const scopedUserIds = normalizeIdList(userIds || userId);
    const scopedAccountIds = normalizeIdList(inputAccountIds || accountId);

    let settlementQuery = supabase
      .from('weekly_settlements')
      .select('*')
      .eq('settlement_date', targetDate);

    if (scopedUserIds.length > 0) {
      settlementQuery = settlementQuery.in('user_id', scopedUserIds);
    }
    if (scopedAccountIds.length > 0) {
      settlementQuery = settlementQuery.in('account_id', scopedAccountIds);
    }

    const { data: rows, error } = await settlementQuery;

    if (error) {
      return { success: false, message: error.message };
    }

    const now = new Date().toISOString();
    const accountIds = new Set();
    const errors = [];
    let fixedOld = 0;
    let fixedNew = 0;
    let repricedRows = 0;
    let repricedCreditRows = 0;
    const repriceGroups = new Map();

    for (const row of rows || []) {
      let closePrice = Number(row.close_price || 0);
      let profitLoss = Number(row.profit_loss || 0);

      if (shouldReprice) {
        const resolvedPrice = await this._getSettlementPrice({
          symbol: row.symbol,
          exchange: row.exchange,
          open_price: row.open_price,
          close_price: row.close_price,
          current_price: row.close_price,
        });

        if (resolvedPrice > 0) {
          const oldProfitLoss = Number(row.profit_loss || 0);
          closePrice = resolvedPrice;
          const qty = toNumber(row.quantity);
          const openPrice = toNumber(row.open_price);
          profitLoss = qty > 0 && openPrice > 0
            ? roundMoney((closePrice - openPrice) * tradeDirection(row) * qty)
            : roundMoney(oldProfitLoss);

          row.close_price = closePrice;
          row.profit_loss = profitLoss;

          const groupKey = `${row.account_id || 'unknown'}::${row.settlement_date || targetDate}::${row.created_at || row.updated_at || 'legacy'}`;
          if (!repriceGroups.has(groupKey)) {
            repriceGroups.set(groupKey, {
              ids: [],
              oldCreditBefore: Number(row.credit_before || 0),
              oldProfitTotal: 0,
              newProfitTotal: 0,
            });
          }
          const group = repriceGroups.get(groupKey);
          if (row.id) group.ids.push(row.id);
          group.oldProfitTotal += oldProfitLoss;
          group.newProfitTotal += profitLoss;

          if (row.id) {
            const { error: repriceErr } = await supabase
              .from('weekly_settlements')
              .update({
                close_price: closePrice,
                profit_loss: profitLoss,
              })
              .eq('id', row.id);

            if (repriceErr) {
              errors.push({ settlementId: row.id, error: repriceErr.message });
            } else {
              repricedRows++;
            }
          }
        }
      }

      if (!closePrice || closePrice <= 0) {
        errors.push({ settlementId: row.id, error: 'Missing close price' });
        continue;
      }

      if (row.account_id) accountIds.add(row.account_id);

      if (row.old_trade_id) {
        const { error: oldErr } = await supabase
          .from('trades')
          .update({
            close_price: closePrice,
            current_price: closePrice,
            profit: profitLoss,
            sell_brokerage: 0,
            brokerage: 0,
            status: 'closed',
            close_time: row.created_at || now,
            updated_at: now,
            is_settlement_close: true,
            settlement_week: targetDate,
          })
          .eq('id', row.old_trade_id);

        if (oldErr) {
          errors.push({ tradeId: row.old_trade_id, error: oldErr.message });
        } else {
          fixedOld++;
        }
      }

      if (row.new_trade_id) {
        const { error: newErr } = await supabase
          .from('trades')
          .update({
            open_price: closePrice,
            current_price: closePrice,
            profit: 0,
            brokerage: 0,
            buy_brokerage: 0,
            sell_brokerage: 0,
            status: 'open',
            updated_at: now,
            settlement_week: targetDate,
          })
          .eq('id', row.new_trade_id);

        if (newErr) {
          errors.push({ tradeId: row.new_trade_id, error: newErr.message });
        } else {
          fixedNew++;
        }
      }
    }

    if (shouldReprice) {
      for (const group of repriceGroups.values()) {
        const ids = [...new Set(group.ids.filter(Boolean))];
        if (ids.length === 0) continue;

        const nextCreditBefore = roundMoney(
          group.oldCreditBefore - group.oldProfitTotal + group.newProfitTotal,
        );

        const { error: creditErr } = await supabase
          .from('weekly_settlements')
          .update({ credit_before: nextCreditBefore })
          .in('id', ids);

        if (creditErr) {
          errors.push({ repair: 'reprice-settlement-credit-before', error: creditErr.message });
        } else {
          repricedCreditRows += ids.length;
        }
      }
    }

    const forced = await this._forceSettlementOpenRowsFromWeeklyRows(targetDate, rows || [], accountIds, now, errors);
    for (const accountId of forced.accountIds || []) accountIds.add(accountId);
    const normalized = await this._normalizeSettlementOpenRows(targetDate, accountIds, now, errors);
    for (const accountId of normalized.accountIds || []) accountIds.add(accountId);
    const staleRepair = await this._closeSupersededSettlementParents(targetDate, accountIds, now, errors);
    const accountsRecalculated = await this._recalculateAccounts([...accountIds], now, errors);
    const repairedAnything = fixedOld > 0 || fixedNew > 0 || repricedRows > 0 || repricedCreditRows > 0 || forced.openRowsReset > 0 || forced.openRowsCreated > 0 || forced.duplicateRowsClosed > 0 || normalized.staleRowsClosed > 0 || normalized.groupsNormalized > 0 || staleRepair.staleParentsClosed > 0 || staleRepair.reopenedNormalized > 0 || accountsRecalculated > 0;

    return {
      success: repairedAnything && errors.length === 0,
      message: !repairedAnything
        ? `No weekly settlement rows or open settlement duplicates found for ${targetDate}.`
        : errors.length === 0
        ? `Settlement state repaired for ${targetDate}.`
        : `Settlement repair finished for ${targetDate} with ${errors.length} warning(s).`,
      settlementDate: targetDate,
      rows: rows?.length || 0,
      fixedOld,
      fixedNew,
      repricedRows,
      repricedCreditRows,
      openRowsReset: forced.openRowsReset,
      openRowsCreated: forced.openRowsCreated,
      duplicateRowsClosedFromHistory: forced.duplicateRowsClosed,
      settlementGroupsNormalized: normalized.groupsNormalized,
      duplicateSettlementRowsClosed: normalized.staleRowsClosed,
      staleParentsClosed: staleRepair.staleParentsClosed,
      reopenedNormalized: staleRepair.reopenedNormalized,
      accountsRecalculated,
      errors: errors.length ? errors : undefined,
    };
  }

  async _getLatestSettlementDate() {
    const { data, error } = await supabase
      .from('weekly_settlements')
      .select('settlement_date')
      .order('settlement_date', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return data?.[0]?.settlement_date || null;
  }

  async _forceSettlementOpenRowsFromWeeklyRows(targetDate, settlementRows, accountIds, now, errors) {
    const rows = (settlementRows || []).filter((row) => (
      row.account_id
      && row.user_id
      && row.symbol
      && row.trade_type
      && toNumber(row.quantity) > 0
      && toNumber(row.close_price) > 0
    ));

    if (rows.length === 0) {
      return { openRowsReset: 0, openRowsCreated: 0, duplicateRowsClosed: 0, accountIds: [] };
    }

    const touchedAccounts = new Set();
    const accountIdList = [...new Set(rows.map((row) => row.account_id).filter(Boolean))];
    const accountMap = new Map();
    if (accountIdList.length > 0) {
      const { data: accounts, error: accountErr } = await supabase
        .from('accounts')
        .select('id,leverage')
        .in('id', accountIdList);

      if (accountErr) {
        errors.push({ repair: 'force-settlement-account-fetch', error: accountErr.message });
      } else {
        for (const account of accounts || []) {
          accountMap.set(String(account.id), account);
        }
      }
    }

    const groups = new Map();
    for (const row of rows) {
      const key = settlementGroupKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }

    let openRowsReset = 0;
    let openRowsCreated = 0;
    let duplicateRowsClosed = 0;

    for (const groupRows of groups.values()) {
      const first = groupRows[0];
      const totalQuantity = roundMoney(groupRows.reduce((sum, row) => sum + toNumber(row.quantity), 0));
      if (totalQuantity <= 0) continue;

      const weightedCloseValue = groupRows.reduce((sum, row) => {
        return sum + (toNumber(row.close_price) * toNumber(row.quantity));
      }, 0);
      const settlementPrice = roundMoney(weightedCloseValue / totalQuantity);
      if (settlementPrice <= 0) continue;

      const account = accountMap.get(String(first.account_id));
      const leverage = toNumber(account?.leverage, 5) || 5;
      const margin = roundMoney((settlementPrice * totalQuantity) / leverage);
      const oldIds = new Set(groupRows.map((row) => row.old_trade_id).filter(Boolean).map(String));
      const newIds = new Set(groupRows.map((row) => row.new_trade_id).filter(Boolean).map(String));

      const { data: openRows, error: openErr } = await supabase
        .from('trades')
        .select('id,account_id,user_id,symbol,exchange,trade_type,quantity,open_price,current_price,profit,margin,settled_from_trade_id,settlement_week,is_settlement_close,created_at,open_time,comment')
        .eq('account_id', first.account_id)
        .eq('symbol', first.symbol)
        .eq('trade_type', first.trade_type)
        .eq('status', 'open');

      if (openErr) {
        errors.push({ repair: 'force-settlement-open-fetch', accountId: first.account_id, symbol: first.symbol, error: openErr.message });
        continue;
      }

      const relatedOpenRows = (openRows || []).filter((trade) => {
        const comment = String(trade.comment || '').toLowerCase();
        return newIds.has(String(trade.id))
          || oldIds.has(String(trade.settled_from_trade_id || ''))
          || String(trade.settlement_week || '') === String(targetDate)
          || comment.includes('m2m reopen')
          || comment.includes('settlement reopen')
          || comment.includes('reopen normalized');
      });

      const keep = [...relatedOpenRows].sort((a, b) => {
        const aNew = newIds.has(String(a.id)) ? 0 : 1;
        const bNew = newIds.has(String(b.id)) ? 0 : 1;
        if (aNew !== bNew) return aNew - bNew;
        return String(a.open_time || a.created_at || '').localeCompare(String(b.open_time || b.created_at || ''));
      })[0];

      const openPayload = {
        quantity: totalQuantity,
        open_price: settlementPrice,
        current_price: settlementPrice,
        profit: 0,
        margin,
        brokerage: 0,
        buy_brokerage: 0,
        sell_brokerage: 0,
        status: 'open',
        updated_at: now,
        settlement_week: targetDate,
        is_settlement_close: false,
        comment: `M2M reopen repaired for ${targetDate}`,
      };

      let keepId = keep?.id || null;
      if (keepId) {
        const { error: keepErr } = await supabase
          .from('trades')
          .update(openPayload)
          .eq('id', keepId)
          .eq('status', 'open');

        if (keepErr) {
          errors.push({ tradeId: keepId, error: keepErr.message });
          continue;
        }
        openRowsReset++;
      } else {
        const insertPayload = {
          user_id: first.user_id,
          account_id: first.account_id,
          symbol: first.symbol,
          exchange: first.exchange || 'NSE',
          trade_type: first.trade_type,
          stop_loss: 0,
          take_profit: 0,
          open_time: now,
          settled_from_trade_id: groupRows.find((row) => row.old_trade_id)?.old_trade_id || null,
          ...openPayload,
        };

        const { data: inserted, error: insertErr } = await supabase
          .from('trades')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertErr) {
          errors.push({ repair: 'force-settlement-insert-open', accountId: first.account_id, symbol: first.symbol, error: insertErr.message });
          continue;
        }
        keepId = inserted.id;
        openRowsCreated++;
      }

      const duplicates = relatedOpenRows.filter((trade) => String(trade.id) !== String(keepId));
      for (const duplicate of duplicates) {
        const { error: closeErr } = await supabase
          .from('trades')
          .update({
            close_price: settlementPrice,
            current_price: settlementPrice,
            profit: 0,
            brokerage: 0,
            buy_brokerage: 0,
            sell_brokerage: 0,
            status: 'closed',
            close_time: now,
            updated_at: now,
            is_settlement_close: true,
            settlement_week: targetDate,
            comment: `Duplicate settlement reopen closed during repair for ${targetDate}`,
          })
          .eq('id', duplicate.id)
          .eq('status', 'open');

        if (closeErr) {
          errors.push({ tradeId: duplicate.id, error: closeErr.message });
        } else {
          duplicateRowsClosed++;
        }
      }

      if (first.account_id) {
        touchedAccounts.add(first.account_id);
        accountIds.add(first.account_id);
      }
    }

    return {
      openRowsReset,
      openRowsCreated,
      duplicateRowsClosed,
      accountIds: [...touchedAccounts],
    };
  }

  async _normalizeSettlementOpenRows(targetDate, accountIds, now, errors) {
    const scopedAccountIds = [...(accountIds || [])].filter(Boolean);
    let query = supabase
      .from('trades')
      .select('id,account_id,user_id,symbol,exchange,trade_type,quantity,open_price,current_price,profit,margin,stop_loss,take_profit,brokerage,buy_brokerage,sell_brokerage,settled_from_trade_id,settlement_week,is_settlement_close,created_at,open_time,comment')
      .eq('status', 'open');

    if (scopedAccountIds.length > 0) {
      query = query.in('account_id', scopedAccountIds);
    }

    const { data: openTrades, error } = await query;
    if (error) {
      errors.push({ repair: 'normalize-settlement-open-rows', error: error.message });
      return { groupsNormalized: 0, staleRowsClosed: 0, accountIds: [] };
    }

    const rows = openTrades || [];
    const target = String(targetDate || '');
    const settlementChildren = rows.filter((trade) => {
      const settlementWeek = String(trade.settlement_week || '');
      const comment = String(trade.comment || '').toLowerCase();
      const isSettlementReopen = Boolean(trade.settled_from_trade_id)
        || (target && settlementWeek === target)
        || comment.includes('m2m reopen')
        || comment.includes('settlement reopen')
        || comment.includes('reopen normalized');

      return isSettlementReopen
        && (!target || !settlementWeek || settlementWeek === target)
        && trade.is_settlement_close !== true;
    });

    if (settlementChildren.length === 0) {
      return { groupsNormalized: 0, staleRowsClosed: 0, accountIds: [] };
    }

    const allAccountIds = [...new Set(rows.map((trade) => trade.account_id).filter(Boolean))];
    const accountMap = new Map();
    if (allAccountIds.length > 0) {
      const { data: accounts, error: accountErr } = await supabase
        .from('accounts')
        .select('id,balance,leverage')
        .in('id', allAccountIds);

      if (accountErr) {
        errors.push({ repair: 'normalize-settlement-accounts', error: accountErr.message });
      } else {
        for (const account of accounts || []) {
          accountMap.set(String(account.id), account);
        }
      }
    }

    const groups = new Map();
    for (const child of settlementChildren) {
      const key = settlementGroupKey(child);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }

    const touchedAccounts = new Set();
    let groupsNormalized = 0;
    let staleRowsClosed = 0;

    for (const [key, children] of groups) {
      const groupRows = rows.filter((trade) => settlementGroupKey(trade) === key);
      const childIds = new Set(children.map((trade) => String(trade.id)));
      const representedParentIds = new Set(
        children
          .map((trade) => trade.settled_from_trade_id)
          .filter(Boolean)
          .map(String),
      );

      const keep = [...children].sort((a, b) => (
        String(a.open_time || a.created_at || '').localeCompare(String(b.open_time || b.created_at || ''))
      ))[0];
      if (!keep) continue;

      const settlementPrice = [
        keep.open_price,
        ...children.map((trade) => trade.open_price),
        keep.current_price,
        ...children.map((trade) => trade.current_price),
      ].map((value) => toNumber(value)).find((value) => value > 0) || 0;

      if (settlementPrice <= 0) {
        errors.push({ tradeId: keep.id, error: 'Missing settlement price while normalizing rollover rows' });
        continue;
      }

      const orphanParents = groupRows.filter((trade) => (
        !childIds.has(String(trade.id))
        && !representedParentIds.has(String(trade.id))
        && trade.is_settlement_close !== true
      ));
      const duplicateChildren = children.filter((trade) => String(trade.id) !== String(keep.id));
      const parentsToClose = groupRows.filter((trade) => (
        !childIds.has(String(trade.id))
        && trade.is_settlement_close !== true
      ));

      const totalQuantity = roundMoney(
        children.reduce((sum, trade) => sum + toNumber(trade.quantity), 0)
        + orphanParents.reduce((sum, trade) => sum + toNumber(trade.quantity), 0),
      );

      if (totalQuantity <= 0) continue;

      for (const trade of [...parentsToClose, ...duplicateChildren]) {
        if (String(trade.id) === String(keep.id)) continue;
        const qty = toNumber(trade.quantity);
        const openPrice = toNumber(trade.open_price);
        const pnl = childIds.has(String(trade.id))
          ? 0
          : roundMoney((settlementPrice - openPrice) * tradeDirection(trade) * qty);

        const { error: closeErr } = await supabase
          .from('trades')
          .update({
            close_price: settlementPrice,
            current_price: settlementPrice,
            profit: pnl,
            sell_brokerage: 0,
            brokerage: 0,
            status: 'closed',
            close_time: keep.open_time || keep.created_at || now,
            updated_at: now,
            is_settlement_close: true,
            settlement_week: targetDate,
            comment: `Weekly settlement normalized. Gross P&L: ${pnl.toFixed(2)}`,
          })
          .eq('id', trade.id)
          .eq('status', 'open');

        if (closeErr) {
          errors.push({ tradeId: trade.id, error: closeErr.message });
        } else {
          staleRowsClosed++;
        }
      }

      const account = accountMap.get(String(keep.account_id));
      const leverage = toNumber(account?.leverage, 5) || 5;
      const margin = roundMoney((settlementPrice * totalQuantity) / leverage);
      const { error: keepErr } = await supabase
        .from('trades')
        .update({
          quantity: totalQuantity,
          open_price: settlementPrice,
          current_price: settlementPrice,
          profit: 0,
          margin,
          brokerage: 0,
          buy_brokerage: 0,
          sell_brokerage: 0,
          status: 'open',
          updated_at: now,
          settlement_week: targetDate,
          is_settlement_close: false,
          comment: `M2M reopen normalized for ${targetDate}`,
        })
        .eq('id', keep.id)
        .eq('status', 'open');

      if (keepErr) {
        errors.push({ tradeId: keep.id, error: keepErr.message });
      } else {
        groupsNormalized++;
        if (keep.account_id) touchedAccounts.add(keep.account_id);
      }
    }

    return {
      groupsNormalized,
      staleRowsClosed,
      accountIds: [...touchedAccounts],
    };
  }

  async _closeSupersededSettlementParents(targetDate, accountIds, now, errors) {
    const scopedAccountIds = [...(accountIds || [])].filter(Boolean);
    let openTradeQuery = supabase
      .from('trades')
      .select('id,account_id,user_id,symbol,trade_type,quantity,open_price,current_price,profit,margin,settled_from_trade_id,settlement_week,is_settlement_close,created_at,open_time')
      .eq('status', 'open');

    if (scopedAccountIds.length > 0) {
      openTradeQuery = openTradeQuery.in('account_id', scopedAccountIds);
    }

    const { data: openTrades, error } = await openTradeQuery;

    if (error) {
      errors.push({ repair: 'superseded-settlement-parent', error: error.message });
      return { staleParentsClosed: 0, reopenedNormalized: 0 };
    }

    const rows = openTrades || [];
    const byId = new Map(rows.map((trade) => [String(trade.id), trade]));
    const childRows = rows.filter((trade) => trade.settled_from_trade_id);
    const touchedAccounts = new Set();
    let staleParentsClosed = 0;
    let reopenedNormalized = 0;

    for (const child of childRows) {
      const parent = byId.get(String(child.settled_from_trade_id));
      const childSettlementWeek = String(child.settlement_week || targetDate);
      const closePrice = Number(child.open_price || child.current_price || parent?.current_price || parent?.open_price || 0);

      if (child.account_id) {
        accountIds.add(child.account_id);
        touchedAccounts.add(child.account_id);
      }

      if (closePrice > 0) {
        const { error: childErr } = await supabase
          .from('trades')
          .update({
            open_price: closePrice,
            current_price: closePrice,
            profit: 0,
            brokerage: 0,
            buy_brokerage: 0,
            sell_brokerage: 0,
            settlement_week: childSettlementWeek,
            updated_at: now,
          })
          .eq('id', child.id)
          .eq('status', 'open');

        if (childErr) {
          errors.push({ tradeId: child.id, error: childErr.message });
        } else {
          reopenedNormalized++;
        }
      }

      if (!parent || parent.is_settlement_close === true) {
        continue;
      }

      if (parent.account_id) {
        accountIds.add(parent.account_id);
        touchedAccounts.add(parent.account_id);
      }
      const qty = Number(parent.quantity || 0);
      const openPrice = Number(parent.open_price || 0);
      const direction = String(parent.trade_type || '').toLowerCase() === 'buy' ? 1 : -1;
      const grossPnL = closePrice > 0 && openPrice > 0 && qty > 0
        ? (closePrice - openPrice) * direction * qty
        : Number(parent.profit || 0);

      const { error: parentErr } = await supabase
        .from('trades')
        .update({
          close_price: closePrice || Number(parent.current_price || parent.open_price || 0),
          current_price: closePrice || Number(parent.current_price || parent.open_price || 0),
          profit: grossPnL,
          sell_brokerage: 0,
          brokerage: 0,
          status: 'closed',
          close_time: child.created_at || child.open_time || now,
          updated_at: now,
          is_settlement_close: true,
          settlement_week: childSettlementWeek,
        })
        .eq('id', parent.id)
        .eq('status', 'open');

      if (parentErr) {
        errors.push({ tradeId: parent.id, error: parentErr.message });
      } else {
        staleParentsClosed++;
      }
    }

    let flaggedQuery = supabase
      .from('trades')
      .select('id,account_id,current_price,open_price,profit')
      .eq('status', 'open')
      .eq('is_settlement_close', true);

    if (scopedAccountIds.length > 0) {
      flaggedQuery = flaggedQuery.in('account_id', scopedAccountIds);
    }

    const { data: flaggedRows, error: flaggedErr } = await flaggedQuery;

    if (flaggedErr) {
      errors.push({ repair: 'open-settlement-close-flagged', error: flaggedErr.message });
    } else {
      for (const trade of flaggedRows || []) {
        if (trade.account_id) {
          accountIds.add(trade.account_id);
          touchedAccounts.add(trade.account_id);
        }
        const closePrice = Number(trade.current_price || trade.open_price || 0);
        const { error: closeErr } = await supabase
          .from('trades')
          .update({
            close_price: closePrice,
            status: 'closed',
            close_time: now,
            updated_at: now,
          })
          .eq('id', trade.id)
          .eq('status', 'open');

        if (closeErr) {
          errors.push({ tradeId: trade.id, error: closeErr.message });
        } else {
          staleParentsClosed++;
        }
      }
    }

    return { staleParentsClosed, reopenedNormalized, accountIds: [...touchedAccounts] };
  }

  async _recalculateAccounts(accountIds, now, errors) {
    let updated = 0;

    for (const accountId of accountIds) {
      const { data: account, error: accountErr } = await supabase
        .from('accounts')
        .select('id,balance')
        .eq('id', accountId)
        .maybeSingle();

      if (accountErr || !account) {
        errors.push({ accountId, error: accountErr?.message || 'Account not found' });
        continue;
      }

      const { data: openTrades, error: tradeErr } = await supabase
        .from('trades')
        .select('id,profit,margin,settled_from_trade_id,is_settlement_close')
        .eq('account_id', accountId)
        .eq('status', 'open');

      if (tradeErr) {
        errors.push({ accountId, error: tradeErr.message });
        continue;
      }

      const supersededIds = new Set(
        (openTrades || [])
          .map((trade) => trade.settled_from_trade_id)
          .filter(Boolean)
          .map(String),
      );
      const visibleOpenTrades = (openTrades || []).filter((trade) => (
        trade.is_settlement_close !== true && !supersededIds.has(String(trade.id))
      ));
      const balance = Number(account.balance || 0);
      const floating = visibleOpenTrades.reduce((sum, trade) => sum + Number(trade.profit || 0), 0);
      const margin = visibleOpenTrades.reduce((sum, trade) => sum + Number(trade.margin || 0), 0);
      const equity = balance + floating;

      const { error: updateErr } = await supabase
        .from('accounts')
        .update({
          credit: 0,
          profit: 0,
          equity,
          margin,
          free_margin: Math.max(0, equity - margin),
          updated_at: now,
        })
        .eq('id', accountId);

      if (updateErr) {
        errors.push({ accountId, error: updateErr.message });
      } else {
        updated++;
      }
    }

    return updated;
  }

  async _getLastSettlementTime(accountId, beforeIso) {
    const before = new Date(beforeIso || Date.now()).toISOString();

    const { data, error } = await supabase
      .from('weekly_settlements')
      .select('settlement_date, created_at')
      .eq('account_id', accountId)
      .lt('created_at', before)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn(`Settlement lookup warning for account ${accountId}: ${error.message}`);
      return null;
    }

    const row = data?.[0];
    if (!row) return null;

    const rawTime = row.created_at || row.settlement_date;
    const parsed = rawTime ? new Date(rawTime) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
  }

  async _getRealizedPnlSinceLastSettlement(accountId, beforeIso, fallbackCredit = 0) {
    try {
      const before = new Date(beforeIso || Date.now()).toISOString();
      const lastSettlementTime = await this._getLastSettlementTime(accountId, before);

      const { data, error } = await supabase
        .from('trades')
        .select('profit, close_time, updated_at, is_settlement_close')
        .eq('account_id', accountId)
        .eq('status', 'closed')
        .limit(10000);

      if (error) throw error;

      const beforeMs = new Date(before).getTime();
      const afterMs = lastSettlementTime ? new Date(lastSettlementTime).getTime() : 0;

      return roundMoney((data || []).reduce((sum, trade) => {
        if (trade.is_settlement_close === true) return sum;

        const rawTime = trade.close_time || trade.updated_at;
        if (!rawTime) return sum;
        const closedMs = new Date(rawTime).getTime();
        if (!Number.isFinite(closedMs)) return sum;
        if (closedMs <= afterMs || closedMs > beforeMs) return sum;

        return sum + Number(trade.profit || 0);
      }, 0));
    } catch (error) {
      console.warn(
        `Realized P&L lookup warning for account ${accountId}: ${error.message}. Falling back to account credit.`,
      );
      return roundMoney(fallbackCredit);
    }
  }

  async _getSettlementSymbolRow(trade) {
    const requested = String(trade?.symbol || '').trim().toUpperCase();
    if (!requested) return null;

    const cacheKey = `${requested}|${String(trade?.exchange || '').toUpperCase()}`;
    if (this._settlementSymbolCache.has(cacheKey)) {
      return this._settlementSymbolCache.get(cacheKey);
    }

    const rowsByKey = new Map();
    const addRows = (rows = []) => {
      for (const row of rows || []) {
        const key = row.id || row.kite_instrument_token || `${row.symbol}:${row.kite_tradingsymbol}`;
        if (key) rowsByKey.set(String(key), row);
      }
    };

    const exactCandidates = [...new Set([
      requested,
      requested.replace(/\s+/g, ''),
    ].filter(Boolean))];

    for (const candidate of exactCandidates) {
      const { data, error } = await supabase
        .from('symbols')
        .select(SETTLEMENT_SYMBOL_FIELDS)
        .or(`symbol.eq.${candidate},kite_tradingsymbol.eq.${candidate},display_name.eq.${candidate}`)
        .order('expiry_date', { ascending: true })
        .limit(25);

      if (error) throw error;
      addRows(data);
    }

    const baseKey = normalizeUnderlyingKey(requested);
    if (baseKey) {
      const { data, error } = await supabase
        .from('symbols')
        .select(SETTLEMENT_SYMBOL_FIELDS)
        .or(`symbol.ilike.%${baseKey}%,kite_tradingsymbol.ilike.%${baseKey}%,display_name.ilike.%${baseKey}%,underlying.ilike.%${baseKey}%`)
        .order('expiry_date', { ascending: true })
        .limit(500);

      if (error) throw error;
      addRows(data);
    }

    const candidates = [...rowsByKey.values()]
      .map((row) => ({ row, score: scoreSettlementSymbolRow(trade, row) }))
      .filter((item) => item.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.row.expiry_date || '9999-12-31').localeCompare(String(b.row.expiry_date || '9999-12-31'));
      });

    const best = candidates[0]?.row || null;
    this._settlementSymbolCache.set(cacheKey, best);
    return best;
  }

  async _getKiteSettlementPrice(symbolRow) {
    if (!symbolRow?.kite_tradingsymbol) return 0;

    const exchange = inferKiteExchange(symbolRow);
    const tradingsymbol = String(symbolRow.kite_tradingsymbol || '').toUpperCase();
    const quoteKey = `${exchange}:${tradingsymbol}`;
    const cacheKey = String(symbolRow.kite_instrument_token || quoteKey);
    if (this._settlementKitePriceCache.has(cacheKey)) {
      return this._settlementKitePriceCache.get(cacheKey);
    }

    try {
      await kiteService.init();
      if (!kiteService.isSessionReady()) return 0;

      const kite = kiteService.getKiteInstance();
      if (!kite || typeof kite.getQuote !== 'function') return 0;

      const quotes = await kite.getQuote([quoteKey]);
      const quote = quotes?.[quoteKey] || quotes?.[tradingsymbol];
      const price = firstPositiveNumber(
        quote?.last_price,
        quote?.lastPrice,
        quote?.last_traded_price,
        quote?.ltp,
        quote?.depth?.buy?.[0]?.price,
        quote?.depth?.sell?.[0]?.price,
        quote?.ohlc?.close,
      );

      if (price > 0) {
        const rounded = roundMoney(price);
        this._settlementKitePriceCache.set(cacheKey, rounded);
        return rounded;
      }
    } catch (error) {
      console.warn(`Settlement Kite quote warning for ${quoteKey}: ${error.message}`);
    }

    return 0;
  }

  _getDbSettlementPrice(symbolRow) {
    return firstPositiveNumber(
      symbolRow?.last_price,
      symbolRow?.current_price,
      symbolRow?.close_price,
      symbolRow?.previous_close,
      symbolRow?.bid,
      symbolRow?.ask,
    );
  }

  async _getSettlementPrice(trade) {
    // Settlement must use the exact contract's current/last market price.
    // Kite direct quote is preferred because DB aliases can hold stale prices after token expiry.
    const symbolRow = await this._getSettlementSymbolRow(trade);
    const kitePrice = await this._getKiteSettlementPrice(symbolRow);
    if (kitePrice > 0) return kitePrice;

    if (SETTLEMENT_REQUIRE_KITE_QUOTE && symbolRow?.kite_tradingsymbol) {
      console.warn(
        `Settlement price missing exact Kite quote for ${trade.symbol} (${inferKiteExchange(symbolRow)}:${symbolRow.kite_tradingsymbol}).`,
      );
      return 0;
    }

    const marketOpen = isMarketOpen(trade.symbol, trade.exchange);
    if (marketOpen) {
      try {
        const kiteStreamService = require('./kiteStreamService');
        const livePrice = symbolRow
          ? kiteStreamService.getPriceForSymbolRow(symbolRow)
          : kiteStreamService.getPrice(trade.symbol);
        if (livePrice && Number(livePrice.last || 0) > 0) {
          return roundMoney(livePrice.last);
        }
      } catch (_) {}
    }

    const dbPrice = this._getDbSettlementPrice(symbolRow);
    if (dbPrice > 0) return roundMoney(dbPrice);

    const positionCurrentPrice = firstPositiveNumber(trade.current_price, trade.close_price);
    if (positionCurrentPrice > 0) return roundMoney(positionCurrentPrice);

    return roundMoney(trade.open_price || 0);
  }
}

module.exports = new WeeklySettlementService();
