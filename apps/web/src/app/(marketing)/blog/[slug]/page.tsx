import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CtaSection } from "@/components/landing/cta-section";
import { ProductPreview } from "@/components/landing/product-preview";
import { Chip, Icon } from "@/components/v2/primitives";

import { BlogGrid } from "../post-cards";
import { BLOG_POSTS, formatPostDate, getPost, readMinutes, relatedPosts, type PostBlock } from "../posts";

type Params = { slug: string };

export const dynamicParams = false;

export async function generateStaticParams(): Promise<Params[]> {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  const title = `${post.title} — Relay`;
  return {
    title,
    description: post.excerpt,
    openGraph: { title, description: post.excerpt, type: "article", publishedTime: post.date, authors: [post.author.name] },
  };
}

function Block({ block }: { block: PostBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="type-body text-foreground">{block.text}</p>;
    case "subhead":
      return <h2 className="type-h2 text-foreground">{block.text}</h2>;
    case "lead-engine-figure":
      return (
        <figure className="flex w-full flex-col gap-3">
          <ProductPreview layout="figure" />
          <figcaption className="type-caption text-muted-foreground">{block.caption}</figcaption>
        </figure>
      );
    case "callout":
      return (
        <aside
          data-slot="post-callout"
          className="flex w-full items-start gap-3 rounded-xl border border-border bg-primary-soft p-5"
        >
          <Icon name="info" size={20} aria-hidden className="shrink-0 text-primary" />
          <p className="min-w-0 flex-1 type-body text-primary-soft-foreground">{block.text}</p>
        </aside>
      );
  }
}

/** Figma 09 `blog-post/desktop` (`428:61961` light): 720 article, Keep reading grid, CTA band. */
export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  return (
    <>
      <section data-slot="blog-article" className="w-full px-6 pt-10 pb-12 md:px-20 md:pt-16">
        <article className="mx-auto flex w-full max-w-[720px] flex-col items-start gap-8">
          <Button asChild variant="ghost" className="-ml-4">
            <Link href="/blog">
              <Icon name="arrow-left" size={16} aria-hidden />
              All posts
            </Link>
          </Button>

          <header className="flex w-full flex-col items-start gap-5">
            <Chip asStatic>{post.category}</Chip>
            <h1 className="type-h1 text-foreground md:type-display">{post.title}</h1>
            <p className="type-body text-muted-foreground">{post.excerpt}</p>
            <div className="flex items-center gap-3">
              <Avatar size="sm">
                <AvatarFallback>{post.author.initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="type-body-strong text-foreground">{post.author.name}</span>
                <span className="type-caption text-muted-foreground">
                  <time dateTime={post.date}>{formatPostDate(post.date)}</time> · {readMinutes(post)} min read
                </span>
              </div>
            </div>
          </header>

          <Separator />

          {post.body.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </article>
      </section>

      <section data-slot="blog-related" className="w-full px-6 py-12 md:px-20 md:py-10">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-10">
          <h2 className="type-h2 text-foreground">Keep reading</h2>
          <BlogGrid posts={relatedPosts(post.slug)} />
        </div>
      </section>

      <CtaSection />
    </>
  );
}
