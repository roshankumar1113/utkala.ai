const Queue = require('bull');
const { Octokit } = require('@octokit/rest');
const Anthropic = require('@anthropic-ai/sdk').default;
const { spawn } = require('child_process');
const fs = require('fs');
const config = require('../config');

const eventQueue = new Queue('github-events', config.REDIS_URL);
const github = new Octokit({ auth: config.GITHUB_TOKEN });
const claude = new Anthropic({ apiKey: config.CLAUDE_API_KEY });

const generateFeatureCode = async (issueTitle, description, acceptanceCriteria) => {
  const prompt = `
You are an expert Node.js developer. Create feature code for this issue:
Title: ${issueTitle}
Description: ${description}
Acceptance Criteria: ${acceptanceCriteria}

Generate:
1. Production code (JavaScript)
2. Unit tests (Jest format)
3. Commit message

Format response strictly as JSON with keys: { "code": "...", "tests": "...", "commitMessage": "..." }
`;

  const response = await claude.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  return JSON.parse(response.content[0].text);
};

const createBranchAndPush = async (branchName, code, commitMessage) => {
  return new Promise((resolve, reject) => {
    const git = spawn('git', ['checkout', '-b', branchName], {
      stdio: 'pipe',
    });

    git.on('close', async (exitCode) => {
      if (exitCode !== 0) return reject('Failed to create branch');

      // Write code file
      fs.writeFileSync('services/generated-feature.js', code);

      // Commit
      const commit = spawn('git', ['add', '.']);
      commit.on('close', () => {
        const push = spawn('git', ['commit', '-m', commitMessage]);
        push.on('close', () => {
          resolve({ branch: branchName, success: true });
        });
      });
    });
  });
};

// Process feature development events
eventQueue.process('issue_for_development', async (job) => {
  console.log('🔨 FEATURE DEVELOPER: Processing issue:', job.data.payload.issue.number);
  try {
    const issue = job.data.payload.issue;
    const branchName = `feature/issue-${issue.number}`;

    // Generate code
    const generated = await generateFeatureCode(
      issue.title,
      issue.body,
      'See issue description'
    );

    // Create branch and push
    await createBranchAndPush(branchName, generated.code, generated.commitMessage);

    const [owner, repo] = config.GITHUB_REPO.split('/');

    // Create PR
    const pr = await github.pulls.create({
      owner,
      repo,
      title: `🤖 Auto-generated: ${issue.title}`,
      body: `Resolves #${issue.number}\n\n**AI-Generated Code**\n\`\`\`javascript\n${generated.code.slice(0, 300)}...\n\`\`\``,
      head: branchName,
      base: 'main',
    });

    console.log('✅ Feature PR created:', pr.data.html_url);
    return { pr_url: pr.data.html_url };
  } catch (error) {
    console.error('❌ Feature developer error:', error);
    throw error;
  }
});

console.log('🔨 FEATURE DEVELOPER AGENT started');
