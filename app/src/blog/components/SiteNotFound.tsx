// Shown when the current host/path resolves to no site: an unmapped domain,
// no /@slug prefix and no VITE_DEFAULT_SITE_SLUG fallback, or an unknown slug.

export function SiteNotFound() {
  return (
    <div className="blog-app">
      <div className="blog-article">
        <h1>Site not found.</h1>
        <p className="dek">There's no site published at this address.</p>
        <p>
          <a href="/admin">Go to admin →</a>
        </p>
      </div>
    </div>
  );
}
