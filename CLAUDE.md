# Poo Vaasam - Tamil Poetry Web Application

This is a Tamil poetry web application built with Next.js 15, featuring AI-powered poem analysis, context-aware background music, and emotion-based Tamil text-to-speech.

## Project Overview

- **Framework**: Next.js 15.5.15 with App Router
- **Styling**: Tailwind CSS
- **Database**: Supabase
- **AI**: OpenAI GPT-4 for poem emotion analysis
- **Audio**: Context-aware music selection + Browser Web Speech API for Tamil TTS
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

1. **AI Poem Analysis** - OpenAI GPT-4 analyzes Tamil poems for emotion, mood, and themes
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
- **TTS**: Google Cloud TTS is optional (disabled due to billing), falls back to browser Web Speech API
- **AI Analysis**: Requires `OPENAI_API_KEY` in `.env.local`
- **Tamil Typography**: Baloo Thambi 2 font with specific line-height values (1.584 for desktop, 1.496 for mobile)
