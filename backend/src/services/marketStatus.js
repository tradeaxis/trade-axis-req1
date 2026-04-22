// backend/src/services/marketStatus.js
const { supabase } = require('../config/supabase');
const https = require('https');

let isMarketHoliday = false;
let holidayMessage = '';
let holidayDate = null;
let holidaysCache = []; // Array of YYYY-MM-DD strings
let lastHolidayFetch = null;

// ✅ Get today's date in IST as YYYY-MM-DD
const getISTDateString = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);
  return ist.toISOString().slice(0, 10);
};

const normalizeHolidayDate = (value) => {
  if (!value) return null;

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString().slice(0, 10);
  }

  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

const collectHolidayDates = (node, out = new Set()) => {
  if (!node) return out;

  if (Array.isArray(node)) {
    node.forEach((item) => collectHolidayDates(item, out));
    return out;
  }

  if (typeof node === 'object') {
    const directDate = normalizeHolidayDate(
      node.date || node.holiday_date || node.trading_date,
    );
    if (directDate) out.add(directDate);

    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') {
        collectHolidayDates(value, out);
      }
    });
  }

  return out;
};

const fetchKiteHolidayPayload = async (apiKey, accessToken) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      'https://api.kite.trade/market.holidays',
      {
        method: 'GET',
        headers: {
          Authorization: `token ${apiKey}:${accessToken}`,
          'X-Kite-Version': '3',
          'User-Agent': 'Trade Axis',
        },
      },
      (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(
                `Kite holiday request failed (${res.statusCode}): ${body.slice(0, 200)}`,
              ),
            );
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid Kite holiday response: ${error.message}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.end();
  });

// ✅ Fetch holidays from Kite API
const fetchHolidaysFromKite = async () => {
  try {
    const kiteService = require('./kiteService');
    await kiteService.init();
    
    if (!kiteService.isSessionReady()) {
      console.warn('⚠️ Cannot fetch holidays — Kite session not ready');
      return [];
    }

    const kc = kiteService.getKiteInstance();
    if (!kc) return [];

    let holidayPayload = [];

    if (typeof kc.getHolidays === 'function') {
      holidayPayload = await kc.getHolidays();
    } else {
      holidayPayload = await fetchKiteHolidayPayload(
        kiteService.apiKey,
        kiteService.accessToken,
      );
    }

    const dates = [...collectHolidayDates(holidayPayload)].sort();

    console.log(`📅 Fetched ${dates.length} market holidays from Kite`);
    
    holidaysCache = dates;
    lastHolidayFetch = Date.now();
    
    // Save to DB
    await supabase
      .from('app_settings')
      .upsert({
        key: 'kite_holidays',
        value: JSON.stringify({ holidays: dates, fetchedAt: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    return dates;
  } catch (err) {
    console.error('❌ Failed to fetch holidays from Kite:', err.message);
    return [];
  }
};

// ✅ Load holidays from DB (on startup or if cache is stale)
const loadHolidaysFromDB = async () => {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'kite_holidays')
      .single();

    if (data?.value) {
      const parsed = JSON.parse(data.value);
      holidaysCache = parsed.holidays || [];
      lastHolidayFetch = parsed.fetchedAt
        ? new Date(parsed.fetchedAt).getTime()
        : null;
      console.log(`📅 Loaded ${holidaysCache.length} holidays from DB`);
    }
  } catch (e) {
    // Table/row may not exist
  }
};

// ✅ Check if today is a holiday (from cache)
const isHolidayActiveToday = () => {
  const today = getISTDateString();
  return holidaysCache.includes(today);
};

// ✅ Manual holiday override (for testing or unexpected holidays)
const setHoliday = (isHoliday, message = '', date = null) => {
  isMarketHoliday = !!isHoliday;
  holidayMessage = message || '';
  holidayDate = date || null;

  console.log(
    `📅 Manual holiday ${isMarketHoliday ? 'ENABLED' : 'DISABLED'}${
      holidayMessage ? ': ' + holidayMessage : ''
    }${holidayDate ? ' (date: ' + holidayDate + ')' : ''}`
  );
};

const getHolidayStatus = () => ({
  isHoliday: isMarketHoliday || isHolidayActiveToday(),
  message: holidayMessage || (isHolidayActiveToday() ? 'Market Holiday (Kite)' : ''),
  date: holidayDate,
  holidays: holidaysCache,
  fetchedAt: lastHolidayFetch ? new Date(lastHolidayFetch).toISOString() : null,
});

// Commodity keywords
const COMMODITY_KEYWORDS =
  /^(GOLD|GOLDM|GOLDGUINEA|GOLDPETAL|SILVER|SILVERM|SILVERMIC|CRUDE|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL|COTTON|MENTHAOIL)/i;

const isCommoditySymbol = (symbol, exchange = null) => {
  if (exchange && String(exchange).toUpperCase() === 'MCX') return true;
  if (!symbol) return false;
  return COMMODITY_KEYWORDS.test(String(symbol).toUpperCase());
};

const isMarketOpen = (symbol = null, exchange = null) => {
  // Check manual override first
  if (isMarketHoliday && (!holidayDate || getISTDateString() === holidayDate)) {
    return false;
  }
  
  // Check Kite holidays
  if (isHolidayActiveToday()) return false;

  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();

  if (isCommoditySymbol(symbol, exchange)) {
    return mins >= 9 * 60 && mins <= 23 * 60 + 30;
  }

  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

const isAnyMarketOpen = () => {
  if (isMarketHoliday || isHolidayActiveToday()) return false;

  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 && mins <= 23 * 60 + 30;
};

// ✅ Auto-refresh holidays every 24 hours
const startHolidayRefresh = () => {
  // Fetch on startup (after 10s delay to let Kite init)
  setTimeout(() => {
    loadHolidaysFromDB().then(() => {
      // If cache is empty or older than 7 days, fetch from Kite
      if (
        holidaysCache.length === 0 ||
        !lastHolidayFetch ||
        Date.now() - lastHolidayFetch > 7 * 24 * 60 * 60 * 1000
      ) {
        fetchHolidaysFromKite();
      }
    });
  }, 10000);

  // Refresh every 24 hours
  setInterval(() => {
    fetchHolidaysFromKite();
  }, 24 * 60 * 60 * 1000);
};

module.exports = {
  setHoliday,
  getHolidayStatus,
  isMarketOpen,
  isCommoditySymbol,
  isAnyMarketOpen,
  fetchHolidaysFromKite,
  startHolidayRefresh,
};
