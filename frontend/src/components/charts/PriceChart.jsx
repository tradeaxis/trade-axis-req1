// frontend/src/components/charts/PriceChart.jsx
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import api from '../../services/api';
import socketService from '../../services/socket';

const PriceChart = ({ symbol, timeframe = '15m', mode = 'candles', height = 400, crosshairEnabled = true }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Memoize chart options to prevent re-creation
  const chartOptions = useMemo(() => ({
    layout: {
      background: { type: 'solid', color: '#131722' },
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' },
    },
    crosshair: {
      mode: crosshairEnabled ? 1 : 0,
      vertLine: {
        color: '#758696',
        width: 1,
        style: 2,
        labelBackgroundColor: '#2962ff',
      },
      horzLine: {
        color: '#758696',
        width: 1,
        style: 2,
        labelBackgroundColor: '#2962ff',
      },
    },
    rightPriceScale: {
      borderColor: '#2a2e39',
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: '#2a2e39',
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  }), [crosshairEnabled]);

  // Fetch candles
  const fetchCandles = useCallback(async () => {
    if (!symbol) return;
    
    setLoading(true);
    setError(null);

    try {
      const res = await api.get(`/market/candles/${symbol}`, {
        params: { timeframe, count: 300 },
      });

      if (res.data.success && res.data.candles?.length > 0) {
        return res.data.candles;
      }
      return [];
    } catch (err) {
      console.error('Failed to fetch candles:', err);
      setError('Failed to load chart data');
      return [];
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
    }

    // Create new chart
    const chart = createChart(chartContainerRef.current, {
      ...chartOptions,
      width: chartContainerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Create series based on mode
    if (mode === 'candles') {
      seriesRef.current = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });
    } else if (mode === 'bars') {
      seriesRef.current = chart.addBarSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
      });
    } else {
      seriesRef.current = chart.addLineSeries({
        color: '#2962ff',
        lineWidth: 2,
      });
    }

    // Handle resize
    resizeObserverRef.current = new ResizeObserver((entries) => {
      if (entries[0] && chartRef.current) {
        const { width } = entries[0].contentRect;
        chartRef.current.applyOptions({ width });
      }
    });

    resizeObserverRef.current.observe(chartContainerRef.current);

    // Load initial data
    fetchCandles().then((candles) => {
      if (candles.length > 0 && seriesRef.current) {
        if (mode === 'line') {
          const lineData = candles.map((c) => ({ time: c.time, value: c.close }));
          seriesRef.current.setData(lineData);
        } else {
          seriesRef.current.setData(candles);
        }
        chart.timeScale().fitContent();
      }
    });

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, [symbol, timeframe, mode, height, chartOptions, fetchCandles]);

  // Handle real-time price updates with throttling
  useEffect(() => {
    if (!symbol) return;

    const handlePriceUpdate = (data) => {
      if (data.symbol !== symbol) return;
      if (!seriesRef.current) return;

      // Throttle updates to max once per 500ms to prevent blinking
      const now = Date.now();
      if (now - lastUpdateRef.current < 500) return;
      lastUpdateRef.current = now;

      const price = data.last || data.bid || 0;
      if (!price) return;

      const timestamp = Math.floor(Date.now() / 1000);

      try {
        if (mode === 'line') {
          seriesRef.current.update({ time: timestamp, value: price });
        } else {
          // For candles/bars, update the last candle
          seriesRef.current.update({
            time: timestamp,
            open: price,
            high: price,
            low: price,
            close: price,
          });
        }
      } catch (err) {
        // Ignore update errors (can happen during chart transitions)
      }
    };

    socketService.subscribe('price:update', handlePriceUpdate);

    return () => {
      socketService.unsubscribe('price:update', handlePriceUpdate);
    };
  }, [symbol, mode]);

  // Update height when prop changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({ height });
    }
  }, [height]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height, background: '#131722', color: '#ef5350' }}
      >
        {error}
      </div>
    );
  }

  return (
    <div className="relative" style={{ height }}>
      {loading && (
        <div
          className="absolute inset-0 flex items-center justify-center z-10"
          style={{ background: 'rgba(19, 23, 34, 0.8)' }}
        >
          <div className="text-sm" style={{ color: '#787b86' }}>
            Loading chart...
          </div>
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default PriceChart;