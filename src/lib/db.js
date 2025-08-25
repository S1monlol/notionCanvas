import { PrismaClient } from "@prisma/client";

let prisma;

if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient();
} else {
  if (!globalThis.__prisma) {
    globalThis.__prisma = new PrismaClient();
  }
  prisma = globalThis.__prisma;
}

export { prisma };

export async function findOrCreateUser(notionUserData) {
  const { user } = notionUserData;

  if (!user?.id) {
    throw new Error("Invalid Notion user data");
  }

  let existingUser = await prisma.user.findUnique({
    where: {
      notionUserId: user.id,
    },
    include: {
      classes: true,
    },
  });

  if (existingUser) {
    existingUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        accessToken: notionUserData.access_token,
        workspaceId: notionUserData.workspace_id,
        workspaceName: notionUserData.workspace_name || user.name,
      },
      include: {
        classes: true,
      },
    });
    return existingUser;
  }

  const newUser = await prisma.user.create({
    data: {
      notionUserId: user.id,
      accessToken: notionUserData.access_token,
      workspaceId: notionUserData.workspace_id,
      workspaceName: notionUserData.workspace_name || user.name,
    },
    include: {
      classes: true,
    },
  });

  return newUser;
}

export async function getUserByNotionId(notionUserId) {
  return await prisma.user.findUnique({
    where: {
      notionUserId,
    },
    include: {
      classes: true,
    },
  });
}

export async function getUserByAccessToken(accessToken) {
  return await prisma.user.findFirst({
    where: {
      accessToken,
    },
    include: {
      classes: true,
    },
  });
}

export async function updateUserCanvasUrl(userId, canvasCalendarUrl) {
  return await prisma.user.update({
    where: { id: userId },
    data: { canvasCalendarUrl },
  });
}

export async function updateUserDatabase(userId, selectedDatabaseId) {
  return await prisma.user.update({
    where: { id: userId },
    data: { selectedDatabaseId },
  });
}

export async function updateUserClasses(userId, classNames) {
  await prisma.class.deleteMany({
    where: { userId },
  });

  if (classNames.length > 0) {
    await prisma.class.createMany({
      data: classNames.map((name) => ({
        userId,
        name: name.trim(),
      })),
    });
  }

  return await prisma.user.findUnique({
    where: { id: userId },
    include: { classes: true },
  });
}
