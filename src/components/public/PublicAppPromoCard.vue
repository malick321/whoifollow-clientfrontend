<script setup lang="ts">
// PublicAppPromoCard
// ------------------
// Left-column marketing card on the public event page's Schedule tab.
// Full-height: app pitch + store badges up top, then an auto-advancing,
// animated feature widget (Chats · Follow & Notify · Scores & Performance).
// Each slide renders a little illustrative animation (a chat thread that
// types itself in, notification toasts that slide in, a scoreboard whose
// bars grow) plus icon-tagged highlights — built to drive sign-ups.
// Centred progress bullets; the active bullet is a track with a timer fill.

import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import googlePlayDarkUrl from '../../assets/badge-google-play.svg'
import googlePlayLightUrl from '../../assets/badge-google-play-light.svg'
import appStoreDarkUrl from '../../assets/badge-app-store.svg'
import appStoreLightUrl from '../../assets/badge-app-store-light.svg'
import { themeMode } from '../../theme'
import { openLoginModal } from '../../login-modal-center'
// Two-tone feature badge icons (currentColor + 0.4 backing path).
import teamsIconRaw from '../../assets/teams-twotone.svg?raw'
import notifIconRaw from '../../assets/notification-twotone.svg?raw'
import gameIconRaw from '../../assets/game-twotone.svg?raw'

// Some twotone icons ship a hardcoded fill — normalise to currentColor so
// the badge colour (and dark/light theme) applies, like teams-twotone.
const themeIcon = (raw: string) => raw.replace(/#292D32/gi, 'currentColor')

const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.alphaSquared.wifapp&hl=en'
const APP_STORE_URL = 'https://apps.apple.com/us/app/who-i-follow/id1639953093'

const googlePlayBadgeUrl = computed(() => (themeMode.value === 'dark' ? googlePlayDarkUrl : googlePlayLightUrl))
const appStoreBadgeUrl = computed(() => (themeMode.value === 'dark' ? appStoreDarkUrl : appStoreLightUrl))

// ── Feature slider ──
const SLIDE_MS = 5000

type FeatureKey = 'chat' | 'follow' | 'scores'
interface Point { d: string; text: string }
interface Feature {
  key: FeatureKey
  title: string
  tagline: string
  icon: string
  points: Point[]
}

// Single-path line icons (stroke = currentColor) for each highlight.
const ICON = {
  chat: 'M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  sheet: 'M9 4h6M8 4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2M8 11h8M8 15h5',
  chart: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a2 2 0 0 0 0 4h3M17 6h3a2 2 0 0 1 0 4h-3'
}

const features: Feature[] = [
  {
    key: 'chat',
    title: 'Team Chat',
    tagline: 'Keep your whole team on the same page.',
    icon: themeIcon(teamsIconRaw),
    points: [
      { d: ICON.chat, text: 'Group chats per team & event' },
      { d: ICON.file, text: 'Share docs, rosters & game plans' },
      { d: ICON.clock, text: 'Coordinate logistics in real time' }
    ]
  },
  {
    key: 'scores',
    title: 'Game Scoresheets',
    tagline: 'Every plate appearance, tracked live.',
    icon: themeIcon(gameIconRaw),
    points: [
      { d: ICON.sheet, text: 'Live scoresheets for every game' },
      { d: ICON.chart, text: 'Plate-by-plate play tracking' },
      { d: ICON.trophy, text: 'Box scores & team performance' }
    ]
  },
  {
    key: 'follow',
    title: 'Follow & Get Notified',
    tagline: 'Never miss a moment that matters.',
    icon: themeIcon(notifIconRaw),
    points: [
      { d: ICON.star, text: 'Follow teams, events & associations' },
      { d: ICON.bolt, text: 'Live score & schedule updates' },
      { d: ICON.bell, text: 'Game-time & field-change alerts' }
    ]
  }
]

// Plate-appearance mock for the "Team Scoresheets" slide. Each PA is drawn
// as a baseball diamond with the reached bases filled.
interface PA { bases: 0 | 1 | 2 | 3 | 4; kind: 'hit' | 'walk' | 'out'; label: string }
interface Batter { emoji: string; name: string; bg: string; fg: string; bgDark: string; fgDark: string; pas: PA[] }
const batters: Batter[] = [
  { emoji: '👲', name: 'C. Diaz', bg: '#e7f1ff', fg: '#477bb2', bgDark: '#2a3a52', fgDark: '#7fb0e8', pas: [{ bases: 4, kind: 'hit', label: 'HR' }, { bases: 0, kind: 'out', label: 'K' }] },
  { emoji: '🧛‍♀️', name: 'V. Ortiz', bg: '#fbe4e6', fg: '#bb5964', bgDark: '#4a2530', fgDark: '#ff8a98', pas: [{ bases: 2, kind: 'hit', label: '2B' }, { bases: 1, kind: 'walk', label: 'BB' }] },
  { emoji: '🧑‍🌾', name: 'D. Hale', bg: '#eaf8eb', fg: '#468957', bgDark: '#243d2c', fgDark: '#7ad48a', pas: [{ bases: 1, kind: 'hit', label: '1B' }, { bases: 0, kind: 'out', label: '6-3' }] },
  { emoji: '👩‍🚒', name: 'R. Kim', bg: '#efe8ff', fg: '#7360b7', bgDark: '#33294a', fgDark: '#b29bdc', pas: [{ bases: 3, kind: 'hit', label: '3B' }, { bases: 0, kind: 'out', label: 'F8' }] }
]
// Polyline through home → first → second → third → home, truncated to the
// number of bases reached.
function diamondPath(bases: number): string {
  const pts: number[][] = [[14, 25]]
  if (bases >= 1) pts.push([25, 14])
  if (bases >= 2) pts.push([14, 3])
  if (bases >= 3) pts.push([3, 14])
  if (bases >= 4) pts.push([14, 25])
  return pts.map((p) => p.join(',')).join(' ')
}

const active = ref(0)
const runId = ref(0) // bump to restart the bullet-timer animation
const paused = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null }
}
function schedule() {
  clearTimer()
  runId.value++
  timer = setTimeout(() => {
    active.value = (active.value + 1) % features.length
    schedule()
  }, SLIDE_MS)
}
function go(i: number) {
  active.value = i
  schedule()
}
function pause() {
  paused.value = true
  clearTimer()
}
function resume() {
  if (!paused.value) return
  paused.value = false
  schedule()
}

