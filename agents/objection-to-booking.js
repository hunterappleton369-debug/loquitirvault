/**
 * ObjectionToBooking Agent
 *
 * Benefit: Converts "I need to think about it" into a booked job. Handles
 * all five primary home service objections with proven diagnostic responses
 * that reframe value, neutralize competition, and accelerate decisions —
 * without being pushy or desperate.
 *
 * Problem it solves: Most businesses freeze or discount when they hear an
 * objection. Both are costly. Discounting trains customers to haggle.
 * Freezing loses the job. This agent responds instantly with the right
 * framing for each objection type — turning friction into momentum.
 *
 * The 5 Objections Handled:
 * 1. "I need to think about it" — Diagnostic response (uncover the real concern)
 * 2. "It's too expensive" — Value articulation (ROI, risk, expertise)
 * 3. "I'm getting other quotes" — Advisor positioning (help them compare fairly)
 * 4. "Can you do it for less?" — Scarcity linking (tie discount to what's removed)
 * 5. "I need to check with my spouse" — Joint decision scheduling
 *
 * Trigger: Called by EstimateToRevenue or BookedBeforeTheyGhost when an
 *          objection signal is detected in lead replies.
 */

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
const WEBHOOKS = {
  sendSms:         process.env.WEBHOOK_SEND_SMS         || 'https://hook.us2.make.com/REPLACE_SEND_SMS',
  sendEmail:       process.env.WEBHOOK_SEND_EMAIL       || 'https://hook.us2.make.com/REPLACE_SEND_EMAIL',
  updateCrm:       process.env.WEBHOOK_UPDATE_CRM       || 'https://hook.us2.make.com/REPLACE_UPDATE_CRM',
  notifyTeam:      process.env.WEBHOOK_NOTIFY_TEAM      || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
  bookAppointment: process.env.WEBHOOK_BOOK_APPOINTMENT || 'https://hook.us2.make.com/REPLACE_BOOK_APPOINTMENT',
  scheduleFollowup:process.env.WEBHOOK_SCHEDULE_FOLLOWUP|| 'https://hook.us2.make.com/REPLACE_SCHEDULE_FOLLOWUP',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'respond_to_objection',
    description: 'Send the appropriate objection response based on the detected objection type. Each objection has a proven framework.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:         { type: 'string' },
        channel:         { type: 'string', enum: ['sms', 'email'] },
        to_contact:      { type: 'string', description: 'Phone or email' },
        objection_type:  {
          type: 'string',
          enum: ['need_to_think', 'too_expensive', 'getting_quotes', 'wants_discount', 'spouse_approval'],
          description: 'The objection category to handle'
        },
        message:         { type: 'string', description: 'The tailored objection response message' },
        subject:         { type: 'string', description: 'Email subject if channel is email' },
        estimate_amount: { type: 'number' },
      },
      required: ['lead_id', 'channel', 'to_contact', 'objection_type', 'message'],
    },
  },
  {
    name: 'send_value_comparison',
    description: 'For "too expensive" or "getting quotes" objections — send a clear value comparison that shows what they get vs. what a cheaper option risks.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:          { type: 'string' },
        to_email:         { type: 'string' },
        to_phone:         { type: 'string' },
        our_price:        { type: 'number' },
        value_points:     { type: 'array', items: { type: 'string' }, description: 'What they get: license, insurance, warranty, etc.' },
        risk_of_cheaper:  { type: 'array', items: { type: 'string' }, description: 'What unlicensed/cheap work risks' },
        message:          { type: 'string' },
      },
      required: ['lead_id', 'our_price', 'message'],
    },
  },
  {
    name: 'schedule_joint_decision_call',
    description: 'For spouse/partner approval objections — send a message proposing a brief call or meeting that includes both decision makers.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:         { type: 'string' },
        to_phone:        { type: 'string' },
        to_email:        { type: 'string' },
        available_slots: { type: 'array', items: { type: 'string' }, description: 'Available time slots to offer, e.g. ["Tue 2pm", "Wed 10am"]' },
        message:         { type: 'string' },
      },
      required: ['lead_id', 'to_phone', 'message'],
    },
  },
  {
    name: 'offer_tier_adjustment',
    description: 'For discount requests — instead of discounting, offer to step down to the Essential tier. Preserve margin, give them an option.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:           { type: 'string' },
        channel:           { type: 'string', enum: ['sms', 'email'] },
        to_contact:        { type: 'string' },
        current_tier:      { type: 'string' },
        current_price:     { type: 'number' },
        lower_tier:        { type: 'string' },
        lower_tier_price:  { type: 'number' },
        what_gets_removed: { type: 'string', description: 'What is NOT included in the lower tier' },
        message:           { type: 'string' },
      },
      required: ['lead_id', 'channel', 'to_contact', 'current_price', 'lower_tier_price', 'message'],
    },
  },
  {
    name: 'escalate_to_human_close',
    description: 'When the objection requires a personal conversation, notify a human team member with full context to make a closing call.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:        { type: 'string' },
        lead_name:      { type: 'string' },
        lead_phone:     { type: 'string' },
        objection_type: { type: 'string' },
        objection_text: { type: 'string', description: 'What the lead actually said' },
        recommended_response: { type: 'string', description: 'Suggested talking points for the human' },
        estimate_amount:{ type: 'number' },
      },
      required: ['lead_id', 'lead_name', 'lead_phone', 'objection_type'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log objection type, response sent, and outcome to CRM.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:        { type: 'string' },
        status:         { type: 'string' },
        objection_type: { type: 'string' },
        note:           { type: 'string' },
      },
      required: ['lead_id', 'status'],
    },
  },
];

