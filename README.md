# FRONTLINE — Tactical Operations

A browser-based tactical shooter in the Counter-Strike mould: 5v5 defusal, free-for-all, 1v1 duels and a solo assault course.
Insurgents attack, the Task Force defends. Rendered with a bodycam look by default (switchable to a clean "tactical" style).

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, pick a callsign and hit **Quick play**.
Friends on your network can join the same room at `http://<your-ip>:3000/?room=<name>`.
Empty slots are filled with bots, so you can play solo right away.

`PORT=8080 npm start` changes the port; `BUY_TIME=5 npm start` shortens the buy phase for testing.

## Maps

| Mode | Map | Setting |
| --- | --- | --- |
| Defusal | `de_trenches` | An overcast front line: plank-revetted earthworks, sandbag parapets, barbed wire, mud and duckboards, concrete bunkers at both bomb sites |
| Free-for-all | `dm_seoul` | A Seoul street block at dusk: storefronts with Hangul neon, apartment towers, delivery trucks, vending machines, overhead wires |
| 1v1 Duel | `aim_rooftop` | A green-coated Seoul rooftop at golden hour: water tanks, AC units, onggi jars, a chain-link safety fence above the city |
| Assault Course | — | Solo obstacle course over open water, plus a course creator with share codes |

## What's in the game

- **Match flow**: buy phase → 1:45 action phase → round end; first to 8 rounds, sides swap at halftime.
- **Free-for-all / duel**: kills earn money, bought guns stay with you, protected spawns, 3-second respawns.
- **Economy**: $800 start, per-weapon kill rewards, win/loss bonuses, plant reward.
- **Arsenal**: P9 Pistol, .50 Magnum, M4 Carbine, M870 Shotgun, SCAR-H (Insurgents), M4A1-S (Task Force), L96A1 Sniper, Combat Knife.
- **Utility**: Flashbang, Smoke Grenade, HE Grenade, Molotov, Sandbag Barricades (climb them and boot-stomp from above).
- **Combat**: per-weapon spray patterns, movement inaccuracy, head/body/leg hitboxes, armour penetration, range falloff, wallbangs through wood and crates, lag-compensated hit detection.
- **First person**: real animated arm rigs — authored draw / fire / reload animations for rifles and pistols, with every other weapon mounted on the same rigs.
- **Third person**: rigged operators with procedural walk / crouch / aim and two-bone IK keeping both hands on the weapon.
- **Rendering**: physical sky with image-based lighting, ambient occlusion, bloom, SMAA, filmic grade, procedural PBR textures with derived normal maps, and the bodycam lens (barrel distortion, sensor noise, REC burn-in).
- **Bots**: buy logic, roles, rotations, plants/defuses, reaction time and recoil control.

## Controls

| Key | Action |
| --- | --- |
| WASD / Space / Ctrl or C / Shift | Move / jump / crouch / walk |
| Mouse 1 / Mouse 2 | Fire / aim down sights |
| R | Reload |
| F | Inspect weapon |
| 1–5, Q, wheel | Primary, pistol, knife, grenades, C4, last weapon |
| 6 / X | Sandbag barricades |
| B | Buy menu |
| E | Plant / defuse |
| Tab | Scoreboard |
| Y / U | Chat / team chat |
| Esc | Pause & settings (graphics quality, visual style) |

## Architecture

```
shared/     constants (weapons, economy, recoil), map geometry, kinematic physics & raycasts — used by both sides
server/     Node.js authoritative simulation @ 60 Hz, snapshots @ 30 Hz (match.js, bot.js, nav.js)
client/     Three.js renderer + HTML/CSS HUD
  world.js     themed map builder: banded world-UV surfaces, per-theme sky/lighting/set dressing
  assets.js    glTF loading, rig measurement, static gun baking
  viewmodel.js first-person rigs + procedural weapons; soldier.js — third-person operators
  postfx.js    AO, bloom, SMAA, grade and the bodycam lens
  textures.js  procedural PBR textures (Korean signage uses Noto Sans KR)
```

## Assets

3D models live in `client/assets/models/` — see `CREDITS.txt` there for sources and licences.
They were converted from FBX/glTF and compressed (WebP textures, meshopt geometry) from ~200 MB of source files to ~9 MB.
