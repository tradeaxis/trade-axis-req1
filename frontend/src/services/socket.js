// frontend/src/services/socket.js
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

class SocketService {
  socket = null;
  isConnecting = false;
  connectionAttempt = 0;
  reconnectTimer = null;

  connect(token) {
    // If already connected, return existing socket
    if (this.socket?.connected) {
      return this.socket;
    }

    // If currently connecting, return the socket being connected
    if (this.isConnecting && this.socket) {
      return this.socket;
    }

    // Clear any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.connectionAttempt++;
    const currentAttempt = this.connectionAttempt;

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      forceNew: false,
    });

    this.socket.on('connect', () => {
      // Only log if this is still the current attempt
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

    return this.socket;
  }

  disconnect() {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Don't disconnect if socket doesn't exist
    if (!this.socket) {
      return;
    }

    // Only disconnect if actually connected
    if (this.socket.connected) {
      this.socket.disconnect();
    }

    // Clean up listeners
    this.socket.removeAllListeners();
    this.socket = null;
    this.isConnecting = false;
  }

  // Safe disconnect that handles React StrictMode
  safeDisconnect() {
    if (!this.socket) return;

    // If still connecting, schedule disconnect
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
      // Remove existing listener first to prevent duplicates
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
      // Wait for connection then subscribe
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

  // Request specific quote
  requestQuote(symbol) {
    this.emit('get:quote', symbol);
  }

  // Ping to keep connection alive
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

// Export singleton instance
const socketService = new SocketService();
export default socketService;