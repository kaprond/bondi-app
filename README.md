# bondi

Scroll short clips. The clip pauses. Call what happens next with free coins. The clip plays on and you find out.
Coins are free, can't be bought and can't be cashed out.

Built with Expo (SDK 58, React Native) and Supabase. Brand: bondi teal `#0095B6`, Baloo 2 + Quicksand.

## What's in the app

- **feed**: full-screen vertical clips. The teaser plays to the pause point, the screen flashes and dims, the bet sheet slides up. Pick a side and a stake, lock it in, the reveal plays, then a result card with confetti, a count-up, how the crowd and your friends called it, a "brag" share and a "check it was fair" proof.
- **pools**: coin pools with friends ("who wins sunday's padel final?"). Subject consent, people in the outcome can't stake, 48 hour confirm or dispute, no majority means everyone gets their coins back. Blocked topics: drinking, drugs, health or injury, dating, looks, danger or crime, self-harm.
- **random challenge generator**: pick a crew and a vibe, roll the dice for a pool idea, or "surprise me" while creating one. 26 templates, all checked against the blocked-topic list.
- **friends**: invite code and share link (both get 500 coins), search by @handle, friend requests, people you might know, crews, a leaderboard of your sharpest friends, and a profile sheet per person.
- **me**: emoji avatar and colour, name, @handle, city, bio, coin balance with the daily 500, stats, badges, recent calls.
- **onboarding**: 18+ gate, then "make it yours" profile setup.

## Code map

- `App.tsx`: fonts, age gate, onboarding, tabs (for you, pools, friends, me), toast
- `src/components/ClipCard.tsx`: teaser, pause flash, bet sheet, reveal, result
- `src/components/BetSheet.tsx`, `ResultOverlay.tsx`, `Confetti.tsx`, `CountUp.tsx`
- `src/components/PoolsScreen.tsx`: pool list, challenge card, create pool, pool detail
- `src/components/FriendsScreen.tsx`, `PersonSheet.tsx`: friends, requests, crews, invite
- `src/components/ProfileScreen.tsx`, `SetupProfile.tsx`: profile, editor, onboarding step
- `src/api.ts`: `BondiApi`. Uses `src/supabaseApi.ts` when `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set, otherwise an in-memory demo
- `src/social.ts`, `src/pools.ts`, `src/challenges.ts`, `src/moderation.ts`: demo stores that mirror the SQL
- `supabase/migrations/`
  - `0001_init.sql`: clips with hidden outcome, bets, append-only coin ledger, atomic `place_bet`
  - `0002_friend_pools.sql`: groups, pools, consent, conflict rule, confirm or dispute, refunds
  - `0003_profiles_trigger.sql`: profile and 1,000 coin signup grant
  - `0004_social.sql`: profile fields, friendships, invite codes and redemptions, crews
- `supabase/functions/reveal-url`: signed reveal URL, only after the caller has bet

## Fairness

- The outcome and reveal URL only come back after the stake is debited.
- Each clip has `commit_hash = sha256(id|outcome|salt)`, published before it goes live. The salt is returned after the bet, so anyone can check it.
- A player never sees the same clip twice.

## Run

```bash
npm install
npx expo start      # Expo Go on a phone, or press w for web
npm test            # challenge generator + moderation checks
npm run typecheck
```
