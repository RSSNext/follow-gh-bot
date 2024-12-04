import { checkIssueJob } from './jobs/check-in-active-issue'
import { checkPRJob } from './jobs/check-pr'
import { checkStaleIssueJob } from './jobs/check-stale-issue'
const noop = () => {}

export function startCron() {
  // Check in-active pull requests
  checkPRJob.start()
  checkPRJob.tick().catch(noop)

  // Check in-active issues
  checkIssueJob.start()
  checkIssueJob.tick().catch(noop)

  // Close stale issues
  checkStaleIssueJob.start()
  checkStaleIssueJob.tick().catch(noop)
}
