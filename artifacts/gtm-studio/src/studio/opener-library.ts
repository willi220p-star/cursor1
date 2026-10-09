/**
 * Built-in library of short, proven cold-note openers and P.S. lines.
 *
 * Writing rules (enforced in opener-library.test.ts):
 * - Opener bodies are 15–40 words and end with one soft ask.
 * - Plain, human wording: contractions, no buzzwords, no exclamation marks, no emojis.
 * - Every merge tag carries a fallback (`{company|your team}`) so a blank cell still reads right.
 * - Greeting variations (`{Hi|Hey|Hello}`) use three or more options so batches don't start identically.
 */

export const openerCategories = [
  'Trigger event',
  'Compliment on their work',
  'Shared context',
  'Curious question',
  'Social proof',
  'Breakup',
] as const;
export type OpenerCategory = (typeof openerCategories)[number];

export const postscriptCategories = ['Video offer', 'Proof', 'Low-friction ask', 'Personal'] as const;
export type PostscriptCategory = (typeof postscriptCategories)[number];

export type OpenerEntry = {
  id: string;
  category: OpenerCategory;
  title: string;
  body: string;
  why: string;
};

export type PostscriptEntry = {
  id: string;
  category: PostscriptCategory;
  title: string;
  body: string;
  why: string;
};

