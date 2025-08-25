import { findOrCreateUser } from "../../lib/db.js";

const NOTION_CLIENT_ID = import.meta.env.NOTION_CLIENT_ID;
const NOTION_CLIENT_SECRET = import.meta.env.NOTION_CLIENT_SECRET;
const NOTION_REDIRECT_URI = import.meta.env.NOTION_REDIRECT_URI;

export async function GET({ url, params }) {
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response(
      `<h2>Error: Missing code</h2><p>The Notion OAuth callback did not provide a code.</p>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  const tokenEndpoint = "https://api.notion.com/v1/oauth/token";
  const credentials = Buffer.from(
    `${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`,
  ).toString("base64");

  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: NOTION_REDIRECT_URI,
  };

  let tokenResponse;
  try {
    tokenResponse = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("Failed to reach Notion token endpoint:", err);
    return new Response(
      `<h2>Error: Network error</h2><pre>${err.message}</pre>`,
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    return new Response(
      `<h2>Error exchanging authorization code</h2><pre>${errorText}</pre>`,
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
  }

  const tokens = await tokenResponse.json();

  let userInfo;
  try {
    const userResponse = await fetch("https://api.notion.com/v1/users/me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!userResponse.ok) {
      throw new Error(`Failed to fetch user info: ${userResponse.statusText}`);
    }

    userInfo = await userResponse.json();
  } catch (err) {
    console.error("Failed to fetch user info from Notion:", err);
    return new Response(
      `<h2>Error: Could not fetch user information</h2><pre>${err.message}</pre>`,
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
  }

  let dbUser;
  try {
    dbUser = await findOrCreateUser({
      access_token: tokens.access_token,
      user: userInfo,
      workspace_id: tokens.workspace_id,
      workspace_name: tokens.workspace_name,
    });
  } catch (err) {
    console.error("Failed to store user in database:", err);
    return new Response(
      `<h2>Error: Could not save user data</h2><pre>${err.message}</pre>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  const redirectSetup = "/setup";

  return new Response(
    `
    <html>
      <head>
        <meta http-equiv="refresh" content="0; url='${redirectSetup}'" />
        <title>Setting up Notion Integration...</title>
      </head>
      <body>
        <script>
          window.localStorage.setItem("notion_oauth_access_token", ${JSON.stringify(tokens.access_token)});
          window.localStorage.setItem("notion_user_id", ${JSON.stringify(dbUser.id)});
          window.location.replace("${redirectSetup}");
        </script>
        <p>Setting up your Notion integration... If you are not redirected, <a href="${redirectSetup}">click here</a>.</p>
      </body>
    </html>
    `,
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
}
