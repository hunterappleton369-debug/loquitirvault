#!/usr/bin/env node

/**
 * Loquitir Tree Service Agent — Setup Script
 *
 * Creates a RetellAI inbound voice agent configured with:
 * - Professional tree service receptionist prompt
 * - Cal.com preset functions (Check Availability + Book Appointment)
 * - End Call function
 *
 * Usage: node agent/setup.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Retell = require('retell-sdk');

const REQUIRED_ENV = ['RETELL_API_KEY', 'CALCOM_API_KEY', 'CALCOM_EVENT_TYPE_ID', 'CALCOM_USERNAME'];

function validateEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nCopy .env.example to .env and fill in your values.');
    process.exit(1);
  }
}

async function main() {
  validateEnv();

  const retell = new Retell({ apiKey: process.env.RETELL_API_KEY });

  // Load prompt and config
  const prompt = fs.readFileSync(path.join(__dirname, 'prompt.md'), 'utf-8');
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));

  console.log('Creating RetellAI agent...\n');

  // Step 1: Create the LLM with our prompt and preset functions
  const llm = await retell.llm.create({
    model: 'claude-4.5-sonnet',
    general_prompt: prompt,
    general_tools: [
      {
        type: 'check_availability_cal',
        name: 'check_calendar_availability',
        cal_api_key: process.env.CALCOM_API_KEY,
        event_type_id: parseInt(process.env.CALCOM_EVENT_TYPE_ID, 10),
        cal_username: process.env.CALCOM_USERNAME,
        timezone: config.cal_com.timezone,
        description:
          'Check calendar availability for a tree service consultation. Call this ONLY after collecting the caller\'s name, phone number, address, and problem description.',
      },
      {
        type: 'book_appointment_cal',
        name: 'book_appointment',
        cal_api_key: process.env.CALCOM_API_KEY,
        event_type_id: parseInt(process.env.CALCOM_EVENT_TYPE_ID, 10),
        timezone: config.cal_com.timezone,
        description:
          'Book a tree service consultation appointment on the calendar. Call this after the caller has selected a time slot.',
      },
      {
        type: 'end_call',
        name: 'end_call',
        description:
          'End the phone call. Use this after confirming the appointment details and the caller has no more questions, or if the caller wants to hang up.',
      },
    ],
  });

  console.log(`LLM created: ${llm.llm_id}`);

  // Step 2: Create the agent with the LLM
  const agent = await retell.agent.create({
    agent_name: config.agent_name,
    response_engine: {
      type: 'retell-llm',
      llm_id: llm.llm_id,
    },
    voice_id: config.voice_id,
    language: config.language,
    responsiveness: config.responsiveness,
    interruption_sensitivity: config.interruption_sensitivity,
    enable_backchannel: config.enable_backchannel,
    backchannel_frequency: config.backchannel_frequency,
    reminder_trigger_ms: config.reminder_trigger_ms,
    reminder_max_count: config.reminder_max_count,
    ambient_sound: config.ambient_sound,
    ambient_sound_volume: config.ambient_sound_volume,
    end_call_after_silence_ms: config.end_call_after_silence_ms,
    max_call_duration_ms: config.max_call_duration_ms,
    voicemail_detection_timeout_ms: config.voicemail_detection_timeout_ms,
    normalize_for_speech: config.normalize_for_speech,
    opt_out_sensitive_data_storage: config.opt_out_sensitive_data_storage,
  });

  console.log(`Agent created: ${agent.agent_id}`);
  console.log(`Agent name: ${agent.agent_name}`);

  // Step 3: List available phone numbers
  console.log('\n--- Phone Numbers ---');
  try {
    const phoneNumbers = await retell.phoneNumber.list();
    if (phoneNumbers.length === 0) {
      console.log('No phone numbers found. Purchase one in the RetellAI dashboard:');
      console.log('  https://dashboard.retellai.com/phone-numbers');
    } else {
      console.log('Available phone numbers:');
      phoneNumbers.forEach((pn) => {
        const assigned = pn.agent_id ? ` (assigned to agent ${pn.agent_id})` : ' (unassigned)';
        console.log(`  ${pn.phone_number}${assigned}`);
      });
      console.log(`\nTo assign a phone number to this agent, run:`);
      console.log(`  node -e "require('dotenv').config(); new (require('retell-sdk'))({apiKey: process.env.RETELL_API_KEY}).phoneNumber.update('YOUR_PHONE_NUMBER', {inbound_agent_id: '${agent.agent_id}'}).then(console.log)"`);
    }
  } catch (err) {
    console.log('Could not list phone numbers:', err.message);
  }

  // Save agent info for test script
  const agentInfo = {
    agent_id: agent.agent_id,
    llm_id: llm.llm_id,
    agent_name: agent.agent_name,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, '.agent-info.json'), JSON.stringify(agentInfo, null, 2));

  console.log('\n--- Summary ---');
  console.log(`Agent ID:  ${agent.agent_id}`);
  console.log(`LLM ID:    ${llm.llm_id}`);
  console.log(`Voice:     ${config.voice_id}`);
  console.log(`Language:  ${config.language}`);
  console.log(`\nAgent info saved to agent/.agent-info.json`);
  console.log('Next steps:');
  console.log('  1. Assign a phone number to this agent (see above)');
  console.log('  2. Test with: npm run test-agent');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  if (err.response) {
    console.error('API response:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
