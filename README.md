# Chief

A personal AI chief of staff. Chief remembers what you committed to, checks whether it happened, and makes you choose when you take on too much.

## What's here

| Folder | What it is |
| --- | --- |
| `mobile/` | The Android app (Expo / React Native). Talk to Chief by holding the mic, see today's steps, do the evening check-in, manage projects. |
| `supabase/migrations/` | Database tables. Every row belongs to one user; database rules keep users apart. |
| `supabase/functions/chief/` | Chief's brain: new-project interview and trade-offs, day planning, replanning after missed steps. |
| `supabase/functions/transcribe/` | Turns voice recordings into text (English and Hinglish). |
| `.github/workflows/` | Builds `chief-N.apk` on every change to `mobile/` and publishes it under Releases. |

## Install the app

Open the latest release on your Android phone, download `chief-N.apk`, and open it. Android will ask to allow installs from your browser the first time.

## Server settings (Supabase → Edge Functions → Secrets)

- `OPENAI_API_KEY`: required for the brain and for voice.
- `CHIEF_MODEL`: optional, overrides the default model.
- `CHIEF_STT_MODEL`: optional, overrides the default speech-to-text model.
