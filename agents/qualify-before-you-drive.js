/**
 * QualifyBeforeYouDrive Agent
 *
 * Benefit: Never waste a 45-minute drive to an estimate that was never going
 * to close. This agent runs a 5-question qualification script via SMS/voice
 * before a technician or estimator leaves the shop — ensuring every site
 * visit has real closing potential.
 *
 * Problem it solves: Home service businesses lose thousands of hours driving
 * to tire-kickers, out-of-area requests, and leads with no budget or
 * decision-making authority. A 5-question pre-screen filters these out
 * automatically and routes only qualified leads to the calendar.
 *
 * Trigger: Fires after NeverMissALead confirms contact. Or at lead intake
 *          for high-volume inbound sources (Google LSA, Angi, etc.).
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
  routeToCalendar: process.env.WEBHOOK_ROUTE_CALENDAR   || 'https://hook.us2.make.com/REPLACE_ROUTE_CALENDAR',
  flagUnqualified: process.env.WEBHOOK_FLAG_UNQUALIFIED || 'https://hook.us2.make.com/REPLACE_FLAG_UNQUALIFIED',
  notifyTeam:      process.env.WEBHOOK_NOTIFY_TEAM      || 'https://hook.us2.make.com/REPLACE_NOTIFY_TEAM',
};

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const tools = [
  {
    name: 'send_qualification_sms',
    description: 'Send the next qualification question via SMS. Ask one question at a time — never bundle multiple questions into one message.',
    input_schema: {
      type: 'object',
      properties: {
        to_phone:     { type: 'string', description: 'Lead phone number' },
        question_num: { type: 'number', description: 'Question number 1-5' },
        message:      { type: 'string', description: 'The qualification question as a friendly SMS' },
        lead_id:      { type: 'string', description: 'CRM lead ID' },
      },
      required: ['to_phone', 'question_num', 'message'],
    },
  },
  {
    name: 'score_lead',
    description: 'Calculate the lead qualification score based on answers to all 5 questions. Returns a score and a routing decision.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:           { type: 'string' },
        in_service_area:   { type: 'boolean', description: 'Q1: Is the address within the service area?' },
        service_matches:   { type: 'boolean', description: 'Q2: Does the requested service match what we offer?' },
        timeline:          { type: 'string', enum: ['asap', 'this_week', 'this_month', 'just_browsing'], description: 'Q3: When do they need the work done?' },
        decision_maker:    { type: 'boolean', description: 'Q4: Are they the one who approves the job?' },
        budget_aware:      { type: 'boolean', description: 'Q5: Do they understand this is a paid professional service (not looking for free)?' },
      },
      required: ['in_service_area', 'service_matches', 'timeline', 'decision_maker', 'budget_aware'],
    },
  },
  {
    name: 'route_to_calendar',
    description: 'Send a qualified lead to the booking calendar. Attach the qualification score and answers so the estimator knows what to expect.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:       { type: 'string' },
        score:         { type: 'number', description: 'Qualification score 0-100' },
        priority:      { type: 'string', enum: ['hot', 'warm', 'standard'], description: 'Routing priority' },
        notes:         { type: 'string', description: 'Summary of qualification answers for the estimator' },
        to_phone:      { type: 'string', description: 'Lead phone for booking confirmation SMS' },
        to_email:      { type: 'string', description: 'Lead email for booking confirmation' },
      },
      required: ['lead_id', 'score', 'priority', 'notes'],
    },
  },
  {
    name: 'flag_unqualified',
    description: 'Mark a lead as unqualified with a reason. Optionally send a polite decline message so the lead is not left hanging.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id:        { type: 'string' },
        disqualifier:   { type: 'string', enum: ['out_of_area', 'service_not_offered', 'not_decision_maker', 'budget_mismatch', 'no_urgency'] },
        send_message:   { type: 'boolean', description: 'Whether to send a polite decline/referral SMS to the lead' },
        decline_message:{ type: 'string', description: 'The decline or referral message if send_message is true' },
        to_phone:       { type: 'string' },
      },
      required: ['lead_id', 'disqualifier'],
    },
  },
  {
    name: 'update_crm',
    description: 'Log qualification results and score to the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        status:  { type: 'string', description: 'e.g. "qualified", "unqualified", "qualification_in_progress"' },
        score:   { type: 'number' },
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
    send_qualification_sms: WEBHOOKS.sendSms,
    score_lead:             WEBHOOKS.updateCrm,
    route_to_calendar:      WEBHOOKS.routeToCalendar,
    flag_unqualified:       WEBHOOKS.flagUnqualified,
    update_crm:             WEBHOOKS.updateCrm,
  };

  const url = urlMap[toolName];
  if (!url) return { error: `Unknown tool: ${toolName}` };

  // score_lead is a local calculation — return immediately
  if (toolName === 'score_lead') {
    const { in_service_area, service_matches, timeline, decision_maker, budget_aware } = toolInput;
    let score = 0;
    if (in_service_area)  score += 25;
    if (service_matches)  score += 20;
    if (decision_maker)   score += 20;
    if (budget_aware)     score += 15;
    const timelineScore = { asap: 20, this_week: 15, this_month: 10, just_browsing: 0 };
    score += timelineScore[timeline] ?? 0;

    const disqualifiers = [];
    if (!in_service_area)  disqualifiers.push('out_of_area');
    if (!service_matches)  disqualifiers.push('service_not_offered');
    if (!decision_maker)   disqualifiers.push('not_decision_maker');
    if (!budget_aware)     disqualifiers.push('budget_mismatch');
    if (timeline === 'just_browsing') disqualifiers.push('no_urgency');

    return {
      score,
      qualified: score >= 60 && disqualifiers.length === 0,
      priority: score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'standard',
      disqualifiers,
    };
  }

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
const SYSTEM_PROMPT = `You are the QualifyBeforeYouDrive agent for a local home service business powered by Loquitir.

YOUR MISSION: Filter out tire-kickers, out-of-area requests, and unwinnable jobs BEFORE a technician drives 45 minutes to a dead-end estimate. Only qualified leads make it to the calendar.

THE 5-QUESTION QUALIFICATION SCRIPT:
1. SERVICE AREA — "Just to make sure we can help — what city or zip code is the job at?" (Verify against service area)
2. SERVICE TYPE — "What's the main thing you need done?" (Confirm it matches services offered)
3. TIMELINE — "When are you looking to get this taken care of?" (ASAP / this week / this month / just getting info)
4. DECISION AUTHORITY — "Will you be the one making the call on who to go with, or is someone else involved?" (Are they the decision maker?)
5. BUDGET AWARENESS — "Have you had work like this done before, or is this your first time hiring a [industry] company?" (Budget-aware reality check)

QUALIFICATION SCORING:
- In service area: +25 pts
- Service matches: +20 pts
- Decision maker: +20 pts
- Budget aware: +15 pts
- Timeline ASAP: +20 pts | this_week: +15 pts | this_month: +10 pts | just_browsing: +0 pts

ROUTING RULES:
- Score 80-100 (hot): Route immediately, flag as priority
- Score 60-79 (warm): Route to calendar, standard follow-up
- Score <60 or any hard disqualifier: Flag unqualified, send polite decline if out-of-area or budget mismatch

HARD DISQUALIFIERS (instant decline):
- Outside service area → Refer to a local competitor politely
- Service not offered → Redirect ("we don't do X, but you need to call Y type of company")
- Not the decision maker → Ask to loop in the decision maker before scheduling

TONE: Conversational, warm, never interrogative. These are SMS messages — keep each one short and natural. Sound like a helpful team member texting, not a survey robot.`;

// ---------------------------------------------------------------------------
// Main run function
// ---------------------------------------------------------------------------
export async function run(lead, answers = null) {
  /**
   * @param {object} lead         - Lead details from CRM / landing page
   * @param {object|null} answers - Pre-collected answers if available (skip SMS loop)
   */

  const userMessage = answers
    ? `
Score and route this lead. Their qualification answers are already collected.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Email: ${lead.email || 'n/a'}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId || 'unknown'}

ANSWERS:
- In service area: ${answers.in_service_area}
- Service matches: ${answers.service_matches}
- Timeline: ${answers.timeline}
- Decision maker: ${answers.decision_maker}
- Budget aware: ${answers.budget_aware}

Score them, route or flag appropriately, and update the CRM.
`.trim()
    : `
Start the qualification sequence for this new lead. Send the first SMS question now.

LEAD:
- Name: ${lead.fullName}
- Phone: ${lead.phone}
- Industry: ${lead.industry}
- Lead ID: ${lead.leadId || 'unknown'}

Begin with question 1 (service area). Use the send_qualification_sms tool.
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
if (process.argv[1].endsWith('qualify-before-you-drive.js')) {
  const testLead = {
    fullName: 'Sarah Chen',
    phone:    '(737) 555-0188',
    email:    'sarah@homecorp.com',
    industry: 'HVAC',
    leadId:   'lead_002',
  };

  // Simulate pre-collected answers (hot lead)
  const testAnswers = {
    in_service_area: true,
    service_matches: true,
    timeline:        'asap',
    decision_maker:  true,
    budget_aware:    true,
  };

  run(testLead, testAnswers).then(result => {
    console.log('[QualifyBeforeYouDrive]', JSON.stringify(result, null, 2));
  });
}
