import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

export const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID,
  },
})
