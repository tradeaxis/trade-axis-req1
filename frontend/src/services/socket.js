// frontend/src/services/socket.js
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

class SocketService {
  socket = null;
  isConnecting = false;
  connectionAttempt = 0;
  reconnectTimer = null;
  _pingInterval = null;

  connect(token) {
    if (!token) {
      console.warn('⚠️ No token provided for socket connection');
      return null;
    }

    if (this.socket?.connected) {
      return this.socket;
    }

    if (this.isConnecting && this.socket) {
      return this.socket;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.connectionAttempt++;
    const currentAttempt = this.connectionAttempt;

    console.log('🔌 Connecting socket to:', SOCKET_URL);

    this.socket = io(SOCKET_URL, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 15000,
      forceNew: false,
    });

    this.socket.on('connect', () => {
      if (currentAttempt === this.connectionAttempt) {
        console.log('✅ WebSocket connected:', this.socket.id);
        this.isConnecting = false;
      }
    });

    this.socket.on('connect_error', (error) => {
      console.warn('⚠️ WebSocket connection error:', error.message);
      this.isConnecting = false;
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ WebSocket disconnected:', reason);
      this.isConnecting = false;
    });

    this.socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 WebSocket reconnected after', attemptNumber, 'attempts');
    });

    this.socket.on('reconnect_error', (error) => {
      console.warn('⚠️ WebSocket reconnection error:', error.message);
    });

    if (this._pingInterval) clearInterval(this._pingInterval);
    this._pingInterval = setInterval(() => {
      if (this.socket?.connected) {
        this.socket.emit('ping');
      }
    }, 20000);

    return this.socket;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }

    if (!this.socket) {
      return;
    }

    if (this.socket.connected) {
      this.socket.disconnect();
    }

    this.socket.removeAllListeners();
    this.socket = null;
    this.isConnecting = false;
  }

  safeDisconnect() {
    if (!this.socket) return;

    if (this.isConnecting) {
      this.reconnectTimer = setTimeout(() => {
        if (this.socket && !this.socket.connected) {
          this.disconnect();
        }
      }, 200);
      return;
    }

    this.disconnect();
  }

  subscribe(event, callback) {
    if (this.socket) {
      this.socket.off(event);
      this.socket.on(event, callback);
    }
  }

  unsubscribe(event, callback) {
    if (this.socket) {
      if (callback) {
        this.socket.off(event, callback);
      } else {
        this.socket.off(event);
      }
    }
  }

  emit(event, data) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn('Socket not connected, cannot emit:', event);
    }
  }

  subscribeSymbols(symbols) {
    if (!symbols || symbols.length === 0) return;

    if (this.socket?.connected) {
      this.emit('subscribe:symbols', symbols);
    } else {
      this.socket?.once('connect', () => {
        this.emit('subscribe:symbols', symbols);
      });
    }
  }

  unsubscribeSymbols(symbols) {
    if (!symbols || symbols.length === 0) return;
    this.emit('unsubscribe:symbols', symbols);
  }

  subscribeAccount(accountId) {
    if (!accountId) return;
    this.emit('subscribe:account', accountId);
  }

  unsubscribeAccount(accountId) {
    if (!accountId) return;
    this.emit('unsubscribe:account', accountId);
  }

  requestQuote(symbol) {
    this.emit('get:quote', symbol);
  }

  ping() {
    this.emit('ping');
  }

  isConnected() {
    return this.socket?.connected || false;
  }

  getSocketId() {
    return this.socket?.id || null;
  }
}

const socketService = new SocketService();
export default socketService;