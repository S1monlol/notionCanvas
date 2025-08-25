export async function GET({ request }) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const accessToken = authHeader.split(" ")[1];

  const notionApiUrl = "https://api.notion.com/v1/search";
  const payload = {
    filter: { property: "object", value: "database" },
    sort: { direction: "ascending", timestamp: "last_edited_time" },
    page_size: 100,
  };

  try {
    const notionRes = await fetch(notionApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify(payload),
    });
    if (!notionRes.ok) {
      const err = await notionRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: "Failed to fetch databases", details: err }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    const data = await notionRes.json();
    const dbs = (data.results || [])
      .filter((i) => i.object === "database")
      .map((db) => ({
        id: db.id,
        title:
          Array.isArray(db.title) && db.title.length > 0
            ? db.title.map((t) => t.plain_text || "").join("")
            : db.title && typeof db.title === "string"
              ? db.title
              : db.properties?.Name?.name || "(Untitled)",
      }));

    return new Response(JSON.stringify({ databases: dbs }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "Exception querying Notion API",
        details: e.message,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
