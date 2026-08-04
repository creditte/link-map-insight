import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const log = (step: string, details?: unknown) =>
  console.log(`[delete-account] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user?.email) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const confirmation = String(body?.confirmation ?? "").trim();
    const password = typeof body?.password === "string" ? body.password : "";
    const dryRun = body?.dry_run === true;

    if (confirmation !== "DELETE") {
      return json({ error: 'Type DELETE to confirm account deletion.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // --- Authorisation: owner of the firm only -------------------------------
    const { data: tu, error: tuErr } = await admin
      .from("tenant_users")
      .select("id, tenant_id, role, status, email")
      .eq("auth_user_id", user.id)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tuErr) throw new Error(tuErr.message);
    if (!tu) return json({ error: "No firm membership found for this account." }, 403);
    if (tu.role !== "owner") {
      return json(
        { error: "Only the firm owner can delete the account. Ask your owner to remove your access instead." },
        403,
      );
    }

    const tenantId = tu.tenant_id as string;

    // --- Re-authentication ---------------------------------------------------
    const { data: mfa } = await admin
      .from("mfa_settings")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mfa) {
      const { data: verification } = await admin
        .from("mfa_verifications")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .gt("expires_at", new Date().toISOString())
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!verification) {
        return json(
          { error: "Your two-factor verification has expired. Sign in again, then retry the deletion." },
          403,
        );
      }
    }

    if (password) {
      const reauth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      const { error: pwErr } = await reauth.auth.signInWithPassword({
        email: user.email,
        password,
      });
      if (pwErr) return json({ error: "Incorrect password. Please try again." }, 403);
    } else if (!mfa) {
      return json({ error: "Enter your password to confirm deletion." }, 400);
    }

    // --- Collect scope -------------------------------------------------------
    const { data: members } = await admin
      .from("tenant_users")
      .select("id, email, auth_user_id, role")
      .eq("tenant_id", tenantId);

    const memberUserIds = (members ?? [])
      .map((m) => m.auth_user_id as string | null)
      .filter((id): id is string => !!id);

    const { data: tenant } = await admin
      .from("tenants")
      .select("id, firm_name, name, stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("id", tenantId)
      .maybeSingle();

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        firm_name: tenant?.firm_name ?? tenant?.name ?? null,
        member_count: members?.length ?? 0,
        has_subscription: !!tenant?.stripe_subscription_id,
        subscription_status: tenant?.subscription_status ?? null,
      });
    }

    // --- Billing: cancel any live subscription / trial first -----------------
    let subscriptionCancelled = false;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (stripeKey && (tenant?.stripe_subscription_id || tenant?.stripe_customer_id)) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: "2026-02-25.clover" as any });
        const ids = new Set<string>();
        if (tenant?.stripe_subscription_id) ids.add(tenant.stripe_subscription_id);
        if (tenant?.stripe_customer_id) {
          const subs = await stripe.subscriptions.list({
            customer: tenant.stripe_customer_id,
            status: "all",
            limit: 20,
          });
          for (const s of subs.data) {
            if (!["canceled", "incomplete_expired"].includes(s.status)) ids.add(s.id);
          }
        }
        for (const id of ids) {
          try {
            await stripe.subscriptions.cancel(id, { prorate: false });
            subscriptionCancelled = true;
            log("subscription cancelled", { id });
          } catch (e) {
            log("subscription cancel skipped", { id, message: (e as Error).message });
          }
        }
      } catch (e) {
        log("stripe error", { message: (e as Error).message });
        return json(
          {
            error:
              "We could not cancel the active subscription with our payment provider. No data was deleted — please try again shortly.",
          },
          502,
        );
      }
    }

    // --- Durable audit record (survives the tenant delete: no FK) ------------
    await admin.from("tenant_user_audit_log").insert({
      tenant_id: tenantId,
      actor_auth_user_id: user.id,
      action: "account_deleted",
      target_tenant_user_id: tu.id,
      target_email: tu.email,
      meta: {
        firm_name: tenant?.firm_name ?? tenant?.name ?? null,
        member_count: members?.length ?? 0,
        subscription_cancelled: subscriptionCancelled,
        stripe_customer_id: tenant?.stripe_customer_id ?? null,
        deleted_at: new Date().toISOString(),
      },
    });
    log("audit written", { tenantId });

    // --- Delete data not covered by tenant cascades --------------------------
    await admin.from("xero_connections").delete().eq("tenant_id", tenantId);

    if (memberUserIds.length > 0) {
      await admin.from("trusted_devices").delete().in("user_id", memberUserIds);
      await admin.from("mfa_verifications").delete().in("user_id", memberUserIds);
      await admin.from("mfa_email_codes").delete().in("user_id", memberUserIds);
      await admin.from("mfa_settings").delete().in("user_id", memberUserIds);
      await admin.from("signup_verifications").delete().in("user_id", memberUserIds);
      await admin.from("favourite_groups").delete().in("user_id", memberUserIds);
      await admin.from("user_roles").delete().in("user_id", memberUserIds);
      await admin.from("xero_oauth_states").delete().in("user_id", memberUserIds);
    }

    const memberEmails = (members ?? [])
      .map((m) => (m.email as string | null)?.toLowerCase())
      .filter((e): e is string => !!e);
    if (memberEmails.length > 0) {
      await admin.from("email_unsubscribe_tokens").delete().in("email", memberEmails);
    }

    // Tenant delete cascades: profiles, entities, relationships, structures,
    // snapshots, imports, invitations, feedback, audit_log, tenant_users, xpm_groups.
    const { error: tenantDelErr } = await admin.from("tenants").delete().eq("id", tenantId);
    if (tenantDelErr) {
      log("tenant delete failed", { message: tenantDelErr.message });
      return json(
        {
          error: "We could not remove your firm data. Nothing further was deleted — please contact hello@strukcha.app.",
        },
        500,
      );
    }
    log("tenant deleted", { tenantId });

    // --- Revoke auth: deleting the auth user kills all sessions & tokens -----
    const failedUsers: string[] = [];
    for (const id of memberUserIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        log("auth user delete failed", { id, message: error.message });
        failedUsers.push(id);
      }
    }

    if (failedUsers.length > 0) {
      return json({
        ok: true,
        partial: true,
        message:
          "Your firm data was deleted, but some sign-in records could not be removed. Contact hello@strukcha.app if you can still sign in.",
      });
    }

    return json({ ok: true, subscription_cancelled: subscriptionCancelled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("ERROR", { message });
    return json({ error: `Account deletion failed: ${message}` }, 500);
  }
});
