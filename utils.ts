import { octokit } from './octokit'

export async function isTrustedUser(
  owner: string,
  repo: string,
  username: string,
): Promise<boolean> {
  try {
    const { data: collaboratorPermission } =
      await octokit.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username,
      })

    const trustedPermissions = ['write', 'maintain', 'admin']
    return trustedPermissions.includes(collaboratorPermission.permission)
  } catch (error) {
    console.error(`Error checking user permission: ${error}`)
    return false // 如果出现错误，默认不信任该用户
  }
}

const allowPrefix = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'style',
  'test',
  'revert',
  'release',
  'chore',
]
export function conventionalCommit(title: string): boolean {
  const prefix = title.split(':')[0]

  if (!title.includes(':')) {
    return false
  }

  const typeWithoutScope = prefix.split('(')[0].trim()

  return allowPrefix.includes(typeWithoutScope)
}
