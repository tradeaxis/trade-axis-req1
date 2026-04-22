const normalizeSymbolKey = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const stripSeriesAndExpiry = (value) => {
  let raw = String(value || '').toUpperCase().trim();

  raw = raw.replace(/-[IVX]+$/i, '');
  raw = raw.replace(/\d{2}[A-Z]{3}FUT$/i, '');
  raw = raw.replace(/FUT$/i, '');

  return normalizeSymbolKey(raw);
};

const STOCK_UNDERLYINGS = [
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
];

const INDEX_UNDERLYINGS = [
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'FINANCENIFTY',
  'GIFTNIFTY',
];

const COMMODITY_PREFIXES = [
  'GOLDM',
  'GOLDMINI',
  'SILVERM',
  'SILVERMINI',
  'SILVERMIC',
  'CRUDEOIL',
  'COPPER',
  'NATURALGAS',
  'ALUMINI',
  'ALUMINIUM',
  'ZINC',
];

const ALLOWED_EXACT_KEYS = new Set(
  [...STOCK_UNDERLYINGS, ...INDEX_UNDERLYINGS].map(normalizeSymbolKey),
);

const ALLOWED_PREFIX_KEYS = COMMODITY_PREFIXES.map(normalizeSymbolKey);

const getCandidateKeys = (...values) => {
  const keys = new Set();

  values.flat().forEach((value) => {
    if (!value) return;

    const normalized = normalizeSymbolKey(value);
    const stripped = stripSeriesAndExpiry(value);

    if (normalized) keys.add(normalized);
    if (stripped) keys.add(stripped);
  });

  return [...keys];
};

const isAllowedKey = (key) => {
  if (!key) return false;
  if (ALLOWED_EXACT_KEYS.has(key)) return true;
  return ALLOWED_PREFIX_KEYS.some((prefix) => key.startsWith(prefix));
};

const isAllowedSymbolCandidate = (value) =>
  getCandidateKeys(value).some(isAllowedKey);

const isAllowedKiteInstrument = (instrument) =>
  getCandidateKeys(
    instrument?.name,
    instrument?.tradingsymbol,
    instrument?.display_name,
  ).some(isAllowedKey);

const isAllowedSymbolRow = (row) =>
  getCandidateKeys(
    row?.underlying,
    row?.symbol,
    row?.kite_tradingsymbol,
    row?.display_name,
  ).some(isAllowedKey);

module.exports = {
  STOCK_UNDERLYINGS,
  INDEX_UNDERLYINGS,
  COMMODITY_PREFIXES,
  normalizeSymbolKey,
  stripSeriesAndExpiry,
  getCandidateKeys,
  isAllowedKey,
  isAllowedSymbolCandidate,
  isAllowedKiteInstrument,
  isAllowedSymbolRow,
};
