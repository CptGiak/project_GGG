// Scenario template for scripts/capture.mjs (real practice match, real kits, real VFX).
//   npm run dev   (in another shell)
//   node .claude/skills/animation-vfx/scripts/capture.mjs scenario this-file.mjs --out OUT_DIR --size 960x540
// Every film() advances BEFORE each capture (frame 1 = the first frame after the call). The clock is
// virtual and Math.random is seeded: the same scenario renders the same frames every run.
// Never edit src/ while this runs (Vite reloads the page mid-film).
export default async function (lab) {
  // CHAMP: the champion under test; botchamps: the dummy's champion
  await lab.open('champ=CHAMP&arena=stage&bots=1&botchamps=kaiser&quality=medium');
  await lab.advance(10);
  // open floor on the stage arena, facing -X
  await lab.place({ x: 40, z: 6, look: [0, 6] });
  await lab.dummy({ distance: 11 }); // frozen, immortal, standing on the floor in front of you
  await lab.advance(40);

  // --- one block per ability ---------------------------------------------------------------
  // 1) profile of the body animation
  await lab.ready(); // cooldowns 0, ultimate full
  await lab.camera({ mode: 'side', dist: 5.5, height: 1.35 });
  await lab.press('skill'); // attack | skill | secondary | ability | ultimate | jump | dash | taunt
  await lab.film('skill_side', { frames: 30, every: 2, cols: 8, gif: true });
  await lab.advance(90);

  // 2) the effect in flight and on impact (both fighters in frame), every frame
  await lab.ready();
  await lab.camera({ mode: 'side-wide', height: 1.4 });
  await lab.press('skill');
  await lab.film('skill_wide', { frames: 20, every: 1, cols: 7, gif: true });
  await lab.advance(90);

  // 3) the player's view (feel: camera kick, FOV punch, shake, readability over the shoulder)
  await lab.ready();
  await lab.camera({ mode: 'game' });
  await lab.press('skill');
  await lab.film('skill_game', { frames: 24, every: 1, cols: 8, gif: true });
  await lab.advance(90);

  // hold / release abilities:
  // await lab.hold('secondary'); await lab.film('charge', { frames: 60, every: 6 }); await lab.release('secondary');

  // inspect or tweak state in the page:
  // await lab.eval(({ match, local, dummy }) => { local.ult = 1; });
}
