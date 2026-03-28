/**
 * NeverMissALead Agent
 *
 * Benefit: Every new lead gets a professional, human-sounding response
 * within 5 minutes — day, night, weekend, holiday.
 *
 * Problem it solves: 80% of callers won't leave a voicemail. If no one
 * responds in the first 5 minutes, conversion drops by 80%. This agent
 * fires the instant a new lead hits the system and makes immediate contact
 * so your business is always first to respond.
 *
 * Trigger: New lead webhook from landing page form, Google LSA, or any
 *          inbound source (Make.com scenario fires this agent).
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Webhook endpoints (configure in your Make.com scenarios)
// ---------------------------------------------------------------------------
const WEBHOOKS = {
  sendSms:        process.env.WEBHOOK_SEND_SMS        || 'https://hook.us2.make.com/REPLACE_SEND_SMS',
  sendEmail:      process.env.WEBHOOK_SEND_EMAIL      || 'https://hook.us2.make.com/REPLACE_SEND_EMAIL',
  notifyTeam:     process.env.WEBHOOK_NOTIFY_TEAM     || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
  updateCrm:      process.env.WEBHOOK_UPDATE_CRM      || 'https://hook.us2.make.com/REPLACE_UPDATE_CRM',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'send_sms',
    description: 'Send an SMS message to the lead immediately. Use for the first-touch response — keep it friendly and action-oriented.',
    input_schema: {
      type: 'object',
      properties: {
        to_phone:   { type: 'string', description: 'Lead phone number in E.164 or formatted format' },
        message:    { type: 'string', description: 'SMS body (max 160 chars for single SMS)' },
        lead_id:    { type: 'string', description: 'CRM lead ID for tracking' },
      },
      required: ['to_phone', 'message'],
    },
  },
  {
    name: 'send_email',
    description: 'Send a personalized email to the lead. Use as a secondary touch alongside the SMS — include a clear CTA to book or call back.',
    input_schema: {
      type: 'object',
      properties: {
        to_email:   { type: 'string', description: 'Lead email address' },
        subject:    { type: 'string', description: 'Email subject line' },
        body:       { type: 'string', description: 'Email body in plain text (can include simple line breaks)' },
        lead_id:    { type: 'string', description: 'CRM lead ID for tracking' },
      },
      required: ['to_email', 'subject', 'body'],
    },
  },
  {
    name: 'notify_team',
    description: 'Ping the owner or on-call team member so a human can follow up if the lead replies. Do this after automated outreach.',
    input_schema: {
      type: 'object',
      properties: {
        channel:    { type: 'string', enum: ['sms', 'email', 'slack'], description: 'How to notify the team' },
        message:    { type: 'string', description: 'Internal notification content with lead details' },
        priority:   { type: 'string', enum: ['normal', 'hot'], description: 'hot = lead indicated immediate need' },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log that first-touch outreach was completed and timestamp it in the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:    { type: 'string', description: 'CRM lead ID' },
        status:     { type: 'string', description: 'New lead status, e.g. "first_touch_sent"' },
        note:       { type: 'string', description: 'Activity note to log' },
      },
      required: ['lead_id', 'status'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor — calls the matching Make.com webhook
// ---------------------------------------------------------------------------
async function executeTool(toolName, toolInput) {
  const urlMap = {
    send_sms:    WEBHOOKS.sendSms,
    send_email:  WEBHOOKS.sendEmail,
    notify_team: WEBHOOKS.notifyTeam,
    update_crm:  WEBHOOKS.updateCrm,
  };

  const url = urlMap[toolName];
  if (!url) return { error: `Unknown tool: ${toolName}` };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, ...toolInput }),
    });
    const text = await res.text();
    return { success: true, status: res.status, response: text };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the NeverMissALead agent for a local home service business powered by Loquitir.

YOUR MISSION: The moment a new lead arrives, execute a warm, professional 5-minute response sequence so the business is ALWAYS first to answer — even at midnight on a Sunday.

WHAT YOU DO:
1. Send an SMS to the lead within seconds of receiving their info — personalized with their first name and referencing their specific service need.
2. Send a follow-up email with a clear subject line and a single CTA (call back, book online, or reply to confirm a time).
3. Notify the business owner/team so a human is standing by if the lead responds.
4. Log the outreach in the CRM with a timestamp.

TONE: Friendly, local, professional. Never robotic. Sound like a helpful person from the business, not a bot.

PERSONALIZATION RULES:
- Always use the lead's first name.
- Reference their industry/service need specifically (e.g. "your HVAC issue" not "your request").
- If they submitted after business hours, acknowledge it: "We saw your message come in — our team is on it first thing in the morning."
- If during business hours: "We just got your info — someone will be reaching out within the next few minutes."

SMS RULES:
- Under 160 characters if possible.
- Include one clear next step (reply YES to confirm, call us at X, click to book).
- Never ask multiple questions.

EMAIL RULES:
- Subject line creates curiosity or urgency (avoid spam triggers like ALL CAPS or !!!).
- Body is 3-5 short sentences max.
- Single CTA button/link.

After executing all actions, respond with a brief summary of what was sent and why.`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(lead) {
  /**
   * @param {object} lead
   * @param {string} lead.fullName
   * @param {string} lead.businessName
   * @param {string} lead.email
   * @param {string} lead.phone
   * @param {string} lead.industry
   * @param {string} [lead.leadId]
   * @param {string} [lead.source]       e.g. "landing_page", "google_lsa", "phone"
   * @param {string} [lead.submittedAt]  ISO timestamp
   */

  const userMessage = `
New lead just came in. Execute the full 5-minute response sequence now.

LEAD DETAILS:
- Name: ${lead.fullName}
- Business: ${lead.businessName}
- Industry: ${lead.industry}
- Phone: ${lead.phone}
- Email: ${lead.email}
- Lead ID: ${lead.leadId || 'unknown'}
- Source: ${lead.source || 'landing_page'}
- Submitted At: ${lead.submittedAt || new Date().toISOString()}

Send the SMS, send the email, notify the team, and update the CRM. Go.
`.trim();

  const messages = [{ role: 'user', content: userMessage }];

  // Agentic loop
  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find(b => b.type === 'text');
      return { success: true, summary: textBlock?.text ?? 'Done.' };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  return { success: false, error: 'Unexpected stop reason' };
}

// ---------------------------------------------------------------------------
// CLI test harness
// ---------------------------------------------------------------------------
if (process.argv[1].endsWith('never-miss-a-lead.js')) {
  const testLead = {
    fullName:    'Mike Torres',
    businessName: 'Torres Plumbing',
    email:       'mike@torresplumbing.com',
    phone:       '(512) 555-0142',
    industry:    'Plumbing',
    leadId:      'lead_001',
    source:      'landing_page',
    submittedAt: new Date().toISOString(),
  };

  run(testLead).then(result => {
    console.log('[NeverMissALead]', JSON.stringify(result, null, 2));
  });
}
