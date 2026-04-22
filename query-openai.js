// Proxy for OpenAI ChatGPT queries
// Accepts: { prompt: string, maxTokens?: number }
// Returns: { response: string }

const { validateRequest, successResponse, errorResponse } = require('./_shared');

exports.handler = async (event) => {
  const validation = validateRequest(event);
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY not set');
    return errorResponse(500, 'Server configuration error', event);
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: Math.min(maxTokens, 800),
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('OpenAI error:', res.status, errText);
      return errorResponse(502, `OpenAI upstream error (${res.status})`, event);
    }

    const data = await res.json();
    const response = data.choices?.[0]?.message?.content || '';
    return successResponse({ response }, event, validation.remaining);
  } catch (err) {
    console.error('OpenAI fetch error:', err);
    return errorResponse(502, 'Could not reach OpenAI', event);
  }
};
