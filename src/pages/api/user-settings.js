import {
  getUserByAccessToken,
  updateUserCanvasUrl,
  updateUserDatabase,
  updateUserClasses,
} from "../../lib/db.js";

async function authenticateUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing Authorization Bearer token");
  }

  const token = authHeader.split(" ")[1];
  const user = await getUserByAccessToken(token);

  if (!user) {
    throw new Error("Invalid or expired access token");
  }

  return user;
}

export async function GET({ request }) {
  try {
    const user = await authenticateUser(request);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          canvasCalendarUrl: user.canvasCalendarUrl,
          selectedDatabaseId: user.selectedDatabaseId,
          classes: user.classes.map((c) => c.name),
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error getting user settings:", error);

    const statusCode =
      error.message.includes("Authorization") ||
      error.message.includes("Invalid")
        ? 401
        : 500;

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

export async function POST({ request }) {
  try {
    const user = await authenticateUser(request);

    const body = await request.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing JSON body",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { canvasCalendarUrl, selectedDatabaseId, classes } = body;

    if (canvasCalendarUrl !== undefined) {
      await updateUserCanvasUrl(user.id, canvasCalendarUrl);
    }

    if (selectedDatabaseId !== undefined) {
      await updateUserDatabase(user.id, selectedDatabaseId);
    }

    if (Array.isArray(classes)) {
      await updateUserClasses(user.id, classes);
    }

    const updatedUser = await getUserByAccessToken(user.accessToken);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Settings saved successfully",
        data: {
          canvasCalendarUrl: updatedUser.canvasCalendarUrl,
          selectedDatabaseId: updatedUser.selectedDatabaseId,
          classes: updatedUser.classes.map((c) => c.name),
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error saving user settings:", error);

    const statusCode =
      error.message.includes("Authorization") ||
      error.message.includes("Invalid")
        ? 401
        : 500;

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
