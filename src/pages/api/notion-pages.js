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
    filter: { property: "object", value: "page" },
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
        JSON.stringify({ error: "Failed to fetch Notion pages", details: err }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const data = await notionRes.json();

    const pages = (data.results || [])
      .filter((i) => i.object === "page")
      .map((page) => {
        let title = "(Untitled Page)";
        try {
          const props = page.properties || {};
          for (const key in props) {
            const prop = props[key];
            if (prop.type === "title" && prop.title && prop.title.length > 0) {
              title = prop.title.map((t) => t.plain_text).join("");
              break;
            }
          }
        } catch {}
        return {
          id: page.id,
          title,
        };
      });

    return new Response(JSON.stringify({ pages }), {
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
