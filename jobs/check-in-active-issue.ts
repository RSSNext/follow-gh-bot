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
    const whitelistLabels = ['enhancement', 'Improvement', 'bug']
    if (
      issue.labels.some((label: any) =>
        whitelistLabels.includes(
          typeof label === 'string' ? label : label.name,
        ),
      )
    ) {
      continue
    }

    // Skip pull requests (they are also considered issues in GitHub's API)
    if (issue.pull_request) continue

    const lastUpdateDate = new Date(issue.updated_at)
    const diffTime = now.getTime() - lastUpdateDate.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    // Check if issue has 'stale' label
    const hasStaleLabel = issue.labels.some(
      (label: any) => label.name === 'stale',
    )

    if (!hasStaleLabel && diffDays >= appConfig.markStaleIssueAfterDays) {
      // Add stale label and comment if inactive for 30 days
      await octokit.issues.addLabels({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        labels: ['stale'],
      })

      // Get latest comments
      const { data: comments } = await octokit.issues.listComments({
        owner: appConfig.owner,
        repo: appConfig.repo,
        issue_number: issue.number,
        // TODO: 获取所有评论
        per_page: 100,
      })

      const commentBody = `This issue has been automatically marked as stale. If this issue is still affecting you, please leave any comment (for example, "bump"), and we'll keep it open. If you have any new additional information—in particular, if this is still reproducible in the latest version of Follow or in the beta—please include it with your comment!`

      const isCommentBefore = comments.at(-1)?.body === commentBody

      if (!isCommentBefore) {
        await octokit.issues.createComment({
          owner: appConfig.owner,
          repo: appConfig.repo,
          issue_number: issue.number,
          body: commentBody,
        })
      }

      console.log(
        `Marked issue #${issue.number} as stale, [${issue.title}](${issue.html_url})`,
      )
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
