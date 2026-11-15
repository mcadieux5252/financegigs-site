// Builds the Hiring Trends pages (and the blog, scripts/blog.mjs) from the app's public data at deploy time (Dev Spec: Hiring Trends Pages, Nov 2026),
// so search engines and AI assistants read plain HTML with every number in it:
//   /hiring-trends            the latest approved month (hiring-trends.html)
//   /hiring-trends/<yyyy-mm>  every published month, kept for good (never deleted)
//   /hiring-trends/archive    the list of months
//   /sitemap.xml              this site's pages, with the Hiring Trends pages and their dates
// The page body, title, description, canonical, JSON-LD and CSS come from the app's one renderer
// (procurement-gigs-app lib/hiring-trends/render.ts); this script wraps them in this site's own head, nav and footer,
// taken from SHELL at build time so they always match the live site. The same script runs on all three brand sites;
// only the settings below differ. It fails the build (Netlify keeps the last good deploy) when the data can't be read,
// and when any page, title or meta tag has an em dash.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { buildBlog } from './blog.mjs'

const BRAND = 'finance'
const NAME = 'FinanceGigs'
const SITE = 'https://financegigs.ai'
const API = process.env.HIRING_TRENDS_API || 'https://app.financegigs.ai/api/public/hiring-trends'
const SHELL = 'compensation.html'
const STATIC_PAGES = ['/', '/compensation', '/team-compensation', '/employers', '/privacy', '/terms']
const OG_IMAGE = 'https://financegigs.ai/og-image.png'
const APP = 'https://app.financegigs.ai'

const ROOT = process.cwd()
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const monthName = p => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) }
const day = iso => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const isoDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))

async function get(params) {
  const url = `${API}?brand=${BRAND}&${params}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (res.status === 404 && params.startsWith('period=') && params !== 'period=all') return null
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

// The site's own head (without its title, description, canonical and share tags), nav and footer
const shellHtml = readFileSync(join(ROOT, SHELL), 'utf8')
const headEnd = shellHtml.indexOf('</head>'), mainStart = shellHtml.indexOf('<main>'), mainEnd = shellHtml.indexOf('</main>')
if (headEnd < 0 || mainStart < 0 || mainEnd < 0) throw new Error(`${SHELL} has no head or main element to build from`)
const baseHead = shellHtml.slice(0, headEnd).split('\n')
  .filter(l => !/<title>|<meta name="description"|<link rel="canonical"|<meta property="og:|<meta name="twitter:|<meta name="robots"/.test(l)).join('\n')
const nav = shellHtml.slice(headEnd + '</head>'.length, mainStart)
const tail = shellHtml.slice(mainEnd + '</main>'.length)

function page({ title, description, canonical, jsonLd = [], css = '', main, noindex = false }) {
  const tags = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    noindex ? '<meta name="robots" content="noindex">' : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${NAME}.AI">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    ...jsonLd.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`),
    css ? `<style>${css}</style>` : '',
  ].filter(Boolean).join('\n')
  return `${baseHead}\n${tags}\n</head>${nav}<main>\n${main}\n</main>${tail}`
}

// Each page is a file named after its path (hiring-trends.html, hiring-trends/2026-11.html), the way this site serves
// /compensation: Netlify answers a folder's address with a redirect to its trailing slash, which the canonical address
// must not do. _redirects maps /hiring-trends itself to its file, since the hiring-trends folder sits beside it.
function write(path, html) {
  const file = join(ROOT, `${path}.html`)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, html)
}

const { months } = await get('period=all')
const latest = months.length ? await get('period=latest') : null
const urls = STATIC_PAGES.map(p => ({ loc: `${SITE}${p === '/' ? '/' : p}` }))

if (!latest) {
  // Nothing approved yet: a holding page, kept out of search and the sitemap
  const holding = `<article class="hiring-trends" style="max-width:880px;margin:0 auto;padding:48px 20px;line-height:1.6"><h1>Hiring Trends</h1><p>Our first monthly Hiring Trends report is being prepared. Check back soon.</p></article>`
  write('hiring-trends', page({ title: `Hiring Trends | ${NAME}`, description: `Monthly hiring data from employers' own career sites, from ${NAME}.`, canonical: `${SITE}/hiring-trends`, main: holding, noindex: true }))
  write('hiring-trends/archive', page({ title: `Hiring Trends Archive | ${NAME}`, description: `Past monthly Hiring Trends reports from ${NAME}.`, canonical: `${SITE}/hiring-trends/archive`, main: holding, noindex: true }))
} else {
  write('hiring-trends', page(latest.page))
  urls.push({ loc: latest.page.canonical, lastmod: isoDay(latest.asOf) })
  for (const m of months) {
    const one = await get(`period=${m.period}`)
    if (!one) continue
    write(`hiring-trends/${m.period}`, page(one.page))
    urls.push({ loc: one.page.canonical, lastmod: isoDay(one.asOf) })
  }
  const items = months.map(m => `<li><a href="/hiring-trends/${m.period}">${esc(monthName(m.period))}</a>, data as of ${esc(day(m.asOf))}</li>`).join('\n')
  const archive = `<article class="hiring-trends">
<nav aria-label="Breadcrumb" class="ht-crumbs"><a href="${SITE}/">Home</a> / <a href="${SITE}/hiring-trends">Hiring Trends</a> / Archive</nav>
<h1>Hiring Trends archive</h1>
<p>Every month's Hiring Trends report, from the roles employers post on their own career sites. Each stays at its own address.</p>
<ul>
${items}
</ul>
<p><a href="/hiring-trends">See the latest month</a></p>
</article>`
  write('hiring-trends/archive', page({
    title: `Hiring Trends Archive | ${NAME}`,
    description: `Every monthly Hiring Trends report from ${NAME}, from the roles employers post on their own career sites.`,
    canonical: `${SITE}/hiring-trends/archive`, css: latest.page.css, main: archive,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Hiring Trends', item: `${SITE}/hiring-trends` },
      { '@type': 'ListItem', position: 3, name: 'Archive', item: `${SITE}/hiring-trends/archive` },
    ] }],
  }))
  urls.push({ loc: `${SITE}/hiring-trends/archive`, lastmod: isoDay(latest.asOf) })
}

// The blog (scripts/blog.mjs): its pages, and its posts in the sitemap and llms.txt
const blog = buildBlog({ root: ROOT, page, write, SITE, NAME, BRAND, APP, OG_IMAGE })
urls.push(...blog.urls)

writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`)

// No em dash anywhere this site serves as text
const bad = []
const scan = dir => {
  for (const f of readdirSync(dir)) {
    if (f.startsWith('.') || f === 'node_modules') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) scan(p)
    else if (/\.(html|xml|txt)$/.test(f) && readFileSync(p, 'utf8').includes('\u2014')) bad.push(p.slice(ROOT.length + 1))
  }
}
scan(ROOT)
if (bad.length) { console.error(`Em dash found in: ${bad.join(', ')}`); process.exit(1) }
console.log(`Hiring Trends: ${latest ? `${months.length} month(s), latest ${latest.period}` : 'no approved month yet, holding page'}; blog ${blog.posts.length} post(s); sitemap ${urls.length} URLs`)
