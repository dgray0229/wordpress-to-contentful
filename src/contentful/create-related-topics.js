const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  POST_DIR_TRANSFORMED,
  POST_DIR_CREATED,
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

const CATEGORY_FILE_PATH = path.join('dist/categories-original', "categories.json");
const RESULTS_PATH = path.join(POST_DIR_CREATED, "posts.json");
const CATEGORY_CONTENT_TYPE = "topicPage";
const CATEGORY_REFERENCE_CONTENT_TYPE = "relatedTopics";
const LINK_TYPE = "link";
const BLOG_URL = "https://taxact.com/blog/category/";

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

async function getExistingLinks(client) {
  try {
    const links = new Map();
    let total = Infinity;
    let skip = 0;
    while (skip < total) {
      await delay();
      const response = await client.getEntries({
        content_type: CATEGORY_CONTENT_TYPE,
        skip: skip,
        limit: 1000,
      });
      total = response.total;
      response.items.forEach((link, index) => {
        skip = index + 1;
        links.set(link.fields.title[CONTENTFUL_LOCALE], link);
      });
    }
    return links;
  } catch (error) {
    throw `Error in getting existing links: ${error}`;
  }

}
  async function getExistingTopicPages(client) {
    try {
      const links = new Map();
      let total = Infinity;
      let skip = 0;
      while (skip < total) {
        await delay();
        const response = await client.getEntries({
          content_type: LINK_TYPE,
          skip: skip,
          limit: 1000,
        });
        total = response.total;
        response.items.forEach((link, index) => {
          skip = index + 1;
          links.set(link.fields.title[CONTENTFUL_LOCALE], link);
        });
      }
      return links;
    } catch (error) {
      throw `Error in getting existing links: ${error}`;
    }
  }

  async function getExistingRelatedTopics(client) {
    try {
      const topics = new Map();
      let total = Infinity;
      let skip = 0;
      while (skip < total) {
        await delay();
        const response = await client.getEntries({
          content_type: CATEGORY_REFERENCE_CONTENT_TYPE,
          skip: skip,
          limit: 1000,
        });
        total = response.total;
        response.items.forEach((topic, index) => {
          skip = index + 1;
          topics.set(topic.fields.title[CONTENTFUL_LOCALE], topic);
        });
      }
      return topics;
    } catch (error) {
      throw `Error in getting existing topics: ${error}`;
    }
  
  }
const createRelatedTopics = async (
  post,
  authors,
  failed,
  client,
  observer
) => {
  const assets = await fs.readJson(DONE_FILE_PATH);

  const createRelatedTopicEntry = (post, client) => {
    try {
      return client.createEntry("relatedTopics", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `Content: ${post.title}`,
          },
          topicsList: {
            [CONTENTFUL_LOCALE]: replaceInlineImageUrls(post.body, inlineMap),
          },
        },
      });
    } catch (error) {
      throw Error(`Rich Text Entry not created for ${post.slug}`);
    }
  };
  const exists = await getExistingTopics(client);
  const relatedTopics = [];

}
const createLinkEntry = (post, client) => {
  try {
    return client.createEntry("link", {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: `Content: ${post.title}`,
        },
        id: {
          [CONTENTFUL_LOCALE]: post.slug,
        },
        url: {
          [CONTENTFUL_LOCALE]: `${BLOG_URL}${post.slug}`,
        },
      },
    });
  } catch (error) {
    throw Error(`Rich Text Entry not created for ${post.slug}`);
  }
};

const createTopicLinks = async (post, client) => {
  try {
    const existingLinks = await getExistingLinks(client);
    const existingRelatedTopics = await getExistingRelatedTopics(client);
    const relatedLinks = [];
    post.topics.forEach(async (topic) => {
      const found = existingLinks.get(topic);
      if (found) {
        relatedLinks.push(found);
      } else {
        const relatedTopic = await createTopicLinks(topic, client);
        relatedLinks.push(relatedTopic);
      }
    });
    return relatedLinks;
  } catch (error) {
    throw Error(`Error in creating topic links: ${error}`);
  }
}

async function processCategories(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: POST_DIR_TRANSFORMED });
  const authors = await fs.readJson(CATEGORY_FILE_PATH);
  const queue = [...files].sort((a, b) => b - a);
  const failed = [];
  const total = queue.length;
  const logProgress = () => {
    const done = total - queue.length - failed.length;
    observer.next(`Remaining: ${queue.length} out of ${total}. ${done} done. (${failed.length} failed.)`);
  };
  try {
    while (queue.length) {
      logProgress();
      const file = queue.pop();
      const post = await fs.readJson(path.join(POST_DIR_TRANSFORMED, file));
      const result = await createRelatedTopics(
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
    processCategories(client, observer).then(() => observer.complete())
  );
