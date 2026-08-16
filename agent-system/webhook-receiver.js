require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const { Octokit } = require('@octokit/rest');
const crypto  = require('crypto');
const config  = require('./config');

const app    = express();
const github = new Octokit({ auth: config.GITHUB_TOKEN });

// ── Queue setup with graceful Redis fallback ───────────────────────────────────
let eventQueue = null;

function setupQueue() {
  const redisUrl = config.REDIS_URL || '';

  // Don't try to connect to Docker-internal hostnames from localhost
  const isDockerHost = redisUrl.includes('redis:6379') ||
                       redisUrl.includes('@db:') ||
                       redisUrl.includes('@redis:');

  if (!redisUrl || isDockerHost) {
    console.warn('⚠️  Redis URL is a Docker hostname — queue disabled. Events will be processed inline.');
    return null;
  }

  try {
    const Queue = require('bull');
    const q = new Queue('github-events', redisUrl);
    q.on('error', (err) => {
      console.error('Queue error (Redis may be unavailable):', err.message);
    });
    console.log(`✅ Bull queue connected: ${redisUrl}`);
    return q;
  } catch (err) {
    console.warn('⚠️  Bull queue setup failed:', err.message);
    return null;
  }
}

eventQueue = setupQueue();

// ── in-memory fallback queue when Redis is unavailable ──────────────────────────
const inMemoryQueue = [];
async function enqueue(job) {
  if (eventQueue) {
    return eventQueue.add(job, { priority: job.priority || 1, removeOnComplete: true });
  }
  // Fallback: just log + store in memory
  inMemoryQueue.push({ ...job, enqueuedAt: new Date().toISOString() });
  console.log(`📋 [InMemQueue] Stored event: ${job.type} (queue size: ${inMemoryQueue.length})`);
}

app.use(express.json());

// ── GitHub signature verification ─────────────────────────────────────────────
const verifyGithubSignature = (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return res.status(401).send('No signature');

  const hash = crypto
    .createHmac('sha256', config.GITHUB_WEBHOOK_SECRET || '')
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== `sha256=${hash}`) {
    return res.status(401).send('Invalid signature');
  }
  next();
};

if (config.GITHUB_WEBHOOK_SECRET) {
  app.use('/github', verifyGithubSignature);
}

// ── Webhook handler ────────────────────────────────────────────────────────────
app.post('/github', async (req, res) => {
  const event   = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`📥 GitHub event: ${event} | action: ${payload.action || 'N/A'}`);

  try {
    switch (event) {
      case 'pull_request':
        await enqueue({ type: 'pr_opened', payload, priority: 1 });
        break;

      case 'issues':
        if (payload.action === 'opened' &&
            payload.issue?.labels?.some(l => l.name === 'agent-develop')) {
          await enqueue({ type: 'issue_for_development', payload, priority: 2 });
        }
        break;

      case 'push':
        await enqueue({ type: 'push_to_main', payload, priority: 1 });
        break;

      default:
        console.log(`⏭️ Event "${event}" not handled`);
    }

    res.status(200).json({ status: 'ok', event, queued: !!eventQueue });
  } catch (error) {
    console.error('❌ Webhook handler error:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    queue:     eventQueue ? 'redis' : 'in-memory',
    queueSize: inMemoryQueue.length,
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
const PORT = config.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🪝 Webhook receiver running on port ${PORT}`);
  console.log(`   Queue backend : ${eventQueue ? 'Redis' : 'In-memory (Redis unavailable)'}`);
  console.log(`   Add to GitHub : Settings → Webhooks → http://your-server:${PORT}/github`);
});
