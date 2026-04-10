import { useState } from 'react';
import PanelHeader from './PanelHeader';
import Mt5Chart from './Mt5Chart';

export default function ChartWorkspace({ symbol }) {
  const [tf, setTf] = useState('1h');
  const tfs = ['1m','5m','15m','30m','1h','4h','1d'];

  return (
    <div className="h-full w-full flex flex-col">
      <PanelHeader
        title={`Chart - ${symbol}`}
        right={
          <div className="flex gap-1">
            {tfs.map((x) => (
              <button
                key={x}
                onClick={() => setTf(x)}
                className="px-2 py-1 rounded text-xs"
                style={{
                  background: tf === x ? 'var(--mt5-blue)' : 'var(--mt5-panel)',
                  border: '1px solid var(--mt5-border)',
                }}
              >
                {x.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex-1" style={{ minHeight: 0 }}>
        <Mt5Chart symbol={symbol} timeframe={tf} />
      </div>
    </div>
  );
}