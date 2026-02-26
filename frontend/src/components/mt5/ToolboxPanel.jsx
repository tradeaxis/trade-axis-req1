import { useEffect, useState } from 'react';
import PanelHeader from './PanelHeader';
import api from '../../services/api';

export default function ToolboxPanel({ accountId, openTrades, tradeHistory, onCloseTrade }) {
  const [tab, setTab] = useState('trade');
  const [txns, setTxns] = useState([]);

  useEffect(() => {
    const loadTxns = async () => {
      if (!accountId) return;
      try {
        const res = await api.get(`/transactions?accountId=${accountId}&limit=50`);
        setTxns(res.data?.data || []);
      } catch (e) {
        setTxns([]);
      }
    };
    if (tab === 'transactions') loadTxns();
  }, [tab, accountId]);

  const tabs = [
    { id: 'trade', label: `Trade (${openTrades.length})` },
    { id: 'history', label: 'History' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'journal', label: 'Journal' },
  ];

  return (
    <div className="h-full w-full flex flex-col">
      <PanelHeader
        title="Toolbox"
        right={
          <div className="flex gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="px-2 py-1 rounded text-xs"
                style={{
                  background: tab === t.id ? 'var(--mt5-blue)' : 'var(--mt5-panel)',
                  border: '1px solid var(--mt5-border)',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex-1 overflow-auto">
        {tab === 'trade' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 mt5-panel2">
              <tr className="mt5-muted">
                <th className="text-left px-2 py-2 font-normal">Symbol</th>
                <th className="text-left px-2 py-2 font-normal">Type</th>
                <th className="text-right px-2 py-2 font-normal">Qty</th>
                <th className="text-right px-2 py-2 font-normal">Open</th>
                <th className="text-right px-2 py-2 font-normal">Current</th>
                <th className="text-right px-2 py-2 font-normal">Profit</th>
                <th className="text-center px-2 py-2 font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map(t => {
                const pnl = Number(t.profit || 0);
                return (
                  <tr key={t.id} className="border-b mt5-border">
                    <td className="px-2 py-2 font-semibold">{t.symbol}</td>
                    <td className={`px-2 py-2 ${t.trade_type === 'buy' ? 'text-profit' : 'text-loss'}`}>
                      {t.trade_type.toUpperCase()}
                    </td>
                    <td className="px-2 py-2 text-right">{t.quantity}</td>
                    <td className="px-2 py-2 text-right">₹{Number(t.open_price).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right">₹{Number(t.current_price || t.open_price).toFixed(2)}</td>
                    <td className={`px-2 py-2 text-right ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => onCloseTrade(t.id)}
                        className="px-2 py-1 rounded"
                        style={{ background: 'var(--mt5-red)', color: '#fff' }}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                );
              })}
              {openTrades.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center mt5-muted">No open positions</td></tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'history' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 mt5-panel2">
              <tr className="mt5-muted">
                <th className="text-left px-2 py-2 font-normal">Symbol</th>
                <th className="text-left px-2 py-2 font-normal">Type</th>
                <th className="text-right px-2 py-2 font-normal">Qty</th>
                <th className="text-right px-2 py-2 font-normal">Profit</th>
                <th className="text-right px-2 py-2 font-normal">Close Time</th>
              </tr>
            </thead>
            <tbody>
              {tradeHistory.map(t => {
                const pnl = Number(t.profit || 0);
                return (
                  <tr key={t.id} className="border-b mt5-border">
                    <td className="px-2 py-2 font-semibold">{t.symbol}</td>
                    <td className={`px-2 py-2 ${t.trade_type === 'buy' ? 'text-profit' : 'text-loss'}`}>
                      {t.trade_type.toUpperCase()}
                    </td>
                    <td className="px-2 py-2 text-right">{t.quantity}</td>
                    <td className={`px-2 py-2 text-right ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right mt5-muted">
                      {t.close_time ? new Date(t.close_time).toLocaleString() : '-'}
                    </td>
                  </tr>
                );
              })}
              {tradeHistory.length === 0 && (
                <tr><td colSpan={5} className="p-4 text-center mt5-muted">No history</td></tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'transactions' && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 mt5-panel2">
              <tr className="mt5-muted">
                <th className="text-left px-2 py-2 font-normal">Type</th>
                <th className="text-right px-2 py-2 font-normal">Amount</th>
                <th className="text-left px-2 py-2 font-normal">Status</th>
                <th className="text-right px-2 py-2 font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(x => (
                <tr key={x.id} className="border-b mt5-border">
                  <td className="px-2 py-2 font-semibold">{String(x.transaction_type).toUpperCase()}</td>
                  <td className="px-2 py-2 text-right">₹{Number(x.amount).toFixed(2)}</td>
                  <td className="px-2 py-2">{String(x.status).toUpperCase()}</td>
                  <td className="px-2 py-2 text-right mt5-muted">{new Date(x.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {txns.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center mt5-muted">No transactions</td></tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'journal' && (
          <div className="p-4 mt5-muted">
            Journal placeholder (server logs / events) — coming soon.
          </div>
        )}
      </div>
    </div>
  );
}