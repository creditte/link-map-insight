import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  invokeTransactionalEmail,
  markTenantNotificationSent,
  wasTenantNotificationSent,
} from '../_shared/invoke-transactional-email.ts'
import { getTenantBillingRecipients } from '../_shared/tenant-recipients.ts'
import { isServiceRoleRequest } from '../_shared/cron-auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

function daysUntilUtc(iso: string): number {
  const end = startOfDay(new Date(iso))
  const now = startOfDay(new Date())
  return Math.round((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

async function notifyRecipients(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  templateName: string,
  notificationKey: string,
  templateData: Record<string, unknown>,
): Promise<boolean> {
  if (await wasTenantNotificationSent(supabase, tenantId, notificationKey)) {
    return false
  }

  const recipients = await getTenantBillingRecipients(supabase, tenantId)
  if (!recipients.length) return false

  let sentAny = false
  for (const recipient of recipients) {
    const result = await invokeTransactionalEmail({
      templateName,
      recipientEmail: recipient.email,
      templateData: { name: recipient.name, ...templateData },
      idempotencyKey: `${notificationKey}:${recipient.email}`,
    })
    if (result.ok && !result.skipped) sentAny = true
  }

  if (sentAny) {
    await markTenantNotificationSent(supabase, tenantId, notificationKey)
    return true
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey || !isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
  )

  let trialSent = 0
  let renewalSent = 0

  const { data: trialingTenants, error: trialErr } = await supabase
    .from('tenants')
    .select('id, firm_name, subscription_plan, trial_ends_at, subscription_status')
    .eq('subscription_status', 'trialing')
    .not('trial_ends_at', 'is', null)

  if (trialErr) {
    console.error('[send-billing-reminders] trial query:', trialErr)
  } else {
    for (const tenant of trialingTenants ?? []) {
      if (!tenant.trial_ends_at) continue
      const days = daysUntilUtc(tenant.trial_ends_at)
      if (days !== 3 && days !== 1) continue

      const notificationKey = `trial-ending:${days}d:${tenant.trial_ends_at.slice(0, 10)}`
      const sent = await notifyRecipients(supabase, tenant.id, 'trial-ending', notificationKey, {
        trialEndsAt: tenant.trial_ends_at,
        daysRemaining: days,
        plan: tenant.subscription_plan,
        firmName: tenant.firm_name,
      })
      if (sent) trialSent++
    }
  }

  const { data: activeTenants, error: renewalErr } = await supabase
    .from('tenants')
    .select('id, firm_name, subscription_plan, current_period_end, subscription_status')
    .eq('subscription_status', 'active')
    .not('current_period_end', 'is', null)

  if (renewalErr) {
    console.error('[send-billing-reminders] renewal query:', renewalErr)
  } else {
    for (const tenant of activeTenants ?? []) {
      if (!tenant.current_period_end) continue
      const days = daysUntilUtc(tenant.current_period_end)
      if (days !== 7) continue

      const notificationKey = `renewal-reminder:7d:${tenant.current_period_end.slice(0, 10)}`
      const sent = await notifyRecipients(supabase, tenant.id, 'renewal-reminder', notificationKey, {
        renewalDate: tenant.current_period_end,
        plan: tenant.subscription_plan,
        firmName: tenant.firm_name,
      })
      if (sent) renewalSent++
    }
  }

  console.log('[send-billing-reminders] done', { trialSent, renewalSent })

  return new Response(
    JSON.stringify({ ok: true, trialSent, renewalSent }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
