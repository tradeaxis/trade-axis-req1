const QUOTE_STALE_MS = 10_000;

const APPROVED_STOCK_UNDERLYINGS = Object.freeze([
  '360ONE',
  'ABB',
  'APLAPOLLO',
  'AUBANK',
  'ADANIENSOL',
  'ADANIENT',
  'ADANIGREEN',
  'ADANIPORTS',
  'ADANIPOWER',
  'ABCAPITAL',
  'ALKEM',
  'AMBER',
  'AMBUJACEM',
  'ANGELONE',
  'APOLLOHOSP',
  'ASHOKLEY',
  'ASIANPAINT',
  'ASTRAL',
  'AUROPHARMA',
  'DMART',
  'AXISBANK',
  'BSE',
  'BAJAJ-AUTO',
  'BAJFINANCE',
  'BAJAJFINSV',
  'BAJAJHLDNG',
  'BANDHANBNK',
  'BANKBARODA',
  'BANKINDIA',
  'BDL',
  'BEL',
  'BHARATFORG',
  'BHEL',
  'BPCL',
  'BHARTIARTL',
  'BIOCON',
  'BLUESTARCO',
  'BOSCHLTD',
  'BRITANNIA',
  'CGPOWER',
  'CANBK',
  'CDSL',
  'CHOLAFIN',
  'CIPLA',
  'COALINDIA',
  'COCHINSHIP',
  'COFORGE',
  'COLPAL',
  'CAMS',
  'CONCOR',
  'CROMPTON',
  'CUMMINSIND',
  'DLF',
  'DABUR',
  'DALBHARAT',
  'DELHIVERY',
  'DIVISLAB',
  'DIXON',
  'DRREDDY',
  'ETERNAL',
  'EICHERMOT',
  'EXIDEIND',
  'FORCEMOT',
  'NYKAA',
  'FORTIS',
  'GAIL',
  'GMRAIRPORT',
  'GLENMARK',
  'GODFRYPHLP',
  'GODREJCP',
  'GODREJPROP',
  'GRASIM',
  'HCLTECH',
  'HDFCAMC',
  'HDFCBANK',
  'HDFCLIFE',
  'HAVELLS',
  'HEROMOTOCO',
  'HINDALCO',
  'HAL',
  'HINDPETRO',
  'HINDUNILVR',
  'HINDZINC',
  'POWERINDIA',
  'HUDCO',
  'HYUNDAI',
  'ICICIBANK',
  'ICICIGI',
  'ICICIPRULI',
  'IDFCFIRSTB',
  'ITC',
  'INDIANB',
  'IEX',
  'IOC',
  'IRFC',
  'IREDA',
  'INDUSTOWER',
  'INDUSINDBK',
  'NAUKRI',
  'INFY',
  'INOXWIND',
  'INDIGO',
  'JINDALSTEL',
  'JSWENERGY',
  'JSWSTEEL',
  'JIOFIN',
  'JUBLFOOD',
  'KEI',
  'KPITTECH',
  'KALYANKJIL',
  'KAYNES',
  'KFINTECH',
  'KOTAKBANK',
  'LTF',
  'LICHSGFIN',
  'LTM',
  'LT',
  'LAURUSLABS',
  'LICI',
  'LODHA',
  'LUPIN',
  'M&M',
  'MANAPPURAM',
  'MANKIND',
  'MARICO',
  'MARUTI',
  'MFSL',
  'MAXHEALTH',
  'MAZDOCK',
  'MOTILALOFS',
  'MPHASIS',
  'MCX',
  'MUTHOOTFIN',
  'NBCC',
  'NHPC',
  'NMDC',
  'NTPC',
  'NATIONALUM',
  'NESTLEIND',
  'NAM-INDIA',
  'NUVAMA',
  'OBEROIRLTY',
  'ONGC',
  'OIL',
  'PAYTM',
  'OFSS',
  'POLICYBZR',
  'PGEL',
  'PIIND',
  'PNBHOUSING',
  'PAGEIND',
  'PATANJALI',
  'PERSISTENT',
  'PETRONET',
  'PIDILITIND',
  'PPLPHARMA',
  'POLYCAB',
  'PFC',
  'POWERGRID',
  'PREMIERENE',
  'PRESTIGE',
  'PNB',
  'RBLBANK',
  'RECLTD',
  'RVNL',
  'RELIANCE',
  'SBICARD',
  'SBILIFE',
  'SHREECEM',
  'SRF',
  'SAMMAANCAP',
  'MOTHERSON',
  'SHRIRAMFIN',
  'SIEMENS',
  'SOLARINDS',
  'SONACOMS',
  'SBIN',
  'SAIL',
  'SUNPHARMA',
  'SUPREMEIND',
  'SUZLON',
  'SWIGGY',
  'TATACONSUM',
  'TVSMOTOR',
  'TCS',
  'TATAELXSI',
  'TMPV',
  'TATAPOWER',
  'TATASTEEL',
  'TATATECH',
  'TECHM',
  'FEDERALBNK',
  'INDHOTEL',
  'PHOENIXLTD',
  'TITAN',
  'TORNTPHARM',
  'TORNTPOWER',
  'TRENT',
  'TIINDIA',
  'UNOMINDA',
  'UPL',
  'ULTRACEMCO',
  'UNIONBANK',
  'UNITDSPR',
  'VBL',
  'VEDL',
  'VMM',
  'IDEA',
  'VOLTAS',
  'WAAREEENER',
  'WIPRO',
  'YESBANK',
  'ZYDUSLIFE',
]);

