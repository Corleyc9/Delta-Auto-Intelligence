import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";


export async function GET(request: Request) {
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const readerAuthorized = Boolean(env.READER_API_KEY) && request.headers.get("x-reader-key") === env.READER_API_KEY;
  if (readerAuthorized) {
    const selections = await env.DB.prepare(`SELECT ro_number, original_ro_number FROM warranty_claim_original_overrides`).all<Record<string, unknown>>();
    return Response.json({ overrides: Object.fromEntries(selections.results.map((row) => [String(row.ro_number), String(row.original_ro_number)])) });
  }
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const rows = await env.DB.prepare(`
    SELECT c.ro_number, c.claim_json, c.status, c.claim_number, c.payment_amount,
      c.review_note, c.captured_at, c.updated_at, o.original_ro_number AS original_ro_override
    FROM warranty_claims c LEFT JOIN warranty_claim_original_overrides o ON o.ro_number = c.ro_number
    ORDER BY CASE c.status WHEN 'needs_review' THEN 0 WHEN 'ready' THEN 1
      WHEN 'submitted' THEN 2 WHEN 'paid' THEN 3 ELSE 4 END, c.updated_at DESC
  `).all<Record<string, unknown>>();
  return Response.json({
    claims: rows.results.map((row) => ({
      ...JSON.parse(String(row.claim_json)),
      status: row.status,
      claimNumber: row.claim_number,
      paymentAmount: Number(row.payment_amount) || 0,
      reviewNote: row.review_note,
      originalRoOverride: row.original_ro_override || "",
      capturedAt: row.captured_at,
      updatedAt: row.updated_at,
    })),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const body = await request.json() as {
    roNumber?: string;
    status?: string;
    claimNumber?: string;
    paymentAmount?: number;
    reviewNote?: string;
    originalRoNumber?: string;
  };
  const roNumber = String(body.roNumber || "").replace(/\D/g, "");
  const selectedOriginal = String(body.originalRoNumber || "").replace(/\D/g, "");
  if (roNumber && selectedOriginal) {
    if (Number(selectedOriginal) >= Number(roNumber)) {
      return Response.json({ error: "The original RO must have a lower number than the current RO." }, { status: 400 });
    }
    const updatedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO warranty_claim_original_overrides (ro_number, original_ro_number, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(ro_number) DO UPDATE SET original_ro_number = excluded.original_ro_number, updated_at = excluded.updated_at`).bind(roNumber, selectedOriginal, updatedAt),
      env.DB.prepare(`UPDATE warranty_claims SET status = 'needs_review', review_note = ?, updated_at = ? WHERE ro_number = ?`).bind(`Waiting for reader to load original RO#${selectedOriginal}`, updatedAt, roNumber),
    ]);
    return Response.json({ ok: true, originalRoNumber: selectedOriginal, updatedAt });
  }
  const allowed = ["needs_review", "ready", "submitted", "paid", "dismissed"];
  if (!roNumber || !allowed.includes(String(body.status))) {
    return Response.json({ error: "Invalid warranty claim update" }, { status: 400 });
  }
  const updatedAt = new Date().toISOString();
  const result = await env.DB.prepare(`
    UPDATE warranty_claims SET status = ?, claim_number = ?, payment_amount = ?,
      review_note = ?, updated_at = ? WHERE ro_number = ?
  `).bind(
    body.status,
    String(body.claimNumber || "").trim().slice(0, 120),
    Math.max(0, Number(body.paymentAmount) || 0),
    String(body.reviewNote || "").trim().slice(0, 2000),
    updatedAt,
    roNumber,
  ).run();
  if (!result.meta.changes) return Response.json({ error: "Claim not found" }, { status: 404 });
  return Response.json({ ok: true, updatedAt });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY) {
    return Response.json({ error: "Unauthorized reader" }, { status: 401 });
  }
  const body = await request.json() as { claims?: Record<string, unknown>[]; capturedAt?: string };
  if (!Array.isArray(body.claims)) return Response.json({ error: "Invalid warranty payload" }, { status: 400 });
  await ensureSchema(env.DB);
  const capturedAt = String(body.capturedAt || new Date().toISOString());
  let saved = 0;
  for (const raw of body.claims.slice(0, 100)) {
    const roNumber = String(raw.roNumber || "").replace(/\D/g, "");
    if (!roNumber) continue;
    const claim = {
      roNumber,
      customer: String(raw.customer || "").slice(0, 240),
      phone: String(raw.phone || "").slice(0, 80),
      email: String(raw.email || "").slice(0, 240),
      vehicle: String(raw.vehicle || "").slice(0, 300),
      vin: String(raw.vin || "").slice(0, 40),
      currentRoUrl: String(raw.currentRoUrl || "").slice(0, 1000),
      originalRoNumber: String(raw.originalRoNumber || "").slice(0, 40),
      originalRoUrl: String(raw.originalRoUrl || "").slice(0, 1000),
      currentRepairDate: String(raw.currentRepairDate || "").slice(0, 80),
      currentMileage: String(raw.currentMileage || "").slice(0, 80),
      originalRepairDate: String(raw.originalRepairDate || "").slice(0, 80),
      originalMileage: String(raw.originalMileage || "").slice(0, 80),
      originalLaborRate: Number(raw.originalLaborRate) || 0,
      originalLaborAmount: Number(raw.originalLaborAmount) || 0,
      partNumbers: Array.isArray(raw.partNumbers) ? raw.partNumbers.slice(0, 30).map(String) : [],
      quantities: Array.isArray(raw.quantities) ? raw.quantities.slice(0, 30).map(String) : [],
      napaInvoices: Array.isArray(raw.napaInvoices) ? raw.napaInvoices.slice(0, 30).map((item) => ({
        partNumber: String((item as Record<string, unknown>)?.partNumber || "").slice(0, 80),
        invoiceNumber: String((item as Record<string, unknown>)?.invoiceNumber || "").slice(0, 80),
        poNumber: String((item as Record<string, unknown>)?.poNumber || "").slice(0, 80),
      })) : [],
      laborHours: Number(raw.laborHours) || 0,
      partStore: String(raw.partStore || "").slice(0, 300),
      customerComplaint: String(raw.customerComplaint || "").slice(0, 2000),
      originalRepair: String(raw.originalRepair || "").slice(0, 3000),
      failureSymptoms: String(raw.failureSymptoms || "").slice(0, 2000),
      diagnosis: String(raw.diagnosis || "").slice(0, 2000),
      failureDraft: String(raw.failureDraft || "").slice(0, 2000),
      missingFields: Array.isArray(raw.missingFields) ? raw.missingFields.slice(0, 40).map(String) : [],
      candidatePreviousRos: Array.isArray(raw.candidatePreviousRos) ? raw.candidatePreviousRos.slice(0, 10) : [],
      evidenceNotes: String(raw.evidenceNotes || "").slice(0, 2000),
      serviceWriter: String(raw.serviceWriter || "Unassigned").slice(0, 160),
    };
    const sourceHash = String(raw.sourceHash || "").slice(0, 128);
    const defaultStatus = claim.missingFields.length ? "needs_review" : "ready";
    await env.DB.prepare(`
      INSERT INTO warranty_claims
        (ro_number, claim_json, source_hash, status, captured_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ro_number) DO UPDATE SET
        claim_json = excluded.claim_json,
        source_hash = excluded.source_hash,
        status = CASE
          WHEN warranty_claims.source_hash <> excluded.source_hash
            AND warranty_claims.status IN ('dismissed', 'paid') THEN excluded.status
          ELSE warranty_claims.status END,
        captured_at = excluded.captured_at,
        updated_at = CASE WHEN warranty_claims.source_hash <> excluded.source_hash
          THEN excluded.updated_at ELSE warranty_claims.updated_at END
    `).bind(roNumber, JSON.stringify(claim), sourceHash, defaultStatus, capturedAt, capturedAt).run();
    saved += 1;
  }
  return Response.json({ ok: true, saved }, { status: 201 });
}
