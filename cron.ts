import { CronJob } from 'cron'
import { octokit } from './octokit'
import { appConfig } from './configs'

export function startCron() {
  // Check in-active pull requests
  const job1 = new CronJob(
    '0 0 * * * *', // every day
    async function () {
      console.log('Checking in-active pull requests...')
      const { data: pullRequests } = await octokit.pulls.list({
        owner: appConfig.owner,
        repo: appConfig.repo,
      })
      for (const pullRequest of pullRequests) {
        if (pullRequest.state === 'open' && pullRequest.draft === false) {
          // Check if PR needs changes and sender hasn't responded
          const { data: reviews } = await octokit.pulls.listReviews({
            owner: appConfig.owner,
            repo: appConfig.repo,
            pull_number: pullRequest.number,
          })

          // Get the latest review that requested changes
          const lastChangesRequested = reviews
            .reverse()
            .find((review) => review.state === 'CHANGES_REQUESTED')

          if (lastChangesRequested && lastChangesRequested.submitted_at) {
            const lastReviewDate = new Date(lastChangesRequested.submitted_at)
            const now = new Date()

            // Check if there are any updates after the last change request
            const prUpdateDate = new Date(pullRequest.updated_at)
            const hasUpdatesAfterReview = prUpdateDate > lastReviewDate

            // Get comments after the last review
            const { data: comments } = await octokit.issues.listComments({
              owner: appConfig.owner,
              repo: appConfig.repo,
              issue_number: pullRequest.number,
            })

            const hasCommentsAfterReview = comments.some(
              (comment) =>
                new Date(comment.created_at) > lastReviewDate &&
                comment.user?.login === pullRequest.user?.login,
            )

            // Only proceed if there are no updates and no comments from the PR author
            if (!hasUpdatesAfterReview && !hasCommentsAfterReview) {
              const diffTime = now.getTime() - lastReviewDate.getTime()
              const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

              if (diffDays > appConfig.closeInactivePRAfterDays) {
                console.log(`Closing inactive PR #${pullRequest.number}`)
                // Close the PR
                await octokit.pulls.update({
                  owner: appConfig.owner,
                  repo: appConfig.repo,
                  pull_number: pullRequest.number,
                  state: 'closed',
                })

                // Add a comment explaining why it was closed
                await octokit.issues.createComment({
                  owner: appConfig.owner,
                  repo: appConfig.repo,
                  issue_number: pullRequest.number,
                  body: `This pull request has been automatically closed because it has been inactive for ${diffDays} days after changes were requested. Please feel free to reopen it once you've addressed the requested changes.`,
                })
              }
            }
          }
        }
      }
    },
    null, // onComplete
    true, // start
    'Asia/Shanghai', // timeZone
  )

  // Check in-active issues
  const job2 = new CronJob(
    '0 0 * * * *', // every day
    async function () {
      console.log('Checking in-active issues...')
      const { data: issues } = await octokit.issues.list({
        owner: appConfig.owner,
        repo: appConfig.repo,
        state: 'open',
      })

      const now = new Date()
      for (const issue of issues) {
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
        }
      }
    },
    null,
    true,
    'Asia/Shanghai',
  )

  // Close stale issues
  const job3 = new CronJob(
    '0 0 * * * *', // every day
    async function () {
      console.log('Checking stale issues for closing...')
      const { data: issues } = await octokit.issues.list({
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
        }
      }
    },
    null,
    true,
    'Asia/Shanghai',
  )

  job1.start()
  job2.start()
  job3.start()
  return [job1, job2, job3]
}
