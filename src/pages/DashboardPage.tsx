import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button-variants'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/use-auth'

const tools = [
  {
    to: '/handwritten',
    title: 'Handwritten notes',
    description:
      'Turn a short message into a realistic handwritten note for email or LinkedIn outreach.',
    cta: 'Open note studio',
  },
  {
    to: '/memes',
    title: 'Memes',
    description:
      'Drop an image, add a punchline, and export a shareable meme in seconds.',
    cta: 'Open meme studio',
  },
]

export function DashboardPage() {
  const { user } = useAuth()
  const greetingName = user?.email?.split('@')[0] ?? 'there'

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Dashboard"
        title={`Welcome back, ${greetingName}`}
        description="Create personalised assets for cold email and LinkedIn. Everything runs in your browser — pick a studio to get started."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <Card key={tool.to} className="flex flex-col justify-between gap-6">
            <div>
              <CardTitle>{tool.title}</CardTitle>
              <CardDescription>{tool.description}</CardDescription>
            </div>
            <Link to={tool.to} className={buttonVariants({ variant: 'primary', size: 'md' })}>
              {tool.cta}
            </Link>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <CardTitle>Sample prospect list</CardTitle>
          <Badge>CSV</Badge>
        </div>
        <CardDescription>
          A messy example list is bundled with the app so you can test personalisation flows with
          realistic, imperfect data.
        </CardDescription>
        <a
          href="/samples/messy-prospects.csv"
          download
          className="inline-flex w-fit items-center rounded-[1584px] border border-sand-border bg-warm-cream px-4 py-2 text-sm font-medium text-navy-ink transition-colors hover:bg-cool-mist"
        >
          Download messy-prospects.csv
        </a>
      </Card>
    </div>
  )
}
