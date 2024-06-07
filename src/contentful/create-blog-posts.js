const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  POST_DIR_TRANSFORMED,
  POST_DIR_CREATED,
  BLOG_LAYOUT_ID,
  CTA_BOTTOM_ID,
  ARTICLE_PAGE,
  findByGlob,
  delay,
} = require("../util");

// Do not exceed ten, delay is an important factor too
// 8 processes and 1s delay seem to make sense, for 10p/s
const PROCESSES = 8;
// add delays to try and avoid API request limits in
// the parallel processes
const UPLOAD_TIMEOUT = 60000;

const DONE_FILE_PATH = path.join(POST_DIR_CREATED, "done.json");
const FAILED_FILE_PATH = path.join(POST_DIR_CREATED, "failed.json");

const createBlogPosts = (posts, client, observer) => {
  return new Promise((complete) => {
    const queue = [].concat(posts).sort((a, b) => b - a);
    const processing = new Set();
    const done = [];
    const skipped = [];
    const failed = [];

    observer.next(`Preparing to create ${queue.length} posts`);

    const logProgress = () => {
      observer.next(
        `Remaining: ${queue.length} (${processing.size} uploading, ${
          done.length
        } done, ${failed.length} failed), skipped: ${skipped.length}`
      );
    };

    const createBlogPost = (post) => {
      const identifier = post.slug;
      processing.add(identifier);
      logProgress();

      return Promise.race([
        new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT * 5)),
        new Promise(async (resolve, reject) => {
          try {
            await delay();
            const exists = await client.getEntries({
              content_type: ARTICLE_PAGE,
              "fields.slug[match]": post.slug,
            });
            await delay();
            let cfEntry = { fields: {} };
            let cfData = {};
            let result;

            if (exists.total > 0) {
              cfEntry = exists.items[0];
              cfEntry.fields = cfData.fields;
            }
            cfData = handleContentfulBlogEntry(post, cfEntry);
            if (exists.total > 0 && Object.hasOwn(cfEntry, "update")) {
              result = await cfEntry.update();
              await delay();
            } else {
              const created = await client.createEntry(ARTICLE_PAGE, cfData);
              await delay();
              result = await created.publish();
              await delay();
            }
            resolve(result);
          } catch (error) {
            const message = `Error with post ${identifier}. ${error}`;
            // observer.error(message);
            reject(message);
          }
        }),
      ])
        .then((published) => {
          if (published.skipped) return skipped.push(post);
          return done.push(post);
        })
        .catch((error) => {
          failed.push({ post, error });
        })
        .finally(() => {
          processing.delete(identifier);
          logProgress();
          // more in queue case
          if (queue.length) {
            const post = queue.pop();
            createBlogPost(post);
          }
          // no more in queue, but at lesat one parallel
          // process is in progress
          else if (processing.size) return;
          else complete({ done, failed, skipped });
        });
    };
    // safely handle cases where there are less total
    // items than the amount of parallel processes
    let count = 0;
    while (queue.length && count < PROCESSES) {
      const post = queue.pop();
      createBlogPost(post);
      count += 1;
    }
  });
};
function handleContentfulBlogEntry(post, entry = { fields: {} }) {
  try {
    if (post.title) {
      entry.fields.title = {
        [CONTENTFUL_LOCALE]: post.title,
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }
  try {
    if (post.slug) {
      entry.fields.slug = {
        [CONTENTFUL_LOCALE]: post.slug.includes("/blog/")
          ? post.slug
          : `/blog/${post.slug}`,
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }
  try {
    if (post.contentful.content) {
      entry.fields.content = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.content.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (!entry.fields.modules) {
      entry.fields.modules = {
        [CONTENTFUL_LOCALE]: [
          {
            sys: {
              type: "Link",
              linkType: "Entry",
              id: post.contentful.content.sys.id,
            },
          },
        ],
      };
    } else {
      entry.fields.modules[CONTENTFUL_LOCALE].push({
        sys: {
          type: "Link",
          linkType: "Entry",
          id: post.contentful.content.sys.id,
        },
      });
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (post.contentful.publishDate) {
      entry.fields.publishDate = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.publishDate.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (post.contentful.mainTitle) {
      entry.fields.mainTitle = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.mainTitle.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (post.contentful.summary) {
      entry.fields.summary = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.summary.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }
  try {
    if (post.contentful.titleImage) {
      entry.fields.bannerImage = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.titleImage.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }
  try {
    if (post.contentful.author) {
      entry.fields.author = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.author.contentful.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (post.contentful.breadcrumbs) {
      entry.fields.breadcrumbs = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.breadcrumbs.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }
  try {
    if (post.contentful.relatedTopics) {
      entry.fields.relatedTopics = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.relatedTopics.sys.id,
          },
        },
      };
      entry.fields.relatedTopicsBottom = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: post.contentful.relatedTopics.sys.id,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (!entry.fields.ctaBottom) {
      entry.fields.ctaBottom = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: CTA_BOTTOM_ID,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  try {
    if (!entry.fields.layout) {
      entry.fields.layout = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: BLOG_LAYOUT_ID,
          },
        },
      };
    }
  } catch (error) {
    const message = `Error in handleContentfulBlogEntry: ${error}`;
    // observer.error(message);
    throw message;
  }

  return entry;
}

async function processBlogPosts(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const queue = [...files].sort((a, b) => b - a);
  const posts = [];
  while (queue.length) {
    const file = queue.pop();
    const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
    posts.push(post);
  }
  const { done, failed, skipped } = await createBlogPosts(
    posts,
    client,
    observer
  );

  await fs.ensureDir(POST_DIR_CREATED);
  await fs.writeJson(DONE_FILE_PATH, { done, skipped }, { spaces: 2 });
  await fs.writeJson(FAILED_FILE_PATH, { failed }, { spaces: 2 });
}

module.exports = (client) =>
  new Observable((observer) =>
    processBlogPosts(client, observer).then(() => observer.complete())
  );

// debug
// (async () => {
//   const client = await require("./create-client")();
//   processBlogPosts(client).then(console.log);
// })();
