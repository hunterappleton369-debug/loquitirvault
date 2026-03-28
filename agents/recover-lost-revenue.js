/**
 * RecoverLostRevenue Agent
 *
 * Benefit: Mines the existing estimate history for dormant revenue. Targets
 * leads that went cold 90-365 days ago and re-engages them with a natural,
 * non-desperate win-back sequence — turning dead estimates into booked jobs.
 *
 * Problem it solves: Most businesses throw away old estimates. But "lost"
 * doesn't mean "gone." Circumstances change — the competitor was unreliable,
 * the project got greenlit, the problem got worse. A single win-back campaign
 * to 12-month-old estimates typically generates $15,000-$50,000 in recovered
 * revenue per 100 leads contacted.
 *
 * Who to target:
 * - Estimates sent 90-365 days ago with no close (won or lost)
 * - Leads that said "not yet" or "maybe later"
 * - Customers who got one job done and haven't been heard from since
 *
 * Win-Back Sequence (3 touches over 14 days):
 *   Touch 1 (Day 0, SMS):   Natural reconnect — "checking in" tone, reference the original project
 *   Touch 2 (Day 5, Email): Value + seasonal relevance (new offer, seasonal need)
 *   Touch 3 (Day 14, SMS):  Final shot — low pressure, clear CTA, easy YES/NO
 *
 * Trigger: Runs on a scheduled basis (weekly batch) or fires when
 *          mark_estimate_lost sets trigger_winback = true.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const WEBHOOKS = {
  sendSms:          process.env.WEBHOOK_SEND_SMS           || 'https://hook.us2.make.com/REPLACE_SEND_SMS',
  sendEmail:        process.env.WEBHOOK_SEND_EMAIL         || 'https://hook.us2.make.com/REPLACE_SEND_EMAIL',
  updateCrm:        process.env.WEBHOOK_UPDATE_CRM         || 'https://hook.us2.make.com/REPLACE_UPDATE_CRM',
  scheduleFollowup: process.env.WEBHOOK_SCHEDULE_FOLLOWUP  || 'https://hook.us2.make.com/REPLACE_SCHEDULE_FOLLOWUP',
  notifyTeam:       process.env.WEBHOOK_NOTIFY_TEAM        || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
  fetchDormantLeads:process.env.WEBHOOK_FETCH_DORMANT      || 'https://hook.us2.make.com/REPLACE_FETCH_DORMANT',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'fetch_dormant_leads',
    description: 'Pull a list of leads with estimates sent 90-365 days ago that were never won or explicitly lost. These are the win-back targets.',
    input_schema: {
      type: 'object',
      properties: {
        min_days_dormant: { type: 'number', description: 'Minimum days since last contact (default: 90)', default: 90 },
        max_days_dormant: { type: 'number', description: 'Maximum days since last contact (default: 365)', default: 365 },
        industry_filter:  { type: 'string', description: 'Optional: filter to a specific industry' },
        min_estimate_value:{ type: 'number', description: 'Only target leads above this estimate amount' },
        limit:            { type: 'number', description: 'Max leads to return per batch (default: 50)', default: 50 },
      },
      required: [],
    },
  },
  {
    name: 'send_winback_touch',
    description: 'Send a win-back message to a dormant lead. Use a natural, low-pressure tone — not salesy.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:           { type: 'string' },
        channel:           { type: 'string', enum: ['sms', 'email'] },
        to_contact:        { type: 'string', description: 'Phone or email' },
        touch_number:      { type: 'number', description: '1, 2, or 3' },
        touch_type:        { type: 'string', enum: ['reconnect', 'seasonal_value', 'final_offer'] },
        message:           { type: 'string', description: 'The win-back message' },
        subject:           { type: 'string', description: 'Email subject (email only)' },
        original_service:  { type: 'string', description: 'The service they originally inquired about' },
        months_ago:        { type: 'number', description: 'How many months ago they first reached out' },
      },
      required: ['lead_id', 'channel', 'to_contact', 'touch_number', 'touch_type', 'message'],
    },
  },
  {
    name: 'apply_seasonal_hook',
    description: 'Identify and apply the most relevant seasonal or situational hook for this lead based on their industry and time of year.',
    input_schema: {
      type: 'object',
      properties: {
        industry:     { type: 'string', description: 'Lead industry (e.g. HVAC, Roofing, Plumbing)' },
        current_month:{ type: 'number', description: 'Current month 1-12' },
        region:       { type: 'string', description: 'Optional geographic region for climate context' },
      },
      required: ['industry', 'current_month'],
    },
  },
  {
    name: 'schedule_winback_followup',
    description: 'Schedule the next touch in the win-back sequence.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:      { type: 'string' },
        next_touch:   { type: 'number', description: '2 or 3' },
        delay_days:   { type: 'number', description: 'Days until next touch (5 or 14)' },
        channel:      { type: 'string', enum: ['sms', 'email'] },
        touch_type:   { type: 'string' },
      },
      required: ['lead_id', 'next_touch', 'delay_days', 'channel', 'touch_type'],
    },
  },
  {
    name: 'mark_winback_won',
    description: 'A dormant lead responded positively. Log the recovery and hand off to booking.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:            { type: 'string' },
        lead_name:          { type: 'string' },
        lead_phone:         { type: 'string' },
        recovered_from_days:{ type: 'number', description: 'How many days dormant before recovery' },
        note:               { type: 'string' },
      },
      required: ['lead_id', 'lead_name', 'lead_phone'],
    },
  },
  {
    name: 'mark_winback_exhausted',
    description: 'All 3 win-back touches sent with no response. Archive lead permanently.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:    { type: 'string' },
        touches_sent:{ type: 'number' },
        note:       { type: 'string' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log win-back activity to CRM.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        status:  { type: 'string' },
        note:    { type: 'string' },
      },
      required: ['lead_id', 'status'],
    },
  },
];

// ---------------------------------------------------------------------------
// Seasonal hooks by industry and month
// ---------------------------------------------------------------------------
export function getSeasonalHook(industry, month) {
  const hooks = {
    HVAC: {
      spring: 'Before summer heat hits, get your AC serviced.',
      summer: 'With temperatures climbing, now is the time to make sure your system is ready.',
      fall:   'Before the first cold snap, make sure your heat is ready.',
      winter: 'Mid-winter breakdown is the worst time to discover a problem.',
    },
    Roofing: {
      spring: 'Spring storms are coming — now is the time to address any vulnerabilities.',
      summer: 'Dry season is the best time for roofing work — no rain delays.',
      fall:   'Get repairs done before winter rain and freeze damage.',
      winter: 'Inspect now — ice and snow can turn small issues into major leaks.',
    },
    Plumbing: {
      spring: 'Spring is the perfect time to address any pipe issues before summer demand.',
      summer: 'Summer water usage spikes — make sure your system can handle it.',
      fall:   'Winterize your pipes before the first freeze.',
      winter: 'Frozen pipes are a real risk — address any vulnerabilities now.',
    },
    Electrical: {
      spring: 'Spring cleaning is a great time to check your panel and outlets.',
      summer: 'Summer AC load stresses electrical systems — now is the time to inspect.',
      fall:   'Holiday lighting and heaters increase electrical load — inspect before the season.',
      winter: 'Space heaters and holiday lights create overload risks.',
    },
    Landscaping: {
      spring: 'Spring is prime season — get on the calendar now before slots fill.',
      summer: 'Summer maintenance keeps your property looking its best through the season.',
      fall:   'Fall cleanup and winterization locks in curb appeal.',
      winter: 'Plan your spring project now before the rush.',
    },
  };

  const season = month >= 3 && month <= 5 ? 'spring'
    : month >= 6 && month <= 8 ? 'summer'
    : month >= 9 && month <= 11 ? 'fall'
    : 'winter';

  return hooks[industry]?.[season] ?? `It's a great time to get that ${industry.toLowerCase()} work taken care of.`;
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(toolName, toolInput) {
  // apply_seasonal_hook is computed locally
  if (toolName === 'apply_seasonal_hook') {
    const hook = getSeasonalHook(toolInput.industry, toolInput.current_month);
    return { hook, industry: toolInput.industry, season: toolInput.current_month };
  }

  const urlMap = {
    fetch_dormant_leads:      WEBHOOKS.fetchDormantLeads,
    send_winback_touch:       toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    schedule_winback_followup:WEBHOOKS.scheduleFollowup,
    mark_winback_won:         WEBHOOKS.notifyTeam,
    mark_winback_exhausted:   WEBHOOKS.updateCrm,
    update_crm:               WEBHOOKS.updateCrm,
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
const SYSTEM_PROMPT = `You are the RecoverLostRevenue agent for a local home service business powered by Loquitir.

YOUR MISSION: Turn dormant, forgotten leads back into booked jobs. These are people who expressed interest, got an estimate, and went quiet. Circumstances change. Your job is to re-open the conversation naturally — never desperately.

WIN-BACK PHILOSOPHY:
- Don't pretend nothing happened. Reference the original inquiry.
- Don't lead with "just following up" — that's weak. Lead with relevance.
- Use seasonal hooks to make the outreach feel timely, not random.
- Keep it easy to say yes: "Just reply YES and we'll get you sorted."
- Never pressure or guilt-trip. This is a service, not a shakedown.

3-TOUCH WIN-BACK SEQUENCE:

TOUCH 1 (Day 0, SMS) — Natural Reconnect:
"Hey [name] — it's [company]. A while back you reached out about [service]. Wanted to circle back in case the timing works better now. Still something we can help with? 😊"
Keep it short. Conversational. No hard sell.

TOUCH 2 (Day 5, Email) — Seasonal Value:
Subject: "[Service] for [season] — a few things worth knowing"
Body: Reference the seasonal hook. Share a relevant tip or reminder. Attach or link to the original estimate. "We updated our availability and have some openings next week if you'd like to get it taken care of."

TOUCH 3 (Day 14, SMS) — Final Easy Ask:
"Last note from us on the [service] — if the timing is ever right, just reply YES and we'll reach out right away. No pressure at all. 🙌"

SEASONAL HOOK RULES:
- Always get a seasonal hook before writing the message — it makes the outreach feel relevant, not random.
- Reference the current month/season in the context of their specific service need.

OUTCOME:
- If they respond positively → mark_winback_won, escalate to booking flow
- If no response after Touch 3 → mark_winback_exhausted, archive permanently
- Never send more than 3 touches in a win-back sequence

BATCH CAMPAIGNS:
If given a list of dormant leads, process them one at a time — send Touch 1 to each, then schedule Touches 2 and 3.`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(context) {
  /**
   * Two modes:
   * 1. Single lead win-back: pass { lead, touchNumber }
   * 2. Batch campaign: pass { batchMode: true, filters }
   *
   * @param {object} context
   * @param {object} [context.lead]         - Single lead object
   * @param {number} [context.touchNumber=1]
   * @param {boolean} [context.batchMode]
   * @param {object} [context.filters]      - { minDays, maxDays, industry, minValue }
   */

  let userMessage;

  if (context.batchMode) {
    const filters = context.filters || {};
    userMessage = `
Run a win-back batch campaign. Fetch dormant leads and execute Touch 1 for each one.

CAMPAIGN FILTERS:
- Min days dormant: ${filters.minDays || 90}
- Max days dormant: ${filters.maxDays || 365}
- Industry: ${filters.industry || 'all'}
- Min estimate value: $${filters.minValue || 0}

Start by calling fetch_dormant_leads. Then for each lead, get the seasonal hook, send Touch 1 (SMS reconnect), and schedule Touch 2 for Day 5.
`.trim();
  } else {
    const { lead, touchNumber = 1 } = context;
    const touchTypes = ['reconnect', 'seasonal_value', 'final_offer'];
    const touchChannels = ['sms', 'email', 'sms'];
    const touchDays = [0, 5, 14];

    userMessage = `
Execute Win-Back Touch ${touchNumber} for this dormant lead.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Email: ${lead.email || 'n/a'}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId}
- Original Service: ${lead.originalService || lead.industry + ' work'}
- Months Since Contact: ${lead.monthsDormant || 'unknown'}
- Original Estimate: $${lead.originalEstimate?.toLocaleString() || 'unknown'}

TOUCH:
- Touch: ${touchNumber} of 3
- Type: ${touchTypes[touchNumber - 1]}
- Channel: ${touchChannels[touchNumber - 1]}
- Day: ${touchDays[touchNumber - 1]}

First, get the seasonal hook for their industry. Then craft and send the message. Schedule the next touch if applicable. Update CRM.
Current month: ${new Date().getMonth() + 1}
`.trim();
  }

  const messages = [{ role: 'user', content: userMessage }];

  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
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
if (process.argv[1].endsWith('recover-lost-revenue.js')) {
  const testLead = {
    fullName:         'Linda Okafor',
    phone:            '(832) 555-0563',
    email:            'linda@okaforpest.com',
    industry:         'Pest Control',
    leadId:           'lead_006',
    originalService:  'quarterly pest control plan',
    monthsDormant:    8,
    originalEstimate: 1200,
  };

  run({ lead: testLead, touchNumber: 1 }).then(result => {
    console.log('[RecoverLostRevenue]', JSON.stringify(result, null, 2));
  });
}
