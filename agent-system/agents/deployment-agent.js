const Queue = require('bull');
const { Octokit } = require('@octokit/rest');
const { spawn } = require('child_process');
const axios = require('axios');
const config = require('../config');

const eventQueue = new Queue('github-events', config.REDIS_URL);
const github = new Octokit({ auth: config.GITHUB_TOKEN });

const buildDockerImage = async (commitSha) => {
  return new Promise((resolve, reject) => {
    const tag = `${config.DOCKER_REGISTRY}/utkala:${commitSha.slice(0, 7)}`;
    const docker = spawn('docker', ['build', '-t', tag, '.']);

    docker.on('close', (code) => {
      if (code === 0) resolve(tag);
      else reject('Docker build failed');
    });
  });
};

const deployToProduction = async (imageName) => {
  return new Promise((resolve, reject) => {
    const compose = spawn('docker-compose', ['up', '-d', '--force-recreate'], {
      env: { ...process.env, IMAGE_NAME: imageName },
    });

    compose.on('close', (code) => {
      if (code === 0) resolve({ deployed: true, image: imageName });
      else reject('Deploy failed');
    });
  });
};

const healthCheck = async (maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get('http://localhost:5000/health', { timeout: 5000 });
      if (response.status === 200) return true;
    } catch (e) {
      console.log(`Health check attempt ${i + 1}/${maxRetries} failed`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('Health check failed');
};

const notifySlack = async (status, details) => {
  if (!config.SLACK_WEBHOOK) return;
  await axios.post(config.SLACK_WEBHOOK, {
    text: `🚀 Deployment ${status}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Deployment ${status}*\n${JSON.stringify(details, null, 2)}`,
        },
      },
    ],
  });
};

// Process PR merge events
eventQueue.process('pr_merged', async (job) => {
  console.log('📦 DEPLOYMENT AGENT: Starting deployment...');
  try {
    const sha = job.data.payload.pull_request.merge_commit_sha;

    // Build Docker image
    console.log('🔨 Building Docker image...');
    const imageName = await buildDockerImage(sha);

    // Deploy to production
    console.log('🚀 Deploying to production...');
    await deployToProduction(imageName);

    // Health check
    console.log('🏥 Running health checks...');
    await healthCheck();

    // Notify
    await notifySlack('SUCCESS', {
      image: imageName,
      commit: sha.slice(0, 7),
      timestamp: new Date(),
    });

    console.log('✅ Deployment successful');
    return { deployed: true, image: imageName };
  } catch (error) {
    console.error('❌ Deployment error:', error);
    await notifySlack('FAILED', { error: error.message });
    throw error;
  }
});

console.log('📦 DEPLOYMENT AGENT started');
