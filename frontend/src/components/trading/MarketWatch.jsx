import { useState, useEffect } from 'react';
import { Search, Star, TrendingUp, TrendingDown } from 'lucide-react';
import useMarketStore from '../../store/marketStore';

const MarketWatch = ({ onSymbolSelect, selectedSymbol }) => {
  const { symbols, quotes, fetchSymbols, updatePrice } = useMarketStore();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [favorites, setFavorites] = useState(['RELIANCE', 'TCS', 'NIFTY50']);
  useEffect(() => {
    fetchSymbols();
  }, [fetchSymbols]);

  useEffect(() => {
    if (!filteredSymbols || filteredSymbols.length === 0) return;
    
    const symbolNames = filteredSymbols.map(s => s.symbol).filter(Boolean);
    if (symbolNames.length > 0) {
      import('../../services/socket').then(({ default: socketService }) => {
        socketService.subscribeSymbols(symbolNames);
      });
    }
  }, [filteredSymbols]);

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'favorites', label: '★' },
    { id: 'stock_futures', label: 'Stocks' },
    { id: 'index_futures', label: 'Indices' },
    { id: 'commodity_futures', label: 'Commodities' },
    { id: 'sensex_futures', label: 'Sensex' },
  ];

  const filteredSymbols = symbols.filter(s => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      String(s.symbol || '').toLowerCase().includes(q) ||
      String(s.display_name || '').toLowerCase().includes(q) ||
      String(s.underlying || '').toLowerCase().includes(q);
    
    if (category === 'favorites') {
      return matchesSearch && favorites.includes(s.symbol);
    }
    if (category === 'all') {
      return matchesSearch;
    }
    return matchesSearch && s.category === category;
  });

  const toggleFavorite = (symbol) => {
    setFavorites(prev => 
      prev.includes(symbol) 
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  return (
    <div className="bg-dark-200 rounded-xl border border-gray-800 h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-800">
        <h3 className="font-bold text-green-500 mb-3">Market Watch</h3>
        
        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search symbols..."
            className="w-full pl-9 pr-3 py-2 bg-dark-300 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-green-500"
          />
        </div>

        {/* Categories */}
        <div className="flex gap-1 overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`px-3 py-1 rounded text-xs font-medium whitespace-nowrap transition ${
                category === cat.id
                  ? 'bg-green-600 text-white'
                  : 'bg-dark-300 text-gray-400 hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Symbol List */}
      <div className="flex-1 overflow-y-auto">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-gray-400 border-b border-gray-800 sticky top-0 bg-dark-200">
          <div className="col-span-1"></div>
          <div className="col-span-4">Symbol</div>
          <div className="col-span-4 text-right">Price</div>
          <div className="col-span-3 text-right">Change</div>
        </div>

        {/* Symbols */}
        {filteredSymbols.map((symbol) => {
          const quote = quotes[symbol.symbol] || symbol;
          const price = parseFloat(quote.last || symbol.last_price);
          const change = parseFloat(quote.changePercent || symbol.change_percent || 0);
          const isFavorite = favorites.includes(symbol.symbol);
          const isSelected = selectedSymbol === symbol.symbol;

          return (
            <div
              key={symbol.symbol}
              onClick={() => onSymbolSelect(symbol.symbol)}
              className={`grid grid-cols-12 gap-2 px-3 py-2 cursor-pointer border-b border-gray-800/50 transition ${
                isSelected ? 'bg-green-600/10 border-l-2 border-l-green-500' : 'hover:bg-dark-300'
              }`}
            >
              <div className="col-span-1 flex items-center">
                <button 
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(symbol.symbol); }}
                  className={`${isFavorite ? 'text-yellow-500' : 'text-gray-600 hover:text-yellow-500'}`}
                >
                  <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              <div className="col-span-4">
                <p className="font-semibold text-sm">{symbol.symbol}</p>
                <p className="text-xs text-gray-500 truncate">{symbol.exchange}</p>
              </div>
              <div className="col-span-4 text-right">
                <p className="font-semibold text-sm">₹{price.toFixed(2)}</p>
              </div>
              <div className="col-span-3 text-right">
                <div className={`flex items-center justify-end gap-1 text-sm font-semibold ${
                  change >= 0 ? 'text-green-500' : 'text-red-500'
                }`}>
                  {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MarketWatch;