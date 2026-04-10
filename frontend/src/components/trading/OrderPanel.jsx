import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import useTradingStore from '../../store/tradingStore';
import useMarketStore from '../../store/marketStore';

const QUOTE_STALE_MS = 10000;

const OrderPanel = ({ symbol, selectedAccount }) => {
  const { placeOrder } = useTradingStore();
  const { quotes, getQuote } = useMarketStore();
  const [orderType, setOrderType] = useState('market');
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const quote = quotes[symbol];

  useEffect(() => {
    getQuote(symbol);
  }, [symbol, getQuote]);

  const handleOrder = async (type) => {
    if (!selectedAccount) {
      toast.error('Please select an account');
      return;
    }

    if (offQuotes) {
      toast.error(`${symbol} is off quotes. Live price is older than 10 seconds.`);
      return;
    }

    setIsLoading(true);

    const orderData = {
      accountId: selectedAccount.id,
      symbol,
      type,
      quantity: parseInt(quantity),
      stopLoss: parseFloat(stopLoss) || 0,
      takeProfit: parseFloat(takeProfit) || 0,
    };

    const result = await placeOrder(orderData);

    if (result.success) {
      toast.success(`${type.toUpperCase()} order executed @ ₹${result.data.open_price}`);
      setQuantity(1);
      setStopLoss('');
      setTakeProfit('');
    } else {
      toast.error(result.message);
    }

    setIsLoading(false);
  };

  const bid = parseFloat(quote?.bid || 0);
  const ask = parseFloat(quote?.ask || 0);
  const spread = (ask - bid).toFixed(2);
  const quoteTimestamp = Number(quote?.timestamp || 0);
  const quoteHasPrice = bid > 0 || ask > 0 || Number(quote?.last || 0) > 0;
  const offQuotes =
    !quoteHasPrice ||
    !!quote?.off_quotes ||
    !quoteTimestamp ||
    (Date.now() - quoteTimestamp > QUOTE_STALE_MS);

  return (
    <div className="bg-dark-200 rounded-xl border border-gray-800 p-4">
      <h3 className="font-bold text-green-500 mb-4">New Order</h3>

      {/* Symbol & Price Display */}
      <div className="bg-dark-300 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-lg font-bold">{symbol}</span>
          <span className="text-xs text-gray-400">Spread: {spread}</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Bid</p>
            <p className="text-lg font-bold text-red-500">₹{bid.toFixed(2)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Ask</p>
            <p className="text-lg font-bold text-green-500">₹{ask.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Order Type */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Order Type</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setOrderType('market')}
            className={`py-2 rounded-lg text-sm font-medium transition ${
              orderType === 'market' ? 'bg-green-600 text-white' : 'bg-dark-300 text-gray-400'
            }`}
          >
            Market
          </button>
          <button
            onClick={() => setOrderType('limit')}
            className={`py-2 rounded-lg text-sm font-medium transition ${
              orderType === 'limit' ? 'bg-green-600 text-white' : 'bg-dark-300 text-gray-400'
            }`}
          >
            Limit
          </button>
        </div>
      </div>

      {/* Quantity */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-2">Quantity</label>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="w-10 h-10 bg-dark-300 rounded-lg text-xl font-bold hover:bg-dark-100 transition"
          >
            -
          </button>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 px-4 py-2 bg-dark-300 border border-gray-700 rounded-lg text-center font-bold focus:outline-none focus:border-green-500"
          />
          <button 
            onClick={() => setQuantity(quantity + 1)}
            className="w-10 h-10 bg-dark-300 rounded-lg text-xl font-bold hover:bg-dark-100 transition"
          >
            +
          </button>
        </div>
        <div className="flex justify-between mt-2">
          {[1, 5, 10, 25, 50].map(q => (
            <button
              key={q}
              onClick={() => setQuantity(q)}
              className="px-3 py-1 text-xs bg-dark-300 rounded hover:bg-dark-100 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Stop Loss & Take Profit */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Stop Loss</label>
          <input
            type="number"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-dark-300 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-red-500"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-2">Take Profit</label>
          <input
            type="number"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-dark-300 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-green-500"
          />
        </div>
      </div>

      {/* Buy/Sell Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleOrder('buy')}
          disabled={isLoading || offQuotes}
          className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-4 rounded-lg font-bold transition disabled:opacity-50"
        >
          <TrendingUp size={20} />
          BUY
        </button>
        <button
          onClick={() => handleOrder('sell')}
          disabled={isLoading || offQuotes}
          className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-4 rounded-lg font-bold transition disabled:opacity-50"
        >
          <TrendingDown size={20} />
          SELL
        </button>
      </div>

      {/* Margin Info */}
      <div className="mt-4 p-3 bg-dark-300 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <AlertCircle size={14} />
          {offQuotes ? (
            <span>{symbol} is off quotes.</span>
          ) : (
            <span>Estimated Margin: ₹{((ask * quantity) / (selectedAccount?.leverage || 5)).toFixed(2)}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderPanel;
