// bracketLayout
// -------------
// Pure geometry for the MatchGeni bracket renderer. No Vue / no DOM —
// takes a `BracketModel` and returns absolute pixel positions for every
// match plus the connector elbow paths, so the renderer is a thin
// presentational layer and the math is unit-testable + reusable.
//
// Translated (cleaned) from the legacy `BracketsView` positioning:
//   - rounds lay out left → right, one column per round;
//   - round 1 matches stack by `position`;
//   - each later match is vertically centered between the matches that
//     FEED it (`feederIds`) — the classic bracket "average of children"
//     rule — falling back to even spacing when feeders are unknown;
//   - sections stack vertically (winner on top, loser below) with the
//     grand final placed to the right, centered between the two finals.
// Connectors are emitted as SVG elbow paths between a feeder's right
// edge and its child's left edge.

import type { BracketModel, BracketSection, BracketMatch } from '../types'

/** Match box footprint, in canvas px. */
export const MATCH_WIDTH = 212
export const MATCH_HEIGHT = 118
/** Gap between round columns and between sibling matches in round 1. */
const ROUND_GAP = 48
const ROW_GAP = 26
/** Gap between stacked sections (winner → loser). */
const SECTION_GAP = 72
/** Outer padding around the whole tree. */
const PADDING = 28
/** Width reserved to the right of the deciding game for the winner
 *  line + "WINNER" label. */
const WINNER_LINE_WIDTH = 160

const STRIDE = MATCH_WIDTH + ROUND_GAP

interface Rect { left: number; top: number; w: number; h: number }

export interface BracketConnector {
  /** SVG path `d`. */
  d: string
  /** Dotted = a championship connection (into the grand-final /
   *  if-necessary game). Solid = a normal in-bracket advancement. */
  dotted: boolean
}

export interface BracketLayout {
  /** Positioned sections — same matches, now carrying `left/top/height`. */
  sections: BracketSection[]
  connectors: BracketConnector[]
  /** Anchor for the trailing "WINNER" line + champion label — the
   *  right edge + vertical center of the deciding game. `null` when
   *  the bracket has no final game. */
  winnerLine: { x: number; y: number } | null
  width: number
  height: number
}

function centerY(r: Rect): number { return r.top + r.h / 2 }

/** Position one section's matches starting at (xOffset, yOffset).
 *  Registers each match rect in `rectById` (shared across sections so
 *  cross-section feeders resolve). Returns the section's bounding box. */
function positionSection(
  section: BracketSection,
  xOffset: number,
  yOffset: number,
  rectById: Map<string, Rect>,
  sectionOfMatch: Map<string, BracketSection>
): { maxX: number; maxY: number } {
  let maxX = xOffset
  let maxY = yOffset

  section.rounds.forEach((round, r) => {
    const x = xOffset + r * STRIDE
    round.forEach((match, i) => {
      const h = MATCH_HEIGHT
      let top: number

      // Only center on feeders that keep the match inside its own
      // bracket — i.e. same-section feeders. The exception is the
      // grand final, which is intentionally centered between the
      // winner-final and loser-final (cross-section) feeders. This
      // stops cross-bracket "loser drop" links from yanking a loser
      // match up into the winner section's vertical band.
      const feeders = (match.feederIds ?? [])
        .filter((fid) => section.kind === 'grandFinal' || sectionOfMatch.get(fid) === section)
        .map((id) => rectById.get(id))
        .filter((rect): rect is Rect => !!rect)

      if (r > 0 && feeders.length > 0) {
        // Center between the feeders' centers.
        const cy = feeders.reduce((sum, f) => sum + centerY(f), 0) / feeders.length
        top = cy - h / 2
      } else if (r === 0) {
        top = yOffset + i * (h + ROW_GAP)
      } else {
        // Fallback (no feeder links): classic doubling spread.
        const span = (h + ROW_GAP) * Math.pow(2, r)
        top = yOffset + i * span + (span - h) / 2
      }

      const rect: Rect = { left: x, top, w: MATCH_WIDTH, h }
      rectById.set(match.id, rect)
      match.left = x
      match.top = top
      match.height = h

      maxX = Math.max(maxX, x + MATCH_WIDTH)
      maxY = Math.max(maxY, top + h)
    })
  })

  return { maxX, maxY }
}

