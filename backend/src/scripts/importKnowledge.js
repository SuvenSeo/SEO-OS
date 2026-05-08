require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const supabase = require('../config/supabase');

const CHUNK_SIZE = 1500; // chars

/**
 * Extract text from various file formats.
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return data.text;
  } else {
    throw new Error(`Unsupported file extension: ${ext}`);
  }
}

/**
 * Split text into chunks.
 */
function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.substring(i, i + size));
  }
  return chunks;
}

/**
 * Main ingestion function.
 */
async function ingest(filePath, sourceTag = 'manual') {
  console.log(`🚀 Starting ingestion for: ${filePath}`);
  
  try {
    const fullText = await extractText(filePath);
    console.log(`📄 Extracted ${fullText.length} characters.`);

    const chunks = chunkText(fullText, CHUNK_SIZE);
    console.log(`📦 Created ${chunks.length} chunks.`);

    for (let i = 0; i < chunks.length; i++) {
      const { error } = await supabase.from('knowledge_base').insert({
        content: chunks[i],
        source: sourceTag,
      });

      if (error) {
        console.error(`❌ Error inserting chunk ${i}:`, error.message);
      } else {
        process.stdout.write('.');
      }
    }

    console.log(`\n✅ Ingestion complete. ${chunks.length} blocks added to knowledge base.`);
  } catch (error) {
    console.error('❌ Ingestion failed:', error.message);
  }
}

// CLI usage: node importKnowledge.js <path_to_file> <source_tag>
const args = process.argv.slice(2);
if (args.length < 1) {
  console.log('Usage: node importKnowledge.js <file_path> [source_tag]');
  process.exit(1);
}

ingest(args[0], args[1] || 'manual');
