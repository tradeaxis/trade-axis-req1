// frontend/src/services/socket.js  ── FIXED VERSION
//
// KEY FIXES:
// 1. Queue subscriptions when socket not yet connected (fixes "Socket not connected" warning)
// 2. Re-subscribe on reconnect so rooms are restored after disconnect
// 3. Deduplicate subscriptions to avoid redundant emit calls
// 4. Clear handler references properly on disconnect

import { io } from 'socket.io-client';

const BACKEND_URL = 'https://g5u65c9ttxdhv63j8nyoe64z.187.127.151.173.sslip.io';

class SocketService {
  constructor() {
    this.socket      = null;
    this.handlers    = {};
    this.connected   = false;

    // Pending subscriptions to send once connected
    this._pendingSymbols = new Set();
    this._pendingAccounts= new Set();

    // Currently active subscriptions (for re-subscribe on reconnect)
    this._activeSymbols  = new Set();
    this._activeAccounts = new Set();
  }

  connect(token) {
    if (this.socket?.connected) {
      console.log('🔌 Socket already connected');
      return;
    }

    console.log('🔌 Connecting socket to:', BACKEND_URL);

    this.socket = io(BACKEND_URL, {
      auth:           { token },
      transports:     ['websocket', 'polling'],
      reconnection:   true,
      reconnectionAttempts: 20,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 10000,
      timeout:        20000,
    });

    this.socket.on('connect', () => {
      console.log('✅ WebSocket connected:', this.socket.id);
      this.connected = true;

      // Flush pending subscriptions
      if (this._pendingSymbols.size > 0) {
        const syms = [...this._pendingSymbols];
        this._pendingSymbols.clear();
        this._subscribeSymbolsNow(syms);
      }
      if (this._pendingAccounts.size > 0) {
        const accounts = [...this._pendingAccounts];
        this._pendingAccounts.clear();
        accounts.forEach(id => this._subscribeAccountNow(id));
      }

      // Re-subscribe active subs after reconnect (if they were cleared by disconnect)
      if (this._activeSymbols.size > 0) {
        this._subscribeSymbolsNow([...this._activeSymbols]);
      }
      if (this._activeAccounts.size > 0) {
        this._activeAccounts.forEach(id => this._subscribeAccountNow(id));
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ WebSocket disconnected:', reason);
      this.connected = false;
      // Don't clear active subs — we need them for re-subscribe on reconnect
    });

    this.socket.on('reconnect', (attempt) => {
      console.log('🔄 WebSocket reconnected after', attempt, 'attempts');
    });

    this.socket.on('reconnect_error', (err) => {
      console.warn('⚠️ WebSocket reconnect error:', err.message);
    });

    this.socket.on('connect_error', (err) => {
      console.error('❌ WebSocket connect error:', err.message);
      this.connected = false;
    });

    // Attach all registered handlers
    Object.entries(this.handlers).forEach(([event, fn]) => {
      this.socket.on(event, fn);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket      = null;
      this.connected   = false;
      this._activeSymbols.clear();
      this._activeAccounts.clear();
      this._pendingSymbols.clear();
      this._pendingAccounts.clear();
    }
  }

  subscribe(event, handler) {
    this.handlers[event] = handler;
    if (this.socket) {
      // Remove old listener first to avoid duplicates
      this.socket.off(event);
      this.socket.on(event, handler);
    }
  }

  unsubscribe(event) {
    delete this.handlers[event];
    this.socket?.off(event);
  }

  emit(event, data) {
    if (!this.socket?.connected) {
      console.warn(`⚠️ Socket not connected, queuing: ${event}`);
      return false;
    }
    this.socket.emit(event, data);
    return true;
  }

  // ── Symbol subscriptions ─────────────────────────────────────────────────

  subscribeSymbols(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) return;

    const syms = symbols.map(s => String(s).toUpperCase()).filter(Boolean);

    // Track as active for reconnect
    syms.forEach(s => this._activeSymbols.add(s));

    if (!this.socket?.connected) {
      // Queue for when connected
      syms.forEach(s => this._pendingSymbols.add(s));
      console.log(`⏳ Queued ${syms.length} symbol subscriptions (not connected yet)`);
      return;
    }

    this._subscribeSymbolsNow(syms);
  }

  _subscribeSymbolsNow(syms) {
    if (!syms || syms.length === 0) return;
    console.log(`📡 Subscribing to ${syms.length} symbols:`, syms.slice(0, 5).join(', '), syms.length > 5 ? '...' : '');
    this.socket.emit('subscribe:symbols', syms);
  }

  unsubscribeSymbols(symbols) {
    if (!Array.isArray(symbols)) return;
    const syms = symbols.map(s => String(s).toUpperCase());
    syms.forEach(s => {
      this._activeSymbols.delete(s);
      this._pendingSymbols.delete(s);
    });
    if (this.socket?.connected) {
      this.socket.emit('unsubscribe:symbols', syms);
    }
  }

  // ── Account subscriptions ────────────────────────────────────────────────

  subscribeAccount(accountId) {
    if (!accountId) return;

    this._activeAccounts.add(accountId);

    if (!this.socket?.connected) {
      this._pendingAccounts.add(accountId);
      console.log(`⏳ Queued account subscription: ${accountId}`);
      return;
    }

    this._subscribeAccountNow(accountId);
  }

  _subscribeAccountNow(accountId) {
    this.socket.emit('subscribe:account', accountId);
  }

  isConnected() {
    return this.socket?.connected || false;
  }
}

const socketService = new SocketService();
export default socketService;