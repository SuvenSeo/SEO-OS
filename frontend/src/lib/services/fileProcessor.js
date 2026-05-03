const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

/**
 * Download a file from Telegram and return as ArrayBuffer.
 */
export async function downloadTelegramFile(fileId) {
  const fileResp = await fetch(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const fileData = await fileResp.json();
  if (!fileData.ok) throw new Error(`Telegram getFile failed: ${fileData.description}`);

  const filePath = fileData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`File download failed: ${resp.status}`);
  return { buffer: await resp.arrayBuffer(), url: downloadUrl };
}

/**
 * Read a URL via Jina AI reader — returns clean markdown, no API key needed.
 */
export async function readUrl(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  const resp = await fetch(jinaUrl, {
    headers: { 'Accept': 'text/markdown', 'X-Return-Format': 'markdown' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Jina reader failed: ${resp.status}`);
  const text = await resp.text();
  return text.substring(0, 5000);
}

/**
 * Analyze an image using Gemini Vision API.
 * Accepts a URL to the image (Telegram CDN URL).
 */
export async function analyzeImage(imageUrl, prompt = 'Describe this image in detail. Extract all visible text. Give a thorough analysis.') {
  const geminiKey = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '').split(',')[0].trim();
  if (!geminiKey) throw new Error('No Gemini API key for image analysis');

  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) throw new Error('Could not download image');
  const buffer = await imgResp.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = imgResp.headers.get('content-type') || 'image/jpeg';

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini Vision error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not analyze image';
}

/**
 * Parse a PDF buffer to text.
 */
export async function parsePdf(buffer) {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(Buffer.from(buffer));
  return data.text.replace(/\s+/g, ' ').trim().substring(0, 6000);
}

/**
 * Parse a Word (.docx) buffer to plain text.
 */
export async function parseWord(buffer) {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  return result.value.replace(/\s+/g, ' ').trim().substring(0, 6000);
}

/**
 * Extract the best (highest resolution) photo URL from a Telegram photo array.
 */
export function getBestPhotoFileId(photos) {
  return photos[photos.length - 1].file_id;
}

/**
 * Detect URLs in a string.
 */
export function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s]+/g;
  return text.match(urlRegex) || [];
}
