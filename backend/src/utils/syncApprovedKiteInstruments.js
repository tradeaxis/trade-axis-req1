const { supabase } = require('../config/supabase');
const kiteService = require('../services/kiteService');
const {
  APPROVED_ALIAS_SYMBOLS,
  getApprovedAliasSymbolFromInstrument,
  getApprovedCategoryForUnderlying,
  normalizeSymbol,
} = require('../config/approvedFutures');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function getTradingHours(exchange) {
  return normalizeSymbol(exchange) === 'MCX' ? '09:00-23:30' : '09:15-15:30';
}

function toDateOnly(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function makeDisplayName(underlying, expiry) {
  if (!expiry) {
    return `${underlying} Near Month`;
  }

  const d = new Date(expiry);
  const month = MONTHS[d.getMonth()];
  const year = String(d.getFullYear()).slice(-2);

  return `${underlying} Near Month (${month}${year})`;
}

async function fetchActiveReferences() {
  const [
    { data: openTrades, error: openTradesError },
    { data: pendingOrders, error: pendingOrdersError },
  ] = await Promise.all([
    supabase.from('trades').select('symbol').eq('status', 'open'),
    supabase.from('pending_orders').select('symbol').eq('status', 'pending'),
  ]);

  if (openTradesError) {
    throw openTradesError;
  }

  if (pendingOrdersError && pendingOrdersError.code !== '42P01') {
    throw pendingOrdersError;
  }

  return new Set(
    [...(openTrades || []), ...(pendingOrders || [])]
      .map((row) => normalizeSymbol(row.symbol))
      .filter(Boolean)
  );
}

async function normalizeWatchlists(currentSymbolsByName, keepSymbols) {
  const { data: watchlistRows, error } = await supabase
    .from('watchlist_symbols')
    .select('id, watchlist_id, symbol, sort_order')
    .order('watchlist_id', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return { migrated: 0, removed: 0 };
    }
    throw error;
  }

  const seenByWatchlist = new Map();
  let migrated = 0;
  let removed = 0;

  for (const row of watchlistRows || []) {
    const currentSymbol = normalizeSymbol(row.symbol);
    const symbolMeta = currentSymbolsByName.get(currentSymbol);
    const mappedSymbol = keepSymbols.has(currentSymbol)
      ? currentSymbol
      : (symbolMeta?.underlying ? `${normalizeSymbol(symbolMeta.underlying)}-I` : null);

    if (!seenByWatchlist.has(row.watchlist_id)) {
      seenByWatchlist.set(row.watchlist_id, new Set());
    }

    const seenSymbols = seenByWatchlist.get(row.watchlist_id);
    const finalSymbol = mappedSymbol && keepSymbols.has(mappedSymbol) ? mappedSymbol : null;

    if (!finalSymbol || seenSymbols.has(finalSymbol)) {
      const { error: deleteError } = await supabase
        .from('watchlist_symbols')
        .delete()
        .eq('id', row.id);

      if (deleteError) {
        throw deleteError;
      }

      removed += 1;
      continue;
    }

    seenSymbols.add(finalSymbol);

    if (finalSymbol !== currentSymbol) {
      const { error: updateError } = await supabase
        .from('watchlist_symbols')
        .update({ symbol: finalSymbol })
        .eq('id', row.id);

      if (updateError) {
        throw updateError;
      }

      migrated += 1;
    }
  }

  return { migrated, removed };
}

async function upsertRows(rows) {
  const batchSize = 200;
  let upserted = 0;

  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from('symbols')
      .upsert(chunk, { onConflict: 'symbol' });

    if (error) {
      throw error;
    }

    upserted += chunk.length;
  }

  return upserted;
}

async function deleteObsoleteSymbols(symbolsToDelete) {
  const batchSize = 200;
  let deleted = 0;

  for (let index = 0; index < symbolsToDelete.length; index += batchSize) {
    const chunk = symbolsToDelete.slice(index, index + batchSize);
    const { data, error } = await supabase
      .from('symbols')
      .delete()
      .in('symbol', chunk)
      .select('symbol');

    if (error) {
      throw error;
    }

    deleted += data?.length || 0;
  }

  return deleted;
}

