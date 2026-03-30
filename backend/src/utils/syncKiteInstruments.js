// backend/src/utils/syncKiteInstruments.js
//
// COMPREHENSIVE sync — fetches ALL futures (NFO + MCX + BFO) from Kite,
// upserts every active FUT contract into the symbols table, and creates
// rolling aliases (SYMBOL-I, SYMBOL-II, SYMBOL-III) for every underlying.
//
// This replaces the old version that only handled ~15 MCX commodity patterns.

const { supabase } = require('../config/supabase');
const kiteService  = require('../services/kiteService');

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ── Known index / sensex underlyings (used for category assignment) ──
const INDEX_NAMES  = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY']);
const SENSEX_NAMES = new Set(['SENSEX', 'BANKEX']);

function getCategory(underlying, exchange) {
  if (exchange === 'MCX')                return 'commodity_futures';
  if (SENSEX_NAMES.has(underlying))      return 'sensex_futures';
  if (INDEX_NAMES.has(underlying))       return 'index_futures';
  if (/GIFT.*NIFTY|NIFTY.*GIFT/i.test(underlying)) return 'index_futures';
  return 'stock_futures';
}

function getTradingHours(exchange) {
  if (exchange === 'MCX') return '09:00-23:30';
  if (exchange === 'BFO') return '09:15-15:30';
  return '09:15-15:30';
}

function makeDisplayName(underlying, expiry) {
  if (!expiry) return `${underlying} FUT`;
  const d     = new Date(expiry);
  const month = MONTHS[d.getMonth()];
  const year  = String(d.getFullYear()).slice(-2);
  return `${underlying} ${month}${year} FUT`;
}

