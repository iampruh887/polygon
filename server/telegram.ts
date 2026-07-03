// Optional Telegram notifier. If TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set,
// notify() sends a message; otherwise it's a no-op. It NEVER throws — a failed
// or unconfigured ping must not affect the caller's request.

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function notifyTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('[telegram] sendMessage failed:', res.status, (await res.text().catch(() => '')).slice(0, 200));
    }
  } catch (e) {
    console.error('[telegram] notify error:', e instanceof Error ? e.message : e);
  }
}

// Minimal HTML escaping for user-supplied text in parse_mode: 'HTML'.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