onMounted(schedule)
onBeforeUnmount(clearTimer)
</script>

<template>
  <section class="pub-apppromo">
    <h2 class="pub-apppromo__title">Get the Who I Follow app</h2>
    <p class="pub-apppromo__copy">
      Follow your teams, get live score &amp; schedule updates, and never miss a game.
    </p>
    <div class="pub-apppromo__badges">
      <a :href="GOOGLE_PLAY_URL" target="_blank" rel="noopener" aria-label="Get Who I Follow on Google Play">
        <img :src="googlePlayBadgeUrl" alt="Get it on Google Play" class="pub-apppromo__badge" />
      </a>
      <a :href="APP_STORE_URL" target="_blank" rel="noopener" aria-label="Download Who I Follow on the App Store">
        <img :src="appStoreBadgeUrl" alt="Download on the App Store" class="pub-apppromo__badge" />
      </a>
    </div>

    <!-- Auto-advancing, animated feature widget. -->
    <div class="pub-apppromo__slider" @mouseenter="pause" @mouseleave="resume">
      <!-- Large faint feature-icon watermark in the slider background. -->
      <span class="pub-apppromo__watermark" aria-hidden="true" v-html="features[active].icon"></span>

      <div class="pub-apppromo__bullets" role="tablist" aria-label="App features">
        <button
          v-for="(f, i) in features"
          :key="f.key"
          type="button"
          class="pub-apppromo__bullet"
          :class="{ 'is-active': i === active }"
          role="tab"
          :aria-selected="i === active"
          :aria-label="`Show ${f.title}`"
          @click="go(i)"
        >
          <span
            v-if="i === active"
            :key="runId"
            class="pub-apppromo__bullet-fill"
            :class="{ 'is-paused': paused }"
            :style="{ animationDuration: SLIDE_MS + 'ms' }"
          ></span>
        </button>
      </div>

      <Transition name="pub-feat" mode="out-in">
        <div :key="active" class="pub-apppromo__feature" :data-kind="features[active].key">
          <div class="pub-apppromo__feat-headrow">
            <h3 class="pub-apppromo__feat-title">{{ features[active].title }}</h3>
            <p class="pub-apppromo__feat-tagline">{{ features[active].tagline }}</p>
          </div>

          <!-- Illustrative animated stage. -->
          <div class="pub-apppromo__stage">
            <!-- CHAT: a thread that types itself in. -->
            <template v-if="features[active].key === 'chat'">
              <div class="pub-chat__msg pub-chat__msg--in">
                <span class="pub-chat__ava" style="--a:#e7f1ff;--f:#477bb2;--ad:#2a3a52;--fd:#7fb0e8">🕵️‍♀️</span>
                <span class="pub-chat__bubble">Bus leaves 7:30 sharp 🚌</span>
              </div>
              <div class="pub-chat__msg pub-chat__msg--out">
                <span class="pub-chat__bubble pub-chat__bubble--me">Lineup sheet attached 📄</span>
              </div>
              <div class="pub-chat__msg pub-chat__msg--in">
                <span class="pub-chat__ava" style="--a:#eaf8eb;--f:#468957;--ad:#243d2c;--fd:#7ad48a">🥷</span>
                <span class="pub-chat__bubble">On our way 💪</span>
              </div>
              <div class="pub-chat__msg pub-chat__msg--in">
                <span class="pub-chat__ava" style="--a:#fbe4e6;--f:#bb5964;--ad:#4a2530;--fd:#ff8a98">🧛‍♀️</span>
                <span class="pub-chat__typing"><i></i><i></i><i></i></span>
              </div>
            </template>

            <!-- FOLLOW: notification toasts slide in. -->
            <template v-else-if="features[active].key === 'follow'">
              <div class="pub-toast">
                <span class="pub-toast__ic" data-tone="warning">⏰</span>
                <span class="pub-toast__txt"><b>Game starting soon</b><small>Field 3 · in 15 min</small></span>
              </div>
              <div class="pub-toast">
                <span class="pub-toast__ic" data-tone="info">📣</span>
                <span class="pub-toast__txt"><b>Field changed</b><small>Now playing on D2</small></span>
              </div>
              <div class="pub-toast">
                <span class="pub-toast__ic" data-tone="success">🏆</span>
                <span class="pub-toast__txt"><b>Final: Miners 7–4</b><small>Carson Miners win</small></span>
              </div>
              <div class="pub-toast">
                <span class="pub-toast__ic" data-tone="info">⭐</span>
                <span class="pub-toast__txt"><b>Now following</b><small>Carson Miners</small></span>
              </div>
            </template>

            <!-- SCORES: per-batter plate appearances drawn as base diamonds. -->
            <template v-else>
              <div class="pub-pa" role="img" aria-label="Plate appearances preview">
                <div
                  v-for="(bt, ri) in batters"
                  :key="bt.name"
                  class="pub-pa__player"
                  :style="{ '--a': bt.bg, '--f': bt.fg, '--ad': bt.bgDark, '--fd': bt.fgDark }"
                >
                  <span class="pub-pa__ava">{{ bt.emoji }}</span>
                  <span class="pub-pa__name">{{ bt.name }}</span>
                  <span class="pub-pa__chips">
                    <span
                      v-for="(pa, ci) in bt.pas"
                      :key="ci"
                      class="pub-pa__chip"
                      :data-kind="pa.kind"
                      :style="{ '--i': ri * 2 + ci }"
                    >
                      <svg class="pub-pa__dia" viewBox="0 0 28 28" aria-hidden="true">
                        <polygon class="pub-pa__dia-out" points="14,25 25,14 14,3 3,14" />
                        <polyline v-if="pa.bases > 0" class="pub-pa__dia-path" :points="diamondPath(pa.bases)" />
                        <circle v-if="pa.bases >= 1" class="pub-pa__dia-base" cx="25" cy="14" r="2.2" />
                        <circle v-if="pa.bases >= 2" class="pub-pa__dia-base" cx="14" cy="3" r="2.2" />
                        <circle v-if="pa.bases >= 3" class="pub-pa__dia-base" cx="3" cy="14" r="2.2" />
                        <circle v-if="pa.bases >= 4" class="pub-pa__dia-base" cx="14" cy="25" r="2.8" />
                      </svg>
                      <i class="pub-pa__lab">{{ pa.label }}</i>
                    </span>
                  </span>
                </div>
              </div>
            </template>
          </div>

          <!-- Icon-tagged highlights (staggered in). -->
          <ul class="pub-apppromo__feat-points">
            <li v-for="(p, pi) in features[active].points" :key="p.text" :style="{ '--i': pi }">
              <svg class="pub-apppromo__pt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path :d="p.d" />
              </svg>
              <span>{{ p.text }}</span>
            </li>
          </ul>
        </div>
      </Transition>
    </div>

    <button type="button" class="secondary-button pub-apppromo__cta" @click="openLoginModal()">
      Create a FREE account
    </button>
  </section>
