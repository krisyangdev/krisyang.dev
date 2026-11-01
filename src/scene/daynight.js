// Day or night, from the visitor's local clock (night 19:00 - 6:00), switchable by the pull cord.
// `night` eases between 0 (afternoon sun) and 1 (night with fairy lights); every module blends its look by it.
// ?time=day or ?time=night pins the start (screenshots, banners).

const NIGHT_FROM = 19;
const NIGHT_UNTIL = 6;
const FADE = 1.6; // s for a full switch
const CLOCK_CHECK = 60; // s between looks at the clock

const clockSaysNight = () => {
  const h = new Date().getHours();
  return h >= NIGHT_FROM || h < NIGHT_UNTIL;
};

const ease = (x) => x * x * (3 - 2 * x);

export function createDayNight() {
  const pinned = new URLSearchParams(location.search).get("time");
  let isNight = pinned ? pinned === "night" : clockSaysNight();
  let linear = isNight ? 1 : 0;
  let clockWasNight = clockSaysNight();
  let sinceCheck = 0;

  const state = {
    night: linear,
    get isNight() {
      return isNight;
    },
    set(value) {
      isNight = value;
    },
    toggle() {
      isNight = !isNight;
    },
    update(dt) {
      // follow the clock only when it crosses a boundary, so a manual switch sticks
      sinceCheck += dt;
      if (!pinned && sinceCheck > CLOCK_CHECK) {
        sinceCheck = 0;
        const now = clockSaysNight();
        if (now !== clockWasNight) isNight = now;
        clockWasNight = now;
      }
      const target = isNight ? 1 : 0;
      const step = dt / FADE;
      linear = linear < target ? Math.min(target, linear + step) : Math.max(target, linear - step);
      state.night = ease(linear);
    },
  };
  return state;
}
