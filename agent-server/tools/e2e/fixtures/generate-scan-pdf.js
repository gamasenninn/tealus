#!/usr/bin/env node
/**
 * E2E test fixture generator: scan-like PDF (#262 Phase 2)
 *
 * pdf-parse の library 抽出が空白のみ返す PDF を生成する。
 * tealus-mcp の read_document で vision fallback (Gemini) が triggered される
 * 経路を E2E から自動 verify するため。
 *
 * 設計:
 * - 1 page、blank (text / image なし) の最小 PDF を **手書き** で生成
 * - pdf-lib / pdfkit の出力は pdf-parse v1.10.100 (tealus-mcp の bundled pdf.js)
 *   で "Invalid PDF structure" / "bad XRef entry" になるため、両 library 不可
 * - 手書きで old-school 形式 (xref table 直書き) なら pdf-parse compatible
 *
 * pdf-parse の処理:
 *   text="" → nonWsLength=0 → tealus-mcp の vision fallback path 起動
 *   → Gemini が呼ばれて空 page を OCR、応答 "(本文なし)" or 短 text
 *   → extraction_method=vision_gemini になり S3 が PASS
 *
 * Usage:
 *   node tools/e2e/fixtures/generate-scan-pdf.js
 *
 * 出力: ./sample-scan.pdf (~250 bytes)
 */
const fs = require('fs');
const path = require('path');

function buildBlankPdf() {
  // 各 object を string で組み立て、累積 offset を xref に書き込む
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n';
  const obj4 = '4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n';

  const offset1 = header.length;
  const offset2 = offset1 + obj1.length;
  const offset3 = offset2 + obj2.length;
  const offset4 = offset3 + obj3.length;
  const xrefOffset = offset4 + obj4.length;

  // xref table (10-digit zero-padded byte offset + 5-digit generation + 'n'/'f')
  // Note: xref entry ends with " \n" (space + newline) — 各 entry 20 bytes 固定
  const pad10 = (n) => String(n).padStart(10, '0');
  const xref =
    'xref\n' +
    '0 5\n' +
    '0000000000 65535 f\r\n' +
    `${pad10(offset1)} 00000 n\r\n` +
    `${pad10(offset2)} 00000 n\r\n` +
    `${pad10(offset3)} 00000 n\r\n` +
    `${pad10(offset4)} 00000 n\r\n`;

  const trailer =
    'trailer\n' +
    '<< /Size 5 /Root 1 0 R >>\n' +
    `startxref\n${xrefOffset}\n` +
    '%%EOF\n';

  return header + obj1 + obj2 + obj3 + obj4 + xref + trailer;
}

function main() {
  const pdf = buildBlankPdf();
  const outPath = path.join(__dirname, 'sample-scan.pdf');
  fs.writeFileSync(outPath, pdf, 'binary');
  console.log(`Generated: ${outPath} (${pdf.length} bytes)`);
}

main();
