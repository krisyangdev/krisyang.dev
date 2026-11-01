// Everything the homepage lists. The 3D scene and the plain HTML fallback both read this file.
// href null = not public yet: the card hangs on the wall but opens nothing.

export const links = [
  { id: "x", label: "X", href: "https://x.com/krisyangdev" },
  { id: "github", label: "GitHub", href: "https://github.com/krisyangdev" },
  { id: "email", label: "Email", href: "mailto:ruiyang0012@gmail.com" },
];

// wall order: first three on the first line, the rest on the second
export const works = [
  { id: "yarn", title: "Yarn World", image: "/works/yarn.webp", href: "https://yarn.krisyang.dev" },
  { id: "jelly", title: "Jelly Zoo", image: "/works/jelly.webp", href: "https://jelly.krisyang.dev" },
  { id: "motionboard", title: "Motionboard", image: "/works/motionboard.webp", href: "https://motionboard.app" },
  { id: "lerro", title: "Lerro", image: "/works/lerro.webp", href: "https://lerroapp.com/" },
  { id: "chatllm", title: "ChatLLM", image: "/works/chatllm.webp", href: "https://chatllm-web.pages.dev" },
];
