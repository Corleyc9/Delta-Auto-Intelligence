// v1.6.21: printable Bay Scan report + the file the reader attaches to the existing Tekmetric RO.
// Workers have no PDF library, so the branded layout is drawn with uncompressed PDF operators.
import { codeDescription } from "./bayscan-codes.ts";
import type { BayScan, ScanModule } from "./bayscan.ts";

export type ReportCode = { code: string; status: string; description: string };
export type ReportModule = { name: string; addr: string; codes: ReportCode[] };
export type BayScanReport = {
  scanId: number; ro: string; customer: string; vehicle: string; vin: string; scannedAt: string; when: string;
  deviceId: string; mileage: string; readiness: string; milOn: boolean; modules: ReportModule[];
};

export type RenderReportOptions = {
  /** Drawn as a banner on the PDF/HTML. Used only for layout previews, never on live scans. */
  sampleLabel?: string;
};

export function chicagoWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  const stamp = date.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  const zone = date.toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }).split(" ").pop() || "CST";
  return `${stamp} ${zone}`;
}

/** yyyymmdd-hhmm in America/Chicago, for BayScan-RO<ro>-<stamp>.pdf. Photos add seconds (yyyymmdd-hhmmss). */
export function chicagoStamp(iso: string, withSeconds = false) {
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  }).formatToParts(when);
  const get = (type: string) => (parts.find((part) => part.type === type)?.value || "").replace(/\D/g, "");
  let hour = get("hour").slice(-2).padStart(2, "0");
  if (hour === "24") hour = "00";
  const second = withSeconds ? get("second").slice(-2).padStart(2, "0") : "";
  return `${get("year")}${get("month").padStart(2, "0")}${get("day").padStart(2, "0")}-${hour}${get("minute").padStart(2, "0")}${second}`;
}

/** Stable Tekmetric filename. Unmatched photos use BayScan-scan<id> until an RO is known. */
export function photoFilename(scanId: number, photoId: number, capturedAt: string, ro = "") {
  const number = String(ro || "").replace(/\D/g, "");
  const who = number ? `RO${number}` : `scan${scanId}`;
  return `BayScan-${who}-photo-${chicagoStamp(capturedAt, true)}-${photoId}.jpg`;
}

export function reportFilename(ro: string, scannedAt: string, ext: "pdf" | "html" = "pdf") {
  const number = String(ro || "").replace(/\D/g, "") || "unmatched";
  return `BayScan-RO${number}-${chicagoStamp(scannedAt)}.${ext}`;
}

function moduleView(module: ScanModule): ReportModule {
  return {
    name: module.name || "Module", addr: module.addr || "",
    codes: module.codes.map((code) => ({ code: code.code, status: code.status || "stored", description: codeDescription(code.code, code.desc) })),
  };
}

export function buildReport(scan: BayScan, extra: { scanId?: number; ro?: string; customer?: string; vehicle?: string } = {}): BayScanReport {
  return {
    scanId: extra.scanId || 0, ro: extra.ro || "", customer: extra.customer || "", vehicle: extra.vehicle || "",
    vin: scan.vin, scannedAt: scan.scannedAt, when: chicagoWhen(scan.scannedAt), deviceId: scan.deviceId,
    mileage: scan.odometer === null || scan.odometer === undefined ? "" : `${scan.odometer.toLocaleString("en-US")} mi`,
    readiness: scan.readinessSummary || "", milOn: Boolean(scan.milOn),
    modules: (scan.modules || []).map(moduleView),
  };
}

export function reportLines(report: BayScanReport): string[] {
  const lines = [
    "Delta Auto Intelligence — Bay Scan report",
    "Check-in scan (triage, not a diagnosis)",
    "",
    report.ro ? `RO# ${report.ro}` : "RO# not matched",
  ];
  if (report.customer || report.vehicle) lines.push([report.customer, report.vehicle].filter(Boolean).join(" · "));
  lines.push(`VIN ${report.vin}`, `Scanned ${report.when} (America/Chicago)`, `Device ${report.deviceId}`);
  if (report.mileage) lines.push(`Mileage ${report.mileage}`);
  lines.push(`MIL ${report.milOn ? "ON" : "off"}`);
  if (report.readiness) lines.push(`Readiness: ${report.readiness}`);
  lines.push("", "Modules scanned");
  if (!report.modules.length) lines.push("No modules were reported.");
  for (const module of report.modules) {
    lines.push(`${module.name}${module.addr ? `  ${module.addr}` : ""}`);
    if (!module.codes.length) lines.push("  No codes");
    for (const code of module.codes) lines.push(`  ${code.code}  ${code.status}${code.description ? `  ${code.description}` : ""}`);
  }
  return lines;
}

