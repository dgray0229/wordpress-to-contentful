const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  POST_DIR_TRANSFORMED,
  POST_DIR_CREATED,
  USER_DIR_TRANSFORMED,
  CONTENTFUL_FALLBACK_USER_ID,
  BLOG_LAYOUT,
  RELATED_TOPICS,
  CTA_BOTTOM,
  ASSET_DIR_LIST,
  findByGlob,
} = require("../util");

// Do not exceed ten, delay is an important factor too
// 8 processes and 1s delay seem to make sense, for 10p/s
const PROCESSES = 8;
// add delays to try and avoid API request limits in
// the parallel processes
const API_DELAY_DUR = 1000;
const UPLOAD_TIMEOUT = 60000;

const DONE_FILE_PATH = path.join(POST_DIR_CREATED, "done.json");
const FAILED_FILE_PATH = path.join(POST_DIR_CREATED, "failed.json");
const SKIPPED_FILE_PATH = path.join(POST_DIR_CREATED, "skipped.json");

const CONTENT_TYPE = "articlePage";
const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

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

      return (
        Promise.race([
          new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
          new Promise(async (resolve, _reject) => {
            await delay();

            const exists = await client.getEntries({
              content_type: CONTENT_TYPE,
              "fields.slug[in]": post.slug,
            });
            if (exists && exists.total > 0) {
              return resolve({ skipped: true, post: exists });
            }
            await delay();
            const referenceFields = transform(post);

            const created = await client.createEntry(
              CONTENT_TYPE,
              referenceFields
            );
            await delay();
            const published = await created.publish();
            await delay();
            resolve(published);
          }),
        ])

          // happy path
          .then((published) => {
            if (published.skipped) return skipped.push(post);
            return done.push(post);
          })
          // badness
          .catch((error) => {
            // TODO: retry failed
            failed.push({ post, error });
          })
          // either
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
          })
      );
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

function transform(post) {
  const postFields = {
    fields: {
      title: {
        [CONTENTFUL_LOCALE]: post.title,
      },
      slug: {
        [CONTENTFUL_LOCALE]: post.slug,
      },
      layout: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: BLOG_LAYOUT,
          },
        },
      },
      relatedTopics: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id:
              RELATED_TOPICS[Math.floor(Math.random() * RELATED_TOPICS.length)],
          },
        },
      },
      relatedTopicsBottom: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id:
              RELATED_TOPICS[Math.floor(Math.random() * RELATED_TOPICS.length)],
          },
        },
      },
      ctaBottom: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: CTA_BOTTOM,
          },
        },
      },
    },
  };

  for (const property in post.contentful) {
    const value = post.contentful[property];
    const entryID = post.contentful[property]?.sys?.id;
    if (value && entryID) {
      postFields.fields[property] = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: entryID,
          },
        },
      };
    }
  }
  return postFields;
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

  const {done, failed, skipped} = await createBlogPosts(posts, client, observer);

  await fs.ensureDir(POST_DIR_CREATED);
  await fs.writeJson(DONE_FILE_PATH, done, { spaces: 2 });
  await fs.writeJson(FAILED_FILE_PATH, failed, { spaces: 2 });
  await fs.writeJson(SKIPPED_FILE_PATH, skipped, { spaces: 2 });
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
