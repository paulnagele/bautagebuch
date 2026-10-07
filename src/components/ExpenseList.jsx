import { formatDate } from '../storage.js'

// The expenses behind a budget figure (a category, a Posten or a
// category's expenses without Posten), newest first. `itemName(expense)`
// names the Posten an expense is assigned to, for the category's list.
function ExpenseList({ expenses, format, itemName, onOpenDiary }) {
  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <ul className="expense-list">
      {sorted.map((expense) => {
        const item = itemName?.(expense)
        return (
          <li key={expense.id} className="expense">
            <span className="expense-date">{formatDate(expense.date)}</span>
            <span className="expense-text">
              {expense.description}
              {(item || !expense.paid || expense.hasReceipt) && (
                <span className="tx-tags">
                  {item && <span className="state-pill">{item}</span>}
                  {!expense.paid && <span className="state-pill state-open">Offen</span>}
                  {expense.hasReceipt && (
                    <span className="state-pill" title="Beleg im Tagebucheintrag">
                      🧾 Beleg
                    </span>
                  )}
                </span>
              )}
            </span>
            <span className="expense-amount">{format(expense.amount)}</span>
            {expense.diaryEntryId && onOpenDiary && (
              <button
                type="button"
                className="link expense-open"
                title="Im Tagebuch ansehen, bearbeiten oder löschen"
                onClick={() => onOpenDiary({ entry: { id: expense.diaryEntryId, type: 'expense' } })}
              >
                im Tagebuch
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default ExpenseList