function pdfEscape(text: string) {
  const ascii = text.replace(/[–—]/g, "-").replace(/[·•]/g, " | ").replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
  return ascii.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Single-font, uncompressed PDF. Kept for tests and as a last-resort fallback. */
export function renderTextPdf(lines: string[]): Uint8Array {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const leading = 14;
  const size = 10;
  const perPage = Math.max(1, Math.floor((pageHeight - margin * 2) / leading));
  const chunks: string[][] = [];
  const source = lines.length ? lines : ["Bay Scan report"];
  for (let index = 0; index < source.length; index += perPage) chunks.push(source.slice(index, index + perPage));

  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  chunks.forEach((pageLines, pageIndex) => {
    const contentId = 4 + pageIndex * 2;
    const pageId = contentId + 1;
    pageIds.push(pageId);
    const commands = ["BT", `/F1 ${size} Tf`, `${margin} ${pageHeight - margin} Td`];
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex) commands.push(`0 -${leading} Td`);
      commands.push(`(${pdfEscape(line)}) Tj`);
    });
    commands.push("ET");
    const data = `${commands.join("\n")}\n`;
    objects[contentId] = `<< /Length ${data.length} >>\nstream\n${data}endstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = body.length;
  const count = objects.length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) xref += `${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(body);
}

/* ---- Branded report (Pi screen colors, print-friendly white page) ---- */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const FOOTER_H = 46;
const HEADER_H = 78;
const HEADER2_H = 52;
const BLUE: Rgb = [0, 120 / 255, 1];
const BRAND: Rgb = [43 / 255, 44 / 255, 48 / 255];
const INK: Rgb = [28 / 255, 30 / 255, 34 / 255];
const MUTED: Rgb = [110 / 255, 114 / 255, 122 / 255];
const LINE: Rgb = [216 / 255, 220 / 255, 227 / 255];
const PAPER: Rgb = [1, 1, 1];
const CARD: Rgb = [244 / 255, 246 / 255, 249 / 255];
const ROW_ALT: Rgb = [247 / 255, 248 / 255, 250 / 255];
const ROW_MUTED: Rgb = [243 / 255, 244 / 255, 246 / 255];
const GREEN: Rgb = [16 / 255, 132 / 255, 58 / 255];
const GREEN_BG: Rgb = [226 / 255, 245 / 255, 232 / 255];
const AMBER: Rgb = [166 / 255, 102 / 255, 0];
const AMBER_BG: Rgb = [255 / 255, 241 / 255, 214 / 255];
const RED: Rgb = [196 / 255, 32 / 255, 38 / 255];
const RED_BG: Rgb = [252 / 255, 232 / 255, 232 / 255];
const BLUE_BG: Rgb = [230 / 255, 241 / 255, 255 / 255];
const WHITE: Rgb = [1, 1, 1];
const CHIP_GREY_TEXT: Rgb = [90 / 255, 94 / 255, 102 / 255];

type Rgb = [number, number, number];

// Adobe AFM widths, 1000-unit, characters 32-126. Helvetica then Helvetica-Bold.
const WIDTH_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WIDTH_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 667, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

function glyphWidth(ch: number, bold: boolean) {
  const table = bold ? WIDTH_BOLD : WIDTH_REG;
  if (ch < 32 || ch > 126) return table[0];
  return table[ch - 32];
}

function textWidth(text: string, size: number, bold = false) {
  let width = 0;
  const ascii = text.replace(/[–—]/g, "-").replace(/[·•]/g, " | ").replace(/[^\x20-\x7E]/g, "?");
  for (let i = 0; i < ascii.length; i += 1) width += glyphWidth(ascii.charCodeAt(i), bold);
  return width * size / 1000;
}

function wrapText(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  if (textWidth(raw, size, bold) <= maxWidth) return [raw];
  const words = raw.split(" ");
  const lines: string[] = [];
  let current = "";
  const push = (line: string) => { if (line) lines.push(line); };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth) { current = next; continue; }
    if (current) push(current);
    if (textWidth(word, size, bold) <= maxWidth) { current = word; continue; }
    let piece = "";
    for (const ch of word) {
      const trial = piece + ch;
      if (piece && textWidth(trial, size, bold) > maxWidth) { push(piece); piece = ch; } else piece = trial;
    }
    current = piece;
  }
  push(current);
  return lines.length ? lines : [raw];
}

function fmt(n: number) { return (Math.round(n * 1000) / 1000).toString(); }
function rgb(color: Rgb) { return `${fmt(color[0])} ${fmt(color[1])} ${fmt(color[2])}`; }

