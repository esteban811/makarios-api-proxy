// Proxy for Google Gemini queries with model fallback chain
// Accepts: { prompt: string, maxTokens?: number }
// Returns: { response: string }

const { validateRequest, successResponse, errorResponse } = require('./_shared');

const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
];

async function tryGeminiModel(model, apiKey, prompt, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: Math.min(maxTokens, 1200) }
    })
  });

  if (res.status === 404 || res.status === 400) {
    return { skip: true };
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const msg = errData?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return { skip: true };
  }

  return { text: data.candidates[0].content.parts[0].text };
}

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

  const { prompt, maxTokens = 1200 } = body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) {
    return errorResponse(400, 'Invalid prompt', event);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set');
    return errorResponse(500, 'Server configuration error', event);
  }

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      const result = await tryGeminiModel(model, apiKey, prompt, maxTokens);
      if (result.skip) continue;
      return successResponse({ response: result.text, model }, event, validation.remaining);
    } catch (err) {
      lastError = err;
      console.error(`Gemini model ${model} failed:`, err.message);
    }
  }

  return errorResponse(
    502,
    `Gemini: all models failed. ${lastError?.message || 'unknown error'}`,
    event
  );
};
