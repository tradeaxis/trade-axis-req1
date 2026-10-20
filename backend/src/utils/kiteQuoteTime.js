// REST quote timestamps without an offset are exchange-local (IST), while
// KiteTicker supplies Date objects. Do not replace old exchange time with the
// time a REST request happened to finish.
function kiteQuoteTime(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value.getTime === 'function') return value.getTime() || 0;
  let text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) {
    text = text.replace(' ', 'T') + '+05:30';
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : 0;
}

module.exports = { kiteQuoteTime };
