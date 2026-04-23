// Proxy for Anthropic Claude API
// Accepts: { system?: string, messages: Array, maxTokens?: number }
// Returns: Full Anthropic API response (content array with text blocks)
// Used by: Technician Copilot (https://makariosmarketing.com/technician-copilot/)

const { validateRequest, successResponse, errorResponse } = require('./_shared');

exports.handler = async (event) => {
  // Per-function rate limiting: 10 requests/IP/24h
  const validation = validateRequest(event, 'technician-copilot');
  if (validation.preflightResponse) return validation.preflightResponse;
  if (validation.error) return validation.error;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON', event);
  }

  const { system, messages, maxTokens = 1500 } = body;

  // Basic validation
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(400, 'messages must be a non-empty array', event);
  }

  // Size guard — prevent abuse via massive prompts
  const totalChars = JSON.stringify(messages).length + (system?.length || 0);
  if (totalChars > 10000) {
    return errorResponse(400, 'Prompt too long', event);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    return errorResponse(500, 'Server configuration error', event);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: Math.min(maxTokens, 2000),
        system: system || undefined,
        messages
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Anthropic error:', res.status, errText);
      return errorResponse(502, `Anthropic upstream error (${res.status})`, event);
    }

    const data = await res.json();
    // Return full Anthropic response — frontend expects `data.content[].text`
    return successResponse(data, event, validation.remaining);
  } catch (err) {
    console.error('Anthropic fetch error:', err);
    return errorResponse(502, 'Could not reach Anthropic', event);
  }
};
