const express = require('express');
const { Octokit } = require('@octokit/rest');
const Queue = require('bull');
const crypto = require('crypto');
const config = require('./config');

const app = express();
const github = new Octokit({ auth: config.GITHUB_TOKEN });
const eventQueue = new Queue('github-events', config.REDIS_URL);

app.use(express.json());

// Middleware: Verify GitHub signature
const verifyGithubSignature = (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return res.status(401).send('No signature');

  const hash = crypto
    .createHmac('sha256', config.GITHUB_WEBHOOK_SECRET || '')
    .update(JSON.stringify(req.body))
    .digest('hex');

  const expected = `sha256=${hash}`;

  if (signature !== expected) {
    return res.status(401).send('Invalid signature');
  }

  next();
};

// Apply signature verification if GITHUB_WEBHOOK_SECRET is set
if (config.GITHUB_WEBHOOK_SECRET) {
  app.use('/github', verifyGithubSignature);
}

// Webhook handler
app.post('/github', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`📥 Received GitHub event: ${event}`);

  try {
    // Route events to appropriate agents
    switch (event) {
      case 'pull_request':
        await eventQueue.add(
          { type: 'pr_opened', payload },
          { priority: 1, removeOnComplete: true }
        );
        break;

      case 'issues':
        if (payload.action === 'opened' && payload.issue.labels.some(l => l.name === 'agent-develop')) {
          await eventQueue.add(
            { type: 'issue_for_development', payload },
            { priority: 2, removeOnComplete: true }
          );
        }
        break;

      case 'push':
        await eventQueue.add(
          { type: 'push_to_main', payload },
          { priority: 1, removeOnComplete: true }
        );
        break;

      default:
        console.log(`⏭️ Event ${event} not handled`);
    }

    res.status(200).send('✅ Event queued');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.listen(config.PORT, () => {
  console.log(`🪝 Webhook receiver listening on port ${config.PORT}`);
  console.log(`📌 Add this URL to GitHub settings: http://your-server:${config.PORT}/github`);
});
