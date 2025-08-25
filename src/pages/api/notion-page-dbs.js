export async function GET({ request, url }) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }
  const accessToken = authHeader.split(" ")[1];

  const pageId = url.searchParams.get("pageId");
  if (!pageId) {
    return new Response(
      JSON.stringify({ error: "Missing required pageId query parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  async function fetchAllChildrenBlocks(parentId) {
    let results = [];
    let hasMore = true;
    let startCursor = undefined;
    while (hasMore) {
      const apiUrl = `https://api.notion.com/v1/blocks/${parentId}/children?page_size=100${startCursor ? `&start_cursor=${startCursor}` : ""}`;
      const res = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Notion-Version": "2022-06-28",
        },
      });
      if (!res.ok) {
        const txt = await res.text();
        return {
          error: `Failed to fetch block children: ${txt}`,
          _status: res.status,
        };
      }
      const data = await res.json();
      results = results.concat(data.results || []);
      hasMore = !!data.has_more;
      startCursor = data.next_cursor;
    }
    return { results };
  }

  const childBlocksResult = await fetchAllChildrenBlocks(pageId);
  if (childBlocksResult.error) {
    return new Response(JSON.stringify({ error: childBlocksResult.error }), {
      status: childBlocksResult._status || 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dbs = [];
  for (const block of childBlocksResult.results) {
    if (block.type === "child_database" && block.child_database) {
      let displayName = "";
      const titleRaw = block.child_database.title;
      if (Array.isArray(titleRaw)) {
        displayName = titleRaw.map((t) => t.plain_text || "").join("") || "";
      } else if (typeof titleRaw === "string") {
        displayName = titleRaw;
      } else if (block.child_database.name) {
        displayName = block.child_database.name;
      }
      if (!displayName) displayName = "(Untitled DB)";
      dbs.push({
        id: block.id,
        title: displayName,
      });
    }
  }

  return new Response(JSON.stringify({ databases: dbs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
