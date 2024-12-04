import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'
import { graphql } from '@octokit/graphql'

export const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID,
  },
})

export const graphqlWithAuth = graphql.defaults({
  request: {
    hook: createAppAuth({
      appId: process.env.APP_ID ?? '',
      privateKey: process.env.PRIVATE_KEY ?? '',
      installationId: process.env.INSTALLATION_ID ?? '',
    }),
  },
})
