import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { SITE_NAME, SUPPORT_EMAIL, emailStyles } from './styles.ts'

interface FeedbackReceivedProps {
  message?: string
  submittedBy?: string
  firmName?: string
  page?: string
  structureId?: string
}

const FeedbackReceivedEmail = ({
  message,
  submittedBy,
  firmName,
  page,
  structureId,
}: FeedbackReceivedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New strukcha feedback{submittedBy ? ` from ${submittedBy}` : ''}</Preview>
    <Body style={emailStyles.main}>
      <Container style={emailStyles.container}>
        <Text style={emailStyles.brand}>{SITE_NAME}</Text>
        <Heading style={emailStyles.h1}>New feedback received</Heading>
        <Text style={emailStyles.text}>
          {submittedBy ? `From: ${submittedBy}` : 'From: unknown user'}
          {firmName ? ` · ${firmName}` : ''}
        </Text>
        <Text style={{ ...emailStyles.text, color: '#1a1f2e', whiteSpace: 'pre-wrap' as const }}>
          {message || '(no message)'}
        </Text>
        <Text style={emailStyles.footer}>
          Page: {page || '—'}
          {structureId ? ` · Structure: ${structureId}` : ''}
        </Text>
        <Text style={emailStyles.footer}>Sent to {SUPPORT_EMAIL}</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: FeedbackReceivedEmail,
  subject: 'New strukcha feedback',
  to: SUPPORT_EMAIL,
  displayName: 'Feedback received',
  previewData: {
    message: 'The diagram export is great, but could we get PNG too?',
    submittedBy: 'alex@acme.com.au',
    firmName: 'Acme Advisory',
    page: '/structures/1234',
  },
} satisfies TemplateEntry