const APPROVED_INDEX_UNDERLYINGS = Object.freeze([
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'GIFTNIFTY',
]);

const APPROVED_COMMODITY_UNDERLYINGS = Object.freeze([
  'GOLDM',
  'SILVERM',
  'CRUDEOIL',
  'COPPER',
  'NATURALGAS',
  'ALUMINIUM',
  'ZINC',
]);

const STOCK_SET = new Set(APPROVED_STOCK_UNDERLYINGS);
const INDEX_SET = new Set(APPROVED_INDEX_UNDERLYINGS);
const COMMODITY_SET = new Set(APPROVED_COMMODITY_UNDERLYINGS);
const ALL_APPROVED_UNDERLYINGS = Object.freeze([
  ...APPROVED_STOCK_UNDERLYINGS,
  ...APPROVED_INDEX_UNDERLYINGS,
  ...APPROVED_COMMODITY_UNDERLYINGS,
]);
const ALL_APPROVED_SET = new Set(ALL_APPROVED_UNDERLYINGS);
const APPROVED_ALIAS_SYMBOLS = Object.freeze(
  ALL_APPROVED_UNDERLYINGS.map((underlying) => `${underlying}-I`)
);
const APPROVED_ALIAS_SET = new Set(APPROVED_ALIAS_SYMBOLS);

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function isApprovedUnderlying(underlying) {
  return ALL_APPROVED_SET.has(normalizeSymbol(underlying));
}

function isApprovedAliasSymbol(symbol) {
  return APPROVED_ALIAS_SET.has(normalizeSymbol(symbol));
}

function getApprovedCategoryForUnderlying(underlying, exchange) {
  const normalizedUnderlying = normalizeSymbol(underlying);
  const normalizedExchange = normalizeSymbol(exchange);

  if (normalizedExchange === 'MCX' || COMMODITY_SET.has(normalizedUnderlying)) {
    return 'commodity_futures';
  }

  if (INDEX_SET.has(normalizedUnderlying)) {
    return 'index_futures';
  }

  return 'stock_futures';
}

function getApprovedUnderlyingFromInstrument(instrument) {
  const exchange = normalizeSymbol(instrument?.exchange);
  const underlying = normalizeSymbol(instrument?.name);
  const tradingSymbol = normalizeSymbol(instrument?.tradingsymbol);

  if (exchange === 'MCX') {
    const commodityCandidates = [
      underlying,
      tradingSymbol.replace(/\d{2}[A-Z]{3,4}FUT$/i, ''),
    ].map(normalizeSymbol);

    for (const candidate of commodityCandidates) {
      if (COMMODITY_SET.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  if (INDEX_SET.has(underlying) || STOCK_SET.has(underlying)) {
    return underlying;
  }

  return null;
}

function getApprovedAliasSymbolFromInstrument(instrument) {
  const underlying = getApprovedUnderlyingFromInstrument(instrument);
  return underlying ? `${underlying}-I` : null;
}

module.exports = {
  QUOTE_STALE_MS,
  APPROVED_STOCK_UNDERLYINGS,
  APPROVED_INDEX_UNDERLYINGS,
  APPROVED_COMMODITY_UNDERLYINGS,
  APPROVED_ALIAS_SYMBOLS,
  normalizeSymbol,
  isApprovedUnderlying,
  isApprovedAliasSymbol,
  getApprovedCategoryForUnderlying,
  getApprovedUnderlyingFromInstrument,
  getApprovedAliasSymbolFromInstrument,
};
