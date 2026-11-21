import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type NextRequest } from "next/server";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Dynamic widget script server.
 *
 * Serves the widget.js file with company-specific data injected.
 * This endpoint allows customers to load the widget via:
 *   <script src="https://app.relay.ai/company-widget/{widgetId}"></script>
 *
 * The widget ID is embedded directly in the script so the customer does not
 * need to add a data-widget-id attribute.
 */

let cachedScript: string | null = null;

async function loadWidgetScript(): Promise<string> {
  if (cachedScript && process.env.NODE_ENV === "production") {
    return cachedScript;
  }

  const filePath = join(process.cwd(), "public", "widget.js");
  const script = await readFile(filePath, "utf-8");
  cachedScript = script;
  return script;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: widgetId } = await params;

  // Validate widgetId
  if (!widgetId || widgetId.length < 1 || widgetId.length > 128) {
    return new Response("// Invalid widget ID", {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // Verify the widget exists
  const company = await db.query.companies.findFirst({
    where: eq(companies.widgetId, widgetId),
  });

  if (!company) {
    return new Response("// Widget not found", {
      status: 404,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // Load the widget script
  let script: string;
  try {
    script = await loadWidgetScript();
  } catch {
    return new Response("// Widget script not available", {
      status: 500,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  // Inject the widget ID into the script as an auto-init wrapper.
  // This allows customers to use a simple script tag without data-widget-id:
  //   <script src="/company-widget/{widgetId}"></script>
  // The injected code sets data-widget-id on the script tag before the IIFE runs.
  const injectedScript = [
    "// Relay Widget v1.0.0 — " + company.name,
    "(function(){",
    "  var s = document.currentScript;",
    '  if (s && !s.getAttribute("data-widget-id")) {',
    '    s.setAttribute("data-widget-id", ' + JSON.stringify(widgetId) + ");",
    "  }",
    "})();",
    "",
    script,
  ].join("\n");

  const isProduction = process.env.NODE_ENV === "production";

  return new Response(injectedScript, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": isProduction
        ? "public, max-age=86400, stale-while-revalidate=3600"
        : "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
