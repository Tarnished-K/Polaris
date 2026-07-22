import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'

import type {
  Expense,
  Member,
  Settlement,
  SettlementBreakdownItem,
  WarikanEvent,
} from '../domain/types'
import { CATEGORY_META } from '../domain/types'
import { EventHeader } from './EventHeader'
import {
  amountToStrokeWidth,
  formatYen,
  getSettlementRelationshipMapMode,
  layoutAnnotationGrid,
  memberColor,
  memberDisplayName,
  memberPillStyle,
  SETTLEMENT_STATUS_META,
} from './ui'

interface SettlementViewProps {
  event: WarikanEvent
  members: Member[]
  currentMemberId: string | null
  expenses: Expense[]
  settlements: Settlement[]
  draftExpenseCount: number
  activeTab: 'settlements' | 'payment'
  onBack: () => void
  onOpenDashboard: () => void
  onOpenSettlements: () => void
  onOpenPayment: () => void
  onOpenSettings: () => void
}

const RELATIONSHIP_MAP_WIDTH = 680
const RELATIONSHIP_NODE_RADIUS = 31

interface RelationshipMapPoint {
  x: number
  y: number
}

interface RelationshipAnnotationLayout {
  point: RelationshipMapPoint
}

function circularMapRadius(memberCount: number) {
  if (memberCount <= 2) return 140
  if (memberCount === 3) return 165
  if (memberCount === 4) return 185
  if (memberCount === 5) return 195
  return 202
}

function edgeGeometry({
  from,
  to,
  fromIndex,
  toIndex,
  memberCount,
  curved,
  labelPosition,
  nodeRadius = RELATIONSHIP_NODE_RADIUS,
}: {
  from: RelationshipMapPoint
  to: RelationshipMapPoint
  fromIndex: number
  toIndex: number
  memberCount: number
  curved: boolean
  labelPosition: number
  nodeRadius?: number
}) {
  const deltaX = to.x - from.x
  const deltaY = to.y - from.y
  const length = Math.max(Math.hypot(deltaX, deltaY), 1)
  const unitX = deltaX / length
  const unitY = deltaY / length
  const start = {
    x: from.x + unitX * (nodeRadius + 5),
    y: from.y + unitY * (nodeRadius + 5),
  }
  const end = {
    x: to.x - unitX * (nodeRadius + 9),
    y: to.y - unitY * (nodeRadius + 9),
  }
  const rawSeparation = Math.abs(fromIndex - toIndex)
  const circularSeparation = Math.min(rawSeparation, memberCount - rawSeparation)
  const bend = curved ? (circularSeparation > 1 ? 104 : 18) : 0
  const bendDirection = (Math.min(fromIndex, toIndex) + Math.max(fromIndex, toIndex)) % 2 === 0 ? 1 : -1
  const control = {
    x: (start.x + end.x) / 2 - unitY * bend * bendDirection,
    y: (start.y + end.y) / 2 + unitX * bend * bendDirection,
  }
  const labelProgress = Math.max(0.1, Math.min(labelPosition, 0.9))
  const inverseLabelProgress = 1 - labelProgress
  const label = {
    x: inverseLabelProgress ** 2 * start.x +
      2 * inverseLabelProgress * labelProgress * control.x +
      labelProgress ** 2 * end.x,
    y: inverseLabelProgress ** 2 * start.y +
      2 * inverseLabelProgress * labelProgress * control.y +
      labelProgress ** 2 * end.y,
  }

  return {
    path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    label,
  }
}

function relationshipChipSize(amountLabel: string, paid: boolean, compact: boolean) {
  return {
    width: compact
      ? Math.max(58, amountLabel.length * 9 + (paid ? 18 : 10))
      : Math.max(72, amountLabel.length * 11 + (paid ? 23 : 12)),
    height: compact ? 22 : 26,
  }
}

