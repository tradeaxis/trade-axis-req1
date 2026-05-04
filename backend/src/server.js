// Handle uncaught errors — prevent server crash
process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('🚨 UNHANDLED REJECTION:', reason);
});

// backend/src/server.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const nodeCron   = require('node-cron');

const { testConnection, supabase } = require('./config/supabase');
const { dbQueue }                  = require('./config/dbQueue');   // ✅ MOVED TO TOP
const { protect, adminOnly, adminOrSubBroker } = require('./middleware/auth');

const authRoutes        = require('./routes/auth');
const adminRoutes       = require('./routes/admin');
const accountRoutes     = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const marketRoutes      = require('./routes/market');
const tradingRoutes     = require('./routes/trading');
const watchlistRoutes   = require('./routes/watchlists');
const webAdminRoutes    = require('./routes/webAdmin');

const SocketHandler       = require('./websocket/socketHandler');
const kiteService         = require('./services/kiteService');
const kiteStreamService   = require('./services/kiteStreamService');
const weeklySettlementService = require('./services/weeklySettlementService');

// ✅ ISSUE 1 FIXED: declare at top of module scope BEFORE any callbacks use it
let _keepAliveTimer = null;

const app    = express();
const server = http.createServer(app);
const isDev  = process.env.NODE_ENV === 'development';

/* =========================================================
   SOCKET.IO
   ========================================================= */

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

const socketHandler = new SocketHandler(io);

app.set('io', io);
app.set('socketHandler', socketHandler);

/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(helmet({ crossOriginResourcePolicy: false }));

// ✅ Open CORS for APK / Capacitor / WebView / browser testing
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

if (isDev) app.use(morgan('dev'));

/* =========================================================
   WEEKLY SETTLEMENT HELPERS
   ========================================================= */

const getLastSettlementTime = async () => {
  try {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'last_settlement_time')
      .single();
    return data?.value ? new Date(data.value) : null;
  } catch {
    return null;
  }
};

