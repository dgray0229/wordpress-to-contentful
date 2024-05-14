require("dotenv").config();

const path = require("path");
const glob = require("glob");

// when task is ran as singular node process and not as Listr task
const MOCK_OBSERVER = { next: console.log, complete: console.success };

// dirs references in various places
const BUILD_DIR = path.join(process.cwd(), "dist");
const POST_DIR_ORIGINALS = path.join(BUILD_DIR, "posts-original-by-page");
const POST_DIR_TRANSFORMED = path.join(BUILD_DIR, "posts-transformed");
const POST_DIR_CREATED = path.join(BUILD_DIR, "posts-created");
const USER_DIR_ORIGINALS = path.join(BUILD_DIR, "users-original");
const USER_DIR_TRANSFORMED = path.join(BUILD_DIR, "users-transformed");
const ASSET_DIR_LIST = path.join(BUILD_DIR, "list-of-assets");
const REDIRECTS_DIR = path.join(BUILD_DIR, "redirects");
const CATEGORY_DIR_ORIGINALS = path.join(BUILD_DIR, "categories-original");
const CATEGORY_DIR_TRANSFORMED = path.join(BUILD_DIR, "categories-transformed");
const LINKS_DIR_ORIGINALS = path.join(BUILD_DIR, "links-original");
const LINKS_DIR_TRANSFORMED = path.join(BUILD_DIR, "links-transformed");
const {
  REDIRECT_BASE_URL,
  WP_API_URL,
  CONTENTFUL_CMA_TOKEN,
  CONTENTFUL_SPACE_ID,
  CONTENTFUL_ENV_NAME,
  CONTENTFUL_LOCALE,
  CONTENTFUL_FALLBACK_USER_ID
} = process.env;

// Referencing contentful api entries that are used in the process
// Create Blog Post 
const CONTENT_TYPE = "articlePage"; // ID where posts will be added
// pre-existing entries that are required by the content type but
const BLOG_LAYOUT = "2ny5cu75sVPNSFxcrqSBKu"; // test_blog_layout
const RELATED_TOPICS = [
  "eXXr1kU06jNXb6bnEDFWL", // Related: Organize Your Way to Tax Day: 5 Steps for Success
  "2cVdJMe0UNnGj0w639HoKz", // Related: Top 7 Reasons to Switch to TaxAct
  "23UVJl5HPZgo3OyV4qjGLc", // Related: Family Loans: Does the IRS Care If I Lend My Kids Money?
  "5KeLjofZT76V9Qco1EztKn", // Related Topics - Topic Page Tax Planning
  "2quMbyVQuqwmtOy7SXvD2k", // Related: When Does Capital Gains Tax Apply?
  "tHMoJ0s4kAFtiRfSPlDmx", // Related: Know More About Tax Deductions and Credits
];
const CTA_BOTTOM = "2NWQl3OKWyJ6Zbc56AEdFJ"; // id: cta-bottom-articlePage; Title: Ready to get started on your taxes?


// Awaitable globs
const findByGlob = (pattern = "", opts = {}) =>
  new Promise((resolve, reject) => {
    glob(pattern, opts, (err, files) => (err ? reject(err) : resolve(files)));
  });

const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif"
};

const urlToMimeType = url => {
  const type = url
    .split(".")
    .slice(-1)
    .join("");
  return MIME_TYPES[type] ? MIME_TYPES[type] : MIME_TYPES["jpg"];
};

const trimUrlToFilename = url =>
  url
    .split("/")
    .slice(-1)
    .join("");

// exports 
module.exports = {
  MOCK_OBSERVER,
  BUILD_DIR,
  POST_DIR_ORIGINALS,
  POST_DIR_TRANSFORMED,
  POST_DIR_CREATED,
  USER_DIR_ORIGINALS,
  CATEGORY_DIR_ORIGINALS,
  CATEGORY_DIR_TRANSFORMED,
  LINKS_DIR_ORIGINALS,
  LINKS_DIR_TRANSFORMED,
  ASSET_DIR_LIST,
  REDIRECTS_DIR,
  REDIRECT_BASE_URL,
  WP_API_URL,
  CONTENTFUL_CMA_TOKEN,
  CONTENTFUL_SPACE_ID,
  CONTENTFUL_ENV_NAME,
  CONTENTFUL_LOCALE,
  CONTENTFUL_FALLBACK_USER_ID,
  USER_DIR_TRANSFORMED,
  CONTENT_TYPE,
  BLOG_LAYOUT,
  RELATED_TOPICS,
  CTA_BOTTOM,
  findByGlob,
  urlToMimeType,
  trimUrlToFilename
};
