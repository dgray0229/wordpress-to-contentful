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
const ASSETS_FILE_PATH = path.join(ASSET_DIR_LIST, "assets.json");

const AUTHOR_FILE_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const RESULTS_PATH = path.join(POST_DIR_CREATED, "posts.json");

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

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

function replaceInlineImageUrls(text, map) {
  let replacedText = text;
  map.forEach((newUrl, oldUrl) => {
    replacedText = replacedText.replace(oldUrl, newUrl);
  });
  return replacedText;
}

const createPostReferences = async (
  post,
  authors,
  failed,
  client,
  observer
) => {
  observer.next(`Preparing to create posts`);
  const assets = await fs.readJson(DONE_FILE_PATH);

  const [inlineMap, heroMap] = createMapsFromAssets(assets);

  const createRichTextEntry = (post, client) => {
    return client.createEntry("richTextMarkdown", {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: `Content: ${post.title}`,
        },
        text: {
          [CONTENTFUL_LOCALE]: replaceInlineImageUrls(post.body, inlineMap),
        },
      },
    });
  };
  const createPublishDateEntry = (post, client) => {
    return client.createEntry("publishDate", {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: `Published Date: ${post.title}`,
        },
        articlePublishDate: {
          [CONTENTFUL_LOCALE]: post.publishDate,
        },
      },
    });
  };
  const createMainTitleEntry = (post, client) => {
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
  const createSummaryEntry = (post, client) => {
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
          [CONTENTFUL_LOCALE]: post.yoast_head_json.description,
        },
      },
    });
  };
  const createTitleImageEntry = (post, client) => {
    const featuredImageExists = heroMap.has(post.featured_media);
    if (featuredImageExists) {
      return client.createEntry("titleImage", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `Image: ${post.title}`,
          },
          assets: {
            [CONTENTFUL_LOCALE]: {
              sys: {
                type: "Link",
                linkType: "Entry",
                id: heroMap.get(post.featured_media),
              },
            },
          },
        },
      });
    }
    throw Error(`Title Image not defined.`);
  };
  const createAuthorReference = (post, authors) => {
    const author = authors.find((author) => author.id === post.author);

    if (!author?.contentful?.sys?.id)
      throw Error(`Author not found in Contentful for ${post.slug}`);
    else return author.contentful;
  };

  const createPostReference = (post, authors, failed, client, observer) => {
    const references = [];
    return new Promise(async (resolve, reject) => {
      try {
        const content = await createRichTextEntry(post, client);
        await delay();
        const publishDate = await createPublishDateEntry(post, client);
        await delay();
        const mainTitle = await createMainTitleEntry(post, client);
        await delay();
        const summary = await createSummaryEntry(post, client);
        await delay();
        const titleImage = await createTitleImageEntry(post, client);
        await delay();
        const author = await createAuthorReference(post, authors);
        await delay();
        references.push(
          content,
          publishDate,
          mainTitle,
          summary,
          titleImage,
          author
        );
        resolve({
          content,
          publishDate,
          mainTitle,
          summary,
          titleImage,
          author,
        });
      } catch (error) {
        failed.push(...references.filter((entry) => !entry));
        const errorMessage = `${error}. References that have errors for ${
          post.slug
        }: ${failed.forEach((entry) => entry)}`;
        observer.error(errorMessage);
        reject(errorMessage);
      }
    });
  };
  const result = createPostReference(post, authors, failed, client, observer);
  return result;
};

async function processBlogReferences(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const authors = await fs.readJson(AUTHOR_FILE_PATH);
  const queue = [...files].sort((a,b) => b - a);
  const failed = [];
  const logProgress = () => {
    observer.next(`Remaining: ${queue.length} (${failed.length} failed)`);
  };
  try {
    while (queue.length) {
      logProgress();
      const file = queue.pop();
      const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
      const result = await createPostReferences(
        post,
        authors,
        failed,
        client,
        observer
      );

      await fs.ensureDir(POST_DIR_TRANSFORMED);
      await fs.writeJson(
        path.join(POST_DIR_TRANSFORMED, file),
        { ...post, contentful: result },
        { spaces: 2 }
      );
    }
  } catch (error) {
    observer.error(error);
  }
}

module.exports = (client) =>
  new Observable((observer) =>
    processBlogReferences(client, observer).then(() => observer.complete())
  );
