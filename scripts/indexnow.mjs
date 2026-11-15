// Tells search engines (Bing, and the others in IndexNow: Yandex, Seznam, Naver) about the Hiring Trends pages as soon
// as a new month is live, instead of waiting for their next crawl (Mike, 2026-11-15). Bing feeds ChatGPT search and
// Copilot. Run by the daily Hiring Trends workflow after it commits changed pages. The key file at the site root
// (<key>.txt) is public by design: hosting it is how IndexNow knows the site is ours. No account or secret is needed.

import { readFileSync, readdirSync } from 'node:fs'

const sitemap = readFileSync('sitemap.xml', 'utf8')
const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), m => m[1])
const site = new URL(urls[0]).origin
const keyFile = readdirSync('.').find(f => /^[0-9a-f]{32}\.txt$/.test(f))
if (!keyFile) throw new Error('No IndexNow key file at the site root')
const key = keyFile.slice(0, -4)
const pages = urls.filter(u => u.includes('/hiring-trends'))
if (!pages.length) { console.log('No Hiring Trends pages to submit'); process.exit(0) }

// Wait until Netlify has deployed the commit: the live page shows the data date the build just wrote
const local = readFileSync('hiring-trends.html', 'utf8').match(/Data as of <time datetime="([\d-]+)">/)?.[1]
for (let i = 0; local && i < 40; i++) {
  const live = await fetch(`${site}/hiring-trends`, { cache: 'no-store' }).then(r => r.text()).catch(() => '')
  if (live.includes(`datetime="${local}"`)) break
  if (i === 39) throw new Error(`The live page never showed data as of ${local}`)
  await new Promise(r => setTimeout(r, 15000))
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(site).host, key, keyLocation: `${site}/${keyFile}`, urlList: [...pages, `${site}/sitemap.xml`] }),
})
if (![200, 202].includes(res.status)) throw new Error(`IndexNow answered ${res.status}: ${await res.text()}`)
console.log(`IndexNow: submitted ${pages.length + 1} addresses for ${site} (${res.status})`)
