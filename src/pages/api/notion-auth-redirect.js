export async function GET({ url, redirect }) {
  const NOTION_CLIENT_ID = import.meta.env.NOTION_CLIENT_ID;
  const NOTION_REDIRECT_URI = import.meta.env.NOTION_REDIRECT_URI;

  if (!NOTION_CLIENT_ID || !NOTION_REDIRECT_URI) {
    return new Response(
      "NOTION_CLIENT_ID or NOTION_REDIRECT_URI environment variables not set.",
      { status: 500 },
    );
  }

  const state = url.searchParams.get("state") ?? "";

  const params = new URLSearchParams({
    owner: "user",
    client_id: NOTION_CLIENT_ID,
    redirect_uri: NOTION_REDIRECT_URI,
    response_type: "code",
  });
  if (state) params.append("state", state);

  const authorizationUrl = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;

  return redirect(authorizationUrl, 302);
}
