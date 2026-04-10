import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import api from '../../services/api';

export default function Mt5Chart({ symbol = 'RELIANCE', timeframe = '1h' }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const chart = createChart(hostRef.current, {
      layout: {
        background: { color: '#000000' },     // MT5 chart area is usually black
        textColor: '#cfd8dc',
      },
      grid: {
        vertLines: { color: '#1f1f1f' },
        horzLines: { color: '#1f1f1f' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#2d3446' },
      timeScale: { borderColor: '#2d3446', timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
      width: hostRef.current.clientWidth,
      height: hostRef.current.clientHeight,
    });

    const candles = chart.addCandlestickSeries({
      upColor: '#00ff00',           // MT5-style green
      downColor: '#ff0000',         // MT5-style red
      borderUpColor: '#00ff00',
      borderDownColor: '#ff0000',
      wickUpColor: '#00ff00',
      wickDownColor: '#ff0000',
    });

    chartRef.current = chart;
    seriesRef.current = candles;

    const onResize = () => {
      if (!hostRef.current) return;
      chart.applyOptions({
        width: hostRef.current.clientWidth,
        height: hostRef.current.clientHeight,
      });
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/market/candles/${symbol}?timeframe=${timeframe}&count=300`);
        const data = res.data?.data || [];
        if (seriesRef.current) {
          seriesRef.current.setData(data);
          chartRef.current?.timeScale().fitContent();
        }
      } catch (e) {
        console.error('Chart load error:', e);
      }
    };
    load();
  }, [symbol, timeframe]);

  return (
    <div className="w-full h-full">
      <div ref={hostRef} className="w-full h-full" />
    </div>
  );
}