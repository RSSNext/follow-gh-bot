import { conventionalCommit } from './utils'
import { expect, it, describe } from 'vitest'
describe('conventionalCommit', () => {
  it('should return true for valid conventional commits', () => {
    expect(conventionalCommit('feat: add new feature')).toBe(true)
    expect(conventionalCommit('fix: resolve bug')).toBe(true)
    expect(conventionalCommit('docs: update readme')).toBe(true)
  })

  it('should return true for commits with scope', () => {
    expect(conventionalCommit('feat(ui): add button')).toBe(true)
    expect(conventionalCommit('fix(core): fix crash')).toBe(true)
  })

  it('should return false for invalid commits', () => {
    expect(conventionalCommit('invalid commit')).toBe(false)
    expect(conventionalCommit('feature: wrong prefix')).toBe(false)
    expect(conventionalCommit('feat')).toBe(false)
    expect(conventionalCommit('')).toBe(false)
  })
})
