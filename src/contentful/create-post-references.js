const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  POST_DIR_TRANSFORMED,
  USER_DIR_TRANSFORMED,
  CATEGORY_DIR_TRANSFORMED,
  ASSET_DIR_LIST,
  findByGlob,
} = require("../util");
const { create } = require("domain");
const { get } = require("http");

// Do not exceed ten, delay is an important factor too
// 8 processes and 1s delay seem to make sense, for 10p/s
const PROCESSES = 8;
// add delays to try and avoid API request limits in
// the parallel processes
const API_DELAY_DUR = 1000;
const UPLOAD_TIMEOUT = 60000;

const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");

const AUTHOR_FILE_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const BLOG_PAGE_ENTRY_ID = "2iyZIcmdojox2kdPIRKAnO";
const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

function createMapsFromAssets(assets) {
  const links = new Map();
  const heros = new Map();
  assets.forEach((asset) =>
    links.set(asset.wordpress.link, asset.contentful.url)
  );
  assets.forEach((asset) => {
    if (asset.wordpress.mediaNumber)
      heros.set(asset.wordpress.mediaNumber, asset.contentful.id);
  });
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
  topics,
  failed,
  client,
  observer
) => {
  const assets = await fs.readJson(DONE_FILE_PATH);

  const [inlineMap, heroMap] = createMapsFromAssets(assets);

  const getBreadcrumbMetaInfo = (post) => {
    const { schema } = post.yoast_head_json;
    let breadcrumbMetaInfo = null;
    for (const item of schema["@graph"]) {
      if (item["@type"] === "BreadcrumbList") {
        breadcrumbMetaInfo = item.itemListElement;
        break;
      }
    }
    /*
      Because of how our breadcrumbs are structured, we can assume that there are always 3 levels of breadcrumbs for blog posts
      * the first item is the homepage
      * the second item is the category
      * the third item is the post title
      * 
    */
    return breadcrumbMetaInfo;
  };

  const createRichTextEntry = (post, client) => {
    try {
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
    } catch (error) {
      throw Error(`Rich Text Entry not created for ${post.slug}`);
    }
  };
  const createPublishDateEntry = (post, client) => {
    try {
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
    } catch (error) {
      throw Error(`Publish Date Entry not created for ${post.slug}`);
    }
  };
  const createMainTitleEntry = (post, client) => {
    try {
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
    } catch (error) {
      throw Error(`Main Title Entry not created for ${post.slug}`);
    }
  };
  const createSummaryEntry = (post, client) => {
    try {
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
    } catch (error) {
      throw Error(`Summary Entry not created for ${post.slug}`);
    }
  };
  const createTitleImageEntry = (post, client) => {
    try {
      const featuredImageExists = heroMap.has(post.featured_media);
      console.log("featuredImageExists", featuredImageExists);
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
    } catch (error) {
      throw Error(`Title Image Entry not created for ${post.slug}`);
    }
  };
  const createAuthorReference = (post, authors) => {
    try {
      const author = authors.find((author) => author.id === post.author);
      if (!author?.contentful?.sys?.id) return author.contentful;
    } catch (error) {
      throw Error(`Author not found in Contentful for ${post.slug}: ${error}`);
    }
  };
  async function createTopicEntry(post, client, observer, topics = []) {
    const found = topics.find(({ wordpress: { id } }) => id === post.category);
    try {
      return await client.createEntry("topicPage", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `${found.wordpress.name}`,
          },
          description: {
            [CONTENTFUL_LOCALE]: found.wordpress.description,
          },
          slug: {
            [CONTENTFUL_LOCALE]: `/blog/topic/${post.slug}`,
          },
          relatedTopics: {
            [CONTENTFUL_LOCALE]: {
              sys: {
                type: "Link",
                linkType: "Entry",
                id: found.contentful.id,
              },
            },
          },
        },
      });
    } catch (error) {
      observer.error(
        `Related Topic Entry not created for ${post.slug}: ${error}`
      );
      throw Error(
        `Related Topic Entry not created for ${topic.slug}: ${error}`
      );
    }
  }

  const handleTopicPageEntry = async (post, client, observer, topics = []) => {
    let topicPage = null;
    const foundCategory = topics.find(
      ({ wordpress: { id } }) => id === post.category
    );
    const result = await client.getEntries({
      content_type: "topicPage",
      "fields.title[match]": foundCategory.wordpress.name,
    });
    if (result.items.length) {
      topicPage = result.items.pop();
    } else {
      topicPage = await createTopicEntry(post, client, observer, topics);
    }
    return topicPage;
  };

  const createBreadcrumbsEntry = async (post, client, breadcrumbsList = []) => {
    try {
      const [_home, category, _title] = breadcrumbsList;
      const topicPageExactMatch = async () => {
        const result = await client.getEntries({
          content_type: "topicPage",
          "fields.title[match]": category.name,
        });
        if (result.items.length) return result.items.pop();
      };
      const topicPageContainsMatch = async () => {
        const result = await client.getEntries({
          content_type: "topicPage",
          "fields.title[contains]": category.name,
        });
        if (result.items.length) return result.items.pop();
      };

      const getTopicPage = async () => {
        const exactMatch = await topicPageExactMatch();
        if (exactMatch) return exactMatch;
        await delay();
        const containsMatch = await topicPageContainsMatch();
        if (containsMatch) return containsMatch;
      };

      const topicPage = await getTopicPage();
      await delay();

      return client.createEntry("breadcrumbs", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `BC: ${breadcrumbsList
              .map(({ name }) => name)
              .join(" - ")}`,
          },
          titleOverride: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          modules: {
            [CONTENTFUL_LOCALE]: [
              {
                sys: {
                  type: "Link",
                  linkType: "Entry",
                  id: BLOG_PAGE_ENTRY_ID,
                },
              },
              {
                sys: {
                  type: "Link",
                  linkType: "Entry",
                  id: topicPage.sys.id,
                },
              },
            ],
          },
        },
      });
    } catch (error) {
      throw Error(
        `BreadCrumbs Entry not created for ${
          post.slug
        }. Topic Page value: ${topicPage}: Error: ${error}`
      );
    }
  };

  const handleBreadcrumbEntry = (post, client, breadcrumbsList = []) => {
    try {
      const breadcrumbMetaInfo = getBreadcrumbMetaInfo(post);
      // const breadcrumbExists = client.getInfo("breadcrumbs", { id: `bc-${post.title}` } )
      // if (breadcrumbExists) return breadcrumbExists;

      const breadcrumbs = createBreadcrumbsEntry(
        post,
        client,
        breadcrumbMetaInfo
      );
      return breadcrumbs;
    } catch (error) {
      throw Error(`Breadcrumbs Entry not created for ${post.slug}: ${error}`);
    }
  };
  const createPostReference = (
    post,
    authors,
    topics,
    failed,
    client,
    observer
  ) => {
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
        const topicsPage = await handleTopicPageEntry(
          post,
          client,
          observer,
          topics
        );
        await delay();
        const breadcrumbs = await handleBreadcrumbEntry(post, client);
        await delay();
        references.push(
          content,
          publishDate,
          mainTitle,
          summary,
          titleImage,
          author,
          breadcrumbs
        );
        resolve({
          content,
          publishDate,
          mainTitle,
          summary,
          titleImage,
          author,
          breadcrumbs,
        });
      } catch (error) {
        failed.push(...references.filter((entry) => !entry));
        const errorMessage = `${error}. References that have errors for ${
          post.slug
        }`;
        reject(errorMessage);
      }
    });
  };
  const result = createPostReference(
    post,
    authors,
    topics,
    failed,
    client,
    observer
  );
  return result;
};

async function getPostTopics() {
  const categoryFile = path.join(CATEGORY_DIR_TRANSFORMED, "topics.json");
  return await fs.readJson(categoryFile);
}
async function processBlogReferences(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const authors = await fs.readJson(AUTHOR_FILE_PATH);
  const topics = await getPostTopics();
  const queue = [...files].sort((a, b) => b - a);
  const failed = [];
  const total = queue.length;
  const logProgress = () => {
    const done = total - queue.length - failed.length;
    observer.next(
      `Remaining: ${queue.length} out of ${total}. ${done} done. (${
        failed.length
      } failed.)`
    );
  };
  try {
    while (queue.length) {
      logProgress();
      const file = queue.pop();
      const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
      const result = await createPostReferences(
        post,
        authors,
        topics,
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
