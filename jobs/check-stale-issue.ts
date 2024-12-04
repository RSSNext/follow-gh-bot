import { CronJob } from 'cron'
import { appConfig } from '../configs'
import { octokit } from '../octokit'

const tick = async function () {
  console.log('Checking stale issues for closing...')
  const { data: issues } = await octokit.issues.listForRepo({
    owner: appConfig.owner,
    repo: appConfig.repo,
    state: 'open',
    labels: 'stale',
  })

  const now = new Date()
  for (const issue of issues) {
    if (issue.pull_request) continue

    const lastUpdateDate = new Date(issue.updated_at)
    const diffTime = now.getTime() - lastUpdateDate.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays >= appConfig.closeStaleIssueAfterDays) {
      // Close the issue
      await octokit.issues.update({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        state: 'closed',
        state_reason: 'completed',
      })

      // Add closing comment
      await octokit.issues.createComment({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        body: `This issue has been automatically closed due to inactivity. If this is still an issue, please feel free to reopen it or create a new one.`,
      })
      console.log(`Closed stale issue #${issue.number}`)
    }
  }
}
export const checkStaleIssueJob = {
  start() {
    return new CronJob(
      '0 0 * * * *', // every day
      async () =>
        tick().catch((err) => {
          console.error('Error in checkStaleIssueJob', err)
        }),
      null,
      true,
      'Asia/Shanghai',
    )
  },
  tick,
}