// ---------------------------------------------------------------------------
// Objection response playbooks
// ---------------------------------------------------------------------------
export const OBJECTION_PLAYBOOKS = {
  need_to_think: {
    framework: 'Diagnostic — uncover the real concern',
    approach: 'Acknowledge, then ask one clarifying question. "Of course! Just curious — is there a specific part of the estimate you want to think through? Happy to walk you through anything."',
    goal: 'Surface the hidden objection (usually price or trust) so you can address it directly.',
  },
  too_expensive: {
    framework: 'Value articulation — shift from cost to ROI/risk',
    approach: 'Never defend the price. Expand on what the price includes: licensing, insurance, warranty, cleanup, permit. Then highlight the risk of cheaper work.',
    goal: 'Reframe the price as the cost of certainty vs. the risk of saving money today and paying double later.',
  },
  getting_quotes: {
    framework: 'Advisor positioning — help them compare fairly',
    approach: '"Absolutely, that makes sense. When you compare quotes, make sure each one includes [checklist: licensed, insured, permit-pulled, warranty]. A lot of bids leave those out." Position as a helpful guide, not a competitor.',
    goal: 'Become the trusted advisor who helps them evaluate all options — which makes the business look more credible, not less.',
  },
  wants_discount: {
    framework: 'Scarcity linking — tie discount to what\'s removed',
    approach: 'Never discount without removing something. "We can work with a tighter budget — what would need to come out of scope for us to hit that number?" Or offer the Essential tier as-is.',
    goal: 'Preserve margin, give them agency, avoid training customers to haggle.',
  },
  spouse_approval: {
    framework: 'Joint decision scheduling — get both people in the conversation',
    approach: '"No problem at all! Would it be easier to hop on a quick 10-minute call together? I can answer both your questions at once and make it easy." Offer 2-3 specific slots.',
    goal: 'Eliminate the "I\'ll ask later" delay by scheduling a joint conversation now.',
  },
};

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(toolName, toolInput) {
  const urlMap = {
    respond_to_objection:    toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    send_value_comparison:   WEBHOOKS.sendEmail,
    schedule_joint_decision_call: WEBHOOKS.sendSms,
    offer_tier_adjustment:   toolInput.channel === 'sms' ? WEBHOOKS.sendSms : WEBHOOKS.sendEmail,
    escalate_to_human_close: WEBHOOKS.notifyTeam,
    update_crm:              WEBHOOKS.updateCrm,
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
const SYSTEM_PROMPT = `You are the ObjectionToBooking agent for a local home service business powered by Loquitir.

YOUR MISSION: When a qualified lead raises an objection, you respond instantly with the right framework — no freezing, no panicking, no discounting. Every objection has a proven response that turns friction into forward motion.

THE 5 OBJECTION FRAMEWORKS:

1. "NEED TO THINK ABOUT IT"
   → This almost always means a hidden concern. Acknowledge and ask one diagnostic question.
   → "Of course, take your time! Just curious — is there a specific part you'd like me to explain further?"
   → Goal: Surface the real objection.

2. "IT'S TOO EXPENSIVE"
   → Never defend the number. Expand what it includes.
   → "Totally understand. Our price includes [license, insurance, permit, warranty, cleanup]. A lot of bids don't include those — which usually means a second call and a bigger bill later."
   → If still price-sensitive: offer the Essential tier, not a discount.

3. "I'M GETTING OTHER QUOTES"
   → Don't compete — become their advisor.
   → "Smart move! When you're comparing, just make sure each quote includes: licensed & insured, permit pulled if required, cleanup included, and a written warranty. A lot of bids quietly skip those."
   → Send the comparison checklist via email.

4. "CAN YOU DO IT FOR LESS?"
   → Tie any price reduction to scope reduction. Never just drop the number.
   → "We can absolutely work with a tighter budget — what we'd need to remove to hit [their number] is [X]. Does that still work for you?"
   → Or: "Our Essential package is $[price] and covers [scope]. Would that work?"

5. "I NEED TO CHECK WITH MY SPOUSE / PARTNER"
   → Don't wait. Offer a joint call.
   → "No problem at all! Would it be easier to jump on a quick 10-minute call with both of you? I can walk you through it together and answer all the questions at once. I have [slot A] or [slot B] available — which works better?"

RULES:
- Match response channel to how the lead reached out (SMS if they texted, email if they emailed).
- Keep SMS responses under 160 characters when possible — longer objection responses go email.
- Never be defensive or aggressive. Confident, helpful, and warm at all times.
- If objection continues after 2 attempts, escalate to a human for a personal close call.
- Always log the objection type and response to CRM.`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(lead, objectionContext) {
  /**
   * @param {object} lead
   * @param {string} lead.fullName
   * @param {string} lead.phone
   * @param {string} lead.email
   * @param {string} lead.industry
   * @param {string} lead.leadId
   *
   * @param {object} objectionContext
   * @param {string} objectionContext.type        - 'need_to_think' | 'too_expensive' | 'getting_quotes' | 'wants_discount' | 'spouse_approval'
   * @param {string} objectionContext.leadMessage - What the lead actually said
   * @param {number} [objectionContext.estimateAmount]
   * @param {object} [objectionContext.tiers]
   * @param {number} [objectionContext.attemptNumber=1]
   */

  const playbook = OBJECTION_PLAYBOOKS[objectionContext.type];

  const userMessage = `
Handle this objection for a pending estimate. Respond immediately using the correct framework.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Email: ${lead.email || 'n/a'}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId}

OBJECTION:
- Type: ${objectionContext.type}
- What they said: "${objectionContext.leadMessage}"
- Estimate amount: $${objectionContext.estimateAmount?.toLocaleString() || 'unknown'}
- Attempt number: ${objectionContext.attemptNumber || 1}

PLAYBOOK FOR THIS OBJECTION:
- Framework: ${playbook?.framework}
- Approach: ${playbook?.approach}
- Goal: ${playbook?.goal}

${objectionContext.tiers ? `AVAILABLE TIERS:
- Essential: $${objectionContext.tiers.essential?.price}
- Complete: $${objectionContext.tiers.complete?.price} (Most Popular)
- Premium: $${objectionContext.tiers.premium?.price}` : ''}

Select the right response tool, craft a personalized message for this lead and industry, send it, and update the CRM. If this is attempt 2+ with no resolution, escalate to a human.
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
if (process.argv[1].endsWith('objection-to-booking.js')) {
  const testLead = {
    fullName: 'Robert Kimani',
    phone:    '(512) 555-0441',
    email:    'robert@kimani-hvac.com',
    industry: 'HVAC',
    leadId:   'lead_005',
  };

  const testObjection = {
    type:           'too_expensive',
    leadMessage:    "That's more than I expected. The other quote I got was $800 cheaper.",
    estimateAmount: 3400,
    attemptNumber:  1,
    tiers: {
      essential: { price: 2200 },
      complete:  { price: 3400 },
      premium:   { price: 4800 },
    },
  };

  run(testLead, testObjection).then(result => {
    console.log('[ObjectionToBooking]', JSON.stringify(result, null, 2));
  });
}
