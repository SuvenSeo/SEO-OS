#!/usr/bin/env node
/**
 * SEOS Vercel Environment Variable Updater
 * 
 * Usage:
 *   node scripts/update-vercel-env.js
 * 
 * Setup:
 *   1. Get your Vercel personal access token from: https://vercel.com/account/tokens
 *   2. Get your project ID from: https://vercel.com/[your-team]/seo-os-agent/settings
 *   3. Edit the CONFIG section below OR set as environment variables
 */

const https = require('https');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Either edit these directly or set them as env vars before running the script
const VERCEL_TOKEN  = process.env.VERCEL_TOKEN  || 'PASTE_YOUR_VERCEL_TOKEN_HERE';
const PROJECT_ID    = process.env.VERCEL_PROJECT_ID || 'PASTE_YOUR_PROJECT_ID_HERE';
const TEAM_ID       = process.env.VERCEL_TEAM_ID || ''; // leave empty if personal account

// ─── KEYS TO UPDATE ──────────────────────────────────────────────────────────
// Add your comma-separated API keys here:
const KEYS_TO_UPDATE = {
  // Multiple Groq keys (create free accounts at console.groq.com)
  // Format: key1,key2,key3
  GROQ_API_KEYS: process.env.NEW_GROQ_KEYS || '',

  // Multiple Gemini keys (create free at aistudio.google.com/apikey)
  // Format: key1,key2,key3
  GEMINI_API_KEYS: process.env.NEW_GEMINI_KEYS || '',
};
// ─────────────────────────────────────────────────────────────────────────────

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.vercel.com${path}`);
    if (TEAM_ID) url.searchParams.set('teamId', TEAM_ID);

    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function upsertEnvVar(key, value) {
  if (!value || value.includes('PASTE_')) {
    console.log(`⏭  Skipping ${key} — no value set`);
    return;
  }

  // Check if it exists
  const listResp = await apiRequest('GET', `/v9/projects/${PROJECT_ID}/env`);
  const existing = listResp.body?.envs?.find(e => e.key === key);

  if (existing) {
    // Update existing
    const resp = await apiRequest('PATCH', `/v9/projects/${PROJECT_ID}/env/${existing.id}`, {
      value,
      target: ['production', 'preview'],
    });
    if (resp.status < 300) {
      console.log(`✅ Updated: ${key}`);
    } else {
      console.error(`❌ Failed to update ${key}:`, resp.body);
    }
  } else {
    // Create new
    const resp = await apiRequest('POST', `/v9/projects/${PROJECT_ID}/env`, {
      key,
      value,
      type: 'encrypted',
      target: ['production', 'preview'],
    });
    if (resp.status < 300) {
      console.log(`✅ Created: ${key}`);
    } else {
      console.error(`❌ Failed to create ${key}:`, resp.body);
    }
  }
}

async function triggerRedeploy() {
  // Get latest deployment
  const resp = await apiRequest('GET', `/v6/deployments?projectId=${PROJECT_ID}&limit=1`);
  const latest = resp.body?.deployments?.[0];
  if (!latest) return;

  const redeployResp = await apiRequest('POST', `/v13/deployments`, {
    name: latest.name,
    deploymentId: latest.uid,
    target: 'production',
  });
  if (redeployResp.status < 300) {
    console.log('🚀 Redeployment triggered');
  }
}

async function main() {
  if (VERCEL_TOKEN === 'PASTE_YOUR_VERCEL_TOKEN_HERE' || PROJECT_ID === 'PASTE_YOUR_PROJECT_ID_HERE') {
    console.error('❌ Please set VERCEL_TOKEN and PROJECT_ID in the script or as env vars');
    console.error('   Get token at: https://vercel.com/account/tokens');
    console.error('   Get project ID from: Vercel dashboard → your project → Settings → General');
    process.exit(1);
  }

  console.log('🔄 Updating Vercel environment variables...\n');

  for (const [key, value] of Object.entries(KEYS_TO_UPDATE)) {
    await upsertEnvVar(key, value);
  }

  console.log('\n🔄 Triggering redeployment...');
  await triggerRedeploy();
  console.log('\n✅ Done! Changes will be live in ~30 seconds.');
  console.log('   To add keys: set NEW_GROQ_KEYS="key1,key2" NEW_GEMINI_KEYS="key1" node scripts/update-vercel-env.js');
}

main().catch(console.error);
