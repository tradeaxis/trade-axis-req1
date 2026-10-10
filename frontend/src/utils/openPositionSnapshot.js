import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const SNAPSHOT_STORAGE_KEY = 'trade_axis_open_position_snapshots_v1';

const readSnapshots = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch (_) {
    return {};
  }
};

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const toBase64 = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};

const safeFileName = (value) => String(value || 'open-positions.csv')
  .replace(/[\\/:*?"<>|]+/g, '-')
  .replace(/\s+/g, '-')
  .toLowerCase();

export const getOpenPositionSnapshot = (accountId) => {
  if (!accountId) return null;
  return readSnapshots()[String(accountId)] || null;
};

export const saveOpenPositionSnapshot = ({ accountId, positions = [], capturedAt = new Date().toISOString() }) => {
  if (!accountId) return null;

  const snapshots = readSnapshots();
  const snapshot = {
    accountId: String(accountId),
    capturedAt,
    positions: Array.isArray(positions) ? positions : [],
  };
  snapshots[snapshot.accountId] = snapshot;

  // Keep storage bounded while retaining the latest account snapshots.
  const retained = Object.values(snapshots)
    .sort((left, right) => new Date(right.capturedAt || 0) - new Date(left.capturedAt || 0))
    .slice(0, 20)
    .reduce((result, item) => ({ ...result, [item.accountId]: item }), {});

  localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(retained));
  return snapshot;
};

export const exportOpenPositionsCsv = async ({ accountId, positions = [], capturedAt }) => {
  const exportTime = new Date().toISOString();
  const rows = [
    ['Trade Axis Open Positions Snapshot'],
    ['Account ID', accountId || '-'],
    ['Last successful sync', capturedAt || '-'],
    ['Exported at', exportTime],
    [],
    ['Trade ID', 'Symbol', 'Side', 'Quantity', 'Open Price', 'Last Known Price', 'Last Known P&L', 'Margin', 'Stop Loss', 'Take Profit', 'Opened At'],
    ...(positions || []).map((trade) => [
      trade.id,
      trade.symbol,
      String(trade.trade_type || '').toUpperCase(),
      trade.quantity,
      Number(trade.open_price || 0).toFixed(2),
      Number(trade.current_price || trade.open_price || 0).toFixed(2),
      Number(trade.live_profit ?? trade.profit ?? 0).toFixed(2),
      Number(trade.margin || 0).toFixed(2),
      Number(trade.stop_loss || 0).toFixed(2),
      Number(trade.take_profit || 0).toFixed(2),
      trade.open_time || trade.created_at || '',
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const fileName = safeFileName(`trade-axis-open-positions-${new Date().toISOString().slice(0, 10)}.csv`);

  if (Capacitor.isNativePlatform()) {
    const relativePath = `TradeAxis/${fileName}`;
    await Filesystem.writeFile({
      path: relativePath,
      data: toBase64(csv),
      directory: Directory.Documents,
      recursive: true,
    });
    const uri = await Filesystem.getUri({ path: relativePath, directory: Directory.Documents });
    return { method: 'saved', path: relativePath, uri: uri?.uri || null };
  }

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { method: 'download' };
};
