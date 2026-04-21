# Makarios API Proxy

Secure proxy for AI tools used on makariosmarketing.com. Protects API keys and enforces rate limits.

## Setup (first time)

### 1. Create GitHub repo and push
```bash
git init
git add .
git commit -m "Initial: AI Search Audit proxy"
# Create repo on GitHub: makarios-api-proxy
git remote add origin https://github.com/YOUR-USER/makarios-api-proxy.git
git push -u origin main
```

### 2. Create Netlify site
1. Go to https://app.netlify.com/
2. Click **Add new site** → **Import an existing project**
3. Connect GitHub → select `makarios-api-proxy`
4. Deploy with defaults (Netlify reads `netlify.toml`)

### 3. Add environment variables
Netlify dashboard → Site configuration → Environment variables → Add:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | sk-proj-... |
| `PERPLEXITY_API_KEY` | pplx-... |
| `GEMINI_API_KEY` | AIza... |

Trigger a redeploy after adding vars (Deploys → Trigger deploy → Clear cache and deploy).

### 4. Test endpoints
Replace `YOUR-SITE` with your Netlify site name:

```bash
curl -X POST https://YOUR-SITE.netlify.app/.netlify/functions/query-openai \
  -H "Content-Type: application/json" \
  -H "Origin: https://makariosmarketing.com" \
  -d '{"prompt": "test"}'
```

Without a valid Origin header, should return 403.

## Endpoints

All endpoints accept POST with JSON `{ "prompt": "...", "maxTokens": 500 }`.

- `/.netlify/functions/query-openai` — GPT-4o-mini
- `/.netlify/functions/query-perplexity` — Sonar
- `/.netlify/functions/query-gemini` — Gemini Flash (with model fallback chain)

## Protections

- **Origin whitelist:** Only requests from `makariosmarketing.com` are allowed
- **Rate limit:** 60 API calls per IP per 24h (= 10 full audits)
- **Payload validation:** Prompt must be <1000 chars
- **Keys in env vars:** Never exposed to client

## Rotating API keys

If a key leaks:
1. Revoke in provider dashboard (OpenAI/Perplexity/Google AI Studio)
2. Generate new key
3. Update env var in Netlify
4. Trigger redeploy
