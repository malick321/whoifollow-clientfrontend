<script setup lang="ts">
// SendNotificationModal
// ---------------------
// One notification composer for the whole event. The LEFT section's audience
// tabs (Teams / Officials / Umpires) switch the recipient picker; the RIGHT
// section composes the message. History is reached from a button in the
// header (next to Close); there are no Compose/History tabs on the right.
//
//   - HEADER — eyebrow + "Notifications" title + History toggle + Close.
//   - LEFT   — audience tabs, an "All …" master toggle, then the picker:
//       • Teams    — division → pool → team scope picker (scope tokens, lazy
//                    team fetch, sticky headers, pager nav).
//       • Officials / Umpires — a flat selectable roster (all-toggle + rows).
//   - RIGHT  — "To:" summary + Manager-only (teams), category, channels,
//              subject, message — OR the History list.
//
// Recipient model — SCOPE TOKENS, not an enumerated list. "All teams" / "a
// whole division" / "All officials" / "All umpires" are single flags; team
// rosters fetch lazily only when a division is expanded. The send payload is
// a structured `NotificationRecipient[]` spec + an `audienceType`.

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import AppIcon from './AppIcon.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import StatusBadge from './StatusBadge.vue'
import TeamAvatar from './TeamAvatar.vue'
import { pushToast } from '../toast-center'
import { fetchDivisionOverviewStandings } from '../api/divisionOverview'
import { fetchEventOfficials } from '../api/eventOfficials'
import { fetchEventUmpires } from '../api/matchGeniUmpires'
import {
  notificationTemplates,
  sendTeamNotification,
  fetchNotificationHistory
} from '../api/matchGeniNotifications'
import type {
  DivisionStandingEntry,
  NotificationAudienceType,
  NotificationCategory,
  NotificationChannel,
  NotificationRecipient,
  TeamNotification
} from '../types'

/** Minimal division shape the picker needs. `EventTournament` (division
 *  detail) and the dashboard's mapped `MatchGeniDivisionSummary` both
 *  satisfy it structurally. */
export interface NotifyDivision {
  id: string
  guid?: string
  tournamentName: string
  teamCount: number
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Every division in the event — the Teams picker spans all of them. */
  divisions: NotifyDivision[]
  /** The division the modal was opened from — pre-selected in pick mode and
   *  the key the send/History list is stored under. */
  divisionId: string
  /** Pre-loaded teams for the entry division (avoids a refetch on expand). */
  currentTeams?: DivisionStandingEntry[]
  divisionName?: string
  eventName?: string
  associationId?: string
  eventId?: string
  /** Targeted mode — preset recipient scopes (collapses the picker to a
   *  read-only summary unless the admin chooses to edit). */
  presetRecipients?: NotificationRecipient[]
  /** Targeted mode — prefilled message category. */
  presetCategory?: NotificationCategory
  /** Forbid editing the recipients (hide the "Edit recipients" affordance). */
  lockRecipients?: boolean
  /** Compose-only mode — hide the History toggle + view entirely (used by the
   *  dedicated Notifications page, which owns the history listing itself).
   *  After a successful send the modal simply closes. */
  hideHistory?: boolean
}>(), {
  currentTeams: () => [],
  divisionName: '',
  eventName: '',
  associationId: '',
  eventId: '',
  presetRecipients: () => [],
  presetCategory: undefined,
  lockRecipients: false,
  hideHistory: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'sent', notification: TeamNotification): void
}>()

// ── View mode (compose / history) + audience tabs ────────────────
const viewMode = ref<'compose' | 'history'>('compose')
const audienceType = ref<NotificationAudienceType>('teams')
const AUDIENCES: { key: NotificationAudienceType; label: string }[] = [
  { key: 'teams', label: 'Teams' },
  { key: 'officials', label: 'Officials' },
  { key: 'umpires', label: 'Umpires' }
]
function selectAudience(key: NotificationAudienceType) {
  audienceType.value = key
  if (key === 'officials' || key === 'umpires') void ensurePeople(key)
  void nextTick(updateArrows)
}

// ── Division list (ensure the entry division is present) ─────────
const allDivisions = computed<NotifyDivision[]>(() => {
  const list = props.divisions ?? []
  if (!props.divisionId || list.some((d) => d.id === props.divisionId)) return list
  const synthetic = {
    id: props.divisionId,
    guid: '',
    tournamentName: props.divisionName || 'This division',
    teamCount: props.currentTeams.length
  } as NotifyDivision
  return [synthetic, ...list]
})
const totalEventTeams = computed(() =>
  allDivisions.value.reduce((n, d) => n + (d.teamCount || 0), 0)
)

// ── Per-division team cache + lazy loading (cherry-pick only) ────
const teamsByDivision = ref<Record<string, DivisionStandingEntry[]>>({})
const loadingDivisions = ref<Set<string>>(new Set())
const expanded = ref<Set<string>>(new Set())

function fallbackTeams(div: NotifyDivision): DivisionStandingEntry[] {
  const count = Math.max(0, div.teamCount || 0)
  const cities = ['Austin', 'Dallas', 'Reno', 'Tampa', 'Mesa', 'Boise']
  const nicknames = ['Hawks', 'Bandits', 'Storm', 'Rangers', 'Aces', 'Lions']
  return Array.from({ length: count }, (_, i) => ({
    seed: i + 1,
    wins: 0,
    losses: 0,
    teamName: `${cities[i % cities.length]} ${nicknames[Math.floor(i / cities.length) % nicknames.length]} ${i + 1}`,
    teamMeta: '',
    location: '',
    poolId: `${div.id}-pool-${(i % 2) + 1}`,
    poolName: `Pool ${(i % 2) + 1}`
  }))
}

async function ensureTeams(div: NotifyDivision): Promise<DivisionStandingEntry[]> {
  const existing = teamsByDivision.value[div.id]
  if (existing) return existing
  loadingDivisions.value = new Set(loadingDivisions.value).add(div.id)
  let teams: DivisionStandingEntry[] = []
  try {
    if (div.guid) teams = (await fetchDivisionOverviewStandings(div.guid)).standings ?? []
  } catch {
    teams = []
  }
  if (teams.length === 0) teams = fallbackTeams(div)
  teamsByDivision.value = { ...teamsByDivision.value, [div.id]: teams }
  const next = new Set(loadingDivisions.value)
  next.delete(div.id)
  loadingDivisions.value = next
  return teams
}

