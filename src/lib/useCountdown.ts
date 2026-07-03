import { onUnmounted, ref, watch, type Ref } from 'vue'

// useCountdown — live days/hours/minutes/seconds remaining until a deadline.
// Ticks once per second and cleans up on unmount. Pass an ISO datetime
// string (or a ref to one); `expired` flips true once the deadline passes.

export interface Countdown {
  days: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
}

const ZERO: Countdown = { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }

export function useCountdown(deadline: Ref<string | null | undefined> | string) {
  const state = ref<Countdown>({ ...ZERO })
  let timer: ReturnType<typeof setInterval> | null = null

  function deadlineMs(): number {
    const raw = typeof deadline === 'string' ? deadline : deadline.value
    const t = raw ? new Date(raw).getTime() : NaN
    return Number.isNaN(t) ? 0 : t
  }

  function tick() {
    const ms = deadlineMs() - Date.now()
    if (ms <= 0) {
      state.value = { ...ZERO }
      return
    }
    const totalSec = Math.floor(ms / 1000)
    state.value = {
      days: Math.floor(totalSec / 86400),
      hours: Math.floor((totalSec % 86400) / 3600),
      minutes: Math.floor((totalSec % 3600) / 60),
      seconds: totalSec % 60,
      expired: false
    }
  }

  tick()
  timer = setInterval(tick, 1000)
  if (typeof deadline !== 'string') watch(deadline, tick)
  onUnmounted(() => {
    if (timer) clearInterval(timer)
  })

  return state
}
