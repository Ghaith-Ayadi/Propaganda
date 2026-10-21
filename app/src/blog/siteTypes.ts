// The site a blog page shows, as every blog component sees it. blog/site.ts
// resolves it in the browser (and imports the API client); the rendering
// function (blog/server/) resolves it from the host it was asked for.

export interface BlogSite {
  id: string;
  slug: string;
  domain: string;
  name: string;
  analyticsTenant: string;
}
