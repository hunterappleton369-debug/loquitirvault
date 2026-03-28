/**
 * BookedBeforeTheyGhost Agent
 *
 * Benefit: Converts interested leads into confirmed bookings before they go
 * dark. Runs a 7-touch, 14-day multi-channel follow-up sequence that keeps
 * the business top-of-mind without being annoying — so jobs get booked
 * instead of forgotten.
 *
 * Problem it solves: Most service businesses follow up once (maybe twice)
 * then move on. Research shows it takes 5-8 touches to convert a qualified
 * lead. The gap between touch 2 and touch 8 is where revenue disappears.
 * This agent runs the full sequence automatically.
 *
 * 7-Touch Sequence:
 *   Day 0  — Touch 1: Immediate confirmation + next step CTA (SMS)
 *   Day 1  — Touch 2: Value reinforcement email ("here's what to expect")
 *   Day 3  — Touch 3: Social proof SMS (review highlight + easy booking link)
 *   Day 5  — Touch 4: Soft urgency email (schedule is filling up)
 *   Day 7  — Touch 5: SMS check-in ("still looking for help with X?")
 *   Day 10 — Touch 6: Email with objection pre-empt (common questions answered)
 *   Day 14 — Touch 7: Final SMS + escalate to human if no response
 *
 * Trigger: Fires after QualifyBeforeYouDrive marks lead as qualified but
 *          not yet booked, OR when a lead goes quiet after initial contact.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const WEBHOOKS = {
  sendSms:          process.env.WEBHOOK_SEND_SMS           || 'https://hook.us2.make.com/REPLACE_SEND_SMS',
  sendEmail:        process.env.WEBHOOK_SEND_EMAIL         || 'https://hook.us2.make.com/REPLACE_SEND_EMAIL',
  scheduleFollowup: process.env.WEBHOOK_SCHEDULE_FOLLOWUP  || 'https://hook.us2.make.com/REPLACE_SCHEDULE_FOLLOWUP',
  updateCrm:        process.env.WEBHOOK_UPDATE_CRM         || 'https://hook.us2.make.com/REPLACE_UPDATE_CRM',
  notifyTeam:       process.env.WEBHOOK_NOTIFY_TEAM        || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
  bookAppointment:  process.env.WEBHOOK_BOOK_APPOINTMENT   || 'https://hook.us2.make.com/REPLACE_BOOK_APPOINTMENT',
};

// Touch sequence definition
const SEQUENCE = [
  { day: 0,  touch: 1, channel: 'sms',   type: 'confirmation' },
  { day: 1,  touch: 2, channel: 'email', type: 'value_reinforcement' },
  { day: 3,  touch: 3, channel: 'sms',   type: 'social_proof' },
  { day: 5,  touch: 4, channel: 'email', type: 'soft_urgency' },
  { day: 7,  touch: 5, channel: 'sms',   type: 'checkin' },
  { day: 10, touch: 6, channel: 'email', type: 'objection_preempt' },
  { day: 14, touch: 7, channel: 'sms',   type: 'final_close' },
];

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'send_touch',
    description: 'Send a specific touch in the follow-up sequence. Personalize based on lead details and touch type.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:      { type: 'string' },
        touch_number: { type: 'number', description: '1-7' },
        channel:      { type: 'string', enum: ['sms', 'email'] },
        touch_type:   { type: 'string', enum: ['confirmation', 'value_reinforcement', 'social_proof', 'soft_urgency', 'checkin', 'objection_preempt', 'final_close'] },
        to_phone:     { type: 'string' },
        to_email:     { type: 'string' },
        message:      { type: 'string', description: 'The personalized message body' },
        subject:      { type: 'string', description: 'Email subject line (only for email channel)' },
      },
      required: ['lead_id', 'touch_number', 'channel', 'touch_type', 'message'],
    },
  },
  {
    name: 'schedule_next_touch',
    description: 'Schedule the next touch in the sequence for a future date. Returns confirmation of the scheduled task.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:       { type: 'string' },
        next_touch:    { type: 'number', description: 'Touch number to schedule next (2-7)' },
        send_on_day:   { type: 'number', description: 'Day offset from lead creation (e.g. 1, 3, 5, 7, 10, 14)' },
        channel:       { type: 'string', enum: ['sms', 'email'] },
        touch_type:    { type: 'string' },
      },
      required: ['lead_id', 'next_touch', 'send_on_day', 'channel', 'touch_type'],
    },
  },
  {
    name: 'mark_sequence_complete',
    description: 'Mark the full 7-touch sequence as completed. Use when a lead has been booked OR when all 7 touches have been sent with no response.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:       { type: 'string' },
        outcome:       { type: 'string', enum: ['booked', 'unresponsive', 'declined'] },
        total_touches: { type: 'number' },
        note:          { type: 'string' },
      },
      required: ['lead_id', 'outcome'],
    },
  },
  {
    name: 'escalate_to_human',
    description: 'After 7 touches with no response, escalate to a human team member for a personal outreach attempt.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:    { type: 'string' },
        lead_name:  { type: 'string' },
        lead_phone: { type: 'string' },
        summary:    { type: 'string', description: 'Brief summary of the 14-day journey so the human has context' },
      },
      required: ['lead_id', 'lead_name', 'lead_phone', 'summary'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log touch completion and sequence status to CRM.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:       { type: 'string' },
        status:        { type: 'string' },
        touches_sent:  { type: 'number' },
        last_touch:    { type: 'string' },
        note:          { type: 'string' },
      },
      required: ['lead_id', 'status'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(toolName, toolInput) {
  const urlMap = {
    send_touch:             toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    schedule_next_touch:    WEBHOOKS.scheduleFollowup,
    mark_sequence_complete: WEBHOOKS.updateCrm,
    escalate_to_human:      WEBHOOKS.notifyTeam,
    update_crm:             WEBHOOKS.updateCrm,
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
const SYSTEM_PROMPT = `You are the BookedBeforeTheyGhost agent for a local home service business powered by Loquitir.

YOUR MISSION: Turn qualified leads into confirmed bookings using a 7-touch, 14-day follow-up sequence. Never let a warm lead go cold from lack of contact.

THE 7-TOUCH SEQUENCE:
- Touch 1 (Day 0, SMS): Booking confirmation / next step — "Thanks for reaching out! We'd love to help with your [service]. Reply BOOK to grab a spot this week, or here's our link: [link]"
- Touch 2 (Day 1, Email): Value reinforcement — what makes this business different, what to expect, credentials. Soft CTA.
- Touch 3 (Day 3, SMS): Social proof highlight — share one compelling review or result. "Quick note — one of our customers said: '[review]'. Still want to get that [service] sorted?"
- Touch 4 (Day 5, Email): Soft urgency — "Our schedule tends to fill up mid-week. Wanted to reach out before we lose availability for you."
- Touch 5 (Day 7, SMS): Simple check-in — "Hey [name], just checking in — are you still looking for help with [service]? Happy to answer any questions."
- Touch 6 (Day 10, Email): Objection pre-empt — address the top 2-3 questions leads have before booking (e.g., "How much does it cost?", "How long does it take?", "Are you licensed?")
- Touch 7 (Day 14, SMS): Final close + escalate — "Last check-in from us on [service]. If you're still interested, reply YES and we'll get you squared away. Otherwise, no worries at all!"

PERSONALIZATION RULES:
- Always use first name.
- Reference specific service/industry every touch.
- Vary the angle each touch — don't just say "Are you ready to book?" 7 times.
- Match tone to day: warm and helpful early, progressively more direct by Day 10-14.

STOPPING RULES:
- Stop the sequence immediately if the lead books, replies with a hard NO, or opts out.
- At Touch 7, escalate to human regardless of response.

When given a touch number to execute, send that specific touch, schedule the next one, and update the CRM. Always work one touch at a time.`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(lead, touchNumber = 1) {
  /**
   * @param {object} lead
   * @param {string} lead.fullName
   * @param {string} lead.phone
   * @param {string} lead.email
   * @param {string} lead.industry
   * @param {string} lead.leadId
   * @param {number} [touchNumber=1]  - Which touch to execute right now
   */

  const touchInfo = SEQUENCE.find(t => t.touch === touchNumber);
  if (!touchInfo) {
    return { success: false, error: `Invalid touch number: ${touchNumber}` };
  }

  const nextTouchInfo = SEQUENCE.find(t => t.touch === touchNumber + 1);

  const userMessage = `
Execute Touch ${touchNumber} for this lead now.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Email: ${lead.email || 'n/a'}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId || 'unknown'}

TOUCH TO EXECUTE:
- Touch: ${touchNumber} of 7
- Channel: ${touchInfo.channel}
- Type: ${touchInfo.type}
- Day: ${touchInfo.day}

${nextTouchInfo ? `NEXT TOUCH TO SCHEDULE: Touch ${nextTouchInfo.touch} on Day ${nextTouchInfo.day} via ${nextTouchInfo.channel}` : 'This is the final touch. Escalate to human after sending.'}

Send the message, schedule the next touch (if applicable), and update the CRM.
`.trim();

  const messages = [{ role: 'user', content: userMessage }];

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

export { SEQUENCE };

// ---------------------------------------------------------------------------
// CLI test harness
// ---------------------------------------------------------------------------
if (process.argv[1].endsWith('booked-before-they-ghost.js')) {
  const testLead = {
    fullName: 'James Whitfield',
    phone:    '(469) 555-0207',
    email:    'james@whitfieldroofing.com',
    industry: 'Roofing',
    leadId:   'lead_003',
  };

  run(testLead, 1).then(result => {
    console.log('[BookedBeforeTheyGhost]', JSON.stringify(result, null, 2));
  });
}
