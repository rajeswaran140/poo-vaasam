# AI Features Documentation

This document explains the AI-powered features integrated into the தமிழகவல் platform.

## 🤖 Features Implemented

### 1. **Semantic Search** (OpenAI Embeddings)
- **Location**: `/ai-search`
- **Technology**: OpenAI `text-embedding-3-small`
- **Purpose**: Search content by meaning, not just keywords

#### How it Works:
1. User enters a search query in Tamil or English
2. Query is converted to vector embedding using OpenAI
3. Content is also embedded (either pre-computed or on-the-fly)
4. Cosine similarity calculates relevance scores
5. Results ranked by similarity

#### API Endpoint:
```
POST /api/ai/search
Body: { query: string, type?: string, limit?: number }
Response: { query, results[], count }
```

### 2. **Poetry Guide Chat** (Claude AI)
- **Location**: Floating chat button on all content pages
- **Technology**: Anthropic Claude 3.5 Sonnet
- **Purpose**: Interactive Q&A about Tamil poetry

#### How it Works:
1. Floating AI chat button appears on poem pages
2. User asks questions in Tamil or English
3. Claude AI provides contextual answers with poem context
4. Maintains conversation history
5. Offers quick suggestions

#### API Endpoint:
```
POST /api/ai/chat
Body: { messages: Message[], poemId?: string }
Response: { message: string, poemContext }
```

## 📁 File Structure

```
src/
├── services/ai/
│   ├── openai.ts          # OpenAI embedding utilities
│   └── claude.ts          # Claude chat utilities
├── components/
│   ├── SemanticSearch.tsx # Search UI component
│   └── PoetryGuideChat.tsx # Chat UI component
├── app/
│   ├── ai-search/
│   │   └── page.tsx       # Dedicated search page
│   └── api/ai/
│       ├── search/
│       │   └── route.ts   # Search API endpoint
│       └── chat/
│           └── route.ts   # Chat API endpoint
```

## 🔧 Setup Instructions

### 1. Environment Variables

Add to `.env.local`:

```bash
# OpenAI API Key (for semantic search)
OPENAI_API_KEY=sk-...

# Anthropic API Key (for poetry guide chat)
ANTHROPIC_API_KEY=sk-ant-...
```

### 2. Install Dependencies

Already installed:
```bash
npm install openai @anthropic-ai/sdk
```

### 3. Test the Features

**Test Semantic Search:**
```bash
curl -X POST http://localhost:3000/api/ai/search \
  -H "Content-Type: application/json" \
  -d '{"query": "காதல் பற்றிய கவிதைகள்", "limit": 5}'
```

**Test Chat:**
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "தமிழ் கவிதை என்றால் என்ன?"}]}'
```

## 💰 Cost Estimation

### OpenAI Costs (Semantic Search)
- **Model**: `text-embedding-3-small`
- **Price**: $0.02 per 1M tokens (~62,500 pages of text)
- **Per Search**: ~$0.0001 (for query + 10 results comparison)
- **For 10,000 searches/month**: ~$1-5

### Anthropic Costs (Chat)
- **Model**: `claude-3-5-sonnet-20241022`
- **Price**: $3 per 1M input tokens, $15 per 1M output tokens
- **Per Chat Message**: ~$0.005-0.02
- **For 1,000 chats/month**: ~$5-20

**Total Estimated Monthly Cost**: $10-30 for moderate usage

## 🚀 Usage Examples

### Semantic Search Component

```tsx
import { SemanticSearch } from '@/components/SemanticSearch';

export default function Page() {
  return <SemanticSearch />;
}
```

### Poetry Guide Chat

```tsx
import { PoetryGuideChat } from '@/components/PoetryGuideChat';

export default function PoemPage({ poemId, title, author }) {
  return (
    <div>
      {/* Page content */}
      <PoetryGuideChat
        poemId={poemId}
        poemTitle={title}
        poemAuthor={author}
      />
    </div>
  );
}
```

## 🎯 Future Optimizations

### Performance Improvements:
1. **Pre-compute Embeddings**: Generate and store embeddings for all content in database
2. **Vector Database**: Use Pinecone, Weaviate, or pgvector for faster similarity search
3. **Caching**: Cache frequent queries and responses
4. **Batch Processing**: Generate embeddings in batches during content creation

### Database Schema Addition:
```sql
ALTER TABLE Content ADD COLUMN embedding VECTOR(1536);
CREATE INDEX ON Content USING ivfflat (embedding vector_cosine_ops);
```

### Enhanced Features:
1. **Multi-language**: Support English queries for Tamil content
2. **Auto-tagging**: Use AI to suggest tags for new content
3. **Content Recommendations**: "Similar poems you might like"
4. **Reading Assistant**: Explain difficult Tamil words inline

## 🔐 Security Considerations

1. **Rate Limiting**: Implement rate limiting on API endpoints
2. **API Key Protection**: Never expose API keys in client code
3. **Input Sanitization**: Validate and sanitize all user inputs
4. **Content Moderation**: Filter inappropriate queries
5. **Cost Caps**: Set monthly spending limits on AI providers

## 📊 Monitoring

Track these metrics:
- API call counts and costs
- Search query patterns
- Chat conversation lengths
- User satisfaction (thumbs up/down)
- Error rates and types

## 🐛 Troubleshooting

### "API key not configured" Error:
- Check `.env.local` file exists
- Verify API keys are correct
- Restart development server

### Slow Search Results:
- Embeddings being generated on-the-fly
- Implement pre-computed embeddings (see Future Optimizations)

### Chat Not Responding:
- Check Anthropic API key
- Verify network connectivity
- Check API quota/billing

## 📝 Best Practices

1. **Error Handling**: Always show user-friendly Tamil error messages
2. **Loading States**: Show clear loading indicators
3. **Fallbacks**: Provide alternative options if AI fails
4. **Transparency**: Let users know they're interacting with AI
5. **Feedback**: Allow users to rate AI responses

## 🔗 Resources

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Anthropic Claude Documentation](https://docs.anthropic.com/claude/docs)
- [Vector Similarity Search](https://www.pinecone.io/learn/vector-similarity/)

---

**Last Updated**: 2026-04-23
**Maintained By**: Development Team
