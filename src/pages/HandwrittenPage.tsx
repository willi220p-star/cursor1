import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import type { ChannelVariant } from '@/types/app'

const MAX_LENGTH = 320

export function HandwrittenPage() {
  const [recipient, setRecipient] = useState('')
  const [message, setMessage] = useState('')
  const [channel, setChannel] = useState<ChannelVariant>('email')

  const remaining = MAX_LENGTH - message.length

  const signature = useMemo(() => (channel === 'email' ? 'Warmly,' : 'Cheers,'), [channel])

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Handwritten"
        title="Note studio"
        description="Draft a short, personal note and preview how it reads as a handwritten card. Keep it under a few sentences for the most authentic feel."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card className="flex flex-col gap-5">
          <div>
            <CardTitle>Compose</CardTitle>
            <CardDescription>Personalise the note for one prospect at a time.</CardDescription>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="recipient" className="text-sm font-medium text-navy-ink">
              Recipient first name
            </label>
            <input
              id="recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="Jordan"
              className="h-11 w-full rounded-[12px] border border-sand-border bg-paper-white px-4 text-sm text-navy-ink placeholder:text-ash-gray focus:outline-none focus:ring-2 focus:ring-violet-pulse/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="message" className="text-sm font-medium text-navy-ink">
                Message
              </label>
              <span
                className={
                  remaining < 0 ? 'text-xs font-medium text-[#7a1f1f]' : 'text-xs text-ash-gray'
                }
              >
                {remaining} left
              </span>
            </div>
            <textarea
              id="message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={5}
              placeholder="Loved your recent post on category design — would enjoy trading notes sometime."
              className="w-full rounded-[12px] border border-sand-border bg-paper-white px-4 py-3 text-sm text-navy-ink placeholder:text-ash-gray focus:outline-none focus:ring-2 focus:ring-violet-pulse/30"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-navy-ink">Channel</span>
            <div className="flex gap-2">
              {(['email', 'linkedin'] as const).map((option) => (
                <Button
                  key={option}
                  variant={channel === option ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setChannel(option)}
                >
                  {option === 'email' ? 'Email' : 'LinkedIn'}
                </Button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 bg-warm-cream">
          <div className="flex items-center justify-between">
            <CardTitle>Preview</CardTitle>
            <Badge>{channel === 'email' ? 'Email' : 'LinkedIn'}</Badge>
          </div>
          <div className="flex min-h-[280px] flex-col justify-between rounded-[12px] border border-sand-border bg-paper-white p-6 shadow-card">
            <div className="font-handwriting text-[22px] leading-relaxed text-navy-ink">
              <p>Hi {recipient.trim() || 'there'},</p>
              <p className="mt-4 whitespace-pre-wrap">
                {message.trim() || 'Your personal note will appear here as you type.'}
              </p>
            </div>
            <p className="mt-6 font-handwriting text-[22px] text-navy-ink">{signature}</p>
          </div>
        </Card>
      </div>
    </div>
  )
}
