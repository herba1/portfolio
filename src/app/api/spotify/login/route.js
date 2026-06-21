// GET /api/spotify/login — one-time: redirects to Spotify's consent screen.
// Visit this once (with CLIENT_ID/SECRET set) to obtain a refresh token.

export async function GET(request) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) return new Response("Set SPOTIFY_CLIENT_ID in .env.local first.", { status: 500 });

  // Spotify rejects http://localhost — force the loopback IP (or use an override)
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ||
    new URL(request.url).origin.replace("://localhost", "://127.0.0.1") + "/api/spotify/callback";

  const params = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "user-top-read user-read-recently-played",
  });
  return Response.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
