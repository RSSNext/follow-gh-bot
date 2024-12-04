import { checkIssueJob } from './jobs/check-in-active-issue'
import { checkPRJob } from './jobs/check-pr'
import { checkStaleIssueJob } from './jobs/check-stale-issue'

export function startCron() {
  // Check in-active pull requests

  checkPRJob.start()
  checkPRJob.tick()

  // Check in-active issues
  checkIssueJob.start()
  checkIssueJob.tick()

  // Close stale issues
  checkStaleIssueJob.start()
  checkStaleIssueJob.tick()
}
