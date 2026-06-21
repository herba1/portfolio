// GET /api/spotify/callback — exchanges the auth code for tokens and prints the
// refresh token to paste into .env.local. Used once during setup.

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const oauthErr = url.searchParams.get("error");
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (oauthErr) return new Response(`Spotify denied/errored: ${oauthErr}`, { status: 400 });
  if (!id || !secret) {
    return new Response(
      `Server is missing ${!id ? "SPOTIFY_CLIENT_ID" : "SPOTIFY_CLIENT_SECRET"}. ` +
        `Check .env.local and restart the dev server.`,
      { status: 500 },
    );
  }
  if (!code) {
    return new Response(
      `No ?code in the URL — don't open this page directly. ` +
        `Start the flow at ${url.origin}/api/spotify/login`,
      { status: 400 },
    );
  }

  // must EXACTLY match the redirect_uri used in /login (forced to 127.0.0.1)
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ||
    url.origin.replace("://localhost", "://127.0.0.1") + "/api/spotify/callback";

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json();
  if (!json.refresh_token) {
    return Response.json(json, { status: 400 });
  }

  return new Response(
    `<pre style="font:14px/1.7 ui-monospace,monospace;padding:32px;color:#1a1a1a;background:#f1f5f9">` +
      `✅ Add this to .env.local, then restart the dev server:\n\n` +
      `SPOTIFY_REFRESH_TOKEN=${json.refresh_token}\n</pre>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
