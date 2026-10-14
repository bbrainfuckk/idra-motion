# idra-motion: notes for AI agents working in this repo

- To make a video, follow `skills/idra-motion/SKILL.md`. The method in full is `docs/one-shot.md`;
  narration is `docs/narration.md`.
- Scenes are HTML pages whose every frame comes from `t` alone (`engine/`). No CSS transitions,
  animations or timers in a scene.
- Check frames with `node render.mjs <scene>.html out/check.jpg --stills <times>` and look at the image
  before rendering a video.
- `npm test` drives the MCP server (`mcp/server.mjs`) end to end; run it after changing the server or
  the renderer. Nothing may be written to stdout in the server except JSON-RPC.
- No dependencies: Node built-ins only. Keep it that way.
- Never put an API key in a file git tracks; keys live in `.env` (ignored) or the environment.
- idra-motion is source available (LICENSE). Videos made with it belong to whoever made them.
