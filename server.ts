import express from 'express'
import { Webhooks } from '@octokit/webhooks'
import { handlePRComment } from './pr-bot'
import { conventionalCommit, isTrustedUser } from './utils'
import { octokit } from './octokit'

const app = express()
const port = process.env.PORT || 3000

const webhooks = new Webhooks({
  secret: 'summary',
})

app.use(express.json())

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
  const sender = payload.sender.login
  const isMember = await isTrustedUser(
    payload.repository.owner.login,
    payload.repository.name,
    sender,
  )

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

  await handlePRComment(owner, repo, prNumber, commentId, commentBody)
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