function circlePath(cx: number, cy: number, r: number) {
  const k = 0.5522847498 * r;
  return `${fmt(cx + r)} ${fmt(cy)} m `
    + `${fmt(cx + r)} ${fmt(cy + k)} ${fmt(cx + k)} ${fmt(cy + r)} ${fmt(cx)} ${fmt(cy + r)} c `
    + `${fmt(cx - k)} ${fmt(cy + r)} ${fmt(cx - r)} ${fmt(cy + k)} ${fmt(cx - r)} ${fmt(cy)} c `
    + `${fmt(cx - r)} ${fmt(cy - k)} ${fmt(cx - k)} ${fmt(cy - r)} ${fmt(cx)} ${fmt(cy - r)} c `
    + `${fmt(cx + k)} ${fmt(cy - r)} ${fmt(cx + r)} ${fmt(cy - k)} ${fmt(cx + r)} ${fmt(cy)} c`;
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = 0.5522847498 * radius;
  const x1 = x + w;
  const y1 = y + h;
  return `${fmt(x + radius)} ${fmt(y)} m `
    + `${fmt(x1 - radius)} ${fmt(y)} l `
    + `${fmt(x1 - radius + k)} ${fmt(y)} ${fmt(x1)} ${fmt(y + radius - k)} ${fmt(x1)} ${fmt(y + radius)} c `
    + `${fmt(x1)} ${fmt(y1 - radius)} l `
    + `${fmt(x1)} ${fmt(y1 - radius + k)} ${fmt(x1 - radius + k)} ${fmt(y1)} ${fmt(x1 - radius)} ${fmt(y1)} c `
    + `${fmt(x + radius)} ${fmt(y1)} l `
    + `${fmt(x + radius - k)} ${fmt(y1)} ${fmt(x)} ${fmt(y1 - radius + k)} ${fmt(x)} ${fmt(y1 - radius)} c `
    + `${fmt(x)} ${fmt(y + radius)} l `
    + `${fmt(x)} ${fmt(y + radius - k)} ${fmt(x + radius - k)} ${fmt(y)} ${fmt(x + radius)} ${fmt(y)} c`;
}

class PageBuf {
  cmds: string[] = [];
  fill(color: Rgb) { this.cmds.push(`${rgb(color)} rg`); }
  stroke(color: Rgb) { this.cmds.push(`${rgb(color)} RG`); }
  width(n: number) { this.cmds.push(`${fmt(n)} w`); }
  path(d: string, style: "f" | "s" | "b") { this.cmds.push(`${d} h ${style}`); }
  rect(x: number, y: number, w: number, h: number, color: Rgb) {
    this.fill(color);
    this.cmds.push(`${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`);
  }
  rrect(x: number, y: number, w: number, h: number, r: number, fill?: Rgb, stroke?: Rgb, sw = 1) {
    if (fill) this.fill(fill);
    if (stroke) { this.stroke(stroke); this.width(sw); }
    this.path(roundRectPath(x, y, w, h, r), fill && stroke ? "b" : fill ? "f" : "s");
  }
  circle(cx: number, cy: number, r: number, fill?: Rgb, stroke?: Rgb, sw = 1) {
    if (fill) this.fill(fill);
    if (stroke) { this.stroke(stroke); this.width(sw); }
    this.path(circlePath(cx, cy, r), fill && stroke ? "b" : fill ? "f" : "s");
  }
  text(str: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: Rgb; align?: "left" | "center" | "right" } = {}) {
    if (!str) return;
    const width = textWidth(str, size, !!opts.bold);
    let tx = x;
    if (opts.align === "center") tx = x - width / 2;
    if (opts.align === "right") tx = x - width;
    const font = opts.bold ? "/F2" : "/F1";
    const color = opts.color || INK;
    this.cmds.push(`${rgb(color)} rg`);
    this.cmds.push(`BT ${font} ${fmt(size)} Tf 1 0 0 1 ${fmt(tx)} ${fmt(y)} Tm (${pdfEscape(str)}) Tj ET`);
  }
}

function drawLogo(page: PageBuf, cx: number, cy: number, r: number) {
  page.circle(cx, cy, r, BLUE);
  // Friendly car mark in the same language as the Pi home-screen icon: rounded body, cabin, two wheels.
  const bodyW = r * 1.18;
  const bodyH = r * 0.36;
  const bodyY = cy - r * 0.12;
  const bodyX = cx - bodyW / 2;
  page.rrect(bodyX, bodyY, bodyW, bodyH, r * 0.14, WHITE);
  const cabinW = r * 0.56;
  const cabinH = r * 0.26;
  page.rrect(cx - r * 0.16, bodyY + bodyH - r * 0.03, cabinW, cabinH, r * 0.1, WHITE);
  const wheelR = r * 0.155;
  const wheelY = bodyY;
  page.circle(cx - r * 0.34, wheelY, wheelR, BRAND);
  page.circle(cx + r * 0.34, wheelY, wheelR, BRAND);
  page.circle(cx - r * 0.34, wheelY, wheelR * 0.42, BLUE);
  page.circle(cx + r * 0.34, wheelY, wheelR * 0.42, BLUE);
}

