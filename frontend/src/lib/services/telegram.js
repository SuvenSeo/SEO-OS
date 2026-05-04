const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Send a message via Telegram Bot API.
 * Automatically splits messages that exceed the 4096 char limit.
 * @param {string} chatId - Telegram chat ID
 * @param {string} text - Message text
 * @param {object} options - Optional: parse_mode, reply_to_message_id
 */
export async function sendMessage(chatId, text, options = {}) {
  const { parse_mode = 'Markdown', reply_to_message_id, reply_markup } = options;
  const targetChatId = chatId || process.env.TELEGRAM_CHAT_ID;

  if (!text || text.trim().length === 0) {
    console.warn('[Telegram] Attempted to send empty message');
    return;
  }

  // Split long messages
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

  let lastResult = null;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const body = {
        chat_id: targetChatId,
        text: chunk,
        parse_mode,
      };

      if (reply_to_message_id) {
        body.reply_to_message_id = reply_to_message_id;
      }
      if (reply_markup && i === 0) {
        body.reply_markup = reply_markup;
      }

      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!data.ok) {
        // If Markdown parsing fails, retry without parse_mode
        if (data.description?.includes('parse')) {
          console.warn('[Telegram] Markdown parse failed, retrying as plain text');
          const retryResp = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: targetChatId,
              text: chunk,
              ...(reply_markup && i === 0 ? { reply_markup } : {}),
            }),
          });
          lastResult = await retryResp.json();
        } else {
          console.error('[Telegram] Send failed:', data.description);
        }
      } else {
        lastResult = data;
      }
    } catch (error) {
      console.error('[Telegram] Network error:', error.message);
      throw error;
    }
  }
  return lastResult;
}

/**
 * Split a message into chunks that fit within Telegram's limit.
 * Tries to split on newlines to preserve formatting.
 */
export function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1) {
      // Hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

/**
 * Send a chat action (e.g. 'typing') to show the bot is working.
 */
export async function sendChatAction(chatId, action = 'typing') {
  try {
    await fetch(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (e) {
    // Non-critical, ignore
  }
}

/**
 * Set the webhook URL for the Telegram bot.
 * Call this once during initial setup.
 */
export async function setWebhook(url) {
  const webhookUrl = `${url}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;

  const response = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = await response.json();
  console.log('[Telegram] Webhook set:', data);
  return data;
}
