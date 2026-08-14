require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // GitHub
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_REPO: process.env.GITHUB_REPO || 'roshankumar1113/utkala.ai',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,

  // Claude / LLM API
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || process.env.NVIDIA_API_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,

  // Redis / Upstash
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',


  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/utkala_agents',

  // Notifications
  SLACK_WEBHOOK: process.env.SLACK_WEBHOOK,
  DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,

  // Docker
  DOCKER_REGISTRY: process.env.DOCKER_REGISTRY || 'docker.io',
  DOCKER_USERNAME: process.env.DOCKER_USERNAME,
  DOCKER_PASSWORD: process.env.DOCKER_PASSWORD,

  // Agent Settings
  TEST_TIMEOUT: 30000,
  MAX_RETRIES: 3,
  AGENT_POOL_SIZE: 5,

  // Feature Flags
  FEATURES: {
    AUTO_MERGE_ON_TEST_PASS: true,
    AUTO_DEPLOY_ON_MERGE: true,
    AUTO_CREATE_ISSUES_ON_BUGS: true,
    ENABLE_FEATURE_AGENT: true,
  },
};