export const openerLibrary: OpenerEntry[] = [
  {
    id: 'trigger-hiring',
    category: 'Trigger event',
    title: 'Spotted the hiring push',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nNoticed {company|your team} is hiring again. That usually means new business has to keep pace. I've got a couple of ideas that might help. Open to a quick chat?",
    why: 'Use when the company has open roles listed, because growth makes pipeline a live problem.',
  },
  {
    id: 'trigger-new-role',
    category: 'Trigger event',
    title: 'Congrats on the new role',
    body: "{first_name|Hi there},\n\nCongrats on the move into the {role|new} role. The first few months are when the big calls get made, so I'll keep this short. Worth a quick chat about pipeline?",
    why: 'Works best in the first 90 days of a new job, when people are open to fresh approaches.',
  },
  {
    id: 'trigger-growth',
    category: 'Trigger event',
    title: 'Heard about the growth',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nHeard {company|your business} is growing in {city|your area}. Exciting stage. It's also when filling the calendar gets harder, not easier. Mind if I send over a few ideas?",
    why: 'Use after an expansion, new location or big win, so the note ties to something real.',
  },
  {
    id: 'trigger-news',
    category: 'Trigger event',
    title: 'Saw you in the news',
    body: "{first_name|Hi there},\n\nSaw {company|your team} pop up in the news recently. Nice work. That's the kind of momentum I help businesses turn into booked meetings. Would a short note on how be useful?",
    why: 'Use when the company was recently featured or announced something public.',
  },
  {
    id: 'trigger-new-site',
    category: 'Trigger event',
    title: 'New website spotted',
    body: "{first_name|Hi there},\n\nNoticed {company|your team} has a fresh look online. Looks sharp. A new site works best with a steady flow of the right people, and that's where I come in. Worth a quick chat?",
    why: "Use when they've just relaunched their site, since they're already thinking about growth.",
  },
  {
    id: 'compliment-craft',
    category: 'Compliment on their work',
    title: 'Clearly cares about the detail',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nHad a proper look at what {company|your team} does today. It's clear you care about the details, which isn't common. I had one idea for you. Can I send it over?",
    why: 'A good default for any business with a solid website or portfolio to point at.',
  },
  {
    id: 'compliment-post',
    category: 'Compliment on their work',
    title: 'Enjoyed your recent post',
    body: "{first_name|Hi there},\n\nEnjoyed your recent post. You explained something most people overcomplicate in a few plain lines. I'm working on the same problem from the sales side. Up for swapping notes sometime?",
    why: 'Use for people who post on LinkedIn, so the note feels like a reply rather than a pitch.',
  },
  {
    id: 'compliment-reviews',
    category: 'Compliment on their work',
    title: 'Customers rate you',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nRead a few reviews for {company|your business} and the same word kept coming up: reliable. That's hard to earn. I'd love to help more of the right people find you. Worth a chat?",
    why: 'Use when the business has strong public reviews you can genuinely point to.',
  },
  {
    id: 'compliment-operator',
    category: 'Compliment on their work',
    title: 'Too busy delivering',
    body: "{first_name|Hi there},\n\nYou clearly know your stuff as {role|a leader} at {company|your company}. Most good operators I meet are too busy delivering to chase new work. That's the bit I take off their plate. Fancy a quick call?",
    why: 'Fits owners and senior people who do the work themselves and have little time for sales.',
  },
  {
    id: 'shared-local',
    category: 'Shared context',
    title: 'Saying hello properly',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nI work with a few businesses around {city|your area}, and I'd rather say hello properly than send another generic email. Would you be open to a quick coffee or call?",
    why: "Use when you're local to them or already work nearby, so the meeting ask feels natural.",
  },
  {
    id: 'shared-customers',
    category: 'Shared context',
    title: 'Same kind of customers',
    body: "{first_name|Hi there},\n\nWe seem to work with the same kind of customers, just from different angles. There's probably an easy way to help each other out. Open to a ten-minute call to see?",
    why: 'Use for partners and adjacent services where a referral swap is a fair trade.',
  },
  {
    id: 'shared-handwritten',
    category: 'Shared context',
    title: 'A note worth reading',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nInboxes are noisy, so I figured a note's more likely to get read. I help teams like {company|yours} book more of the right meetings. Worth a quick chat?",
    why: 'A pattern break for people who get a lot of cold email and ignore most of it.',
  },
  {
    id: 'shared-role',
    category: 'Shared context',
    title: 'Same headache, every time',
    body: "{first_name|Hi there},\n\nI talk with a lot of people in {role|your seat}, and the same headache keeps coming up: there aren't enough good conversations in the calendar. Is that true for {company|your team} too?",
    why: "Use when you know the role well and can name its most common pain in plain words.",
  },
  {
    id: 'question-lead-source',
    category: 'Curious question',
    title: 'Where new clients come from',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nQuick one: where do most of {company|your team}'s new clients come from right now, referrals or something else? I ask because there might be an easy channel you're not using yet.",
    why: 'Easy to answer in one line, which makes it a strong first touch on any list.',
  },
  {
    id: 'question-one-fix',
    category: 'Curious question',
    title: 'One thing to fix',
    body: "{first_name|Hi there},\n\nIf you could fix one thing about how {company|your business} wins new work this quarter, what would it be? I ask because I've probably already got a shortcut for it.",
    why: 'Gets them talking about their priority, so your follow-up can match it exactly.',
  },
  {
    id: 'question-right-person',
    category: 'Curious question',
    title: 'Am I asking the right person',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nNot sure you're the right person for this, so I'll ask straight up. Who looks after bringing in new clients at {company|your company}? A name is plenty.",
    why: "Use when you're not sure who owns growth, since people happily point you the right way.",
  },
  {
    id: 'question-honest',
    category: 'Curious question',
    title: 'Honest question',
    body: "{first_name|Hi there},\n\nHonest question. Is finding new clients something you're actively working on at {company|the moment}, or is the pipeline already full? Either answer helps me.",
    why: 'Low pressure and easy to reply to, so it suits cold lists with little research.',
  },
  {
    id: 'proof-similar',
    category: 'Social proof',
    title: 'Helped someone a lot like you',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nWe've recently helped a business a lot like {company|yours} go from patchy referrals to a steady run of booked calls. Happy to show you how it worked. Worth ten minutes?",
    why: 'Use when you have a real client in a similar spot, so the comparison holds up.',
  },
  {
    id: 'proof-peers',
    category: 'Social proof',
    title: 'What other owners changed',
    body: "{first_name|Hi there},\n\nA few business owners I work with have stopped relying on word of mouth alone. The change was simpler than they'd expected. Want me to send over what they did?",
    why: 'Fits owner-led businesses that grew on referrals and are starting to feel the ceiling.',
  },
  {
    id: 'proof-replies',
    category: 'Social proof',
    title: 'Replies from old silences',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nOne of our clients started hearing back from people who'd ignored them for years, just by changing how they opened. I reckon {company|your team} could do the same. Curious?",
    why: "Use when they've likely tried outreach before and felt it didn't work.",
  },
  {
    id: 'proof-one-pager',
    category: 'Social proof',
    title: 'One-page breakdown',
    body: "{first_name|Hi there},\n\nI put together a one-page breakdown of how we filled a client's calendar without paid ads. No fluff, just what worked. Want me to send it your way?",
    why: 'Offers something useful before asking for time, which suits sceptical buyers.',
  },
  {
    id: 'breakup-last-note',
    category: 'Breakup',
    title: 'Last note from me',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nI've reached out a couple of times, so this'll be my last note. If outbound isn't a priority for {company|your team} right now, no worries at all. Should I close the loop?",
    why: 'Send after two or three unanswered touches, since a clear exit often gets the reply.',
  },
  {
    id: 'breakup-timing',
    category: 'Breakup',
    title: 'Probably bad timing',
    body: "{first_name|Hi there},\n\nI'm guessing the timing's just not right, which is completely fair. I'll stop chasing for now. Mind if I check back in with {company|you} next quarter?",
    why: 'Use when they opened but never replied, to keep the door open without pressure.',
  },
  {
    id: 'breakup-permission',
    category: 'Breakup',
    title: 'Permission to stop',
    body: "{Hi|Hey|Hello} {first_name|there},\n\nI don't want to be the person who keeps knocking. If this isn't relevant for {company|you}, just say so and I'll leave you be. Otherwise, worth one short call?",
    why: 'Gives them an easy no, which makes a yes feel safer too.',
  },
  {
    id: 'breakup-point-me',
    category: 'Breakup',
    title: 'Point me elsewhere',
    body: "{first_name|Hi there},\n\nI've clearly not caught you at the right time. If someone else at {company|your company} looks after new business, would you mind pointing me their way? Thanks either way.",
    why: "Use when you suspect you've got the wrong contact and want a referral inside the company.",
  },
];