async function syncKiteInstruments() {
  console.log('🔄 Starting FULL instrument sync (NFO + MCX + BFO)...');

  try {
    // ── 1. Ensure Kite session ──────────────────────────────────────────────
    await kiteService.init();
    if (!kiteService.isSessionReady()) {
      console.log('❌ Kite session not ready. Cannot sync.');
      return { success: false, upserted: 0, reason: 'session not ready' };
    }

    const kite = kiteService.getKiteInstance();
    if (!kite) {
      console.log('❌ Kite instance not available.');
      return { success: false, upserted: 0, reason: 'no kite instance' };
    }

    // ── 2. Fetch instruments from all relevant exchanges ────────────────────
    console.log('📡 Fetching instruments from Kite...');
    const fetches = await Promise.allSettled([
      kite.getInstruments('NFO'),
      kite.getInstruments('MCX'),
      kite.getInstruments('BFO'),
    ]);

    const allInstruments = [];
    const labels = ['NFO', 'MCX', 'BFO'];
    fetches.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        console.log(`  ${labels[i]}: ${r.value.length} instruments`);
        allInstruments.push(...r.value);
      } else {
        console.warn(`  ${labels[i]}: FAILED — ${r.reason?.message || 'unknown'}`);
      }
    });

    if (allInstruments.length === 0) {
      console.log('❌ No instruments fetched from any exchange.');
      return { success: false, upserted: 0, reason: 'no instruments fetched' };
    }

    // ── 3. Filter: only FUT, not expired ────────────────────────────────────
    const now = new Date();
    now.setHours(0, 0, 0, 0);                       // compare date-only

    const futures = allInstruments.filter(inst => {
      if (String(inst.instrument_type).toUpperCase() !== 'FUT') return false;
      if (inst.expiry) {
        const exp = new Date(inst.expiry);
        exp.setHours(0, 0, 0, 0);
        if (exp < now) return false;                 // expired
      }
      const name = String(inst.name || '').trim();
      if (!name) return false;                       // skip if no underlying name
      return true;
    });

    console.log(`📊 Active FUT instruments: ${futures.length}`);

    if (futures.length === 0) {
      console.log('❌ No active futures found. Session may have expired.');
      return { success: false, upserted: 0, reason: 'no active futures' };
    }

    // ── 4. Build rows for every contract ────────────────────────────────────
    const rows          = [];
    const byUnderlying  = new Map();    // underlying → [instruments]
    const nowISO        = new Date().toISOString();

    for (const inst of futures) {
      const ts         = String(inst.tradingsymbol).toUpperCase();
      const underlying = String(inst.name).toUpperCase();
      const exchange   = String(inst.exchange).toUpperCase();
      const token      = Number(inst.instrument_token);

      if (!ts || !token) continue;

      const category    = getCategory(underlying, exchange);
      const displayName = makeDisplayName(underlying, inst.expiry);
      const expiryDate  = inst.expiry
        ? new Date(inst.expiry).toISOString().slice(0, 10)
        : null;

      rows.push({
        symbol:                ts,
        display_name:          displayName,
        exchange:              exchange === 'NFO' ? 'NSE' : exchange === 'BFO' ? 'BSE' : 'MCX',
        category,
        segment:               exchange,
        instrument_type:       'FUT',
        lot_size:              1,                         // app uses lot_size=1
        tick_size:             Number(inst.tick_size || 0.05),
        kite_exchange:         exchange,
        kite_tradingsymbol:    ts,
        kite_instrument_token: token,
        expiry_date:           expiryDate,
        underlying,
        series:                null,
        is_active:             true,
        trading_hours:         getTradingHours(exchange),
        last_update:           nowISO,
        original_lot_size:     Number(inst.lot_size || 1),
      });

      // Group for alias creation
      if (!byUnderlying.has(underlying)) byUnderlying.set(underlying, []);
      byUnderlying.get(underlying).push(inst);
    }

    // ── 5. Create rolling aliases  (SYMBOL-I / -II / -III) ──────────────────
    const seriesNames  = ['I', 'II', 'III'];
    const seriesLabels = ['Near Month', 'Next Month', 'Far Month'];

    for (const [underlying, list] of byUnderlying.entries()) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.expiry) - new Date(b.expiry),
      );
      const picks = sorted.slice(0, 3);                // nearest 3 expiries

      for (let i = 0; i < picks.length; i++) {
        const inst     = picks[i];
        const exchange = String(inst.exchange).toUpperCase();
        const token    = Number(inst.instrument_token);
        const month    = MONTHS[new Date(inst.expiry).getMonth()];
        const year     = String(new Date(inst.expiry).getFullYear()).slice(-2);
        const category = getCategory(underlying, exchange);

        rows.push({
          symbol:                `${underlying}-${seriesNames[i]}`,
          display_name:          `${underlying} ${seriesLabels[i]} (${month}${year})`,
          exchange:              exchange === 'NFO' ? 'NSE' : exchange === 'BFO' ? 'BSE' : 'MCX',
          category,
          segment:               exchange,
          instrument_type:       'FUT',
          lot_size:              1,
          tick_size:             Number(inst.tick_size || 0.05),
          kite_exchange:         exchange,
          kite_tradingsymbol:    String(inst.tradingsymbol).toUpperCase(),
          kite_instrument_token: token,
          expiry_date:           inst.expiry
            ? new Date(inst.expiry).toISOString().slice(0, 10)
            : null,
          underlying,
          series:                seriesNames[i],
          is_active:             true,
          trading_hours:         getTradingHours(exchange),
          last_update:           nowISO,
          original_lot_size:     Number(inst.lot_size || 1),
        });
      }
    }

    console.log(`📝 Total rows to upsert: ${rows.length}  (${futures.length} contracts + ${rows.length - futures.length} aliases from ${byUnderlying.size} underlyings)`);

    // ── 6. Deactivate only symbols we're about to replace ──────────────────
    // Build set of exchanges we actually fetched successfully
    const fetchedExchanges = new Set();
    fetches.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        fetchedExchanges.add(labels[i]); // 'NFO', 'MCX', 'BFO'
      }
    });

    // Map kite exchange to app exchange for deactivation
    const exchangeMap = { NFO: 'NSE', MCX: 'MCX', BFO: 'BSE' };
    const appExchangesToDeactivate = [...fetchedExchanges]
      .map(e => exchangeMap[e])
      .filter(Boolean);

    if (appExchangesToDeactivate.length > 0) {
      console.log(`🔄 Deactivating FUT symbols for exchanges: ${appExchangesToDeactivate.join(', ')}`);
      await supabase
        .from('symbols')
        .update({ is_active: false })
        .eq('instrument_type', 'FUT')
        .in('exchange', appExchangesToDeactivate);
    } else {
      console.log('⚠️ No exchanges fetched successfully — skipping deactivation to protect existing data');
    }

    // ── 7. Upsert in batches ────────────────────────────────────────────────
    const BATCH = 500;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from('symbols')
        .upsert(chunk, { onConflict: 'symbol' });

      if (error) {
        console.error(`  ❌ Batch ${i / BATCH + 1} error:`, error.message);
        // continue with remaining batches — don't abort entire sync
      } else {
        upserted += chunk.length;
      }
    }

    console.log(`✅ Sync complete — upserted ${upserted} symbols (${byUnderlying.size} underlyings)`);

    return {
      success:     true,
      upserted,
      underlyings: byUnderlying.size,
      contracts:   futures.length,
      aliases:     rows.length - futures.length,
    };
  } catch (error) {
    console.error('❌ syncKiteInstruments error:', error);
    return { success: false, upserted: 0, reason: error.message };
  }
}

module.exports = { syncKiteInstruments };