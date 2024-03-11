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

const CONTENT_TYPE = "articlePage";
const BLOG_LAYOUT = "2ny5cu75sVPNSFxcrqSBKu"; // test_blog_layout
const RELATED_TOPICS = [
  "eXXr1kU06jNXb6bnEDFWL", // Related: Organize Your Way to Tax Day: 5 Steps for Success
  "2cVdJMe0UNnGj0w639HoKz", // Related: Top 7 Reasons to Switch to TaxAct
  "23UVJl5HPZgo3OyV4qjGLc", // Related: Family Loans: Does the IRS Care If I Lend My Kids Money?
  "5KeLjofZT76V9Qco1EztKn", // Related Topics - Topic Page Tax Planning
  "2quMbyVQuqwmtOy7SXvD2k", // Related: When Does Capital Gains Tax Apply?
  "tHMoJ0s4kAFtiRfSPlDmx", // Related: Know More About Tax Deductions and Credits
];
const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");
const AUTHOR_FILE_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const RESULTS_PATH = path.join(POST_DIR_CREATED, "posts.json");

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

const createBlogPosts = (posts, assets, authors, client, observer) => {
  const [inlineMap, heroMap] = createMapsFromAssets(assets);
  const authorMap = createMapFromAuthors(authors);

  return new Promise((complete) => {
    const queue = [].concat(posts);
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
    const createPostReferences = (post) => {
      return Promise.race([
        new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
        new Promise(async (resolve, reject) => {
          try {
            const richText = await createRichTextEntry(post);
            const publishDate = await createPublishDateEntry(post);
            const mainTitle = await createMainTitleEntry(post);
            const summary = await createSummaryEntry(post);

            if (!richText || !publishDate || !mainTitle) {
              reject(new Error("One or more entries were not created"));
              return;
            }

            observer.next("References created for", post.slug);
            observer.next(
              `Rich Text: ${richText.sys.id} Publish Date: ${
                publishDate.sys.id
              } Main Title: ${mainTitle.sys.id}`
            );
            resolve({ richText, publishDate, mainTitle, summary });
          } catch (error) {
            reject(error);
          }
        }),
      ]);
    };
    const createRichTextEntry = (post) => {
      return client.createEntry("richTextMarkdown", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          text: {
            [CONTENTFUL_LOCALE]: replaceInlineImageUrls(post.body, inlineMap),
          },
        },
      });
    };
    const createPublishDateEntry = (post) => {
      return client.createEntry("publishDate", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          articlePublishDate: {
            [CONTENTFUL_LOCALE]: post.publishDate,
          },
        },
      });
    };
    const createMainTitleEntry = (post) => {
      return client.createEntry("mainTitle", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `Title: ${post.title}`,
          },
          id: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          text: {
            [CONTENTFUL_LOCALE]: post.title,
          },
        },
      });
    };
    const createSummaryEntry = (post) => {
      return client.createEntry("summary", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `Summary: ${post.title}`,
          },
          id: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          text: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          description: {
            [CONTENTFUL_LOCALE]: post.description,
          },
        },
      });
    };
    const createBlogPost = (post, references) => {
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

            const created = await client.createEntry(
              CONTENT_TYPE,
              transform(post, heroMap, authorMap, references)
            );
            await delay();
            const published = await created.publish();
            await delay();
            resolve(published);
          }),
        ])

          // happy path
          .then((published) => {
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
              const post = queue.shift();
              const references = createPostReferences(post);
              createBlogPost(post, references);
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
      const post = queue.shift();
      const references = createPostReferences(post);
      createBlogPost(post, references);
      count += 1;
    }
  });
};

async function transform(
  post,
  heroMap,
  authorMap,
  { mainTitle, publishDate, richText, summary }
) {
  return {
    fields: {
      title: {
        [CONTENTFUL_LOCALE]: post.title,
      },
      slug: {
        [CONTENTFUL_LOCALE]: post.slug,
      },
      publishDate: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: publishDate,
          },
        },
      },
      mainTitle: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: mainTitle,
          },
        },
      },
      content: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: richText, // You need to provide the content ID
          },
        },
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
      bannerImage: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: heroMap.get(post.featured_media),
          },
        },
      },
      author: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: authorMap.has(post.author)
              ? authorMap.get(post.author)
              : CONTENTFUL_FALLBACK_USER_ID,
          },
        },
      },
      summary: {
        [CONTENTFUL_LOCALE]: {
          sys: {
            type: "Link",
            linkType: "Entry",
            id: summary,
          },
        },
      },
      relatedTopics: [
        {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Entry",
              id: "TaxAct",
            },
          },
        },
      ],
      relatedTopicsBottom: [
        {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Entry",
              id: "TaxAct",
            },
          },
        },
      ],
      ctaBottom: [
        {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Entry",
              id: "Start Your Return",
            },
          },
        },
      ],
    },
  };
}

function replaceInlineImageUrls(text, map) {
  let replacedText = text;
  map.forEach((newUrl, oldUrl) => {
    replacedText = replacedText.replace(oldUrl, newUrl);
  });
  return replacedText;
}

function createMapsFromAssets(assets) {
  const links = new Map();
  const heros = new Map();
  assets.forEach((asset) =>
    links.set(asset.wordpress.link, asset.contentful.url)
  );
  assets.forEach(
    (asset) =>
      asset.wordpress.mediaNumber &&
      heros.set(asset.wordpress.mediaNumber, asset.contentful.id)
  );
  return [links, heros];
}

function createMapFromAuthors(authors) {
  const map = new Map();
  authors.forEach((author) => {
    if (author.contentful) map.set(author.wordpress.id, author.contentful.id);
  });
  return map;
}

async function processBlogPosts(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const queue = [...files].sort();
  const posts = [];
  while (queue.length) {
    const file = queue.shift();
    const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
    posts.push(post);
  }

  const assets = await fs.readJson(DONE_FILE_PATH);
  const authors = await fs.readJson(AUTHOR_FILE_PATH);

  const result = await createBlogPosts(
    posts,
    assets,
    authors,
    client,
    observer
  );

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
