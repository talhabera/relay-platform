import { db } from "@/db";
import { companies, widgetConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { type NextRequest } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

/** Handle CORS preflight */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Default widget configuration when no custom config exists */
const DEFAULT_CONFIG = {
  primaryColor: "#6366f1",
  position: "bottom-right" as const,
  welcomeMessage: "Hi there! How can I help you today?",
  title: "Chat with us",
  avatarUrl: null,
  theme: "auto" as const,
  showBranding: true,
  autoOpen: false,
  autoOpenDelay: 3000,
  persistThread: true,
  customCss: null,
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: widgetId } = await params;

  // Validate widgetId format (basic check)
  if (!widgetId || widgetId.length < 1) {
    return Response.json(
      { error: "Invalid widget ID" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Look up company by widgetId
  const company = await db.query.companies.findFirst({
    where: eq(companies.widgetId, widgetId),
  });

  if (!company) {
    return Response.json(
      { error: "Widget not found" },
      { status: 404, headers: CORS_HEADERS }
    );
  }

  // Look up widget config
  const config = await db.query.widgetConfigs.findFirst({
    where: eq(widgetConfigs.companyId, company.id),
  });

  // Build response with config or defaults
  const widgetConfig = config
    ? {
        primaryColor: config.primaryColor ?? DEFAULT_CONFIG.primaryColor,
        position: config.position ?? DEFAULT_CONFIG.position,
        welcomeMessage: config.welcomeMessage ?? DEFAULT_CONFIG.welcomeMessage,
        title: config.title ?? DEFAULT_CONFIG.title,
        avatarUrl: config.avatarUrl ?? DEFAULT_CONFIG.avatarUrl,
        theme: config.theme ?? DEFAULT_CONFIG.theme,
        showBranding: config.showBranding ?? DEFAULT_CONFIG.showBranding,
        autoOpen: config.autoOpen ?? DEFAULT_CONFIG.autoOpen,
        autoOpenDelay: config.autoOpenDelay ?? DEFAULT_CONFIG.autoOpenDelay,
        persistThread: config.persistThread ?? DEFAULT_CONFIG.persistThread,
        customCss: config.customCss ?? DEFAULT_CONFIG.customCss,
      }
    : DEFAULT_CONFIG;

  return Response.json(
    {
      widgetId,
      companyName: company.name,
      config: widgetConfig,
    },
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}
