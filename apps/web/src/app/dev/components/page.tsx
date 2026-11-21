import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComponentGallery } from "./gallery";

export const metadata: Metadata = { title: "Component gallery" };

/**
 * Dev-only gallery of the v2 components (Figma page 02 `v2/*` sections) for visual QA
 * against the Figma specimens. `?theme=light|dark` forces a theme for screenshots.
 * Production builds return 404.
 */
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ComponentGallery />;
}