export function SettlementRelationshipMap({
  settlements,
  members,
  currentMemberId,
  organizer,
  selectedSettlementId,
  onSelectSettlement,
}: {
  settlements: Settlement[]
  members: Member[]
  currentMemberId: string | null
  organizer: boolean
  selectedSettlementId: string | null
  onSelectSettlement: (settlementId: string | null) => void
}) {
  const markerId = `settlement-arrow-${useId().replace(/:/g, '')}`
  const recommendedMode = getSettlementRelationshipMapMode(members.length)
  const [mode, setMode] = useState(recommendedMode)
  const organizerId = members.find((member) => member.isOrganizer)?.id ?? null
  const egoMemberId = currentMemberId ?? organizerId ?? members[0]?.id ?? null
  const initialFocusId = mode === 'egocentric' || !organizer ? egoMemberId : null
  const [focusedMemberId, setFocusedMemberId] = useState<string | null>(initialFocusId)

  useEffect(() => {
    setFocusedMemberId(mode === 'egocentric' || !organizer ? egoMemberId : null)
  }, [egoMemberId, mode, organizer])

  useEffect(() => {
    setMode(recommendedMode)
  }, [recommendedMode])

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members])
  const payableSettlements = useMemo(
    () => settlements.filter(
      (settlement) =>
        settlement.amount > 0 &&
        memberIds.has(settlement.fromMemberId) &&
        memberIds.has(settlement.toMemberId),
    ),
    [memberIds, settlements],
  )
  const mapSettlements = payableSettlements
  const mapMembers = useMemo(() => {
    if (mode !== 'egocentric' || !egoMemberId) return members
    const egoMember = members.find((member) => member.id === egoMemberId)
    return [
      ...(egoMember ? [egoMember] : []),
      ...members.filter((member) => member.id !== egoMemberId),
    ]
  }, [egoMemberId, members, mode])

  const compactEgocentric = mode === 'egocentric' && mapMembers.length >= 7
  const nodeRadius = compactEgocentric ? 22 : RELATIONSHIP_NODE_RADIUS

  const baseMapHeight = mode === 'circular'
    ? 470 + Math.max(0, members.length - 4) * 18
    : (compactEgocentric ? 480 : 440) + Math.max(0, mapMembers.length - 9) * 10
  const center = { x: RELATIONSHIP_MAP_WIDTH / 2, y: baseMapHeight / 2 }
  const positions = useMemo(() => {
    const result = new Map<string, RelationshipMapPoint>()
    if (mode === 'egocentric') {
      if (mapMembers[0]) result.set(mapMembers[0].id, center)
      const outerMembers = mapMembers.slice(1)
      const radius = Math.min(190, 142 + outerMembers.length * 6)
      outerMembers.forEach((member, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(outerMembers.length, 1)
        result.set(member.id, {
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
        })
      })
      return result
    }

    const radius = circularMapRadius(mapMembers.length)
    mapMembers.forEach((member, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(mapMembers.length, 1)
      result.set(member.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      })
    })
    return result
  }, [center.x, center.y, mapMembers, mode])
  const maxAmount = Math.max(...mapSettlements.map((settlement) => settlement.amount), 0)
  const activeFocusId = focusedMemberId
  const perspectiveMemberId = mode === 'egocentric' ? activeFocusId : currentMemberId
  const annotationLabel = (settlement: Settlement) => {
    const amount = `${settlement.status === 'paid' ? '✓ ' : ''}${formatYen(settlement.amount)}`
    if (mode !== 'circular') return amount
    return `${memberDisplayName(members, settlement.fromMemberId, currentMemberId)}→${memberDisplayName(members, settlement.toMemberId, currentMemberId)} ${amount}`
  }
  const edgeLayouts = new Map<string, ReturnType<typeof edgeGeometry>>()
  mapSettlements.forEach((settlement) => {
    const from = positions.get(settlement.fromMemberId)
    const to = positions.get(settlement.toMemberId)
    if (!from || !to) return
    const fromIndex = mapMembers.findIndex((member) => member.id === settlement.fromMemberId)
    const toIndex = mapMembers.findIndex((member) => member.id === settlement.toMemberId)
    const rawSeparation = Math.abs(fromIndex - toIndex)
    const circularSeparation = Math.min(rawSeparation, mapMembers.length - rawSeparation)
    const focusRelated = Boolean(
      activeFocusId && (
        settlement.fromMemberId === activeFocusId || settlement.toMemberId === activeFocusId
      ),
    )
    const secondaryRelationship = mode === 'egocentric' && !focusRelated
    const compactLabelProgress = fromIndex % 2 === 0 ? 0.62 : 0.74
    const labelPosition = mode === 'circular' && circularSeparation > 1
      ? fromIndex % 2 === 0 ? 0.14 : 0.86
      : compactEgocentric && activeFocusId && focusRelated
        ? settlement.fromMemberId === activeFocusId
          ? compactLabelProgress
          : 1 - compactLabelProgress
        : 0.5
    edgeLayouts.set(settlement.id, edgeGeometry({
      from,
      to,
      fromIndex,
      toIndex,
      memberCount: mapMembers.length,
      curved: mode === 'circular' || secondaryRelationship,
      labelPosition,
      nodeRadius,
    }))
  })

  const annotationLayouts = new Map<string, RelationshipAnnotationLayout>()
  let annotationRowCount = 0
  if (mode === 'circular') {
    const chipWidths = mapSettlements.map((settlement) => relationshipChipSize(
        annotationLabel(settlement),
        settlement.status === 'paid',
        false,
      ).width)
    const grid = layoutAnnotationGrid(chipWidths, RELATIONSHIP_MAP_WIDTH - 24)
    mapSettlements.forEach((settlement, index) => {
      const gridPoint = grid.points[index]
      annotationLayouts.set(settlement.id, {
        point: {
          x: 12 + gridPoint.x,
          y: baseMapHeight + 22 + gridPoint.row * 36,
        },
      })
    })
    annotationRowCount = grid.rows
  }
  const mapHeight = baseMapHeight + (annotationRowCount > 0 ? 12 + annotationRowCount * 36 : 0)
  const selectedSettlement = mapSettlements.find(
    (settlement) => settlement.id === selectedSettlementId,
  ) ?? null
  const focusedName = activeFocusId
    ? memberDisplayName(members, activeFocusId, currentMemberId)
    : null

  const toggleFocus = (memberId: string) => {
    onSelectSettlement(null)
    setFocusedMemberId((current) => {
      if (current !== memberId) return memberId
      return mode === 'egocentric' ? egoMemberId : null
    })
  }

  if (members.length === 0) return null

  return (
    <section className={`settlement-relationship-map${compactEgocentric ? ' is-compact-egocentric' : ''}`} aria-labelledby="settlement-map-heading">
      <div className="settlement-relationship-map__heading">
        <div>
          <p className="eyebrow">支払いの全体像</p>
          <h3 id="settlement-map-heading">精算関係マップ</h3>
        </div>
        <div className="settlement-relationship-map__view-controls">
          <div role="group" aria-label="マップの表示方法">
            <button type="button" className={mode === 'circular' ? 'is-active' : ''} aria-pressed={mode === 'circular'} onClick={() => setMode('circular')}>全体表示</button>
            <button type="button" className={mode === 'egocentric' ? 'is-active' : ''} aria-pressed={mode === 'egocentric'} disabled={!egoMemberId} onClick={() => setMode('egocentric')}>自分中心</button>
          </div>
          <span>
            {mode === 'egocentric'
              ? `${focusedName ?? '自分'}との線を優先・配置は自分中心`
              : focusedName
                ? `${focusedName}にフォーカス中`
                : 'ノードを選んでフォーカス'}
          </span>
        </div>
      </div>
      <div className="settlement-relationship-map__canvas">
        <svg
          viewBox={`0 0 ${RELATIONSHIP_MAP_WIDTH} ${mapHeight}`}
          role="img"
          aria-labelledby={`${markerId}-title ${markerId}-description`}
        >
          <title id={`${markerId}-title`}>{members.length}人の精算関係マップ</title>
          <desc id={`${markerId}-description`}>
            {members.length}人の精算関係。矢印が支払い方向、線の太さが金額を表します。支払い済みにはチェックマークが付きます。
          </desc>
          <defs>
            {(['neutral', 'payable', 'receivable'] as const).map((tone) => (
              <marker
                id={`${markerId}-${tone}`}
                key={tone}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth={compactEgocentric ? 5.5 : 7}
                markerHeight={compactEgocentric ? 5.5 : 7}
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  className={`settlement-relationship-map__arrow settlement-relationship-map__arrow--${tone}`}
                />
              </marker>
            ))}
          </defs>

          <g className="settlement-relationship-map__edges">
            {mapSettlements.map((settlement) => {
              const from = positions.get(settlement.fromMemberId)
              const to = positions.get(settlement.toMemberId)
              if (!from || !to) return null
              const focusRelated = Boolean(
                activeFocusId && (
                  settlement.fromMemberId === activeFocusId || settlement.toMemberId === activeFocusId
                ),
              )
              const secondaryRelationship = mode === 'egocentric' && !focusRelated
              const geometry = edgeLayouts.get(settlement.id)
              if (!geometry) return null
              const paid = settlement.status === 'paid'
              const focusDimmed = Boolean(
                activeFocusId &&
                settlement.fromMemberId !== activeFocusId &&
                settlement.toMemberId !== activeFocusId,
              )
              const selectionDimmed = Boolean(
                selectedSettlementId && settlement.id !== selectedSettlementId,
              )
              const selected = settlement.id === selectedSettlementId
              const tone = perspectiveMemberId === settlement.fromMemberId
                ? 'payable'
                : perspectiveMemberId === settlement.toMemberId
                  ? 'receivable'
                  : 'neutral'
              const amountLabel = formatYen(settlement.amount)
              const edgeLabel = `${memberDisplayName(members, settlement.fromMemberId, currentMemberId)}から${memberDisplayName(members, settlement.toMemberId, currentMemberId)}へ${amountLabel}${paid ? '、支払い済み' : '、未払い'}。比較カードを開く`
              const activate = () => onSelectSettlement(settlement.id)

              return (
                <g
                  key={settlement.id}
                  className={`settlement-relationship-map__edge is-${tone}${secondaryRelationship ? ' is-secondary-relationship' : ''}${paid ? ' is-paid' : ''}${focusDimmed ? ' is-dimmed' : ''}${selectionDimmed ? ' is-selection-dimmed' : ''}${selected ? ' is-selected' : ''}`}
                  data-member-pair={`${settlement.fromMemberId},${settlement.toMemberId}`}
                  data-settlement-id={settlement.id}
                  role="button"
                  tabIndex={0}
                  aria-label={edgeLabel}
                  aria-pressed={selected}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      activate()
                    }
                  }}
                >
                  <title>{edgeLabel}</title>
                  <path
                    d={geometry.path}
                    className="settlement-relationship-map__edge-hit-target"
                  />
                  <path
                    d={geometry.path}
                    className="settlement-relationship-map__edge-line"
                    style={{ strokeWidth: amountToStrokeWidth(settlement.amount, maxAmount) * (secondaryRelationship ? 0.72 : 1) }}
                    markerEnd={paid ? undefined : `url(#${markerId}-${tone})`}
                  />
                </g>
              )
            })}
          </g>

          <g className="settlement-relationship-map__nodes">
            {mapMembers.map((member) => {
              const position = positions.get(member.id)
              if (!position) return null
              const memberIndex = members.findIndex((item) => item.id === member.id)
              const colors = memberColor(Math.max(0, memberIndex))
              const displayName = memberDisplayName(members, member.id, currentMemberId)
              const connectedToFocus = !activeFocusId ||
                member.id === activeFocusId ||
                (mode === 'egocentric' && member.id === egoMemberId) ||
                mapSettlements.some(
                (settlement) =>
                  (settlement.fromMemberId === activeFocusId && settlement.toMemberId === member.id) ||
                  (settlement.toMemberId === activeFocusId && settlement.fromMemberId === member.id),
              )
              const connectedToSelection = !selectedSettlement ||
                member.id === selectedSettlement.fromMemberId ||
                member.id === selectedSettlement.toMemberId
              const dimmed = !connectedToFocus || !connectedToSelection
              const radialX = position.x - center.x
              const radialY = position.y - center.y
              const radialLength = Math.max(Math.hypot(radialX, radialY), 1)
              const labelDistance = nodeRadius + (compactEgocentric ? 13 : 18)
              const isCenterNode = mode === 'egocentric' && member.id === egoMemberId
              const labelX = isCenterNode ? position.x : position.x + (radialX / radialLength) * labelDistance
              const labelY = isCenterNode ? position.y + nodeRadius + (compactEgocentric ? 19 : 24) : position.y + (radialY / radialLength) * labelDistance + 5
              const textAnchor = isCenterNode || Math.abs(radialX / radialLength) < 0.28
                ? 'middle'
                : radialX > 0 ? 'start' : 'end'
              const activate = () => toggleFocus(member.id)

              return (
                <g
                  key={member.id}
                  className={`settlement-relationship-map__node is-interactive${focusedMemberId === member.id ? ' is-focused' : ''}${dimmed ? ' is-dimmed' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${displayName}の精算関係をフォーカス${mode === 'egocentric' ? '。配置は自分中心のままです' : ''}`}
                  aria-pressed={focusedMemberId === member.id}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      activate()
                    }
                  }}
                >
                  <circle
                    cx={position.x}
                    cy={position.y}
                    r={nodeRadius}
                    fill={colors.soft}
                    stroke={colors.border}
                    className="settlement-relationship-map__node-circle"
                  />
                  <text
                    x={position.x}
                    y={position.y + (compactEgocentric ? 5 : 7)}
                    textAnchor="middle"
                    fill={colors.solid}
                    className="settlement-relationship-map__initial"
                  >
                    {Array.from(member.name.trim())[0] ?? '?'}
                  </text>
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor={textAnchor}
                    className="settlement-relationship-map__member-label"
                  >
                    {displayName}
                  </text>
                </g>
              )
            })}
          </g>

          <g className="settlement-relationship-map__annotations">
            {mapSettlements.map((settlement) => {
              const geometry = edgeLayouts.get(settlement.id)
              if (!geometry) return null
              const focusRelated = Boolean(
                activeFocusId && (
                  settlement.fromMemberId === activeFocusId || settlement.toMemberId === activeFocusId
                ),
              )
              const secondaryRelationship = mode === 'egocentric' && !focusRelated
              const selected = settlement.id === selectedSettlementId
              if (secondaryRelationship && !selected) return null
              const paid = settlement.status === 'paid'
              const label = annotationLabel(settlement)
              const chip = relationshipChipSize(label, paid, compactEgocentric)
              const point = annotationLayouts.get(settlement.id)?.point ?? geometry.label
              const selectionDimmed = Boolean(selectedSettlementId && !selected)
              const tone = perspectiveMemberId === settlement.fromMemberId
                ? 'payable'
                : perspectiveMemberId === settlement.toMemberId
                  ? 'receivable'
                  : 'neutral'
              const activate = () => onSelectSettlement(settlement.id)

              return (
                <g
                  key={settlement.id}
                  className={`settlement-relationship-map__edge settlement-relationship-map__annotation is-${tone}${paid ? ' is-paid' : ''}${selectionDimmed ? ' is-selection-dimmed' : ''}${selected ? ' is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label}。比較カードを開く`}
                  aria-pressed={selected}
                  onClick={activate}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      activate()
                    }
                  }}
                >
                  <rect
                    x={point.x - chip.width / 2}
                    y={point.y - chip.height / 2}
                    width={chip.width}
                    height={chip.height}
                    rx={chip.height / 2}
                    className="settlement-relationship-map__amount-chip"
                  />
                  <text
                    x={point.x}
                    y={point.y + (compactEgocentric ? 3.5 : 4.5)}
                    textAnchor="middle"
                    className="settlement-relationship-map__amount-label"
                  >
                    {label}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <p className="settlement-relationship-map__legend">
        <span className="is-receivable"><i />受け取る</span>
        <span className="is-payable"><i />支払う</span>
        <span><i />ほかの精算</span>
      </p>
    </section>
  )
}

