# Loquitir Tree Service — Voice AI Agent

An inbound voice AI agent powered by RetellAI that answers phone calls for a tree service company. It collects customer information, checks calendar availability via Cal.com, and books consultation appointments.

## What It Does

When a customer calls, the agent:
1. Greets them professionally as "Sarah," the receptionist
2. Listens to their tree service needs
3. Collects their **name**, **phone number**, **service address**, and **problem description**
4. Checks your Cal.com calendar for available consultation slots
5. Books the appointment
6. Confirms all details back to the caller

## Prerequisites

- [RetellAI](https://www.retellai.com/) account with API key
- [Cal.com](https://cal.com/) account with API key and an event type for consultations
- Node.js 18+

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

| Variable | Where to Get It |
|----------|----------------|
| `RETELL_API_KEY` | [RetellAI Dashboard → API Keys](https://dashboard.retellai.com/apiKey) |
| `CALCOM_API_KEY` | [Cal.com → Settings → Developer → API Keys](https://app.cal.com/settings/developer/api-keys) |
| `CALCOM_EVENT_TYPE_ID` | Cal.com → Event Types → click your event → the ID is in the URL |
| `CALCOM_USERNAME` | Your Cal.com username (from your profile URL) |

### 3. Create the Agent

```bash
npm run setup-agent
```

This creates:
- A RetellAI LLM with the tree service prompt and Cal.com functions
- A RetellAI agent with voice, language, and behavior settings
- Saves agent info to `agent/.agent-info.json`

### 4. Assign a Phone Number

You can assign a phone number in two ways:

**Option A: RetellAI Dashboard**
1. Go to [Phone Numbers](https://dashboard.retellai.com/phone-numbers)
2. Purchase or select a number
3. Set the Inbound Agent to your new agent

**Option B: The setup script prints a command** you can copy/paste to assign via API.

### 5. Test the Agent

```bash
npm run test-agent
```

This creates a web call URL. Open it in your browser to talk to the agent and verify it works.

After the call, check the transcript:
```bash
node agent/test.js --transcript <call_id>
```

## Customization

### Change the Business Name or Type
Edit `agent/prompt.md` — update the greeting, business references, and service types.

### Change the Voice
Edit `agent/config.json` — update `voice_id`. Browse voices in the [RetellAI Dashboard](https://dashboard.retellai.com/voices).

### Change the Timezone
Edit `agent/config.json` → `cal_com.timezone`. Use IANA format (e.g., `America/Chicago`).

### Adjust Agent Behavior
Edit `agent/config.json`:
- `responsiveness` (0-1): How quickly the agent responds. Lower = more patient.
- `interruption_sensitivity` (0-1): How easily the caller can interrupt. Higher = more sensitive.
- `backchannel_frequency` (0-1): How often the agent says "mhm", "got it", etc.

## RetellAI MCP Server

The `.mcp.json` file configures the RetellAI MCP server for Claude Code. This lets you manage agents, phone numbers, and calls directly from Claude Code.

To use it, make sure `RETELL_API_KEY` is set in your environment, then Claude Code will automatically connect to the MCP server.

## File Structure

```
agent/
├── README.md          ← You are here
├── prompt.md          ← The agent's system prompt
├── config.json        ← Voice, language, and behavior settings
├── setup.js           ← Creates the agent via RetellAI API
├── test.js            ← Creates test calls and fetches transcripts
└── .agent-info.json   ← Generated: agent ID and metadata
```

## Testing Checklist

- [ ] Agent greets caller professionally
- [ ] Collects caller's full name
- [ ] Asks for / confirms phone number
- [ ] Asks for the service address (street, city, state)
- [ ] Understands the tree service problem
- [ ] Checks calendar availability
- [ ] Offers 2-3 time slots
- [ ] Books the selected appointment
- [ ] Reads back ALL details for confirmation
- [ ] Ends the call gracefully
- [ ] Handles "no availability" by taking info for callback
- [ ] Handles caller saying "never mind" gracefully
