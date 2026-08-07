import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { invokeTransactionalEmail } from "./invoke-transactional-email.ts";

/**
 * Send the welcome email once a firm has connected Xero Practice Manager.
 * This is the real "you can start using strukcha" moment, so the welcome email is
 * triggered here rather than at Stripe checkout. Idempotent per workspace.
 */
export async function sendXpmWelcomeEmail(
  service: SupabaseClient,
  tenantId: string,
): Promise<void> {
  try {
    const { data: owner } = await service
      .from("tenant_users")
      .select("email, display_name, auth_user_id")
      .eq("tenant_id", tenantId)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle();

    if (!owner?.email) {
      console.error("[sendXpmWelcomeEmail] no active owner for tenant", tenantId);
      return;
    }

    await invokeTransactionalEmail({
      templateName: "welcome",
      recipientEmail: owner.email,
      templateData: { name: owner.display_name || undefined },
      idempotencyKey: `welcome:${tenantId}`,
    });
  } catch (err) {
    console.error("[sendXpmWelcomeEmail] failed for tenant", tenantId, err);
  }
}