function StatusBadge({ status, amount }: Pick<Settlement, 'status' | 'amount'>) {
  if (amount === 0) {
    return <span className="settlement-status settlement-status--success">全額相殺</span>
  }
  const meta = SETTLEMENT_STATUS_META[status]
  return <span className={`settlement-status settlement-status--${meta.tone}`}>{meta.label}</span>
}

function BreakdownRows({
  items,
  members,
  currentMemberId,
  negative = false,
}: {
  items: SettlementBreakdownItem[]
  members: Member[]
  currentMemberId: string | null
  negative?: boolean
}) {
  return (
    <div className="breakdown-rows">
      {items.map((item) => (
        <div className="breakdown-row" key={`${item.expenseId}:${item.fromMemberId}`}>
          <div>
            <strong>{item.expenseTitle}</strong>
            <small>
              {memberDisplayName(members, item.toMemberId, currentMemberId)}が立て替え
              {item.dayIndex ? `・${item.dayIndex}日目` : ''}
            </small>
          </div>
          <strong className={negative ? 'breakdown-row__negative' : ''}>
            {negative ? '−' : ''}{formatYen(item.amount)}
          </strong>
        </div>
      ))}
    </div>
  )
}

function SettlementBreakdown({
  settlement,
  members,
  currentMemberId,
}: {
  settlement: Settlement
  members: Member[]
  currentMemberId: string | null
}) {
  return (
    <div className="settlement-breakdown" aria-label="精算の内訳">
      <div className="settlement-breakdown__body">
        <section>
          <h4>
            {memberDisplayName(members, settlement.toMemberId, currentMemberId)}が
            {memberDisplayName(members, settlement.fromMemberId, currentMemberId)}の分を立て替えた支出
          </h4>
          <BreakdownRows items={settlement.charges} members={members} currentMemberId={currentMemberId} />
          <p className="breakdown-subtotal">
            小計 <strong>{formatYen(settlement.grossAmount)}</strong>
          </p>
        </section>

        {settlement.offsets.length > 0 && (
          <section className="offset-section">
            <h4>
              {memberDisplayName(members, settlement.fromMemberId, currentMemberId)}が
              {memberDisplayName(members, settlement.toMemberId, currentMemberId)}の分を立て替えた支出
            </h4>
            <p>
              反対方向の立て替えとして差し引きます。
            </p>
            <BreakdownRows items={settlement.offsets} members={members} currentMemberId={currentMemberId} negative />
            <p className="breakdown-subtotal breakdown-subtotal--offset">
              差し引き <strong>−{formatYen(settlement.offsetAmount)}</strong>
            </p>
          </section>
        )}

        <div className="breakdown-equation" aria-label="差し引き後の精算額">
          <small>立替が多い側</small>
          <span>{formatYen(settlement.grossAmount)}</span>
          <span aria-hidden="true">−</span>
          <small>少ない側</small>
          <span>{formatYen(settlement.offsetAmount)}</span>
          <span aria-hidden="true">＝</span>
          <strong>{formatYen(settlement.amount)}</strong>
        </div>
      </div>
    </div>
  )
}

