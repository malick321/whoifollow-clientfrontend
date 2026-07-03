// Mock bracket data (single / double / 3-game-guarantee)
// ------------------------------------------------------
// Stand-in for the not-yet-shipped bracket API. Returns normalized
// `BracketModel`s the reusable `MatchGeniBracket` renderer can draw.
// When the backend ships, replace `getMockBracket` with a real fetch
// + an adapter that maps the wire payload into this same shape — the
// renderer + layout engine stay untouched.

import type { BracketModel, BracketMatch } from '../types'

type MatchSeed = Partial<BracketMatch> & Pick<BracketMatch, 'id' | 'gameName' | 'roundNumber' | 'position' | 'team1' | 'team2' | 'status'>

function m(seed: MatchSeed): BracketMatch {
  return seed as BracketMatch
}

// ── Single elimination — 8 teams, 3 rounds ───────────────────────
const SINGLE: BracketModel = {
  id: 'brk_single',
  name: "Men's 65 Gold",
  format: 'Single Elimination',
  type: 'single',
  teamCount: 8,
  gameCount: 7,
  winner: { name: 'Iron Men' },
  sections: [
    {
      kind: 'single',
      rounds: [
        [
          m({ id: 's_g1', gameName: 'G1', roundNumber: 1, position: 1, status: 'final',
            assignedTime: '8:00 AM', assignedDateLabel: 'Apr 29', assignedFieldName: 'Field 1',
            team1: { name: 'Sluggers', seed: 1, score: 7, isWinner: true },
            team2: { name: 'Benchwarmers', seed: 8, score: 3 } }),
          m({ id: 's_g2', gameName: 'G2', roundNumber: 1, position: 2, status: 'final',
            assignedTime: '8:00 AM', assignedDateLabel: 'Apr 29', assignedFieldName: 'Field 2',
            team1: { name: 'Power Play', seed: 4, score: 5 },
            team2: { name: 'Hot Corner', seed: 5, score: 6, isWinner: true } }),
          m({ id: 's_g3', gameName: 'G3', roundNumber: 1, position: 3, status: 'final',
            assignedTime: '9:30 AM', assignedDateLabel: 'Apr 29', assignedFieldName: 'Field 1',
            team1: { name: 'Iron Men', seed: 2, score: 8, isWinner: true },
            team2: { name: 'Old Timers', seed: 7, score: 2 } }),
          m({ id: 's_g4', gameName: 'G4', roundNumber: 1, position: 4, status: 'live',
            assignedTime: '9:30 AM', assignedDateLabel: 'Apr 29', assignedFieldName: 'Field 2',
            team1: { name: 'Diamond Cutters', seed: 3, score: 2 },
            team2: { name: 'Heavy Hitters', seed: 6, score: 1 } })
        ],
        [
          m({ id: 's_sf1', gameName: 'SF1', roundNumber: 2, position: 1, status: 'scheduled',
            feederIds: ['s_g1', 's_g2'], assignedTime: '11:00 AM', assignedDateLabel: 'Apr 30', assignedFieldName: 'Field 1',
            team1: { name: 'Sluggers' },
            team2: { name: 'Hot Corner' } }),
          m({ id: 's_sf2', gameName: 'SF2', roundNumber: 2, position: 2, status: 'delayed',
            feederIds: ['s_g3', 's_g4'], delayedReason: 'Rain delay',
            team1: { name: 'Iron Men' },
            team2: { name: 'Winner of G4' } })
        ],
        [
          m({ id: 's_f', gameName: 'Final', roundNumber: 3, position: 1, status: 'scheduled',
            feederIds: ['s_sf1', 's_sf2'],
            team1: { name: 'Winner of SF1' },
            team2: { name: 'Winner of SF2' } })
        ]
      ]
    }
  ]
}

