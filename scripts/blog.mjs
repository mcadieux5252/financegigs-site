// Builds the blog (Dev Spec: GEO Blog and 2027 Outlook Posts; Mike, 2026-11-15: a post every week, live on Saturday)
// from the Markdown in content/blog/<slug>.md, as plain HTML with every number in the page source:
//   /blog          the index, newest first (blog.html)
//   /blog/<slug>   each post (blog/<slug>.html)
// A post shows only once its `published` date has come in Eastern time, so a post merged on Wednesday goes live on
// Saturday when the site's daily workflow rebuilds. BLOG_TODAY=yyyy-mm-dd overrides today, to check a post before then.
// Called by scripts/hiring-trends.mjs, which wraps each page in this site's head, nav and footer and writes the sitemap.
// The weekly run that writes the posts is procurement-gigs-app claude/blog-playbook.md.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const easternToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const longDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const plain = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')

export const BLOG_CSS = `.blog{max-width:760px;margin:0 auto;padding:32px 20px;line-height:1.65}
.blog h1{font-size:32px;line-height:1.2;margin:8px 0 16px}.blog h2{font-size:22px;line-height:1.3;margin:36px 0 8px}.blog h3{font-size:18px;margin:24px 0 6px}
.blog .bl-answer{font-size:19px}.blog .bl-dates,.blog .bl-crumbs,.blog .bl-meta{color:#6e6e73;font-size:14px}
.blog table{border-collapse:collapse;width:100%;margin:12px 0;font-size:15px}
.blog caption{text-align:left;color:#6e6e73;font-size:13px;padding-bottom:6px}
.blog th,.blog td{border-bottom:1px solid #e5e5ea;padding:8px 10px;text-align:left}
.blog td{font-variant-numeric:tabular-nums}.blog thead th{font-size:13px;color:#424245}
.blog .bl-join{background:#f5f5f7;border-radius:16px;padding:8px 24px 20px;margin-top:36px}
.blog .bl-button{display:inline-block;padding:12px 22px;border-radius:980px;color:#fff;background:#1d1d1f;text-decoration:none;font-weight:600}
.blog .bl-list{list-style:none;padding:0}.blog .bl-list li{padding:16px 0;border-bottom:1px solid #e5e5ea}
.blog .bl-list a{font-size:19px;font-weight:600}
.blog p a,.blog li a,.blog .bl-crumbs a,.blog .bl-meta a{color:inherit;text-decoration:underline;text-underline-offset:2px}`

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
}

function frontMatter(src, file) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${file}: no front matter`)
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  for (const k of ['title', 'description', 'answer', 'published']) if (!meta[k]) throw new Error(`${file}: front matter needs ${k}`)
  if ((meta.seo_title || meta.title).length > 60) throw new Error(`${file}: the title is over 60 characters; add a shorter seo_title`)
  if (meta.description.length > 155) throw new Error(`${file}: the description is over 155 characters`)
  for (const k of ['published', 'updated']) if (meta[k] && !/^\d{4}-\d{2}-\d{2}$/.test(meta[k])) throw new Error(`${file}: ${k} must be yyyy-mm-dd`)
  meta.updated ||= meta.published
  if (meta.updated < meta.published) throw new Error(`${file}: updated is before published`)
  return { meta, body: m[2] }
}

// Markdown to HTML: ## and ### headings, paragraphs, - and 1. lists, **bold**, [links](url), and pipe tables with a
// "Table: caption" line above them. Returns the HTML and the question sections (for the FAQPage JSON-LD).
export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n')
  const out = [], faq = []
  let i = 0, section = null
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    let h
    if ((h = l.match(/^(#{2,3})\s+(.+)$/))) {
      const level = h[1].length
      out.push(`<h${level}>${inline(h[2])}</h${level}>`)
      section = level === 2 && h[2].trim().endsWith('?') ? { q: plain(h[2].trim()), a: '' } : (level === 2 ? null : section)
      if (section && level === 2) faq.push(section)
      i++; continue
    }
    if (/^Table:\s*/.test(l) || l.trim().startsWith('|')) {
      let caption = ''
      if (/^Table:\s*/.test(l)) { caption = l.replace(/^Table:\s*/, ''); i++ }
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++ }
      if (rows.length < 3 || !/^\|?\s*:?-{3,}/.test(rows[1].trim())) throw new Error(`A table needs a header row, a --- row and data rows (near "${caption || rows[0] || l}")`)
      const head = cells(rows[0]), body = rows.slice(2).map(cells)
      out.push(`<table>${caption ? `<caption>${inline(caption)}</caption>` : ''}<thead><tr>${head.map(c => `<th scope="col">${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map(r => `<tr>${r.map((c, j) => j === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^(-|\d+\.)\s+/.test(l)) {
      const ordered = /^\d+\./.test(l), items = []
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^(-|\d+\.)\s+/, '')); i++ }
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
      if (section && !section.a) section.a = items.map(plain).join(' ')
      continue
    }
    const para = []
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|Table:|\||-\s|\d+\.\s)/.test(lines[i])) { para.push(lines[i].trim()); i++ }
    const text = para.join(' ')
    out.push(`<p>${inline(text)}</p>`)
    if (section && !section.a) section.a = plain(text)
  }
  return { html: out.join('\n'), faq: faq.filter(f => f.a) }
}

