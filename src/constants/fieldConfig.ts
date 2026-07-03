import type { FieldConfigPosition } from '../types'

export const DEFAULT_SLOW_PITCH_FIELD_POSITIONS: FieldConfigPosition[] = [
  { code: 'P', label: 'Pitcher', area: 'battery' },
  { code: 'C', label: 'Catcher', area: 'battery' },
  { code: '1B', label: 'First Base', area: 'infield' },
  { code: '2B', label: 'Second Base', area: 'infield' },
  { code: '3B', label: 'Third Base', area: 'infield' },
  { code: 'SS', label: 'Shortstop', area: 'infield' },
  { code: 'LF', label: 'Left Field', area: 'outfield' },
  { code: 'LC', label: 'Left Center', area: 'outfield' },
  { code: 'CF', label: 'Center Field', area: 'outfield' },
  { code: 'RC', label: 'Right Center', area: 'outfield' },
  { code: 'RF', label: 'Right Field', area: 'outfield' },
  { code: 'EH', label: 'Extra Hitter', area: 'flex' }
]
