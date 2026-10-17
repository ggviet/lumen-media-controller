# Changelog

All notable changes to the LUMEN Event Media Controller project are documented here.

## [2.0.0] - 2026-10-17

### Added
- **Broadcast Dual-Monitor Engine (PVW / PGM):** Replaced single screen view with dedicated Preview (PVW - Green Tally) and Program (PGM - Red Tally "ON AIR") side-by-side monitors.
- **Dual-Deck Hardware Playback:** Implemented Player A & Player B crossfade engine on the Stage display to eliminate black frames when switching clips.
- **Fail-Safe Emergency Controls:** Added 1-touch Panic triggers:
  - `SAFE LOGO` (`[L]`): Smooth transition to key visual / safety logo.
  - `FREEZE` (`[F]`): Instant display freeze for off-stage preparation.
  - `FADE TO BLACK` (`[T]`): 1-second gentle fade down of video and audio.
  - `BLACKOUT` (`[B]` / `[ESC]`): Instant total blackout.
- **Multi-Monitor & Hotplug Resilience:** Added active detection for HDMI displays, dynamic output selection, and auto-recovery when cables are reconnected.
- **OS Sleep Prevention:** Integrated `powerSaveBlocker` to ensure Windows screensavers or standby never interrupt an ongoing event.
- **End Behavior per Cue:** Added support for `HOLD_LAST_FRAME`, `LOOP`, `AUTO_NEXT`, and `FADE_TO_BLACK`.
- **Audio Routing & Monitoring:** Added support for custom audio output devices via `setSinkId`, real-time stereo VU meters, and master fader.
- **Live Overlays:** Dynamic marquee ticker with live push capability and event logo watermark.
- **Built-in Demo Asset Suite:** Bundled sample SVG key visual, countdown timer, and brand logos for immediate testing.
- **Zero Cursor Leak:** Enforced `cursor: none !important;` across all Stage display layers.

### Changed
- Refactored entire IPC communication bus between Main, Operator, and Stage windows.
- Upgraded Operator Dashboard to high-contrast Broadcast Studio Dark Theme.
- Rewrote specification document in `ideas/event_media_controller.md` to reflect production-grade event standards.
