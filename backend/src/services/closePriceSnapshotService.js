const { supabase } = require('../config/supabase');
const kiteService = require('./kiteService');
const { isCommoditySymbol } = require('./marketStatus');

const QUOTE_BATCH_SIZE = Number(process.env.KITE_CLOSE_SNAPSHOT_BATCH_SIZE || 250);
const QUOTE_BATCH_DELAY_MS = Number(process.env.KITE_CLOSE_SNAPSHOT_BATCH_DELAY_MS || 1100);

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const firstPositiveNumber = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
};

const inferKiteExchange = (row = {}) => {
  const direct = String(row.kite_exchange || row.exchange || '').toUpperCase();
  if (['NFO', 'BFO', 'MCX'].includes(direct)) return direct;
  if (direct === 'BSE') return 'BFO';
  if (isCommoditySymbol(row.symbol, direct)) return 'MCX';
  return 'NFO';
};

const isRequestedSegment = (row, segment) => {
  const exchange = inferKiteExchange(row);
  return segment === 'commodity' ? exchange === 'MCX' : exchange !== 'MCX';
};

class ClosePriceSnapshotService {
  async capture(segment = 'equity') {
    const normalizedSegment = segment === 'commodity' ? 'commodity' : 'equity';

    await kiteService.init();
    if (!kiteService.isSessionReady()) {
      return {
        success: false,
        segment: normalizedSegment,
        updated: 0,
        message: 'Kite session is not ready',
      };
    }

    const kite = kiteService.getKiteInstance();
    if (!kite || typeof kite.getQuote !== 'function') {
      return {
        success: false,
        segment: normalizedSegment,
        updated: 0,
        message: 'Kite quote client is unavailable',
      };
    }

    const { data: symbolRows, error } = await supabase
      .from('symbols')
      .select('symbol, display_name, kite_tradingsymbol, kite_exchange, exchange')
      .eq('is_active', true)
      .eq('instrument_type', 'FUT')
      .limit(10000);

    if (error) throw error;

    const rows = (symbolRows || []).filter(
      (row) => row.symbol && row.kite_tradingsymbol && isRequestedSegment(row, normalizedSegment),
    );
    const rowByQuoteKey = new Map();

    rows.forEach((row) => {
      const quoteKey = `${inferKiteExchange(row)}:${String(row.kite_tradingsymbol).toUpperCase()}`;
      if (!rowByQuoteKey.has(quoteKey)) rowByQuoteKey.set(quoteKey, []);
      rowByQuoteKey.get(quoteKey).push(row);
    });

    const quoteKeys = [...rowByQuoteKey.keys()];
    const updates = [];

    for (let index = 0; index < quoteKeys.length; index += QUOTE_BATCH_SIZE) {
      const batch = quoteKeys.slice(index, index + QUOTE_BATCH_SIZE);
      let quotes = {};
      try {
        quotes = await kite.getQuote(batch);
      } catch (quoteError) {
        console.warn(
          `Closing price snapshot (${normalizedSegment}) batch ${index / QUOTE_BATCH_SIZE + 1} failed: ${quoteError.message}`,
        );
      }

      batch.forEach((quoteKey) => {
        const quote = quotes?.[quoteKey] || quotes?.[quoteKey.split(':')[1]];
        const closePrice = firstPositiveNumber(
          quote?.last_price,
          quote?.lastPrice,
          quote?.last_traded_price,
          quote?.ltp,
        );
        if (closePrice <= 0) return;

        (rowByQuoteKey.get(quoteKey) || []).forEach((row) => {
          updates.push({
            symbol: row.symbol,
            last_price: closePrice,
            close_price: closePrice,
            bid: closePrice,
            ask: closePrice,
            last_update: new Date().toISOString(),
          });
        });
      });

      if (index + QUOTE_BATCH_SIZE < quoteKeys.length) {
        await wait(QUOTE_BATCH_DELAY_MS);
      }
    }

    for (let index = 0; index < updates.length; index += 250) {
      const { error: updateError } = await supabase
        .from('symbols')
        .upsert(updates.slice(index, index + 250), {
          onConflict: 'symbol',
          ignoreDuplicates: false,
        });
      if (updateError) throw updateError;
    }

    console.log(
      `Closing price snapshot (${normalizedSegment}): ${updates.length}/${rows.length} symbols updated`,
    );

    return {
      success: true,
      segment: normalizedSegment,
      updated: updates.length,
      requested: rows.length,
      quotes: updates.map((row) => ({
        symbol: row.symbol,
        last: row.close_price,
        last_price: row.close_price,
        close_price: row.close_price,
        bid: row.close_price,
        ask: row.close_price,
        timestamp: Date.now(),
        source: 'database',
      })),
    };
  }

  async captureClosedSegmentsNow() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utcMs + 5.5 * 3600000);
    const day = ist.getDay();
    if (day === 0 || day === 6) return [];

    const minutes = ist.getHours() * 60 + ist.getMinutes();
    const results = [];

    if (minutes > 15 * 60 + 30) {
      results.push(await this.capture('equity'));
    }
    if (minutes > 23 * 60 + 30) {
      results.push(await this.capture('commodity'));
    }

    return results;
  }
}

module.exports = new ClosePriceSnapshotService();
