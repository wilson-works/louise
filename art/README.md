# Louise: art notes (character model and room)

For whoever draws her next scenes or films her. The model is `researching.svg`; copy from it, do not re-invent her.

## Character model (as drawn)
- Real seated-adult proportions, not chibi. At the desk her head is about 48 units tall (crown y 150, chin y 198, eye line y 172); the door figure (`../art.svg`) is a touch larger-headed (about 1/5.5) so she reads at 112 px.
- Face: slightly long nose with a soft bump, laugh lines at the eye corner, small determined chin, gentle closed smile, rosy cheek as a soft shadow shape (#D68E7F at .4, no circles). Skin #E9BE9F, shadow #D29C7E.
- Hair: silver-white #DCD8D0, shadow #B9B3A8, soft bun at the crown with loose wisps, a yellow pencil (#EDB82E, eraser #D9776B) pushed through it.
- Glasses: BIG square tortoiseshell, frame #5A3A22 over an ink edge #2A1D14, two lenses in a three-quarter hint (far lens a sliver). Lens glass #A9E4F2 at low opacity. Gilt chain #D9A441 (beads #E8C27A) from each temple arm down behind the neck.
- Clothes: cardigan #2F5A45 (knit #3E7259, shadow #24473A), cream blouse #FBF6EA with a rounded collar, gilt brooch with a garnet #7E2626, oxblood tweed skirt #6E2A26, dark stockings #3A2F3A, brown low-heeled shoes #6B4A2E.
- Drawing hand: flat fills, ink #2A1D14 outline (2 at 640 wide, 1.2 for small details, round caps and joins), one shadow tone per material, light as translucent shapes. Two lights: warm lamp from the upper right (#F2C46B), cool screen glow on face and hands (#A9E4F2 / #7FD6E8, `mix-blend-mode: screen` on the face).
- Props: beige CRT #DDD1B3 (light #EDE4CE, shade #C6B893, deep #A29372), oak desk #7A5030 (top #9A6A3F, edge #5C3B22), brass #D9A441, red marker #C62828.

## Room layout (viewBox 0 0 640 400, same in every desk scene)
- Wall to y 244; oak wainscot y 244 to 340; floor line y 340; floor to 400. Shelf x 516 to 640, full height, boards at y 96, 168, 240, 312.
- Desk: top surface y 250 to 270, edge to y 280; drawer pedestal x 14 to 188 (y 280 to 382); right leg x 490 to 510; kneehole x 188 to 490.
- Beige tower under the desk x 200 to 262, y 300 to 382. Monitor on the desk: case x 119 to 268, y 148 to 262, screen glass edge at x 262 to 270, facing right. Keyboard x 276 to 372 (top about y 252 to 260). Mouse and pad x 438 to 482 (behind her, right of the keyboard).
- Chair: seat x 414 to 500, y 300 to 313; post x 447; back rail x 466 to 496, y 222. Louise: hips about (440, 300), shoulder (386, 230), nose tip x 292 (screen glass at x 270), feet at y 384. Banker's lamp x 482 to 516. Book stack x 26 to 88, mug of pens (red marker) x 98 to 120.

## Naming and scoping (the dashboard puts these inline, two at once)
- Root id `lz-<scene>` (`lz-researching`, `lz-door`), class `lz-scene`, `role="img"` with a `<title>`.
- Every id starts with the scene's short prefix (`lz-res-`, `lz-idl-`, `lz-cou-`, `lz-dis-`, `lz-shl-`, `lz-fet-`; door: `lz-door-`); every CSS rule starts with the root id (`#lz-researching ...`); every keyframe is named `<prefix><thing>`. No bare element selectors, no `<text>`, `<image>`, `<script>` or links.
- Animate `transform` and `opacity` only. Rotations use `transform-box: view-box` with an explicit pixel origin. Ambient loops `ease-in-out`, typing and LEDs `steps()`.
- Reduced motion: `@media (prefers-reduced-motion: reduce){ #<root> *{animation:none !important} }`. The un-animated pose must be a good frame.
- Safety: nothing flashes more than 3 times a second; the screen flicker stays between opacity .78 and 1.

## Files and motion
- `researching.svg`: groups `lz-res-room`, `lz-res-desk`, `lz-res-light`, `lz-res-pc`, `lz-res-louise` (chair, legs, `lz-res-lean` holding torso, head, both arms), `lz-res-lamp`. Motion: `.lz-res-glow` screen light brightens and settles (2.4 s); `.lz-res-band-a/b/c` light bands sweep toward her face (2.4 s, staggered); `.lz-res-hand-l` (1.2 s) and `.lz-res-hand-r` (1.5 s) bob 1 to 2 px in steps; `.lz-res-lean` leans 1.6 px (6 s); `.lz-res-led-disk` amber disk light blinks (3.7 s).
- `idle.svg` (`lz-idl-`): she sits back with a cup of tea in both hands, her glasses resting on their chain against her chest, eyes softly closed. Motion: `.lz-idl-steam-a/b/c` three wisps rise from the cup (4 s, staggered 1.35 s); `.lz-idl-breath` 1 px (5 s); `.lz-idl-glow` the idle monitor's dim glow (8 s, opacity .55 to .7).
- `council.svg` (`lz-cou-`): she reads an open book held up before her, glasses on, the banker's lamp lit; five slim books on the desk, one per reader. Motion: `.lz-cou-leaf` a page leaf turns (700 ms every 5.6 s); `.lz-cou-pupil` her eyes travel the lines (2.2 s); `.lz-cou-breath` (5 s).
- `distill.svg` (`lz-dis-`): she leans over ruled sheets with the red marker, its cap on the desk, a pile of finished index cards with red ticks at the left; the keyboard is pushed back. Motion: `.lz-dis-m1/m2/m3` two strike-throughs and a circled word draw in (`stroke-dashoffset`) then fade (3.5 s loop); `.lz-dis-hand` follows each stroke; `.lz-dis-breath` (5 s).
- `shelving.svg` (`lz-shl-`): she stands at a three-shelf book cart in side profile, knees soft, stooping a little; she lifts the top book from a short stack on the desk, turns it upright and slides it into the empty slot on the cart's top shelf. One 3 s ease-in-out loop: `.lz-shl-lean`, `.lz-shl-u` / `.lz-shl-fo` (near arm), `.lz-shl-book`, `.lz-shl-top` / `.lz-shl-newbook` (an opacity swap), `.lz-shl-far`, `.lz-shl-nod`, `.lz-shl-breath`. The cart is `lz-shelving-cart`: the dashboard launches its flying spines from 50% across and 30% down that group's box, so its top shelf stays in the upper third.
- `fetching.svg` (`lz-fet-`): a 4.8 s loop. She turns and walks to the bookcase (0.22 to 1.54 s), reaches up and draws an oxblood book from the third shelf (1.98 to 2.3 s; `lz-fet-spine` leaves a gap), turns, walks back (2.58 to 3.84 s) and holds the book up in both hands, cover toward us, smiling (from about 4.0 s; the dashboard opens the book at 4.4 s). The un-animated frame is that presenting pose. She is the standing profile figure mirrored by `lz-fet-turn`; the legs are driven by inverse kinematics so planted feet do not slide, and the gait keyframes were sampled by a script, so they are dense lists of small steps: change the pose, not single keyframes.
- `../art.svg` (viewBox 0 0 200 220, transparent): Louise in her office door, turned three-quarters toward you, weight on one leg, head tipped a little, a navy book in the crook of one arm, a plain oxblood A-line skirt. Groups `lz-door-shadow`, `lz-door-body`, `lz-door-head`, `lz-door-arms`; `.lz-door-wave` rotates the raised forearm about the elbow (2 s ease-in-out, about -10 to +6 degrees). She reads at about 112 px tall.
- `../mark.svg` (viewBox 0 0 48 48): bookplate seal with glasses on a chain; no motion; holds at 16 px.
