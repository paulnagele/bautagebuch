// Annuity loan maths for the Kreditrechner in Finanzen: equal monthly
// payments, interest charged monthly at a twelfth of the yearly rate.

// Monthly payment that repays `principal` in `months` at `yearlyRate` (%).
export function monthlyPayment(principal, yearlyRate, months) {
  if (!(principal > 0) || !(months > 0)) return 0
  const r = yearlyRate / 100 / 12
  if (r === 0) return principal / months
  return (principal * r) / (1 - (1 + r) ** -months)
}

// Months needed to repay `principal` with `payment` a month; Infinity when
// the payment does not even cover the first month's interest.
export function monthsToRepay(principal, yearlyRate, payment) {
  if (!(principal > 0)) return 0
  if (!(payment > 0)) return Infinity
  const r = yearlyRate / 100 / 12
  if (r === 0) return Math.ceil(principal / payment)
  if (payment <= principal * r) return Infinity
  return Math.ceil(-Math.log(1 - (principal * r) / payment) / Math.log(1 + r) - 1e-9)
}

// Month by month until the loan is repaid: the last payment is only what
// is left. Returns { months, totalInterest, totalPaid, balanceAfter(m) }.
export function schedule(principal, yearlyRate, payment) {
  const r = yearlyRate / 100 / 12
  const balances = [principal]
  let balance = principal
  let totalInterest = 0
  let totalPaid = 0
  while (balance > 0.005 && balances.length <= 1200) {
    const interest = balance * r
    const paid = Math.min(payment, balance + interest)
    totalInterest += interest
    totalPaid += paid
    balance = balance + interest - paid
    balances.push(Math.max(0, balance))
  }
  return {
    months: balances.length - 1,
    totalInterest,
    totalPaid,
    balanceAfter: (m) => balances[Math.min(Math.max(0, m), balances.length - 1)],
  }
}

// "2026-12" plus `months` → "2027-05".
export function addMonths(yearMonth, months) {
  const [y, m] = yearMonth.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
