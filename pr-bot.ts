import { openai } from './ai'
import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'
import 'dotenv/config'
import { config } from './config'

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID,
  },
})

const IGNORED_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
]
const MAX_DIFF_LENGTH = 100000

async function getFileDiff(
  owner: string,
  repo: string,
  prNumber: number,
  filename: string,
): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: { format: 'diff' },
  })
  const diffLines = (data as any as string).split('\n')
  const fileDiff = diffLines.filter(
    (line) => line.startsWith('diff --git') && line.includes(filename),
  )[0]
  const startIndex = diffLines.indexOf(fileDiff)
  const endIndex =
    diffLines
      .slice(startIndex + 1)
      .findIndex((line) => line.startsWith('diff --git')) +
    startIndex +
    1
  return diffLines
    .slice(startIndex, endIndex === startIndex ? undefined : endIndex)
    .join('\n')
}

async function handlePRComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  commentBody: string,
) {
  const trimmedCommentBody = commentBody.trim()

  if (!trimmedCommentBody.startsWith('/ai-review')) {
    return
  }
  const commands = trimmedCommentBody.split(' ').slice(1)
  const comment = await octokit.issues.getComment({
    owner,
    repo,
    comment_id: commentId,
  })
  const username = comment.data.user!.login
  const isTrusted = await isTrustedUser(owner, repo, username)

  if (!isTrusted) {
    console.log(`User ${username} is not authorized to trigger AI review.`)
    return
  }

  switch (commands[0]) {
    case 'apply': {
      await applyAIReviewSuggestion(owner, repo, prNumber)
      break
    }

    default: {
      await analyzePR(owner, repo, prNumber)
      break
    }
  }
}

async function analyzePR(owner: string, repoName: string, prNumber: number) {
  // 获取 PR 的文件修改
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo: repoName,
    pull_number: prNumber,
  })

  // 过滤掉不需要的文件，并获取实际代码修改
  const relevantFiles = files.filter(
    (file) => !IGNORED_FILES.includes(file.filename),
  )
  let diffs = ''
  for (const file of relevantFiles) {
    const diff = await getFileDiff(owner, repoName, prNumber, file.filename)
    diffs += diff + '\n\n'
    if (diffs.length > MAX_DIFF_LENGTH) {
      diffs = diffs.substring(0, MAX_DIFF_LENGTH) + '\n...(truncated)'
      break
    }
  }

  // 生成 PR 摘要
  const summary = relevantFiles
    .map(
      (file) =>
        `${file.filename} (${file.status}): ${file.additions} additions, ${file.deletions} deletions`,
    )
    .join('\n')

  // 使用 OpenAI 生成 PR 标题和修改摘要
  const titleAndSummaryResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'Generate a Conventional Commits format PR title and a concise summary of the given code changes. Focus on the main modifications and their impact.',
      },
      {
        role: 'user',
        content: `PR Summary:\n\n${summary}\n\nCode changes:\n${diffs}\n\nProvide a Conventional Commits format PR title and a brief summary of the main changes and their impact. Return the result as a JSON object with "title" and "summary" fields.`,
      },
    ],
    response_format: { type: 'json_object' },
  })

  const titleAndSummary = JSON.parse(
    titleAndSummaryResponse.choices[0].message.content || '{}',
  )

  if (!titleAndSummary.title || !titleAndSummary.summary) {
    console.error('Failed to generate PR title and summary')
    return
  }

  console.log('Suggested PR Title:', titleAndSummary.title)
  console.log('Change Summary:', titleAndSummary.summary)

  // 使用 OpenAI 生成代码审查意见
  const reviewResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful code reviewer. Provide a code review based on the given code changes, focusing only on issues that require a change request.',
      },
      {
        role: 'user',
        content: `PR Summary:\n\n${summary}\n\nCode changes:\n${diffs}\n\nProvide a code review focusing only on issues that require a change request. Use a markdown list for the review, citing file paths and line numbers. If there are no issues requiring a change request, respond with "No change requests necessary."`,
      },
    ],
  })

  console.log('\nCode Review (Change Requests Only):')
  console.log(reviewResponse.choices[0].message.content)

  // Post the review as a comment
  await octokit.issues.createComment({
    owner,
    repo: repoName,
    issue_number: prNumber,
    body: `Suggested PR Title: \n\n${titleAndSummary.title}\n\nChange Summary:\n${titleAndSummary.summary}\n\nCode Review:\n${reviewResponse.choices[0].message.content}`,
  })
}

async function applyAIReviewSuggestion(
  owner: string,
  repo: string,
  prNumber: number,
) {
  try {
    // 获取 PR 的所有评论
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
    })

    // 查找本应用发布的最新评论
    const botComment = comments
      .reverse()
      .find(
        (comment) =>
          comment.user?.type === 'Bot' && comment.user?.login === config.name,
      )

    if (!botComment) {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: 'No AI review suggestion found. Please run `/ai-review` first.',
      })
      return
    }

    // 从评论中提取建议的 PR 标题
    const titleMatch = botComment.body?.match(/Suggested PR Title:\s*\n\n(.+)/)
    if (!titleMatch) {
      throw new Error('Could not find suggested PR title in the comment.')
    }
    const suggestedTitle = titleMatch[1].trim()

    // 更新 PR 标题
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      title: suggestedTitle,
    })

    // 发布成功消息
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: `Successfully applied the suggested PR title: "${suggestedTitle}"`,
    })
  } catch (error) {
    console.error('Error applying AI review suggestion:', error)
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: 'Failed to apply AI review suggestion. Please try again or contact support.',
    })
  }
}

async function isTrustedUser(
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

// Export the handlePRComment function to be used by your webhook handler
export { handlePRComment }
