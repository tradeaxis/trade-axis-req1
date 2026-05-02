import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const PDF_PAGE_WIDTH = 595;
const PDF_PAGE_HEIGHT = 842;
const PDF_MARGIN_LEFT = 40;
const PDF_TOP = 804;
const PDF_LINE_HEIGHT = 13;
const PDF_MAX_LINES = 56;
const PDF_WRAP_AT = 88;

const textEncoder = new TextEncoder();

const byteLength = (value) => textEncoder.encode(value).length;
const toBase64 = (value) => window.btoa(value);
const isNativePlatform = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch (_) {
    return false;
  }
};

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read PDF data'));
    reader.readAsDataURL(blob);
  });

const isMobileLikeDevice = () => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }

  const agent = String(navigator.userAgent || '').toLowerCase();
  const touchCapable = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  return /android|iphone|ipad|ipod|mobile/i.test(agent) || (touchCapable && window.innerWidth < 1024);
};

const escapePdfText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' ');

const wrapText = (text, maxChars = PDF_WRAP_AT) => {
  const source = String(text ?? '').trim();
  if (!source) return [''];

  const words = source.split(/\s+/);
  const lines = [];
  let current = '';

  const pushCurrent = () => {
    if (current) {
      lines.push(current);
      current = '';
    }
  };

  words.forEach((word) => {
    if (word.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      return;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      pushCurrent();
      current = word;
      return;
    }

    current = candidate;
  });

  pushCurrent();
  return lines.length ? lines : [''];
};

const buildContentStream = (lines) => {
  let y = PDF_TOP;
  const parts = ['BT', '/F1 10 Tf'];

  lines.forEach((line) => {
    parts.push(`1 0 0 1 ${PDF_MARGIN_LEFT} ${y} Tm`);
    parts.push(`(${escapePdfText(line)}) Tj`);
    y -= PDF_LINE_HEIGHT;
  });

  parts.push('ET');
  return parts.join('\n');
};

const buildPdfDocument = (pages) => {
  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentIds = pages.map((lines) => {
    const content = buildContentStream(lines);
    return addObject(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
  });

  const pagesObjectId = objects.length + pages.length + 1;
  const pageIds = pages.map((_, index) =>
    addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`,
    ),
  );
  const pagesId = addObject(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((objectBody, index) => {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
};

const paginateEntries = ({ headerLines, entries }) => {
  const pages = [];
  const baseLines = headerLines.flatMap((line) => wrapText(line));
  let current = [...baseLines];
  let remaining = PDF_MAX_LINES - current.length - 1;

  const pushNewPage = () => {
    pages.push(current);
    current = [...baseLines];
    remaining = PDF_MAX_LINES - current.length - 1;
  };

  const normalizedEntries = (entries || []).map((entry) =>
    (entry?.lines || []).flatMap((line) => wrapText(line)),
  );

  if (!normalizedEntries.length) {
    current.push('No records matched the selected filters.');
    pages.push(current);
    return pages;
  }

  normalizedEntries.forEach((entryLines) => {
    const block = [...entryLines, ''];

    block.forEach((line) => {
      if (remaining <= 0) {
        pushNewPage();
      }

      current.push(line);
      remaining -= 1;
    });
  });

  if (current.length) {
    pages.push(current);
  }

  return pages;
};

export const exportDealsPdf = async ({
  fileName,
  title,
  subtitleLines = [],
  summaryLines = [],
  entries = [],
}) => {
  const pages = paginateEntries({
    headerLines: [
      title,
      ...subtitleLines,
      '',
      ...summaryLines,
      '',
      'Records',
      '',
    ],
    entries,
  }).map((pageLines, index, pageList) => [
    ...pageLines,
    `Page ${index + 1} of ${pageList.length}`,
  ]);

  const pdf = buildPdfDocument(pages);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const file = typeof File === 'function'
    ? new File([blob], fileName, { type: 'application/pdf' })
    : null;
  const url = URL.createObjectURL(blob);

  if (
    file &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      title,
      files: [file],
    });
    return { method: 'share' };
  }

  if (isNativePlatform()) {
    try {
      const dataUrl = await blobToDataUrl(blob);
      await Browser.open({ url: dataUrl });
      return { method: 'browser' };
    } catch (_) {
      // Fall through to web-style export attempts below.
    }
  }

  if (isMobileLikeDevice()) {
    const blobPreviewLink = document.createElement('a');
    blobPreviewLink.href = url;
    blobPreviewLink.target = '_blank';
    blobPreviewLink.rel = 'noopener noreferrer';
    blobPreviewLink.download = fileName;
    document.body.appendChild(blobPreviewLink);
    blobPreviewLink.click();
    document.body.removeChild(blobPreviewLink);

    const dataUrl = `data:application/pdf;base64,${toBase64(pdf)}`;
    const dataPreviewLink = document.createElement('a');
    dataPreviewLink.href = dataUrl;
    dataPreviewLink.target = '_blank';
    dataPreviewLink.rel = 'noopener noreferrer';
    dataPreviewLink.download = fileName;
    document.body.appendChild(dataPreviewLink);
    dataPreviewLink.click();
    document.body.removeChild(dataPreviewLink);

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10000);
    return { method: 'preview' };
  }

  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10000);

  return { method: 'download' };
};