const saveSettlementTime = async (time = new Date()) => {
  try {
    await supabase
      .from('app_settings')
      .upsert(
        { key: 'last_settlement_time', value: time.toISOString(), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    console.log(`✅ Settlement time saved: ${time.toISOString()}`);
  } catch (err) {
    console.error('Failed to save settlement time:', err.message);
  }
};

const getLastSettlementTarget = () => {
  const now   = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist   = new Date(utcMs + 5.5 * 3600000);

  const daysAgo = (ist.getDay() + 1) % 7;
  const lastSat = new Date(ist);
  lastSat.setDate(lastSat.getDate() - daysAgo);
  lastSat.setHours(1, 0, 0, 0);

  return new Date(lastSat.getTime() - 5.5 * 3600000); // back to UTC
};

const isSettlementWindow = (date = new Date()) => {
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const ist   = new Date(utcMs + 5.5 * 3600000);

  return ist.getDay() === 6 && ist.getHours() === 1;
};

const shouldRunCatchupSettlement = async () => {
  if (!isSettlementWindow()) {
    console.log('ℹ️ Settlement catchup skipped: outside Saturday 01:00 IST window.');
    return false;
  }

  const lastRun = await getLastSettlementTime();
  const target  = getLastSettlementTarget();
  const now     = new Date();

  if (target > now) return false;

  if (!lastRun || lastRun < target) {
    console.log('📅 Settlement catchup needed:');
    console.log(`   Last run: ${lastRun ? lastRun.toISOString() : 'NEVER'}`);
    console.log(`   Target:   ${target.toISOString()}`);
    console.log(`   Now:      ${now.toISOString()}`);
    return true;
  }
  return false;
};

let settlementRunPromise = null;

const runSettlementSafe = async (trigger = 'cron') => {
  const manualTrigger = trigger === 'manual' || String(trigger).startsWith('web-');
  if (!manualTrigger && !isSettlementWindow()) {
    console.log(`ℹ️ Weekly settlement skipped (${trigger}): outside Saturday 01:00 IST window.`);
    return {
      success: true,
      skipped: true,
      message: 'Automatic settlement runs only on Saturday between 01:00 and 01:59 IST.',
      settled: 0,
      totalWeeklyPnL: 0,
      accounts: 0,
    };
  }

  const target = getLastSettlementTarget();
  const lastRun = await getLastSettlementTime();

  if (lastRun && lastRun >= target) {
    console.log(`ℹ️ Weekly settlement already completed for target ${target.toISOString()}`);
    return {
      success: true,
      skipped: true,
      message: 'Settlement already completed for the current Saturday window.',
      settled: 0,
      totalWeeklyPnL: 0,
      accounts: 0,
    };
  }

  if (settlementRunPromise) {
    console.log('ℹ️ Weekly settlement already running — skipping duplicate trigger');
    return {
      success: true,
      skipped: true,
      message: 'Settlement is already running.',
      settled: 0,
      totalWeeklyPnL: 0,
      accounts: 0,
    };
  }

  settlementRunPromise = (async () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🧾 WEEKLY SETTLEMENT TRIGGERED (${trigger})`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════');

  try {
    const result = await weeklySettlementService.runSettlement();

    if (result.success) {
      await saveSettlementTime();
      console.log('✅ Settlement completed successfully');
      io.emit('settlement:complete', {
        success: true,
        settled: result.settled,
        totalWeeklyPnL: result.totalWeeklyPnL,
        accounts: result.accounts,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error('❌ Settlement failed:', result.message);
      io.emit('settlement:failed', {
        success: false,
        message: result.message,
        timestamp: new Date().toISOString(),
      });
    }
    return result;
  } catch (err) {
    console.error('❌ Settlement error:', err.message);
    console.error(err.stack);
    io.emit('settlement:failed', {
      success: false,
      message: err.message,
      timestamp: new Date().toISOString(),
    });
    return { success: false, message: err.message };
  } finally {
    settlementRunPromise = null;
  }
  })();

  return settlementRunPromise;
};

/* =========================================================
   ROUTES
   ========================================================= */

app.use('/api/auth',         authRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/accounts',     accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/market',       marketRoutes);
app.use('/api/trading',      tradingRoutes);
app.use('/api/watchlists',   watchlistRoutes);
app.use('/api/web-admin',    webAdminRoutes);

// ✅ Manual settlement trigger (admin only)
app.post('/api/admin/trigger-settlement', protect, adminOnly, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

    console.log('🔧 Manual settlement trigger requested');
    const result = await runSettlementSafe('manual');
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ Settlement status endpoint
app.get('/api/admin/settlement-status', protect, adminOnly, async (req, res) => {
  try {
    const lastRun    = await getLastSettlementTime();
    const nextTarget = getLastSettlementTarget();
    const now        = new Date();
    const nextSat    = new Date(nextTarget);
    if (nextSat <= now) nextSat.setDate(nextSat.getDate() + 7);

    res.json({
      success:        true,
      lastRun:        lastRun ? lastRun.toISOString() : null,
      nextScheduled:  nextSat.toISOString(),
      cronExpression: process.env.SETTLEMENT_CRON || '0 1 * * 6',
      timezone:       process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/web-admin/trigger-settlement', protect, adminOrSubBroker, async (req, res) => {
  try {
    const result = await runSettlementSafe(`web-${req.user.role}`);
    res.json(result);
  } catch (err) {
    console.error('Web settlement trigger error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/web-admin/settlement-status', protect, adminOrSubBroker, async (req, res) => {
  try {
    const lastRun = await getLastSettlementTime();
    const nextScheduled = getLastSettlementTarget();
    res.json({
      success: true,
      lastRun: lastRun ? lastRun.toISOString() : null,
      nextScheduled: nextScheduled.toISOString(),
      timezone: 'Asia/Kolkata',
      cronExpression: 'Saturday 01:00 IST',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ ISSUE 3 FIXED: dbQueue required at top, used directly here
app.get('/health', async (req, res) => {
  const dbConnected    = await testConnection();   // cached 30s in supabase.js
  const lastSettlement = await getLastSettlementTime();

  res.json({
    success:          true,
    message:          'Trade Axis API',
    database:         dbConnected ? 'connected' : 'disconnected',
    websocket:        'active',
    connectedClients: io.engine.clientsCount,
    kite:             kiteStreamService.status(),
    dbQueue:          dbQueue.getStats(),          // ✅ no require() inside handler
    lastSettlement:   lastSettlement ? lastSettlement.toISOString() : 'never',
    timestamp:        new Date().toISOString(),
  });
});

app.get('/api/version', (req, res) => {
  res.json({ version: '1.0.0', minVersion: '1.0.0' });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Trade Axis API v1.0',
    endpoints: {
      auth: '/api/auth', admin: '/api/admin', accounts: '/api/accounts',
      transactions: '/api/transactions', market: '/api/market',
      trading: '/api/trading', watchlists: '/api/watchlists',
    },
    cors: 'open',
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Express error:', err.message);
  if (isDev && err.stack) console.error(err.stack);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

/* =========================================================
   SERVER START
   ========================================================= */

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('⚠️ Database connection failed at startup');
    console.error('⚠️ Starting server in degraded mode');
  }

  server.listen(PORT, '0.0.0.0', async () => {
    console.log('');
    console.log('🚀 ══════════════════════════════════════════════════════════');
    console.log('   TRADE AXIS SERVER (HTTP + WebSocket)');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`   📍 HTTP: http://0.0.0.0:${PORT}`);
    console.log(`   ⚡ WS : ws://0.0.0.0:${PORT}`);
    console.log(`   🌍 ENV: ${process.env.NODE_ENV}`);
    console.log('   ✅ CORS: open (origin: true)');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');

    // ✅ ISSUE 1 FIXED: _keepAliveTimer declared at top of file, safe to assign here
    _keepAliveTimer = setInterval(async () => {
      try {
        await supabase.from('app_settings').select('key').limit(1);
      } catch {
        // silence — keep-alive ping, not critical
      }
    }, 4 * 60 * 1000); // every 4 minutes

    if (_keepAliveTimer.unref) _keepAliveTimer.unref();
    console.log('🏓 DB keep-alive ping started (every 4 minutes)');

    if (!dbConnected) {
      console.warn('⚠️ Skipping DB-dependent startup jobs until database is healthy.');
      return;
    }

    // ✅ CATCHUP SETTLEMENT
    const needsCatchup = await shouldRunCatchupSettlement();
    if (needsCatchup) {
      console.log('🔄 Running catchup settlement (missed scheduled run)...');
      setTimeout(() => runSettlementSafe('catchup'), 10000);
    } else {
      const lastRun = await getLastSettlementTime();
      console.log(`✅ Settlement up to date. Last run: ${lastRun ? lastRun.toISOString() : 'never'}`);
    }

    // ✅ SCHEDULED SETTLEMENT - Saturday 1:00 AM IST
    const cronExpr = process.env.SETTLEMENT_CRON     || '0 1 * * 6';
    const tz       = process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata';

    nodeCron.schedule(cronExpr, async () => { await runSettlementSafe('cron'); }, { timezone: tz });
    console.log(`⏰ Weekly settlement scheduled: "${cronExpr}" (${tz})`);
    console.log(`   Manual trigger: POST /api/admin/trigger-settlement`);
    console.log(`   Status check:   GET  /api/admin/settlement-status`);

    // ── AUTO-DELETE expired Kite token at 6:05 AM IST daily ──────────────────
    nodeCron.schedule(
      '5 6 * * *',
      async () => {
        console.log('🗑️ Auto-deleting expired Kite access token...');
        try {
          await supabase
            .from('app_settings')
            .update({ value: '', updated_at: new Date().toISOString() })
            .eq('key', 'kite_access_token');

          kiteService.accessToken  = null;
          kiteService.initialized  = false;
          await kiteStreamService.stop();

          console.log('✅ Expired token deleted.');
          io.emit('kite:session:expired', {
            message:   'Daily token expired. Admin must re-authenticate before market opens.',
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error('❌ Token cleanup error:', err.message);
        }
      },
      { timezone: tz }
    );
    console.log('🗑️ Daily token cleanup scheduled: 6:05 AM IST');

    // ── AUTO-DELETE old data older than 3 months ──────────────────────────────
    nodeCron.schedule(
      '0 2 * * 0',
      async () => {
        console.log('🧹 Running 3-month data cleanup...');
        try {
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
          const cutoff = threeMonthsAgo.toISOString();

          const { data: deletedTrades, error: tradeErr } = await supabase
            .from('trades').delete().eq('status', 'closed').lt('close_time', cutoff).select('id');
          if (tradeErr) console.error('❌ Trade cleanup error:', tradeErr.message);
          else console.log(`🧹 Deleted ${deletedTrades?.length || 0} closed trades`);

          const { data: deletedTxns, error: txnErr } = await supabase
            .from('transactions').delete()
            .in('status', ['completed', 'rejected']).lt('created_at', cutoff).select('id');
          if (txnErr) console.error('❌ Transaction cleanup error:', txnErr.message);
          else console.log(`🧹 Deleted ${deletedTxns?.length || 0} old transactions`);

          try {
            const { data: deletedSettlements } = await supabase
              .from('weekly_settlements').delete().lt('created_at', cutoff).select('id');
            console.log(`🧹 Deleted ${deletedSettlements?.length || 0} old settlement records`);
          } catch (e) { /* table may not exist */ }

          console.log('✅ 3-month data cleanup complete');
        } catch (err) {
          console.error('❌ Data cleanup error:', err.message);
        }
      },
      { timezone: tz }
    );
    console.log('🧹 3-month data cleanup scheduled: Sunday 2:00 AM IST');

    // ── Self-ping ─────────────────────────────────────────────────────────────
    const selfUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : process.env.RENDER_EXTERNAL_URL || '';

    if (selfUrl) {
      setInterval(() => {
        fetch(`${selfUrl}/health`)
          .then(() => console.log('🏓 Self-ping OK'))
          .catch(() => {});
      }, 14 * 60 * 1000);
      console.log(`🏓 Self-ping enabled: ${selfUrl}/health`);
    }

    // ── Kite auto-start ───────────────────────────────────────────────────────
    if (String(process.env.KITE_AUTO_START || 'true') === 'true') {
      try {
        await kiteService.init(true);

        if (kiteService.isSessionReady()) {
          let sessionValid = false;
          try {
            const kc = kiteService.getKiteInstance();
            if (kc) {
              await kc.getProfile();
              sessionValid = true;
              console.log('✅ Kite session validated — token is active');
            }
          } catch (profileErr) {
            console.warn('⚠️ Kite session expired/invalid:', profileErr.message);
            try {
              await supabase
                .from('app_settings')
                .update({ value: '', updated_at: new Date().toISOString() })
                .eq('key', 'kite_access_token');
              kiteService.accessToken = null;
              kiteService.initialized = false;
              console.log('🗑️ Expired token deleted from DB');
            } catch (delErr) {
              console.warn('Could not delete expired token:', delErr.message);
            }
          }

          if (sessionValid) {
            const result = await kiteStreamService.start(io);
            console.log('✅ Kite stream auto-start result:', result);
            try {
              const { syncKiteInstruments } = require('./utils/syncKiteInstruments');
              const syncResult = await syncKiteInstruments();
              if (syncResult.success && syncResult.upserted > 0) {
                console.log(`📊 Auto-synced ${syncResult.upserted} new instruments`);
                await kiteStreamService.refreshSubscriptions();
                console.log('🔄 Stream refreshed with new tokens');
              } else {
                console.log('📊 All instruments already in sync');
              }
            } catch (syncErr) {
              console.warn('⚠️ Auto instrument sync failed:', syncErr.message);
            }
          }
        } else {
          console.log('ℹ️ Kite session not ready. Admin must create session daily.');
        }
      } catch (e) {
        console.log('ℹ️ Kite stream not started:', e.message);
      }
    }

    // ── Market holiday refresh ────────────────────────────────────────────────
    try {
      const { startHolidayRefresh } = require('./services/marketStatus');
      startHolidayRefresh();
      console.log('📅 Market holiday auto-refresh started');
    } catch (holidayErr) {
      console.warn('⚠️ Holiday refresh failed:', holidayErr.message);
    }
  });
};

/* =========================================================
   GRACEFUL SHUTDOWN
   ========================================================= */

// ✅ ISSUE 2 FIXED: both SIGTERM and SIGINT clear _keepAliveTimer

const gracefulShutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully`);

  // Stop keep-alive first so no new DB pings fire during shutdown
  if (_keepAliveTimer) {
    clearInterval(_keepAliveTimer);
    _keepAliveTimer = null;
    console.log('🏓 Keep-alive timer cleared');
  }

  socketHandler.stop?.();

  try {
    await kiteStreamService.stop();
  } catch {}

  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });

  // Force exit after 15s if graceful close hangs
  setTimeout(() => {
    console.error('⚠️ Forced exit after 15s timeout');
    process.exit(1);
  }, 15000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // ✅ ADDED — was missing
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // ✅ FIXED — now clears timer

startServer();
