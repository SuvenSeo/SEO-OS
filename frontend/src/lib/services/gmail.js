const { google } = require('googleapis');

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
  );

  auth.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  return google.gmail({ version: 'v1', auth });
}

export async function listMessages(query = 'is:unread') {
  try {
    const gmail = getGmailClient();
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 10,
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) return 'No messages found matching query: ' + query;

    const details = await Promise.all(
      messages.map(async (m) => {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
        const headers = msg.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
        const from = headers.find(h => h.name === 'From')?.value || '(Unknown Sender)';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        return `[ID: ${m.id}] FROM: ${from} | SUBJECT: ${subject} (${date})`;
      })
    );

    return `Recent emails (${query}):\n\n` + details.join('\n');
  } catch (error) {
    console.error('[Gmail] List Error:', error.message);
    return `Error listing emails: ${error.message}`;
  }
}

export async function getMessageContent(messageId) {
  try {
    const gmail = getGmailClient();
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
    });

    const payload = res.data.payload;
    let body = '';

    if (payload.parts) {
      const textPart = payload.parts.find(p => p.mimeType === 'text/plain') || payload.parts[0];
      if (textPart.body.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString();
      }
    } else if (payload.body.data) {
      body = Buffer.from(payload.body.data, 'base64').toString();
    }

    const headers = payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(Unknown Sender)';

    return `FROM: ${from}\nSUBJECT: ${subject}\n\nCONTENT:\n${body.substring(0, 2000)}${body.length > 2000 ? '...' : ''}`;
  } catch (error) {
    console.error('[Gmail] Get Error:', error.message);
    return `Error getting message ${messageId}: ${error.message}`;
  }
}
