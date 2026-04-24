const COMMENT_EVENTS_PREFIX = '__TA_EVENTS__:';
const MAX_COMMENT_LENGTH = 200;

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const trimNumericString = (value, fractionDigits = 2) => (
  toFiniteNumber(value, 0)
    .toFixed(fractionDigits)
    .replace(/\.?0+$/, '')
);

const fitTradeComment = (comment = '', maxLength = MAX_COMMENT_LENGTH) => (
  String(comment || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
);

const stripTradeCommentEvents = (comment = '') => (
  String(comment || '')
    .split('\n')
    .filter((line) => !line.startsWith(COMMENT_EVENTS_PREFIX))
    .join('\n')
    .replace(/\s*\[\+[^\]]+\]/g, '')
    .trim()
);

const serializeTradeCommentPayload = (entryEvents = []) => (
  normalizeEntryEvents(entryEvents)
    .map((event) => {
      const epochSeconds = Math.floor(new Date(event.time).getTime() / 1000);
      return [
        String(event.action || 'entry').toLowerCase().startsWith('a') ? 'a' : 'e',
        Number.isFinite(epochSeconds) ? epochSeconds.toString(36) : '',
        trimNumericString(event.quantity, 4),
        trimNumericString(event.price, 2),
        trimNumericString(event.commission, 2),
      ].join('|');
    })
    .filter(Boolean)
    .join(';')
);

const parseCompactTradeCommentPayload = (value = '') => {
  const entryEvents = String(value || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [actionCode, timeCode, quantity, price, commission] = chunk.split('|');
      const epochSeconds = parseInt(String(timeCode || ''), 36);
      if (!actionCode || !Number.isFinite(epochSeconds)) return null;
      return buildTradeEntryEvent({
        action: actionCode === 'a' ? 'add' : 'entry',
        time: new Date(epochSeconds * 1000).toISOString(),
        quantity,
        price,
        commission,
      });
    })
    .filter(Boolean);

  return { entryEvents };
};

const parseTradeCommentPayload = (comment = '') => {
  const rawComment = String(comment || '');
  const encodedLine = rawComment
    .split('\n')
    .find((line) => line.startsWith(COMMENT_EVENTS_PREFIX));

  if (!encodedLine) return { entryEvents: [] };

  try {
    const payload = encodedLine.slice(COMMENT_EVENTS_PREFIX.length);
    try {
      const decoded = decodeURIComponent(payload);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (_) {
      return parseCompactTradeCommentPayload(payload);
    }
    return { entryEvents: [] };
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
  const visibleComment = fitTradeComment(stripTradeCommentEvents(comment));
  const normalizedEntryEvents = normalizeEntryEvents(entryEvents);

  if (normalizedEntryEvents.length === 0) return visibleComment;

  const payloadLine = `${COMMENT_EVENTS_PREFIX}${serializeTradeCommentPayload(normalizedEntryEvents)}`;
  if (payloadLine.length >= MAX_COMMENT_LENGTH) {
    return payloadLine.slice(0, MAX_COMMENT_LENGTH);
  }

  const availableVisibleLength = MAX_COMMENT_LENGTH - payloadLine.length - 1;
  const safeVisibleComment = availableVisibleLength > 0
    ? visibleComment.slice(0, availableVisibleLength).trim()
    : '';

  return [safeVisibleComment, payloadLine]
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_COMMENT_LENGTH);
};

module.exports = {
  COMMENT_EVENTS_PREFIX,
  buildTradeEntryEvent,
  ensureTradeEntryHistory,
  fitTradeComment,
  getTradeEntryEvents,
  mergeTradeCommentEvents,
  parseTradeCommentPayload,
  stripTradeCommentEvents,
};
