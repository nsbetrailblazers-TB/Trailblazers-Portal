import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@6.10.1";

const REPORT_INBOX = "nsbe.trailblazers@gmail.com";

Deno.serve(async (req: Request) => {
  const reply = (status: number, body: unknown, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });

  const allowedOrigins = [
    "https://trailblazers-portal.vercel.app",
    "https://trailblazers-portal-nsbetrailblazers-9790.vercel.app",
    ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean)
  ];
  const origin = req.headers.get("origin") || "";
  const isAllowedOrigin = (value: string) => {
    if (allowedOrigins.includes(value)) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" && parsed.origin === value &&
        /^trailblazers-portal-[a-z0-9-]+-nsbetrailblazers-9790\.vercel\.app$/i.test(parsed.hostname);
    } catch { return false; }
  };
  const originAllowed = isAllowedOrigin(origin);
  const corsHeaders = {
    "Access-Control-Allow-Origin": originAllowed ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "POST required" }, corsHeaders);
  if (!originAllowed) return reply(403, { error: "This portal address is not authorized." }, corsHeaders);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sender = Deno.env.get("GMAIL_SMTP_USER");
  const password = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
  if (!supabaseUrl || !serviceKey || !sender || !password) {
    return reply(503, { error: "Bug reporting email is not configured. Contact the portal administrator." }, corsHeaders);
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return reply(401, { error: "Sign in to submit a bug report." }, corsHeaders);

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: { user }, error: authError } = await service.auth.getUser(token);
  if (authError || !user || !user.email) return reply(401, { error: "Your session could not be verified. Sign in again and retry." }, corsHeaders);

  let input: Record<string, unknown>;
  try { input = await req.json(); }
  catch { return reply(400, { error: "Invalid report data." }, corsHeaders); }
  const role = input.role;
  const location = typeof input.location === "string" ? input.location.trim() : "";
  const errorMessage = typeof input.error_message === "string" ? input.error_message.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!(["trailblazer", "director", "admin_or_other"] as unknown[]).includes(role)) {
    return reply(400, { error: "Choose your portal role." }, corsHeaders);
  }
  if (location.length < 1 || location.length > 200 || errorMessage.length < 1 || errorMessage.length > 4000 || description.length < 1 || description.length > 6000) {
    return reply(400, { error: "Complete each report field and keep the text within the indicated limits." }, corsHeaders);
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await service.from("portal_bug_reports").select("id", { count: "exact", head: true })
    .eq("reporter_user_id", user.id).gte("created_at", since);
  if (recent.error) {
    console.error("Bug report rate-limit check failed", { code: recent.error.code || "unknown" });
    return reply(503, { error: "Bug reporting is temporarily unavailable." }, corsHeaders);
  }
  if ((recent.count || 0) >= 3) return reply(429, { error: "You can send up to three bug reports per hour. Please try again later." }, corsHeaders);

  const saved = await service.from("portal_bug_reports").insert({
    reporter_user_id: user.id,
    reporter_email: user.email,
    reporter_role: role,
    location,
    error_message: errorMessage,
    description
  }).select("id").single();
  if (saved.error || !saved.data) {
    console.error("Bug report could not be saved", { code: saved.error?.code || "unknown" });
    return reply(503, { error: "The report could not be recorded. Please try again later." }, corsHeaders);
  }

  const reportId = saved.data.id as string;
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: sender, pass: password },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
  });
  try {
    await transport.sendMail({
      from: { name: "Trailblazers Portal Bug Reports", address: sender },
      to: REPORT_INBOX,
      replyTo: user.email,
      subject: `[Portal bug] ${location.replace(/[\r\n]+/g, " ").slice(0, 120)}`,
      text: [
        "A Trailblazers Portal bug was reported.",
        `Report ID: ${reportId}`,
        `Reporter: ${user.email}`,
        `Role selected: ${role}`,
        `Where it happened: ${location}`,
        `Reported at: ${new Date().toISOString()}`,
        "",
        "Exact error message:", errorMessage,
        "",
        "What the reporter was doing:", description
      ].join("\n")
    });
  } catch (error) {
    const smtpError = error as { code?: unknown; responseCode?: unknown };
    console.error("Bug report email delivery failed", {
      code: typeof smtpError?.code === "string" ? smtpError.code : "unknown",
      responseCode: typeof smtpError?.responseCode === "number" ? smtpError.responseCode : null
    });
    await service.from("portal_bug_reports").update({ delivery_status: "failed", delivery_error: "Gmail delivery failed" }).eq("id", reportId);
    return reply(502, { error: "The report was saved, but email delivery failed. Please try again later." }, corsHeaders);
  } finally {
    transport.close();
  }

  const updated = await service.from("portal_bug_reports").update({ delivery_status: "sent" }).eq("id", reportId);
  if (updated.error) console.error("Bug report sent but delivery status update failed", { reportId });
  return reply(200, { ok: true, report_id: reportId }, corsHeaders);
});
