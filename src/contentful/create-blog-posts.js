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

const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");
const AUTHOR_FILE_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const RESULTS_PATH = path.join(POST_DIR_CREATED, "posts.json");

const CONTENT_TYPE = "articlePage";
const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

const createBlogPosts = (posts, client, observer) => {
  return new Promise((complete) => {
    const queue = [].concat(posts).sort((a, b) => b - a);
    const processing = new Set();
    const done = [];
    const failed = [];

    observer.next(`Preparing to create ${queue.length} posts`);

    const logProgress = () => {
      observer.next(
        `Remaining: ${queue.length} (${processing.size} uploading, ${
          done.length
        } done, ${failed.length} failed)`
      );
    };

    const createBlogPost = (post) => {
      const identifier = post.slug;
      processing.add(identifier);
      logProgress();

      return (
        Promise.race([
          new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
          new Promise(async (resolve, reject) => {
            await delay();

            const exists = await client.getEntries({
              content_type: CONTENT_TYPE,
              "fields.slug[in]": post.slug,
            });
            if (exists && exists.total > 0) {
              return reject({ error: "Post already exists", post: exists });
            }
            await delay();
            const references = createPostReferences(post);
            await delay();
            const created = await client.createEntry(
              CONTENT_TYPE,
              transform(post, references)
            );
            await delay();
            const published = await created.publish();
            await delay();
            resolve(published);
          }),
        ])

          // happy path
          .then((_published) => {
            done.push(post);
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
            else complete({ done, failed });
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

async function transform(
  post,
  { mainTitle, publishDate, content, summary, titleImage: bannerImage, author }
) {
  const createdReferences = [
    mainTitle,
    publishDate,
    content,
    summary,
    bannerImage,
    author,
  ];
  const fields = {
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
          id: RELATED_TOPICS[Math.floor(Math.random() * RELATED_TOPICS.length)],
        },
      },
    },
    relatedTopicsBottom: {
      [CONTENTFUL_LOCALE]: {
        sys: {
          type: "Link",
          linkType: "Entry",
          id: RELATED_TOPICS[Math.floor(Math.random() * RELATED_TOPICS.length)],
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
  };

  createdReferences.forEach((ref) => {
    if (ref) {
      fields[ref] = {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: [ref]?.sys?.id,
          },
        },
      };
    }
  });
  return fields;
}

async function processBlogPosts(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const queue = [...files].sort((a,b) => b - a);
  const posts = [];
  while (queue.length) {
    const file = queue.pop();
    const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
    posts.push(post);
  }

  const assets = await fs.readJson(DONE_FILE_PATH);
  const authors = await fs.readJson(AUTHOR_FILE_PATH);

  const result = await createBlogPosts(posts, client, observer);

  await fs.ensureDir(POST_DIR_CREATED);
  await fs.writeJson(RESULTS_PATH, result, { spaces: 2 });
  return result;
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
