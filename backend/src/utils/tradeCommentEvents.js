const COMMENT_EVENTS_PREFIX = '__TA_EVENTS__:';

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const stripTradeCommentEvents = (comment = '') => (
  String(comment || '')
    .split('\n')
    .filter((line) => !line.startsWith(COMMENT_EVENTS_PREFIX))
    .join('\n')
    .trim()
);

const parseTradeCommentPayload = (comment = '') => {
  const rawComment = String(comment || '');
  const encodedLine = rawComment
    .split('\n')
    .find((line) => line.startsWith(COMMENT_EVENTS_PREFIX));

  if (!encodedLine) return { entryEvents: [] };

  try {
    const decoded = decodeURIComponent(encodedLine.slice(COMMENT_EVENTS_PREFIX.length));
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === 'object' ? parsed : { entryEvents: [] };
  } catch (_) {
    return { entryEvents: [] };
  }
};

const buildTradeEntryEvent = ({
  action = 'entry',
  time,
  quantity,
  price,
  commission = 0,
}) => ({
  action: String(action || 'entry'),
  time: String(time || new Date().toISOString()),
  quantity: toFiniteNumber(quantity, 0),
  price: toFiniteNumber(price, 0),
  commission: toFiniteNumber(commission, 0),
});

const normalizeEntryEvents = (entryEvents = []) => (
  entryEvents
    .map((event) => buildTradeEntryEvent(event))
    .filter((event) => event.quantity > 0 && event.price > 0 && event.time)
);

const getTradeEntryEvents = (comment = '') => {
  const payload = parseTradeCommentPayload(comment);
  return normalizeEntryEvents(payload.entryEvents || []);
};

const ensureTradeEntryHistory = (trade = {}) => {
  const parsedEvents = getTradeEntryEvents(trade.comment);
  if (parsedEvents.length > 0) return parsedEvents;

  const quantity = toFiniteNumber(trade.original_quantity || trade.quantity, 0);
  const price = toFiniteNumber(trade.open_price, 0);
  const time = trade.open_time || trade.created_at || trade.updated_at || null;

  if (!quantity || !price || !time) return [];

  return [
    buildTradeEntryEvent({
      action: 'entry',
      time,
      quantity,
      price,
      commission: toFiniteNumber(trade.buy_brokerage ?? trade.brokerage, 0),
    }),
  ];
};

const mergeTradeCommentEvents = (comment = '', entryEvents = []) => {
  const visibleComment = stripTradeCommentEvents(comment);
  const normalizedEntryEvents = normalizeEntryEvents(entryEvents);

  if (normalizedEntryEvents.length === 0) return visibleComment;

  const encodedPayload = encodeURIComponent(JSON.stringify({
    entryEvents: normalizedEntryEvents,
  }));

  return [
    visibleComment,
    `${COMMENT_EVENTS_PREFIX}${encodedPayload}`,
  ]
    .filter(Boolean)
    .join('\n');
};

module.exports = {
  COMMENT_EVENTS_PREFIX,
  buildTradeEntryEvent,
  ensureTradeEntryHistory,
  getTradeEntryEvents,
  mergeTradeCommentEvents,
  parseTradeCommentPayload,
  stripTradeCommentEvents,
};
