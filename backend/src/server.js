// backend/src/server.js
const path = require('path');

// IMPORTANT: Load .env first, with an explicit path
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

// Imports (after dotenv)
const { testConnection } = require('./config/supabase');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin'); // ✅ ADD
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const marketRoutes = require('./routes/market');
const tradingRoutes = require('./routes/trading');
const watchlistRoutes = require('./routes/watchlists');

const SocketHandler = require('./websocket/socketHandler');

const app = express();
const server = http.createServer(app);

const isDev = process.env.NODE_ENV === 'development';

// CORS: in dev allow all origins (reflect origin). In prod allow FRONTEND_URL only.
const corsOptions = {
  origin: (origin, cb) => {
    if (isDev) return cb(null, true);
    const allowed = [process.env.FRONTEND_URL].filter(Boolean);
    if (!origin || allowed.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (isDev) return cb(null, true);
      const allowed = [process.env.FRONTEND_URL].filter(Boolean);
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Initialize WebSocket handler
const socketHandler = new SocketHandler(io);

// Make io accessible to routes (optional)
app.set('io', io);
app.set('socketHandler', socketHandler);

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(compression());

if (isDev) app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes); // ✅ ADD
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/trading', tradingRoutes);
app.use('/api/watchlists', watchlistRoutes);

// Health check
app.get('/health', async (req, res) => {
  const dbConnected = await testConnection();
  res.json({
    success: true,
    message: 'Trade Axis API',
    database: dbConnected ? 'connected' : 'disconnected',
    websocket: 'active',
    connectedClients: io.engine.clientsCount,
    timestamp: new Date().toISOString(),
  });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: 'Trade Axis API v1.0',
    endpoints: {
      auth: '/api/auth',
      admin: '/api/admin', // ✅ ADD
      accounts: '/api/accounts',
      transactions: '/api/transactions',
      market: '/api/market',
      trading: '/api/trading',
      watchlists: '/api/watchlists',
    },
  });
});

// 404
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error' });
});

// Start
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error('❌ Database connection failed');
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log('');
    console.log('🚀 ══════════════════════════════════════════════════════════');
    console.log('   TRADE AXIS SERVER (HTTP + WebSocket)');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`   📍 HTTP: http://localhost:${PORT}`);
    console.log(`   ⚡ WS : ws://localhost:${PORT}`);
    console.log(`   🌍 ENV: ${process.env.NODE_ENV}`);
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');
  });
};

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  socketHandler.stop?.();
  server.close(() => process.exit(0));
});

startServer();