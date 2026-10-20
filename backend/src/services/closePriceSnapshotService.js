const { supabase } = require('../config/supabase');
const kiteService = require('./kiteService');
const { isCommoditySymbol } = require('./marketStatus');
const { readAllRows } = require('../utils/readAllRows');

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

// Kite's response key is useful, but it is not the identity of a contract.
// Always verify with the instrument token before saving a final close.
const getQuoteForInstrumentToken = (quotes = {}, quoteKey = '', expectedToken = 0) => {
  const token = Number(expectedToken || 0);
  if (!token || !quotes || typeof quotes !== 'object') return null;

  const matchesToken = (quote) => Number(quote?.instrument_token || 0) === token;
  if (matchesToken(quotes[quoteKey])) return quotes[quoteKey];

  const normalizedKey = String(quoteKey || '').toUpperCase();
  for (const [key, quote] of Object.entries(quotes)) {
    if (String(key).toUpperCase() === normalizedKey && matchesToken(quote)) return quote;
  }

  return Object.values(quotes).find(matchesToken) || null;
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

    const symbolRows = await readAllRows(() => supabase
      .from('symbols')
      .select('*')
      .eq('is_active', true)
      .eq('instrument_type', 'FUT')
      .not('kite_instrument_token', 'is', null));

    const rows = (symbolRows || []).filter(
      (row) => (
        row.symbol
        && row.kite_tradingsymbol
        && Number(row.kite_instrument_token || 0) > 0
        && isRequestedSegment(row, normalizedSegment)
      ),
    );
    const rowByQuoteKey = new Map();

    rows.forEach((row) => {
      const quoteKey = `${inferKiteExchange(row)}:${String(row.kite_tradingsymbol).toUpperCase()}`;
      if (!rowByQuoteKey.has(quoteKey)) rowByQuoteKey.set(quoteKey, []);
      rowByQuoteKey.get(quoteKey).push(row);
    });

    const quoteKeys = [...rowByQuoteKey.keys()];
    const updates = [];
    let rejectedMismatches = 0;

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
        // Prefer Kite's response key, then safely resolve by instrument token.
        // A bare-symbol fallback is never used because it can cross expiries.
        const rowsForQuoteKey = rowByQuoteKey.get(quoteKey) || [];
        rowsForQuoteKey.forEach((row) => {
          const rowToken = Number(row.kite_instrument_token || 0);
          const quote = getQuoteForInstrumentToken(quotes, quoteKey, rowToken);
          const quoteToken = Number(quote?.instrument_token || 0);
          const closePrice = firstPositiveNumber(
            quote?.last_price,
            quote?.lastPrice,
            quote?.last_traded_price,
            quote?.ltp,
          );
          if (closePrice <= 0) return;
          if (!quoteToken || quoteToken !== rowToken) {
            rejectedMismatches++;
            console.warn(
              `Rejected closing price mismatch for ${row.symbol}: expected token ${rowToken}, received ${quoteToken || 'none'}`,
            );
            return;
          }

          updates.push({
            ...row,
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
      rejectedMismatches,
      quotes: updates.map((row) => ({
        symbol: row.symbol,
        last: row.close_price,
        last_price: row.close_price,
        close_price: row.close_price,
        bid: row.close_price,
        ask: row.close_price,
        instrumentToken: Number(row.kite_instrument_token || 0) || undefined,
        expiryDate: row.expiry_date || undefined,
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
    const minutes = ist.getHours() * 60 + ist.getMinutes();
    const results = [];

    // On weekends every segment is closed, so a backend restart can repair
    // stale stored prices from Kite's exact last quote without waiting for
    // Monday. This is especially useful after a deployment or failed snapshot.
    // F&O is intentionally available through 3:40 PM IST.  Capturing the
    // final price at 3:30 PM freezes an early value and corrupts closed P&L.
    if (day === 0 || day === 6 || minutes > 15 * 60 + 40) {
      results.push(await this.capture('equity'));
    }
    if (day === 0 || day === 6 || minutes > 23 * 60 + 30) {
      results.push(await this.capture('commodity'));
    }

    return results;
  }
}

module.exports = new ClosePriceSnapshotService();
