/**
 * SEOS — WhatsApp Chat Import Script
 * 
 * Parses a WhatsApp chat export .txt file and imports meaningful
 * messages into the knowledge_base table with AI-generated summaries.
 * 
 * Usage: node src/scripts/importWhatsApp.js <path-to-chat.txt>
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');
const { generateStructuredExtraction } = require('../services/groq');

const CHUNK_SIZE = 8; // Lines per chunk
const DELAY_BETWEEN_CHUNKS = 1500; // ms, to respect rate limits

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node src/scripts/importWhatsApp.js <path-to-chat.txt>');
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`\n  📱 SEOS WhatsApp Import`);
  console.log(`  ─────────────────────────`);
  console.log(`  File: ${absolutePath}\n`);

  const raw = fs.readFileSync(absolutePath, 'utf-8');
  const lines = raw.split('\n');

  console.log(`  Total lines: ${lines.length}`);

  // Parse and clean lines
  // WhatsApp format: [DD/MM/YYYY, HH:MM:SS] Sender: Message
  const cleaned = [];
  const msgRegex = /^\[?\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\]?\s*-?\s*/;

  for (const line of lines) {
    // Strip timestamp and sender info
    let clean = line.replace(msgRegex, '').trim();

    // Remove sender name (format: "Name: message")
    const senderMatch = clean.match(/^([^:]+):\s+(.+)$/);
    if (senderMatch) {
      clean = senderMatch[2];
    }

    // Skip system messages, media placeholders, empty lines
    if (!clean) continue;
    if (clean.includes('<Media omitted>')) continue;
    if (clean.includes('omitted')) continue;
    if (clean.includes('Messages and calls are end-to-end encrypted')) continue;
    if (clean.includes('created this group')) continue;
    if (clean.includes('added you')) continue;
    if (clean.includes('changed the subject')) continue;
    if (clean.includes('changed this group')) continue;
    if (clean.length < 10) continue; // Skip very short messages

    cleaned.push(clean);
  }

  console.log(`  Meaningful lines: ${cleaned.length}`);

  // Chunk the lines
  const chunks = [];
  for (let i = 0; i < cleaned.length; i += CHUNK_SIZE) {
    chunks.push(cleaned.slice(i, i + CHUNK_SIZE));
  }

  console.log(`  Chunks to process: ${chunks.length}\n`);

  let imported = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const content = chunk.join('\n');

    try {
      // Generate summary via Groq
      const summaryPrompt = `Summarize the following chat messages in 1-2 concise sentences. Focus on key information, decisions, or topics discussed. If it's trivial/greetings, respond with "SKIP".

Messages:
${content}

Summary:`;

      const summary = await generateStructuredExtraction(summaryPrompt);
      const trimmedSummary = summary.replace(/```/g, '').replace(/^["']|["']$/g, '').trim();

      // Skip trivial chunks
      if (trimmedSummary.toUpperCase().includes('SKIP')) {
        process.stdout.write(`  [${i + 1}/${chunks.length}] Skipped (trivial)\r`);
        continue;
      }

      // Insert into knowledge_base
      const { error } = await supabase.from('knowledge_base').insert({
        source: 'whatsapp_import',
        content,
        embedding_summary: trimmedSummary,
      });

      if (error) {
        errors++;
        console.error(`  [${i + 1}/${chunks.length}] DB error: ${error.message}`);
      } else {
        imported++;
        process.stdout.write(`  [${i + 1}/${chunks.length}] Imported (${imported} total)\r`);
      }

      // Rate limit delay
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, DELAY_BETWEEN_CHUNKS));
      }
    } catch (e) {
      errors++;
      console.error(`\n  [${i + 1}/${chunks.length}] Error: ${e.message}`);
    }
  }

  console.log(`\n\n  ✅ Import complete`);
  console.log(`  ─────────────────────────`);
  console.log(`  Imported: ${imported} chunks`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Skipped: ${chunks.length - imported - errors} (trivial)\n`);

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
