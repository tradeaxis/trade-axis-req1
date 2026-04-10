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

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// ── Retry wrapper for flaky connections ──
const withRetry = async (operation, maxRetries = 3, delayMs = 1000) => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      
      // Check for connection pool errors
      if (result?.error?.code === 'PGRST003') {
        throw new Error('Connection pool exhausted');
      }
      
      return result;
    } catch (error) {
      lastError = error;
      const isRetryable =
        error.message?.includes('timeout') ||
        error.message?.includes('upstream connect') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT') ||
        error.message?.includes('Connection pool') ||
        error.message?.includes('PGRST003');

      if (isRetryable && attempt < maxRetries) {
        const waitTime = delayMs * attempt * (1 + Math.random() * 0.5); // Add jitter
        console.warn(`⚠️ DB attempt ${attempt}/${maxRetries} failed. Retrying in ${Math.round(waitTime)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

// ── Test connection (non-blocking) ──
const testConnection = async () => {
  try {
    const { error } = await supabase.from('symbols').select('symbol').limit(1);
    if (error) throw error;
    console.log('✅ Supabase connection verified');
    return true;
  } catch (error) {
    console.error('❌ Supabase connection error:', error.message);
    return false;
  }
};

module.exports = { supabase, testConnection, withRetry };