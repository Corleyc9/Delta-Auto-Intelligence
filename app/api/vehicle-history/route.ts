import { requireApiUser } from "@/app/chatgpt-auth";
import { ensureSchema } from "@/db/ensure-schema";
import { runtimeEnv } from "@/app/lib/runtime";


export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth instanceof Response) return auth;
  const env = await runtimeEnv();
  await ensureSchema(env.DB);
  const key = new URL(request.url).searchParams.get("customerKey");
  if (key) {
    const customer = await env.DB.prepare(`SELECT * FROM tekmetric_customer_history WHERE customer_key=?`).bind(key).first();
    const repairOrders = await env.DB.prepare(`SELECT * FROM tekmetric_paid_ro_history WHERE customer_key=? ORDER BY posted_date DESC`).bind(key).all();
    return Response.json({ customer, repairOrders: repairOrders.results });
  }
  const counts = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM tekmetric_customer_history) customers,
    (SELECT COUNT(*) FROM tekmetric_paid_ro_history) paid_ros,
    (SELECT MAX(updated_at) FROM tekmetric_customer_history) updated_at`).first<Record<string, unknown>>();
  return Response.json({ customers:Number(counts?.customers||0), paidROs:Number(counts?.paid_ros||0), updatedAt:counts?.updated_at||null });
}

export async function POST(request: Request) {
  const env = await runtimeEnv();
  if (!env.READER_API_KEY || request.headers.get("x-reader-key") !== env.READER_API_KEY)
    return Response.json({ error:"Unauthorized reader" }, { status:401 });
  const body = await request.json() as Record<string, unknown>;
  const customerKey = String(body.customerKey||"").slice(0,300);
  const customerName = String(body.customerName||"").slice(0,300);
  const vehicles = Array.isArray(body.vehicles) ? body.vehicles.slice(0,200) : [];
  const ros = Array.isArray(body.repairOrders) ? body.repairOrders.slice(0,1000) as Record<string,unknown>[] : [];
  if (!customerKey || !customerName) return Response.json({error:"Customer identity is required"},{status:400});
  await ensureSchema(env.DB);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO tekmetric_customer_history
    (customer_key,customer_name,customer_url,vehicles_json,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(customer_key) DO UPDATE SET customer_name=excluded.customer_name,
    customer_url=excluded.customer_url,vehicles_json=excluded.vehicles_json,updated_at=excluded.updated_at`)
    .bind(customerKey,customerName,String(body.customerUrl||"").slice(0,1200),JSON.stringify(vehicles),updatedAt).run();
  for (const ro of ros) {
    const number = String(ro.roNumber||"").replace(/\D/g,"").slice(0,30);
    if (!number) continue;
    await env.DB.prepare(`INSERT INTO tekmetric_paid_ro_history
      (ro_number,customer_key,customer_name,vehicle,ro_url,posted_date,odometer_out,total,detail_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ro_number) DO UPDATE SET
      customer_key=excluded.customer_key,customer_name=excluded.customer_name,vehicle=excluded.vehicle,
      ro_url=excluded.ro_url,posted_date=excluded.posted_date,odometer_out=excluded.odometer_out,
      total=excluded.total,detail_json=excluded.detail_json,updated_at=excluded.updated_at`)
      .bind(number,customerKey,customerName,String(ro.vehicle||"").slice(0,500),String(ro.url||"").slice(0,1200),
      String(ro.postedDate||"").slice(0,40),String(ro.odometerOut||"").slice(0,50),Number(ro.total||0),JSON.stringify(ro.detail||{}),updatedAt).run();
  }
  return Response.json({ok:true,customerKey,repairOrders:ros.length,updatedAt});
}
