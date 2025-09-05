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

async function getExistingAssignments(databaseId, token) {
  const assignments = [];
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
        const dueDate = page.properties?.["Due Date"]?.date?.start;
        if (t) assignments.push({ title: t, pageId: page.id, dueDate });
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
  return assignments;
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

    let existingAssignments = [];
    try {
      existingAssignments = await getExistingAssignments(databaseId, token);
    } catch (e) {
      existingAssignments = [];
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

    // Improved class extraction
    function getClassInfo(summary) {
      if (!summary || typeof summary !== "string")
        return { name: null, courseName: null, baseSummary: summary };

      // Look for patterns like [ENGL-103-H_25/FA] or [ASC-101-Q1/Q2_25/FA]
      const bracketMatch = summary.match(/\[([^\]]+)\]\s*$/);
      if (bracketMatch) {
        // Remove the class name and any whitespace before it
        const baseSummary = summary.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
        return {
          name: bracketMatch[1],
          courseName: bracketMatch[1],
          baseSummary,
        };
      }

      // Add other fallback patterns here if needed

      return { name: null, courseName: null, baseSummary: summary };
    }

    // Use iCal.js Component API to parse events
    const vcalendar = new ical.Component(calendar);
    const vevents = vcalendar.getAllSubcomponents("vevent");

    // Helper to update due date if changed
    async function updateDueDate(pageId, newDueDate, token) {
      const response = await notionFetch(
        `https://api.notion.com/v1/pages/${pageId}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            properties: {
              "Due Date": {
                date: {
                  start: newDueDate,
                },
              },
            },
          }),
        },
      );
      if (!response.ok) {
        const t = await response.text();
        throw new Error("Notion update page failed: " + t);
      }
      return await response.json();
    }

    for (const vevent of vevents) {
      try {
        const summary = vevent.getFirstPropertyValue("summary");
        const dtstart = vevent.getFirstPropertyValue("dtstart");
        const url = vevent.getFirstPropertyValue("url") || "";
        const description = vevent.getFirstPropertyValue("description") || "";

        // Debugging output
        console.log("Event summary:", summary);

        const classInfo = getClassInfo(summary);
        console.log("Extracted class:", classInfo);

        if (!classInfo.courseName) {
          skipped.push({
            summary,
            reason: "No saved class matched",
          });
          continue;
        }

        // Remove class name from Notion Name and check for duplicates by baseSummary
        if (
          existingAssignments.some((a) => {
            const aBase = a.title.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
            return aBase === classInfo.baseSummary;
          })
        ) {
          skipped.push({
            summary,
            dueDate: dtstart,
            existingDueDate: existingAssignments.find((a) => {
              const aBase = a.title.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
              return aBase === classInfo.baseSummary;
            })?.dueDate,
            reason: "Already exists in DB",
            matchedClass: classInfo.name,
          });
          continue;
        }

        // Build Notion page properties
        const newElement = {
          Name: {
            title: [
              {
                text: {
                  content: classInfo.baseSummary,
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
              start:
                dtstart instanceof Date
                  ? dtstart.toISOString()
                  : new Date(dtstart).toISOString(),
            },
          },
        };

        if (datePropName) {
          newElement[datePropName] = {
            date: {
              start:
                dtstart instanceof Date
                  ? dtstart.toISOString()
                  : new Date(dtstart).toISOString(),
            },
          };
        }

        if (url) {
          const linkPropName = Object.keys(properties).find((pn) =>
            ["link", "url", "Link", "URL"].includes(pn),
          );

          if (linkPropName) {
            newElement[linkPropName] = {
              rich_text: [
                {
                  text: {
                    content: summary,
                    link: {
                      url: url,
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
                  plain_text: summary,
                  href: url,
                },
              ],
            };
          }
        }

        // Find if assignment exists
        const existing = existingAssignments.find(
          (a) => a.title === newElement.Name.title[0].text.content,
        );

        if (existing) {
          // Compare due dates
          const newDueDate = newElement["Due Date"].date.start;
          if (existing.dueDate !== newDueDate) {
            try {
              await updateDueDate(existing.pageId, newDueDate, token);
              created.push({
                summary: `${newElement.Name.title[0].text.content} (Due date updated: ${existing.dueDate} → ${newDueDate})`,
                updated_due_date: newDueDate,
                old_due_date: existing.dueDate,
              });
            } catch (e) {
              skipped.push({
                summary: `${newElement.Name.title[0].text.content} (Due date update failed: ${existing.dueDate} → ${newDueDate})`,
                reason: `Failed to update due date: ${e.message}`,
                old_due_date: existing.dueDate,
                new_due_date: newDueDate,
              });
            }
          } else {
            skipped.push({
              summary: `${newElement.Name.title[0].text.content} (Due date unchanged: ${existing.dueDate})`,
              reason: "Already exists in DB with correct due date",
              old_due_date: existing.dueDate,
              new_due_date: newDueDate,
            });
          }
          continue;
        }

        // If not existing, create new
        try {
          await addElementToDatabase(databaseId, newElement);
          created.push({
            summary: newElement.Name.title[0].text.content,
            created_for: newElement.Name.title[0].text.content,
          });
        } catch (e) {
          skipped.push({
            summary: newElement.Name.title[0].text.content,
            reason: `Failed to create: ${e.message}`,
          });
        }
      } catch (err) {
        skipped.push({
          reason: "Event processing error: " + (err.message || err),
        });
      }
    }

    console.log(created);

    console.log(skipped);

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
