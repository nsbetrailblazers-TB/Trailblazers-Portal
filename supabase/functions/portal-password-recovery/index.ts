import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@6.10.1";

Deno.serve(async (req: Request) => {
  const allowed = [
    "https://trailblazers-portal.vercel.app",
    "https://trailblazers-portal-nsbetrailblazers-9790.vercel.app",
    ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "").split(",").map(value => value.trim()).filter(Boolean)
  ];
  const origin = req.headers.get("origin") || "";
  const isAllowedOrigin = (value: string) => {
    if (allowed.includes(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value && /^trailblazers-portal-[a-z0-9-]+-nsbetrailblazers-9790\.vercel\.app$/i.test(url.hostname);
    } catch {
      return false;
    }
  };
  const originAllowed = isAllowedOrigin(origin);
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": originAllowed ? origin : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  const generic = { message: "If an account matches that email, recovery instructions will be sent." };
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, { message: "POST required" });
  if (!originAllowed) return reply(403, { message: "This portal address is not authorized." });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { email: rawEmail } = await req.json();
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return reply(400, { message: "Enter a valid account email address." });

    const redirect = new URL("https://trailblazers-portal.vercel.app/");

    const sender = Deno.env.get("GMAIL_SMTP_USER");
    const password = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
    if (!sender || !password) return reply(503, { message: "Recovery email is not configured. Contact the portal administrator." });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unavailable";
    const encoder = new TextEncoder();
    const hmacKey = await crypto.subtle.importKey("raw", encoder.encode(serviceRoleKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const keyedHash = async (value: string) => [...new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const rateLimit = await service.rpc("portal_claim_recovery_slot", { p_email_hash: await keyedHash(`email:${email}`), p_ip_hash: await keyedHash(`ip:${ip}`) });
    if (rateLimit.error) {
      console.error("Password recovery rate limiter unavailable", { code: rateLimit.error.code || "unknown" });
      return reply(503, { message: "Recovery is temporarily unavailable. Try again shortly." });
    }
    if (!rateLimit.data) return reply(200, generic);

    const generated = await service.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: redirect.href } });
    if (generated.error) {
      if (["user_not_found", "email_not_found"].includes(generated.error.code || "")) return reply(200, generic);
      console.error("Password recovery link generation failed", { code: generated.error.code || "unknown" });
      return reply(502, { message: "Recovery email could not be sent. Contact the portal administrator." });
    }

    const tokenHash = generated.data.properties?.hashed_token;
    if (!tokenHash) return reply(502, { message: "Recovery email could not be sent. Contact the portal administrator." });
    const confirmationLink = new URL(redirect.href);
    confirmationLink.searchParams.set("portal_recovery_token", tokenHash);
    const link = confirmationLink.toString();
    const safeLink = link.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: sender, pass: password },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
    });
    try {
      await transport.sendMail({
        from: { name: "Trailblazers Portal", address: sender },
        to: email,
        subject: "Reset your Trailblazers Portal password",
        text: `Use the secure link below to reset your portal password. You will confirm the link on the portal before it is used.\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18253f"><h1 style="color:#741738">Trailblazers Portal</h1><p>Use the secure link below to reset your portal password. You will confirm the link on the portal before it is used.</p><p><a href="${safeLink}" style="display:inline-block;background:#741738;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">Reset password</a></p><p>If the button does not work, copy this link into your browser:</p><p style="word-break:break-all">${safeLink}</p><p>If you did not request this, you can ignore this email.</p></div>`
      });
    } catch (mailError) {
      const smtpError = mailError as { code?: unknown; responseCode?: unknown };
      console.error("Gmail password recovery delivery failed", {
        code: typeof smtpError?.code === "string" ? smtpError.code : "unknown",
        responseCode: typeof smtpError?.responseCode === "number" ? smtpError.responseCode : null
      });
      return reply(502, { message: "Recovery email could not be sent. Contact the portal administrator." });
    } finally {
      transport.close();
    }
    return reply(200, generic);
  } catch (error) {
    console.error("Password recovery request failed", { message: error instanceof Error ? error.message : "unknown" });
    return reply(500, { message: "Recovery is temporarily unavailable. Try again shortly." });
  }
});
