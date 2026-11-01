// Homepage scene entry: one fixed canvas behind the page, scrolled 1:1 with it.
import { createStage } from "./stage.js";
import { createHero } from "./hero.js";
import { createWall } from "./wall.js";
import { createBird } from "./bird.js";
import { createNightLights } from "./night-lights.js";
import { createPullCord } from "./pullcord.js";

const root = document.documentElement;

try {
  const stage = createStage(document.getElementById("stage"));
  const ctx = {
    scene: stage.scene,
    camera: stage.camera,
    interaction: stage.interaction,
    breeze: stage.breeze,
    daynight: stage.daynight,
  };
  const [hero, wall] = await Promise.all([createHero(ctx), createWall(ctx)]);
  // these live on the hero line, so they read it after hero.update each frame
  const bird = createBird({ ...ctx, hero });
  const nightLights = createNightLights({ ...ctx, hero });
  const cord = createPullCord(ctx);
  stage.onUpdate((dt, t) => {
    hero.update(dt, t);
    wall.update(dt, t);
    bird.update(dt, t);
    nightLights.update(dt, t);
    cord.update(dt, t);
  });
  // compile every shader before the first frame so the letter drop-in intro does not stutter
  // (things that appear later, like the letters waiting to drop, are hidden: show them while compiling)
  const hidden = [];
  stage.scene.traverse((o) => !o.visible && hidden.push(o));
  hidden.forEach((o) => (o.visible = true));
  await stage.renderer.compileAsync(stage.scene, stage.camera);
  hidden.forEach((o) => (o.visible = false));
  stage.start();
  root.classList.add("scene-ready");
  if (import.meta.env.DEV) window.__home = { stage, hero, wall, bird, nightLights, cord };
} catch (err) {
  console.error(err);
  root.classList.add("scene-failed"); // shows the plain HTML version
}
