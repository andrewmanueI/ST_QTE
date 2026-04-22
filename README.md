# Quick Time Event

Quick Time Event is a lightweight QTE extension that presents a timed prompt, waits for a typed response, and returns a compact result.

## Features

- Timed response card with countdown progress.
- Typed answer submission.
- Skip/freeze action for immediate fallback.
- Timeout fallback when the timer expires.
- Marker detection for model-initiated events.
- Configurable default duration, maximum duration, prompt hint, and fallback text.
- Compact completed-card summary after each event.

## Marker mode

Use this marker when a timed response should be triggered from generated text:

```text
<qte seconds="5" intensity="high">The door bursts open. What do you say?</qte>
```

The extension removes the marker, opens the QTE card, and records a compact QTE result message after the timer resolves.

## Tool

The extension registers `start_qte_timer`.

Arguments:

- `prompt` required string shown to the user.
- `seconds` optional integer, default from settings, capped by the max seconds setting.
- `fallbackText` optional string returned when skipped or timed out.
- `intensity` optional enum: `low`, `medium`, `high`, or `critical`.

The tool returns:

```text
QTE result:
status: answered|timeout|skipped|error
prompt: ...
response: ...
elapsed_seconds: ...
```

## Development

This repo is intentionally plain JavaScript, CSS, and HTML. No build step is required.
