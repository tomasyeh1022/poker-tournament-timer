# Google Translate English timer prompts

Generated on 2026-09-15 through Google Translate text to speech using
[gTTS 2.5.4](https://gtts.readthedocs.io/en/latest/). Only the ten short phrases
below were submitted. Playback uses these local files and needs no network call.

## Actual source and voice settings

- Service: Google Translate text to speech.
- Request host: `translate.google.us` (gTTS's standard endpoint).
- Parameters: `lang="en"`, `tld="us"`, `slow=False`, `lang_check=False`.
- The [gTTS accent table](https://gtts.readthedocs.io/en/latest/module.html#localized-accents)
  documents `en` + `us` for United States English.
- gTTS exposes no gender selector or stable voice ID. The service does not
  return a voice identity in this response. These files should not be labeled
  with a named Google Cloud voice, or presented as a guaranteed gender setting.
- The software license for gTTS does not itself license Google's service output.

## Processing and verification

The original MP3 responses are preserved in the development workspace under
`work/google-voice-assets/raw/` (not included in the application). FFmpeg, obtained through
`imageio-ffmpeg` 0.6.0, decoded them into PCM WAV at 24,000 Hz, 16-bit, mono.
Only leading and trailing silence was trimmed, preserving 40 ms before the
first detected speech sample and 80 ms after the last. No interior speech was
cut. No clip required acceleration, resampling of pitch, or voice conversion.

Every WAV parsed successfully and contains nonzero audio samples. Total WAV
size is 417,024 bytes. Speech content and perceived voice gender have not been
verified through actual listening in this subtask; use the samples for review.
`measurements.json` records durations, waveform RMS, peaks and SHA-256 hashes.
`work/google-voice-assets/generate.py` in the development workspace records
the generation and processing procedure.

| WAV filename | Submitted text | Final duration |
| --- | --- | --- |
| `start.wav` | Let's get started | 1.2327 s |
| `ten-minutes.wav` | Ten minutes | 1.0893 s |
| `five-minutes.wav` | Five minutes | 1.1705 s |
| `three-minutes.wav` | Three minutes | 1.0942 s |
| `one-minute.wav` | One minute | 0.9081 s |
| `five.wav` | Five | 0.6806 s |
| `four.wav` | Four | 0.6213 s |
| `three.wav` | Three | 0.6173 s |
| `two.wav` | Two | 0.5975 s |
| `one.wav` | One | 0.6673 s |

The final five clips each finish within 0.9 seconds at normal playback speed.
The vendor tools and unprocessed MP3s are working files, not application assets.
