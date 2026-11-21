// Pure view model for the Website widget dialog (Figma 07 `agents-customer/widget-config`, 411:31887).
// The widget config is one row per company (`widget_configs`); the dialog edits it from the
// selected customer agent and points the widget at that agent on save.

export type WidgetPosition = "bottom-right" | "bottom-left";

/** The company's widget as the loader reads it; config is null before the first save. */
export type AgentsWidget = {
  companyId: string;
  companyName: string;
  widgetId: string | null;
  config: {
    primaryColor: string | null;
    welcomeMessage: string | null;
    title: string | null;
    position: WidgetPosition | null;
    agentId: string | null;
  } | null;
  /** Name of the customer agent the widget answers through today, if any. */
  agentName?: string;
};

export type WidgetFormValues = {
  primaryColor: string;
  welcomeMessage: string;
  position: WidgetPosition;
};

export const DEFAULT_WIDGET_COLOR = "#6366f1";
const HEX = /^#[0-9a-fA-F]{6}$/;

export function widgetFormDefaults(widget: AgentsWidget): WidgetFormValues {
  const c = widget.config;
  return {
    primaryColor: c?.primaryColor && HEX.test(c.primaryColor) ? c.primaryColor : DEFAULT_WIDGET_COLOR,
    welcomeMessage: c?.welcomeMessage ?? "",
    position: c?.position ?? "bottom-right",
  };
}

/** Field errors keyed by field; empty when the values can be saved. */
export function widgetFormErrors(values: WidgetFormValues): Partial<Record<keyof WidgetFormValues, string>> {
  const errors: Partial<Record<keyof WidgetFormValues, string>> = {};
  if (!HEX.test(values.primaryColor)) errors.primaryColor = "Use a hex color like #2DD4BF.";
  if (values.welcomeMessage.length > 500) errors.welcomeMessage = "Keep the greeting under 500 characters.";
  return errors;
}

/** updateWidgetConfig input: the dialog's fields plus the agent the widget answers through. */
export function widgetSaveInput(values: WidgetFormValues, agentId: string) {
  return {
    primaryColor: values.primaryColor,
    welcomeMessage: values.welcomeMessage,
    position: values.position,
    agentId,
  };
}

/** Name in the preview header: the widget title, else the company name. */
export function widgetPreviewTitle(widget: AgentsWidget): string {
  return widget.config?.title?.trim() || widget.companyName;
}

/**
 * Note under the dialog description when saving would move the widget off another agent.
 * Undefined when the widget already answers through this agent or through none.
 */
export function widgetReassignNote(widget: AgentsWidget, agentId: string): string | undefined {
  const current = widget.config?.agentId;
  if (!current || current === agentId) return undefined;
  return `The widget answers through ${widget.agentName ?? "another agent"} today. Saving moves it to this agent.`;
}

export function widgetEmbedSnippet(appUrl: string, widgetId: string): string {
  return `<script src="${appUrl.replace(/\/$/, "")}/widget.js" data-widget-id="${widgetId}"></script>`;
}
