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

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const nodeCron = require('node-cron');

const { testConnection, supabase } = require('./config/supabase');
const { protect, adminOnly } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const marketRoutes = require('./routes/market');
const tradingRoutes = require('./routes/trading');
const watchlistRoutes = require('./routes/watchlists');

const SocketHandler = require('./websocket/socketHandler');

const kiteService = require('./services/kiteService');
const kiteStreamService = require('./services/kiteStreamService');
const weeklySettlementService = require('./services/weeklySettlementService');

const app = express();
const server = http.createServer(app);

const isDev = process.env.NODE_ENV === 'development';

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

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

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

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

if (isDev) {
  app.use(morgan('dev'));
}

/* =========================================================
   WEEKLY SETTLEMENT HELPERS
   ========================================================= */

// ✅ Get last settlement time from DB
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

// ✅ Save settlement time to DB
const saveSettlementTime = async (time = new Date()) => {
  try {
    await supabase
      .from('app_settings')
      .upsert({
        key: 'last_settlement_time',
        value: time.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    
    console.log(`✅ Settlement time saved: ${time.toISOString()}`);
  } catch (err) {
    console.error('Failed to save settlement time:', err.message);
  }
};

// ✅ Get last Saturday 1:00 AM IST
const getLastSettlementTarget = () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const ist = new Date(utcMs + 5.5 * 3600000);
  
  let targetDay = ist.getDay(); // 0=Sun, 6=Sat
  let daysAgo = (targetDay + 1) % 7; // Days since last Saturday
  
  const lastSat = new Date(ist);
  lastSat.setDate(lastSat.getDate() - daysAgo);
  lastSat.setHours(1, 0, 0, 0); // 1:00 AM IST
  
  // Convert back to UTC for storage
  const utcTarget = new Date(lastSat.getTime() - 5.5 * 3600000);
  return utcTarget;
};

// ✅ Check if we missed this week's settlement
const shouldRunCatchupSettlement = async () => {
  const lastRun = await getLastSettlementTime();
  const target = getLastSettlementTarget();
  const now = new Date();
  
  // If target is in the future, no catchup needed
  if (target > now) return false;
  
  // If never run OR last run was before this week's target
  if (!lastRun || lastRun < target) {
    console.log('📅 Settlement catchup needed:');
    console.log(`   Last run: ${lastRun ? lastRun.toISOString() : 'NEVER'}`);
    console.log(`   Target:   ${target.toISOString()}`);
    console.log(`   Now:      ${now.toISOString()}`);
    return true;
  }
  
  return false;
};

// ✅ Run settlement with error handling and logging
const runSettlementSafe = async (trigger = 'cron') => {
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
      
      // Notify all connected admins
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
  }
};

/* =========================================================
   ROUTES
   ========================================================= */

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/watchlists', watchlistRoutes);