function isExpanded(divId: string) { return expanded.value.has(divId) }
function toggleExpand(div: NotifyDivision) {
  search.value = ''
  if (expanded.value.has(div.id)) {
    expanded.value = new Set()
  } else {
    expanded.value = new Set([div.id])
    void ensureTeams(div)
    void nextTick(() => scrollDivisionToTop(div.id))
  }
}
function scrollDivisionToTop(divId: string) {
  const el = listRef.value
  const item = el?.querySelector<HTMLElement>(`[data-div-id="${divId}"]`)
  if (!el || !item) return
  const delta = item.getBoundingClientRect().top - el.getBoundingClientRect().top
  el.scrollTo({ top: el.scrollTop + delta, behavior: 'smooth' })
  void nextTick(updateArrows)
}

// ── Teams selection model ────────────────────────────────────────
interface DivSel { all: boolean; teams: Set<string> }
const allEvent = ref(false)
const divSel = ref<Record<string, DivSel>>({})

function cloneSel(divId: string): DivSel {
  const s = divSel.value[divId]
  return s ? { all: s.all, teams: new Set(s.teams) } : { all: false, teams: new Set() }
}
function setSel(divId: string, sel: DivSel | null) {
  const next = { ...divSel.value }
  if (!sel || (!sel.all && sel.teams.size === 0)) delete next[divId]
  else next[divId] = sel
  divSel.value = next
}

type DivState = 'all' | 'partial' | 'none'
function divState(div: NotifyDivision): DivState {
  if (allEvent.value) return 'all'
  const sel = divSel.value[div.id]
  if (!sel) return 'none'
  if (sel.all) return 'all'
  if (sel.teams.size === 0) return 'none'
  const loaded = teamsByDivision.value[div.id]
  if (loaded && loaded.length > 0) {
    const uniqueNames = new Set(loaded.map((t) => t.teamName))
    if (sel.teams.size >= uniqueNames.size) return 'all'
  }
  return 'partial'
}
const teamsEditingDisabled = computed(() => allEvent.value)

function toggleDivision(div: NotifyDivision) {
  if (teamsEditingDisabled.value) return
  if (divState(div) === 'none') setSel(div.id, { all: true, teams: new Set() })
  else setSel(div.id, null)
}
function teamChecked(div: NotifyDivision, teamName: string): boolean {
  if (allEvent.value) return true
  const sel = divSel.value[div.id]
  if (!sel) return false
  return sel.all || sel.teams.has(teamName)
}
async function toggleTeam(div: NotifyDivision, teamName: string) {
  if (teamsEditingDisabled.value) return
  const teams = await ensureTeams(div)
  const sel = cloneSel(div.id)
  if (sel.all) { sel.all = false; sel.teams = new Set(teams.map((t) => t.teamName)) }
  if (sel.teams.has(teamName)) sel.teams.delete(teamName)
  else sel.teams.add(teamName)
  setSel(div.id, sel)
}
async function togglePool(div: NotifyDivision, group: PoolGroup, on: boolean) {
  if (teamsEditingDisabled.value) return
  const teams = await ensureTeams(div)
  const sel = cloneSel(div.id)
  if (sel.all) { sel.all = false; sel.teams = new Set(teams.map((t) => t.teamName)) }
  for (const t of group.teams) { if (on) sel.teams.add(t.teamName); else sel.teams.delete(t.teamName) }
  setSel(div.id, sel)
}
function divisionSelectedCount(div: NotifyDivision): number {
  if (allEvent.value) return div.teamCount || 0
  const sel = divSel.value[div.id]
  if (!sel) return 0
  return sel.all ? (div.teamCount || 0) : sel.teams.size
}
function toggleAllTeams(on: boolean) {
  allEvent.value = on
  if (on) { divSel.value = {}; expanded.value = new Set() }
}

// Per-division team search (one division open at a time).
const search = ref('')
function visibleTeams(div: NotifyDivision): DivisionStandingEntry[] {
  const teams = teamsByDivision.value[div.id] ?? []
  const q = search.value.trim().toLowerCase()
  return q ? teams.filter((t) => t.teamName.toLowerCase().includes(q)) : teams
}
interface PoolGroup { key: string; label: string; teams: DivisionStandingEntry[] }
function poolGroups(div: NotifyDivision): PoolGroup[] {
  const map = new Map<string, PoolGroup>()
  for (const team of visibleTeams(div)) {
    const key = team.poolId || team.poolName || '__ungrouped'
    if (!map.has(key)) {
      map.set(key, { key, label: team.poolName || (team.poolId ? `Pool ${team.poolId}` : 'Teams'), teams: [] })
    }
    map.get(key)!.teams.push(team)
  }
  return Array.from(map.values())
}
function poolAllSelected(div: NotifyDivision, group: PoolGroup): boolean {
  return group.teams.length > 0 && group.teams.every((t) => teamChecked(div, t.teamName))
}

// ── Officials / Umpires roster (flat selectable lists) ───────────
interface NotifyPerson { id: string; name: string; email: string; avatarUrl?: string }
const officials = ref<NotifyPerson[]>([])
const umpires = ref<NotifyPerson[]>([])
const officialsLoaded = ref(false)
const umpiresLoaded = ref(false)
const peopleLoading = ref(false)
const allOfficials = ref(false)
const allUmpires = ref(false)
const selectedOfficials = ref<Set<string>>(new Set())
const selectedUmpires = ref<Set<string>>(new Set())

