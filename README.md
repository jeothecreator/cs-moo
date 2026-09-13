# CS:Moo — Counter-Strike: Bovine Operations

A browser-based 5v5 tactical shooter. Rogue Bulls attack, Dairy Guard defend, milk flies.
No installs, no downloaded assets: every texture, model and sound is generated procedurally at load.

## Run it

```bash
npm install
npm start
```

Open http://localhost:3000, pick a callsign and room, and hit **Find match**.
Friends on your network can join the same room at `http://<your-ip>:3000/?room=<name>`.
Empty slots are filled with bots, so you can play solo right away.

`PORT=8080 npm start` changes the port; `BUY_TIME=5 npm start` shortens the buy phase for testing.

## What's in the game

- **Match flow**: buy phase → 1:45 action phase → round end; first to 8 rounds, sides swap after round 7 (MR15).
- **Free-for-all**: a separate Creamery arena with free loadouts, 12-second post-spawn loadout changes, protected anti-camp spawns, 3-second respawns, and a first-to-30 leaderboard.
- **Economy (Gallons $)**: $800 start, per-weapon kill rewards (rifle $300, SMG $600, shotgun $900, hoof $1,500), $3,250 win, loss bonus $1,400 +$500/streak (cap $3,400), +$800 for Bulls when the bomb was planted.
- **Arsenal**: Udder-Nine, Deag-Bull, Milky Way, Pasteurizer (8 pellets), AK-Moory (1-tap HS through Kevlar), Mooster-4A1 (suppressed), The Creaminator (2-level scope, leaves slippery milk puddles), Hoof knife with backstabs.
- **Combat**: per-weapon spray patterns you can control, movement/jump/crouch inaccuracy, head/body/leg hitboxes, armor & helmets with per-weapon armor penetration, range falloff, wallbangs through wood/hay/crates.
- **Utility**: Butter Grenade (flash), Sour Milk Grenade (smoke that blocks vision and bot sight), He-Cheese (HE), Cheese Molotov (fondue fire, 40 dps, slows, extinguished by smoke).
- **Objective**: plant the Sour Milk Bomb at A or B (3.2 s), 40 s fuse, defuse in 10 s or 5 s with a kit, drop and pick up the bomb.
- **Movement**: Source-style acceleration and friction, air strafing, crouch-jumping, walking to stay silent.
- **Bots**: buy logic, A/B/mid roles, rotations on enemy sightings, entry utility, plant/defuse, reaction time, aim error and burst control.
- **HUD**: rotating radar with spotted enemies, kill feed (headshots, wallbangs), buy menu, scoreboard, round banners with MVP, damage direction indicators, dynamic crosshair, scope overlay, spectating, chat (all/team).

## Controls

| Key | Action |
| --- | --- |
| WASD / Space / Ctrl or C / Shift | Move / jump / crouch / walk |
| Mouse 1 / Mouse 2 | Fire / scope, heavy hoof swing, underhand throw |
| R | Reload |
| F | Inspect weapon |
| 1–5, Q, wheel | Primary, pistol, hoof, grenades, bomb, last weapon |
| B | Buy menu |
| E | Plant / defuse |
| G | Drop bomb |
| Tab | Scoreboard |
| Y / U | Chat / team chat (all chat in free-for-all) |
| M | Change team (defusal only) |
| Esc | Pause & settings |

## Architecture

```
shared/     constants (weapons, economy, recoil), map geometry, kinematic physics & raycasts — used by both sides
server/     Node.js authoritative simulation @ 60 Hz, snapshots @ 30 Hz
  index.js    Express static hosting + WebSocket rooms (/ws, /api/rooms)
  match.js    rounds, economy, lag-compensated hit detection (1 s hitbox history rewind), grenades, bomb
  bot.js      bot brains; nav.js — grid A* with string pulling
client/     Three.js renderer + HTML/CSS HUD
  game.js     input, client-side prediction, shooting, snapshot interpolation (100 ms), events
  world.js    merged per-material geometry, baked (update-once) sun shadows, sky, skyline props
  cow.js      animated cow operators; viewmodel.js — weapon meshes + first-person viewmodel
  effects.js  GPU point particles, milk tracers, decals, smoke/fire/puddles
  audio.js    procedural WebAudio SFX with stereo positioning
```

### How this differs from the design doc

- **Networking** uses WebSockets (JSON) instead of Geckos.io/WebRTC, which avoids UDP/ICE server setup. The server still does the doc's lag compensation: it keeps a rolling hitbox history and rewinds to each client's render time to validate shots.
- **Movement** is client-predicted and validated by the server (speed clamp, collision check, freeze-time lock) rather than fully server-authoritative.
- **Rendering** uses Three.js with procedural low-poly art instead of Blender/Draco assets. The static sun shadow map is rendered once per round, standing in for baked lightmaps.
- **Physics** uses custom AABB collision and raycasts rather than Rapier.