export function loadPosts(root, today = process.env.BLOG_TODAY || easternToday()) {
  const dir = join(root, 'content', 'blog')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const slug = f.replace(/\.md$/, '')
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error(`content/blog/${f}: the slug must be lowercase words joined by hyphens`)
    const { meta, body } = frontMatter(readFileSync(join(dir, f), 'utf8'), `content/blog/${f}`)
    return { slug, ...meta, body }
  }).filter(p => p.published <= today).sort((a, b) => b.published.localeCompare(a.published) || a.slug.localeCompare(b.slug))
}

// Writes the blog pages through the site's page() and write(), and returns the sitemap entries and the llms.txt lines
export function buildBlog({ root, page, write, SITE, NAME, BRAND, APP, OG_IMAGE }) {
  const posts = loadPosts(root)
  const org = { '@type': 'Organization', name: NAME, url: `${SITE}/` }
  const urls = [], llms = []
  const crumbs = extra => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog` },
    ...(extra ? [{ '@type': 'ListItem', position: 3, name: extra.name, item: extra.url }] : []),
  ] })
  const indexTitle = `${NAME} Blog: Job Market Data and Career Questions`
  const indexDescription = `Plain answers to career questions, from the roles employers post on their own career sites. By ${NAME}.`

  for (const p of posts) {
    const url = `${SITE}/blog/${p.slug}`
    const { html, faq } = markdown(p.body)
    const related = posts.filter(o => o.slug !== p.slug).slice(0, 2)
    const join = `${APP}/join?utm_source=blog&utm_medium=web&utm_campaign=${p.slug}`
    const main = `<article class="blog">
<nav aria-label="Breadcrumb" class="bl-crumbs"><a href="${SITE}/">Home</a> / <a href="${SITE}/blog">Blog</a></nav>
<h1>${esc(p.title)}</h1>
<p class="bl-answer">${inline(p.answer)}</p>
<p class="bl-dates">By ${esc(NAME)} Research. Published <time datetime="${p.published}">${longDate(p.published)}</time>${p.updated !== p.published ? `, updated <time datetime="${p.updated}">${longDate(p.updated)}</time>` : ''}.</p>
${html}
<section class="bl-join"><h2>Get roles like these matched to you</h2>
<p>${esc(NAME)} matches you to the roles we sync from employers' own career sites, by text and email. Most matches reach members within a day of the employer posting them.</p>
<p><a class="bl-button" href="${esc(join)}">Join free</a></p></section>
<h2>Related</h2>
<ul>
<li><a href="${SITE}/hiring-trends">${esc(NAME)} Hiring Trends</a>: this month's hiring data, updated monthly.</li>
${related.map(o => `<li><a href="${SITE}/blog/${o.slug}">${esc(o.title)}</a></li>`).join('\n')}
</ul>
</article>`
    const jsonLd = [
      { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.description,
        datePublished: p.published, dateModified: p.updated, author: org, publisher: org, image: OG_IMAGE,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url, inLanguage: 'en-US' },
      crumbs({ name: p.title, url }),
      ...(faq.length >= 2 ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(f => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] : []),
    ]
    const short = p.seo_title || p.title
    const title = `${short} | ${NAME}`.length <= 60 ? `${short} | ${NAME}` : short
    write(`blog/${p.slug}`, page({ title, description: p.description, canonical: url, jsonLd, css: BLOG_CSS, main }))
    urls.push({ loc: url, lastmod: p.updated })
    llms.push(`- [${p.title}](${url}): ${p.description}`)
  }

  const list = posts.length
    ? `<ul class="bl-list">\n${posts.map(p => `<li><a href="${SITE}/blog/${p.slug}">${esc(p.title)}</a><p>${inline(p.answer)}</p><p class="bl-meta"><time datetime="${p.published}">${longDate(p.published)}</time></p></li>`).join('\n')}\n</ul>`
    : '<p>Our first post is on its way. Check back soon.</p>'
  const index = `<article class="blog">
<nav aria-label="Breadcrumb" class="bl-crumbs"><a href="${SITE}/">Home</a> / Blog</nav>
<h1>${esc(NAME)} Blog</h1>
<p class="bl-answer">Plain answers to the questions people ask about their careers, from the roles employers post on their own career sites.</p>
<p class="bl-meta">For this month's numbers in full, see <a href="${SITE}/hiring-trends">${esc(NAME)} Hiring Trends</a>.</p>
${list}
</article>`
  write('blog', page({ title: indexTitle, description: indexDescription, canonical: `${SITE}/blog`, css: BLOG_CSS, main: index,
    noindex: !posts.length, jsonLd: posts.length ? [crumbs()] : [] }))
  if (posts.length) {
    urls.unshift({ loc: `${SITE}/blog`, lastmod: posts.map(p => p.updated).sort().pop() })
    llms.unshift(`- [${NAME} Blog](${SITE}/blog): plain answers to career questions, from our own job posting data.`)
  }

  // llms.txt keeps a "## Blog" section listing the live posts (none until the first one is live)
  const llmsFile = join(root, 'llms.txt')
  if (existsSync(llmsFile)) {
    const cur = readFileSync(llmsFile, 'utf8')
    const without = cur.replace(/\n## Blog\n[\s\S]*?(?=\n## |$)/, '\n').replace(/\n{3,}/g, '\n\n')
    const next = llms.length ? without.replace(/\n## Members and employers\n/, `\n## Blog\n${llms.join('\n')}\n\n## Members and employers\n`) : without
    if (next !== cur) writeFileSync(llmsFile, next)
  }
  return { posts, urls }
}
