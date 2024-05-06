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

const CATEGORY_FILE_PATH = path.join('dist/categories-original', "categories.json");
const RESULTS_PATH = path.join(POST_DIR_CREATED, "posts.json");
const CONTENT_TYPE = "relatedTopics"
const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));


  async function getExistingTopics(client) {
    try {
      const topics = new Map();
      let total = Infinity;
      let skip = 0;
      while (skip < total) {
        await delay();
        const response = await client.getEntries({
          content_type: CONTENT_TYPE,
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

  const transformUrl = (url) => {
    const BASE_URL = "https://taxacttest.wpengine.com";
  }
  
const createRelatedTopics = async (
  post,
  authors,
  failed,
  client,
  observer
) => {
  const assets = await fs.readJson(DONE_FILE_PATH);

  const createRelatedTopic = (post, client) => {
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
