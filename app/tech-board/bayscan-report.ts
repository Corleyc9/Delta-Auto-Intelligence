// v1.6.21: printable Bay Scan report + the file the reader attaches to the existing Tekmetric RO.
import { codeDescription } from "./bayscan-codes.ts";
import type { BayScan, ScanModule } from "./bayscan.ts";

export type ReportCode = { code: string; status: string; description: string };
export type ReportModule = { name: string; addr: string; codes: ReportCode[] };
export type BayScanReport = {
  scanId: number; ro: string; customer: string; vehicle: string; vin: string; scannedAt: string; when: string;
  deviceId: string; mileage: string; readiness: string; milOn: boolean; modules: ReportModule[];
};

export function chicagoWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  return date.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
}

/** yyyymmdd-hhmm in America/Chicago, for BayScan-RO<ro>-<stamp>.pdf. */
export function chicagoStamp(iso: string) {
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(when);
  const get = (type: string) => (parts.find((part) => part.type === type)?.value || "").replace(/\D/g, "");
  let hour = get("hour").slice(-2).padStart(2, "0");
  if (hour === "24") hour = "00";
  return `${get("year")}${get("month").padStart(2, "0")}${get("day").padStart(2, "0")}-${hour}${get("minute").padStart(2, "0")}`;
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

/** Single-font, uncompressed PDF. Workers have no PDF library; this is enough for a text report. */
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

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Self-contained HTML used only when PDF bytes cannot be built. */
export function reportDocumentHtml(report: BayScanReport) {
  const rows = report.modules.length ? report.modules.map((module) => {
    if (!module.codes.length) {
      return `<tr><td>${escapeHtml(module.name)}</td><td>${escapeHtml(module.addr)}</td><td colspan="3">No codes</td></tr>`;
    }
    return module.codes.map((code, index) => `<tr>${index === 0 ? `<td rowspan="${module.codes.length}">${escapeHtml(module.name)}</td><td rowspan="${module.codes.length}">${escapeHtml(module.addr)}</td>` : ""}<td>${escapeHtml(code.code)}</td><td>${escapeHtml(code.status)}</td><td>${escapeHtml(code.description)}</td></tr>`).join("");
  }).join("") : `<tr><td colspan="5">No modules were reported.</td></tr>`;
  const facts = [
    report.ro ? `RO# ${escapeHtml(report.ro)}` : "RO# not matched",
    report.customer || report.vehicle ? escapeHtml([report.customer, report.vehicle].filter(Boolean).join(" · ")) : "",
    `VIN ${escapeHtml(report.vin)}`,
    `Scanned ${escapeHtml(report.when)} (America/Chicago)`,
    `Device ${escapeHtml(report.deviceId)}`,
    report.mileage ? `Mileage ${escapeHtml(report.mileage)}` : "",
    report.readiness ? `Readiness: ${escapeHtml(report.readiness)}` : "",
  ].filter(Boolean).map((line) => `<p>${line}</p>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bay Scan ${escapeHtml(report.ro || report.vin)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;margin:32px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px 8px;text-align:left;vertical-align:top}h1{font-size:20px}</style>
</head><body><h1>Bay Scan report</h1><p>Check-in scan (triage, not a diagnosis)</p>${facts}
<table><thead><tr><th>Module</th><th>Address</th><th>Code</th><th>Status</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

export function renderReportFile(report: BayScanReport): { bytes: Uint8Array; contentType: string; filename: string } {
  const filename = reportFilename(report.ro, report.scannedAt, "pdf");
  try {
    const bytes = renderTextPdf(reportLines(report));
    if (bytes.byteLength < 32) throw new Error("empty pdf");
    return { bytes, contentType: "application/pdf", filename };
  } catch {
    const html = reportDocumentHtml(report);
    return { bytes: new TextEncoder().encode(html), contentType: "text/html; charset=utf-8", filename: reportFilename(report.ro, report.scannedAt, "html") };
  }
}
