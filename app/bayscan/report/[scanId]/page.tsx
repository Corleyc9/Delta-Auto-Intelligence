import { getDashboardUser } from "@/app/chatgpt-auth";
import { tekAttachLabel } from "@/app/tech-board/bayscan";
import { buildReport, type BayScanReport } from "@/app/tech-board/bayscan-report";
import { getScan } from "@/app/tech-board/bayscan-store";
import { initializeTechBoard, loadSyncedRos, techBoardDb } from "@/app/tech-board/store";
import PrintButton from "../PrintButton";
import ReportLogin from "../ReportLogin";

export const dynamic = "force-dynamic";

function ReportDocument({ report, tek }: { report: BayScanReport; tek: string }) {
  return (
    <main className="bayscan-report">
      <style>{`
        .bayscan-report { max-width: 820px; margin: 24px auto; padding: 28px 32px 48px; background: #fff; color: #1a1a1a; border-radius: 8px; }
        .bayscan-report h1 { font-size: 22px; margin: 0 0 4px; }
        .bayscan-kicker { margin: 0 0 16px; color: #444; }
        .bayscan-facts { display: grid; grid-template-columns: 160px 1fr; gap: 4px 12px; margin: 0 0 18px; }
        .bayscan-facts dt { font-weight: 700; }
        .bayscan-facts dd { margin: 0; }
        .bayscan-report table { width: 100%; border-collapse: collapse; }
        .bayscan-report th, .bayscan-report td { border: 1px solid #222; padding: 6px 8px; text-align: left; vertical-align: top; }
        .bayscan-report th { background: #f2f2f2; }
        .bayscan-actions { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        .bayscan-print, .bayscan-back { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #222; background: #fff; color: #111; cursor: pointer; text-decoration: none; }
        .bayscan-missing { max-width: 640px; margin: 48px auto; color: #f4f7fa; }
        @media print {
          body { background: #fff !important; color: #000 !important; }
          .bayscan-actions { display: none !important; }
          .bayscan-report { margin: 0; max-width: none; border-radius: 0; }
          @page { margin: 0.6in; }
        }
      `}</style>
      <div className="bayscan-actions">
        <a className="bayscan-back" href="/tech-board">Back to Tech Board</a>
        <PrintButton />
      </div>
      <h1>Bay Scan report</h1>
      <p className="bayscan-kicker">Check-in scan (triage, not a diagnosis)</p>
      <dl className="bayscan-facts">
        <dt>RO</dt><dd>{report.ro ? `RO#${report.ro}` : "Not matched"}</dd>
        {(report.customer || report.vehicle) && <><dt>Customer / vehicle</dt><dd>{[report.customer, report.vehicle].filter(Boolean).join(" · ")}</dd></>}
        <dt>VIN</dt><dd>{report.vin}</dd>
        <dt>Scan time</dt><dd>{report.when} (America/Chicago)</dd>
        <dt>Device</dt><dd>{report.deviceId || "—"}</dd>
        {report.mileage && <><dt>Mileage</dt><dd>{report.mileage}</dd></>}
        {report.readiness && <><dt>Readiness</dt><dd>{report.readiness}</dd></>}
        {tek && <><dt>Tekmetric</dt><dd>{tek}</dd></>}
      </dl>
      <table>
        <thead><tr><th>Module</th><th>Address</th><th>Code</th><th>Status</th><th>Description</th></tr></thead>
        <tbody>
          {report.modules.length === 0 && <tr><td colSpan={5}>No modules were reported.</td></tr>}
          {report.modules.map((module) => module.codes.length === 0
            ? <tr key={`${module.name}-${module.addr}`}><td>{module.name}</td><td>{module.addr || "—"}</td><td colSpan={3}>No codes</td></tr>
            : module.codes.map((code, index) => (
              <tr key={`${module.name}-${module.addr}-${code.code}-${code.status}-${index}`}>
                {index === 0 && <td rowSpan={module.codes.length}>{module.name}</td>}
                {index === 0 && <td rowSpan={module.codes.length}>{module.addr || "—"}</td>}
                <td>{code.code}</td>
                <td>{code.status}</td>
                <td>{code.description || "—"}</td>
              </tr>
            )))}
        </tbody>
      </table>
    </main>
  );
}

export default async function BayScanReportPage({ params }: { params: Promise<{ scanId: string }> }) {
  const user = await getDashboardUser();
  if (!user) return <ReportLogin />;
  const { scanId } = await params;
  const id = Number(scanId);
  if (!Number.isInteger(id) || id < 1) return <main className="bayscan-missing"><h1>Scan not found</h1></main>;
  const db = await techBoardDb();
  await initializeTechBoard(db);
  const stored = await getScan(db as never, id);
  if (!stored) return <main className="bayscan-missing"><h1>Scan not found</h1><p><a href="/tech-board">Back to Tech Board</a></p></main>;
  const ros = await loadSyncedRos(db);
  const matched = stored.ro ? ros.find((item) => item.ro === stored.ro) : undefined;
  const report = buildReport(stored.scan, { scanId: stored.id, ro: stored.ro, customer: matched?.customer || "", vehicle: matched?.vehicle || "" });
  return <ReportDocument report={report} tek={tekAttachLabel(stored.tekStatus, stored.tekError)} />;
}
