import Link from "next/link";

import { Button } from "@/components/ui/button";
import { landingCardClass } from "@/components/landing/section";
import { Chip, Icon } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";

import { formatPostDate, readMinutes, type BlogPost } from "./posts";

const postHref = (post: BlogPost) => `/blog/${post.slug}`;

/** Placeholder cover: canvas fill with a primary-soft icon tile (Figma `cover (placeholder)`). */
function Cover({ post, size }: { post: BlogPost; size: "lg" | "md" }) {
  return (
    <div aria-hidden className="flex items-center justify-center bg-canvas">
      <span className={cn("inline-flex rounded-xl bg-primary-soft text-primary", size === "lg" ? "p-6" : "p-4")}>
        <Icon name={post.icon} size={size === "lg" ? 40 : 28} />
      </span>
    </div>
  );
}

/** Figma `post/featured`: cover left, chip + h1-size title + excerpt + meta + Read the post. */
export function FeaturedPost({ post }: { post: BlogPost }) {
  return (
    <article
      data-slot="blog-featured"
      className="grid w-full overflow-hidden rounded-xl border border-border bg-card shadow-elevation-1 md:grid-cols-2"
    >
      <div className="grid h-[200px] md:h-auto md:min-h-[384px]">
        <Cover post={post} size="lg" />
      </div>
      <div className="flex flex-col items-start justify-center gap-5 p-6 md:p-12">
        <Chip asStatic>{post.category}</Chip>
        <h2 className="type-h1 text-foreground">
          <Link href={postHref(post)} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <p className="type-body text-muted-foreground">{post.excerpt}</p>
        <p className="type-caption text-muted-foreground">
          {formatPostDate(post.date)} · {post.author.name} · {readMinutes(post)} min read
        </p>
        <Button asChild variant="outline">
          <Link href={postHref(post)} aria-label={`Read the post: ${post.title}`}>
            Read the post
          </Link>
        </Button>
      </div>
    </article>
  );
}

/** Figma `post/<title>` grid card: 200 cover, category + date, h3 title, excerpt. Whole card links. */
export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <article
      data-slot="blog-card"
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden transition-shadow hover:shadow-elevation-2",
        landingCardClass,
        "p-0",
      )}
    >
      <div className="grid h-[200px]">
        <Cover post={post} size="md" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-6">
        <p className="flex gap-2 whitespace-nowrap">
          <span className="type-label text-primary">{post.category}</span>
          <time dateTime={post.date} className="type-caption text-muted-foreground">
            {formatPostDate(post.date)}
          </time>
        </p>
        <h3 className="type-h3 text-foreground">
          <Link href={postHref(post)} className="after:absolute after:inset-0 group-hover:underline">
            {post.title}
          </Link>
        </h3>
        <p className="type-small text-muted-foreground">{post.excerpt}</p>
      </div>
    </article>
  );
}

/** Three-up grid, one column below lg (Figma `grid posts`, `section/related` grid). */
export function BlogGrid({ posts }: { posts: readonly BlogPost[] }) {
  return (
    <div className="grid w-full gap-6 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((post) => (
        <BlogCard key={post.slug} post={post} />
      ))}
    </div>
  );
}