</template>

<style scoped>
.pub-apppromo {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* Soft primary glow over the card surface for a touch of polish. */
  background:
    radial-gradient(130% 70% at 100% 100%, rgba(45, 140, 240, 0.07), transparent 55%),
    var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
html.dark-mode .pub-apppromo {
  background:
    radial-gradient(130% 70% at 100% 100%, rgba(45, 140, 240, 0.12), transparent 55%),
    var(--surface-card, #fff);
}
.pub-apppromo__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.pub-apppromo__copy {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--secondary);
}
.pub-apppromo__badges { display: flex; flex-direction: row; gap: 10px; }
.pub-apppromo__badges a { flex: 1 1 0; min-width: 0; max-width: 160px; }
.pub-apppromo__badge { width: 100%; height: auto; display: block; }

/* ── Feature widget ── */
.pub-apppromo__slider {
  position: relative;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 16px;
  padding-top: 4px;
}
/* Faint feature-icon watermark in the slider background (top-right). */
.pub-apppromo__watermark {
  position: absolute;
  right: 0;
  top: 14px;
  line-height: 0;
  color: var(--primary, #2d8cf0);
  opacity: 0.16;
  pointer-events: none;
  z-index: 0;
}
html.dark-mode .pub-apppromo__watermark { opacity: 0.12; }
.pub-apppromo__watermark :deep(svg) { width: 200px; height: 200px; display: block; }
/* Keep the slider content above the watermark. */
.pub-apppromo__slider > :not(.pub-apppromo__watermark) { position: relative; z-index: 1; }
.pub-apppromo__feature {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pub-apppromo__feat-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text); }
.pub-apppromo__feat-tagline { margin: 2px 0 0; font-size: 13.5px; color: var(--text); }

/* The illustrative stage fills the free space (frameless — the card's
   background watermark shows through). */
.pub-apppromo__stage {
  flex: 1 1 auto;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  margin: 14px 0;
  padding: 0;
}

/* CHAT thread */
.pub-chat__msg { display: flex; align-items: flex-end; gap: 6px; opacity: 0; animation: pub-rise 380ms ease forwards; }
.pub-chat__msg--out { flex-direction: row-reverse; }
.pub-chat__msg:nth-child(1) { animation-delay: 120ms; }
.pub-chat__msg:nth-child(2) { animation-delay: 220ms; }
.pub-chat__msg:nth-child(3) { animation-delay: 320ms; }
.pub-chat__msg:nth-child(4) { animation-delay: 420ms; }
.pub-chat__ava {
  flex: 0 0 auto;
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1;
  background: var(--a); color: var(--f);
}
html.dark-mode .pub-chat__ava { background: var(--ad, var(--a)); color: var(--fd, var(--f)); }
.pub-chat__bubble {
  max-width: 78%;
  font-size: 12px; line-height: 1.35;
  padding: 7px 10px; border-radius: 12px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  color: var(--text);
}
.pub-chat__bubble--me { background: var(--primary, #2d8cf0); border-color: var(--primary, #2d8cf0); color: #fff; }
html.dark-mode .pub-chat__bubble--me { color: #0f1722; }
.pub-chat__typing { display: inline-flex; gap: 3px; padding: 9px 11px; border-radius: 12px; background: var(--surface-card, #fff); border: 1px solid var(--border-divider); }
.pub-chat__typing i { width: 5px; height: 5px; border-radius: 50%; background: var(--secondary); opacity: 0.5; animation: pub-blink 1s infinite; }
.pub-chat__typing i:nth-child(2) { animation-delay: 0.15s; }
.pub-chat__typing i:nth-child(3) { animation-delay: 0.3s; }

/* FOLLOW toasts */
.pub-toast {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 10px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
  opacity: 0; transform: translateX(18px);
  animation: pub-slidein 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transition: transform 140ms ease;
}
.pub-toast:hover { transform: translateX(-2px); }
.pub-toast:nth-child(1) { animation-delay: 120ms; }
.pub-toast:nth-child(2) { animation-delay: 220ms; }
.pub-toast:nth-child(3) { animation-delay: 320ms; }
.pub-toast:nth-child(4) { animation-delay: 420ms; }
.pub-toast__ic {
  flex: 0 0 auto;
  width: 28px; height: 28px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px;
  background: var(--primary-light-3, #e9f3ff);
}
.pub-toast__ic[data-tone='warning'] { background: var(--light-warning, #fff3d6); }
.pub-toast__ic[data-tone='success'] { background: var(--success-light, #e3f6ec); }
.pub-toast__txt { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.pub-toast__txt b { font-size: 12px; font-weight: 600; color: var(--text); }
.pub-toast__txt small { font-size: 11px; color: var(--secondary); }

/* SCORES: per-batter plate appearances drawn as base diamonds. */
.pub-pa { display: flex; flex-direction: column; gap: 10px; }
.pub-pa__player {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
  opacity: 0; animation: pub-rise 320ms ease forwards;
}
.pub-pa__player:nth-child(1) { animation-delay: 120ms; }
.pub-pa__player:nth-child(2) { animation-delay: 220ms; }
.pub-pa__player:nth-child(3) { animation-delay: 320ms; }
.pub-pa__player:nth-child(4) { animation-delay: 420ms; }
.pub-pa__ava {
  flex: 0 0 auto;
  width: 28px; height: 28px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1;
  background: var(--a); color: var(--f);
}
html.dark-mode .pub-pa__ava { background: var(--ad, var(--a)); color: var(--fd, var(--f)); }
.pub-pa__name {
  flex: 1 1 auto; min-width: 0;
  font-size: 12px; font-weight: 600; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pub-pa__chips { display: inline-flex; gap: 10px; flex: 0 0 auto; }
.pub-pa__chip {
  display: inline-flex; flex-direction: column; align-items: center; gap: 2px;
  color: var(--secondary);
  opacity: 0; transform: scale(0.6);
  animation: pub-pop 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  animation-delay: calc(280ms + var(--i, 0) * 80ms);
}
.pub-pa__chip[data-kind='hit'] { color: var(--primary, #2d8cf0); }
.pub-pa__chip[data-kind='walk'] { color: #c9920f; }
html.dark-mode .pub-pa__chip[data-kind='walk'] { color: #f5be4d; }
.pub-pa__dia { width: 26px; height: 26px; display: block; }
.pub-pa__dia-out { fill: none; stroke: var(--border-divider); stroke-width: 1.5; }
.pub-pa__dia-path { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.pub-pa__dia-base { fill: currentColor; }
.pub-pa__lab { font-style: normal; font-size: 9.5px; font-weight: 700; color: var(--secondary); }
.pub-pa__chip[data-kind='hit'] .pub-pa__lab,
.pub-pa__chip[data-kind='walk'] .pub-pa__lab { color: inherit; }

/* Highlights */
.pub-apppromo__feat-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.pub-apppromo__feat-points li {
  display: flex; align-items: center; gap: 9px;
  font-size: 13.5px; color: var(--text);
  opacity: 0;
  animation: pub-rise 360ms ease forwards;
  animation-delay: calc(180ms + var(--i) * 110ms);
}
.pub-apppromo__pt-ic {
  flex: 0 0 auto;
  width: 17px; height: 17px;
  color: var(--primary, #2d8cf0);
}

/* Crossfade between slides. */
.pub-feat-enter-active,
.pub-feat-leave-active { transition: opacity 220ms ease, transform 220ms ease; }
.pub-feat-enter-from { opacity: 0; transform: translateY(6px); }
.pub-feat-leave-to { opacity: 0; transform: translateY(-6px); }

/* Centred progress bullets. */
.pub-apppromo__bullets { display: flex; align-items: center; justify-content: center; gap: 7px; margin-bottom: 14px; }
.pub-apppromo__bullet {
  appearance: none; border: 0; padding: 0;
  height: 6px; width: 28px; border-radius: 999px;
  background: var(--border-divider); cursor: pointer; overflow: hidden;
  transition: width 240ms ease, background-color 240ms ease;
}
.pub-apppromo__bullet.is-active { width: 84px; background: var(--primary-light-3, #d7e9ff); }
html.dark-mode .pub-apppromo__bullet.is-active { background: rgba(45, 140, 240, 0.22); }
.pub-apppromo__bullet-fill {
  display: block; height: 100%; width: 0; border-radius: inherit;
  background: var(--primary, #2d8cf0);
  animation-name: pub-apppromo-fill;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
.pub-apppromo__bullet-fill.is-paused { animation-play-state: paused; }

/* Bottom CTA — full width; styling comes from the shared primary-button. */
.pub-apppromo__cta {
  width: 100%;
  margin-top: 14px;
}

@keyframes pub-apppromo-fill { from { width: 0; } to { width: 100%; } }
@keyframes pub-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pub-slidein { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: translateX(0); } }
@keyframes pub-pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
@keyframes pub-blink { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .pub-apppromo__bullet-fill,
  .pub-chat__msg, .pub-toast, .pub-apppromo__feat-points li,
  .pub-pa__player, .pub-pa__chip {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
