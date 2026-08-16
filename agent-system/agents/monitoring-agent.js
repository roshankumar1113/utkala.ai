require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const config = require('../config');

const github = new Octokit({ auth: config.GITHUB_TOKEN });

// ── configuration ─────────────────────────────────────────────────────────────
// Falls back to localhost so the agent works outside Docker too
const APP_HEALTH_URL =
  process.env.APP_HEALTH_URL || 'http://localhost:5000/health';

const CHECK_INTERVAL_MS  = 5 * 60 * 1000;  // poll every 5 min
const FAILURE_THRESHOLD  = 3;               // open issue only after 3 consecutive failures
const REQUEST_TIMEOUT_MS = 10_000;

let consecutiveFailures = 0;
let incidentOpenToday = false;             // rate-limit: one issue per day max
let lastIncidentDate  = '';

// ── notifications ─────────────────────────────────────────────────────────────
const notify = async (title, message, isError = false) => {
  const color = isError ? 15158332 : 3066993;

  if (config.DISCORD_WEBHOOK && config.DISCORD_WEBHOOK.startsWith('https://')) {
    try {
      await axios.post(config.DISCORD_WEBHOOK, {
        embeds: [{ title: `📊 Utkal.ai: ${title}`, description: message, color,
                   timestamp: new Date().toISOString() }]
      });
    } catch (e) { console.error('Discord webhook failed:', e.message); }
  }

  if (config.SLACK_WEBHOOK && config.SLACK_WEBHOOK.startsWith('https://')) {
    try {
      await axios.post(config.SLACK_WEBHOOK, {
        text: `📊 *Utkal.ai: ${title}*\n${message}`
      });
    } catch (e) { console.error('Slack webhook failed:', e.message); }
  }
};

// ── GitHub incident issue ─────────────────────────────────────────────────────
const createIncidentIssue = async (errorDetails) => {
  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) {
    console.warn('⚠️  GITHUB_TOKEN or GITHUB_REPO not configured — skipping issue creation.');
    return;
  }

  // Rate-limit: one incident issue per calendar day
  const today = new Date().toISOString().split('T')[0];
  if (incidentOpenToday && lastIncidentDate === today) {
    console.log('ℹ️  Incident already reported today — skipping duplicate issue.');
    return;
  }

  const [owner, repo] = config.GITHUB_REPO.split('/');
  const title = `🚨 [INCIDENT] Application Health Check Failed - ${today}`;
  const body = `
## 🚨 Automatic Incident Report

**Service:** Utkal.ai Application
**Check Target:** \`${APP_HEALTH_URL}\`
**Timestamp:** ${new Date().toISOString()}
**Consecutive Failures:** ${consecutiveFailures}

### Error Summary
\`\`\`
${errorDetails}
\`\`\`

### Troubleshooting Steps
- Verify the Node.js server is running: \`node index.js\`
- Check the port is not blocked: \`netstat -an | findstr 5000\`
- Confirm \`APP_HEALTH_URL\` in \`agent-system/.env\` points to the correct host

---
*Auto-reported by Monitoring & Alerting Agent*
`;

  try {
    const issue = await github.issues.create({
      owner, repo, title, body,
      labels: ['incident', 'auto-detected', 'bug', 'high-priority']
    });
    console.log(`🚨 Incident issue created: ${issue.data.html_url}`);
    incidentOpenToday = true;
    lastIncidentDate  = today;
  } catch (err) {
    console.error('Failed to create GitHub incident issue:', err.message);
  }
};

// ── health check ──────────────────────────────────────────────────────────────
const performHealthCheck = async () => {
  const t0 = Date.now();
  console.log(`📊 [Monitor] Checking ${APP_HEALTH_URL} ...`);

  try {
    const { status, data } = await axios.get(APP_HEALTH_URL, {
      timeout: REQUEST_TIMEOUT_MS
    });

    if (status === 200 && (data?.status === 'ok' || data?.status === 'healthy')) {
      const ms = Date.now() - t0;
      console.log(`✅ Health check PASSED (${ms}ms) — ${JSON.stringify(data)}`);
      consecutiveFailures = 0;           // reset on success
    } else {
      throw new Error(`Unexpected response: HTTP ${status} — ${JSON.stringify(data)}`);
    }
  } catch (error) {
    consecutiveFailures++;
    const msg = error.response
      ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.message;

    console.error(`❌ Health check FAILED (${consecutiveFailures}/${FAILURE_THRESHOLD}): ${msg}`);

    // Only open an incident after FAILURE_THRESHOLD consecutive failures
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      await createIncidentIssue(msg);
      await notify('Health Check Failure',
        `App unreachable at \`${APP_HEALTH_URL}\`\nError: \`${msg}\`\nConsecutive failures: ${consecutiveFailures}`,
        true);
    }
  }
};

// ── start ─────────────────────────────────────────────────────────────────────
console.log('📊 MONITORING AGENT started');
console.log(`   Health URL  : ${APP_HEALTH_URL}`);
console.log(`   Poll interval : ${CHECK_INTERVAL_MS / 1000}s`);
console.log(`   Failure threshold : ${FAILURE_THRESHOLD} before opening issue`);

performHealthCheck();
setInterval(performHealthCheck, CHECK_INTERVAL_MS);