function fallbackPeople(kind: 'officials' | 'umpires'): NotifyPerson[] {
  const names = kind === 'officials'
    ? ['Pat Lee', 'Sam Ortiz', 'Dana Kim', 'Jordan Fox']
    : ['Chris Park', 'Robin Vale', 'Alex Day', 'Morgan Reed', 'Lee Cruz']
  return names.map((name, i) => ({
    id: `${kind}-${i + 1}`,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`
  }))
}
async function ensurePeople(kind: 'officials' | 'umpires') {
  if (kind === 'officials' && officialsLoaded.value) return
  if (kind === 'umpires' && umpiresLoaded.value) return
  peopleLoading.value = true
  try {
    if (kind === 'officials') {
      let list: NotifyPerson[] = []
      try {
        const res = await fetchEventOfficials(props.associationId, props.eventId, {})
        list = (res.data ?? []).map((o) => ({ id: o.id, name: o.name, email: o.email, avatarUrl: o.avatarUrl }))
      } catch { list = [] }
      if (list.length === 0) list = fallbackPeople('officials')
      officials.value = list
      officialsLoaded.value = true
    } else {
      let list: NotifyPerson[] = []
      try {
        const res = await fetchEventUmpires(props.associationId, props.eventId, {})
        list = (res.data ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl }))
      } catch { list = [] }
      if (list.length === 0) list = fallbackPeople('umpires')
      umpires.value = list
      umpiresLoaded.value = true
    }
  } finally {
    peopleLoading.value = false
    void nextTick(updateArrows)
  }
}

const activePeople = computed<NotifyPerson[]>(() =>
  audienceType.value === 'officials' ? officials.value : umpires.value
)
const activeAllFlag = computed(() => audienceType.value === 'officials' ? allOfficials.value : allUmpires.value)
const activeSelected = computed(() => audienceType.value === 'officials' ? selectedOfficials.value : selectedUmpires.value)
function personChecked(id: string) { return activeAllFlag.value || activeSelected.value.has(id) }
function togglePerson(id: string) {
  if (activeAllFlag.value) return
  const set = audienceType.value === 'officials' ? selectedOfficials : selectedUmpires
  const next = new Set(set.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  set.value = next
}

// ── "All …" master toggle (audience-aware) ───────────────────────
const allLabel = computed(() => {
  if (audienceType.value === 'teams') return { title: 'All teams', sub: `Everyone in the event (${totalEventTeams.value})` }
  if (audienceType.value === 'officials') return { title: 'All officials', sub: `Everyone on the roster (${officials.value.length})` }
  return { title: 'All umpires', sub: `Everyone on the roster (${umpires.value.length})` }
})
const allActive = computed({
  get() {
    if (audienceType.value === 'teams') return allEvent.value
    return audienceType.value === 'officials' ? allOfficials.value : allUmpires.value
  },
  set(on: boolean) {
    if (audienceType.value === 'teams') { toggleAllTeams(on); return }
    if (audienceType.value === 'officials') { allOfficials.value = on; if (on) selectedOfficials.value = new Set() }
    else { allUmpires.value = on; if (on) selectedUmpires.value = new Set() }
  }
})
const peopleEditingDisabled = computed(() => activeAllFlag.value)

// ── Scroll-nav (up/down, hidden scrollbar) ───────────────────────
const listRef = ref<HTMLElement | null>(null)
const canUp = ref(false)
const canDown = ref(false)
const listScrolled = ref(false)
function updateArrows() {
  const el = listRef.value
  if (!el) { canUp.value = false; canDown.value = false; listScrolled.value = false; return }
  canUp.value = el.scrollTop > 2
  canDown.value = el.scrollTop < el.scrollHeight - el.clientHeight - 2
  listScrolled.value = el.scrollTop > 1
}
function stepList(dir: 1 | -1) {
  const el = listRef.value
  if (!el) return
  el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'smooth' })
}
let listRo: ResizeObserver | null = null
watch(listRef, (el) => {
  listRo?.disconnect()
  if (el && typeof ResizeObserver !== 'undefined') {
    listRo = new ResizeObserver(() => updateArrows())
    listRo.observe(el)
    void nextTick(updateArrows)
  }
})
onBeforeUnmount(() => listRo?.disconnect())
watch([expanded, divSel, search, teamsByDivision, allEvent, audienceType, selectedOfficials, selectedUmpires, officials, umpires],
  () => void nextTick(updateArrows), { deep: true })

// ── Recipients (structured payload) + chips (grouped summary) ────
const recipients = computed<NotificationRecipient[]>(() => {
  if (audienceType.value === 'teams') {
    if (allEvent.value) return [{ kind: 'all_event', label: 'All teams', count: totalEventTeams.value }]
    const out: NotificationRecipient[] = []
    for (const div of allDivisions.value) {
      const sel = divSel.value[div.id]
      if (!sel) continue
      if (sel.all) out.push({ kind: 'division', label: div.tournamentName, divisionId: div.id, count: div.teamCount || 0 })
      else for (const name of sel.teams) out.push({ kind: 'team', label: name, divisionId: div.id, teamName: name, count: 1 })
    }
    return out
  }
  if (audienceType.value === 'officials') {
    if (allOfficials.value) return [{ kind: 'all_officials', label: 'All officials', count: officials.value.length }]
    return officials.value.filter((o) => selectedOfficials.value.has(o.id))
      .map((o) => ({ kind: 'official', label: o.name, personId: o.id, count: 1 }))
  }
  if (allUmpires.value) return [{ kind: 'all_umpires', label: 'All umpires', count: umpires.value.length }]
  return umpires.value.filter((u) => selectedUmpires.value.has(u.id))
    .map((u) => ({ kind: 'umpire', label: u.name, personId: u.id, count: 1 }))
})
const selectedTotal = computed(() => {
  if (audienceType.value === 'teams') {
    if (allEvent.value) return totalEventTeams.value
    return allDivisions.value.reduce((n, d) => n + divisionSelectedCount(d), 0)
  }
  if (audienceType.value === 'officials') return allOfficials.value ? officials.value.length : selectedOfficials.value.size
  return allUmpires.value ? umpires.value.length : selectedUmpires.value.size
})

interface Chip { key: string; label: string }
const chips = computed<Chip[]>(() => {
  if (audienceType.value === 'teams') {
    if (allEvent.value) return [{ key: '__all', label: 'All teams' }]
    const out: Chip[] = []
    for (const div of allDivisions.value) {
      const sel = divSel.value[div.id]
      if (!sel) continue
      if (sel.all) out.push({ key: div.id, label: div.tournamentName })
      else out.push({ key: div.id, label: `${div.tournamentName} · ${sel.teams.size} ${sel.teams.size === 1 ? 'team' : 'teams'}` })
    }
    return out
  }
  if (audienceType.value === 'officials') {
    if (allOfficials.value) return [{ key: '__allo', label: 'All officials' }]
    return officials.value.filter((o) => selectedOfficials.value.has(o.id)).map((o) => ({ key: o.id, label: o.name }))
  }
  if (allUmpires.value) return [{ key: '__allu', label: 'All umpires' }]
  return umpires.value.filter((u) => selectedUmpires.value.has(u.id)).map((u) => ({ key: u.id, label: u.name }))
})
function removeChip(key: string) {
  if (recipientsLocked.value) return
  if (audienceType.value === 'teams') {
    if (key === '__all') allEvent.value = false
    else setSel(key, null)
  } else if (audienceType.value === 'officials') {
    if (key === '__allo') allOfficials.value = false
    else { const n = new Set(selectedOfficials.value); n.delete(key); selectedOfficials.value = n }
  } else {
    if (key === '__allu') allUmpires.value = false
    else { const n = new Set(selectedUmpires.value); n.delete(key); selectedUmpires.value = n }
  }
}

// ── Picker open / targeted mode ──────────────────────────────────
const pickerOpen = ref(true)
const recipientsLocked = computed(() => props.lockRecipients)
const hasPreset = computed(() => (props.presetRecipients?.length ?? 0) > 0)

function applyPreset(presets: NotificationRecipient[]) {
  allEvent.value = false
  divSel.value = {}
  for (const r of presets) {
    if (r.kind === 'all_event') { allEvent.value = true; divSel.value = {}; return }
    if (!r.divisionId) continue
    if (r.kind === 'division') setSel(r.divisionId, { all: true, teams: new Set() })
    else if (r.kind === 'team' && r.teamName) {
      const sel = cloneSel(r.divisionId)
      if (!sel.all) sel.teams.add(r.teamName)
      setSel(r.divisionId, sel)
    }
  }
}

// ── Compose ──────────────────────────────────────────────────────
const templates = notificationTemplates()
const category = ref<NotificationCategory>('custom')
const audienceManagerOnly = ref(false)
const channelInApp = ref(true)
const channelEmail = ref(false)
const subject = ref('')
const body = ref('')
const attempted = ref(false)
const sending = ref(false)

function fillTokens(text: string): string {
  return text
    .replace(/\{divisionName\}/g, props.divisionName || 'your division')
    .replace(/\{eventName\}/g, props.eventName || 'the event')
}
function applyCategory(cat: NotificationCategory) {
  category.value = cat
  const tpl = templates.find((t) => t.category === cat)
  if (!tpl) return
  subject.value = fillTokens(tpl.subject)
  body.value = fillTokens(tpl.body)
  const emailDefault = cat === 'payment_reminder' || cat === 'registration_reminder'
  channelEmail.value = emailDefault
  channelInApp.value = true
}
function onCategoryChange() { applyCategory(category.value) }

const channels = computed<NotificationChannel[]>(() => {
  const list: NotificationChannel[] = []
  if (channelInApp.value) list.push('in_app')
  if (channelEmail.value) list.push('email')
  return list
})
const canSend = computed(
  () => selectedTotal.value > 0 && subject.value.trim().length > 0 && channels.value.length > 0
)

// ── History ──────────────────────────────────────────────────────
const history = ref<TeamNotification[]>([])
const historyLoading = ref(false)
async function loadHistory() {
  historyLoading.value = true
  try { history.value = await fetchNotificationHistory(props.divisionId) }
  finally { historyLoading.value = false }
}
function toggleHistory() {
  viewMode.value = viewMode.value === 'history' ? 'compose' : 'history'
}

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  result: 'Result', schedule_change: 'Schedule', custom: 'Message',
  payment_reminder: 'Payment', registration_reminder: 'Registration', promotion: 'Promotion'
}
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
const CATEGORY_TONE: Record<NotificationCategory, BadgeTone> = {
  result: 'success', schedule_change: 'warning', custom: 'neutral',
  payment_reminder: 'danger', registration_reminder: 'info', promotion: 'secondary'
}
const AUDIENCE_LABEL: Record<NotificationAudienceType, string> = {
  teams: 'Teams', officials: 'Officials', umpires: 'Umpires'
}
function channelsLabel(list: NotificationChannel[]): string {
  return list.map((c) => (c === 'in_app' ? 'In-app' : 'Email')).join(' · ')
}
function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Send ─────────────────────────────────────────────────────────
async function send() {
  attempted.value = true
  if (!canSend.value || sending.value) return
  sending.value = true
  try {
    const record = await sendTeamNotification(props.associationId, props.eventId, props.divisionId, {
      audienceType: audienceType.value,
      category: category.value,
      audience: audienceType.value === 'teams' && audienceManagerOnly.value ? 'manager' : 'team',
      channels: channels.value,
      subject: subject.value,
      body: body.value,
      recipients: recipients.value
    })
    pushToast({ tone: 'success', title: 'Notification sent', message: `Sent to ${record.recipientSummary.toLowerCase()}.` })
    emit('sent', record)
    if (props.hideHistory) {
      // Compose-only mode (dedicated Notifications page) — the page owns the
      // history listing, so just close and let it refresh.
      close()
    } else {
      await loadHistory()
      viewMode.value = 'history'
    }
  } catch {
    pushToast({ tone: 'warning', title: 'Could not send', message: 'Please try again.' })
  } finally {
    sending.value = false
  }
}
function close() { emit('update:modelValue', false) }

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    viewMode.value = 'compose'
    audienceType.value = 'teams'
    attempted.value = false
    sending.value = false
    search.value = ''
    audienceManagerOnly.value = false
    channelInApp.value = true
    channelEmail.value = false
    subject.value = ''
    body.value = ''

    // Teams cache seed.
    const seeded: Record<string, DivisionStandingEntry[]> = {}
    if (props.currentTeams.length) seeded[props.divisionId] = props.currentTeams
    teamsByDivision.value = seeded
    loadingDivisions.value = new Set()

    // People — reset (lazy-loaded on first tab visit).
    officials.value = []; umpires.value = []
    officialsLoaded.value = false; umpiresLoaded.value = false
    allOfficials.value = false; allUmpires.value = false
    selectedOfficials.value = new Set(); selectedUmpires.value = new Set()

    if (hasPreset.value) {
      applyPreset(props.presetRecipients)
      pickerOpen.value = false
      expanded.value = new Set()
    } else {
      allEvent.value = false
      const hasEntry = !!props.divisionId && allDivisions.value.some((d) => d.id === props.divisionId)
      divSel.value = hasEntry ? { [props.divisionId]: { all: true, teams: new Set() } } : {}
      pickerOpen.value = true
      expanded.value = new Set()
    }

    category.value = props.presetCategory ?? 'custom'
    applyCategory(category.value)

    void loadHistory()
    void nextTick(updateArrows)
  }
)
watch(viewMode, (value) => { if (value === 'history') void loadHistory() })
watch(pickerOpen, (open) => { if (open) void nextTick(updateArrows) })
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Notifications"
    size="wide"
    hide-header
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <div class="notify">
      <!-- Full-width header -->
      <div class="notify__header">
        <div class="notify__titles">
          <span v-if="eventName" class="notify__eyebrow">{{ eventName }}</span>
          <h2 class="notify__title">{{ hideHistory ? 'New Notification' : 'Notifications' }}</h2>
        </div>
        <div class="notify__header-actions">
          <button
            v-if="!hideHistory"
            type="button"
            class="notify__hist-btn"
            :class="{ 'notify__hist-btn--active': viewMode === 'history' }"
            :aria-pressed="viewMode === 'history'"
            @click="toggleHistory"
          >History</button>
          <button type="button" class="notify__close" aria-label="Close" :disabled="sending" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </div>
      </div>

      <!-- Two columns -->
      <div class="notify__cols" :class="{ 'notify__cols--picker': viewMode === 'compose' && pickerOpen }">
        <!-- LEFT — audience tabs + recipient picker -->
        <aside v-if="viewMode === 'compose' && pickerOpen" class="notify__recipients">
          <!-- Audience tabs -->
          <div class="notify__aud" role="tablist" aria-label="Recipient type">
            <button
              v-for="a in AUDIENCES"
              :key="a.key"
              type="button"
              class="notify__aud-tab"
              :class="{ 'notify__aud-tab--active': audienceType === a.key }"
              role="tab"
              :aria-selected="audienceType === a.key"
              @click="selectAudience(a.key)"
            >{{ a.label }}</button>
          </div>

          <!-- All-… master toggle -->
          <div class="notify__rec-allrow">
            <span class="notify__rec-allcopy">
              <span class="notify__rec-alltitle">{{ allLabel.title }}</span>
              <span class="notify__rec-allsub">{{ allLabel.sub }}</span>
            </span>
            <ToggleSwitch v-model="allActive" :aria-label="allLabel.title" />
          </div>

          <!-- Up nav -->
          <button v-show="canUp" type="button" class="notify__nav notify__nav--up" aria-label="Scroll up" @click="stepList(-1)">
            <svg class="notify__nav-chev notify__nav-chev--up" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <div ref="listRef" class="notify__list" :class="{ 'notify__list--scrolled': listScrolled }" @scroll="updateArrows">
            <!-- ── Teams ── -->
            <template v-if="audienceType === 'teams'">
              <div
                v-for="div in allDivisions"
                :key="div.id"
                class="notify__div"
                :data-div-id="div.id"
              >
                <div class="notify__div-head" :class="{ 'notify__div-head--stick': isExpanded(div.id) }">
                  <button
                    type="button"
                    class="notify__check"
                    :class="`notify__check--${divState(div)}`"
                    :disabled="teamsEditingDisabled"
                    role="checkbox"
                    :aria-checked="divState(div) === 'all' ? 'true' : divState(div) === 'partial' ? 'mixed' : 'false'"
                    :aria-label="`Select all teams in ${div.tournamentName}`"
                    @click="toggleDivision(div)"
                  ></button>
                  <button
                    type="button"
                    class="notify__div-toggle"
                    :aria-expanded="isExpanded(div.id)"
                    @click="toggleExpand(div)"
                  >
                    <span class="notify__div-name">{{ div.tournamentName }}</span>
                    <span class="notify__div-meta">
                      <span v-if="divisionSelectedCount(div) > 0" class="notify__div-badge">{{ divisionSelectedCount(div) }}</span>
                      <span class="notify__div-total">{{ div.teamCount || 0 }} teams</span>
                      <svg class="notify__div-caret" :class="{ 'notify__div-caret--open': isExpanded(div.id) }" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                  </button>
                </div>

                <div v-if="isExpanded(div.id)" class="notify__div-body">
                  <div class="notify__teamsearch">
                    <span v-if="loadingDivisions.has(div.id)" class="shimmer-block notify__search-skeleton"></span>
                    <label v-else class="notify__search">
                      <AppIcon name="search" :size="14" />
                      <input
                        v-model="search"
                        type="search"
                        class="notify__search-input"
                        :placeholder="`Search teams in ${div.tournamentName}`"
                        aria-label="Search teams in this division"
                      />
                    </label>
                  </div>
                  <div v-if="loadingDivisions.has(div.id)" class="notify__skeleton" aria-busy="true">
                    <div v-for="n in 5" :key="n" class="notify__skeleton-row">
                      <span class="shimmer-circle notify__skeleton-avatar"></span>
                      <span class="shimmer-block notify__skeleton-bar"></span>
                    </div>
                  </div>
                  <template v-else>
                    <div v-for="group in poolGroups(div)" :key="group.key" class="notify__pool">
                      <div class="notify__pool-head">
                        <span class="notify__pool-name">{{ group.label }}</span>
                        <button
                          type="button"
                          class="notify__pool-all"
                          :disabled="teamsEditingDisabled"
                          @click="togglePool(div, group, !poolAllSelected(div, group))"
                        >{{ poolAllSelected(div, group) ? 'Clear' : 'Select all' }}</button>
                      </div>
                      <button
                        v-for="team in group.teams"
                        :key="team.teamName"
                        type="button"
                        class="notify__team"
                        :class="{ 'notify__team--on': teamChecked(div, team.teamName) }"
                        :disabled="teamsEditingDisabled"
                        role="checkbox"
                        :aria-checked="teamChecked(div, team.teamName)"
                        @click="toggleTeam(div, team.teamName)"
                      >
                        <span class="notify__check notify__check--sm" :class="{ 'notify__check--all': teamChecked(div, team.teamName) }" aria-hidden="true"></span>
                        <TeamAvatar :name="team.teamName" :image-url="team.imageUrl" size="sm" />
                        <span class="notify__team-name">{{ team.teamName }}</span>
                      </button>
                    </div>
                    <p v-if="poolGroups(div).length === 0" class="notify__muted notify__muted--sm">
                      {{ search.trim() ? 'No matching teams.' : 'No teams in this division yet.' }}
                    </p>
                  </template>
                </div>
              </div>
            </template>

            <!-- ── Officials / Umpires (flat roster) ── -->
            <template v-else>
              <div v-if="peopleLoading" class="notify__skeleton" aria-busy="true">
                <div v-for="n in 6" :key="n" class="notify__skeleton-row">
                  <span class="shimmer-circle notify__skeleton-avatar"></span>
                  <span class="shimmer-block notify__skeleton-bar"></span>
                </div>
              </div>
              <template v-else>
                <button
                  v-for="person in activePeople"
                  :key="person.id"
                  type="button"
                  class="notify__team notify__person"
                  :class="{ 'notify__team--on': personChecked(person.id) }"
                  :disabled="peopleEditingDisabled"
                  role="checkbox"
                  :aria-checked="personChecked(person.id)"
                  @click="togglePerson(person.id)"
                >
                  <span class="notify__check notify__check--sm" :class="{ 'notify__check--all': personChecked(person.id) }" aria-hidden="true"></span>
                  <TeamAvatar :name="person.name" :image-url="person.avatarUrl" size="sm" />
                  <span class="notify__person-copy">
                    <span class="notify__team-name">{{ person.name }}</span>
                    <span class="notify__person-email">{{ person.email }}</span>
                  </span>
                </button>
                <p v-if="activePeople.length === 0" class="notify__muted notify__muted--sm">
                  No {{ audienceType }} on the roster yet.
                </p>
              </template>
            </template>
          </div>

          <!-- Down nav -->
          <button v-show="canDown" type="button" class="notify__nav notify__nav--down" aria-label="Scroll down" @click="stepList(1)">
            <svg class="notify__nav-chev notify__nav-chev--down" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </aside>

        <!-- RIGHT — compose / history -->
        <div class="notify__main">
          <!-- Compose -->
          <div v-if="viewMode === 'compose'" class="notify__compose">
            <!-- "To:" summary + Manager-only (teams only) -->
            <div class="notify__to">
              <div class="notify__to-head">
                <span class="notify__to-label">To</span>
                <span class="notify__to-count">{{ selectedTotal }} {{ audienceType === 'teams' ? (selectedTotal === 1 ? 'team' : 'teams') : (selectedTotal === 1 ? 'recipient' : 'recipients') }}</span>
                <button v-if="!pickerOpen && !recipientsLocked" type="button" class="notify__to-edit" @click="pickerOpen = true">Edit recipients</button>
                <button v-else-if="pickerOpen && hasPreset" type="button" class="notify__to-edit" @click="pickerOpen = false">Done</button>
                <span class="notify__to-spacer"></span>
                <label v-if="audienceType === 'teams'" class="notify__to-mgr">
                  <span class="notify__toggle-label">Manager only</span>
                  <ToggleSwitch v-model="audienceManagerOnly" aria-label="Manager only" />
                </label>
              </div>
              <div v-if="chips.length" class="notify__chips">
                <span v-for="chip in chips" :key="chip.key" class="notify__chip">
                  {{ chip.label }}
                  <button v-if="!recipientsLocked" type="button" class="notify__chip-x" :aria-label="`Remove ${chip.label}`" @click="removeChip(chip.key)">
                    <AppIcon name="close" :size="11" />
                  </button>
                </span>
              </div>
              <p v-else class="notify__to-empty">No recipients selected.</p>
            </div>

            <div class="floating-input">
              <select
                id="notify-category"
                v-model="category"
                class="floating-input__control floating-input__control--select floating-input__control--has-value"
                @change="onCategoryChange"
              >
                <option v-for="t in templates" :key="t.category" :value="t.category">{{ t.label }}</option>
              </select>
              <label for="notify-category" class="floating-input__label floating-input__label--floated">Category</label>
            </div>

            <div class="notify__channels">
              <button
                type="button"
                class="notify__chtile"
                :class="{ 'notify__chtile--active': channelInApp }"
                :aria-pressed="channelInApp"
                @click="channelInApp = !channelInApp"
              >
                <span class="notify__chtile-label">In-app</span>
                <span class="notify__chtile-hint">Sends in-app notification</span>
              </button>
              <button
                type="button"
                class="notify__chtile"
                :class="{ 'notify__chtile--active': channelEmail }"
                :aria-pressed="channelEmail"
                @click="channelEmail = !channelEmail"
              >
                <span class="notify__chtile-label">Email</span>
                <span class="notify__chtile-hint">Sends an email</span>
              </button>
            </div>
            <p v-if="attempted && channels.length === 0" class="notify__error">Pick at least one channel.</p>

            <div class="floating-input" :class="{ 'floating-input--invalid': attempted && !subject.trim() }">
              <input id="notify-subject" v-model="subject" type="text" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!subject }" placeholder=" " />
              <label for="notify-subject" class="floating-input__label">Subject</label>
              <span v-if="attempted && !subject.trim()" class="floating-input__error-corner">Required</span>
            </div>

            <div class="floating-input">
              <textarea id="notify-body" v-model="body" class="floating-input__control notify__textarea" :class="{ 'floating-input__control--has-value': !!body }" rows="6" placeholder=" "></textarea>
              <label for="notify-body" class="floating-input__label">Message</label>
            </div>
          </div>

          <!-- History -->
          <div v-else class="notify__history">
            <p v-if="historyLoading" class="notify__muted">Loading…</p>
            <div v-else-if="history.length === 0" class="app-banner app-banner--primary">
              <div class="app-banner__text">
                <span class="app-banner__sub">No notifications sent yet.</span>
              </div>
            </div>
            <ul v-else class="notify__hist-list">
              <li v-for="n in history" :key="n.id" class="notify__hist-item">
                <div class="notify__hist-top">
                  <StatusBadge :label="CATEGORY_LABEL[n.category]" :tone="CATEGORY_TONE[n.category]" />
                  <span class="notify__hist-time">{{ relativeTime(n.createdAt) }}</span>
                </div>
                <p class="notify__hist-subject">{{ n.subject }}</p>
                <p v-if="n.body" class="notify__hist-body">{{ n.body }}</p>
                <p class="notify__hist-meta">
                  {{ AUDIENCE_LABEL[n.audienceType] }}
                  · {{ channelsLabel(n.channels) }}
                  · {{ n.recipientSummary }}
                </p>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" class="secondary-button" @click="close">Close</button>
      <span class="notify__foot-spacer"></span>
      <button
        v-if="viewMode === 'compose'"
        type="button"
        class="primary-button notify__send"
        :disabled="!canSend || sending"
        @click="send"
      >
        <span v-if="sending" class="btn-spinner" aria-hidden="true"></span>
        {{ sending ? 'Sending…' : 'Send Notification' }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.notify { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; }

/* Full-width header */
.notify__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.notify__titles { min-width: 0; }
.notify__eyebrow { display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notify__title { margin: 2px 0 0; font-size: 18px; font-weight: 600; color: var(--text); }
.notify__header-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.notify__hist-btn { appearance: none; height: 32px; padding: 0 14px; border: 1px solid var(--border-divider); border-radius: 999px; background: var(--white, #fff); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; }
html.dark-mode .notify__hist-btn { background: var(--surface-card); }
.notify__hist-btn:hover:not(.notify__hist-btn--active) { background: rgba(45, 140, 240, 0.06); }
.notify__hist-btn--active { background: var(--primary, #2d8cf0); border-color: var(--primary, #2d8cf0); color: #fff; }
html.dark-mode .notify__hist-btn--active { background: var(--surface-card); border-color: var(--primary); color: var(--primary); }
.notify__close { flex: 0 0 auto; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--border-divider); border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; }
.notify__close:hover { background: var(--surface-hover, rgba(0, 0, 0, 0.04)); }

/* Two columns */
.notify__cols { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; align-items: stretch; flex: 1 1 auto; min-height: 0; }
.notify__cols--picker { grid-template-columns: 320px minmax(0, 1fr); }
@media (max-width: 720px) { .notify__cols--picker { grid-template-columns: minmax(0, 1fr); } }

/* ── Recipients (left) — soft neutral surface card. ── */
.notify__recipients { display: flex; flex-direction: column; gap: 0; min-height: 0; background: #f4f5f7; border: 1px solid #e4e7ec; border-radius: 10px; padding: 0; align-self: stretch; overflow: hidden; }
html.dark-mode .notify__recipients { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12); }

/* Audience tabs — finalized MatchGeni pill-tab look (`.mg-div-detail__tab`). */
.notify__aud { display: flex; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border-divider); background: var(--white, #fff); flex: 0 0 auto; }
html.dark-mode .notify__aud { background: var(--surface-card); }
.notify__aud-tab { appearance: none; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; padding: 0 16px; min-height: 32px; background: var(--white, #fff); border: 1px solid var(--border-divider); border-radius: 999px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500; transition: background 120ms ease, border-color 120ms ease, color 120ms ease; }
.notify__aud-tab:hover:not(.notify__aud-tab--active) { background: rgba(45, 140, 240, 0.06); }
.notify__aud-tab--active { background: var(--primary, #2d8cf0); border-color: var(--primary, #2d8cf0); color: #fff; }
html.dark-mode .notify__aud-tab { background: var(--surface-card); }
html.dark-mode .notify__aud-tab--active { background: var(--surface-card); border-color: var(--primary); color: var(--primary); }

.notify__rec-allrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border-divider); background: var(--white, #fff); flex: 0 0 auto; }
html.dark-mode .notify__rec-allrow { background: var(--surface-card); }
.notify__rec-allcopy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.notify__rec-alltitle { font-size: 14px; font-weight: 600; color: var(--text); }
.notify__rec-allsub { font-size: 12px; color: var(--text-muted); }

.notify__nav { display: flex; align-items: center; justify-content: center; width: 100%; height: 24px; border: none; background: var(--white, #fff); color: var(--text-muted); cursor: pointer; flex: 0 0 auto; }
html.dark-mode .notify__nav { background: var(--surface-card); }
.notify__nav:hover { background: var(--primary-light-3, #e5f1ff); color: var(--primary); }
html.dark-mode .notify__nav:hover { background: rgba(45, 140, 240, 0.12); }
.notify__nav-chev--up { transform: rotate(-90deg); }
.notify__nav-chev--down { transform: rotate(90deg); }

.notify__list { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; padding: 0 0 6px; }
.notify__list::-webkit-scrollbar { display: none; }

.notify__div { border-bottom: 1px solid var(--border-divider); }
.notify__div:last-child { border-bottom: none; }
.notify__div-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; min-height: 40px; box-sizing: border-box; }
.notify__div-head--stick { position: sticky; top: 0; z-index: 4; background: var(--white, #fff); }
html.dark-mode .notify__div-head--stick { background: var(--surface-card); }
.notify__div-toggle { appearance: none; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; flex: 1 1 auto; padding: 2px; color: var(--text); }
.notify__div-name { font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notify__div-meta { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.notify__div-total { font-size: 12px; color: var(--text-muted); }
.notify__div-badge { font-size: 11px; font-weight: 700; line-height: 1; padding: 3px 7px; border-radius: 999px; background: var(--primary-light-3, #e5f1ff); color: var(--primary); }
html.dark-mode .notify__div-badge { background: rgba(45, 140, 240, 0.16); }
.notify__div-caret { flex: 0 0 auto; color: var(--text-muted); transition: transform 120ms ease; }
.notify__div-caret--open { transform: rotate(90deg); }

.notify__div-body { padding: 2px 14px 8px 32px; }

.notify__teamsearch { position: sticky; top: 40px; z-index: 3; margin: 0 -14px 0 -32px; padding: 6px 14px; background: var(--white, #fff); }
html.dark-mode .notify__teamsearch { background: var(--surface-card); }
.notify__search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid var(--border-divider); border-radius: 5px; background: var(--white, #fff); color: var(--secondary); }
html.dark-mode .notify__search { background: rgba(255, 255, 255, 0.04); }
.notify__search-input { flex: 1 1 auto; min-width: 0; border: none; background: transparent; font: inherit; font-size: 13px; color: var(--text); outline: none; }
.notify__search-skeleton { display: block; width: 100%; height: 36px; border-radius: 5px; }

.notify__skeleton { display: flex; flex-direction: column; gap: 2px; padding: 4px 14px 0; }
.notify__skeleton-row { display: flex; align-items: center; gap: 10px; padding: 7px 8px; min-height: 34px; }
.notify__skeleton-avatar { width: 24px; height: 24px; border-radius: 50%; flex: 0 0 auto; }
.notify__skeleton-bar { height: 12px; border-radius: 6px; width: 55%; }

.notify__pool { margin-bottom: 6px; }
.notify__pool-head { display: flex; align-items: center; justify-content: space-between; margin: 0 -14px 0 -32px; padding: 6px 14px 6px 32px; position: sticky; top: 86px; z-index: 2; background: var(--white, #fff); }
.notify__list--scrolled .notify__pool-head { box-shadow: 0 6px 6px -5px rgba(0, 0, 0, 0.18); }
html.dark-mode .notify__list--scrolled .notify__pool-head { box-shadow: 0 6px 8px -5px rgba(0, 0, 0, 0.5); }
html.dark-mode .notify__pool-head { background: var(--surface-card); }
.notify__pool-name { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.notify__pool-all { appearance: none; border: none; background: transparent; cursor: pointer; font-size: 12px; font-weight: 600; color: var(--primary); padding: 0; }
.notify__pool-all:disabled { color: var(--text-muted); cursor: default; }

.notify__check { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 6px; border: 1.5px solid var(--border-divider); background: var(--white, #fff); cursor: pointer; position: relative; padding: 0; }
html.dark-mode .notify__check { background: var(--surface-card); }
.notify__check:disabled { cursor: default; }
.notify__check--all { background: var(--primary); border-color: var(--primary); }
.notify__check--all::after { content: ''; position: absolute; left: 5px; top: 1px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.notify__check--partial { border-color: var(--primary); }
.notify__check--partial::after { content: ''; position: absolute; left: 3px; right: 3px; top: 7px; height: 2px; background: var(--primary); border-radius: 1px; }

.notify__team { appearance: none; box-sizing: border-box; width: calc(100% + 46px); text-align: left; background: transparent; border: none; cursor: pointer; display: flex; align-items: center; gap: 10px; margin: 0 -14px 0 -32px; padding: 7px 14px 7px 40px; }
.notify__team:disabled { cursor: default; }
.notify__team:hover:not(:disabled) { background: var(--surface-hover, rgba(0, 0, 0, 0.03)); }
.notify__team--on { background: var(--primary-light-4, rgba(45, 140, 240, 0.08)); }
.notify__team-name { font-size: 14px; color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Officials / umpires rows — same full-bleed row, with an email subline. */
.notify__person { align-items: center; }
.notify__person-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.notify__person-email { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Main (right) ── */
.notify__main { min-width: 0; display: flex; flex-direction: column; gap: 16px; min-height: 0; overflow-y: auto; }
@media (max-width: 720px) { .notify__main { overflow-y: visible; } }

/* "To:" summary */
.notify__to { border: 1px solid var(--border-divider); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.notify__to-head { display: flex; align-items: center; gap: 8px; }
.notify__to-label { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
.notify__to-count { font-size: 12px; font-weight: 600; color: var(--primary); }
.notify__to-spacer { flex: 1 1 auto; }
.notify__to-edit { appearance: none; border: none; background: transparent; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--primary); padding: 0; }
.notify__to-mgr { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; cursor: pointer; }
.notify__toggle-label { font-size: 14px; font-weight: 600; color: var(--text); }
.notify__to-empty { margin: 0; font-size: 13px; color: var(--text-muted); }
.notify__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.notify__chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 6px 5px 12px; border-radius: 999px; background: var(--primary-light-4, rgba(45, 140, 240, 0.1)); color: var(--text); font-size: 13px; font-weight: 500; }
.notify__chip-x { appearance: none; border: none; background: rgba(0, 0, 0, 0.06); color: var(--text-muted); cursor: pointer; width: 18px; height: 18px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; }
.notify__chip-x:hover { background: rgba(0, 0, 0, 0.12); color: var(--text); }
html.dark-mode .notify__chip-x { background: rgba(255, 255, 255, 0.1); }

.notify__compose { display: flex; flex-direction: column; gap: 16px; }
.notify__channels { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 480px) { .notify__channels { grid-template-columns: 1fr; } }
.notify__chtile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border: 1px solid var(--border-divider); border-radius: 8px; background: var(--surface-card); cursor: pointer; text-align: left; transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease; }
.notify__chtile:hover { border-color: var(--primary-light-2, #b9d4f4); background: var(--primary-light-3); }
html.dark-mode .notify__chtile { background: rgba(255, 255, 255, 0.03); }
html.dark-mode .notify__chtile:hover { background: rgba(45, 140, 240, 0.10); border-color: rgba(45, 140, 240, 0.45); }
.notify__chtile--active { border-color: var(--primary); background: var(--primary-light-3); box-shadow: inset 0 0 0 1px var(--primary); }
html.dark-mode .notify__chtile--active { background: rgba(45, 140, 240, 0.15); border-color: var(--primary); }
.notify__chtile-label { font-size: 13px; font-weight: 600; color: var(--text); line-height: 1.2; }
.notify__chtile--active .notify__chtile-label { color: var(--primary); }
html.dark-mode .notify__chtile--active .notify__chtile-label { color: #7fb0e8; }
.notify__chtile-hint { font-size: 11px; color: var(--secondary); line-height: 1.2; }

.notify__textarea { resize: vertical; min-height: 120px; line-height: 1.45; }
.notify__error { margin: 2px 0 0; font-size: 12px; color: #c1413a; }
.notify__muted { font-size: 14px; color: var(--text-muted); }
.notify__muted--sm { font-size: 13px; padding: 4px 14px; }

.notify__hist-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.notify__hist-item { border: 1px solid var(--border-divider); border-radius: 12px; padding: 12px 14px; }
.notify__hist-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.notify__hist-time { font-size: 12px; color: var(--text-muted); }
.notify__hist-subject { margin: 8px 0 0; font-size: 14px; font-weight: 600; color: var(--text); }
.notify__hist-body { margin: 4px 0 0; font-size: 13px; color: var(--text-muted); line-height: 1.45; }
.notify__hist-meta { margin: 8px 0 0; font-size: 12px; color: var(--text-muted); }

.notify__foot-spacer { flex: 1 1 auto; }
.notify__send { background: var(--primary); }
.notify__send:hover:not(:disabled) { background: var(--primary-light); }
</style>
