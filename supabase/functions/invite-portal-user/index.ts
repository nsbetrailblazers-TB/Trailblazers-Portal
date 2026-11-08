import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@6.10.1";

// The gateway JWT check is disabled because this function verifies the token
// with Auth and checks the administrator table on every request.
Deno.serve(async (req: Request) => {
  const allowed = ["https://trailblazers-portal.vercel.app", "https://trailblazers-portal-nsbetrailblazers-9790.vercel.app", ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean)];
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
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : "null", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply(405, { error: "POST required" });
  if (!isAllowedOrigin(origin)) return reply(403, { error: "Configure PORTAL_ALLOWED_ORIGINS for this portal address." });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { error: "Sign in required" });
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply(401, { error: "Invalid session" });
    const { data: admin, error: adminError } = await service.from("portal_admins").select("user_id").eq("user_id", user.id).eq("active", true).maybeSingle();
    if (adminError) return reply(503, { error: "Could not verify administrator permissions. The invitation service needs database access." });
    if (!admin) return reply(403, { error: "Administrator access required" });
    const { kind, id, redirect_to } = await req.json();
    if (!["member", "director"].includes(kind) || typeof id !== "string") return reply(400, { error: "Choose a roster identity" });
    const redirect = new URL(redirect_to);
    if (!isAllowedOrigin(redirect.origin) || !["https:", "http:"].includes(redirect.protocol)) return reply(400, { error: "Unapproved redirect URL" });
    const table = kind === "member" ? "members" : "directors";
    const { data: identity, error } = await service.from(table).select("*").eq("id", id).single();
    if (error) return reply(503, { error: "Could not read the roster identity. Check invitation service database permissions." });
    if (!identity) return reply(404, { error: "Identity not found" });
    if (identity.auth_user_id) return reply(200, { connected: true });
    if (kind === "member" ? identity.program_status !== "active" : !identity.active) return reply(400, { error: "Activate this identity before inviting" });
    const email = (identity.uf_email || identity.email || "").trim().toLowerCase();
    if (!email) return reply(400, { error: "An email is required" });
    // Existing accounts are connected only after they verify their email and sign in.
    // Never overwrite an existing identity link or assume editable metadata is trusted.
    const sender = Deno.env.get("GMAIL_SMTP_USER");
    const password = Deno.env.get("GMAIL_SMTP_APP_PASSWORD");
    if (!sender || !password) return reply(503, { error: "Invitation email is not configured. Set the Gmail SMTP secrets used by portal notifications." });

    // Auth's built-in mailer may use a separate SMTP credential. Generate the
    // single-use link here and deliver it through the portal's verified Gmail sender.
    let linkType: "invite" | "magiclink" = "invite";
    let generated = await service.auth.admin.generateLink({
      type: linkType,
      email,
      options: { redirectTo: redirect.href }
    });
    if (generated.error && ["email_exists", "user_already_exists"].includes(generated.error.code || "")) {
      linkType = "magiclink";
      generated = await service.auth.admin.generateLink({
        type: linkType,
        email,
        options: { redirectTo: redirect.href }
      });
    }
    if (generated.error) {
      console.error("Auth link generation failed", { code: generated.error.code || "unknown", status: generated.error.status || null });
      return reply(400, { error: "Supabase could not create a secure account link. Check the Auth logs and confirm the email is valid." });
    }
    const tokenHash = generated.data.properties?.hashed_token;
    if (!tokenHash) return reply(502, { error: "Supabase did not return a verification token. No invitation email was sent." });

    // Mail-security scanners often open links as soon as an email arrives.
    // Do not send Supabase's one-use /verify URL directly: land on the portal
    // first and redeem the token only after the recipient confirms in the UI.
    const confirmationLink = new URL(redirect.href);
    confirmationLink.searchParams.set("portal_invite_token", tokenHash);
    confirmationLink.searchParams.set("portal_invite_type", linkType);
    const actionLink = confirmationLink.toString();

    const safeLink = actionLink.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const isInvite = linkType === "invite";
    const subject = isInvite ? "Your Trailblazers Portal account" : "Sign in to the Trailblazers Portal";
    const instruction = isInvite
      ? "Use the secure link below to finish setting up your Trailblazers Portal account. You can choose your password after opening the link."
      : "An account already exists for this email. Use the secure link below to verify the address, connect it to your Trailblazers Portal roster record, and choose a portal password.";
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: sender, pass: password },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
    });
    try {
      await transport.sendMail({
        from: { name: "Trailblazers Portal", address: sender },
        to: email,
        subject,
        text: `${instruction}\n\nOpen this secure link: ${actionLink}\n\nIf you did not expect this email, you can ignore it.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18253f"><h1 style="color:#741738">Trailblazers Portal</h1><p>${instruction}</p><p><a href="${safeLink}" style="display:inline-block;background:#741738;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">${isInvite ? "Set up your account" : "Connect your account"}</a></p><p>If the button does not work, copy this link into your browser:</p><p style="word-break:break-all">${safeLink}</p><p>If you did not expect this email, you can ignore it.</p></div>`
      });
    } catch (mailError) {
      const smtpError = mailError as { code?: unknown; responseCode?: unknown; command?: unknown };
      console.error("Gmail invitation delivery failed", {
        code: typeof smtpError?.code === "string" ? smtpError.code : "unknown",
        responseCode: typeof smtpError?.responseCode === "number" ? smtpError.responseCode : null,
        command: typeof smtpError?.command === "string" ? smtpError.command : "unknown"
      });
      return reply(502, { error: "The account link was created, but Gmail could not send it. Check the Gmail SMTP function secrets, then retry; the retry will send a sign-in link." });
    } finally {
      transport.close();
    }
    await service.from("activity_log").insert({ actor_user_id: user.id, actor_type: "system", action: "account_invited", entity_type: table, entity_id: id, details: { email } });
    return reply(200, { invited: isInvite, existing_account: !isInvite, email_sent: true });
  } catch (error) {
    return reply(400, { error: error instanceof Error ? error.message : "Invitation failed" });
  }
});
