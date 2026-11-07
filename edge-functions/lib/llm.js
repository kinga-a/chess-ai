/**
 * Minimal OpenAI-compatible chat client used for the optional "LLM takes over" engine.
 * Configure via EdgeOne environment variables:
 *   AI_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY
 *   AI_BASE_URL (default https://api.deepseek.com/v1)
 *   AI_MODEL    (default deepseek-chat)
 */
export function llmConfig(env = {}) {
  const key =
    env.AI_API_KEY || env.OPENAI_API_KEY || env.DEEPSEEK_API_KEY || env.HUNYUAN_API_KEY || '';
  const base = (env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const model = env.AI_MODEL || 'deepseek-chat';
  return { key, base, model, enabled: !!key };
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * Send a chat completion request and return the parsed JSON object, or null.
 * Failures are swallowed on purpose: callers fall back to the minimax engine.
 */
export async function chatJSON(env, messages, options = {}) {
  const cfg = llmConfig(env);
  if (!cfg.enabled) return { ok: false, error: 'llm not configured' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 7000);
  try {
    const res = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 120,
        messages,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `llm HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}` };
    }
    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
    const parsed = extractJson(content);
    if (!parsed) return { ok: false, error: 'llm returned non-JSON content' };
    return { ok: true, data: parsed, model: cfg.model, raw: content };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'llm timeout' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}