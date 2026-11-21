import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(marketing)/actions", () => ({ requestAccess: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import BlogIndexPage from "./page";
import BlogPostPage, { generateMetadata, generateStaticParams } from "./[slug]/page";
import {
  BLOG_FILTERS,
  BLOG_POSTS,
  blogIndex,
  formatPostDate,
  getPost,
  readMinutes,
  relatedPosts,
} from "./posts";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("posts.ts (static TS posts)", () => {
  it("slugs are unique and newest first", () => {
    const slugs = BLOG_POSTS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const dates = BLOG_POSTS.map((p) => p.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("featured post is the Figma lead engine post", () => {
    expect(BLOG_POSTS[0].title).toBe("How one agency runs a lead engine for every client");
    expect(BLOG_POSTS[0].category).toBe("Lead engine");
  });

  it("formats dates as Figma does", () => {
    expect(formatPostDate("2026-09-24")).toBe("24 Sep 2026");
    expect(formatPostDate("2025-12-20")).toBe("20 Dec 2025");
  });

  it("read time comes from the body", () => {
    for (const post of BLOG_POSTS) expect(readMinutes(post)).toBeGreaterThanOrEqual(1);
  });

  it("blogIndex: featured + grid of six, filtered by category, older-posts page", () => {
    const all = blogIndex({});
    expect(all.featured?.slug).toBe(BLOG_POSTS[0].slug);
    expect(all.grid.length).toBeLessThanOrEqual(6);
    expect(all.grid.map((p) => p.slug)).not.toContain(BLOG_POSTS[0].slug);

    const operator = blogIndex({ category: "Operator" });
    expect([operator.featured, ...operator.grid].every((p) => p?.category === "Operator")).toBe(true);

    expect(blogIndex({ category: "Nope" }).category).toBeNull();
    expect(blogIndex({ page: "99" }).grid).toEqual([]);
  });

  it("related posts exclude the current one", () => {
    const related = relatedPosts(BLOG_POSTS[0].slug);
    expect(related).toHaveLength(3);
    expect(related.map((p) => p.slug)).not.toContain(BLOG_POSTS[0].slug);
  });

  it("no unshipped channels in any post", () => {
    const text = JSON.stringify(BLOG_POSTS);
    expect(text).not.toMatch(/Messenger|Telegram/);
  });
});

describe("Blog index (Figma 09 blog-index/desktop)", () => {
  it("header, five filter chips, featured card, grid cards linking to posts", async () => {
    const html = render(await BlogIndexPage({ searchParams: Promise.resolve({}) }));
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain("Notes on lead engines, agents and agency work.");
    expect(count(html, 'data-slot="blog-filter"')).toBe(BLOG_FILTERS.length + 1);
    expect(html).toMatch(/data-slot="blog-filter"[^>]*aria-current="page"[^>]*>All posts/);
    expect(count(html, 'data-slot="blog-featured"')).toBe(1);
    expect(html).toContain("Read the post");
    expect(count(html, 'data-slot="blog-card"')).toBe(6);
    expect(html).toContain(`href="/blog/${BLOG_POSTS[0].slug}"`);
    expect(html).toContain('data-slot="landing-cta"');
  });

  it("category filter marks its chip and narrows the list", async () => {
    const html = render(await BlogIndexPage({ searchParams: Promise.resolve({ category: "Operator" }) }));
    expect(html).toMatch(/aria-current="page"[^>]*>Operator/);
    expect(html).not.toContain("Why two kinds of agent");
  });
});

describe("Blog post (Figma 09 blog-post/desktop)", () => {
  const slug = BLOG_POSTS[0].slug;

  it("static params cover every post", async () => {
    expect((await generateStaticParams()).map((p) => p.slug)).toEqual(BLOG_POSTS.map((p) => p.slug));
  });

  it("metadata uses the post title", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug }) });
    expect(meta.title).toContain(BLOG_POSTS[0].title);
  });

  it("article: back link, chip, h1, byline, body blocks, figure, callout, Keep reading", async () => {
    const html = render(await BlogPostPage({ params: Promise.resolve({ slug }) }));
    expect(html).toContain('href="/blog"');
    expect(html).toContain("All posts");
    expect(count(html, "<h1")).toBe(1);
    expect(html).toContain("Talha Bera");
    expect(html).toContain("24 Sep 2026");
    expect(html).toContain("Four stages, one workflow");
    expect(html).toContain('data-slot="product-preview"');
    expect(html).toContain('data-slot="post-callout"');
    expect(html).toContain("Keep reading");
    expect(count(html, 'data-slot="blog-card"')).toBe(3);
  });

  it("unknown slug is a 404", async () => {
    expect(getPost("nope")).toBeUndefined();
    await expect(BlogPostPage({ params: Promise.resolve({ slug: "nope" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
