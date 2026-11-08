// backend/src/services/marketStatus.js
const { supabase } = require('../config/supabase');
const { equityHolidays, commoditySessions } = require('../config/exchangeCalendar');

let isMarketHoliday = false;
let holidayMessage = '';
let holidayDate = null;
let holidaySegments = {
  nseBseClosed: true,
  mcxClosed: true,
  mcxMorningOnly: false,
};
let holidaysCache = []; // Array of YYYY-MM-DD strings
let lastHolidayFetch = null;

// ✅ Get today's date in IST as YYYY-MM-DD
const getISTDateString = () => {
  const ist = new Date(Date.now() + 5.5 * 3600000);
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

// Keep the exported function for existing admin callers. The installed Kite
// SDK has no holiday API; never call the nonexistent /market.holidays route.
const fetchHolidaysFromKite = async () => {
  try {
    const kiteService = require('./kiteService');
    await kiteService.init();
    
    if (!kiteService.isSessionReady()) {
      return [...new Set([...Object.keys(equityHolidays), ...holidaysCache])].sort();
    }

    const kc = kiteService.getKiteInstance();
    if (!kc || typeof kc.getHolidays !== 'function') {
      return [...new Set([...Object.keys(equityHolidays), ...holidaysCache])].sort();
    }

    const holidayPayload = await kc.getHolidays();

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
    return [...new Set([...Object.keys(equityHolidays), ...holidaysCache])].sort();
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
  return !!equityHolidays[today] || holidaysCache.includes(today);
};

// ✅ Manual holiday override (for testing or unexpected holidays)
const normalizeHolidaySegments = (segments = {}) => ({
  nseBseClosed: segments.nseBseClosed !== false,
  mcxClosed: segments.mcxClosed !== false,
  mcxMorningOnly: !!segments.mcxMorningOnly,
});

const setHoliday = (isHoliday, message = '', date = null, segments = {}) => {
  isMarketHoliday = !!isHoliday;
  holidayMessage = message || '';
  holidayDate = date || null;
  holidaySegments = normalizeHolidaySegments(segments);

  console.log(
    `📅 Manual holiday ${isMarketHoliday ? 'ENABLED' : 'DISABLED'}${
      holidayMessage ? ': ' + holidayMessage : ''
    }${holidayDate ? ' (date: ' + holidayDate + ')' : ''}`
  );
};

const getHolidayStatus = () => {
  const today = getISTDateString();
  const manualActive = isMarketHoliday && (!holidayDate || holidayDate === today);
  return {
    isHoliday: manualActive || isHolidayActiveToday(),
    message: manualActive ? holidayMessage : (equityHolidays[today] || (isHolidayActiveToday() ? 'Market Holiday' : '')),
    date: manualActive ? holidayDate : today,
    segments: manualActive ? holidaySegments : {
      nseBseClosed: isHolidayActiveToday(),
      mcxClosed: !isMarketOpen('GOLD', 'MCX'),
      mcxMorningOnly: false,
      mcxEveningOnly: !!commoditySessions[today],
    },
    holidays: [...new Set([...Object.keys(equityHolidays), ...holidaysCache])].sort(),
    calendarSource: 'Published NSE calendar and cached holidays',
    calendarYears: [2026],
    fetchedAt: lastHolidayFetch ? new Date(lastHolidayFetch).toISOString() : null,
  };
};

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
    const commodity = isCommoditySymbol(symbol, exchange);
    if (commodity) {
      if (holidaySegments.mcxClosed) return false;
      if (holidaySegments.mcxMorningOnly) {
        const ist = new Date(Date.now() + 5.5 * 3600000);
        const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        return minutes >= 9 * 60 && minutes < 17 * 60;
      }
      return true;
    }
    if (holidaySegments.nseBseClosed) return false;
  }
  
  // Check Kite holidays
  if (!isCommoditySymbol(symbol, exchange) && isHolidayActiveToday()) return false;

  const ist = new Date(Date.now() + 5.5 * 3600000);

  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;

  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  if (isCommoditySymbol(symbol, exchange)) {
    const session = commoditySessions[getISTDateString()];
    if (session) return mins >= session.openMinute && mins <= session.closeMinute;
    return mins >= 9 * 60 && mins <= 23 * 60 + 30;
  }

  // This application trades F&O outside MCX. Keep MCX unchanged above and
  // allow the F&O segment through 3:40 PM IST.
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 40;
};

const isAnyMarketOpen = () => {
  return isMarketOpen('NIFTY', 'NFO') || isMarketOpen('GOLD', 'MCX');
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