export const postscriptLibrary: PostscriptEntry[] = [
  {
    id: 'ps-video-minute',
    category: 'Video offer',
    title: 'One-minute video',
    body: "P.S. Happy to record a one-minute video walking through the idea for {company|your team}, if that's easier than a call.",
    why: 'Lowers the bar for busy people who would watch but would not book.',
  },
  {
    id: 'ps-video-walkthrough',
    category: 'Video offer',
    title: 'Screen walkthrough',
    body: "P.S. I can put together a short screen recording showing exactly what I'd change. No call needed.",
    why: 'Suits detail-minded buyers who want to see the work before talking.',
  },
  {
    id: 'ps-video-reply',
    category: 'Video offer',
    title: 'Reply for a video',
    body: 'P.S. Reply with the word "video" and I\'ll send a quick personalised walkthrough instead.',
    why: 'A one-word reply is the easiest response you can ask for.',
  },
  {
    id: 'ps-proof-similar',
    category: 'Proof',
    title: 'Done it before',
    body: "P.S. We've done this for businesses a lot like {company|yours}. Happy to share a real example.",
    why: 'Adds credibility without stuffing a case study into the main note.',
  },
  {
    id: 'ps-proof-case',
    category: 'Proof',
    title: 'One-page case study',
    body: "P.S. I've got a one-page case study that shows the whole process, start to finish. Want it?",
    why: 'Gives readers who are not ready to talk a reason to reply anyway.',
  },
  {
    id: 'ps-proof-numbers',
    category: 'Proof',
    title: 'Real numbers',
    body: 'P.S. Happy to share the actual numbers from our last campaign, the good and the bad.',
    why: 'Honesty about results builds more trust than a polished headline.',
  },
  {
    id: 'ps-ask-yes-no',
    category: 'Low-friction ask',
    title: 'Yes or no is plenty',
    body: "P.S. A simple yes or no is plenty. I'll take it from there.",
    why: 'Makes replying feel like a five-second job.',
  },
  {
    id: 'ps-ask-timing',
    category: 'Low-friction ask',
    title: 'Tell me when',
    body: "P.S. If now's not the right time, just tell me when is and I'll check back then.",
    why: 'Turns a no into a dated follow-up instead of silence.',
  },
  {
    id: 'ps-ask-forward',
    category: 'Low-friction ask',
    title: 'Pass it along',
    body: "P.S. If this isn't your area, I'd be grateful if you passed it to whoever looks after growth.",
    why: "Use when you're not sure you've reached the decision maker.",
  },
  {
    id: 'ps-personal-local',
    category: 'Personal',
    title: 'Hope things are good',
    body: 'P.S. Hope things are going well in {city|your part of the world} this week.',
    why: 'A warm close that reminds them a person sent this.',
  },
  {
    id: 'ps-personal-coffee',
    category: 'Personal',
    title: 'Coffee is on me',
    body: "P.S. If you're ever near my side of town, the coffee's on me.",
    why: 'Fits local prospects where meeting in person is realistic.',
  },
  {
    id: 'ps-personal-keep-going',
    category: 'Personal',
    title: 'Keep up the good work',
    body: 'P.S. Either way, keep up the good work at {company|your business}.',
    why: 'Ends on goodwill, which helps breakup notes land softly.',
  },
];
