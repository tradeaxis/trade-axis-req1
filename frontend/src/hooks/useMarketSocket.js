// frontend/src/hooks/useMarketSocket.js
import { useEffect, useRef } from 'react';
import socketService from '../services/socket';
import useMarketStore from '../store/marketStore';
import useAuthStore from '../store/authStore';

/**
 * Custom hook to manage socket connection and price subscriptions
 * Call this ONCE in Dashboard.jsx
 */
export default function useMarketSocket() {
  const { isAuthenticated, token } = useAuthStore();
  const updatePrice = useMarketStore((s) => s.updatePrice);
  const hasConnected = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      // Disconnect if logged out
      if (hasConnected.current) {
        socketService.disconnect();
        hasConnected.current = false;
      }
      return;
    }

    // Connect socket
    if (!hasConnected.current) {
      console.log('🔌 Connecting market socket...');
      socketService.connect(token);
      hasConnected.current = true;
    }

    // ── REGISTER EVENT LISTENERS ────────────────────────────────────────

    // Single price update
    socketService.subscribe('price:update', (data) => {
      if (data && data.symbol) {
        updatePrice(data);
      }
    });

    // Batch price updates (snapshot on subscribe)
    socketService.subscribe('prices:snapshot', (snapshot) => {
      if (Array.isArray(snapshot) && snapshot.length > 0) {
        updatePrice(snapshot);
        console.log(`📊 Received price snapshot: ${snapshot.length} symbols`);
      }
    });

    // Session expired warning
    socketService.subscribe('kite:session:expired', (data) => {
      console.warn('🔴 Kite session expired:', data.message);
      alert('⚠️ Price updates stopped — Kite session expired. Contact admin.');
    });

    // Connected confirmation
    socketService.subscribe('connected', (data) => {
      console.log('✅ Market socket connected:', data.message);
    });

    // Cleanup on unmount
    return () => {
      // Don't disconnect on every render — only on logout (handled above)
    };
  }, [isAuthenticated, token, updatePrice]);

  return socketService.isConnected();
}