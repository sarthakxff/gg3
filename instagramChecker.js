/**
 * instagramChecker.js
 * Checks if an Instagram account is accessible (unbanned)
 * WITHOUT logging in — uses only public profile endpoint.
 * Rotates user agents to reduce bot fingerprinting.
 */

const axios = require("axios");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

let uaIndex = 0;
function getNextUserAgent() {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex++;
  return ua;
}

// Always positive jitter — never returns negative ms
function jitter(baseMs) {
  return baseMs + Math.floor(Math.random() * 5000);
}

const STATUS = {
  BANNED:       "BANNED",
  ACCESSIBLE:   "ACCESSIBLE",
  RATE_LIMITED: "RATE_LIMITED",
  ERROR:        "ERROR",
};

/**
 * Check if an Instagram username is currently accessible.
 *
 * THE KEY FIX vs the original:
 *   Original code assumed BANNED on any ambiguous 200 response.
 *   That caused false bans because Instagram almost always shows a
 *   login wall (HTTP 200 + login page HTML) for real accounts.
 *   A login wall = account EXISTS = ACCESSIBLE.
 *   Now ambiguous responses return ERROR so the bot retries instead.
 */
async function checkAccount(username) {
  const url       = `https://www.instagram.com/${username}/`;
  const checkedAt = new Date();

  try {
    const response = await axios.get(url, {
      timeout:      12000,
      maxRedirects: 5,
      headers: {
        "User-Agent":                getNextUserAgent(),
        Accept:                      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language":           "en-US,en;q=0.9",
        "Accept-Encoding":           "gzip, deflate, br",
        Connection:                  "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest":            "document",
        "Sec-Fetch-Mode":            "navigate",
        "Sec-Fetch-Site":            "none",
        "Cache-Control":             "no-cache",
      },
      validateStatus: () => true, // never throw on any HTTP status
    });

    const { status: httpStatus, data } = response;

    // ── Rate limited ──────────────────────────────────────────────────────
    if (httpStatus === 429) {
      return { status: STATUS.RATE_LIMITED, checkedAt, detail: "Rate limited by Instagram (429). Backing off." };
    }

    // ── Definite ban: 404 ─────────────────────────────────────────────────
    if (httpStatus === 404) {
      return { status: STATUS.BANNED, checkedAt, detail: "Profile not found (HTTP 404) — account is banned/deleted." };
    }

    // ── Network / server errors ───────────────────────────────────────────
    if (httpStatus !== 200) {
      return { status: STATUS.ERROR, checkedAt, detail: `Unexpected HTTP ${httpStatus} — will retry.` };
    }

    // ── HTTP 200 — read the page content ──────────────────────────────────
    const html = typeof data === "string" ? data : JSON.stringify(data);

    // DEFINITE BAN: these phrases ONLY appear on Instagram's "account not found" page
    const definitelyBanned =
      html.includes("Sorry, this page isn\u2019t available.") || // unicode apostrophe
      html.includes("Sorry, this page isn't available.")       || // straight apostrophe
      html.includes("The link you followed may be broken")     ||
      html.includes("the page may have been removed");

    if (definitelyBanned) {
      return { status: STATUS.BANNED, checkedAt, detail: "Page shows 'not available' — account is banned/deleted." };
    }

    // ACCESSIBLE: Login wall means account EXISTS — Instagram just wants you to log in.
    // This is the most common response for real accounts. NEVER treat as banned.
    const loginWall =
      html.includes("Log in to Instagram")           ||
      html.includes("loginForm")                     ||
      html.includes("accounts/login")                ||
      html.includes("to see photos and videos")      ||
      html.includes("Sign up to see")                ||
      html.includes("You must be 18");

    if (loginWall) {
      return { status: STATUS.ACCESSIBLE, checkedAt, detail: "Login wall shown — account exists and is accessible." };
    }

    // ACCESSIBLE: Profile data visible in page (no login needed)
    const usernameLower = username.toLowerCase();
    const hasProfileData =
      html.includes(`"username":"${usernameLower}"`)  ||
      html.includes(`"username": "${usernameLower}"`) ||
      html.includes(`"ProfilePage"`)                  ||
      html.includes(`"graphql"`)                      ||
      (html.includes("og:title") && html.toLowerCase().includes(usernameLower));

    if (hasProfileData) {
      return { status: STATUS.ACCESSIBLE, checkedAt, detail: "Profile data found — account is accessible." };
    }

    // AMBIGUOUS: Don't assume banned — return ERROR so the bot retries next cycle
    // This was the original bug: the old code returned BANNED here
    return { status: STATUS.ERROR, checkedAt, detail: "Ambiguous response — will retry next cycle." };

  } catch (err) {
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return { status: STATUS.ERROR, checkedAt, detail: "Request timed out — will retry." };
    }
    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      return { status: STATUS.ERROR, checkedAt, detail: `Connection failed: ${err.message}` };
    }
    return { status: STATUS.ERROR, checkedAt, detail: err.message };
  }
}

module.exports = { checkAccount, STATUS, jitter };
