// backend/src/services/marketStatus.js
const { supabase } = require('../config/supabase');

let isMarketHoliday = false;
let holidayMessage = '';
let holidayDate = null; // YYYY-MM-DD or null for indefinite

// ✅ Get today's date in IST as YYYY-MM-DD
const getISTDateString = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);
  return ist.toISOString().slice(0, 10);
};

// Load from DB on startup
const loadHolidayFromDB = async () => {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'market_holiday')
      .single();

    if (data?.value) {
      const parsed = JSON.parse(data.value);
      isMarketHoliday = !!parsed.isHoliday;
      holidayMessage = parsed.message || '';
      holidayDate = parsed.date || null;

      // Auto-disable if holiday date has passed
      if (holidayDate) {
        const today = getISTDateString();
        if (today > holidayDate) {
          isMarketHoliday = false;
          holidayMessage = '';
          holidayDate = null;
          await saveHolidayToDB();
        }
      }
    }
  } catch (e) {
    // Table/row may not exist
  }
};

const saveHolidayToDB = async () => {
  try {
    const value = JSON.stringify({
      isHoliday: isMarketHoliday,
      message: holidayMessage,
      date: holidayDate,
    });

    const { data: existing } = await supabase
      .from('app_settings')
      .select('id')
      .eq('key', 'market_holiday')
      .single();

    if (existing) {
      await supabase
        .from('app_settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', 'market_holiday');
    } else {
      await supabase
        .from('app_settings')
        .insert({ key: 'market_holiday', value, updated_at: new Date().toISOString() });
    }
  } catch (e) {
    console.warn('Failed to save holiday to DB:', e.message);
  }
};

// Initialize on module load
loadHolidayFromDB();

const setHoliday = (isHoliday, message = '', date = null) => {
  isMarketHoliday = !!isHoliday;
  holidayMessage = message || '';
  holidayDate = date || null;
  saveHolidayToDB();

  console.log(
    `📅 Market holiday ${isMarketHoliday ? 'ENABLED' : 'DISABLED'}${
      holidayMessage ? ': ' + holidayMessage : ''
    }${holidayDate ? ' (date: ' + holidayDate + ')' : ''}`
  );
};

const getHolidayStatus = () => ({
  isHoliday: isMarketHoliday,
  message: holidayMessage,
  date: holidayDate,
});

// ✅ Holiday is active only if:
// 1. holiday mode is enabled
// 2. no date is set OR today in IST matches holiday date
const isHolidayActiveToday = () => {
  if (!isMarketHoliday) return false;
  if (!holidayDate) return true;
  return getISTDateString() === holidayDate;
};

// Commodity keywords used to identify MCX/commodity symbols
const COMMODITY_KEYWORDS =
  /^(GOLD|GOLDM|GOLDGUINEA|GOLDPETAL|SILVER|SILVERM|SILVERMIC|CRUDE|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL|COTTON|MENTHAOIL)/i;

/**
 * Check if a symbol belongs to the commodity/MCX segment
 */
const isCommoditySymbol = (symbol, exchange = null) => {
  if (exchange && String(exchange).toUpperCase() === 'MCX') return true;
  if (!symbol) return false;
  return COMMODITY_KEYWORDS.test(String(symbol).toUpperCase());
};

/**
 * Check if market is open.
 * @param {string|null} symbol — if provided, uses commodity hours for MCX symbols
 */
const isMarketOpen = (symbol = null, exchange = null) => {
  if (isHolidayActiveToday()) return false;

  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();

  // Commodity (MCX) market: 9:00 AM to 11:30 PM IST
  if (isCommoditySymbol(symbol, exchange)) {
    return mins >= 9 * 60 && mins <= 23 * 60 + 30;
  }

  // Default: Equity/Index market 9:15 AM to 3:30 PM IST
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

/**
 * Check if ANY market segment is currently open
 */
const isAnyMarketOpen = () => {
  if (isHolidayActiveToday()) return false;

  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);

  const day = ist.getDay();
  if (day === 0 || day === 6) return false;

  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 9 * 60 && mins <= 23 * 60 + 30;
};

module.exports = {
  setHoliday,
  getHolidayStatus,
  isMarketOpen,
  isCommoditySymbol,
  isAnyMarketOpen,
};