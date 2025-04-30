import 'dotenv/config'

import type { components } from '@octokit/openapi-webhooks-types'
import { analyzePR } from './analyze-pr'
import { octokit } from './octokit'
import { isTrustedUser } from './utils'

export async function handlePRComment(
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
      await analyzePR(owner, repo, prNumber).catch((error) => {
        console.error('Error analyzing PR:', error)
        return null
      })
      break
    }
  }
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

    const regex = /\*\*Suggested PR Title:\*\*\n\n```\n(.*)\n```/
    // 查找本应用发布的最新评论
    const botComment = comments.reverse().find((comment) => {
      return (
        comment.user?.type === 'Bot' &&
        comment.performed_via_github_app?.id === process.env.APP_ID &&
        // 从评论中提取建议的 PR 标题
        comment.body?.match(regex)
      )
    })

    if (!botComment) {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: 'No AI review suggestion found. Please run `/ai-review` first.',
      })
      return
    }
    const titleMatch = botComment.body?.match(regex)

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

export async function handleIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  commentId: number,
  commentBody: string,
  issue: components['schemas']['webhook-issue-comment-created']['issue'],
) {
  const hasBumpComment = commentBody.toLowerCase().includes('bump')

  if (
    hasBumpComment &&
    issue.state === 'open' &&
    issue.labels.some((label) => label.name === 'stale')
  ) {
    // Remove stale label if there's a recent bump
    await octokit.issues.removeLabel({
      owner,
      repo,
      issue_number: issueNumber,
      name: 'stale',
    })
  }
}
