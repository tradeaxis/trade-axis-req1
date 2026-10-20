// Published fallback; reviewed 2026-10-20. Keep calendar years explicit so a
// network failure cannot silently discard this year's announced closures.
// NSE F&O circular: https://nsearchives.nseindia.com/content/circulars/FAOP71777.pdf
const equityHolidays = {
  '2026-01-26': 'Republic Day',
  '2026-03-03': 'Holi',
  '2026-03-26': 'Shri Ram Navami',
  '2026-03-31': 'Shri Mahavir Jayanti',
  '2026-04-03': 'Good Friday',
  '2026-04-14': 'Dr. Baba Saheb Ambedkar Jayanti',
  '2026-05-01': 'Maharashtra Day',
  '2026-05-28': 'Bakri Id',
  '2026-06-26': 'Muharram',
  '2026-09-14': 'Ganesh Chaturthi',
  '2026-10-02': 'Mahatma Gandhi Jayanti',
  '2026-10-20': 'Dussehra',
  '2026-11-10': 'Diwali-Balipratipada',
  '2026-11-24': 'Guru Nanak Jayanti',
  '2026-12-25': 'Christmas',
};

// Segment-specific notice; equity holidays must not close MCX all day.
// https://zerodha.com/marketintel/bulletin/461171/trading-holiday-on-account-of-dussehra-on-october-20-2026
const commoditySessions = {
  '2026-10-20': { openMinute: 17 * 60, closeMinute: 23 * 60 + 30 },
};

module.exports = { equityHolidays, commoditySessions };
