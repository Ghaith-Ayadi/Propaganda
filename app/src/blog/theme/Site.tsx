// The themed blog: four templates (Home, Collection, Post, Author) inside one
// frame (header, footer). Markup, classes and data-part attributes are the
// styling contract that pg.css and every theme read; the conformance harness
// (blog/harness/, app/scripts/pg-harness.mjs) checks them at many widths with
// every option combination. Missing data removes a part; it never leaves an
// empty box.
//
// Pure of (view model, design, route): no fetching here. blog/theme/Themed.tsx
// feeds it the live site; blog/harness/ feeds it fixtures.

import { Fragment, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element as HastElement } from "hast";
import type { Design, Options } from "./schema";
import { initialOf, lenOf, type Vm, type VmAuthor, type VmPost, type PgRoute } from "./vm";

/* ---------------------------------------------------------------- bits */

type IconName = "left" | "right" | "back";
function Icon({ name }: { name: IconName }) {
  // Drawn, not typed: several text faces have no arrow glyphs.
  return (
    <svg className="pg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "left" && <path d="M15 6l-6 6 6 6" />}
      {name === "right" && <path d="M9 6l6 6-6 6" />}
      {name === "back" && (
        <>
          <path d="M9 14l-4-4 4-4" />
          <path d="M5 10h9a5 5 0 0 1 0 10h-2" />
        </>
      )}
    </svg>
  );
}

interface Ctx {
  vm: Vm;
  design: Design;
  imageSrc: (src: string) => string;
  more: Record<string, number>;
  showMore: (key: string, by: number) => void;
  homeTab: string | null;
  setHomeTab: (slug: string) => void;
}

/** An image that turns into its fallback when it fails to load. */
function useBroken(src: string | null | undefined): [boolean, () => void] {
  const [broken, setBroken] = useState<string | null>(null);
  return [!!src && broken === src, () => setBroken(src ?? null)];
}

function Avatar({ author, ctx }: { author: VmAuthor; ctx: Ctx }) {
  const [broken, fail] = useBroken(author.avatar);
  if (author.avatar && !broken)
    return (
      <span className="pg-avatar" data-part="avatar">
        <img src={ctx.imageSrc(author.avatar)} alt="" loading="lazy" onError={fail} />
      </span>
    );
  return (
    <span className="pg-avatar" data-part="avatar" data-placeholder="" aria-hidden="true">
      <span>{author.initial}</span>
    </span>
  );
}

function Media({ post, ctx }: { post: VmPost; ctx: Ctx }) {
  const [broken, fail] = useBroken(post.image?.src);
  const initial = initialOf(post.col.emoji || post.col.name);
  if (post.image && !broken)
    return (
      <div className="pg-media" data-part="media">
        <img src={ctx.imageSrc(post.image.src)} alt={post.image.alt || ""} loading="lazy" onError={fail} />
      </div>
    );
  return (
    <div className="pg-media" data-part="media" data-placeholder="" aria-hidden="true">
      <span>{initial}</span>
    </div>
  );
}

function Figure({ src, alt, caption, wide, ctx }: { src: string; alt: string; caption: string | null; wide: boolean; ctx: Ctx }) {
  const [broken, fail] = useBroken(src);
  return (
    <figure data-width={wide ? "wide" : undefined} data-broken={broken ? "" : undefined}>
      {!broken && <img src={ctx.imageSrc(src)} alt={alt} loading="lazy" onError={fail} />}
      {caption && <figcaption dir="auto">{caption}</figcaption>}
    </figure>
  );
}

function InlineImg({ src, alt, ctx }: { src: string; alt: string; ctx: Ctx }) {
  const [broken, fail] = useBroken(src);
  return broken ? null : <img src={ctx.imageSrc(src)} alt={alt} loading="lazy" onError={fail} />;
}

const len = (v: string | undefined) => v || undefined;

/* ---------------------------------------------------------------- frame */

