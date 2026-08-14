const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const config = require('../config');

const github = new Octokit({ auth: config.GITHUB_TOKEN });

const APP_HEALTH_URL = process.env.APP_HEALTH_URL || 'http://localhost:5000/health';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const notifyWebhook = async (title, message, isError = false) => {
  const color = isError ? 15158332 : 3066993; // Red or Green

  if (config.DISCORD_WEBHOOK) {
    try {
      await axios.post(config.DISCORD_WEBHOOK, {
        embeds: [{
          title: `📊 Utkal.ai Monitor: ${title}`,
          description: message,
          color: color,
          timestamp: new Date().toISOString()
        }]
      });
    } catch (e) {
      console.error('Discord webhook alert failed:', e.message);
    }
  }

  if (config.SLACK_WEBHOOK) {
    try {
      await axios.post(config.SLACK_WEBHOOK, {
        text: `📊 *Utkal.ai Monitor: ${title}*\n${message}`
      });
    } catch (e) {
      console.error('Slack webhook alert failed:', e.message);
    }
  }
};

const createIncidentIssue = async (errorDetails) => {
  if (!config.GITHUB_TOKEN || !config.GITHUB_REPO) return;

  const [owner, repo] = config.GITHUB_REPO.split('/');
  const title = `🚨 [INCIDENT] Application Health Check Failed - ${new Date().toISOString().split('T')[0]}`;
  const body = `
## 🚨 Automatic Incident Report

**Service:** Utkal.ai Application
**Check Target:** \`${APP_HEALTH_URL}\`
**Timestamp:** ${new Date().toISOString()}

### Error Summary
\`\`\`
${errorDetails}
\`\`\`

---
*Auto-reported by Monitoring & Alerting Agent*
`;

  try {
    const issue = await github.issues.create({
      owner,
      repo,
      title,
      body,
      labels: ['incident', 'auto-detected', 'bug', 'high-priority']
    });
    console.log(`🚨 Incident issue created: ${issue.data.html_url}`);
  } catch (err) {
    console.error('Failed to create GitHub incident issue:', err.message);
  }
};

const performHealthCheck = async () => {
  console.log(`📊 MONITORING AGENT: Checking application health at ${APP_HEALTH_URL}...`);
  const startTime = Date.now();

  try {
    const response = await axios.get(APP_HEALTH_URL, { timeout: 10000 });
    const responseTime = Date.now() - startTime;

    if (response.status === 200 && response.data?.status === 'ok') {
      console.log(`✅ Health check PASSED (${responseTime}ms)`);
    } else {
      throw new Error(`Unexpected status ${response.status} or body: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    const errorMsg = error.response ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}` : error.message;
    console.error(`❌ Health check FAILED: ${errorMsg}`);

    await createIncidentIssue(errorMsg);
    await notifyWebhook('Health Check Failure', `App health check failed at \`${APP_HEALTH_URL}\`.\nError: \`${errorMsg}\``, true);
  }
};

// Start periodic monitoring loop
console.log(`📊 MONITORING AGENT started (Polling interval: 5m)`);
performHealthCheck();
setInterval(performHealthCheck, CHECK_INTERVAL_MS);
