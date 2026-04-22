// Shared utilities for all proxy functions
// Handles: CORS, Origin whitelist, Rate limiting by IP

const ALLOWED_ORIGINS = [
  'https://makariosmarketing.com',
  'https://www.makariosmarketing.com'
];

// In-memory rate limit store (resets on cold start, but 24h window works per-instance)
// For production at scale, swap to Netlify Blobs or Upstash Redis
const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 10;           // 10 audits per window
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Each audit = 6 API calls (3 platforms x 2 queries). So 10 audits = 60 API calls.
// We rate-limit at the API call level, so threshold = 60.
const API_CALLS_PER_AUDIT = 6;
const MAX_API_CALLS = RATE_LIMIT_MAX * API_CALLS_PER_AUDIT; // 60

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

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // New window
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_API_CALLS - 1 };
  }

  if (entry.count >= MAX_API_CALLS) {
    return { allowed: false, remaining: 0, resetIn: RATE_LIMIT_WINDOW_MS - (now - entry.windowStart) };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_API_CALLS - entry.count };
}

// Cleanup old entries every 100 requests to prevent memory bloat
let cleanupCounter = 0;
function maybeCleanup() {
  cleanupCounter++;
  if (cleanupCounter % 100 !== 0) return;
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
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
function validateRequest(event) {
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
  const rateCheck = checkRateLimit(ip);
  maybeCleanup();

  if (!rateCheck.allowed) {
    const hoursLeft = Math.ceil(rateCheck.resetIn / (60 * 60 * 1000));
    return {
      error: {
        statusCode: 429,
        headers: corsHeaders(event.headers['origin']),
        body: JSON.stringify({
          error: `Rate limit reached. You can run more audits in ~${hoursLeft} hours.`,
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