// ── Double elimination — 4 teams ─────────────────────────────────
const DOUBLE: BracketModel = {
  id: 'brk_double',
  name: "Men's 70/75 Gold",
  format: 'Double Elimination',
  type: 'double',
  teamCount: 4,
  gameCount: 6,
  winner: { name: 'Veterans United' },
  sections: [
    {
      kind: 'winner',
      label: 'Winner Bracket',
      rounds: [
        [
          m({ id: 'd_w1', gameName: 'W1', roundNumber: 1, position: 1, status: 'final',
            assignedTime: '8:00 AM', assignedFieldName: 'Field 1',
            team1: { name: 'Veterans United', seed: 1, score: 9, isWinner: true },
            team2: { name: 'Steel Curtain', seed: 4, score: 4 } }),
          m({ id: 'd_w2', gameName: 'W2', roundNumber: 1, position: 2, status: 'final',
            assignedTime: '8:00 AM', assignedFieldName: 'Field 2',
            team1: { name: 'Greybeards', seed: 2, score: 3 },
            team2: { name: 'Wise Guys', seed: 3, score: 5, isWinner: true } })
        ],
        [
          m({ id: 'd_wf', gameName: 'WF', roundNumber: 2, position: 1, status: 'scheduled',
            feederIds: ['d_w1', 'd_w2'],
            team1: { name: 'Veterans United' },
            team2: { name: 'Wise Guys' } })
        ]
      ]
    },
    {
      kind: 'loser',
      label: 'Loser Bracket',
      rounds: [
        [
          m({ id: 'd_l1', gameName: 'L1', roundNumber: 1, position: 1, status: 'final',
            feederIds: ['d_w1', 'd_w2'], assignedTime: '9:30 AM', assignedFieldName: 'Field 3',
            team1: { name: 'Steel Curtain', score: 6, isWinner: true },
            team2: { name: 'Greybeards', score: 2 } })
        ],
        [
          m({ id: 'd_lf', gameName: 'LF', roundNumber: 2, position: 1, status: 'scheduled',
            feederIds: ['d_l1', 'd_wf'],
            team1: { name: 'Steel Curtain' },
            team2: { name: 'Loser of WF' } })
        ]
      ]
    },
    {
      kind: 'grandFinal',
      label: 'Championship',
      rounds: [
        [
          m({ id: 'd_gf', gameName: 'Championship', roundNumber: 1, position: 1, status: 'scheduled',
            feederIds: ['d_wf', 'd_lf'],
            team1: { name: 'Winner of WF' },
            team2: { name: 'Winner of LF' } })
        ],
        [
          m({ id: 'd_gf_if', gameName: 'Championship IF', roundNumber: 2, position: 1, status: 'not_needed',
            feederIds: ['d_gf'], ifNecessary: true,
            team1: { name: 'Winner of WF' },
            team2: { name: 'Winner of LF' } })
        ]
      ]
    }
  ]
}

// ── Three-game guarantee — winner + elimination + finals ─────────
const THREE_GG: BracketModel = {
  id: 'brk_3gg',
  name: "Men's 70 Silver",
  format: '3-Game Guarantee',
  type: '3gg',
  teamCount: 4,
  gameCount: 6,
  winner: { name: 'Hall of Famers' },
  sections: [
    {
      kind: 'winner',
      label: 'Winner Bracket',
      rounds: [
        [
          m({ id: 't_w1', gameName: 'G1', roundNumber: 1, position: 1, status: 'final',
            assignedTime: '8:00 AM', assignedFieldName: 'Field 1',
            team1: { name: 'Hall of Famers', seed: 1, score: 10, isWinner: true },
            team2: { name: 'Boys of Summer', seed: 4, score: 5 } }),
          m({ id: 't_w2', gameName: 'G2', roundNumber: 1, position: 2, status: 'final',
            assignedTime: '8:00 AM', assignedFieldName: 'Field 2',
            team1: { name: 'Legends', seed: 2, score: 7, isWinner: true },
            team2: { name: 'Gold Standard', seed: 3, score: 6 } })
        ],
        [
          m({ id: 't_wf', gameName: 'G5', roundNumber: 2, position: 1, status: 'scheduled',
            feederIds: ['t_w1', 't_w2'],
            team1: { name: 'Hall of Famers' },
            team2: { name: 'Legends' } })
        ]
      ]
    },
    {
      kind: 'loser',
      label: 'Elimination',
      rounds: [
        [
          m({ id: 't_l1', gameName: 'G3', roundNumber: 1, position: 1, status: 'final',
            feederIds: ['t_w1', 't_w2'], assignedTime: '9:30 AM', assignedFieldName: 'Field 3',
            team1: { name: 'Boys of Summer', score: 4 },
            team2: { name: 'Gold Standard', score: 8, isWinner: true } })
        ],
        [
          m({ id: 't_l2', gameName: 'G6', roundNumber: 2, position: 1, status: 'not_needed',
            feederIds: ['t_l1', 't_wf'],
            team1: { name: 'Gold Standard', strikethrough: true },
            team2: { name: 'Loser of G5', strikethrough: true } })
        ]
      ]
    },
    {
      kind: 'grandFinal',
      label: 'Final',
      rounds: [
        [
          m({ id: 't_gf', gameName: 'Championship', roundNumber: 1, position: 1, status: 'scheduled',
            feederIds: ['t_wf', 't_l2'],
            team1: { name: 'Winner of G5' },
            team2: { name: 'Winner of G6' } })
        ],
        [
          m({ id: 't_gf_if', gameName: 'Championship IF', roundNumber: 2, position: 1, status: 'not_needed',
            feederIds: ['t_gf'], ifNecessary: true,
            team1: { name: 'Winner of G5' },
            team2: { name: 'Winner of G6' } })
        ]
      ]
    }
  ]
}

