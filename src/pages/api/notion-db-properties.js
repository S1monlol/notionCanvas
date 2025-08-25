export async function GET({ request, url }) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const accessToken = authHeader.split(" ")[1];

  const dbId = url.searchParams.get("dbId");
  if (!dbId) {
    return new Response(
      JSON.stringify({ error: "Missing required dbId query parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const notionApiUrl = `https://api.notion.com/v1/databases/${dbId}`;
  try {
    const notionRes = await fetch(notionApiUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
    });
    if (!notionRes.ok) {
      const txt = await notionRes.text();
      return new Response(
        JSON.stringify({
          error: "Failed to fetch database info",
          details: txt,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const db = await notionRes.json();
    const properties = [];
    for (const [propName, propObj] of Object.entries(db.properties)) {
      const prop = {
        id: propObj.id,
        name: propName,
        type: propObj.type,
      };

      if (propObj.type === "select" && propObj.select?.options) {
        prop.options = propObj.select.options.map((o) => ({
          name: o.name,
          id: o.id,
          color: o.color,
        }));
      }
      if (propObj.type === "multi_select" && propObj.multi_select?.options) {
        prop.options = propObj.multi_select.options.map((o) => ({
          name: o.name,
          id: o.id,
          color: o.color,
        }));
      }
      properties.push(prop);
    }
    return new Response(JSON.stringify({ properties }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Exception querying Notion API",
        details: String(e),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
