export type ComposerCopyInput = {
  agentName: string;
  packageSlug: string | null;
};

export type ComposerCopy = {
  heading: string;
  placeholder: string;
  showPaperclip: boolean;
};

export function composerCopy({
  agentName,
  packageSlug,
}: ComposerCopyInput): ComposerCopy {
  if (packageSlug === "revenue") {
    return {
      heading: agentName,
      placeholder: "Name an account to research…",
      showPaperclip: true,
    };
  }

  return {
    heading: agentName,
    placeholder: `Message ${agentName}…`,
    showPaperclip: true,
  };
}

export const PAPERCLIP_TOOLTIP = "File attach is not available yet.";
