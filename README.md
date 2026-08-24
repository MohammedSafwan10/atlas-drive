# Atlas Drive

A cinematic browser racing game built with Three.js. Race tactical rivals across the 6 km Alpine Pass or dodge traffic in Endless Highway while dynamic time, storms, wet roads, nitro and a detailed PBR environment transform every run.

![Atlas Drive gameplay](docs/gameplay.png)

## Gameplay

The repository includes the screenshot above as its current visual preview. A full gameplay video can be attached here without adding a large binary to the Git history: open `README.md` on GitHub, choose **Edit**, drag the final MP4 directly below this paragraph, and commit the generated video link.

<!-- GAMEPLAY_VIDEO: Drag the final MP4 into GitHub's README editor here. GitHub will generate a user-attachments URL and an embedded player. -->

## Highlights

- Curved, gently elevated endless highway with road-aligned traffic and chase camera
- Four-car 6 km Alpine Pass sprint with six sectors, live position, sampled-road minimap, finish gantry, and best-time records
- Rookie, Sport, and Pro rival AI with tactical overtakes, defending, nitro bursts, and believable mistakes
- Uneven 3D terrain with gravel shoulders, drainage ditches, guardrails, fences, reflectors, signs, and utility poles
- Three distinct tree species plus rocks, ferns, bushes, grass, and wildflowers
- PBR asphalt and terrain materials, HDR environment lighting, alpine panorama, shadows, fog, bloom, and cinematic color grading
- Dynamic eight-minute day cycle with matched morning, daytime, sunset, twilight, and starry-night lighting plus manual overrides
- Dynamic clear-to-storm weather arc with a matched Alpine storm panorama, scalable rain, wet asphalt, wheel spray, tunnel sheltering, lightning, delayed thunder, and manual weather controls
- Detailed player car with working brake lights, rotating tires, nitro effects, and contact shadow
- Road-casting headlights on the player and all three race rivals, with mobile distance culling
- Skippable multi-angle finish replay followed by a ranked three-car podium, confetti, result statistics, and finish audio stinger
- Traffic, near-miss scoring, three-life collision system, speedometer, nitro bar, and FPS counter
- Reactive three-band engine audio, recorded CC0 rain and thunder variations, road/wind noise, nitro, impacts, and UI sounds
- Instanced small vegetation and distance-aware scenery for better browser performance

## Current world

**Alpine Pass** is the first Atlas Drive location: a mountain route with open highway, bridges, tunnels, ramps, changing elevation and dynamic weather. The project name is intentionally location-neutral so future city, coastal, desert and winter routes can share the same game systems.

## Run locally

Requirements: Node.js 20.19 or newer (or Node.js 22.12+).

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. For a production build:

```bash
npm run build
npm run preview
```

## Controls

| Action | Keyboard |
| --- | --- |
| Accelerate | `W` or `Up Arrow` |
| Brake | `S` or `Down Arrow` |
| Steer | `A` / `D` or `Left` / `Right Arrow` |
| Nitro | `Shift` |
| Pause / resume | `P` or `Escape` |
| Mute / unmute | `M` |
| Restart after game over | `R` |

When the website is opened on a touch device, use the responsive on-screen
steering, brake, gas, nitro and pause controls. Tilt steering can be enabled
from the top control.

## Project structure

```text
src/
  main.js         Game loop, scoring, collisions, and chase camera
  path.js         Shared curved/elevated road centerline
  road.js         Road mesh, lane markings, rails, signs, and roadside fixtures
  environment.js  Terrain, vegetation, models, recycling, and instancing
  car.js          Player vehicle movement and visual effects
  traffic.js      AI traffic placement, recycling, and collision checks
  effects.js      Nitro and crash effects
  weather.js      Rain, spray, lightning, thunder, and weather transitions
  finish.js       Finish-line cameras, podium staging, and confetti
  scene.js        Renderer, lighting, fog, environment map, and post-processing
  hud.js          Score, lives, speed, nitro, and FPS interface
public/assets/     Runtime models, textures, panorama, and Draco decoder
```

## Performance notes

The world recycles deterministic 120-metre terrain slices on exact grid boundaries to prevent roadside texture swimming or geometry pops. Small vegetation is rendered with GPU instancing, while distant scenery uses cheaper representations to keep draw calls under control.

## Assets and credits

The project uses CC0 environment assets from [Poly Haven](https://polyhaven.com/) and project-specific generated tree cutouts. The storm panorama is a project-specific AI weather edit of the existing Alpine panorama; its geometry was kept aligned for seamless runtime blending. Full attribution and source details are in:

- [`public/assets/realistic/SOURCES.md`](public/assets/realistic/SOURCES.md)
- [`public/assets/terrain/SOURCES.md`](public/assets/terrain/SOURCES.md)
- [`public/assets/audio/SOURCES.md`](public/assets/audio/SOURCES.md)

The Ferrari model and any separately supplied vehicle assets remain subject to their original licenses; verify their redistribution terms before commercial use.

## License

The source code is released under the [MIT License](LICENSE). Third-party assets retain their respective licenses as described above.