function titleCaseStatus(status: string) {
  const raw = String(status || "").trim();
  if (!raw) return "";
  return raw.replace(/[-_]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function statusStyle(status: string): { fill: Rgb; text: Rgb } {
  const key = status.toLowerCase();
  if (key === "confirmed" || key === "active" || key === "permanent") return { fill: RED_BG, text: RED };
  if (key === "pending") return { fill: AMBER_BG, text: AMBER };
  return { fill: ROW_MUTED, text: CHIP_GREY_TEXT };
}

function moduleLabel(module: ReportModule, continued = false) {
  const name = module.name || "Module";
  const addr = module.addr || "";
  const already = addr && name.toUpperCase().includes(addr.toUpperCase());
  const label = already || !addr ? name : name;
  return continued ? `${label} (cont.)` : label;
}

function moduleAddr(module: ReportModule) {
  const name = module.name || "";
  const addr = module.addr || "";
  if (!addr) return "";
  if (name.toUpperCase().includes(addr.toUpperCase())) return "";
  return addr;
}

/** Turn the sometimes-truncated readiness dump into a short, wrapped-safe note. */
export function formatReadinessNote(raw: string): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const open = /monitors\s*\((.*)$/i.exec(text);
  const inner = open ? open[1].replace(/\)\s*$/, "") : "";
  const pairs = inner.split(/;\s*/).map((part) => {
    const cut = part.trim();
    const idx = cut.indexOf(":");
    if (idx < 1) return null;
    const key = cut.slice(0, idx).trim();
    const val = cut.slice(idx + 1).trim().toLowerCase();
    if (!key || !val || /[^A-Za-z0-9 _/-]/.test(key)) return null;
    if (val.length < 2 || /[^a-z0-9 _-]/.test(val)) return null;
    return { key, val };
  }).filter(Boolean) as { key: string; val: string }[];
  const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  if (pairs.length) {
    const ready = pairs.filter((item) => item.val === "ready" || item.val === "complete" || item.val === "ok");
    const notReady = pairs.filter((item) => item.val !== "ready" && item.val !== "complete" && item.val !== "ok");
    if (notReady.length) return `Not ready: ${notReady.map((item) => `${label(item.key)} (${item.val})`).join(", ")}`;
    if (ready.length) return `Monitors ready: ${ready.map((item) => label(item.key)).join(", ")}`;
  }
  if (text.length > 160) return `${text.slice(0, 157).replace(/\s+\S*$/, "")}...`;
  return text;
}

type Chip = { label: string; fill: Rgb; text: Rgb };
type TableRow = {
  moduleName: string;
  moduleLines: string[];
  addr: string;
  code: string;
  descLines: string[];
  status: string;
  muted: boolean;
  firstOfModule: boolean;
};

const COL = { module: 126, code: 70, desc: 256, status: 88 };
const TABLE_W = COL.module + COL.code + COL.desc + COL.status; // 540, same as the vehicle card
const PAD = 7;
const CELL = 9;
const CELL_LEAD = 11;
const HEAD_SIZE = 8;

function measureRow(row: TableRow) {
  const lines = Math.max(row.moduleLines.length + (row.addr ? 1 : 0), row.descLines.length, 1);
  return PAD * 2 + lines * CELL_LEAD;
}

function buildRows(report: BayScanReport): TableRow[] {
  const descWidth = COL.desc - PAD * 2;
  const moduleWidth = COL.module - PAD * 2;
  if (!report.modules.length) {
    return [{ moduleName: "", moduleLines: ["No modules were reported."], addr: "", code: "", descLines: [], status: "", muted: true, firstOfModule: true }];
  }
  const rows: TableRow[] = [];
  for (const module of report.modules) {
    const addr = moduleAddr(module);
    const name = moduleLabel(module);
    if (!module.codes.length) {
      rows.push({
        moduleName: name,
        moduleLines: wrapText(name, CELL, true, moduleWidth),
        addr, code: "", descLines: ["No codes"], status: "", muted: true, firstOfModule: true,
      });
      continue;
    }
    module.codes.forEach((code, index) => {
      rows.push({
        moduleName: name,
        moduleLines: index === 0 ? wrapText(name, CELL, true, moduleWidth) : [],
        addr: index === 0 ? addr : "",
        code: code.code,
        descLines: wrapText(code.description || "-", CELL, false, descWidth),
        status: titleCaseStatus(code.status),
        muted: false,
        firstOfModule: index === 0,
      });
    });
  }
  return rows;
}

function chipsFor(report: BayScanReport): Chip[] {
  const modules = report.modules.length;
  const codes = report.modules.reduce((sum, module) => sum + module.codes.length, 0);
  const moduleChip: Chip = { label: modules === 0 ? "No modules" : modules === 1 ? "1 module" : `${modules} modules`, fill: BLUE_BG, text: [0, 80 / 255, 180 / 255] };
  const codeChip: Chip = codes === 0
    ? { label: "No codes", fill: GREEN_BG, text: GREEN }
    : { label: codes === 1 ? "1 code" : `${codes} codes`, fill: AMBER_BG, text: AMBER };
  const milChip: Chip = report.milOn
    ? { label: "MIL ON", fill: RED_BG, text: RED }
    : { label: "MIL off", fill: GREEN_BG, text: GREEN };
  return [moduleChip, codeChip, milChip];
}

function drawHeader(page: PageBuf, report: BayScanReport, pageIndex: number, continued: boolean) {
  const h = continued ? HEADER2_H : HEADER_H;
  const top = PAGE_H - h;
  page.rect(0, top, PAGE_W, h, BRAND);
  page.rect(0, top - 3, PAGE_W, 3, BLUE);
  const cy = top + h / 2 + (continued ? 0 : 2);
  const logoR = continued ? 13 : 18;
  const logoX = MARGIN + logoR;
  drawLogo(page, logoX, cy, logoR);
  const textX = logoX + logoR + 10;
  if (continued) {
    page.text("BAY SCAN", textX, cy + 2, 12, { bold: true, color: WHITE });
    const who = report.ro ? `RO ${report.ro}` : "Unmatched scan";
    page.text(`${who}  |  continued`, textX, cy - 11, 8, { color: [180 / 255, 184 / 255, 190 / 255] });
  } else {
    page.text("BAY SCAN", textX, cy + 8, 18, { bold: true, color: WHITE });
    page.text("Delta Auto", textX, cy - 8, 10, { color: [176 / 255, 180 / 255, 186 / 255] });
    page.text("Check-in report", PAGE_W - MARGIN, cy + 8, 10, { bold: true, color: WHITE, align: "right" });
    page.text(report.when || "", PAGE_W - MARGIN, cy - 8, 8, { color: [176 / 255, 180 / 255, 186 / 255], align: "right" });
  }
  return top - 3;
}

function drawFooter(page: PageBuf, report: BayScanReport, pageNo: number, pageCount: number) {
  page.rect(MARGIN, FOOTER_H - 2, PAGE_W - MARGIN * 2, 0.6, LINE);
  page.text("Bay Scan check-in quick scan. Triage only, not a diagnosis.", MARGIN, 26, 8, { color: MUTED });
  const device = report.deviceId ? `Scanned with Bay Scan (${report.deviceId})` : "Scanned with Bay Scan";
  page.text(device, MARGIN, 14, 7, { color: [150 / 255, 154 / 255, 160 / 255] });
  page.text(`Page ${pageNo} of ${pageCount}`, PAGE_W - MARGIN, 20, 8, { color: MUTED, align: "right" });
}

function drawChip(page: PageBuf, x: number, y: number, chip: Chip) {
  const size = 8.5;
  const padX = 9;
  const h = 18;
  const w = textWidth(chip.label, size, true) + padX * 2;
  page.rrect(x, y, w, h, 9, chip.fill);
  page.text(chip.label, x + w / 2, y + 5.2, size, { bold: true, color: chip.text, align: "center" });
  return w;
}

function fieldBlock(page: PageBuf, x: number, y: number, w: number, label: string, value: string, valueSize = 10, bold = false, color: Rgb = INK) {
  page.text(label.toUpperCase(), x, y + 16, 7, { bold: true, color: MUTED });
  const lines = wrapText(value || "-", valueSize, bold, w);
  lines.slice(0, 2).forEach((line, index) => page.text(line, x, y + 3 - index * 11, valueSize, { bold, color }));
}

function drawVehicleCard(page: PageBuf, report: BayScanReport, top: number) {
  const x = MARGIN;
  const w = PAGE_W - MARGIN * 2;
  const h = 86;
  const y = top - h;
  page.rrect(x, y, w, h, 8, CARD, LINE, 0.8);
  // Left accent that follows the card's rounded corners.
  page.rrect(x, y, 18, h, 8, BLUE);
  page.rect(x + 5, y, 14, h, CARD);
  const inner = x + 16;
  const col = (w - 28) / 3;
  const roValue = report.ro ? report.ro : "Not matched";
  const roColor: Rgb = report.ro ? [0, 90 / 255, 210 / 255] : INK;
  fieldBlock(page, inner, y + 50, col - 12, "Repair order", roValue, report.ro ? 16 : 11, true, roColor);
  fieldBlock(page, inner + col, y + 50, col - 12, "Customer", report.customer || "-", 10, true);
  fieldBlock(page, inner + col * 2, y + 50, col - 10, "Vehicle", report.vehicle || "-", 10, true);
  fieldBlock(page, inner, y + 16, col - 12, "VIN", report.vin || "-", 9, true);
  fieldBlock(page, inner + col, y + 16, col - 12, "Mileage", report.mileage || "Not reported", 10, false);
  fieldBlock(page, inner + col * 2, y + 16, col - 10, "Scan time", report.when || "-", 9, false);
  return y;
}

function drawTableHeader(page: PageBuf, yBottom: number) {
  const x = MARGIN;
  const h = 20;
  const y = yBottom - h;
  page.rrect(x, y, TABLE_W, h, 4, BRAND);
  // square off the bottom so it joins the rows
  page.rect(x, y, TABLE_W, 6, BRAND);
  let cx = x;
  const headers = [["Module", COL.module], ["Code", COL.code], ["Description", COL.desc], ["Status", COL.status]] as const;
  for (const [label, width] of headers) {
    page.text(label.toUpperCase(), cx + PAD, y + 6, HEAD_SIZE, { bold: true, color: WHITE });
    cx += width;
  }
  return y;
}

function drawRow(page: PageBuf, row: TableRow, yBottom: number, alt: boolean) {
  const h = measureRow(row);
  const y = yBottom - h;
  const x = MARGIN;
  const fill = row.muted ? ROW_MUTED : alt ? ROW_ALT : PAPER;
  page.rect(x, y, TABLE_W, h, fill);
  page.stroke(LINE);
  page.width(0.5);
  page.cmds.push(`${fmt(x)} ${fmt(y)} ${fmt(TABLE_W)} ${fmt(h)} re S`);
  let cx = x;
  const cols = [COL.module, COL.code, COL.desc, COL.status];
  for (let i = 0; i < 3; i += 1) {
    cx += cols[i];
    page.cmds.push(`${fmt(cx)} ${fmt(y)} m ${fmt(cx)} ${fmt(y + h)} l S`);
  }
  const textColor = row.muted ? MUTED : INK;
  const baseY = y + h - PAD - CELL + 2;
  const emptyList = row.muted && !row.code && row.descLines[0] !== "No codes";
  if (emptyList) {
    // One message across the row; no interior grid lines.
    page.rect(x + 0.6, y + 0.6, TABLE_W - 1.2, h - 1.2, ROW_MUTED);
    page.stroke(LINE);
    page.width(0.5);
    page.cmds.push(`${fmt(x)} ${fmt(y)} ${fmt(TABLE_W)} ${fmt(h)} re S`);
    page.text(row.moduleLines[0] || "No modules were reported.", x + PAD, baseY, CELL, { color: MUTED });
    return y;
  }
  if (row.code === "" && row.muted && row.descLines[0] === "No codes") {
    row.moduleLines.forEach((line, index) => page.text(line, x + PAD, baseY - index * CELL_LEAD, CELL, { bold: true, color: textColor }));
    if (row.addr) page.text(row.addr, x + PAD, baseY - row.moduleLines.length * CELL_LEAD, 7.5, { color: MUTED });
    page.text("-", x + COL.module + PAD, baseY, CELL, { color: MUTED });
    page.text("No codes", x + COL.module + COL.code + PAD, baseY, CELL, { color: MUTED });
    page.text("-", x + COL.module + COL.code + COL.desc + PAD, baseY, CELL, { color: MUTED });
    return y;
  }
  row.moduleLines.forEach((line, index) => page.text(line, x + PAD, baseY - index * CELL_LEAD, CELL, { bold: true, color: INK }));
  if (row.addr) page.text(row.addr, x + PAD, baseY - row.moduleLines.length * CELL_LEAD, 7.5, { color: MUTED });
  page.text(row.code, x + COL.module + PAD, baseY, CELL, { bold: true, color: INK });
  row.descLines.forEach((line, index) => page.text(line, x + COL.module + COL.code + PAD, baseY - index * CELL_LEAD, CELL, { color: INK }));
  if (row.status) {
    const style = statusStyle(row.status);
    const sw = Math.min(COL.status - 10, textWidth(row.status, 7.5, true) + 12);
    const sx = x + COL.module + COL.code + COL.desc + (COL.status - sw) / 2;
    const sy = y + h - PAD - 13;
    page.rrect(sx, sy, sw, 14, 7, style.fill);
    page.text(row.status, sx + sw / 2, sy + 3.8, 7.5, { bold: true, color: style.text, align: "center" });
  }
  return y;
}

function paginate(report: BayScanReport, options: RenderReportOptions = {}) {
  const rows = buildRows(report);
  const chips = chipsFor(report);
  const readiness = formatReadinessNote(report.readiness);
  const contentBottom = FOOTER_H + 8;
  const pages: { continued: boolean; showIntro: boolean; rows: TableRow[] }[] = [];
  let remaining = rows.slice();
  let first = true;
  while (remaining.length || first) {
    const continued = !first;
    const headerH = continued ? HEADER2_H : HEADER_H;
    let y = PAGE_H - headerH - 3 - 14;
    if (first) {
      y -= 86 + 12; // vehicle card + gap
      y -= 22; // chips
      if (readiness) y -= 16;
      if (options.sampleLabel) y -= 22;
    }
    y -= 20; // table header
    const pageRows: TableRow[] = [];
    while (remaining.length) {
      const row = remaining[0];
      const display = pageRows.length === 0 && !row.firstOfModule
        ? { ...row, moduleLines: wrapText(moduleLabel({ name: row.moduleName || "Module", addr: row.addr, codes: [] }, true), CELL, true, COL.module - PAD * 2), addr: row.addr, firstOfModule: true }
        : row;
      // If we split mid-module, re-label on the new page.
      const height = measureRow(display);
      if (pageRows.length && y - height < contentBottom) break;
      if (!pageRows.length && y - height < contentBottom) {
        // Force at least one row so a tall row still moves to this page.
      }
      remaining.shift();
      if (display !== row) pageRows.push(display); else pageRows.push(row);
      y -= height;
    }
    pages.push({ continued, showIntro: first, rows: pageRows });
    first = false;
    if (!remaining.length) break;
  }
  return { pages, chips, readiness };
}

function drawIntro(page: PageBuf, report: BayScanReport, chips: Chip[], readiness: string, sampleLabel: string | undefined, headerBottom: number) {
  let y = headerBottom - 14;
  if (sampleLabel) {
    const h = 18;
    page.rrect(MARGIN, y - h, PAGE_W - MARGIN * 2, h, 4, AMBER_BG, [230 / 255, 170 / 255, 40 / 255], 0.8);
    page.text(sampleLabel, PAGE_W / 2, y - h + 5, 8.5, { bold: true, color: AMBER, align: "center" });
    y -= h + 8;
  }
  y = drawVehicleCard(page, report, y) - 12;
  let x = MARGIN;
  for (const chip of chips) {
    x += drawChip(page, x, y - 18, chip) + 8;
  }
  y -= 26;
  if (readiness) {
    const lines = wrapText(readiness, 8, false, PAGE_W - MARGIN * 2);
    lines.forEach((line, index) => page.text(line, MARGIN, y - 10 - index * 10, 8, { color: MUTED }));
    y -= 10 + lines.length * 10;
  }
  return y;
}

export function renderBrandedPdf(report: BayScanReport, options: RenderReportOptions = {}): Uint8Array {
  const { pages, chips, readiness } = paginate(report, options);
  const pageCount = Math.max(1, pages.length);
  const buffers = pages.map((spec, index) => {
    const page = new PageBuf();
    const headerBottom = drawHeader(page, report, index, spec.continued);
    let y = headerBottom - 14;
    if (spec.showIntro) y = drawIntro(page, report, chips, readiness, options.sampleLabel, headerBottom);
    y = drawTableHeader(page, y);
    let alt = false;
    let lastModuleKey = "";
    for (const row of spec.rows) {
      const key = row.moduleLines.join(" ") + row.addr;
      if (row.firstOfModule) alt = !alt;
      if (key && key !== lastModuleKey && row.firstOfModule) { /* keep alt per module */ }
      lastModuleKey = key || lastModuleKey;
      y = drawRow(page, row, y, alt);
    }
    // Close the table with a bottom edge already drawn per row.
    drawFooter(page, report, index + 1, pageCount);
    return page.cmds.join("\n") + "\n";
  });

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  const pageIds: number[] = [];
  buffers.forEach((data, index) => {
    const contentId = 5 + index * 2;
    const pageId = contentId + 1;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${data.length} >>\nstream\n${data}endstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
  });
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let body = "%PDF-1.4\n";
  const offsets = [0];
  const maxId = objects.length - 1;
  for (let id = 1; id <= maxId; id += 1) {
    if (!objects[id]) continue;
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = body.length;
  const count = maxId + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) xref += `${String(offsets[id] || 0).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Self-contained HTML used only when PDF bytes cannot be built. */
export function reportDocumentHtml(report: BayScanReport, options: RenderReportOptions = {}) {
  const chips = chipsFor(report);
  const readiness = formatReadinessNote(report.readiness);
  const chipHtml = chips.map((chip) => {
    const bg = `rgb(${Math.round(chip.fill[0] * 255)},${Math.round(chip.fill[1] * 255)},${Math.round(chip.fill[2] * 255)})`;
    const fg = `rgb(${Math.round(chip.text[0] * 255)},${Math.round(chip.text[1] * 255)},${Math.round(chip.text[2] * 255)})`;
    return `<span class="chip" style="background:${bg};color:${fg}">${escapeHtml(chip.label)}</span>`;
  }).join("");
  const rows = report.modules.length ? report.modules.map((module) => {
    const addr = moduleAddr(module);
    const name = escapeHtml(moduleLabel(module)) + (addr ? `<div class="addr">${escapeHtml(addr)}</div>` : "");
    if (!module.codes.length) {
      return `<tr class="muted"><td>${name}</td><td></td><td>No codes</td><td>—</td></tr>`;
    }
    return module.codes.map((code, index) => {
      const style = statusStyle(titleCaseStatus(code.status));
      const bg = `rgb(${Math.round(style.fill[0] * 255)},${Math.round(style.fill[1] * 255)},${Math.round(style.fill[2] * 255)})`;
      const fg = `rgb(${Math.round(style.text[0] * 255)},${Math.round(style.text[1] * 255)},${Math.round(style.text[2] * 255)})`;
      return `<tr>${index === 0 ? `<td rowspan="${module.codes.length}">${name}</td>` : ""}<td>${escapeHtml(code.code)}</td><td>${escapeHtml(code.description || "")}</td><td><span class="st" style="background:${bg};color:${fg}">${escapeHtml(titleCaseStatus(code.status))}</span></td></tr>`;
    }).join("");
  }).join("") : `<tr class="muted"><td colspan="4">No modules were reported.</td></tr>`;
  const sample = options.sampleLabel ? `<div class="sample">${escapeHtml(options.sampleLabel)}</div>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bay Scan ${escapeHtml(report.ro || report.vin)}</title>
<style>
  body{font-family:Helvetica,Arial,sans-serif;color:#1c1e22;margin:0;background:#fff}
  .bar{background:#2b2c30;color:#fff;padding:18px 28px;border-bottom:3px solid #0078ff;display:flex;align-items:center;gap:14px}
  .logo{width:36px;height:36px;border-radius:50%;background:#0078ff;flex:none}
  h1{font-size:22px;margin:0;letter-spacing:.04em}
  .sub{color:#b0b4ba;font-size:13px;margin:2px 0 0}
  .right{margin-left:auto;text-align:right}
  .wrap{padding:20px 28px 28px}
  .card{background:#f4f6f9;border:1px solid #d8dce3;border-radius:8px;padding:14px 16px 14px 20px;border-left:5px solid #0078ff;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px 18px}
  .lab{font-size:10px;letter-spacing:.06em;color:#6e727a;font-weight:700;text-transform:uppercase}
  .val{font-size:14px;font-weight:700;margin-top:2px}
  .ro{color:#005ad2;font-size:20px}
  .chips{display:flex;gap:8px;margin:14px 0 8px;flex-wrap:wrap}
  .chip{border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700}
  .ready{color:#6e727a;font-size:12px;margin:0 0 14px}
  .sample{background:#fff1d6;color:#a66600;border:1px solid #e6aa28;border-radius:4px;text-align:center;padding:6px;font-weight:700;margin-bottom:12px;font-size:12px}
  table{border-collapse:collapse;width:100%}
  th{background:#2b2c30;color:#fff;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:left;padding:7px 8px}
  td{border:1px solid #d8dce3;padding:7px 8px;vertical-align:top;font-size:13px}
  tr.muted td{color:#6e727a;background:#f3f4f6}
  .addr{color:#6e727a;font-size:11px;font-weight:400}
  .st{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700}
  footer{color:#6e727a;font-size:11px;margin-top:18px;border-top:1px solid #d8dce3;padding-top:8px}
</style></head><body>
<div class="bar"><div class="logo"></div><div><h1>BAY SCAN</h1><div class="sub">Delta Auto</div></div><div class="right"><div>Check-in report</div><div class="sub">${escapeHtml(report.when || "")}</div></div></div>
<div class="wrap">${sample}
<div class="card">
  <div><div class="lab">Repair order</div><div class="val ro">${escapeHtml(report.ro || "Not matched")}</div></div>
  <div><div class="lab">Customer</div><div class="val">${escapeHtml(report.customer || "—")}</div></div>
  <div><div class="lab">Vehicle</div><div class="val">${escapeHtml(report.vehicle || "—")}</div></div>
  <div><div class="lab">VIN</div><div class="val">${escapeHtml(report.vin || "—")}</div></div>
  <div><div class="lab">Mileage</div><div class="val">${escapeHtml(report.mileage || "Not reported")}</div></div>
  <div><div class="lab">Scan time</div><div class="val">${escapeHtml(report.when || "—")}</div></div>
</div>
<div class="chips">${chipHtml}</div>
${readiness ? `<p class="ready">${escapeHtml(readiness)}</p>` : ""}
<table><thead><tr><th>Module</th><th>Code</th><th>Description</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<footer>Bay Scan check-in quick scan. Triage only, not a diagnosis.${report.deviceId ? ` Scanned with Bay Scan ${escapeHtml(report.deviceId)}.` : ""}</footer>
</div></body></html>`;
}

export function renderReportFile(report: BayScanReport, options: RenderReportOptions = {}): { bytes: Uint8Array; contentType: string; filename: string } {
  const filename = reportFilename(report.ro, report.scannedAt, "pdf");
  try {
    const bytes = renderBrandedPdf(report, options);
    if (bytes.byteLength < 32) throw new Error("empty pdf");
    return { bytes, contentType: "application/pdf", filename };
  } catch {
    const html = reportDocumentHtml(report, options);
    return { bytes: new TextEncoder().encode(html), contentType: "text/html; charset=utf-8", filename: reportFilename(report.ro, report.scannedAt, "html") };
  }
}
