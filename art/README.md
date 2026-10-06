# Louise: art notes (character model and room)

For whoever draws her next scenes or films her. She is a collectible vinyl-toy figure: a big head on a small body, in a
room drawn as before. Two files are the model; copy from them and do not re-invent her:
- `../art.svg` is the front view: proportions, colours, the eye recipe, the mitts and the shading recipe.
- `researching.svg` is the side profile: the head group `lz-res-head`, and the seated body on its two-book booster.

## Character model (vinyl-toy style)
- **Proportions.** The head is as big as the whole body, or bigger.
  - Door: the head box is x 48 to 152 and y 22 to 118 (104 by 96). The body runs y 114 to 207.
  - Room, side profile: the head is 100 by 92. Standing, she is about 195 tall to the crown.
  - The head is a rounded square: corner radius about 32 to 34, the jaw corner a touch fuller.
  - Simple chunky shapes. No realistic anatomy, wrinkles, laugh lines, knit lines or strand lines.
- **Eyes** (owner's ruling: cartoon eyes that fill the panes, never solid black dots). Behind each square pane is one big eye:
  - The eye white is #FFFDF7, inset 2.5 and clipped to the pane.
  - Iris: r 9.5 to 10 in #6B4A2E, with a lighter lower crescent in #9A6A3F.
  - Pupil: r 5.2 to 5.5 in #1E130C.
  - Catch-lights: white, r 3 upper-left and r 1.4 lower-right.
  - A skin-coloured upper lid covers about the top fifth of the white, so she looks kind, not startled.
  - Front view: both eyes, nudged a little inward and down toward you.
  - Profile: ONE eye fills the near pane, its iris toward where she is looking.
  - The gaze and lid carry the mood: rapt at the screen, relaxed over a book at rest, wide and intent over the tome in the reading room.
- **Glasses**, her signature, oversized.
  - Panes: square, about 38 by 34 on the door (x 57 to 95 and 105 to 143, y 58 to 92) and 34 by 33 in profile, rx 6.
  - Frame: thick tortoiseshell, stroke 5, #5A3A22, with a #9A6A3F streak along the top at .6.
  - Lens: tint #A9E4F2 at .12, and one white glare band across each pane's upper-left corner at .35.
  - Profile: the far lens is a 4 to 6 unit sliver in front of the near pane, and a temple arm (stroke 4.4) runs into the hair.
- **Chain**: gilt #D9A441, stroke 3, with beads #E8C27A drawn as a dotted stroke (`stroke-dasharray: 0.01 10`, width 4.8).
  - Front view: it leaves both temples, swings outside the head and droops in a U across her collar.
  - Profile: it runs from the temple behind the jaw to her shoulder.
- **Face**
  - Skin #E9BE9F, lit by a subtle radial gradient to #F1C9AC, with a #D29C7E shadow crescent.
  - Nose: a tiny #D29C7E oval in front view; a small rounded nub in profile.
  - Mouth: one short kind smile curve (#9C5A48, stroke about 2.4).
  - Cheeks: blush ellipses #D68E7F at .45.
- **Hair**
  - Silver-white #DCD8D0 over #B9B3A8: a sculpted cap with a fringe of two or three smooth lumps, and a soft white highlight arc at .4.
  - Bun: a sphere at the crown with a specular spot.
  - Pencil: a chunky yellow pencil through the bun (#EDB82E, stripe #D29A1A, ferrule #B9B3A8, eraser #D9776B).
- **Clothes**
  - Cardigan #2F5A45 (lit #3E7259, shade #24473A).
  - Cream blouse #FBF6EA with a two-lobe collar (under-shadow #D9C49E).
  - Gilt buttons, and a gilt brooch with a garnet #7E2626.
  - A plain oxblood A-line skirt #6E2A26 (shade #4E1C1A).
  - Stubby legs #3A2F3A and rounded nub shoes #6B4A2E with a glossy dot.
- **Arms and hands**: stubby sleeve tubes about 13 to 14 wide with cream cuffs. Hands are skin mitts: a palm, four fanned finger capsules and a thumb, drawn as a #D29C7E layer under an #E9BE9F layer offset by -1.1. There are no finger lines.
- **Vinyl shading**
  - Flat fills, one shadow shape per part (light from the upper left), soft white highlight bands and specular dots.
  - A soft drop shadow at her feet (#2A1D14 at about .26).
  - No ink outlines inside the figure. The head and bun alone carry a soft edge (#2A1D14, opacity .35, width 1.6), so the silver hair holds on a pale wall.
- **Seated**: she sits on two fat books stacked on her chair (navy #283C5E and oxblood #7E2626, gilt bands, cream page edges). Her feet dangle above the floor.
- **Room lights**: the warm lamp (#F2C46B) and the cool screen glow (#A9E4F2 / #7FD6E8, `mix-blend-mode: screen`) still fall on her face, the near lens and the mitts.
- **Props**: beige CRT #DDD1B3 (light #EDE4CE, shade #C6B893, deep #A29372), oak desk #7A5030 (top #9A6A3F, edge #5C3B22), brass #D9A441, red marker #C62828. The room keeps its ink-outlined drawing; only Louise is a toy.
- **In public files** call the style "vinyl-toy" or "collectible-figure". Never name a toy brand.

## Room layout (viewBox 0 0 640 400, same in every desk scene)
- Wall to y 244; oak wainscot y 244 to 340; floor line y 340; floor to 400. Shelf x 516 to 640, full height, boards at y 96, 168, 240, 312.
- Desk: top surface y 250 to 270, edge to y 280; drawer pedestal x 14 to 188 (y 280 to 382); right leg x 490 to 510; kneehole x 188 to 490.
- Beige tower under the desk x 200 to 262, y 300 to 382. Monitor on the desk: case x 119 to 268, y 148 to 262, screen glass edge at x 262 to 270, facing right. Keyboard x 276 to 372 (top about y 252 to 260). Mouse and pad x 438 to 482 (behind her, right of the keyboard).
- Chair (moved left for her): seat x 360 to 450, y 300 to 313; post x 405; back rail x 413 to 443, y 222. Booster books x 372 to 444, y 279 to 300. Louise at the screen: head box x 294 to 394, y 136 to 228 (`lz-res-head` at `translate(294 136)`); eye centre (306.5, 190); nose nub tip x 290.6 (screen glass at x 270); torso x 347 to 420, y 222 to 274; mitts on the keys at x 305 to 350, y 236 to 256; feet dangle at about y 322. Banker's lamp x 482 to 516. Book stack x 26 to 88, mug of pens (red marker) x 98 to 120.

## Naming and scoping (the dashboard puts these inline, two at once)
- Root id `lz-<scene>` (`lz-researching`, `lz-door`), class `lz-scene`, `role="img"` with a `<title>`.
- Every id starts with the scene's short prefix (`lz-res-`, `lz-idl-`, `lz-cou-`, `lz-dis-`, `lz-shl-`, `lz-fet-`; door: `lz-door-`); every CSS rule starts with the root id (`#lz-researching ...`); every keyframe is named `<prefix><thing>`. No bare element selectors, no `<text>`, `<image>`, `<script>` or links.
- Animate `transform` and `opacity` only. Rotations use `transform-box: view-box` with an explicit pixel origin. Ambient loops `ease-in-out`, typing and LEDs `steps()`.
- Reduced motion: `@media (prefers-reduced-motion: reduce){ #<root> *{animation:none !important} }`. The un-animated pose must be a good frame.
- Safety: nothing flashes more than 3 times a second; the screen flicker stays between opacity .78 and 1.

## Files and motion
- `researching.svg`: groups `lz-res-room`, `lz-res-desk`, `lz-res-light`, `lz-res-pc`, `lz-res-louise` (chair with the two-book booster, legs, `lz-res-lean` holding torso, head, both arms), `lz-res-lamp`. She sits side-on, her nose nub inches from the glass, one big cartoon eye in the near pane looking at the screen, both mitts on the keys. Motion: `.lz-res-glow` screen light brightens and settles (2.4 s); `.lz-res-band-a/b/c` light bands sweep from the glass to her near pane (2.4 s, staggered); `.lz-res-hand-l` (1.2 s) and `.lz-res-hand-r` (1.5 s) bob 1 to 2 px in steps; `.lz-res-lean` leans 1.6 px (6 s); `.lz-res-led-disk` amber disk light blinks (3.7 s).
- `idle.svg` (`lz-idl-`): at rest she reads (the owner, 2026-10-05). The seated figure from researching sits back in her chair (`lz-idl-pose` rotates 6 degrees). A navy book with gilt edging and a red ribbon bookmark (`lz-idl-book`, spine at local x 0) lies open in both mitts at her lap, tipped 10 degrees toward her; her big eye looks down at the page, the lid relaxed and a little lowered. Her cup and saucer (`lz-idl-desk-tea`) are set aside at the left end of the desk, steaming. Motion: `.lz-idl-leaf` a page turns on the spine (scaleX 1 to -1, ease-in-out, 800 ms) once every 9 s; `.lz-idl-pupil` the iris, pupil and catch-lights drift about 1.8 px along the lines (3 s) with a quick return at the line end; `.lz-idl-steam-a/b/c` three wisps rise from the cup (4 s, staggered 1.35 s); `.lz-idl-breath` 1 px (5 s); `.lz-idl-glow` the idle monitor's dim glow (8 s, opacity .55 to .7). The un-animated frame: book open, pages flat, eye on the page, steam showing.
- `council.svg` (`lz-cou-`): the reading room, made unlike idle's relaxed reading. The seated figure tips forward 7 degrees about the seat over a chunky open oxblood tome on a low book rest (`lz-cou-tome`, gilt corners and bands, thick page block, ruled pages, gilt ribbon `lz-cou-ribbon`, `lz-cou-rest`), her near mitt flat on the left page, her far mitt (`lz-cou-hand-far`) at the right page, her big eye looking down at the page with the lid dropped only a touch; a smaller navy book `lz-cou-book2` lies open beside the tome, the keyboard is slid back 10 px under it, the five slim readers' books stand by the lamp, and the lamp is on. The tome is `translate(339 257) rotate(-4 -52 13)` with its spine at local x 0. Motion: `.lz-cou-leaf` a leaf turns across the spine (scaleX 1 to -1, about 700 ms every 5.6 s, with a soft fade at the loop restart); `.lz-cou-lift` the far mitt rises 2.5 px as the leaf turns (5.6 s); `.lz-cou-pupil` the iris, pupil and catch-lights travel the lines, about 2.5 px (2.2 s); `.lz-cou-lean` leans her a further 1.2 degrees in and settles about (400, 282) (5 s).
- `distill.svg` (`lz-dis-`): the seated figure tips forward over ruled sheets with the red marker, its cap on the desk, a pile of finished index cards with red ticks at the left; the keyboard is pushed back. Motion: `.lz-dis-m1/m2/m3` two strike-throughs and a circled word draw in (`stroke-dashoffset`) then fade (3.5 s loop); `.lz-dis-hand` (cuff, mitt and marker) follows each stroke about (364.05, 249.95), the marker tip resting at (340.44, 254.47); `.lz-dis-breath` (5 s).
- `shelving.svg` (`lz-shl-`): when she is finished she walks the new book to the bookcase (the owner, 2026-10-05: no cart). A 7.2 s loop. She stands at the desk (axis x 350) facing a stack of three new books (x 400 to 430; navy, navy, bottle green, gilt bands), rises 5 px and hooks the top one (0.2 to 0.8 s), draws it to her chest and looks at it, smiling (1.3 to 2.0 s). She waddles to the bookcase (2.3 to 3.62 s, axis x 350 to 492), turns the book spine-out and slides it into a gap in the lowest row (x 549 to 561; fully in at 4.4 s), lets go, turns (5.15 to 5.39 s), waddles back empty-handed (5.45 to 6.71 s) and turns to the stack (6.74 to 6.98 s). She is the standing profile figure of `fetching.svg` with its gait: thighs swing 23.8 degrees about the hip, feet counter-turn to stay flat with a 6 px lift, `lz-shl-bob` 0 to 3.7 px, `lz-shl-lean` rocks 1.8 degrees, `lz-shl-skirt` 2.2 degrees; a planted foot moves under 0.5 px. Classes: `lz-shl-walk`, `-turn` (mirror), `-bob`, `-rise`, `-th-n` / `-th-f`, `-ft-n` / `-ft-f`, `-lean`, `-head`, `-skirt`, arms `-nu`, `-nfo`, `-fu`, `-ffo`, `-book`, `-smile` / `-calm`. Opacity swaps, each where the eye is not: `-bookop` (the carried book, 0.7 to 4.5 s), `-top` (the stack's top book, off at 0.66 to 0.76 s, back at 2.7 to 3.05 s behind her head), `-spine` (the shelved book, on at 4.34 to 4.5 s, off at 6.75 to 7.05 s while she is at the desk). The carried book is `lz-shelving-newbook` with `data-loop-ms="7200"` and `data-placed-ms="4400"`: once a loop, at 4.4 s, the dashboard reads its box (x 549 to 561, y 262 to 315) and flies one small book from there to the Library. Every animation in the scene runs on the 7.2 s loop, so the page reads the phase from any of them. The un-animated frame has her at the bookcase with the book in the gap.
- `presenting.svg` (`lz-pre-`): not a stage; the dashboard shows it at rest while a finished book waits for the person to see it. A 2.4 s loop with no turning. She stands at the desk (axis x 350, facing left), feet on the floor, holding the new book out in both mitts, cover toward us, tipped about 20 degrees forward (navy, gilt frame, scaled 1.1 by 1.3: the same book she shelves next). The open grin, a wide bright eye on the viewer with the lid barely there, a touch more blush. Two new books are left on the desk at x 400 to 430. She is the standing figure of `shelving.svg`, unchanged. Motion: `.lz-pre-hop` a double bounce about the feet (0, 384): up 4 px at 380 ms, lands at 620 ms with a squash to 1.02 by 0.97, up 3 px at 880 ms, lands at 1120 ms, rests from 1320 ms; `.lz-pre-shadow` shrinks about 7 percent and lightens while she is up; `.lz-pre-offer` (with `-o-nu`, `-o-nfo`, `-o-fu`, `-o-ffo` for the arms and `-o-bk` for the book) pushes the book 2.5 px toward us and 1.5 px up at each peak; `.lz-pre-blink` drops the lid once at 1780 ms; `.lz-pre-glow` the dim monitor (4.8 s). The book is `lz-pre-book`; no id ends in `-newbook`, so no flight starts here. The un-animated frame: feet down, the book held out, beaming.
- `fetching.svg` (`lz-fet-`): a 4.8 s loop. She turns and waddles to the bookcase (0.22 to 1.54 s), reaches down and draws an oxblood book from the lowest row (1.98 to 2.3 s; `lz-fet-spine` at x 539 leaves a gap), turns, waddles back (2.58 to 3.84 s) and holds the book up in both mitts, cover toward us, grinning (from about 4.0 s; the dashboard opens the book at 4.4 s). The un-animated frame is that presenting pose. She is the standing profile figure mirrored by `lz-fet-turn`, walking x 340 to 482. The waddle: each walk is five stance steps (about three a second); the thighs (`lz-fet-th-n` / `lz-fet-th-f`) swing about 24 degrees at the hip and the feet (`lz-fet-ft-n` / `lz-fet-ft-f`) counter-turn to stay flat, with a 6 px lift; `lz-fet-bob` 0 to 3.7 px, `lz-fet-lean` rocks 1.8 degrees, `lz-fet-skirt` swings 2.2 degrees, and the arms (`lz-fet-nu`, `-nfo`, `-fu`, `-ffo`) swing against the legs. A planted foot moves less than half a pixel. `lz-fet-calm` (closed smile) and `lz-fet-smile` (open grin) swap. Stubby legs have no knee, so there are no shin classes.
- `../art.svg` (viewBox 0 0 200 220, transparent): Louise in her office door as a front-facing vinyl-toy figure, head tipped 4 degrees, both cartoon eyes looking at you through her big square glasses, the chain drooping across her collar, a navy book held against her side, the other mitt waving. Groups `lz-door-shadow`, `lz-door-body`, `lz-door-head` (with `lz-door-glasses`, `lz-door-chain`), `lz-door-arms`; `.lz-door-wave` rotates the raised forearm and mitt about the elbow (158, 138), 2 s ease-in-out, about -10 to +6 degrees. She reads at about 112 px tall.
- `../mark.svg` (viewBox 0 0 48 48): bookplate seal with glasses on a chain; no motion; holds at 16 px.
