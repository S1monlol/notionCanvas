import ical from "ical.js";
import { getUserByAccessToken } from "../../lib/db.js";

async function notionFetch(url, token, opts = {}) {
  const headers = Object.assign(
    {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    opts.headers || {},
  );
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  return res;
}

async function getExistingAssignmentTitles(databaseId, token) {
  const titles = [];
  let body = {};
  let res = await notionFetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    token,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to query database: ${txt}`);
  }
  let data = await res.json();
  const accumulate = (response) => {
    for (const page of response.results || []) {
      try {
        const t =
          page.properties?.Name?.title?.[0]?.plain_text ||
          page.properties?.Name?.title?.[0]?.text?.content;
        if (t) titles.push(t);
      } catch (e) {
        // ignore
      }
    }
  };
  accumulate(data);
  while (data.has_more) {
    const nextBody = { start_cursor: data.next_cursor };
    res = await notionFetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      token,
      {
        method: "POST",
        body: JSON.stringify(nextBody),
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Failed to query database (next page): ${txt}`);
    }
    data = await res.json();
    accumulate(data);
  }
  return titles;
}

export async function POST({ request }) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization Bearer token" }),
        { status: 401 },
      );
    }
    const token = authHeader.split(" ")[1];

    const body = await request.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: "Missing JSON body" }), {
        status: 400,
      });
    }

    const { calendarUrl, databaseId } = body;
    if (!calendarUrl || !databaseId) {
      return new Response(
        JSON.stringify({
          error: "Required fields: calendarUrl, databaseId",
        }),
        { status: 400 },
      );
    }

    const user = await getUserByAccessToken(token);
    if (!user) {
      return new Response(
        JSON.stringify({
          error: "Invalid or expired access token",
        }),
        { status: 401 },
      );
    }

    if (user.classes.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No classes found. Please add classes in the setup page.",
        }),
        { status: 400 },
      );
    }

    const dbRes = await notionFetch(
      `https://api.notion.com/v1/databases/${databaseId}`,
      token,
      { method: "GET" },
    );
    if (!dbRes.ok) {
      const txt = await dbRes.text();
      return new Response(
        JSON.stringify({
          error: "Failed to fetch database metadata",
          details: txt,
        }),
        { status: 502 },
      );
    }
    const dbMeta = await dbRes.json();
    const properties = dbMeta.properties || {};

    const dueDateProp = properties["Due Date"];
    if (!dueDateProp || dueDateProp.type !== "date") {
      return new Response(
        JSON.stringify({
          error: "Your Notion database is missing a 'Due Date' property.",
          details:
            "Please add a column named 'Due Date' (type: Date) in your Notion database, then try importing again.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    let classPropName = "Class";
    let classPropType = "rich_text";

    if (properties["Class"]) {
      classPropType = properties["Class"].type;
    }

    let datePropName = null;
    for (const [propName, propDef] of Object.entries(properties)) {
      if (propDef.type === "date") {
        if (propName.toLowerCase() === "deadline") {
          datePropName = propName;
          break;
        }
        if (!datePropName) datePropName = propName;
      }
    }

    let existingTitles = [];
    try {
      existingTitles = await getExistingAssignmentTitles(databaseId, token);
    } catch (e) {
      existingTitles = [];
    }

    const calResp = await fetch(calendarUrl);
    if (!calResp.ok) {
      const txt = await calResp.text();
      return new Response(
        JSON.stringify({ error: "Failed to fetch calendar URL", details: txt }),
        { status: 502 },
      );
    }
    const calText = await calResp.text();

    let calendar;
    try {
      calendar = ical.parse(calText);
    } catch (e) {
      return new Response(
        JSON.stringify({
          error: "Failed to parse ICS calendar",
          details: e.message,
        }),
        { status: 400 },
      );
    }

    const created = [];
    const skipped = [];

    async function addElementToDatabase(databaseId, newElement) {
      try {
        const response = await notionFetch(
          "https://api.notion.com/v1/pages",
          token,
          {
            method: "POST",
            body: JSON.stringify({
              parent: { database_id: databaseId },
              properties: newElement,
            }),
          },
        );
        if (!response.ok) {
          const t = await response.text();
          throw new Error("Notion create page failed: " + t);
        }
        return await response.json();
      } catch (error) {
        console.error("Error creating page:", error);
        throw error;
      }
    }

    function getClassInfo(summary) {
      for (const classObj of user.classes) {
        const className = classObj.name;
        if (typeof summary === "string" && summary.includes(className)) {
          return { name: className, courseName: className };
        }
      }
      return { name: null, courseName: null };
    }

    async function initElement(calendar, i) {
      try {
        if (
          !calendar[2] ||
          !calendar[2][i] ||
          !calendar[2][i][1] ||
          !calendar[2][i][1][6] ||
          calendar[2][i][1][6].length < 4
        ) {
          return "Invalid Event Structure";
        }

        let sum = calendar[2][i][1][6][3];

        let classInfo = getClassInfo(sum);

        if (!classInfo.courseName) {
          skipped.push({
            summary: sum,
            reason: "No saved class matched",
          });
          return "Class Not Found";
        }

        if (existingTitles.includes(sum)) {
          skipped.push({
            summary: sum,
            reason: "Already exists in DB",
            matchedClass: classInfo.name,
          });
          return "Already Exists";
        }

        let doDate = calendar[2][i][1][2][3];
        let link =
          calendar[2][i][1][7] && calendar[2][i][1][7][3]
            ? calendar[2][i][1][7][3]
            : "";
        let shortName =
          sum.indexOf("[") > 0 ? sum.slice(0, sum.indexOf("[")).trim() : sum;

        let date = new Date(doDate).toLocaleDateString();

        const newElement = {
          Name: {
            title: [
              {
                text: {
                  content: sum,
                },
              },
            ],
          },
          [classPropName]:
            classPropType === "relation"
              ? { relation: [{ id: classInfo.courseName }] }
              : classPropType === "select"
                ? { select: { name: classInfo.courseName } }
                : classPropType === "multi_select"
                  ? { multi_select: [{ name: classInfo.courseName }] }
                  : {
                      rich_text: [{ text: { content: classInfo.courseName } }],
                    },
          "Due Date": {
            date: {
              start: new Date(doDate).toISOString(),
            },
          },
        };

        if (datePropName) {
          newElement[datePropName] = {
            date: {
              start: new Date(date),
            },
          };
        }

        if (link) {
          const linkPropName = Object.keys(properties).find((pn) =>
            ["link", "url", "Link", "URL"].includes(pn),
          );

          if (linkPropName) {
            newElement[linkPropName] = {
              rich_text: [
                {
                  text: {
                    content: shortName,
                    link: {
                      url: link,
                    },
                  },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default",
                  },
                  plain_text: shortName,
                  href: link,
                },
              ],
            };
          }
        }

        return newElement;
      } catch (err) {
        skipped.push({
          reason: "Error initializing element: " + (err.message || err),
        });
        return "Error";
      }
    }

    for (let i = 0; i < (calendar[2]?.length || 0); i++) {
      try {
        let element = await initElement(calendar, i);

        if (
          element === "Class Not Found" ||
          element === "Already Exists" ||
          element === "Error" ||
          element === "Invalid Event Structure"
        ) {
          continue;
        }

        try {
          await addElementToDatabase(databaseId, element);
          created.push({
            summary: element.Name.title[0].text.content,
            created_for: element.Name.title[0].text.content,
          });
        } catch (e) {
          skipped.push({
            summary: element.Name.title[0].text.content,
            reason: `Failed to create: ${e.message}`,
          });
        }
      } catch (err) {
        skipped.push({
          reason: "Event processing error: " + (err.message || err),
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        created_count: created.length,
        skipped_count: skipped.length,
        total_events: calendar[2]?.length || 0,
        created,
        skipped,
        debug: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Server error",
        details: String(err.message || err),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
