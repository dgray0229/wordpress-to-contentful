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
  CONTENTFUL_FALLBACK_USER_ID,
  CONTENTFUL_USER_ID,
  BLOG_PAGE_ENTRY_ID,
  CTA_BOTTOM_ID,
  BLOG_LAYOUT_ID,
  TOPIC_LAYOUT_ID,
} = process.env;
const UPLOAD_TIMEOUT = 60000; // 60s
const ARTICLE_PAGE = "articlePage";
const AUTHOR = "author";
const RELATED_TOPICS = "relatedTopics";
const RICH_TEXT_MARKDOWN = "richTextMarkdown";
const PUBLISH_DATE = "publishDate";
const MAIN_TITLE = "mainTitle";
const SUMMARY = "summary";
const TITLE_IMAGE = "titleImage";
const BREADCRUMBS = "breadcrumbs";

// Referencing contentful api entries that are used in the process
// Create Blog Post
const CONTENT_TYPE = "articlePage"; // ID where posts will be added
// pre-existing entries that are required by the content type but
const API_DELAY_DUR = 1000;

// Awaitable globs
const findByGlob = (pattern = "", opts = {}) =>
  new Promise((resolve, reject) => {
    glob(pattern, opts, (err, files) => (err ? reject(err) : resolve(files)));
  });

const MIME_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

const urlToMimeType = (url) => {
  const type = url
    .split(".")
    .slice(-1)
    .join("");
  return MIME_TYPES[type] ? MIME_TYPES[type] : MIME_TYPES["jpg"];
};

const trimUrlToFilename = (url) =>
  url
    .split("/")
    .slice(-1)
    .join("");

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

const deleteExistingContentTypes = async (
  client,
  observer = MOCK_OBSERVER,
  content_type = CONTENT_TYPE,
  user_id = CONTENTFUL_USER_ID
) => {
  let count = 0;
  let total = Infinity;
  let skip = 0;
  const blogEntries = [];
  observer.next(`Fetching existing ${content_type} entries.`);
  try {
    while (skip < total) {
      await delay();
      const response = await client.getEntries({
        content_type,
        skip: skip,
        limit: 1000,
      });
      await delay();
      total = response.total;
      skip += response.items.length;
      blogEntries.push(...response.items);
    }
  } catch (error) {
    const message = `Error in getting existing ${content_type}: ${error}`;
    observer.error(message);
    throw message;
  }
  try {
    await delay();
    for (const entry of blogEntries) {
      observer.next(
        `Resetting ${content_type}. Processing ${count} of ${total} entries.`
      );
      ++count;
      // Remove this line to delete all entries regardless of a filter
      if (!entry.sys.createdBy.sys.id === user_id) continue;

      if (!entry.sys.publishedVersion) {
        await entry.delete();
        await delay();
      } else {
        const unpublished = await entry.unpublish();
        await delay();
        await unpublished.delete();
        await delay();
      }
    }
  } catch (error) {
    const message = `Error in deleting ${content_type}: ${error}`;
    observer.error(message);
    throw message;
  }
};

const getExistingContentType = async (
  client,
  observer = MOCK_OBSERVER,
  content_type = "",
  options = {},
  searchParam = "title"
) => {
  let count = 0;
  let total = Infinity;
  let skip = 0;
  observer.next(
    `Getting existing ${content_type}. Grabbing ${count} of ${total} entries.`
  );
  try {
    const results = new Map();
    while (skip < total) {
      await delay();
      const response = await client.getEntries({
        content_type,
        skip: skip,
        limit: 1000,
        ...options,
      });
      total = response.total;
      response.items.forEach((item, index) => {
        skip = index + 1;
        results.set(item.fields[searchParam][CONTENTFUL_LOCALE], item);
      });
    }
    return results;
  } catch (error) {
    const message = `Error in getting existing ${content_type}: ${error}`;
    observer.error(message);
    throw message;
  }
};

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
  CONTENTFUL_USER_ID,
  BLOG_PAGE_ENTRY_ID,
  CTA_BOTTOM_ID,
  BLOG_LAYOUT_ID,
  TOPIC_LAYOUT_ID,
  ARTICLE_PAGE,
  AUTHOR,
  RELATED_TOPICS,
  RICH_TEXT_MARKDOWN,
  PUBLISH_DATE,
  MAIN_TITLE,
  SUMMARY,
  TITLE_IMAGE,
  BREADCRUMBS,
  findByGlob,
  urlToMimeType,
  trimUrlToFilename,
  delay,
  deleteExistingContentTypes,
  getExistingContentType,
};
