export type SuggestionChipsInput = {
  packageSlug: string | null;
};

export function suggestionChips({ packageSlug }: SuggestionChipsInput): string[] {
  if (packageSlug === "revenue") {
    return [
      "Research an account",
      "Draft outreach for an account",
      "Who needs a follow-up?",
    ];
  }

  return ["What can you do?"];
}
