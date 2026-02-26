import { useState } from 'react';
import PanelHeader from './PanelHeader';

export default function OrderDockPanel({ symbol, bid, ask, leverage = 5, freeMargin = 0, onBuy, onSell }) {
  const [qty, setQty] = useState(1);

  const marginRequired = ((ask * qty) / (leverage || 5)) || 0;

  return (
    <div className="h-full w-full flex flex-col">
      <PanelHeader title="New Order" />
      <div className="p-3 text-xs border-b mt5-border">
        <div className="font-semibold text-base">{symbol}</div>
        <div className="mt5-muted">Bid/Ask</div>
        <div className="flex gap-2 mt-2">
          <div className="flex-1 p-2 rounded" style={{ background: '#2a1f25', border: '1px solid var(--mt5-border)' }}>
            <div className="mt5-muted">SELL</div>
            <div className="text-loss font-bold text-lg">₹{bid.toFixed(2)}</div>
          </div>
          <div className="flex-1 p-2 rounded" style={{ background: '#1f2a25', border: '1px solid var(--mt5-border)' }}>
            <div className="mt5-muted">BUY</div>
            <div className="text-profit font-bold text-lg">₹{ask.toFixed(2)}</div>
          </div>
        </div>
      </div>

      <div className="p-3 text-xs border-b mt5-border">
        <div className="mt5-muted mb-1">Volume (Qty)</div>
        <div className="flex gap-2">
          <button
            className="w-8 h-8 rounded"
            style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
            onClick={() => setQty(Math.max(1, qty - 1))}
          >
            -
          </button>
          <input
            className="flex-1 px-2 rounded text-center"
            style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
            value={qty}
            type="number"
            min={1}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || '1', 10)))}
          />
          <button
            className="w-8 h-8 rounded"
            style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}
            onClick={() => setQty(qty + 1)}
          >
            +
          </button>
        </div>

        <div className="mt-3 p-2 rounded" style={{ background: 'var(--mt5-panel)', border: '1px solid var(--mt5-border)' }}>
          <div className="flex justify-between">
            <span className="mt5-muted">Margin Required</span>
            <span>₹{marginRequired.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="mt5-muted">Free Margin</span>
            <span>₹{Number(freeMargin).toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div className="p-3 mt-auto">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onSell(qty)}
            className="py-3 rounded font-bold"
            style={{ background: 'var(--mt5-red)', color: '#fff' }}
          >
            SELL
          </button>
          <button
            onClick={() => onBuy(qty)}
            className="py-3 rounded font-bold"
            style={{ background: 'var(--mt5-green)', color: '#fff' }}
          >
            BUY
          </button>
        </div>
      </div>
    </div>
  );
}