interface BarSide {
  memberId: string
  amount: number
  items: SettlementBreakdownItem[]
}

function AdvanceBar({ side, members, currentMemberId, maxAmount, position }: { side: BarSide; members: Member[]; currentMemberId: string | null; maxAmount: number; position: 'left' | 'right' }) {
  const memberIndex = Math.max(0, members.findIndex((member) => member.id === side.memberId))
  const displayName = memberDisplayName(members, side.memberId, currentMemberId)
  return (
    <div className="advance-bar-side">
      <div className={`advance-bar-side__visual advance-bar-side__visual--${position}`}>
        <div className="advance-bar-column">
          <div className="advance-bar-amount"><span>立替額</span><strong>{formatYen(side.amount)}</strong></div>
          <div className="advance-bar-track" aria-label={`${displayName}の立替額${formatYen(side.amount)}`}>
            {side.items.map((item) => (
              <span
                className="advance-bar-segment"
                key={`${item.expenseId}:${item.fromMemberId}`}
                style={{
                  height: `${(item.amount / maxAmount) * 100}%`,
                  background: CATEGORY_META[item.category ?? 'other'].color,
                }}
                title={`${item.expenseTitle} ${formatYen(item.amount)}`}
              />
            ))}
          </div>
          <span className="advance-bar-member" style={memberPillStyle(memberIndex)}>{displayName}</span>
        </div>
        <div className="advance-bar-legend">
          {side.items.length === 0 ? (
            <span className="advance-bar-legend__empty">立て替えなし</span>
          ) : side.items.map((item) => (
            <span key={`legend:${item.expenseId}:${item.fromMemberId}`}>
              <i style={{ background: CATEGORY_META[item.category ?? 'other'].color }} />
              <b>{item.expenseTitle}</b>
              <em>{formatYen(item.amount)}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PairResult({ settlement, members, currentMemberId, organizer }: { settlement: Settlement; members: Member[]; currentMemberId: string | null; organizer: boolean }) {
  const fromName = memberDisplayName(members, settlement.fromMemberId, currentMemberId)
  const toName = memberDisplayName(members, settlement.toMemberId, currentMemberId)
  const isCurrentPaying = !organizer && currentMemberId === settlement.fromMemberId
  const isCurrentReceiving = !organizer && currentMemberId === settlement.toMemberId
  const resultTone = settlement.amount === 0 ? 'even' : isCurrentPaying ? 'pay' : isCurrentReceiving ? 'receive' : 'neutral'
  const resultLabel = organizer
    ? `${fromName} → ${toName} に支払う`
    : isCurrentPaying
      ? `あなた → ${toName} に支払う`
      : `${fromName} → あなたが受け取る`

  return (
    <div className={`pair-result pair-result--${resultTone}`}>
      {settlement.amount === 0 ? (
        <><strong>差額なし</strong><span>お互いの立て替えが相殺されています</span></>
      ) : (
        <>
          <span className="pair-result__direction">{resultLabel}</span>
          <strong>{formatYen(settlement.amount)}</strong>
        </>
      )}
    </div>
  )
}

function PairAdvanceBars({ settlement, members, currentMemberId, organizer }: { settlement: Settlement; members: Member[]; currentMemberId: string | null; organizer: boolean }) {
  const maxAmount = Math.max(settlement.grossAmount, settlement.offsetAmount, 1)
  const fromSide: BarSide = { memberId: settlement.fromMemberId, amount: settlement.offsetAmount, items: settlement.offsets }
  const toSide: BarSide = { memberId: settlement.toMemberId, amount: settlement.grossAmount, items: settlement.charges }
  const currentOnRight = !organizer && currentMemberId === toSide.memberId
  const leftSide = currentOnRight ? toSide : fromSide
  const rightSide = currentOnRight ? fromSide : toSide
  const payerIsLeft = leftSide.memberId === settlement.fromMemberId
  const paymentArrow = payerIsLeft ? '→' : '←'
  const lowAmount = Math.min(leftSide.amount, rightSide.amount)
  const guideOffset = `${(1 - lowAmount / maxAmount) * 100}%`
  const leftName = memberDisplayName(members, leftSide.memberId, currentMemberId)
  const rightName = memberDisplayName(members, rightSide.memberId, currentMemberId)
  const differenceLabel = settlement.amount === 0
    ? '差額なし、±0円'
    : `差額${formatYen(settlement.amount)}、${payerIsLeft ? leftName : rightName}から${payerIsLeft ? rightName : leftName}へ支払う`

  return (
    <div className="pair-comparison">
      <div className="pair-bars">
        <AdvanceBar side={leftSide} members={members} currentMemberId={currentMemberId} maxAmount={maxAmount} position="left" />
        <span className="pair-bars__versus" aria-label={differenceLabel}>
          {settlement.amount === 0 ? (
            <strong>±0</strong>
          ) : (
            <><small>差</small><strong>{formatYen(settlement.amount)}</strong><b aria-hidden="true">{paymentArrow}</b></>
          )}
        </span>
        <AdvanceBar side={rightSide} members={members} currentMemberId={currentMemberId} maxAmount={maxAmount} position="right" />
        {lowAmount > 0 && (
          <span
            className="pair-bars__difference-guide"
            style={{ '--guide-offset': guideOffset } as CSSProperties}
            aria-hidden="true"
          >
            <i>超過分</i>
          </span>
        )}
      </div>
    </div>
  )
}

function comparisonTitle({
  settlement,
  members,
  currentMemberId,
}: {
  settlement: Settlement
  members: Member[]
  currentMemberId: string | null
}) {
  const currentMemberIsInPair = currentMemberId === settlement.fromMemberId || currentMemberId === settlement.toMemberId
  if (currentMemberId && currentMemberIsInPair) {
    const counterpartId = settlement.fromMemberId === currentMemberId
      ? settlement.toMemberId
      : settlement.fromMemberId
    return `${memberDisplayName(members, counterpartId, currentMemberId)}との比較`
  }

  return `${memberDisplayName(members, settlement.fromMemberId, currentMemberId)}と${memberDisplayName(members, settlement.toMemberId, currentMemberId)}の比較`
}

export function SettlementView({
  event,
  members,
  currentMemberId,
  expenses,
  settlements,
  draftExpenseCount,
  activeTab,
  onBack,
  onOpenDashboard,
  onOpenSettlements,
  onOpenPayment,
  onOpenSettings,
}: SettlementViewProps) {
  const currentMember = members.find((member) => member.id === currentMemberId)
  const organizer = Boolean(currentMember?.isOrganizer)
  const finalized = event.status === 'finalized'
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null)
  const visibleSettlements = useMemo(
    () =>
      organizer
        ? settlements
        : settlements.filter(
            (settlement) =>
              settlement.fromMemberId === currentMemberId ||
              settlement.toMemberId === currentMemberId,
          ),
    [currentMemberId, organizer, settlements],
  )
  const completedCount = visibleSettlements.filter(
    (settlement) => settlement.status === 'paid',
  ).length
  const sortedSettlements = useMemo(() => {
    const rank = { pending: 0, reported: 1, paid: 2 }
    return [...visibleSettlements].sort(
      (left, right) => rank[left.status] - rank[right.status],
    )
  }, [visibleSettlements])

  useEffect(() => {
    setSelectedSettlementId(null)
  }, [currentMemberId])

  useEffect(() => {
    if (!selectedSettlementId) return
    document.getElementById(`settlement-card-${selectedSettlementId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    })
  }, [selectedSettlementId])

  return (
    <div className="app-shell settlement-page">
      <EventHeader
        event={event}
        members={members}
        activeTab={activeTab}
        onTabChange={(tab) => tab === 'expenses' ? onBack() : tab === 'dashboard' ? onOpenDashboard() : tab === 'payment' ? onOpenPayment() : onOpenSettlements()}
        onOpenSettings={organizer ? onOpenSettings : undefined}
      />

      <div className="settlement-page-intro">
        <span className="mode-badge">相手ごと精算</span>
        <span className={`status-pill ${finalized ? 'status-pill--success' : 'status-pill--warning'}`}>
          {finalized ? '確定済み' : '暫定プレビュー'}
        </span>
      </div>

      {!finalized && (
        <div className={`preview-banner ${draftExpenseCount > 0 ? 'preview-banner--blocked' : ''}`} role="status">
          <span aria-hidden="true">i</span>
          <p>
            {draftExpenseCount > 0 ? (
              <><strong>暫定支出が{draftExpenseCount}件あります。</strong>イベント合計には含まれますが、負担額と精算にはまだ反映されません。</>
            ) : (
              <><strong>まだ暫定の精算です。</strong>相手ごとにまとめ、反対方向の立て替えを差し引いています。</>
            )}
          </p>
        </div>
      )}

      <main className="settlement-layout">
        <div className="settlement-center">
          <section className="all-settlements pair-settlements" aria-labelledby="all-settlements-heading">
            <div className="section-heading-row section-heading-row--compact">
              <div>
                <p className="eyebrow">{currentMember?.name ?? 'あなた'}の視点</p>
                <h2 id="all-settlements-heading">{organizer ? '全員の精算状況' : '関係する精算状況'}</h2>
              </div>
              <span className="count-label">完了 {completedCount} / {visibleSettlements.length}</span>
            </div>
            <p className="pair-settlements__caption">同じ基準で、相手の分を立て替えた金額を比較しています。</p>

            <div className="settlement-relationship-workspace">
              <section className="settlement-comparison-panel" aria-labelledby="settlement-comparison-heading">
                <header className="settlement-comparison-panel__heading">
                  <div>
                    <p className="eyebrow">矢印の根拠</p>
                    <h3 id="settlement-comparison-heading">比較一覧</h3>
                  </div>
                  <span>{sortedSettlements.length}組</span>
                </header>
                <div className="settlement-list">
                  {sortedSettlements.length === 0 ? (
                    <div className="subtle-empty subtle-empty--large">
                      確定済みの支出が追加されると、相手ごとの精算が表示されます。
                    </div>
                  ) : (
                    sortedSettlements.map((settlement) => {
                      const selected = settlement.id === selectedSettlementId
                      return (
                      <article
                        className={`pair-settlement-card${selected ? ' is-selected' : ''}`}
                        id={`settlement-card-${settlement.id}`}
                        key={settlement.id}
                      >
                        <header className="pair-settlement-card__header">
                          <strong>{comparisonTitle({ settlement, members, currentMemberId })}</strong>
                          <StatusBadge status={settlement.status} amount={settlement.amount} />
                        </header>
                        <div className="pair-settlement-card__summary">
                          <PairResult settlement={settlement} members={members} currentMemberId={currentMemberId} organizer={organizer} />
                        </div>
                        <details
                          className="pair-settlement-details"
                          open={selected}
                          onToggle={(event) => {
                            if (event.currentTarget.open && !selected) {
                              setSelectedSettlementId(settlement.id)
                            } else if (!event.currentTarget.open && selected) {
                              setSelectedSettlementId(null)
                            }
                          }}
                        >
                          <summary>比較と内訳を見る</summary>
                          <div className="pair-settlement-details__body">
                            <PairAdvanceBars settlement={settlement} members={members} currentMemberId={currentMemberId} organizer={organizer} />
                            <div className="pair-settlement-card__footer">
                              <SettlementBreakdown settlement={settlement} members={members} currentMemberId={currentMemberId} />
                            </div>
                          </div>
                        </details>
                      </article>
                      )
                    })
                  )}
                </div>
              </section>

              <SettlementRelationshipMap
                settlements={visibleSettlements}
                members={members}
                currentMemberId={currentMemberId}
                organizer={organizer}
                selectedSettlementId={selectedSettlementId}
                onSelectSettlement={setSelectedSettlementId}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
