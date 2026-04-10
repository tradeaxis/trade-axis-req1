import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function ModifyPositionModal({
  trade,
  onClose,
  onSubmitSLTP,
  onSubmitAddQty,
  closingMode,
  accountStats,
  formatINR,
}) {
  const [tab, setTab] = useState('sltp'); // sltp | addqty
  const [newSL, setNewSL] = useState(trade?.stop_loss || '');
  const [newTP, setNewTP] = useState(trade?.take_profit || '');
  const [addQty, setAddQty] = useState(1);
  const [loading, setLoading] = useState(false);

  const currentPrice = Number(trade?.current_price || trade?.open_price || 0);
  const leverage = accountStats?.leverage || 5;

  const estimatedMargin = useMemo(() => {
    return addQty > 0 ? (currentPrice * addQty) / leverage : 0;
  }, [addQty, currentPrice, leverage]);

  if (!trade) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl"
        style={{ background: '#1e222d', border: '1px solid #363a45' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: '#363a45' }}>
          <h3 className="font-bold text-lg" style={{ color: '#d1d4dc' }}>Modify Position</h3>
          <button onClick={onClose}><X size={22} color="#787b86" /></button>
        </div>

        <div className="p-4 pb-0">
          <div className="p-3 rounded-lg" style={{ background: '#2a2e39' }}>
            <div className="text-sm" style={{ color: '#787b86' }}>Symbol</div>
            <div className="font-bold text-lg" style={{ color: '#d1d4dc' }}>{trade.symbol}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm" style={{ color: '#787b86' }}>
                Qty: {trade.quantity} • {String(trade.trade_type || '').toUpperCase()}
              </span>
              <span className="text-sm" style={{ color: '#787b86' }}>
                @ {formatINR(trade.open_price)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex mx-4 mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid #363a45' }}>
          <button
            type="button"
            onClick={() => setTab('sltp')}
            className="flex-1 py-2.5 text-sm font-medium"
            style={{ background: tab === 'sltp' ? '#2962ff' : '#2a2e39', color: tab === 'sltp' ? '#fff' : '#787b86' }}
          >
            SL / TP
          </button>
          <button
            type="button"
            onClick={() => setTab('addqty')}
            className="flex-1 py-2.5 text-sm font-medium"
            style={{ background: tab === 'addqty' ? '#2962ff' : '#2a2e39', color: tab === 'addqty' ? '#fff' : '#787b86' }}
          >
            + Add Qty
          </button>
        </div>

        <div className="p-4 space-y-4">
          {tab === 'sltp' && (
            <>
              <div>
                <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Stop Loss</label>
                <input
                  type="number"
                  value={newSL}
                  onChange={(e) => setNewSL(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg text-base"
                  style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                />
              </div>

              <div>
                <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Take Profit</label>
                <input
                  type="number"
                  value={newTP}
                  onChange={(e) => setNewTP(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg text-base"
                  style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                />
              </div>

              <button
                onClick={async () => {
                  setLoading(true);
                  try {
                    await onSubmitSLTP(trade.id, newSL, newTP);
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
                style={{ background: '#2962ff', color: '#fff' }}
              >
                Modify SL / TP
              </button>
            </>
          )}

          {tab === 'addqty' && (
            <>
              {closingMode && (
                <div className="p-3 rounded-lg flex items-center gap-2" style={{ background: '#ff980020', border: '1px solid #ff980050' }}>
                  <AlertTriangle size={18} color="#ff9800" />
                  <div className="text-sm" style={{ color: '#ff9800' }}>
                    Closing mode is active. You cannot add quantity.
                  </div>
                </div>
              )}

              {!closingMode && (
                <>
                  <div>
                    <label className="block text-sm mb-2" style={{ color: '#787b86' }}>Additional Quantity</label>
                    <input
                      type="number"
                      value={addQty}
                      min={1}
                      onChange={(e) => setAddQty(Math.max(1, Number(e.target.value || 1)))}
                      className="w-full px-4 py-3 rounded-lg text-xl font-bold text-center"
                      style={{ background: '#2a2e39', border: '1px solid #363a45', color: '#d1d4dc' }}
                    />
                  </div>

                  <div className="p-3 rounded-lg" style={{ background: '#252832', border: '1px solid #363a45' }}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: '#787b86' }}>Est. Additional Margin</span>
                      <span style={{ color: '#f5c542' }}>{formatINR(estimatedMargin)}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span style={{ color: '#787b86' }}>Free Margin</span>
                      <span style={{ color: '#d1d4dc' }}>{formatINR(accountStats?.freeMargin || 0)}</span>
                    </div>
                  </div>

                  {estimatedMargin > (accountStats?.freeMargin || 0) && (
                    <div className="p-2 rounded-lg flex items-center gap-2" style={{ background: '#ef535020' }}>
                      <AlertTriangle size={16} color="#ef5350" />
                      <span className="text-xs" style={{ color: '#ef5350' }}>
                        Insufficient free margin for this quantity
                      </span>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!addQty || addQty <= 0) return toast.error('Enter valid quantity');
                      setLoading(true);
                      try {
                        await onSubmitAddQty(trade.id, addQty);
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading || estimatedMargin > (accountStats?.freeMargin || 0)}
                    className="w-full py-3.5 rounded-lg font-semibold text-base disabled:opacity-50"
                    style={{ background: '#26a69a', color: '#fff' }}
                  >
                    Add Quantity
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}