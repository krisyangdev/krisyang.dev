// World layout shared by every scene module.
//
// Units: 1 world unit ~ 0.8 of a hero letter. Everything hangs in the z = 0 plane and faces +z;
// the camera looks down -z. A cream backdrop at BACKDROP_Z catches the soft shadows.
// y grows upward. The page scrolls the camera down 1:1 with the page (stage.js owns the px <-> unit map),
// so content further down the page sits at lower y.

// palette from the yarn world
export const P = {
  cream: "#f6ecdc",
  paper: "#eedfcb", // page background and backdrop
  white: "#fbf4ea",
  oat: "#e9dcc6", // undyed rope
  sage: "#a8c09a",
  mustard: "#e2b04a",
  coral: "#ef8f86",
  pink: "#f4a79d",
  sky: "#8ec5df",
  lavender: "#b8a6d9",
  terracotta: "#d0694a",
  charcoal: "#3b3633",
  wood: "#dcbc94",
  thread: "#6b4a3a", // embroidery and label ink
};

// deep enough for a work card (about 3.8 from line to bottom edge) to twirl a full turn around its line without entering the wall
export const BACKDROP_Z = -4.6;

// Camera framing: the camera sits on +z at the distance where HERO_FIT_WIDTH fills the view width
// (but never closer than MIN_CAMERA_Z). At scroll 0 the camera looks at (0, CAMERA_START_Y).
export const CAMERA_FOV = 30;
export const HERO_FIT_WIDTH = 18;
export const MIN_CAMERA_Z = 20;
export const CAMERA_START_Y = 0;

// Hero clothesline: anchored off screen at (±ANCHOR_X, LINE_Y), sags about SAG in the middle
// once the letters hang on it. Letters are LETTER_SIZE tall (cap height) and hang below the line.
export const HERO = {
  lineY: 2.7,
  anchorX: 14,
  sag: 0.9,
  letterSize: 1.4,
  text: "KRIS YANG",
  letterColors: ["coral", "mustard", "sage", "lavender", null, "sky", "pink", "mustard", "sage"],
  tagColor: "white",
};

// Works wall: two lines of three cards, then a garland of small charms, then the page ends.
// The first line sits high enough that its cards peek in at the bottom of the first screen, so visitors see there is more below.
export const WALL = {
  lines: [
    { y: -2.1, color: "coral" },
    { y: -7.9, color: "mustard" },
  ],
  anchorX: 14,
  cardWidth: 3.0,
  cardHeight: 3.55, // felt frame; the photo is a cardWidth - 0.4 square near the top
  cardGap: 1.1,
  charms: { y: -13.1, color: "sage" },
};

// lowest world y that must be reachable by scrolling (bottom edge of the view at max scroll)
export const CONTENT_BOTTOM = -16.9;
