// MD Fit edge guard (Vercel Routing Middleware). Runs before every page and API request.
// 1. US only: visitors outside the United States (and its territories) are refused.
// 2. Bots and scrapers are refused (search engines stay allowed for the public homepage).
// 3. /api/* is proxied to the Railway API with a secret header, and the API refuses anything without it,
//    so the API can't be reached directly, from abroad, or by a scraper going around the site.
export const config = { matcher: "/((?!_vercel).*)" };

const API = "https://amiable-peace-production-e382.up.railway.app";
const ALLOWED = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);
const BAD_UA = /(curl|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|java\/|okhttp|libwww|scrapy|httpclient|node-fetch|axios|postman|insomnia|headless|phantomjs|selenium|puppeteer|playwright|crawler|spider|scraper|gptbot|chatgpt-user|oai-searchbot|ccbot|claudebot|claude-web|anthropic-ai|bytespider|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|dataforseo|amazonbot|perplexitybot|youbot|diffbot|imagesiftbot|omgili|zgrab|masscan|nmap|nikto|sqlmap|wpscan)/i;
const SEARCH = /(googlebot|bingbot|duckduckbot|applebot)/i;
const PRIVATE = /^\/(account|admin|api|login|cancel|intake)/;

const page = (status, title, text) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>` +
  `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0A1A2E;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px">` +
  `<div><h1 style="font-family:Georgia,serif;font-weight:700">${title}</h1><p style="color:#c9d1dc;max-width:420px">${text}</p><p style="color:#7AAFD7">MD Fit · Sarasota, FL · 941-313-0562</p></div></body>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });

export default async function middleware(request) {
  const url = new URL(request.url);
  const country = request.headers.get("x-vercel-ip-country") || "";
  const ua = request.headers.get("user-agent") || "";

  // 1. Country lock (header is always set on Vercel; only missing in local development)
  if (country && !ALLOWED.has(country)) return page(403, "Not available in your region", "MD Fit's website and app are only available in the United States.");

  // 2. Bots and scrapers. Search engines may read the public homepage only.
  if (!ua || BAD_UA.test(ua)) return page(403, "Automated access isn't allowed", "This site can only be used in a web browser or the MD Fit app.");
  if (SEARCH.test(ua) && PRIVATE.test(url.pathname)) return page(403, "Private", "This page is private.");

  // 3. API proxy with the edge secret and the visitor's real IP (for rate limiting)
  if (url.pathname.startsWith("/api/")) {
    const headers = new Headers(request.headers);
    ["host", "x-mdfit-edge", "x-mdfit-client-ip", "cookie"].forEach((h) => headers.delete(h));
    headers.set("x-mdfit-edge", process.env.EDGE_SECRET || "");
    headers.set("x-mdfit-client-ip", (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim());
    const hasBody = !["GET", "HEAD"].includes(request.method);
    const r = await fetch(API + url.pathname + url.search, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined, redirect: "manual" });
    const out = new Headers(r.headers);
    ["content-encoding", "content-length", "transfer-encoding", "connection"].forEach((h) => out.delete(h));
    return new Response(r.body, { status: r.status, headers: out });
  }

  // Continue to the page
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}
