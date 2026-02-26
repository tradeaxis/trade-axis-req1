// frontend/src/components/charts/PriceChart.jsx
import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart } from 'lightweight-charts';
import api from '../../services/api';

export default function PriceChart({
  symbol,
  timeframe = '1h',
  mode = 'candles', // 'candles' | 'bars' | 'line'
  height = 300,
  indicators = [],
  crosshairEnabled = false,
  showVolume = true,
  onCrosshairMove,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const mainSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const isMountedRef = useRef(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Safely remove a series
  const removeSeries = useCallback((seriesRef) => {
    if (chartRef.current && seriesRef.current) {
      try {
        chartRef.current.removeSeries(seriesRef.current);
      } catch (e) {
        // Series might already be removed, ignore
        console.debug('Series already removed');
      }
      seriesRef.current = null;
    }
  }, []);

  // Initialize chart
  useEffect(() => {
    isMountedRef.current = true;

    if (!containerRef.current) return;

    // Don't recreate if chart already exists
    if (chartRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#1e222d', style: 1 },
        horzLines: { color: '#1e222d', style: 1 },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 8,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
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
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Crosshair move handler
    if (onCrosshairMove) {
      chart.subscribeCrosshairMove((param) => {
        if (!param.point || !param.time) return;
        const data = param.seriesData.get(mainSeriesRef.current);
        if (data) {
          onCrosshairMove({ time: param.time, ...data });
        }
      });
    }

    // ResizeObserver for responsive chart
    const resizeObserver = new ResizeObserver((entries) => {
      if (!isMountedRef.current) return;
      if (!containerRef.current || !chartRef.current) return;

      const entry = entries[0];
      if (entry) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chartRef.current.applyOptions({ width, height });
          chartRef.current.timeScale().fitContent();
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    return () => {
      isMountedRef.current = false;

      // Cleanup resize observer
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      // Clear series references first
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;

      // Remove chart
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.debug('Chart already removed');
        }
        chartRef.current = null;
      }
    };
  }, [height, crosshairEnabled, onCrosshairMove]);

  // Update crosshair mode when prop changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        crosshair: { mode: crosshairEnabled ? 1 : 0 },
      });
    }
  }, [crosshairEnabled]);

  // Create/recreate series when mode changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !isMountedRef.current) return;

    // Remove existing main series
    removeSeries(mainSeriesRef);
    removeSeries(volumeSeriesRef);

    // Create new series based on mode
    try {
      if (mode === 'line') {
        mainSeriesRef.current = chart.addAreaSeries({
          lineColor: '#2962ff',
          topColor: 'rgba(41, 98, 255, 0.4)',
          bottomColor: 'rgba(41, 98, 255, 0.0)',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
        });
      } else if (mode === 'bars') {
        mainSeriesRef.current = chart.addBarSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
          thinBars: false,
        });
      } else {
        // Default: candlestick
        mainSeriesRef.current = chart.addCandlestickSeries({
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderUpColor: '#26a69a',
          borderDownColor: '#ef5350',
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });
      }

      // Add volume series if enabled
      if (showVolume) {
        volumeSeriesRef.current = chart.addHistogramSeries({
          color: '#26a69a',
          priceFormat: { type: 'volume' },
          priceScaleId: '',
          scaleMargins: { top: 0.8, bottom: 0 },
        });
      }
    } catch (e) {
      console.error('Error creating series:', e);
      setError('Failed to create chart series');
    }
  }, [mode, showVolume, removeSeries]);

  // Load data when symbol/timeframe changes
  useEffect(() => {
    if (!symbol) return;

    let cancelled = false;
    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await api.get(
          `/market/candles/${symbol}?timeframe=${timeframe}&count=300`,
          { signal: controller.signal }
        );

        if (cancelled || !isMountedRef.current) return;

        const candles = response.data?.data || [];
        
        if (candles.length === 0) {
          setError('No data available');
          setIsLoading(false);
          return;
        }

        const mainSeries = mainSeriesRef.current;
        const volumeSeries = volumeSeriesRef.current;
        const chart = chartRef.current;

        if (!mainSeries || !chart) {
          setIsLoading(false);
          return;
        }

        // Format data based on chart mode
        if (mode === 'line') {
          const lineData = candles.map((c) => ({
            time: c.time,
            value: c.close,
          }));
          mainSeries.setData(lineData);
        } else {
          // Candlestick or bar data
          const ohlcData = candles.map((c) => ({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));
          mainSeries.setData(ohlcData);
        }

        // Set volume data if series exists
        if (volumeSeries && candles[0]?.volume !== undefined) {
          const volumeData = candles.map((c) => ({
            time: c.time,
            value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
          }));
          volumeSeries.setData(volumeData);
        }

        // Fit content to view
        chart.timeScale().fitContent();
        setIsLoading(false);
      } catch (e) {
        if (cancelled || e.name === 'AbortError') return;
        
        console.error('Chart data load error:', e);
        setError('Failed to load chart data');
        setIsLoading(false);
      }
    };

    // Small delay to ensure series is created
    const timeoutId = setTimeout(loadData, 100);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [symbol, timeframe, mode]);

  // Update data in real-time (can be called from parent)
  const updateLastCandle = useCallback((candle) => {
    if (!mainSeriesRef.current || !isMountedRef.current) return;

    try {
      if (mode === 'line') {
        mainSeriesRef.current.update({
          time: candle.time,
          value: candle.close,
        });
      } else {
        mainSeriesRef.current.update({
          time: candle.time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });
      }

      if (volumeSeriesRef.current && candle.volume !== undefined) {
        volumeSeriesRef.current.update({
          time: candle.time,
          value: candle.volume,
          color: candle.close >= candle.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
        });
      }
    } catch (e) {
      console.debug('Error updating candle:', e);
    }
  }, [mode]);

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Chart Container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading Overlay */}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(19, 23, 34, 0.8)' }}
        >
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#2962ff' }} />
            <span className="text-xs" style={{ color: '#787b86' }}>Loading chart...</span>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && !isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'rgba(19, 23, 34, 0.9)' }}
        >
          <div className="text-center">
            <div className="text-sm mb-2" style={{ color: '#ef5350' }}>{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded text-xs"
              style={{ background: '#2962ff', color: '#fff' }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Symbol & Timeframe Badge */}
      <div
        className="absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium"
        style={{ background: 'rgba(42, 46, 57, 0.9)', color: '#d1d4dc' }}
      >
        {symbol} • {timeframe.toUpperCase()}
      </div>
    </div>
  );
}