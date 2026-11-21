import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { CtaSection } from "@/components/landing/cta-section";
import { chipVariants } from "@/components/v2/primitives";

import { BlogGrid, FeaturedPost } from "./post-cards";
import { BLOG_FILTERS, blogIndex, type BlogFilter } from "./posts";

const description =
  "How agencies run a lead engine for every client, and what we learn building Relay.";

export const metadata: Metadata = {
  title: "Blog — Relay",
  description,
  openGraph: { title: "Blog — Relay", description, type: "website" },
};

type SearchParams = { category?: string | string[]; page?: string | string[] };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function listHref(category: BlogFilter | null, page = 1): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/blog?${query}` : "/blog";
}

function FilterChip({ label, category, active }: { label: string; category: BlogFilter | null; active: boolean }) {
  return (
    <Link
      href={listHref(category)}
      data-slot="blog-filter"
      aria-current={active ? "page" : undefined}
      className={chipVariants({ variant: active ? "selected" : "default", size: "md" })}
    >
      {label}
    </Link>
  );
}

/** Figma 09 `blog-index/desktop` (`428:61868` light): header + filters, featured post, grid, CTA band. */
export default async function BlogIndexPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const index = blogIndex({ category: first(params.category), page: first(params.page) });

  return (
    <>
      <section
        data-slot="blog-header"
        className="flex w-full flex-col items-center gap-6 px-6 pt-12 pb-10 text-center md:px-20 md:pt-20"
      >
        <p className="type-label text-primary">Blog</p>
        <h1 className="max-w-[880px] type-h1 text-foreground md:type-display">
          Notes on lead engines, agents and agency work.
        </h1>
        <p className="max-w-[640px] type-body text-muted-foreground">
          How agencies run a lead engine for every client, and what we learn building Relay. Short posts, when we have
          something worth saying.
        </p>
        <nav aria-label="Filter posts" className="flex max-w-full flex-wrap justify-center gap-2">
          <FilterChip label="All posts" category={null} active={index.category === null} />
          {BLOG_FILTERS.map((filter) => (
            <FilterChip key={filter} label={filter} category={filter} active={index.category === filter} />
          ))}
        </nav>
      </section>

      <section data-slot="blog-posts" className="w-full px-6 pb-12 md:px-20 md:pb-10">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-10">
          {index.featured ? <FeaturedPost post={index.featured} /> : null}
          {index.grid.length > 0 ? <BlogGrid posts={index.grid} /> : null}
          {!index.featured && index.grid.length === 0 ? (
            <p className="type-body text-muted-foreground">No posts here yet.</p>
          ) : null}
          {index.hasOlder ? (
            <Button asChild variant="outline">
              <Link href={listHref(index.category, index.page + 1)}>Older posts</Link>
            </Button>
          ) : null}
        </div>
      </section>

      <CtaSection />
    </>
  );
}
