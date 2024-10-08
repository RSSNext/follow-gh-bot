import express from 'express'
import { Webhooks } from '@octokit/webhooks'
import { handlePRComment } from './pr-bot'

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
