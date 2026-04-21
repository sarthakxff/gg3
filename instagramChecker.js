/**
 * instagramChecker.js
 * Checks Instagram account status via RapidAPI scraper.
 * Railway datacenter IPs are blocked by Instagram directly,
 * so we MUST use RapidAPI as a proxy to get reliable results.
 */

const axios = require("axios");

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "instagram-scraper-api2.p.rapidapi.com";

if (!RAPIDAPI_KEY) {
  console.error("❌  Missing env var: RAPIDAPI_KEY — Instagram checks will always fail.");
}

function jitter(baseMs) {
  return baseMs + Math.floor(Math.random() * 5000);
}

const STATUS = {
  BANNED:       "BANNED",
  ACCESSIBLE:   "ACCESSIBLE",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND:    "NOT_FOUND",
  ERROR:        "ERROR",
};

/**
 * Check an Instagram username via RapidAPI.
 * Returns { status, checkedAt, detail, data? }
 */
async function checkAccount(username) {
  const checkedAt = new Date();

  if (!RAPIDAPI_KEY) {
    return { status: STATUS.ERROR, checkedAt, detail: "RAPIDAPI_KEY not set." };
  }

  try {
    const response = await axios.get(
      `https://${RAPIDAPI_HOST}/v1/info`,
      {
        params:  { username_or_id_or_url: username },
        timeout: 15000,
        headers: {
          "x-rapidapi-key":  RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
        validateStatus: () => true,
      }
    );

    const { status: httpStatus, data } = response;

    // ── RapidAPI rate limit ──────────────────────────────────────────────
    if (httpStatus === 429) {
      return { status: STATUS.RATE_LIMITED, checkedAt, detail: "RapidAPI rate limit hit (429). Backing off." };
    }

    // ── RapidAPI key invalid / quota exceeded ────────────────────────────
    if (httpStatus === 403 || httpStatus === 401) {
      return { status: STATUS.ERROR, checkedAt, detail: `RapidAPI auth error (${httpStatus}) — check RAPIDAPI_KEY.` };
    }

    // ── Account not found (banned / deleted / never existed) ─────────────
    if (httpStatus === 404) {
      return { status: STATUS.NOT_FOUND, checkedAt, detail: "Account not found (404) — banned, deleted, or never existed." };
    }

    // ── Other HTTP errors ────────────────────────────────────────────────
    if (httpStatus !== 200) {
      return { status: STATUS.ERROR, checkedAt, detail: `Unexpected HTTP ${httpStatus} from RapidAPI.` };
    }

    // ── Parse the response body ──────────────────────────────────────────
    const user = data?.data;

    if (!user) {
      // RapidAPI returned 200 but no user data — treat as not found
      const msg = data?.message || data?.detail || JSON.stringify(data).slice(0, 100);
      if (
        typeof msg === "string" &&
        (msg.toLowerCase().includes("not found") ||
         msg.toLowerCase().includes("doesn't exist") ||
         msg.toLowerCase().includes("no user"))
      ) {
        return { status: STATUS.NOT_FOUND, checkedAt, detail: "Account not found — banned or deleted." };
      }
      return { status: STATUS.ERROR, checkedAt, detail: `Empty user data: ${msg}` };
    }

    // ── Account is private/suspended? ───────────────────────────────────
    // is_private doesn't mean banned. is_blocked_by_viewer can mean suspended.
    if (user.is_blocked_by_viewer || user.has_blocked_viewer) {
      return { status: STATUS.BANNED, checkedAt, detail: "Account appears suspended/blocked.", data: user };
    }

    // ── We have a real user object — account is accessible ───────────────
    const followers = user.follower_count ?? user.edge_followed_by?.count ?? "?";
    const fullName  = user.full_name || username;
    return {
      status:   STATUS.ACCESSIBLE,
      checkedAt,
      detail:   `Profile found — ${fullName} (@${user.username}) | Followers: ${followers}`,
      data:     user,
    };

  } catch (err) {
    if (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT") {
      return { status: STATUS.ERROR, checkedAt, detail: "Request timed out — will retry." };
    }
    return { status: STATUS.ERROR, checkedAt, detail: `Network error: ${err.message}` };
  }
}

module.exports = { checkAccount, STATUS, jitter };
