import { db, schema } from "@relay/db";

async function seed() {
  console.log("Seeding database...");

  // Local AUTH_DEV login is operator@localhost / local-operator.
  const [user] = await db
    .insert(schema.users)
    .values({
      id: "local-operator",
      name: "Operator",
      email: "operator@localhost",
      emailVerified: true,
    })
    .returning();

  console.log("Created user:", user.email);

  // Create test company
  const [company] = await db
    .insert(schema.companies)
    .values({
      name: "Acme Corp",
      industry: "Technology",
      description: "A test company for development",
      ownerId: user.id,
    })
    .returning();

  console.log("Created company:", company.name);

  // Create test agent
  const [agent] = await db
    .insert(schema.agents)
    .values({
      name: "Support Bot",
      description: "Customer support agent",
      companyId: company.id,
      isActive: true,
      persona: "professional",
      language: "en",
      responseLength: "medium",
      memoryEnabled: true,
    })
    .returning();

  console.log("Created agent:", agent.name);

  // Create a test chat
  const [chat] = await db
    .insert(schema.chats)
    .values({
      title: "Test Conversation",
      userId: user.id,
      companyId: company.id,
      agentId: agent.id,
      channelType: "web",
    })
    .returning();

  console.log("Created chat:", chat.title);

  // Create test messages
  await db.insert(schema.messages).values([
    {
      chatId: chat.id,
      content: "Hello, I need help with my order.",
      role: "user",
    },
    {
      chatId: chat.id,
      content:
        "I'd be happy to help you with your order. Could you please provide your order number?",
      role: "assistant",
    },
  ]);

  console.log("Created test messages");

  // Set user preferences
  await db.insert(schema.userPreferences).values({
    userId: user.id,
    activeCompanyId: company.id,
  });

  console.log("Set user preferences");
  console.log("Seeding complete!");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
