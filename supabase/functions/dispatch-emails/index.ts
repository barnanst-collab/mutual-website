// PostSwap Edge Function: dispatch-emails
// Deploy: supabase functions deploy dispatch-emails
// Optional secret: RESEND_API_KEY (https://resend.com) + RESEND_FROM
//
// Without RESEND_API_KEY, pending rows are marked "logged" (dev mode) so the
// queue still advances and the app can show "notification processed".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY") || "";
    const resendFrom =
      Deno.env.get("RESEND_FROM") || "PostSwap <onboarding@resend.dev>";

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: pending, error } = await admin
      .from("email_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(25);

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    for (const row of pending || []) {
      try {
        if (resendKey) {
          const sendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: resendFrom,
              to: [row.to_email],
              subject: row.subject,
              text: row.body,
            }),
          });
          const sendBody = await sendRes.json().catch(() => ({}));
          if (!sendRes.ok) {
            await admin
              .from("email_queue")
              .update({
                status: "failed",
                error: JSON.stringify(sendBody),
              })
              .eq("id", row.id);
            results.push({ id: row.id, status: "failed", sendBody });
            continue;
          }
          await admin
            .from("email_queue")
            .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
            .eq("id", row.id);
          results.push({ id: row.id, status: "sent", to: row.to_email });
        } else {
          // Dev / no mail provider: mark processed so queue doesn't stall
          console.log("[dispatch-emails] LOG-ONLY", {
            to: row.to_email,
            subject: row.subject,
            event_type: row.event_type,
          });
          await admin
            .from("email_queue")
            .update({
              status: "logged",
              sent_at: new Date().toISOString(),
              error: "No RESEND_API_KEY — logged only",
            })
            .eq("id", row.id);
          results.push({ id: row.id, status: "logged", to: row.to_email });
        }
      } catch (rowErr) {
        const message = rowErr instanceof Error ? rowErr.message : String(rowErr);
        await admin
          .from("email_queue")
          .update({ status: "failed", error: message })
          .eq("id", row.id);
        results.push({ id: row.id, status: "failed", error: message });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        processed: results.length,
        provider: resendKey ? "resend" : "log-only",
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dispatch-emails]", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
