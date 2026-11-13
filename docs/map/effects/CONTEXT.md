# Change impact - choose cards before editing

## Inputs
- Working: the exact requested change and diff.
- Reference: only the cards selected below.

## Process
1. DSL fields/geometry/motion -> [expression](../objects/expression.md), then
   [Live body](../objects/live-body.md) if presentation semantics change.
2. Chat errors/context freshness -> [conversation](../objects/conversation.md).
3. Scene replacement/cancel/pause -> [Live body](../objects/live-body.md), then
   [delivery](../processes/expression-delivery.md).
4. CLI/config path moves -> stop and inventory outside consumers before moving;
   this map has not enumerated personal installs, hooks or scheduled jobs.

## Outputs
A bounded affected-source/test list in the change or PR description.

## Check
Cold reviewer names a first-order hit and an obvious non-hit from the chosen card.
Do not copy card contents here or silently expand task scope.
