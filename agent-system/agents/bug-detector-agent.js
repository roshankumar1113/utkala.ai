const Queue = require('bull');
const { Octokit } = require('@octokit/rest');
const { spawn } = require('child_process');
const config = require('../config');

const eventQueue = new Queue('github-events', config.REDIS_URL);
const github = new Octokit({ auth: config.GITHUB_TOKEN });

const runLinter = async () => {
  return new Promise((resolve) => {
    const eslint = spawn('npx', ['eslint', '.', '--format', 'json'], {
      stdio: 'pipe',
    });

    let output = '';

    eslint.stdout.on('data', (data) => {
      output += data.toString();
    });

    eslint.on('close', () => {
      try {
        resolve(JSON.parse(output || '[]'));
      } catch {
        resolve([]);
      }
    });
  });
};

const runSecurityAudit = async () => {
  return new Promise((resolve) => {
    const audit = spawn('npm', ['audit', '--json'], {
      stdio: 'pipe',
    });

    let output = '';

    audit.stdout.on('data', (data) => {
      output += data.toString();
    });

    audit.on('close', () => {
      try {
        resolve(JSON.parse(output));
      } catch {
        resolve({});
      }
    });
  });
};

const createBugIssue = async (bug) => {
  const [owner, repo] = config.GITHUB_REPO.split('/');

  const body = `
**Bug Type:** ${bug.type}
**Severity:** ${bug.severity}
**File:** ${bug.file}
**Line:** ${bug.line || 'N/A'}
\`\`\`
${bug.code || ''}
\`\`\`
**Description:** ${bug.message}

---
*Auto-reported by Bug Detector Agent*
`;

  const issue = await github.issues.create({
    owner,
    repo,
    title: `🐛 ${bug.type} in ${bug.file}`,
    body,
    labels: ['bug', 'auto-detected', bug.severity],
  });

  return issue;
};

// Process push events
eventQueue.process('push_to_main', async (job) => {
  console.log('🐛 BUG DETECTOR: Scanning code...');
  try {
    const lintResults = await runLinter();
    const auditResults = await runSecurityAudit();
    const bugs = [];

    // Process lint results
    lintResults.forEach((file) => {
      if (file.messages) {
        file.messages.forEach((msg) => {
          if (msg.severity === 2) { // error level
            bugs.push({
              type: 'Lint Error',
              severity: 'critical',
              file: file.filePath,
              line: msg.line,
              message: msg.message,
              code: msg.ruleId,
            });
          }
        });
      }
    });

    // Process audit results
    if (auditResults.vulnerabilities) {
      Object.entries(auditResults.vulnerabilities).forEach(([pkg, vuln]) => {
        bugs.push({
          type: 'Security Vulnerability',
          severity: 'high',
          file: 'package.json',
          message: `${pkg}: ${vuln.via}`,
          code: vuln.cve || 'SECURITY_AUDIT',
        });
      });
    }

    // Create issues for critical bugs
    for (const bug of bugs) {
      if (bug.severity === 'critical' || bug.severity === 'high') {
        await createBugIssue(bug);
      }
    }

    console.log(`✅ Bug scan complete: ${bugs.length} issues found`);
    return { bugs_found: bugs.length };
  } catch (error) {
    console.error('❌ Bug detector error:', error);
    throw error;
  }
});

console.log('🐛 BUG DETECTOR AGENT started');
