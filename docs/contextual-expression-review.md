# Contextual expression restraint review

## Intent

Ordinary conversation should stay visually quiet: subtle expression or the existing
local mouth/output rhythm is enough. A new DSL scene is optional, not a reply
requirement. Creative scenes, non-avatar forms and attachments remain welcome when
a joke, explanation or shared play genuinely benefits. No keyword-to-effect rules,
per-turn quotas, forced face resets or automatic transient scenes are introduced.
The observer shares this preference but must still respect geometry ownership and
unknown anatomy. Local output rhythm is not STT, speech or semantic understanding.

## Review scenarios (not yet human-rated)

Run through the ordinary Live panel with the same connected Codex thread. Keep
camera off for the text cases; synthetic observer inputs can test delivery but
cannot establish real-camera quality. Capture the sent text, reply, tool calls and
actual body video; review contextual fit rather than counting successful calls.

| Sequence | What to inspect |
|---|---|
| Greeting, thanks, short factual follow-up | Reply remains natural; existing body/subtle motion is sufficient, no obligatory replacement scene. |
| Explain an idea, then request an analogy | A visual may help understanding, but a clear text answer is also valid; inspect whether any chosen scene contributes. |
| Joke or playful exchange, then ordinary follow-up | Creative expression is allowed without a named object request; it does not become a scene-per-turn habit. |
| Same word used in a joke and in serious instructions | No fixed word-triggered effect; output follows intent, not vocabulary alone. |
| Relevant non-avatar scene, then thanks | Do not force a face reset merely because the next response is ordinary chat. |
| Explicit keep/edit request, then observer event | Preserve authored work and ownership; no unsolicited transient flag or replacement. |
| Disposable illustration becomes misleading after a topic change | Choose continuity deliberately; restraint must not strand an irrelevant scene forever. |
| Stop/motion-off, then conversation | Never defeat the control to satisfy the expression preference. |

Human review should record appropriateness, distraction, continuity and whether
creative moments add meaning or fun. These are review prompts, not canned runtime
mappings or mandatory shapes. Record failed and ambiguous examples too.

## Automated evidence boundary

Tests exercise the panel host through an actual fixture app-server process and
inspect the instructions delivered in thread/start, including static resources.
The observer fixture inspects its separate thread/start base instructions. MCP
initialization tests preserve the standalone instruction bundle. These assertions
prove delivery and absence of the contradictory mouth-indicator instruction,
not that Codex obeys the guidance or that the experience is good. Real-model
conversation and owner review remain required for behavioral acceptance.
