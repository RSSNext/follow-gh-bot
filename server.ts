import express from 'express'
import { Webhooks } from '@octokit/webhooks'

import { handleIssueComment, handlePRComment } from './pr-bot'
import { conventionalCommit, isTrustedUser } from './utils'
import { octokit } from './octokit'
import { analyzePR } from './analyze-pr'
import { startCron } from './cron'

const app = express()
const port = process.env.PORT || 3000

const webhooks = new Webhooks({
  secret: 'summary',
})

app.use(express.json())

startCron()

app.post('/webhook', (req, res) => {
  webhooks
    .verifyAndReceive({
      id: req.headers['x-github-delivery'] as string,
      name: req.headers['x-github-event'] as any,
      payload: JSON.stringify(req.body),
      signature: req.headers['x-hub-signature-256'] as string,
    })
    .catch(console.error)

  res.status(200).send('OK')
})

webhooks.on('pull_request.opened', async ({ payload }) => {
  console.log('Received pull request:', payload)

  if (payload.sender.type === 'Bot') {
    return
  }

  const sender = payload.sender.login
  const isMember = await isTrustedUser(
    payload.repository.owner.login,
    payload.repository.name,
    sender,
  )

  analyzePR(
    payload.repository.owner.login,
    payload.repository.name,
    payload.pull_request.number,
  ).catch((error) => {
    console.error('Error analyzing PR:', error)
    return null
  })

  if (isMember) return

  if (!isMember) {
    await octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: 'Thank you for your contribution. We will review it promptly.',
    })
  }

  // Check pr title is Conventional Commits
  const prTitle = payload.pull_request.title
  const isConventionalCommit = conventionalCommit(prTitle)
  if (!isConventionalCommit) {
    await octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: `@${sender}, please use Conventional Commits format for your PR title.

Your PR title should follow this format:
\`<type>(<scope>): <description>\`

Common types include:
- feat: A new feature
- fix: A bug fix
- docs: Documentation changes
- style: Code style changes (formatting, missing semi colons, etc)
- refactor: Code refactoring
- test: Adding or updating tests
- chore: Changes to build process or auxiliary tools

Examples:
- feat(user): add user login function
- fix(api): correct HTTP response status code
- docs(readme): update installation guide

For more details, please visit: https://www.conventionalcommits.org/
`,
    })
  }
})

webhooks.on('issues.opened', async ({ payload }) => {
  console.log('Received issue opened:', payload)

  if (payload.sender.type === 'Bot') {
    return
  }

  if (payload.issue.performed_via_github_app?.owner?.login === 'linear') {
    // Linear issue, created by Linear app, ignore
    console.log(
      `Ignore issue created by Linear app, [#${payload.issue.number} - ${payload.issue.title}]`,
    )
    return
  }
  const comment = payload.issue.body

  if (
    await isTrustedUser(
      payload.repository.owner.login,
      payload.repository.name,
      payload.sender.login,
    )
  ) {
    return
  }

  const needIncludedTexts = ['- [x] This issue is valid', '### Environment']
  const isIncluded = needIncludedTexts.some((text) => comment?.includes(text))
  if (!isIncluded) {
    console.log('Invalid issue ' + payload.issue.number, ' closed. ')
    await octokit.issues.update({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      state: 'closed',
      state_reason: 'not_planned',
    })
    await octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      body: 'This issue is invalid. Please provide more information, or update the issue description and re-open the issue.',
    })
  }
})

webhooks.on('issue_comment.created', async ({ payload }) => {
  if (!payload.issue.pull_request) {
    return
  }
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const prNumber = payload.issue.number
  const commentBody = payload.comment.body
  const commentId = payload.comment.id

  console.log('Received comment:', commentBody)

  if (payload.sender.type === 'Bot') {
    return
  }

  const isPRComment = payload.issue.pull_request

  if (isPRComment) {
    await handlePRComment(owner, repo, prNumber, commentId, commentBody)
  } else {
    await handleIssueComment(
      owner,
      repo,
      prNumber,
      commentId,
      commentBody,
      payload.issue,
    )
  }
})

webhooks.on('pull_request.closed', async ({ payload }) => {
  // Check if the PR was merged (closed without merging won't trigger this)
  if (!payload.pull_request.merged) {
    return
  }

  if (payload.pull_request.user.type === 'Bot') {
    return
  }

  const sender = payload.pull_request.user.login
  const isMember = await isTrustedUser(
    payload.repository.owner.login,
    payload.repository.name,
    sender,
  )

  // Only send thank you message to external contributors
  if (!isMember) {
    await octokit.issues.createComment({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.pull_request.number,
      body: `Thank you for your contribution! 🎉 

Your pull request has been merged and we really appreciate your help in making this project better. We hope to see more contributions from you in the future! 💪`,
    })
  }
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
