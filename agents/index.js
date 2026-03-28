/**
 * Loquitir Agent Registry
 *
 * Central hub for all 6 benefit-driven agents. Each agent targets a specific
 * revenue gap in the home service business pipeline:
 *
 *  1. NeverMissALead         — Instant 5-minute first response to every new lead
 *  2. QualifyBeforeYouDrive  — 5-question filter before a technician leaves the shop
 *  3. BookedBeforeTheyGhost  — 7-touch, 14-day sequence to convert interest into bookings
 *  4. EstimateToRevenue      — 3-tier estimate follow-up that closes jobs
 *  5. ObjectionToBooking     — Handles all 5 primary objections with proven frameworks
 *  6. RecoverLostRevenue     — Win-back campaigns for 90-365 day dormant estimates
 *
 * Pipeline flow:
 *
 *   [Inbound Lead]
 *        ↓
 *   NeverMissALead (fires immediately)
 *        ↓
 *   QualifyBeforeYouDrive (5-question screen)
 *        ↓ qualified
 *   BookedBeforeTheyGhost (7-touch sequence)
 *        ↓ estimate sent
 *   EstimateToRevenue (estimate follow-up)
 *        ↓ objection detected
 *   ObjectionToBooking (handle objections)
 *        ↓ lost or no response
 *   RecoverLostRevenue (win-back at 90+ days)
 */

import { run as neverMissALead }        from './never-miss-a-lead.js';
import { run as qualifyBeforeYouDrive } from './qualify-before-you-drive.js';
import { run as bookedBeforeTheyGhost } from './booked-before-they-ghost.js';
import { run as estimateToRevenue }     from './estimate-to-revenue.js';
import { run as objectionToBooking }    from './objection-to-booking.js';
import { run as recoverLostRevenue }    from './recover-lost-revenue.js';

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------
export const agents = {
  neverMissALead: {
    name:        'NeverMissALead',
    benefit:     'Every lead gets a professional response within 5 minutes — 24/7.',
    trigger:     'New lead submitted (landing page, Google LSA, inbound call)',
    run:         neverMissALead,
  },
  qualifyBeforeYouDrive: {
    name:        'QualifyBeforeYouDrive',
    benefit:     'Never waste a drive on a lead that was never going to close.',
    trigger:     'After first contact confirmed; or at lead intake for high-volume sources',
    run:         qualifyBeforeYouDrive,
  },
  bookedBeforeTheyGhost: {
    name:        'BookedBeforeTheyGhost',
    benefit:     'Converts qualified leads into booked jobs before they go dark.',
    trigger:     'Lead qualified but not yet booked; or gone quiet after initial contact',
    run:         bookedBeforeTheyGhost,
  },
  estimateToRevenue: {
    name:        'EstimateToRevenue',
    benefit:     'Turns sent estimates into signed jobs with persistent, smart follow-up.',
    trigger:     'Estimate marked "sent" in CRM',
    run:         estimateToRevenue,
  },
  objectionToBooking: {
    name:        'ObjectionToBooking',
    benefit:     'Converts every objection into forward momentum — no freezing, no discounting.',
    trigger:     'Objection signal detected in lead replies (called by other agents)',
    run:         objectionToBooking,
  },
  recoverLostRevenue: {
    name:        'RecoverLostRevenue',
    benefit:     'Mines dormant estimates for $15K-$50K in recovered revenue per 100 leads.',
    trigger:     'Weekly batch (90-365 day dormant estimates) or manual campaign',
    run:         recoverLostRevenue,
  },
};

// ---------------------------------------------------------------------------
// Pipeline runner
// — Executes the full pipeline for a brand new inbound lead
// ---------------------------------------------------------------------------
export async function runNewLeadPipeline(lead) {
  const results = {};

  // Step 1: Immediate response
  console.log(`[Pipeline] Starting NeverMissALead for ${lead.fullName}`);
  results.neverMissALead = await agents.neverMissALead.run(lead);

  // Step 2: Qualification (with pre-collected answers if available)
  console.log(`[Pipeline] Running QualifyBeforeYouDrive for ${lead.fullName}`);
  results.qualify = await agents.qualifyBeforeYouDrive.run(lead, lead.qualificationAnswers ?? null);

  // Step 3: Start follow-up sequence if qualified
  if (lead.isQualified !== false) {
    console.log(`[Pipeline] Starting BookedBeforeTheyGhost Touch 1 for ${lead.fullName}`);
    results.followup = await agents.bookedBeforeTheyGhost.run(lead, 1);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Webhook router
// — Receives incoming events and routes to the right agent
// ---------------------------------------------------------------------------
export function routeEvent(event) {
  switch (event.type) {
    case 'lead.created':
      return agents.neverMissALead.run(event.lead);

    case 'lead.qualified':
      return agents.bookedBeforeTheyGhost.run(event.lead, 1);

    case 'lead.followup_touch':
      return agents.bookedBeforeTheyGhost.run(event.lead, event.touchNumber);

    case 'estimate.sent':
      return agents.estimateToRevenue.run(event.lead, event.estimate, 'estimate_sent');

    case 'estimate.followup':
      return agents.estimateToRevenue.run(event.lead, event.estimate, event.touchType);

    case 'objection.detected':
      return agents.objectionToBooking.run(event.lead, event.objection);

    case 'winback.touch':
      return agents.recoverLostRevenue.run({ lead: event.lead, touchNumber: event.touchNumber });

    case 'winback.batch':
      return agents.recoverLostRevenue.run({ batchMode: true, filters: event.filters });

    default:
      return Promise.resolve({ error: `Unknown event type: ${event.type}` });
  }
}

// ---------------------------------------------------------------------------
// CLI info
// ---------------------------------------------------------------------------
if (process.argv[1].endsWith('index.js')) {
  console.log('\nLoquitir Agent Registry\n');
  console.log('Available agents:\n');

  for (const [key, agent] of Object.entries(agents)) {
    console.log(`  ${agent.name}`);
    console.log(`    Benefit: ${agent.benefit}`);
    console.log(`    Trigger: ${agent.trigger}`);
    console.log();
  }

  console.log('Pipeline Events Supported:');
  const events = [
    'lead.created', 'lead.qualified', 'lead.followup_touch',
    'estimate.sent', 'estimate.followup', 'objection.detected',
    'winback.touch', 'winback.batch',
  ];
  events.forEach(e => console.log(`  - ${e}`));
  console.log();
}
