// backend/src/config/supabase.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('   SUPABASE_URL:', supabaseUrl ? 'SET' : 'NOT SET');
  console.error('   SUPABASE_SERVICE_KEY:', supabaseKey ? 'SET' : 'NOT SET');
  process.exit(1);
}

// ─── Single singleton client ─────────────────────────────────────────────────
// Pro plan: 120 direct connections, 10k pooled via PgBouncer
// We still use a singleton — no need to create multiple clients
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken:  false,
    persistSession:    false,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-application-name': 'trade-axis-backend' },
    fetch: (url, options = {}) => {
      const controller = new AbortController();
      // Pro plan is faster — 20s timeout is enough
      const id = setTimeout(() => controller.abort(), 20000);
      return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(id));
    },
  },
  db: {
    schema: 'public',
  },
  realtime: {
    params: { eventsPerSecond: 10 }, // Pro allows more realtime events
  },
});

// ─── Retry wrapper ───────────────────────────────────────────────────────────
const RETRYABLE = [
  'timeout',
  'upstream connect',
  'ECONNRESET',
  'ETIMEDOUT',
  'Connection pool',
  'PGRST003',
  'fetch failed',
  'AbortError',
];

const withRetry = async (operation, maxRetries = 3, baseDelayMs = 500) => {
  // Pro plan: shorter base delay since infra is more reliable
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();

      if (result?.error?.code === 'PGRST003') {
        const err  = new Error('Connection pool exhausted (PGRST003)');
        err.code   = 'PGRST003';
        throw err;
      }

      return result;
    } catch (error) {
      lastError = error;

      const isRetryable = RETRYABLE.some(
        (keyword) =>
          error.message?.includes(keyword) ||
          error.code === 'PGRST003'
      );

      if (!isRetryable || attempt >= maxRetries) throw error;

      // Shorter backoff on Pro — infra recovers faster
      const wait = baseDelayMs * Math.pow(2, attempt - 1) * (1 + Math.random() * 0.2);
      console.warn(
        `⚠️  DB attempt ${attempt}/${maxRetries} failed ` +
        `(${error.code || error.message}). Retrying in ${Math.round(wait)}ms…`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError;
};

// ─── Health check — cached 30s ───────────────────────────────────────────────
// Pro plan never auto-pauses so this is mostly for monitoring
let _healthCache = { ok: false, checkedAt: 0 };

const testConnection = async (forceRefresh = false) => {
  const now       = Date.now();
  const CACHE_TTL = 30_000; // 30 seconds

  if (!forceRefresh && now - _healthCache.checkedAt < CACHE_TTL) {
    return _healthCache.ok;
  }

  try {
    const { error } = await supabase
      .from('symbols')
      .select('symbol')
      .limit(1);

    const ok         = !error || error.code === 'PGRST116';
    _healthCache     = { ok, checkedAt: now };

    if (ok) console.log('✅ Supabase connection verified');
    else    console.error('❌ Supabase connection error:', error?.message);

    return ok;
  } catch (error) {
    console.error('❌ Supabase connection error:', error.message);
    _healthCache = { ok: false, checkedAt: now };
    return false;
  }
};

module.exports = { supabase, testConnection, withRetry };