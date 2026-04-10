import { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'react-hot-toast';
import useTradingStore from '../../store/tradingStore';

const Positions = ({ selectedAccount }) => {
  const { openTrades, tradeHistory, fetchOpenTrades, fetchTradeHistory, closeTrade, closeAllTrades } = useTradingStore();
  const [tab, setTab] = useState('positions');

  useEffect(() => {
    if (selectedAccount) {
      fetchOpenTrades(selectedAccount.id);
      fetchTradeHistory(selectedAccount.id);
    }
  }, [selectedAccount, fetchOpenTrades, fetchTradeHistory]);

  const handleClose = async (tradeId) => {
    const result = await closeTrade(tradeId, selectedAccount?.id);
    if (result.success) {
      toast.success('Position closed');
    } else {
      toast.error(result.message);
    }
  };

  const handleCloseAll = async () => {
    if (!window.confirm('Close all positions?')) return;
    const result = await closeAllTrades(selectedAccount?.id);
    if (result.success) {
      toast.success('All positions closed');
    }
  };

  const totalPnL = openTrades.reduce((sum, t) => sum + parseFloat(t.profit || 0), 0);

  return (
    <div className="bg-[#1a1a27] rounded-xl border border-gray-800 h-full flex flex-col">
      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-gray-800">
        <div className="flex">
          <button
            onClick={() => setTab('positions')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              tab === 'positions' 
                ? 'text-green-500 border-green-500' 
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            Positions ({openTrades.length})
          </button>
          <button
            onClick={() => setTab('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
              tab === 'history' 
                ? 'text-green-500 border-green-500' 
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            History
          </button>
        </div>

        {tab === 'positions' && openTrades.length > 0 && (
          <div className="flex items-center gap-4 px-4">
            <span className={`font-bold ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              P&L: {totalPnL >= 0 ? '+' : ''}₹{totalPnL.toFixed(2)}
            </span>
            <button
              onClick={handleCloseAll}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition"
            >
              Close All
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'positions' && (
          <>
            {openTrades.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                No open positions
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-[#151521] sticky top-0">
                  <tr className="text-xs text-gray-400">
                    <th className="text-left p-3">Symbol</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-right p-3">Qty</th>
                    <th className="text-right p-3">Open</th>
                    <th className="text-right p-3">Current</th>
                    <th className="text-right p-3">P&L</th>
                    <th className="text-center p-3">Close</th>
                  </tr>
                </thead>
                <tbody>
                  {openTrades.map((trade) => {
                    const pnl = parseFloat(trade.profit || 0);
                    return (
                      <tr key={trade.id} className="border-b border-gray-800 hover:bg-[#151521]">
                        <td className="p-3 font-semibold">{trade.symbol}</td>
                        <td className="p-3">
                          <span className={`flex items-center gap-1 ${
                            trade.trade_type === 'buy' ? 'text-green-500' : 'text-red-500'
                          }`}>
                            {trade.trade_type === 'buy' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                            {trade.trade_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 text-right">{trade.quantity}</td>
                        <td className="p-3 text-right">₹{parseFloat(trade.open_price).toFixed(2)}</td>
                        <td className="p-3 text-right">₹{parseFloat(trade.current_price || trade.open_price).toFixed(2)}</td>
                        <td className={`p-3 text-right font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <button 
                            onClick={() => handleClose(trade.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/10 rounded transition"
                          >
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'history' && (
          <>
            {tradeHistory.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                No trade history
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-[#151521] sticky top-0">
                  <tr className="text-xs text-gray-400">
                    <th className="text-left p-3">Symbol</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-right p-3">Qty</th>
                    <th className="text-right p-3">Open</th>
                    <th className="text-right p-3">Close</th>
                    <th className="text-right p-3">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeHistory.map((trade) => {
                    const pnl = parseFloat(trade.profit || 0);
                    return (
                      <tr key={trade.id} className="border-b border-gray-800 hover:bg-[#151521]">
                        <td className="p-3 font-semibold">{trade.symbol}</td>
                        <td className="p-3">
                          <span className={trade.trade_type === 'buy' ? 'text-green-500' : 'text-red-500'}>
                            {trade.trade_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3 text-right">{trade.quantity}</td>
                        <td className="p-3 text-right">₹{parseFloat(trade.open_price).toFixed(2)}</td>
                        <td className="p-3 text-right">₹{parseFloat(trade.close_price || 0).toFixed(2)}</td>
                        <td className={`p-3 text-right font-bold ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Positions;