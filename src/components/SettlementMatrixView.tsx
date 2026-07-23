import type { Member, Settlement } from '../domain/types'
import { formatCellValue, memberDisplayName } from './ui'

interface SettlementMatrixViewProps {
  members: Member[]
  settlements: Settlement[]
  currentMemberId: string | null
  selectedSettlementId: string | null
  onSelectSettlement: (settlementId: string | null) => void
}

export function SettlementMatrixView({
  members,
  settlements,
  currentMemberId,
  selectedSettlementId,
  onSelectSettlement,
}: SettlementMatrixViewProps) {
  const byDirection = new Map(
    settlements
      .filter((settlement) => settlement.amount > 0)
      .map((settlement) => [`${settlement.fromMemberId}:${settlement.toMemberId}`, settlement]),
  )

  return (
    <section className="settlement-matrix" aria-labelledby="settlement-matrix-heading">
      <header className="settlement-matrix__heading">
        <div>
          <p className="eyebrow">金額を一覧</p>
          <h3 id="settlement-matrix-heading">債務マトリクス</h3>
        </div>
        <span>行から列へ支払う</span>
      </header>
      <div className="settlement-matrix__scroller" tabIndex={0}>
        <table>
          <caption>行の人が列の人へ支払う精算額</caption>
          <thead>
            <tr>
              <th scope="col" className="settlement-matrix__corner">支払う人 ↓<br />受取る人 →</th>
              {members.map((member) => (
                <th scope="col" key={member.id}>
                  {memberDisplayName(members, member.id, currentMemberId)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((fromMember) => (
              <tr key={fromMember.id}>
                <th scope="row">{memberDisplayName(members, fromMember.id, currentMemberId)}</th>
                {members.map((toMember) => {
                  if (fromMember.id === toMember.id) {
                    return <td className="settlement-matrix__diagonal" aria-label="同じ参加者" key={toMember.id}>—</td>
                  }
                  const settlement = byDirection.get(`${fromMember.id}:${toMember.id}`)
                  if (!settlement) return <td className="settlement-matrix__empty" key={toMember.id}>—</td>
                  const paid = settlement.status === 'paid'
                  const selected = settlement.id === selectedSettlementId
                  return (
                    <td key={toMember.id} className={paid ? 'is-paid' : undefined}>
                      <button
                        type="button"
                        className={selected ? 'is-selected' : undefined}
                        aria-pressed={selected}
                        aria-label={`${memberDisplayName(members, fromMember.id, currentMemberId)}から${memberDisplayName(members, toMember.id, currentMemberId)}へ${formatCellValue(settlement.amount)}${paid ? '、支払い済み' : ''}`}
                        onClick={() => onSelectSettlement(selected ? null : settlement.id)}
                      >
                        {paid && <span aria-hidden="true">✓</span>}
                        <strong>{formatCellValue(settlement.amount)}</strong>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settlement-matrix__hint">金額を選ぶと左の比較と内訳が開きます。</p>
    </section>
  )
}
