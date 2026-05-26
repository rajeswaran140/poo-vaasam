# Poo Vaasam - Tamil Poetry Web Application

This is a Tamil poetry web application built with Next.js 15, featuring AI-powered poem analysis, context-aware background music, and emotion-based Tamil text-to-speech.

## Project Overview

- **Framework**: Next.js 15 with App Router
- **Styling**: Tailwind CSS
- **Database**: AWS DynamoDB (single-table design) + S3 for media assets
- **AI**: OpenAI GPT-4 and Anthropic Claude for poem emotion/theme analysis
- **Audio**: Google Cloud TTS (Chirp3-HD Tamil voice) with browser Web Speech API fallback; context-aware background music
- **Auth**: AWS Cognito — API routes verify the Cognito ID-token JWT (signature + expiry) via `aws-jwt-verify`
- **Deployment**: AWS Amplify

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available gstack skills:

**Planning & Strategy:**
- `/office-hours` - Product interrogation with forcing questions
- `/plan-ceo-review` - Strategic challenge (4 scope modes)
- `/plan-eng-review` - Engineering review
- `/plan-design-review` - Design review
- `/autoplan` - Automated planning

**Development:**
- `/browse` - Fast headless browser for QA testing
- `/qa` - QA testing on staging URLs
- `/review` - Code review on current branch
- `/ship` - Ship the PR
- `/land-and-deploy` - Land and deploy

**Design:**
- `/design-consultation` - Design consultation
- `/design-shotgun` - Quick design iterations
- `/design-html` - HTML design generation
- `/design-review` - Design review

**Security & Quality:**
- `/cso` - Security audit (OWASP + STRIDE)
- `/guard` - Pre-commit checks
- `/careful` - Extra careful mode

**Team & Process:**
- `/retro` - Engineering retrospective
- `/investigate` - Root cause debugging
- `/document-release` - Release documentation
- `/learn` - Store learnings for future reference
- `/codex` - Code documentation

**Other:**
- `/canary` - Canary deployment
- `/health` - Health checks
- `/setup-browser-cookies` - Browser cookie setup
- `/setup-deploy` - Deployment setup
- `/pair-agent` - Pair programming agent
- `/context-save` - Save context
- `/context-restore` - Restore context
- `/freeze` - Freeze state
- `/unfreeze` - Unfreeze state
- `/gstack-upgrade` - Upgrade gstack
- `/plan-devex-review` - Developer experience review
- `/devex-review` - DevEx review
- `/plan-tune` - Plan tuning
- `/qa-only` - QA only mode
- `/make-pdf` - Generate PDFs
- `/open-gstack-browser` - Open gstack browser
- `/benchmark` - Performance benchmarking
- `/benchmark-models` - Model benchmarking

## Key Features

1. **AI Poem Analysis** - OpenAI GPT-4 / Anthropic Claude analyze Tamil poems for emotion, mood, and themes
2. **Context-Aware Music** - Intelligent music selection based on poem emotion (Kevin MacLeod royalty-free music)
3. **Tamil TTS** - Browser-based Tamil text-to-speech with emotion-aware parameters
4. **Reading Modes** - Light, dark, and sepia modes for comfortable reading
5. **Mobile Responsive** - Optimized for mobile, tablet, and desktop

## Development

```bash
npm run dev       # Start development server on http://localhost:3002
npm test          # Run tests
npm run build     # Build for production
```

## Testing

See `TESTING.md` for comprehensive manual testing guide.

## Important Notes

- **Music Sources**: Using Kevin MacLeod's royalty-free music from incompetech.com
- **TTS**: Google Cloud TTS (Chirp3-HD Tamil voice) is the primary engine; requires `GOOGLE_TTS_CREDENTIALS_BASE64`. Browser Web Speech API is the fallback when unavailable.
- **AI Analysis**: Requires `OPENAI_API_KEY` (and `ANTHROPIC_API_KEY` for Claude features) in `.env.local`
- **Admin access**: API routes under `/api/admin/*` and the test route require an admin. Configure admins via a Cognito `admin` group or the `ADMIN_EMAILS` env var (comma-separated). With neither set, any authenticated user is treated as admin in dev but **denied in production** — see `HARDENING.md`.
- **Tamil Typography**: Baloo Thambi 2 font with specific line-height values (1.584 for desktop, 1.496 for mobile)
