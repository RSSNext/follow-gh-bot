import { CronJob } from 'cron'
import { octokit } from '../octokit'
import { appConfig } from '../configs'
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest'

const tick = async function () {
  console.log('Checking in-active issues...')
  const allIssues: RestEndpointMethodTypes['issues']['listForRepo']['response']['data'] =
    []
  let page = 1
  while (true) {
    const { data: issues } = await octokit.issues.listForRepo({
      owner: appConfig.owner,
      repo: appConfig.repo,
      state: 'open',
      per_page: 100,
      page,
    })
    allIssues.push(...issues)
    if (issues.length < 100) break
    page++
  }

  console.log(`Found ${allIssues.length} open issues`)

  const now = new Date()
  for (const issue of allIssues) {
    // Skip pull requests (they are also considered issues in GitHub's API)
    if (issue.pull_request) continue

    const lastUpdateDate = new Date(issue.updated_at)
    const diffTime = now.getTime() - lastUpdateDate.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    // Check if issue has 'stale' label
    const hasStaleLabel = issue.labels.some(
      (label: any) => label.name === 'stale',
    )

    // Get latest comments
    const { data: comments } = await octokit.issues.listComments({
      owner: appConfig.owner,
      repo: appConfig.repo,
      issue_number: issue.number,
    })

    // Check if there's a recent "bump" comment
    const hasBumpComment = comments.some((comment) => {
      const commentDate = new Date(comment.created_at)
      const isRecent =
        (now.getTime() - commentDate.getTime()) / (1000 * 60 * 60 * 24) < 30
      return isRecent && comment.body?.toLowerCase().includes('bump')
    })

    if (hasBumpComment && hasStaleLabel) {
      // Remove stale label if there's a recent bump
      await octokit.issues.removeLabel({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        name: 'stale',
      })
    } else if (
      !hasStaleLabel &&
      diffDays >= appConfig.markStaleIssueAfterDays &&
      !hasBumpComment
    ) {
      // Add stale label and comment if inactive for 30 days
      await octokit.issues.addLabels({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        labels: ['stale'],
      })

      await octokit.issues.createComment({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        body: `This issue has been automatically marked as stale. If this issue is still affecting you, please leave any comment (for example, "bump"), and we'll keep it open. If you have any new additional information—in particular, if this is still reproducible in the latest version of Follow or in the beta—please include it with your comment!`,
      })

      console.log(`Marked issue #${issue.number} as stale`)
    }
  }
}

export const checkIssueJob = {
  start() {
    return new CronJob(
      '0 0 * * * *', // every day
      async () =>
        tick().catch((err) => {
          console.error('Error in checkIssueJob', err)
        }),
      null,
      true,
      'Asia/Shanghai',
    )
  },
  tick,
}