function SiteHeader({ ctx, route }: { ctx: Ctx; route: PgRoute }) {
  const { vm } = ctx;
  const o = ctx.design.frame.header;
  return (
    <header className="pg-header" data-part="header" data-variant={vm.frame.header} data-sticky={o.sticky ? "true" : undefined}>
      <div className="pg-header__inner pg-container">
        <div className="pg-brand-block">
          <a className="pg-brand" data-part="brand" href={vm.links.home()} dir="auto">
            {vm.site.logo && <img src={ctx.imageSrc(vm.site.logo)} alt={vm.site.wordmark ? vm.site.name : ""} />}
            {!vm.site.wordmark && <span>{vm.site.name}</span>}
          </a>
          {o.tagline && vm.site.tagline && (
            <p className="pg-tagline" data-part="tagline" dir="auto">
              {vm.site.tagline}
            </p>
          )}
        </div>
        <nav className="pg-nav" data-part="nav" aria-label="Collections">
          <ul role="list">
            {vm.collections.map((c) => (
              <li key={c.slug}>
                <a
                  href={c.href}
                  aria-current={route.tpl === "collection" && route.collection === c.slug ? "page" : undefined}
                  title={c.name}
                  dir="auto"
                >
                  <span className="pg-nav__label">{c.name}</span>
                </a>
              </li>
            ))}
            <li>
              <a href={vm.links.author()} aria-current={route.tpl === "author" ? "page" : undefined}>
                About
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter({ ctx }: { ctx: Ctx }) {
  const { vm } = ctx;
  const year = new Date(vm.lastUpdate ?? Date.now()).getUTCFullYear();
  const powered = ctx.design.frame.footer.poweredBy ? (
    <li>
      <a href="https://propaganda.pub" data-part="powered">
        Published with Propaganda
      </a>
    </li>
  ) : null;
  const feed = vm.links.feed?.();
  const more = (
    <>
      <li>
        <a href={vm.links.author()}>About</a>
      </li>
      {feed && (
        <li>
          <a href={feed}>RSS</a>
        </li>
      )}
      {powered}
    </>
  );
  if (vm.frame.footer === "columns") {
    return (
      <footer className="pg-footer" data-part="footer" data-variant="columns">
        <div className="pg-footer__inner pg-container">
          <div>
            <p className="pg-footer__name" dir="auto">
              {vm.site.name}
            </p>
            <p>
              © {year} {vm.author.displayName}
            </p>
          </div>
          <div>
            <h2 className="pg-label">Collections</h2>
            <ul role="list">
              {vm.collections.slice(0, 12).map((c) => (
                <li key={c.slug}>
                  <a href={c.href} dir="auto">
                    {c.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="pg-label">More</h2>
            <ul role="list">{more}</ul>
          </div>
        </div>
      </footer>
    );
  }
  return (
    <footer className="pg-footer" data-part="footer" data-variant="minimal">
      <div className="pg-footer__inner pg-container">
        <p dir="auto">
          © {year} {vm.site.name}
        </p>
        <ul role="list">{more}</ul>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- PostCard + PostsBunch */

interface BunchCtx {
  mixed?: boolean;
  key?: string;
  level?: number;
  empty?: string;
  cardLevel?: number;
  lead?: boolean;
}

function Heading({ level, children, ...rest }: { level: number; children: ReactNode } & Record<string, unknown>) {
  const Tag = `h${Math.min(6, Math.max(1, level))}` as "h2";
  return <Tag {...rest}>{children}</Tag>;
}

function PostCard({ post, o, bctx, ctx }: { post: VmPost; o: Options; bctx: BunchCtx; ctx: Ctx }) {
  const card = o.card as string;
  const showCol = o.collection === "show" || (o.collection === "auto" && bctx.mixed);
  const eyebrow: ReactNode[] = [];
  if (showCol)
    eyebrow.push(
      <a key="c" href={post.col.href} data-part="collection" dir="auto" style={{ position: "relative", zIndex: 1 }}>
        {post.col.name}
      </a>,
    );
  if (o.number && post.numberText && card !== "index")
    eyebrow.push(
      <span key="n" data-part="number">
        {post.numberText}
      </span>,
    );
  const title = (
    <Heading level={bctx.cardLevel || 3} className="pg-card__title" data-part="title" data-len={len(post.titleLen)} dir="auto">
      <a href={post.href}>{post.title}</a>
    </Heading>
  );
  const showDek = o.dek && post.dek && card !== "index" && card !== "cover";
  const meta: ReactNode[] = [];
  if (post.dateText)
    meta.push(
      <time key="d" data-part="date" dateTime={post.dateIso ?? undefined}>
        {post.dateText}
      </time>,
    );
  if (o.readTime && post.readText && card !== "index" && card !== "cover")
    meta.push(
      <span key="r" data-part="read-time">
        {post.readText}
      </span>,
    );
  const metaEl = meta.length ? (
    <p className="pg-meta" data-part="meta">
      {meta}
    </p>
  ) : null;
  const wantsMedia = card === "feature" || card === "card" || card === "cover" || (bctx.lead && o.layout === "grid" && card !== "tile");
  const media = card === "feature" ? (post.image ? <Media post={post} ctx={ctx} /> : null) : wantsMedia ? <Media post={post} ctx={ctx} /> : null;
  const body =
    card === "index" ? (
      <div className="pg-card__body">
        {o.number && post.numberText && <span data-part="number">{post.numberText}</span>}
        {title}
        <span className="pg-card__leader" aria-hidden="true" />
        {metaEl}
      </div>
    ) : (
      <div className="pg-card__body">
        {eyebrow.length > 0 && (
          <p className="pg-card__eyebrow pg-label" data-part="eyebrow">
            {eyebrow}
          </p>
        )}
        {title}
        {showDek && (
          <p className="pg-card__dek" data-part="dek" dir="auto">
            {post.dek}
          </p>
        )}
        {metaEl}
      </div>
    );
  return (
    <article
      className="pg-card"
      data-part="card"
      data-card={card}
      data-has-media={media ? "" : undefined}
      data-has-number={o.number && post.numberText ? "" : undefined}
    >
      {card === "feature" ? (
        <>
          {body}
          {media}
        </>
      ) : (
        <>
          {media}
          {body}
        </>
      )}
    </article>
  );
}

function PostsBunch({ posts, o, bctx, ctx }: { posts: VmPost[]; o: Options; bctx: BunchCtx; ctx: Ctx }) {
  if (!posts.length)
    return (
      <p className="pg-empty" data-part="empty">
        {bctx.empty || "Nothing published here yet."}
      </p>
    );
  const extra = bctx.key ? ctx.more[bctx.key] || 0 : 0;
  const limit = o.limit === "all" ? Infinity : Number(o.limit) + extra;
  const shown = posts.slice(0, limit);
  const level = bctx.level || 3;
  const grouped = o.layout === "rows" && o.group === "year";
  const inner: BunchCtx = { ...bctx, cardLevel: grouped ? level + 1 : level };
  const leadId = o.lead ? shown[0]?.id : null;
  const item = (p: VmPost) => (
    <li key={p.id} data-lead={p.id === leadId ? "" : undefined}>
      <PostCard post={p} o={o} bctx={{ ...inner, lead: p.id === leadId }} ctx={ctx} />
    </li>
  );
  let lists: ReactNode;
  if (grouped) {
    const groups: { key: string; items: VmPost[] }[] = [];
    for (const p of shown) {
      const key = p.year != null ? String(p.year) : "Undated";
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) groups.push((g = { key, items: [] }));
      g.items.push(p);
    }
    lists = groups.map((g, i) => (
      <div className="pg-group" data-part="group" key={`${g.key}-${i}`}>
        <Heading level={level} className="pg-group__label pg-label" data-part="group-label">
          {g.key}
        </Heading>
        <ol className="pg-bunch__list" role="list">
          {g.items.map(item)}
        </ol>
      </div>
    ));
  } else {
    lists = (
      <ol className="pg-bunch__list" role="list">
        {shown.map(item)}
      </ol>
    );
  }
  const rest = posts.length - shown.length;
  return (
    <div className="pg-bunch" data-part="bunch" data-layout={o.layout as string} data-cols={(o.columns as string) || "auto"} data-group={o.layout === "rows" ? (o.group as string) : undefined}>
      {lists}
      {rest > 0 && (
        <div className="pg-bunch__more">
          <button className="pg-button" type="button" data-action="more" onClick={() => bctx.key && ctx.showMore(bctx.key, o.limit === "all" ? rest : Number(o.limit))}>
            Show more <span aria-hidden="true">({rest})</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="pg-section-head" data-part="section-head">
      <h2 dir="auto">{title}</h2>
      {link && (
        <a href={link.href}>
          {link.label}
          <Icon name="right" />
        </a>
      )}
    </div>
  );
}

function Tabs({ ctx, current, mode }: { ctx: Ctx; current: string | undefined; mode: "home" | "collection" }) {
  return (
    <nav className="pg-tabs" data-part="tabs" aria-label="Collections">
      {ctx.vm.collections.map((c) => (
        <a
          key={c.slug}
          href={c.href}
          aria-current={c.slug === current ? "page" : undefined}
          title={c.name}
          dir="auto"
          onClick={
            mode === "home"
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  ctx.setHomeTab(c.slug);
                }
              : undefined
          }
        >
          <span className="pg-nav__label">{c.name}</span> <span className="pg-nav__count">{c.count}</span>
        </a>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------- templates */

function System({ title, text, home, ctx }: { title: string; text: string; home?: boolean; ctx: Ctx }) {
  return (
    <div className="pg-container">
      <section className="pg-system" data-part="system">
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {home && (
          <p>
            <a href={ctx.vm.links.home()}>Go to the home page</a>
          </p>
        )}
      </section>
    </div>
  );
}

function Home({ ctx }: { ctx: Ctx }) {
  const { vm } = ctx;
  const o = ctx.design.home;
  const iv = o.intro.variant;
  const stats = o.intro.stats ? (
    <p className="pg-intro__stats pg-label" data-part="stats">
      <span>
        <b>{vm.posts.length}</b> posts
      </span>
      <span>
        <b>{vm.collections.length}</b> collections
      </span>
      {vm.lastText && (
        <span>
          Updated <b>{vm.lastText}</b>
        </span>
      )}
    </p>
  ) : null;
  let intro: ReactNode = null;
  const wrap = (variant: string, children: ReactNode) => (
    <div className="pg-container">
      <section className="pg-intro" data-part="intro" data-variant={variant}>
        {children}
      </section>
    </div>
  );
  const { manifesto, tagline } = vm.site;
  if (iv === "manifesto" && manifesto) {
    intro = wrap(
      "manifesto",
      <>
        <p className="pg-intro__statement" data-part="statement" data-len={len(lenOf(manifesto, [150, 320]))} dir="auto">
          {manifesto}
        </p>
        {stats}
      </>,
    );
  } else if (iv === "compact" && (tagline || manifesto)) {
    intro = wrap(
      "compact",
      <>
        <p className="pg-intro__statement" data-part="statement" dir="auto">
          {manifesto && manifesto.length < 200 ? manifesto : tagline || manifesto}
        </p>
        {stats}
      </>,
    );
  } else if (iv === "author") {
    const a = vm.author;
    intro = wrap(
      "author",
      <>
        <div className="pg-intro__author">
          <Avatar author={a} ctx={ctx} />
          <div>
            <h2 data-len={len(a.nameLen)} dir="auto">
              {a.displayName}
            </h2>
            {a.bio && <p dir="auto">{a.bio.split("\n")[0]}</p>}
            <a href={vm.links.author()}>
              More about me
              <Icon name="right" />
            </a>
          </div>
        </div>
        {stats}
      </>,
    );
  } else if (stats) {
    intro = wrap("compact", stats);
  }
  const f = o.feed;
  let feed: ReactNode;
  if (!vm.posts.length) {
    feed = (
      <section className="pg-section pg-container">
        <PostsBunch posts={[]} o={f} bctx={{ empty: "Nothing has been published yet. Posts appear here as soon as they are." }} ctx={ctx} />
      </section>
    );
  } else if (f.mode === "shelves") {
    feed = vm.collections
      .filter((c) => c.count)
      .map((c) => (
        <section className="pg-section pg-container" key={c.slug}>
          <SectionHead title={c.name} link={{ href: c.href, label: `All ${c.count}` }} />
          <PostsBunch posts={vm.posts.filter((p) => p.col.slug === c.slug)} o={{ ...f, limit: "6", lead: false }} bctx={{ mixed: false }} ctx={ctx} />
        </section>
      ));
  } else if (f.mode === "tabs") {
    const withPosts = vm.collections.find((c) => c.count) || vm.collections[0];
    const slug = ctx.homeTab && vm.collections.some((c) => c.slug === ctx.homeTab) ? ctx.homeTab : withPosts?.slug;
    feed = (
      <section className="pg-section pg-container">
        <Tabs ctx={ctx} current={slug} mode="home" />
        <PostsBunch
          posts={vm.posts.filter((p) => p.col.slug === slug)}
          o={f}
          bctx={{ mixed: false, key: `tab-${slug}`, level: 2, empty: "Nothing published in this collection yet." }}
          ctx={ctx}
        />
      </section>
    );
  } else {
    feed = (
      <section className="pg-section pg-container">
        <SectionHead title="Latest" />
        <PostsBunch posts={vm.posts} o={f} bctx={{ mixed: vm.collections.length > 1, key: "latest" }} ctx={ctx} />
      </section>
    );
  }
  return (
    <>
      <h1 className="pg-sr-only">{vm.site.name}</h1>
      {intro}
      {feed}
    </>
  );
}

function Collection({ ctx, slug }: { ctx: Ctx; slug: string }) {
  const { vm } = ctx;
  const o = ctx.design.collection;
  const c = vm.collections.find((x) => x.slug === slug);
  if (!c) return <System ctx={ctx} title="Not found" text="There’s no collection at this address." home />;
  const h = o.header;
  return (
    <>
      <div className="pg-container">
        <header
          className="pg-coll-head"
          data-part="collection-header"
          data-variant={h.variant as string}
          data-align={vm.frame.header === "stacked" && vm.frame.align === "center" ? "center" : undefined}
        >
          {h.count && (
            <p className="pg-label" data-part="count">
              {c.count} {c.count === 1 ? "post" : "posts"}
            </p>
          )}
          <h1 className="pg-coll-head__title" data-part="title" data-len={len(lenOf(c.name, [28, 60]))} dir="auto">
            {c.name}
          </h1>
          {h.description && c.description && (
            <p className="pg-coll-head__desc" data-part="description" dir="auto">
              {c.description}
            </p>
          )}
        </header>
      </div>
      {h.siblings && vm.collections.length > 1 && (
        <div className="pg-container">
          <Tabs ctx={ctx} current={c.slug} mode="collection" />
        </div>
      )}
      <section className="pg-section pg-container">
        <PostsBunch
          posts={vm.posts.filter((p) => p.col.slug === c.slug)}
          o={o.posts}
          bctx={{ mixed: false, key: `col-${c.slug}`, level: 2, empty: "Nothing published in this collection yet." }}
          ctx={ctx}
        />
      </section>
    </>
  );
}

/** `[[slug]]` wikilinks become ordinary links, labelled with the post's title when it's one of ours. */
function resolveWikilinks(md: string, vm: Vm): string {
  return md.replace(/\[\[([^[\]\n]+?)\]\]/g, (_, raw: string) => {
    const slug = raw.trim();
    const target = vm.posts.find((p) => p.slug === slug);
    return `[${(target?.title || slug).replace(/[[\]]/g, "")}](${target ? target.href : `/p/${encodeURIComponent(slug)}`})`;
  });
}

const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i;
const isImageHref = (href: unknown) => typeof href === "string" && IMAGE_URL.test(href);

/** An image-only paragraph: its images (markdown images, or older posts' bare links to image files). */
function standaloneImages(node: HastElement | undefined): { src: string; alt: string; title: string | null }[] | null {
  if (!node) return null;
  const kids = node.children.filter((c) => !(c.type === "text" && !c.value.trim()));
  if (!kids.length) return null;
  const out: { src: string; alt: string; title: string | null }[] = [];
  for (const k of kids) {
    if (k.type !== "element") return null;
    if (k.tagName === "img") {
      out.push({ src: String(k.properties.src ?? ""), alt: String(k.properties.alt ?? ""), title: k.properties.title ? String(k.properties.title) : null });
    } else if (k.tagName === "a" && isImageHref(k.properties.href)) {
      const text = k.children.map((c) => (c.type === "text" ? c.value : "")).join("");
      out.push({ src: String(k.properties.href), alt: text, title: null });
    } else return null;
  }
  return out;
}

function Prose({ md, wide, dropCap, ctx }: { md: string; wide: boolean; dropCap: boolean; ctx: Ctx }) {
  const components: Components = {
    h1: ({ node: _n, ...p }) => <h2 dir="auto" {...p} />,
    h2: ({ node: _n, className, ...p }) => <h2 dir="auto" className={className === "sr-only" ? "pg-sr-only" : className} {...p} />,
    h3: ({ node: _n, ...p }) => <h3 dir="auto" {...p} />,
    h4: ({ node: _n, ...p }) => <h4 dir="auto" {...p} />,
    li: ({ node: _n, ...p }) => <li dir="auto" {...p} />,
    blockquote: ({ node: _n, ...p }) => <blockquote dir="auto" {...p} />,
    p: ({ node, ...p }) => {
      const imgs = standaloneImages(node);
      if (!imgs) return <p dir="auto" {...p} />;
      return (
        <>
          {imgs.map((im, i) => (
            <Figure key={i} src={im.src} alt={im.alt} caption={im.title} wide={wide} ctx={ctx} />
          ))}
        </>
      );
    },
    img: ({ src, alt }) => <InlineImg src={String(src ?? "")} alt={alt ?? ""} ctx={ctx} />,
    pre: ({ node: _n, ...p }) => <pre data-width={wide ? "wide" : undefined} {...p} />,
    table: ({ node: _n, ...p }) => (
      <div className="pg-table" tabIndex={0} role="region" aria-label="Table">
        <table {...p} />
      </div>
    ),
    a: ({ node, href, children, ...p }) => {
      if (node?.properties?.dataFootnoteBackref !== undefined) {
        return (
          <a href={href} className="pg-backref">
            <Icon name="back" />
            <span className="pg-sr-only">Back to the text</span>
          </a>
        );
      }
      if (isImageHref(href)) return <InlineImg src={String(href)} alt={typeof children === "string" ? children : ""} ctx={ctx} />;
      const external = typeof href === "string" && /^https?:\/\//i.test(href) && typeof window !== "undefined" && !href.includes(window.location.host);
      return (
        <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer noopener" : undefined} {...p}>
          {children}
        </a>
      );
    },
  };
  return (
    <div className="pg-prose" data-part="prose" data-dropcap={dropCap ? "true" : undefined}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
}

function Post({ ctx, post }: { ctx: Ctx; post: VmPost | null }) {
  const { vm } = ctx;
  if (!post) return <System ctx={ctx} title="Not found" text="That post isn’t published, or the address is off." home />;
  const o = ctx.design.post;
  const h = o.header;
  const meta: ReactNode[] = [];
  if (post.dateText)
    meta.push(
      <time key="d" data-part="date" dateTime={post.dateIso ?? undefined}>
        {post.dateText}
      </time>,
    );
  if (h.readTime && post.readText)
    meta.push(
      <span key="r" data-part="read-time">
        {post.readText}
      </span>,
    );
  const metaEl = meta.length ? (
    <p className="pg-meta" data-part="meta">
      {meta}
    </p>
  ) : null;
  const a = o.after;
  const peers = vm.posts.filter((p) => p.col.slug === post.col.slug);
  const i = peers.indexOf(post);
  const older = peers[i + 1], newer = i > 0 ? peers[i - 1] : undefined;
  const au = vm.author;
  const navLink = (p: VmPost | undefined, dir: "prev" | "next") =>
    p ? (
      <a href={p.href} data-dir={dir}>
        <span className="pg-label">
          {dir === "prev" ? (
            <>
              <Icon name="left" />
              Previous
            </>
          ) : (
            <>
              Next
              <Icon name="right" />
            </>
          )}
        </span>
        <span className="pg-postnav__title" dir="auto">
          {p.title}
        </span>
      </a>
    ) : (
      <span />
    );
  const others = a.more !== "none" ? peers.filter((p) => p !== post) : [];
  const after: ReactNode[] = [];
  if (a.authorCard)
    after.push(
      <section className="pg-author-card" data-part="author-card" key="a">
        <Avatar author={au} ctx={ctx} />
        <div>
          <h2 dir="auto">{au.displayName}</h2>
          {au.bio && <p dir="auto">{au.bio.split("\n")[0]}</p>}
          <a className="pg-more" href={vm.links.author()}>
            About the author
            <Icon name="right" />
          </a>
        </div>
      </section>,
    );
  if (a.details)
    after.push(
      <dl className="pg-details" data-part="details" key="d">
        <dt>Filed under</dt>
        <dd dir="auto">{post.col.name}</dd>
        {post.words ? (
          <>
            <dt>Words</dt>
            <dd>{post.words.toLocaleString("en")}</dd>
          </>
        ) : null}
        {post.dateText && (
          <>
            <dt>Published</dt>
            <dd>{post.dateText}</dd>
          </>
        )}
        <dt>Address</dt>
        <dd>{`${vm.site.host}/${post.col.slug}/${post.slug}`}</dd>
      </dl>,
    );
  if (a.nav !== "none" && (older || newer))
    after.push(
      <nav className="pg-postnav" data-part="post-nav" data-variant={a.nav as string} aria-label={`More in ${post.col.name}`} key="n">
        {navLink(older, "prev")}
        {navLink(newer, "next")}
      </nav>,
    );
  return (
    <>
      <article className="pg-flow" data-part="post">
        <header className="pg-post-head" data-part="post-header" data-align={h.align as string} data-width={h.width as string}>
          <p className="pg-post-head__eyebrow pg-label" data-part="eyebrow">
            <a href={post.col.href} data-part="collection" dir="auto">
              {post.col.name}
            </a>
            {h.number && post.numberText && <span data-part="number">{post.numberText}</span>}
          </p>
          <h1 className="pg-post-head__title" data-part="title" data-len={len(post.titleLen)} dir="auto">
            {post.title}
          </h1>
          {h.dek && post.dek && (
            <p className="pg-post-head__dek" data-part="dek" data-len={len(post.dekLen)} dir="auto">
              {post.dek}
            </p>
          )}
          {h.byline ? (
            <div className="pg-byline" data-part="byline">
              <Avatar author={au} ctx={ctx} />
              <div className="pg-byline__who">
                <span className="pg-byline__name">
                  <a href={vm.links.author()} dir="auto">
                    {au.displayName}
                  </a>
                </span>
                {metaEl}
              </div>
            </div>
          ) : (
            metaEl
          )}
        </header>
        <Prose md={resolveWikilinks(post.content || post.dek || "", vm)} wide={o.body.images === "wide"} dropCap={!!o.body.dropCap} ctx={ctx} />
        {after.length > 0 && (
          <div className="pg-after" data-part="after">
            {after}
          </div>
        )}
      </article>
      {others.length > 0 && (
        <section className="pg-section pg-container" data-part="more">
          <SectionHead title={`More from ${post.col.name}`} link={{ href: post.col.href, label: "All" }} />
          <PostsBunch posts={others} o={{ ...ctx.design.collection.posts, limit: a.more as string, lead: false, group: "none" }} bctx={{ mixed: false }} ctx={ctx} />
        </section>
      )}
    </>
  );
}

function Author({ ctx }: { ctx: Ctx }) {
  const { vm } = ctx;
  const o = ctx.design.author;
  const a = vm.author;
  const h = o.header;
  return (
    <>
      <div className="pg-container">
        <header className="pg-author-head" data-part="author-header" data-variant={h.variant as string}>
          {h.avatar && <Avatar author={a} ctx={ctx} />}
          <div className="pg-author-head__text">
            <h1 data-len={len(a.nameLen)} dir="auto">
              {a.displayName}
            </h1>
            {a.tagline && (
              <p className="pg-author-head__tagline" dir="auto">
                {a.tagline}
              </p>
            )}
            <p className="pg-meta" data-part="meta">
              {a.location && <span dir="auto">{a.location}</span>}
              <span>
                {vm.posts.length} {vm.posts.length === 1 ? "post" : "posts"}
              </span>
            </p>
            {h.links && a.links.length > 0 && (
              <p className="pg-author-head__links" data-part="links">
                {a.links.map((l, i) => (
                  <a key={i} href={l.url} rel="me noopener">
                    {l.label}
                  </a>
                ))}
              </p>
            )}
          </div>
        </header>
      </div>
      {a.bio && (
        <div className="pg-container">
          <div className="pg-author-bio pg-prose" data-part="bio">
            {a.bio.split(/\n+/).map((pp, i) => (
              <p dir="auto" key={i}>
                {pp}
              </p>
            ))}
          </div>
        </div>
      )}
      <section className="pg-section pg-container">
        <SectionHead title="All posts" />
        <PostsBunch posts={vm.posts} o={o.posts} bctx={{ mixed: vm.collections.length > 1, key: "author", empty: "No posts yet." }} ctx={ctx} />
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- the page */

export interface PgSiteProps {
  vm: Vm;
  design: Design;
  attrs: Record<string, string>;
  route: PgRoute;
  imageSrc?: (src: string) => string;
  /** Overrides the page for this route (the live blog's "private" and "loading" states). */
  page?: { title: string; text: string; home?: boolean } | null;
}

/** The post a route points at: by collection and slug, else by slug alone. */
export function postOf(vm: Vm, route: PgRoute): VmPost | null {
  if (route.tpl !== "post") return null;
  return (
    vm.posts.find((p) => p.slug === route.post && (!route.collection || p.col.slug === route.collection)) ??
    (route.collection ? null : vm.posts.find((p) => p.slug === route.post) ?? null)
  );
}

const identity = (s: string) => s;

export function PgSite({ vm, design, attrs, route, imageSrc = identity, page }: PgSiteProps) {
  const [more, setMore] = useState<Record<string, number>>({});
  const [homeTab, setHomeTab] = useState<string | null>(null);
  const ctx: Ctx = {
    vm,
    design,
    imageSrc,
    more,
    showMore: (key, by) => setMore((m) => ({ ...m, [key]: (m[key] || 0) + by })),
    homeTab,
    setHomeTab,
  };
  let main: ReactNode;
  if (page) main = <System ctx={ctx} title={page.title} text={page.text} home={page.home} />;
  else if (route.tpl === "collection") main = <Collection ctx={ctx} slug={route.collection} />;
  else if (route.tpl === "post") main = <Post ctx={ctx} post={postOf(vm, route)} />;
  else if (route.tpl === "author") main = <Author ctx={ctx} />;
  else main = <Home ctx={ctx} />;
  return (
    <div className="pg-site" {...attrs} lang={vm.site.lang}>
      <a className="pg-skip" href="#pg-main">
        Skip to content
      </a>
      <div className="pg-page" data-header={vm.frame.header}>
        <SiteHeader ctx={ctx} route={route} />
        <main className="pg-main" id="pg-main" data-template={route.tpl}>
          <Fragment key={route.tpl === "post" ? `post-${route.post}` : route.tpl}>{main}</Fragment>
        </main>
        <SiteFooter ctx={ctx} />
      </div>
    </div>
  );
}