async function syncApprovedKiteInstruments() {
  console.log('Syncing approved Kite futures universe (near-month aliases only)...');

  try {
    await kiteService.init();

    if (!kiteService.isSessionReady()) {
      return { success: false, upserted: 0, reason: 'Kite session not ready' };
    }

    const kite = kiteService.getKiteInstance();
    if (!kite) {
      return { success: false, upserted: 0, reason: 'Kite instance unavailable' };
    }

    const requestedAliases = new Set(APPROVED_ALIAS_SYMBOLS);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fetches = await Promise.allSettled([
      kite.getInstruments('NFO'),
      kite.getInstruments('MCX'),
      kite.getInstruments('BFO'),
    ]);

    const exchangeLabels = ['NFO', 'MCX', 'BFO'];
    const allInstruments = [];

    fetches.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`Fetched ${result.value.length} instruments from ${exchangeLabels[index]}`);
        allInstruments.push(...result.value);
      } else {
        console.warn(`Failed to fetch ${exchangeLabels[index]} instruments: ${result.reason?.message || 'unknown error'}`);
      }
    });

    const selectedByAlias = new Map();

    for (const instrument of allInstruments) {
      const instrumentType = normalizeSymbol(instrument.instrument_type);
      const aliasSymbol = getApprovedAliasSymbolFromInstrument(instrument);
      const expiry = instrument.expiry ? toDateOnly(instrument.expiry) : null;

      if (instrumentType !== 'FUT' || !aliasSymbol || !expiry || expiry < today) {
        continue;
      }

      const existing = selectedByAlias.get(aliasSymbol);
      if (!existing || expiry < existing.expiry) {
        selectedByAlias.set(aliasSymbol, { instrument, expiry });
      }
    }

    const nowIso = new Date().toISOString();
    const rows = Array.from(selectedByAlias.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([aliasSymbol, { instrument, expiry }]) => {
        const underlying = aliasSymbol.replace(/-I$/i, '');
        const exchange = normalizeSymbol(instrument.exchange);

        return {
          symbol: aliasSymbol,
          display_name: makeDisplayName(underlying, expiry),
          exchange: exchange === 'NFO' ? 'NSE' : exchange === 'BFO' ? 'BSE' : 'MCX',
          category: getApprovedCategoryForUnderlying(underlying, exchange),
          segment: exchange,
          instrument_type: 'FUT',
          lot_size: 1,
          tick_size: Number(instrument.tick_size || 0.05),
          kite_exchange: exchange,
          kite_tradingsymbol: normalizeSymbol(instrument.tradingsymbol),
          kite_instrument_token: Number(instrument.instrument_token),
          expiry_date: expiry.toISOString().slice(0, 10),
          underlying,
          series: 'I',
          is_active: true,
          trading_hours: getTradingHours(exchange),
          last_update: nowIso,
          original_lot_size: Number(instrument.lot_size || 1),
        };
      });

    const keepSymbols = new Set(rows.map((row) => row.symbol));
    const missingRequested = [...requestedAliases]
      .filter((symbol) => !keepSymbols.has(symbol))
      .sort();

    const activeReferences = await fetchActiveReferences();
    const blockingSymbols = [...activeReferences]
      .filter((symbol) => !keepSymbols.has(symbol))
      .sort();

    if (blockingSymbols.length > 0) {
      return {
        success: false,
        upserted: 0,
        reason: 'Unapproved open trades or pending orders still exist',
        blockingSymbols,
      };
    }

    const { data: currentSymbols, error: currentSymbolsError } = await supabase
      .from('symbols')
      .select('symbol, underlying')
      .eq('instrument_type', 'FUT');

    if (currentSymbolsError) {
      throw currentSymbolsError;
    }

    const currentSymbolsByName = new Map(
      (currentSymbols || []).map((row) => [normalizeSymbol(row.symbol), row])
    );

    const watchlistCleanup = await normalizeWatchlists(currentSymbolsByName, keepSymbols);
    const upserted = await upsertRows(rows);

    const obsoleteSymbols = (currentSymbols || [])
      .map((row) => normalizeSymbol(row.symbol))
      .filter((symbol) => symbol && !keepSymbols.has(symbol))
      .sort();

    const deleted = await deleteObsoleteSymbols(obsoleteSymbols);

    return {
      success: true,
      upserted,
      deleted,
      activeSymbols: rows.length,
      migratedWatchlistSymbols: watchlistCleanup.migrated,
      removedWatchlistSymbols: watchlistCleanup.removed,
      missingRequested,
    };
  } catch (error) {
    console.error('syncApprovedKiteInstruments error:', error);
    return { success: false, upserted: 0, reason: error.message };
  }
}

module.exports = { syncApprovedKiteInstruments };
