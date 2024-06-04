const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CATEGORY_DIR_ORIGINALS,
  CATEGORY_DIR_TRANSFORMED,
  LINKS_DIR_TRANSFORMED,
  CONTENTFUL_LOCALE,
  TOPIC_LAYOUT_ID,
  findByGlob,
  delay,
  getExistingContentType,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(CATEGORY_DIR_TRANSFORMED, "topics.json");

const TOPIC_PAGE_ID = "topicsPage";

async function findTopicInContentful(
  client,
  observer,
  wpTopic,
  cfTopics,
  cfLinks
) {
  let found = cfTopics.find(({ fields: { slug } }) =>
    slug.includes(`/blog/${wpTopic.slug}`)
  );

  if (!found) {
    const link = cfLinks.find(({ fields: { slug } }) => cf.url.includes(slug));
    found = await createTopicEntry(client, observer, wpTopic, link);
    await delay();
  }
  return {
    wordpress: {
      id: wpTopic.id,
      name: wpTopic.name,
      slug: wpTopic.slug,
    },
    contentful: found || null,
  };
}
async function createTopicEntry(client, observer, topic, linkEntry) {
  const { id } = linkEntry.contentful;
  try {
    return await client.createEntry(TOPIC_PAGE_ID, {
      fields: {
        id: {
          [CONTENTFUL_LOCALE]: `${topic.name}`,
        },
        description: {
          [CONTENTFUL_LOCALE]: `/blog/topic/${topic.slug}`,
        },
        slug: {
          [CONTENTFUL_LOCALE]: `/blog/topic/${topic.slug}`,
        },
        layout: {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Entry",
              id: TOPIC_LAYOUT_ID,
            },
          },
        },
        relatedTopics: {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Entry",
              id,
            },
          },
        },
      },
    });
  } catch (error) {
    observer.error(
      `Related Topic Entry not created for ${topic.slug}: ${error}`
    );
    throw Error(`Related Topic Entry not created for ${topic.slug}: ${error}`);
  }
}

async function processSavedTopics(client, observer = MOCK_OBSERVER) {
  const cfLinks = await fs.readJSON(
    path.join(LINKS_DIR_TRANSFORMED, "links.json")
  );
  const files = await findByGlob("*.json", { cwd: CATEGORY_DIR_ORIGINALS });
  const topics = [];
  const queue = [...files];
  const output = [];

  while (queue.length) {
    const file = queue.pop();
    const page = await fs.readJson(path.join(CATEGORY_DIR_ORIGINALS, file));
    page.forEach((topic) => topics.push(topic));
  }

  const { items: cfTopics } = await getExistingContentType(
    client,
    observer,
    TOPIC_PAGE_ID
  );
  while (topics.length) {
    const topic = topics.pop();
    const result = await findTopicInContentful(
      client,
      observer,
      topic,
      cfTopics,
      cfLinks
    );
    output.push(result);
  }

  await fs.ensureDir(CATEGORY_DIR_TRANSFORMED);
  await fs.writeJson(OUTPUT_DATA_PATH, output, { spaces: 2 });
}

module.exports = (client) =>
  new Observable((observer) =>
    processSavedTopics(client, observer).then(() => observer.complete())
  );

// (async () => {
//   const client = await require("./create-client")();
//   processSavedTopics(client).then(fin => console.log(fin.length));
// })();
