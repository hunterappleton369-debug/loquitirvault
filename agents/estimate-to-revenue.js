/**
 * EstimateToRevenue Agent
 *
 * Benefit: Turns sent estimates into signed jobs. Bridges the critical gap
 * between "I'll think about it" and "let's do it" with a professional,
 * persistent follow-up sequence tied to the estimate — including
 * 3-tier pricing reinforcement and urgency triggers.
 *
 * Problem it solves: The average home service business sends an estimate and
 * waits. Then wonders why close rates sit at 25-35%. Estimates go stale fast.
 * This agent activates the moment an estimate is sent and works the lead
 * until they accept, decline, or need an objection handled.
 *
 * Strategy used:
 * - 3-tier pricing presentation (Essential / Complete / Premium)
 * - "Most Popular" framing on the middle tier
 * - Social proof + credentials reminder at the estimate stage
 * - Scheduling reality urgency ("we're booking 2-3 weeks out")
 * - Escalate to ObjectionToBooking agent if price resistance detected
 *
 * Trigger: Fires when an estimate is marked "sent" in the CRM.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const WEBHOOKS = {
  sendSms:             process.env.WEBHOOK_SEND_SMS              || 'https://hook.us2.make.com/REPLACE_SEND_SMS',
  sendEmail:           process.env.WEBHOOK_SEND_EMAIL            || 'https://hook.us2.make.com/REPLACE_SEND_EMAIL',
  updateCrm:           process.env.WEBHOOK_UPDATE_CRM            || 'https://hook.us2.make.com/REPLACE_UPDATE_CRM',
  scheduleFollowup:    process.env.WEBHOOK_SCHEDULE_FOLLOWUP     || 'https://hook.us2.make.com/REPLACE_SCHEDULE_FOLLOWUP',
  notifyTeam:          process.env.WEBHOOK_NOTIFY_TEAM           || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
  triggerObjection:    process.env.WEBHOOK_TRIGGER_OBJECTION     || 'https://hook.us2.make.com/REPLACE_TRIGGER_OBJECTION',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'send_estimate_followup',
    description: 'Send a follow-up message about the pending estimate. Choose the right channel, timing, and angle based on which touch this is.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:       { type: 'string' },
        channel:       { type: 'string', enum: ['sms', 'email'] },
        touch_type:    { type: 'string', enum: ['estimate_sent', 'value_recap', 'urgency', 'final_decision'] },
        to_phone:      { type: 'string' },
        to_email:      { type: 'string' },
        message:       { type: 'string', description: 'Personalized message body' },
        subject:       { type: 'string', description: 'Email subject (email only)' },
        estimate_total:{ type: 'number', description: 'Dollar amount of estimate' },
        tier_selected: { type: 'string', enum: ['essential', 'complete', 'premium', 'unknown'] },
      },
      required: ['lead_id', 'channel', 'touch_type', 'message'],
    },
  },
  {
    name: 'reinforce_pricing_tiers',
    description: 'Send the 3-tier pricing summary to remind the lead of their options. Emphasize the "Most Popular" middle tier.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:          { type: 'string' },
        to_email:         { type: 'string' },
        to_phone:         { type: 'string' },
        essential_price:  { type: 'number', description: 'Essential tier price' },
        essential_desc:   { type: 'string', description: 'What Essential includes' },
        complete_price:   { type: 'number', description: 'Complete tier price (Most Popular)' },
        complete_desc:    { type: 'string', description: 'What Complete includes' },
        premium_price:    { type: 'number', description: 'Premium tier price' },
        premium_desc:     { type: 'string', description: 'What Premium includes' },
      },
      required: ['lead_id', 'essential_price', 'complete_price', 'premium_price'],
    },
  },
  {
    name: 'apply_urgency_trigger',
    description: 'Send a scheduling reality message. Mention lead time, seasonal demand, or limited availability to create genuine urgency.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:        { type: 'string' },
        channel:        { type: 'string', enum: ['sms', 'email'] },
        to_contact:     { type: 'string', description: 'Phone or email depending on channel' },
        urgency_type:   { type: 'string', enum: ['schedule_filling', 'seasonal_deadline', 'safety_risk', 'limited_slots'], description: 'The angle for urgency' },
        lead_time_days: { type: 'number', description: 'Current booking lead time in days' },
        message:        { type: 'string', description: 'The urgency message' },
      },
      required: ['lead_id', 'channel', 'to_contact', 'urgency_type', 'message'],
    },
  },
  {
    name: 'escalate_to_objection_handler',
    description: 'Hand off to the ObjectionToBooking agent when the lead shows price resistance, comparison shopping, or indecision signals.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:         { type: 'string' },
        lead_name:       { type: 'string' },
        lead_phone:      { type: 'string' },
        objection_type:  { type: 'string', enum: ['price', 'comparison', 'spouse', 'timing', 'need_to_think'], description: 'Detected objection category' },
        context:         { type: 'string', description: 'What the lead said or signaled that triggered this' },
        estimate_amount: { type: 'number' },
      },
      required: ['lead_id', 'lead_name', 'objection_type'],
    },
  },
  {
    name: 'mark_estimate_won',
    description: 'Record estimate as won/accepted in CRM. Stop all follow-up sequences for this lead.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:        { type: 'string' },
        job_value:      { type: 'number', description: 'Final accepted job value' },
        tier_accepted:  { type: 'string', enum: ['essential', 'complete', 'premium'] },
        note:           { type: 'string' },
      },
      required: ['lead_id', 'job_value'],
    },
  },
  {
    name: 'mark_estimate_lost',
    description: 'Record estimate as lost. Optionally trigger the RecoverLostRevenue agent for a future win-back attempt.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:         { type: 'string' },
        loss_reason:     { type: 'string', enum: ['price', 'went_with_competitor', 'postponed', 'unresponsive', 'cancelled_project'] },
        trigger_winback: { type: 'boolean', description: 'Schedule a win-back attempt in 90 days' },
        note:            { type: 'string' },
      },
      required: ['lead_id', 'loss_reason'],
    },
  },
  {
    name: 'schedule_followup',
    description: 'Schedule the next estimate follow-up touch at the correct interval.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:      { type: 'string' },
        next_touch:   { type: 'string', description: 'Description of the next action' },
        delay_hours:  { type: 'number', description: 'Hours from now to send next touch (e.g. 24, 48, 72)' },
        channel:      { type: 'string', enum: ['sms', 'email'] },
      },
      required: ['lead_id', 'next_touch', 'delay_hours'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log estimate follow-up activity to CRM.',
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
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(toolName, toolInput) {
  const urlMap = {
    send_estimate_followup:       toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    reinforce_pricing_tiers:      WEBHOOKS.sendEmail,
    apply_urgency_trigger:        toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    escalate_to_objection_handler:WEBHOOKS.triggerObjection,
    mark_estimate_won:            WEBHOOKS.updateCrm,
    mark_estimate_lost:           WEBHOOKS.updateCrm,
    schedule_followup:            WEBHOOKS.scheduleFollowup,
    update_crm:                   WEBHOOKS.updateCrm,
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
const SYSTEM_PROMPT = `You are the EstimateToRevenue agent for a local home service business powered by Loquitir.

YOUR MISSION: Convert sent estimates into signed jobs. The estimate was already delivered — your job is to bridge the gap between "received" and "accepted."

ESTIMATE FOLLOW-UP SEQUENCE:
1. Estimate Sent (immediately): SMS — "Just sent over your estimate for [service]! Check your email and reply with any questions. To lock in your spot this week, just reply YES."
2. Value Recap (24 hrs later, email): Remind them WHY this business. Credentials, license, reviews, years in business. Reinforce the estimate is valid for X days.
3. Pricing Tier Reinforcement (48 hrs, email): Show the 3-tier options cleanly. Label the middle tier "Most Popular." Let them choose up or down.
4. Urgency Touch (72 hrs, SMS): "Just a heads up — our schedule is filling up. If you want the week of [date], we need to confirm by [date]. Just reply YES and we'll lock it in."
5. Final Decision (5-7 days, SMS): "Hey [name], last follow-up on your [service] estimate. Still want to move forward? Happy to answer any final questions."

PRICING TIER STRATEGY:
- Show all 3 tiers — Essential (basic), Complete (most popular, anchor), Premium (full-service)
- Always label the middle tier "Most Popular" — this increases uptake of the higher-margin option
- Present the premium tier last — it makes the middle tier feel like a deal

URGENCY RULES:
- Use REAL urgency — actual scheduling lead times (2-3 weeks out is common)
- Seasonal urgency is powerful: "before summer heat hits", "before first frost", etc.
- Safety urgency when applicable: "this is a safety issue — the longer you wait, the higher the risk"
- Never fabricate scarcity that isn't real

ESCALATION:
- If lead says "it's too expensive" → escalate_to_objection_handler with type "price"
- If lead says "I'm getting other quotes" → escalate with type "comparison"
- If lead says "I need to check with my wife/husband" → escalate with type "spouse"
- If no response after 5 days → escalate to human for personal call

OUTCOME TRACKING:
- Accepted → mark_estimate_won immediately, stop all follow-up
- Hard no or lost to competitor → mark_estimate_lost, trigger win-back if applicable
- Postponed → schedule a win-back reminder 90 days out`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(lead, estimate, touchType = 'estimate_sent') {
  /**
   * @param {object} lead
   * @param {string} lead.fullName
   * @param {string} lead.phone
   * @param {string} lead.email
   * @param {string} lead.industry
   * @param {string} lead.leadId
   *
   * @param {object} estimate
   * @param {string} estimate.estimateId
   * @param {number} estimate.totalAmount
   * @param {string} estimate.tier          - 'essential' | 'complete' | 'premium'
   * @param {object} [estimate.tiers]       - {essential, complete, premium} pricing
   * @param {string} [estimate.sentAt]
   *
   * @param {string} [touchType]            - Which follow-up touch to execute
   */

  const userMessage = `
Execute the "${touchType}" follow-up for this pending estimate.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Email: ${lead.email || 'n/a'}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId}

ESTIMATE:
- Estimate ID: ${estimate.estimateId || 'unknown'}
- Total Amount: $${estimate.totalAmount?.toLocaleString() || 'TBD'}
- Tier Quoted: ${estimate.tier || 'complete'}
- Sent At: ${estimate.sentAt || new Date().toISOString()}
${estimate.tiers ? `
- Essential Option: $${estimate.tiers.essential?.price || 'N/A'} — ${estimate.tiers.essential?.desc || ''}
- Complete Option: $${estimate.tiers.complete?.price || 'N/A'} — ${estimate.tiers.complete?.desc || ''} [MOST POPULAR]
- Premium Option: $${estimate.tiers.premium?.price || 'N/A'} — ${estimate.tiers.premium?.desc || ''}
` : ''}

Execute the appropriate follow-up message, schedule the next touch, and update the CRM.
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

// ---------------------------------------------------------------------------
// CLI test harness
// ---------------------------------------------------------------------------
if (process.argv[1].endsWith('estimate-to-revenue.js')) {
  const testLead = {
    fullName: 'Dana Prescott',
    phone:    '(214) 555-0319',
    email:    'dana@prescottelectric.com',
    industry: 'Electrical',
    leadId:   'lead_004',
  };

  const testEstimate = {
    estimateId:  'est_004',
    totalAmount: 2850,
    tier:        'complete',
    sentAt:      new Date().toISOString(),
    tiers: {
      essential: { price: 1800, desc: 'Panel inspection + breaker replacement' },
      complete:  { price: 2850, desc: 'Full panel upgrade + surge protection + permit' },
      premium:   { price: 4200, desc: 'Complete rewire + smart home integration + permit' },
    },
  };

  run(testLead, testEstimate, 'estimate_sent').then(result => {
    console.log('[EstimateToRevenue]', JSON.stringify(result, null, 2));
  });
}
