export const config = { runtime: 'edge' };

const ALLOWED_ORIGINS = new Set([
  'https://concrete-intel.vercel.app',
  'http://localhost:5173',
]);

const ALLOWED_TASKS = new Set([
  'bid', 'change_order', 'email_summary', 'scope_letter', 'as_built', 'material_list'
]);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin),
  });
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }

  if (!ALLOWED_ORIGINS.has(origin) && !origin.includes('localhost')) {
    return json({ error: 'Forbidden' }, 403, origin);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, origin);
  }

  // Validate — must have messages array, block arbitrary model/system overrides
  if (!body.messages || !Array.isArray(body.messages)) {
    return json({ error: 'Invalid request' }, 400, origin);
  }

  // Strip any client-supplied fields that could abuse the API
  const safeBody = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: Math.min(body.max_tokens || 2500, 3000),
    system: body.system || '',
    messages: body.messages.slice(0, 10), // cap message count
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return json({ error: data.error?.message || 'AI request failed' }, response.status, origin);
    }

    return json(data, 200, origin);
  } catch (err) {
    return json({ error: 'Internal error' }, 500, origin);
  }
}
