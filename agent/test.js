#!/usr/bin/env node

/**
 * Loquitir Tree Service Agent — Test Script
 *
 * Creates a web call so you can test the agent in your browser.
 * Optionally fetches the transcript after the call ends.
 *
 * Usage: node agent/test.js
 *        node agent/test.js --transcript <call_id>
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Retell = require('retell-sdk');
const { HttpsProxyAgent } = require('https-proxy-agent');

function loadAgentInfo() {
  const infoPath = path.join(__dirname, '.agent-info.json');
  if (!fs.existsSync(infoPath)) {
    console.error('No agent found. Run setup first: npm run setup-agent');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
}

async function createTestCall(retell, agentId) {
  console.log('Creating test web call...\n');

  const call = await retell.call.createWebCall({
    agent_id: agentId,
    metadata: { test: true, created_by: 'test-script' },
  });

  console.log('--- Test Call Ready ---');
  console.log(`Call ID:    ${call.call_id}`);
  console.log(`Access URL: ${call.access_url || 'Check RetellAI dashboard'}`);
  console.log('\nOpen the URL above in your browser to test the agent.');
  console.log('The agent will answer as a tree service receptionist.\n');
  console.log('Test checklist:');
  console.log('  [ ] Agent greets you professionally');
  console.log('  [ ] Asks about your tree problem');
  console.log('  [ ] Collects your name');
  console.log('  [ ] Asks for / confirms phone number');
  console.log('  [ ] Asks for the service address');
  console.log('  [ ] Checks calendar availability');
  console.log('  [ ] Offers time slots');
  console.log('  [ ] Books the appointment');
  console.log('  [ ] Reads back all details for confirmation');
  console.log('  [ ] Ends the call politely');
  console.log(`\nAfter the call, view transcript with:`);
  console.log(`  node agent/test.js --transcript ${call.call_id}`);

  return call;
}

async function getTranscript(retell, callId) {
  console.log(`Fetching transcript for call ${callId}...\n`);

  const call = await retell.call.retrieve(callId);

  console.log('--- Call Details ---');
  console.log(`Status:     ${call.call_status}`);
  console.log(`Duration:   ${call.duration_ms ? Math.round(call.duration_ms / 1000) + 's' : 'N/A'}`);
  console.log(`Direction:  ${call.direction || 'web'}`);
  console.log(`Start:      ${call.start_timestamp || 'N/A'}`);
  console.log(`End:        ${call.end_timestamp || 'N/A'}`);

  if (call.transcript) {
    console.log('\n--- Transcript ---');
    console.log(call.transcript);
  } else if (call.transcript_object) {
    console.log('\n--- Transcript ---');
    call.transcript_object.forEach((turn) => {
      const role = turn.role === 'agent' ? 'AGENT' : 'CALLER';
      console.log(`[${role}]: ${turn.content}`);
    });
  } else {
    console.log('\nNo transcript available yet. The call may still be in progress.');
    console.log('Try again in a few moments.');
  }

  if (call.call_analysis) {
    console.log('\n--- Call Analysis ---');
    if (call.call_analysis.call_summary) {
      console.log(`Summary: ${call.call_analysis.call_summary}`);
    }
    if (call.call_analysis.custom_analysis_data) {
      console.log('Extracted data:', JSON.stringify(call.call_analysis.custom_analysis_data, null, 2));
    }
  }

  // Check if required info was collected
  console.log('\n--- Data Collection Check ---');
  const transcript = call.transcript || '';
  const hasName = /name/i.test(transcript) || /my name is/i.test(transcript);
  const hasPhone = /phone|number|call.*back|reach.*at/i.test(transcript);
  const hasAddress = /address|street|where.*work|location/i.test(transcript);
  const hasProblem = /tree|trim|remov|stump|branch|dead|fallen/i.test(transcript);

  console.log(`  Name collected:    ${hasName ? 'LIKELY' : 'CHECK MANUALLY'}`);
  console.log(`  Phone collected:   ${hasPhone ? 'LIKELY' : 'CHECK MANUALLY'}`);
  console.log(`  Address collected: ${hasAddress ? 'LIKELY' : 'CHECK MANUALLY'}`);
  console.log(`  Problem described: ${hasProblem ? 'LIKELY' : 'CHECK MANUALLY'}`);
}

async function main() {
  if (!process.env.RETELL_API_KEY) {
    console.error('RETELL_API_KEY not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const clientOpts = { apiKey: process.env.RETELL_API_KEY };
  if (proxyUrl) {
    clientOpts.httpAgent = new HttpsProxyAgent(proxyUrl);
  }
  const retell = new Retell(clientOpts);
  const agentInfo = loadAgentInfo();
  const args = process.argv.slice(2);

  if (args[0] === '--transcript' && args[1]) {
    await getTranscript(retell, args[1]);
  } else if (args[0] === '--transcript') {
    console.error('Usage: node agent/test.js --transcript <call_id>');
    process.exit(1);
  } else {
    await createTestCall(retell, agentInfo.agent_id);
  }
}

main().catch((err) => {
  console.error('Test failed:', err.message);
  if (err.response) {
    console.error('API response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
