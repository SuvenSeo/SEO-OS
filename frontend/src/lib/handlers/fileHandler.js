import supabase from '@/lib/config/supabase';
import { sendMessage, sendChatAction } from '@/lib/services/telegram';
import { downloadTelegramFile, readUrl, analyzeImage, parsePdf, parseWord, getBestPhotoFileId } from '@/lib/services/fileProcessor';
import { insertKnowledgeBase } from '@/lib/handlers/utils';

/**
 * Handle photo messages — analyze image, save to knowledge base.
 */
export async function handlePhoto(chatId, msg, messageId, handleMessage) {
  try {
    await sendMessage(chatId, '🔍 Analyzing image...');
    const fileId = getBestPhotoFileId(msg.photo);
    const { url: imageUrl } = await downloadTelegramFile(fileId);
    const caption = msg.caption || '';
    const prompt = caption
      ? `${caption}\n\nAlso describe the image in detail and extract any visible text.`
      : 'Describe this image in detail. Extract all visible text. Give a thorough analysis of what you see.';

    const analysis = await analyzeImage(imageUrl, prompt);

    await insertKnowledgeBase(
      {
        source: 'image',
        content: `[Image analysis] ${analysis}`,
        embedding_summary: analysis.substring(0, 200),
      },
      'handlePhoto'
    );

    await handleMessage(chatId, `[I sent an image. Analysis: ${analysis}]`, messageId);
  } catch (err) {
    console.error('[Telegram] Photo error:', err.message);
    await sendMessage(chatId, `❌ Couldn't analyze image: ${err.message}`);
  }
}

/**
 * Handle document messages — parse PDF/Word/text, save to knowledge base.
 */
export async function handleDocument(chatId, msg, messageId, handleMessage) {
  const mime = msg.document?.mime_type || '';
  const fileName = msg.document?.file_name || 'file';

  try {
    await sendMessage(chatId, `📄 Reading *${fileName}*...`);
    const { buffer } = await downloadTelegramFile(msg.document.file_id);

    let content = '';

    if (mime === 'application/pdf' || fileName.endsWith('.pdf')) {
      content = await parsePdf(buffer);
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')
    ) {
      content = await parseWord(buffer);
    } else if (mime.startsWith('text/') || fileName.endsWith('.txt')) {
      content = new TextDecoder().decode(buffer).substring(0, 6000);
    } else if (mime.startsWith('image/')) {
      const { url: imageUrl } = await downloadTelegramFile(msg.document.file_id);
      content = await analyzeImage(imageUrl);
    } else {
      return await sendMessage(chatId, `⚠️ I can read PDFs, Word docs, text files, and images. This file type (${mime}) isn't supported yet.`);
    }

    await insertKnowledgeBase(
      {
        source: 'document',
        content: `[Document: ${fileName}]\n${content}`,
        embedding_summary: content.substring(0, 200),
      },
      'handleDocument'
    );

    await handleMessage(chatId, `[I sent a document "${fileName}". Content: ${content}]`, messageId);
  } catch (err) {
    console.error('[Telegram] Document error:', err.message);
    await sendMessage(chatId, `❌ Couldn't read document: ${err.message}`);
  }
}

/**
 * Handle voice messages — transcribe with Whisper, process as text.
 */
export async function handleVoice(chatId, msg, messageId, handleMessage) {
  try {
    await sendChatAction(chatId, 'typing');
    const { buffer } = await downloadTelegramFile(msg.voice.file_id);

    const groqKey = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').split(',')[0].trim();
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}` },
      body: formData,
    });

    if (!resp.ok) throw new Error(`Whisper error: ${resp.status}`);
    const data = await resp.json();
    const transcript = data.text || '';

    if (!transcript) {
      return await sendMessage(chatId, '⚠️ Could not transcribe voice message.');
    }

    await sendMessage(chatId, `🎙️ _"${transcript}"_`);
    await handleMessage(chatId, transcript, messageId);
  } catch (err) {
    console.error('[Telegram] Voice error:', err.message);
    await sendMessage(chatId, `❌ Voice processing failed: ${err.message}`);
  }
}

/**
 * Handle forwarded messages — save to knowledge base with attribution.
 */
export async function handleForwarded(chatId, msg, messageId) {
  const forwardFrom = msg.forward_from?.first_name || msg.forward_from_chat?.title || 'Unknown';
  const text = msg.text || msg.caption || '';
  if (!text) return false;

  await insertKnowledgeBase(
    {
      source: 'telegram_saved',
      content: `[Forwarded from ${forwardFrom}]\n${text}`,
      embedding_summary: `Forwarded message from ${forwardFrom}: ${text.substring(0, 150)}`,
    },
    'handleForwarded'
  );

  await sendMessage(chatId, `📥 Saved forwarded message from *${forwardFrom}* to knowledge base.`);
  return true;
}
