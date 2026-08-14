const Queue = require('bull');
const { spawn } = require('child_process');
const { Octokit } = require('@octokit/rest');
const config = require('../config');

const eventQueue = new Queue('github-events', config.REDIS_URL);
const github = new Octokit({ auth: config.GITHUB_TOKEN });

const runTests = async () => {
  return new Promise((resolve, reject) => {
    const jest = spawn('npm', ['test'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    });

    let output = '';

    jest.stdout.on('data', (data) => {
      output += data.toString();
    });

    jest.stderr.on('data', (data) => {
      output += data.toString();
    });

    jest.on('close', (code) => {
      resolve({
        passed: code === 0,
        output,
        code,
      });
    });

    jest.on('error', reject);
  });
};

const postTestResultsToPR = async (prNumber, results) => {
  const statusEmoji = results.passed ? '✅' : '❌';
  const body = `
${statusEmoji} **Test Results**
\`\`\`
${results.output.slice(-500)} // Last 500 chars
\`\`\`
Exit Code: ${results.code}
`;

  const [owner, repo] = config.GITHUB_REPO.split('/');

  await github.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });

  // Set PR status
  if (results.sha) {
    await github.repos.createCommitStatus({
      owner,
      repo,
      sha: results.sha,
      state: results.passed ? 'success' : 'failure',
      description: results.passed ? 'All tests passed' : 'Tests failed',
      context: 'test-agent',
    });
  }
};

// Process test events
eventQueue.process('pr_opened', async (job) => {
  console.log('🧪 TEST AGENT: Processing PR:', job.data.payload.number);
  try {
    const results = await runTests();
    results.sha = job.data.payload.pull_request.head.sha;
    await postTestResultsToPR(job.data.payload.pull_request.number, results);
    console.log('✅ Tests completed:', results.passed ? 'PASSED' : 'FAILED');
    return results;
  } catch (error) {
    console.error('❌ Test agent error:', error);
    throw error;
  }
});

console.log('🧪 TEST AGENT started');
