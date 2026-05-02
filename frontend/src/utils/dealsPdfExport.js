import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PAGE_MARGIN_X = 40;
const PAGE_MARGIN_TOP = 42;
const PAGE_MARGIN_BOTTOM = 34;

const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
};

const sanitizeFileName = (value) => {
  const normalized = String(value || 'deals-report.pdf')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');

  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`;
};

const addWrappedText = (doc, lines = [], startY = PAGE_MARGIN_TOP) => {
  const maxWidth = doc.internal.pageSize.getWidth() - PAGE_MARGIN_X * 2;
  let cursorY = startY;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);

  lines
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .forEach((line) => {
      const wrappedLines = doc.splitTextToSize(line, maxWidth);
      doc.text(wrappedLines, PAGE_MARGIN_X, cursorY);
      cursorY += wrappedLines.length * 12;
    });

  return cursorY;
};

const addPageFooters = (doc) => {
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Page ${page} of ${pageCount}`,
      doc.internal.pageSize.getWidth() - PAGE_MARGIN_X,
      doc.internal.pageSize.getHeight() - 14,
      { align: 'right' },
    );
  }
};

const ensureAndroidStoragePermission = async () => {
  if (!isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }

  let permissions = await Filesystem.checkPermissions();
  if (permissions.publicStorage !== 'granted') {
    permissions = await Filesystem.requestPermissions();
  }

  if (permissions.publicStorage !== 'granted') {
    throw new Error('Storage permission was not granted');
  }
};

const savePdfToNativeDocuments = async (doc, fileName) => {
  await ensureAndroidStoragePermission();

  const relativePath = `TradeAxis/${sanitizeFileName(fileName)}`;
  const base64Data = String(doc.output('datauristring') || '').split(',')[1] || '';

  if (!base64Data) {
    throw new Error('Failed to generate PDF data');
  }

  await Filesystem.writeFile({
    path: relativePath,
    data: base64Data,
    directory: Directory.Documents,
    recursive: true,
  });

  const uriResult = await Filesystem.getUri({
    path: relativePath,
    directory: Directory.Documents,
  });

  return {
    method: 'saved',
    path: relativePath,
    uri: uriResult?.uri || null,
  };
};

const downloadPdfOnWeb = async (doc, fileName) => {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);

  return { method: 'download' };
};

export const exportDealsPdf = async ({
  fileName,
  title,
  subtitleLines = [],
  summaryRows = [],
  columns = [],
  rows = [],
}) => {
  const safeFileName = sanitizeFileName(fileName);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title,
    subject: 'Deals report',
    creator: 'Trade Axis',
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(String(title || 'Deals Report'), PAGE_MARGIN_X, PAGE_MARGIN_TOP);

  let cursorY = addWrappedText(doc, subtitleLines, PAGE_MARGIN_TOP + 20);
  cursorY += 10;

  if (summaryRows.length) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Summary', 'Value']],
      body: summaryRows.map(([label, value]) => [label, value]),
      margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: 5,
        overflow: 'linebreak',
        textColor: [30, 41, 59],
      },
      headStyles: {
        fillColor: [41, 98, 255],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 145, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
      },
    });

    cursorY = (doc.lastAutoTable?.finalY || cursorY) + 18;
  }

  const normalizedColumns = columns.map((column) => ({
    header: column.header,
    dataKey: column.key,
  }));

  autoTable(doc, {
    startY: cursorY,
    columns: normalizedColumns,
    body: rows,
    margin: {
      left: PAGE_MARGIN_X,
      right: PAGE_MARGIN_X,
      bottom: PAGE_MARGIN_BOTTOM,
    },
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      cellPadding: 4,
      overflow: 'linebreak',
      valign: 'middle',
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [38, 166, 154],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    columnStyles: {
      date: { cellWidth: 98 },
      symbol: { cellWidth: 78 },
      deal: { cellWidth: 70 },
      quantity: { cellWidth: 44, halign: 'right' },
      price: { cellWidth: 56, halign: 'right' },
      commission: { cellWidth: 62, halign: 'right' },
      amount: { cellWidth: 68, halign: 'right' },
      balanceAfter: { cellWidth: 68, halign: 'right' },
      note: { cellWidth: 'auto' },
    },
    didParseCell: ({ cell, column, row, section }) => {
      if (section !== 'body' || column.dataKey !== 'amount') {
        return;
      }

      const amountValue = Number(row.raw?.__amountValue || 0);
      if (amountValue > 0) {
        cell.styles.textColor = [38, 166, 154];
      } else if (amountValue < 0) {
        cell.styles.textColor = [239, 83, 80];
      }
    },
  });

  addPageFooters(doc);

  if (isNativePlatform()) {
    try {
      return await savePdfToNativeDocuments(doc, safeFileName);
    } catch (error) {
      console.error('Native PDF save failed, falling back to browser download:', error);
    }
  }

  return downloadPdfOnWeb(doc, safeFileName);
};
