/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as welcome } from './welcome.tsx'
import { template as xpmConnected } from './xpm-connected.tsx'
import { template as xpmSyncFailed } from './xpm-sync-failed.tsx'
import { template as trialEnding } from './trial-ending.tsx'
import { template as renewalReminder } from './renewal-reminder.tsx'
import { template as paymentFailed } from './payment-failed.tsx'
import { template as subscriptionCanceled } from './subscription-canceled.tsx'
import { template as roleChanged } from './role-changed.tsx'
import { template as accountAccessUpdated } from './account-access-updated.tsx'
import { template as userDeactivated } from './user-deactivated.tsx'
import { template as feedbackReceived } from './feedback-received.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  welcome,
  'xpm-connected': xpmConnected,
  'xpm-sync-failed': xpmSyncFailed,
  'trial-ending': trialEnding,
  'renewal-reminder': renewalReminder,
  'payment-failed': paymentFailed,
  'subscription-canceled': subscriptionCanceled,
  'role-changed': roleChanged,
  'account-access-updated': accountAccessUpdated,
  'user-deactivated': userDeactivated,
  'feedback-received': feedbackReceived,
}
