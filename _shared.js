// Shared utilities for all proxy functions
// Handles: CORS, Origin whitelist, Rate limiting by IP (per-function)

const ALLOWED_ORIGINS = [
  'https://makariosmarketing.com',
  'https://www.makariosmarketing.com'
];

// In-memory rate limit store (resets on cold start, but 24h window works per-instance)
// Key format: `${functionName}:${ip}` — each tool has independent quota
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Rate limit presets by function name.
// Each tool gets its own independent quota per IP per 24h.
const RATE_LIMITS = {
  'ai-search-audit': 60,    // 10 audits × 6 API calls = 60
  'technician-copilot': 10, // 10 checklists/day
  default: 30
};

function getRateLimitFor(functionName) {
  return RATE_LIMITS[functionName] || RATE_LIMITS.default;
}

function getClientIP(event) {
  return (
    event.headers['x-nf-client-connection-ip'] ||
    event.headers['x-forwarded-for']?.split(',')[0].trim() ||
    event.headers['client-ip'] ||
    'unknown'
  );
}

function checkOrigin(event) {
  const origin = event.headers['origin'] || event.headers['referer'] || '';
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

function checkRateLimit(ip, functionName) {
  const max = getRateLimitFor(functionName);
  const key = `${functionName}:${ip}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1 };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetIn: RATE_LIMIT_WINDOW_MS - (now - entry.windowStart) };
  }

  entry.count += 1;
  return { allowed: true, remaining: max - entry.count };
}

let cleanupCounter = 0;
function maybeCleanup() {
  cleanupCounter++;
  if (cleanupCounter % 100 !== 0) return;
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}

function corsHeaders(origin) {
  const isAllowed = ALLOWED_ORIGINS.some(allowed => origin?.startsWith(allowed));
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function handleOptions(event) {
  return {
    statusCode: 204,
    headers: corsHeaders(event.headers['origin']),
    body: ''
  };
}

function errorResponse(statusCode, message, event) {
  return {
    statusCode,
    headers: corsHeaders(event.headers['origin']),
    body: JSON.stringify({ error: message })
  };
}

function successResponse(data, event, remaining) {
  const headers = corsHeaders(event.headers['origin']);
  if (typeof remaining === 'number') {
    headers['X-RateLimit-Remaining'] = String(remaining);
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data)
  };
}

// Main gatekeeper — run at start of every function
// Pass functionName to get per-tool rate limiting
function validateRequest(event, functionName = 'default') {
  if (event.httpMethod === 'OPTIONS') {
    return { preflightResponse: handleOptions(event) };
  }

  if (event.httpMethod !== 'POST') {
    return { error: errorResponse(405, 'Method not allowed', event) };
  }

  if (!checkOrigin(event)) {
    return { error: errorResponse(403, 'Origin not allowed', event) };
  }

  const ip = getClientIP(event);
  const rateCheck = checkRateLimit(ip, functionName);
  maybeCleanup();

  if (!rateCheck.allowed) {
    const hoursLeft = Math.ceil(rateCheck.resetIn / (60 * 60 * 1000));
    return {
      error: {
        statusCode: 429,
        headers: corsHeaders(event.headers['origin']),
        body: JSON.stringify({
          error: `Rate limit reached. You can try again in ~${hoursLeft} hours.`,
          retryAfter: rateCheck.resetIn
        })
      }
    };
  }

  return { ok: true, remaining: rateCheck.remaining };
}

module.exports = {
  validateRequest,
  successResponse,
  errorResponse,
  corsHeaders
};
