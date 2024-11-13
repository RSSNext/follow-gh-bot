import { CronJob } from 'cron'
import { octokit } from './octokit'
import { appConfig } from './configs'

export function startCron() {
  // Check in-active pull requests
  const job = new CronJob(
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
  return job
}
