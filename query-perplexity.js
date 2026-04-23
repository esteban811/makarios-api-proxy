// Proxy for Perplexity Sonar queries
// Accepts: { prompt: string, maxTokens?: number }
// Returns: { response: string }

const { validateRequest, successResponse, errorResponse } = require('./_shared');

exports.handler = async (event) => {
  const validation = validateRequest(event, 'ai-search-audit');
  if (validation.preflightResponse) return validation.preflightResponse;
  if (validation.error) return validation.error;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON', event);
  }

  const { prompt, maxTokens = 500 } = body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) {
    return errorResponse(400, 'Invalid prompt', event);
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.error('PERPLEXITY_API_KEY not set');
    return errorResponse(500, 'Server configuration error', event);
  }

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Math.min(maxTokens, 800)
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Perplexity error:', res.status, errText);
      return errorResponse(502, `Perplexity upstream error (${res.status})`, event);
    }

    const data = await res.json();
    const response = data.choices?.[0]?.message?.content || '';
    return successResponse({ response }, event, validation.remaining);
  } catch (err) {
    console.error('Perplexity fetch error:', err);
    return errorResponse(502, 'Could not reach Perplexity', event);
  }
};
