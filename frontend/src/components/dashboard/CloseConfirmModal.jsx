// frontend/src/components/dashboard/CloseConfirmModal.jsx  ── FIXED VERSION
//
// This component now serves TWO purposes:
//   1. Confirm-before-close dialog (original use)
//   2. Full-screen error popup when a close is REJECTED (replaces tiny toast)
//
// Usage from parent:
//   <CloseConfirmModal
//     isOpen={modal.open}
//     trade={modal.trade}
//     onConfirm={handleConfirmClose}
//     onCancel={() => setModal({ open: false })}
//     partialQty={modal.partialQty}      // optional
//   />
//
//   // For showing a rejection error:
//   <CloseConfirmModal
//     isOpen={errorModal.open}
//     errorMode
//     errorTitle="Order Rejected"
//     errorMessage={errorModal.message}
//     onCancel={() => setErrorModal({ open: false })}
//   />

import { useState } from 'react';
import { AlertTriangle, CheckCircle, X, XCircle } from 'lucide-react';

// ── Rejection / Error popup ────────────────────────────────────────────────────
export function ErrorModal({ isOpen, title = 'Order Rejected', message = '', onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#1e222d', border: '1px solid #ef535060' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ background: '#ef535020', borderBottom: '1px solid #ef535040' }}
        >
          <XCircle size={28} color="#ef5350" />
          <div className="flex-1">
            <div className="font-bold text-lg" style={{ color: '#ef5350' }}>{title}</div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10">
            <X size={20} color="#787b86" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <p className="text-base text-center leading-relaxed" style={{ color: '#d1d4dc' }}>
            {message}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl font-bold text-white"
            style={{ background: '#ef5350' }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main close-confirm modal ───────────────────────────────────────────────────
export default function CloseConfirmModal({
  isOpen,
  trade,
  onConfirm,
  onCancel,
  partialQty,
  currentPrice,
  estimatedPnL,
}) {
  const [isClosing, setIsClosing] = useState(false);

  if (!isOpen || !trade) return null;

  const handleConfirm = async () => {
    setIsClosing(true);
    try {
      await onConfirm();
    } finally {
      setIsClosing(false);
    }
  };

  const qty    = partialQty || trade.quantity;
  const pnl    = estimatedPnL ?? parseFloat(trade.profit || 0);
  const isGain = pnl >= 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: '#1e222d', border: '1px solid #363a45' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: '#252832', borderBottom: '1px solid #363a45' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={22} color="#f5c542" />
            <span className="font-bold text-base" style={{ color: '#d1d4dc' }}>
              Close {partialQty ? 'Partial' : ''} Position
            </span>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/10">
            <X size={20} color="#787b86" />
          </button>
        </div>

        {/* Trade info */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span style={{ color: '#787b86' }}>Symbol</span>
            <span className="font-bold" style={{ color: '#d1d4dc' }}>{trade.symbol}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: '#787b86' }}>Direction</span>
            <span
              className="font-bold uppercase"
              style={{ color: trade.trade_type === 'buy' ? '#26a69a' : '#ef5350' }}
            >
              {trade.trade_type}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: '#787b86' }}>Quantity to Close</span>
            <span className="font-bold" style={{ color: '#d1d4dc' }}>{qty}</span>
          </div>
          {trade.quantity && partialQty && (
            <div className="flex justify-between text-sm">
              <span style={{ color: '#787b86' }}>Remaining</span>
              <span className="font-bold" style={{ color: '#d1d4dc' }}>
                {parseFloat(trade.quantity) - parseFloat(partialQty)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span style={{ color: '#787b86' }}>Open Price</span>
            <span style={{ color: '#d1d4dc' }}>₹{parseFloat(trade.open_price || 0).toFixed(2)}</span>
          </div>
          {currentPrice && (
            <div className="flex justify-between text-sm">
              <span style={{ color: '#787b86' }}>Current Price</span>
              <span style={{ color: '#d1d4dc' }}>₹{parseFloat(currentPrice).toFixed(2)}</span>
            </div>
          )}

          {/* P&L estimate */}
          <div
            className="flex justify-between items-center rounded-xl px-4 py-3"
            style={{ background: isGain ? '#26a69a20' : '#ef535020', border: `1px solid ${isGain ? '#26a69a40' : '#ef535040'}` }}
          >
            <span className="text-sm" style={{ color: '#787b86' }}>Est. P&amp;L</span>
            <span className="font-bold text-lg" style={{ color: isGain ? '#26a69a' : '#ef5350' }}>
              {isGain ? '+' : ''}₹{pnl.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3 px-5 pb-5">
          <button
            onClick={onCancel}
            className="py-3 rounded-xl font-semibold"
            style={{ background: '#2a2e39', color: '#d1d4dc', border: '1px solid #363a45' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isClosing}
            className="py-3 rounded-xl font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: '#ef5350' }}
          >
            {isClosing ? (
              <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <CheckCircle size={18} />
            )}
            {isClosing ? 'Closing...' : 'Close Now'}
          </button>
        </div>
      </div>
    </div>
  );
}