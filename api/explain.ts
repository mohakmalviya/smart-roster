import Anthropic from '@anthropic-ai/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/explain — AI-assisted conflict explanation.
//
// The rules engine already decides WHAT is wrong and which fixes exist. This
// endpoint only rewrites that into a short explanation a manager can act on.
// It is given the engine's facts and told not to invent any, so the AI can
// never change the roster or contradict the validator.
//
// Runs as a Vercel Function (Web Request/Response). Needs ANTHROPIC_API_KEY.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You help an operations manager understand a problem in a monthly staff roster for brand support teams.
You are given the problem exactly as a rules engine detected it, the engine's suggested fixes, and some context.
Write a short explanation (at most 120 words) in plain English:
1. What is wrong, in one sentence.
2. Why it happened (the root cause, e.g. one person covers this brand and nobody else is free).
3. The best next step, picked from the suggested fixes when there are any, and its trade-off.
Use only the facts provided. Do not invent people, dates or rules. If the facts are not enough to decide, say what the manager should check.
No headings, no preamble. Plain text, two or three short paragraphs at most.`;

interface Body {
  issue?: { title?: string; detail?: string; suggestions?: string[] };
  context?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: 'ANTHROPIC_API_KEY is not set on the server' });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const issue = body.issue;
  if (!issue?.title || !issue.detail) return json(400, { error: 'issue.title and issue.detail are required' });

  // Bound the input: this is a public endpoint.
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
  const suggestions = (issue.suggestions ?? []).slice(0, 8).map((s) => '- ' + clip(String(s), 300));
  const prompt = [
    `Problem: ${clip(issue.title, 300)}`,
    `Engine explanation: ${clip(issue.detail, 2000)}`,
    suggestions.length ? `Suggested fixes:\n${suggestions.join('\n')}` : 'Suggested fixes: none available automatically.',
    body.context ? `Context:\n${clip(String(body.context), 2000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      // A short rewrite of known facts: low effort keeps it fast and cheap.
      output_config: { effort: 'low' },
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') return json(502, { error: 'the model declined to answer' });
    const text = response.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n')
      .trim();
    if (!text) return json(502, { error: 'empty response' });
    return json(200, { text, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'rate limited, try again shortly' });
    if (err instanceof Anthropic.AuthenticationError) return json(500, { error: 'server API key is invalid' });
    if (err instanceof Anthropic.APIError) return json(502, { error: `API error ${err.status ?? ''}`.trim() });
    return json(500, { error: 'unexpected error' });
  }
}
