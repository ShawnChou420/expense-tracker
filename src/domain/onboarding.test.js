import { describe, expect, it } from 'vitest'
import { getOnboardingSteps } from './onboarding.js'

describe('getOnboardingSteps', () => {
  it('shows every step as pending for a brand-new guest', () => {
    const result = getOnboardingSteps({})
    expect(result.steps.map((step) => step.id)).toEqual(['setup', 'schedule', 'expense', 'goal'])
    expect(result.doneCount).toBe(0)
    expect(result.allDone).toBe(false)
  })

  it('adds the salary deposit step for members only', () => {
    const result = getOnboardingSteps({ isMember: true })
    expect(result.steps.map((step) => step.id)).toEqual(['setup', 'schedule', 'salary', 'expense', 'goal'])
  })

  it('does not count leave days as a scheduled shift', () => {
    const result = getOnboardingSteps({
      workRecords: [{ shiftType: 'leave', paidMinutes: 0 }],
    })
    expect(result.steps.find((step) => step.id === 'schedule')?.done).toBe(false)
  })

  it('marks steps done from existing data and reports when everything is done', () => {
    const result = getOnboardingSteps({
      isMember: true,
      workSetupReady: true,
      workRecords: [{ shiftType: 'normal', paidMinutes: 420 }],
      salaryDeposits: [{ id: 'a' }],
      expenses: [{ id: 'b' }],
      savingGoal: { name: '二簽存款' },
    })
    expect(result.doneCount).toBe(5)
    expect(result.allDone).toBe(true)
  })

  it('asks for pay rates and shifts before auto scheduling', () => {
    const step = getOnboardingSteps({}).steps[0]
    expect(step.description).toBe('先設定薪資費率與班別，再使用自動排班。')
    expect(getOnboardingSteps({ workSetupReady: true }).steps[0].done).toBe(true)
  })
})
