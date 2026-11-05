// Returns a short-lived signed URL for a clip's reveal segment,
// only if the caller has already placed a bet on that clip.
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  const { clipId } = await req.json();
  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: bet } = await user.from('bets').select('id').eq('clip_id', clipId).maybeSingle();
  if (!bet) return new Response(JSON.stringify({ error: 'no bet on this clip' }), { status: 403 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: clip } = await admin.from('clips').select('reveal_asset_id').eq('id', clipId).single();
  // reveal_asset_id = path in the private "reveals" storage bucket (swap for Mux signed playback later)
  const { data: signed, error } = await admin.storage.from('reveals').createSignedUrl(clip!.reveal_asset_id, 120);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ url: signed.signedUrl }), { headers: { 'Content-Type': 'application/json' } });
});
