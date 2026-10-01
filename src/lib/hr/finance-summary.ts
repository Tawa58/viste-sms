import { REVENUE_SOURCE_LABEL, SALARIES_CATEGORY } from '@/lib/hr/constants'
import { round2 } from '@/lib/hr/payroll-engine'
import type { Expense, FinanceMonthPoint, FinanceSummary, Revenue } from '@/types'

export type FeePaymentLite = { amount: number; paidAt: string; status: string }

function monthShort(month: string) {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, m! - 1, 1)).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  })
}

/** Year view of the books: fee payments + revenue register against expenses (incl. payroll). */
export function buildFinanceSummary(input: {
  year: number
  feePayments: FeePaymentLite[]
  revenues: Revenue[]
  expenses: Expense[]
  outstandingFees: number
}): FinanceSummary {
  const prefix = String(input.year)
  const months: FinanceMonthPoint[] = Array.from({ length: 12 }, (_, i) => {
    const month = `${prefix}-${String(i + 1).padStart(2, '0')}`
    return {
      month,
      label: monthShort(month),
      feePayments: 0,
      otherRevenue: 0,
      revenue: 0,
      expenses: 0,
      salaries: 0,
      net: 0,
    }
  })
  const at = (date: string) =>
    date.startsWith(prefix) ? months[Number(date.slice(5, 7)) - 1] : undefined

  let feePayments = 0
  for (const p of input.feePayments) {
    if (p.status !== 'CONFIRMED') continue
    const point = at(p.paidAt.slice(0, 10))
    if (!point) continue
    point.feePayments += p.amount
    feePayments += p.amount
  }

  const bySource = new Map<string, number>([[REVENUE_SOURCE_LABEL.SCHOOL_FEES, feePayments]])
  let otherRevenue = 0
  for (const r of input.revenues) {
    const point = at(r.date)
    if (!point) continue
    point.otherRevenue += r.amount
    otherRevenue += r.amount
    const label = REVENUE_SOURCE_LABEL[r.source] ?? r.source
    bySource.set(label, (bySource.get(label) ?? 0) + r.amount)
  }

  const byCategory = new Map<string, number>()
  let expenses = 0
  let salaries = 0
  for (const e of input.expenses) {
    const point = at(e.date)
    if (!point) continue
    point.expenses += e.totalAmount
    expenses += e.totalAmount
    if (e.category === SALARIES_CATEGORY) {
      point.salaries += e.totalAmount
      salaries += e.totalAmount
    }
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.totalAmount)
  }

  for (const p of months) {
    p.feePayments = round2(p.feePayments)
    p.otherRevenue = round2(p.otherRevenue)
    p.revenue = round2(p.feePayments + p.otherRevenue)
    p.expenses = round2(p.expenses)
    p.salaries = round2(p.salaries)
    p.net = round2(p.revenue - p.expenses)
  }

  const revenue = round2(feePayments + otherRevenue)
  const sorted = (m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, amount]) => amount > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, amount]) => [key, round2(amount)] as const)

  return {
    year: input.year,
    totals: {
      revenue,
      feePayments: round2(feePayments),
      otherRevenue: round2(otherRevenue),
      expenses: round2(expenses),
      salaries: round2(salaries),
      netBalance: round2(revenue - expenses),
      outstandingFees: round2(input.outstandingFees),
    },
    months,
    revenueBySource: sorted(bySource).map(([source, amount]) => ({ source, amount })),
    expensesByCategory: sorted(byCategory).map(([category, amount]) => ({ category, amount })),
  }
}