// ✅ Manual settlement trigger (admin only)
app.post('/api/admin/trigger-settlement', protect, adminOnly, async (req, res) => {
  try {
    // Basic auth check (you should add proper admin middleware)
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
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
    const lastRun = await getLastSettlementTime();
    const nextTarget = getLastSettlementTarget();
    
    // Calculate next Saturday 1 AM
    const now = new Date();
    const nextSat = new Date(nextTarget);
    if (nextSat <= now) {
      nextSat.setDate(nextSat.getDate() + 7);
    }
    
    res.json({
      success: true,
      lastRun: lastRun ? lastRun.toISOString() : null,
      nextScheduled: nextSat.toISOString(),
      cronExpression: process.env.SETTLEMENT_CRON || '0 1 * * 6',
      timezone: process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  const lastSettlement = await getLastSettlementTime();

  res.json({
    success: true,
    message: 'Trade Axis API',
    database: dbConnected ? 'connected' : 'disconnected',
    websocket: 'active',
    connectedClients: io.engine.clientsCount,
    kite: kiteStreamService.status(),
    lastSettlement: lastSettlement ? lastSettlement.toISOString() : 'never',
    timestamp: new Date().toISOString(),
  });
});

// Version check
app.get('/api/version', (req, res) => {
  res.json({
    version: '1.0.0',
    minVersion: '1.0.0',
  });
});

app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Trade Axis API v1.0',
    endpoints: {
      auth: '/api/auth',
      admin: '/api/admin',
      accounts: '/api/accounts',
      transactions: '/api/transactions',
      market: '/api/market',
      trading: '/api/trading',
      watchlists: '/api/watchlists',
    },
    cors: 'open',
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('🔥 Express error:', err.message);
  if (isDev && err.stack) {
    console.error(err.stack);
  }

  res.status(500).json({
    success: false,
    message: err.message || 'Server error',
  });
});

/* =========================================================
   SERVER START
   ========================================================= */

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('❌ Database connection failed');
    process.exit(1);
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

    // ✅ CATCHUP SETTLEMENT - Run immediately if we missed Saturday 1 AM
    const needsCatchup = await shouldRunCatchupSettlement();
    if (needsCatchup) {
      console.log('🔄 Running catchup settlement (missed scheduled run)...');
      setTimeout(() => {
        runSettlementSafe('catchup');
      }, 10000); // Wait 10s after startup
    } else {
      const lastRun = await getLastSettlementTime();
      console.log(`✅ Settlement up to date. Last run: ${lastRun ? lastRun.toISOString() : 'never'}`);
    }

    // ✅ SCHEDULED SETTLEMENT - Saturday 1:00 AM IST
    const cronExpr = process.env.SETTLEMENT_CRON || '0 1 * * 6';
    const tz = process.env.SETTLEMENT_TIMEZONE || 'Asia/Kolkata';

    nodeCron.schedule(
      cronExpr,
      async () => {
        await runSettlementSafe('cron');
      },
      { timezone: tz }
    );

    console.log(`⏰ Weekly settlement scheduled: "${cronExpr}" (${tz})`);
    console.log(`   Manual trigger: POST /api/admin/trigger-settlement`);
    console.log(`   Status check:   GET  /api/admin/settlement-status`);

    // ── AUTO-DELETE expired Kite token at 6:05 AM IST daily ─────────
    nodeCron.schedule(
      '5 6 * * *',
      async () => {
        console.log('🗑️ Auto-deleting expired Kite access token...');
        try {
          await supabase
            .from('app_settings')
            .update({ value: '', updated_at: new Date().toISOString() })
            .eq('key', 'kite_access_token');

          kiteService.accessToken = null;
          kiteService.initialized = false;

          await kiteStreamService.stop();

          console.log('✅ Expired token deleted. Admin must create new session before market opens.');

          io.emit('kite:session:expired', {
            message: 'Daily token expired. Admin must re-authenticate before market opens.',
            timestamp: Date.now(),
          });
        } catch (err) {
          console.error('❌ Token cleanup error:', err.message);
        }
      },
      { timezone: tz }
    );

    console.log('🗑️ Daily token cleanup scheduled: 6:05 AM IST');

    // ── AUTO-DELETE old trades/transactions older than 3 months ──────
    nodeCron.schedule(
      '0 2 * * 0',
      async () => {
        console.log('🧹 Running 3-month data cleanup...');
        try {
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
          const cutoff = threeMonthsAgo.toISOString();

          const { data: deletedTrades, error: tradeErr } = await supabase
            .from('trades')
            .delete()
            .eq('status', 'closed')
            .lt('close_time', cutoff)
            .select('id');

          if (tradeErr) {
            console.error('❌ Trade cleanup error:', tradeErr.message);
          } else {
            console.log(`🧹 Deleted ${deletedTrades?.length || 0} closed trades older than 3 months`);
          }

          const { data: deletedTxns, error: txnErr } = await supabase
            .from('transactions')
            .delete()
            .in('status', ['completed', 'rejected'])
            .lt('created_at', cutoff)
            .select('id');

          if (txnErr) {
            console.error('❌ Transaction cleanup error:', txnErr.message);
          } else {
            console.log(`🧹 Deleted ${deletedTxns?.length || 0} old transactions`);
          }

          try {
            const { data: deletedSettlements } = await supabase
              .from('weekly_settlements')
              .delete()
              .lt('created_at', cutoff)
              .select('id');
            console.log(`🧹 Deleted ${deletedSettlements?.length || 0} old settlement records`);
          } catch (e) {
            // table may not exist
          }

          console.log('✅ 3-month data cleanup complete');
        } catch (err) {
          console.error('❌ Data cleanup error:', err.message);
        }
      },
      { timezone: tz }
    );

    console.log('🧹 3-month data cleanup scheduled: Sunday 2:00 AM IST');

    // Self-ping for platforms that sleep
    const selfUrl =
      process.env.RAILWAY_PUBLIC_DOMAIN
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

    // Kite auto-start
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
            console.warn('⚠️ Stream NOT started. Admin must create new session from Admin Panel.');

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

    // ✅ Auto-refresh market holidays from Kite
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
   SHUTDOWN
   ========================================================= */

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  socketHandler.stop?.();
  try {
    await kiteStreamService.stop();
  } catch {}
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  socketHandler.stop?.();
  try {
    await kiteStreamService.stop();
  } catch {}
  server.close(() => process.exit(0));
});

startServer();