/** Last match of a section's last round (the section "final"). */
function sectionFinal(section: BracketSection | undefined): BracketMatch | undefined {
  if (!section || section.rounds.length === 0) return undefined
  const last = section.rounds[section.rounds.length - 1]
  return last[last.length - 1]
}

/** Build connector elbow paths for every match that declares feeders. */
function buildConnectors(
  sections: BracketSection[],
  rectById: Map<string, Rect>,
  sectionOfMatch: Map<string, BracketSection>
): BracketConnector[] {
  const out: BracketConnector[] = []
  for (const section of sections) {
    const isGrandFinalChild = section.kind === 'grandFinal'
    for (const round of section.rounds) {
      for (const match of round) {
        const child = rectById.get(match.id)
        if (!child) continue
        const cx1 = child.left
        const ccy = centerY(child)
        for (const fid of match.feederIds ?? []) {
          const sameSection = sectionOfMatch.get(fid) === section
          // Keep winner ↔ winner and loser ↔ loser advancement lines.
          // Suppress cross-bracket "loser drop" links (winner game →
          // loser bracket) so the two brackets read as SEPARATE. The
          // only cross-section lines we keep are into the grand final
          // (championship 998 + if-necessary 999), drawn dotted.
          if (!isGrandFinalChild && !sameSection) continue
          const f = rectById.get(fid)
          if (!f) continue
          const fx2 = f.left + f.w
          const fcy = centerY(f)
          const midX = (fx2 + cx1) / 2
          out.push({
            d: `M ${fx2} ${fcy} H ${midX} V ${ccy} H ${cx1}`,
            dotted: isGrandFinalChild
          })
        }
      }
    }
  }
  return out
}

/** Compute absolute layout for a whole bracket. Mutates copies of the
 *  matches (callers should pass a model they're happy to render). */
export function computeBracketLayout(model: BracketModel): BracketLayout {
  const rectById = new Map<string, Rect>()
  const sectionOfMatch = new Map<string, BracketSection>()
  for (const s of model.sections) {
    for (const round of s.rounds) for (const m of round) sectionOfMatch.set(m.id, s)
  }

  const winner = model.sections.find((s) => s.kind === 'winner' || s.kind === 'single')
  const loser = model.sections.find((s) => s.kind === 'loser')
  const grandFinal = model.sections.find((s) => s.kind === 'grandFinal')

  let maxX = 0
  let maxY = 0

  // 1) Winner / single — top-left anchor.
  if (winner) {
    const box = positionSection(winner, PADDING, PADDING, rectById, sectionOfMatch)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }

  // 2) Loser — stacked directly below the winner section.
  if (loser) {
    const box = positionSection(loser, PADDING, maxY + SECTION_GAP, rectById, sectionOfMatch)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }

  // 3) Grand final — column to the RIGHT of the winner bracket,
  //    vertically centered between the winner final and loser final.
  if (grandFinal) {
    const wFinal = sectionFinal(winner)
    const lFinal = sectionFinal(loser)
    const wRect = wFinal ? rectById.get(wFinal.id) : undefined
    const lRect = lFinal ? rectById.get(lFinal.id) : undefined
    const targetCenter = wRect && lRect
      ? (centerY(wRect) + centerY(lRect)) / 2
      : wRect ? centerY(wRect)
      : PADDING + MATCH_HEIGHT / 2
    const xOffset = PADDING + (winner?.rounds.length ?? 1) * STRIDE
    const box = positionSection(grandFinal, xOffset, targetCenter - MATCH_HEIGHT / 2, rectById, sectionOfMatch)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }

  const connectors = buildConnectors(model.sections, rectById, sectionOfMatch)

  // Winner line — anchored to the right edge + center of the deciding
  // game (grand-final / championship-IF for double·3gg, the final for
  // single). Reserves trailing width for the line + "WINNER" label.
  const deciding = sectionFinal(grandFinal) ?? sectionFinal(winner)
  const decidingRect = deciding ? rectById.get(deciding.id) : undefined
  const winnerLine = decidingRect
    ? { x: decidingRect.left + decidingRect.w, y: centerY(decidingRect) }
    : null
  if (winnerLine) maxX = Math.max(maxX, winnerLine.x + WINNER_LINE_WIDTH)

  return {
    sections: model.sections,
    connectors,
    winnerLine,
    width: maxX + PADDING,
    height: maxY + PADDING
  }
}
