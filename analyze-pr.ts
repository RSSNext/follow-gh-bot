import type { ChatModel } from 'openai/resources/chat/chat.mjs'
import { openai } from './ai'
import { octokit } from './octokit'

const IGNORED_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
]
const MAX_DIFF_LENGTH = 100000
export async function analyzePR(
  owner: string,
  repoName: string,
  prNumber: number,
) {
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
    model: (process.env.MINI_MODEL_NAME || process.env.MODEL_NAME) as ChatModel,
    messages: [
      {
        role: 'system',
        content:
          'Generate a Conventional Commits format PR title and a concise summary of the given code changes. Focus on the main modifications and their impact.',
      },
      {
        role: 'user',
        content: `PR Summary:\n\n${summary}\n\nCode changes:\n${diffs}\n\nProvide a Conventional Commits format PR title in 60 characters or less and a brief summary of the main changes and their impact.`,
      },
    ],
    functions: [
      {
        name: 'generate_pr_title_and_summary',
        description:
          'Generate a PR title and summary based on the given changes',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description:
                'Conventional Commits format PR title in 60 characters or less',
            },
            summary: {
              type: 'string',
              description: 'Brief summary of the main changes and their impact',
            },
          },
          required: ['title', 'summary'],
        },
      },
    ],
    function_call: { name: 'generate_pr_title_and_summary' },
  })

  const titleAndSummary = JSON.parse(
    titleAndSummaryResponse.choices[0].message.function_call?.arguments || '{}',
  )

  if (!titleAndSummary.title || !titleAndSummary.summary) {
    console.error('Failed to generate PR title and summary')
    return
  }

  console.log('Suggested PR Title:', titleAndSummary.title)
  console.log('Change Summary:', titleAndSummary.summary)

  // 使用 OpenAI 生成代码审查意见
  const reviewResponse = await openai.chat.completions.create({
    model: process.env.MODEL_NAME as ChatModel,

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
    body: `**Suggested PR Title:**\n\n${
      '```\n' + titleAndSummary.title + '\n```'
    }\n\n**Change Summary:**\n${titleAndSummary.summary}\n\n**Code Review:**\n${
      reviewResponse.choices[0].message.content
    }`,
  })
}

export async function getFileDiff(
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
