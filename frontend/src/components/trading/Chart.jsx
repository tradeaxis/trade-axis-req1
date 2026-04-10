import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import api from '../../services/api';

const Chart = ({ symbol }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const [timeframe, setTimeframe] = useState('1h');
  const [symbolData, setSymbolData] = useState(null);
  const [error, setError] = useState(null);

  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    try {
      const chart = createChart(chartContainerRef.current, {
        layout: {
          background: { type: 'solid', color: '#12121a' },
          textColor: '#d1d5db',
        },
        grid: {
          vertLines: { color: '#1f2937' },
          horzLines: { color: '#1f2937' },
        },
        crosshair: {
          mode: 0,
        },
        rightPriceScale: {
          borderColor: '#374151',
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
        },
        width: chartContainerRef.current.clientWidth,
        height: 400,
      });

      // For lightweight-charts v4, use addSeries with type
      let candleSeries;
      
      // Check if it's v4 or v3
      if (typeof chart.addCandlestickSeries === 'function') {
        // v3 API
        candleSeries = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
      } else {
        // v4 API
        candleSeries = chart.addSeries({
          type: 'Candlestick',
          options: {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderUpColor: '#22c55e',
            borderDownColor: '#ef4444',
            wickUpColor: '#22c55e',
            wickDownColor: '#ef4444',
          }
        });
      }

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;

      const handleResize = () => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    } catch (err) {
      console.error('Chart init error:', err);
      setError('Failed to initialize chart');
    }
  }, []);

  // Load data
  useEffect(() => {
    const loadData = async () => {
      try {
        const response = await api.get(`/market/candles/${symbol}?timeframe=${timeframe}&count=200`);
        const candles = response.data.data;
        
        if (candleSeriesRef.current && candles && candles.length > 0) {
          candleSeriesRef.current.setData(candles);
          chartRef.current?.timeScale().fitContent();
        }

        const quoteRes = await api.get(`/market/quote/${symbol}`);
        setSymbolData(quoteRes.data.data);
      } catch (err) {
        console.error('Error loading data:', err);
      }
    };

    if (symbol) {
      loadData();
    }
  }, [symbol, timeframe]);

  if (error) {
    return (
      <div className="bg-[#1a1a27] rounded-xl border border-gray-800 p-6 h-[450px] flex items-center justify-center">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1a27] rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-lg font-bold">{symbol}</h3>
            <p className="text-sm text-gray-400">{symbolData?.displayName || ''}</p>
          </div>
          {symbolData && (
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold">
                ₹{parseFloat(symbolData.lastPrice || 0).toFixed(2)}
              </span>
              <span className={`px-2 py-1 rounded text-sm font-semibold ${
                (symbolData.changePercent || 0) >= 0 
                  ? 'bg-green-600/20 text-green-500' 
                  : 'bg-red-600/20 text-red-500'
              }`}>
                {(symbolData.changePercent || 0) >= 0 ? '+' : ''}
                {(symbolData.changePercent || 0).toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* Timeframes */}
        <div className="flex items-center gap-1 bg-[#151521] rounded-lg p-1">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                timeframe === tf
                  ? 'bg-green-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div ref={chartContainerRef} className="w-full" style={{ height: '400px' }} />
    </div>
  );
};

export default Chart;