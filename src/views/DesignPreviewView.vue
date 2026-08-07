<script setup lang="ts">
// /design-preview — visual reference + regression check for redesign-theme.css.
// Renders every theme.css class (incl. empty/loading states). Dev reference only.
// Everything is wrapped in `.rd` so the scoped dark design system applies.
import { ref } from 'vue'
const seg = ref('all')
const rsvp = ref('going')
</script>

<template>
  <div class="rd">
    <div class="bar"><div class="bar-in">
      <span class="av ring" style="width:38px;height:38px;background:#7A3038">RB</span>
      <span class="id"><h1>Red Bulls Team</h1><p>18U Male · 7 Sports</p></span>
      <span class="rec"><span class="z"><b class="n">0</b><i>Games</i></span><span class="w"><b class="n">9</b><i>Won</i></span><span class="l"><b class="n">8</b><i>Lost</i></span></span>
    </div></div>

    <div class="shell" style="padding-top:20px">
      <p class="eyebrow">Buttons</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 20px">
        <button class="btn pri">Primary action</button>
        <button class="btn">Secondary</button>
        <button class="btn sm">Small</button>
        <button class="btn dgr">End game</button>
        <button class="btn ic" aria-label="More">⋯</button>
      </div>

      <p class="eyebrow">Tabs (level 1)</p>
      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected="true">Events</button>
        <button role="tab" aria-selected="false">Teammates</button>
        <button role="tab" aria-selected="false">Player statistics</button>
        <button role="tab" aria-selected="false">Team statistics</button>
      </nav>

      <nav class="utabs" role="tablist">
        <button role="tab" aria-selected="true">Boxscores <span class="cnt n">1</span></button>
        <button role="tab" aria-selected="false">Player statistics <span class="cnt n">20</span></button>
        <button role="tab" aria-selected="false">Team statistics</button>
      </nav>

      <p class="eyebrow">Chips</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 20px">
        <span class="chip g">Won</span><span class="chip a"><span class="live"></span>Ongoing</span>
        <span class="chip b">Scheduled</span><span class="chip p">Admin</span>
        <span class="chip r">Lost</span><span class="chip n">Draft</span>
      </div>

      <div class="metrics three">
        <div class="m"><div class="k">Games</div><div class="v n">12</div><div class="s">Total played</div></div>
        <div class="m"><div class="k">Batting avg</div><div class="v none">—</div><div class="s">No at-bats yet</div></div>
        <div class="m"><div class="k">Runs</div><div class="v n">48</div><div class="s up">+6 vs last</div></div>
      </div>

      <div class="cols">
        <div class="stack-v">
          <div class="card">
            <header><h2>Card with actions</h2><span class="cnt n">3 games</span><span class="sp"><button class="btn sm">Add game</button></span></header>
            <div class="note"><p>Player has 2 hits against 0 at-bats — averages are suppressed until the source record is fixed.</p></div>
            <div class="pad">
              <div class="filters" style="padding:0 0 12px;border:0">
                <div class="fld"><label>Year</label><select><option>2026</option></select></div>
                <div class="fld"><label>Type</label><select><option>All</option></select></div>
                <button class="clr">Clear</button>
                <div class="seg push" role="group">
                  <button :aria-pressed="seg==='all'" @click="seg='all'">All 13</button>
                  <button :aria-pressed="seg==='adm'" @click="seg='adm'">Admins 1</button>
                  <button :aria-pressed="seg==='pl'" @click="seg='pl'">Players 9</button>
                </div>
              </div>
              <div class="sbar"><div style="flex:9;background:var(--green)"></div><div style="flex:3;background:var(--blue)"></div><div style="flex:1;background:var(--purple)"></div></div>
              <div class="keys">
                <div><span class="sw" style="background:var(--green)"></span><span class="lb">Going</span><span class="vl n">9</span><span class="pc n">69%</span></div>
                <div><span class="sw" style="background:var(--blue)"></span><span class="lb">Not responded</span><span class="vl n">3</span><span class="pc n">23%</span></div>
                <div><span class="sw" style="background:var(--purple)"></span><span class="lb">Not going</span><span class="vl n">1</span><span class="pc n">8%</span></div>
              </div>
            </div>
          </div>

          <div class="card"><header><h2>Game cards</h2></header><div class="pad">
            <button class="game on"><span class="grail"><b class="n">2</b><span>Apr</span></span><span class="gbody"><span class="chip a"><span class="live"></span>Ongoing</span><div class="vs"><span class="t"><span class="av" style="width:26px;height:26px;background:#3E6EA8">RA</span><span>Restricted Access</span></span><b class="sc n">7</b><span class="mid">Top 3rd</span></div></span></button>
            <button class="game fin"><span class="grail"><b class="n">18</b><span>Apr</span></span><span class="gbody"><span class="chip n">Final</span><div class="vs"><span class="t"><span class="av" style="width:26px;height:26px;background:#B23A34">BB</span><span>BBLp</span></span><b class="sc win n">4</b><span class="mid">–</span><b class="sc d n">2</b></div></span></button>
          </div></div>
        </div>

        <div class="stack-v">
          <div class="card"><header><h2>RSVP</h2></header><div class="pad">
            <div class="rsvp" role="group">
              <button :aria-pressed="rsvp==='going'" @click="rsvp='going'">Going</button>
              <button :aria-pressed="rsvp==='no'" @click="rsvp='no'">Not going</button>
              <button :aria-pressed="rsvp==='maybe'" @click="rsvp='maybe'">Maybe</button>
            </div>
            <p style="color:var(--mu);font-size:12.5px;margin:10px 0 0">1 of 13 going · 12 not responded</p>
          </div></div>

          <div class="card">
            <div class="mrow"><span class="av" style="width:34px;height:34px;background:#2E6A4E">BD</span><span><div class="nm">Ben David</div><div class="rl">Admin</div></span><span class="sp"><button class="kebab" aria-label="Options">⋯</button></span></div>
            <button class="qa"><span class="ico">＋</span><b>Invite via link</b><span>Share a join link</span><span class="ch">›</span></button>
          </div>

          <div class="card"><div class="empty"><div class="ring">✦</div><h3>No events yet</h3><p>This team hasn't been added to any events yet.</p><button class="btn pri">Add event</button></div></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px"><header><h2>Data table</h2></header>
        <div class="tw"><table>
          <thead><tr><th class="l">Player</th><th>OB%</th><th>AVG</th><th>AB</th><th class="split">HR</th><th class="split">RBI</th></tr></thead>
          <tbody>
            <tr><td class="l"><span class="pcell"><span class="rank n">1</span><span class="av" style="width:28px;height:28px;background:#3E6EA8">KG</span><span><div class="nm">Kashan Ghauri</div><div class="rl">SS</div></span></span></td><td class="n">.220</td><td class="n">.190</td><td class="n">62</td><td class="split n">44</td><td class="split n">4</td></tr>
            <tr><td class="l"><span class="pcell"><span class="rank n">2</span><span class="av" style="width:28px;height:28px;background:#7A3038">HA</span><span><div class="nm">Hassan Ali</div><div class="rl">CF</div></span></span></td><td class="n">.155</td><td class="n">—</td><td class="z n">0</td><td class="split z n">0</td><td class="split n">6</td></tr>
          </tbody>
          <tfoot><tr><td class="l">Game total</td><td class="n">.194</td><td class="n">.172</td><td class="n">86</td><td class="split n">49</td><td class="split n">10</td></tr></tfoot>
        </table></div>
      </div>
    </div>
  </div>
</template>