export const MOCK_BRACKETS: Record<BracketModel['type'], BracketModel> = {
  single: SINGLE,
  double: DOUBLE,
  '3gg': THREE_GG
}

/** Return a representative mock bracket for the given format. */
export function getMockBracket(type: BracketModel['type'] = 'single'): BracketModel {
  return MOCK_BRACKETS[type]
}

/** Brackets per (mock) division — some divisions run TWO brackets
 *  (e.g. Gold + Silver), some run ONE, and the mix includes single,
 *  double, and 3-game-guarantee formats. Each entry is a distinct
 *  model (unique `id` + division-specific `name`) built off the base
 *  format models above. Keyed by the `MOCK_DIVISIONS` ids in
 *  `matchGeniScheduler.ts`. */
export const MOCK_DIVISION_BRACKETS: Record<string, BracketModel[]> = {
  // 1 bracket — single elimination.
  div_1: [{ ...SINGLE, id: 'b_div1_1', name: "Men's 65 Gold" }],
  // 2 brackets — double (Gold) + single (Silver).
  div_2: [
    { ...DOUBLE, id: 'b_div2_1', name: "Men's 65+ Gold" },
    { ...SINGLE, id: 'b_div2_2', name: "Men's 65+ Silver" }
  ],
  // 2 brackets — single (Gold) + 3-game-guarantee (Silver).
  div_3: [
    { ...SINGLE, id: 'b_div3_1', name: "Men's 70/75 Gold" },
    { ...THREE_GG, id: 'b_div3_2', name: "Men's 70/75 Silver" }
  ],
  // 1 bracket — 3-game-guarantee.
  div_4: [{ ...THREE_GG, id: 'b_div4_1', name: "Men's 70 Silver" }],
  // 0 brackets (pool-only division).
  div_5: []
}

/** Same idea keyed by division NAME — used for LIVE resources
 *  divisions whose ids we don't know at build time. Covers the
 *  current event's divisions (50 Major, 55 Gold, 55/60 Platinum,
 *  60 Silver) with a mix of 1- and 2-bracket setups incl. 3-game-
 *  guarantee. Keys are lowercased/trimmed names. */
export const MOCK_DIVISION_BRACKETS_BY_NAME: Record<string, BracketModel[]> = {
  // 2 brackets — single (Gold) + 3-game-guarantee (Silver).
  '50 major': [
    { ...SINGLE, id: 'b_50major_1', name: '50 Major Gold' },
    { ...THREE_GG, id: 'b_50major_2', name: '50 Major Silver' }
  ],
  // 1 bracket — single elimination.
  '55 gold': [{ ...SINGLE, id: 'b_55gold_1', name: '55 Gold' }],
  // 2 brackets — double (Gold) + 3-game-guarantee (Silver).
  '55/60 platinum': [
    { ...DOUBLE, id: 'b_5560plat_1', name: '55/60 Platinum Gold' },
    { ...THREE_GG, id: 'b_5560plat_2', name: '55/60 Platinum Silver' }
  ],
  // 1 bracket — 3-game-guarantee.
  '60 silver': [{ ...THREE_GG, id: 'b_60silver_1', name: '60 Silver' }]
}

function normalizeDivisionName(name: string): string {
  return name.trim().toLowerCase()
}

/** Brackets for a division — by mock id first (mock scheduler
 *  payload), then by name (live resources divisions). `[]` when
 *  neither matches (caller falls back to a format pick). */
export function getMockBracketsForDivision(
  division: { id?: string | null; name?: string | null } | string | null
): BracketModel[] {
  if (!division) return []
  const id = typeof division === 'string' ? division : division.id ?? ''
  const name = typeof division === 'string' ? '' : division.name ?? ''
  if (id && MOCK_DIVISION_BRACKETS[id]) return MOCK_DIVISION_BRACKETS[id]
  if (name) {
    const byName = MOCK_DIVISION_BRACKETS_BY_NAME[normalizeDivisionName(name)]
    if (byName) return byName
  }
  return []
}
