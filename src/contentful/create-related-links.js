const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CATEGORY_DIR_ORIGINALS,
  LINKS_DIR_TRANSFORMED,
  CONTENTFUL_LOCALE,
  getExistingContentType,
  findByGlob,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(LINKS_DIR_TRANSFORMED, "links.json");

const LINK_ID = "link";

async function findLinkInContentful(client, wpLink, cfLinks) {
  let found = cfLinks
    .map(transformCfLink)
    .find(({ url = "" }) => url.includes(wpLink.slug));

  if (!found) {
    const linkEntry = await client.createEntry(LINK_ID, {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: `${wpLink.name}`,
        },
        text: {
          [CONTENTFUL_LOCALE]: `${wpLink.name}`,
        },
        id: {
          [CONTENTFUL_LOCALE]: wpLink.slug,
        },
        url: {
          [CONTENTFUL_LOCALE]: `/blog/topic/${wpLink.slug}`,
        },
      },
    });
    found = transformCfLink(linkEntry);
  }

  return {
    wordpress: {
      id: wpLink.id,
      name: wpLink.name,
      slug: wpLink.slug,
    },
    contentful: found || null,
  };
}
function transformCfLink(cfLink) {
  return {
    id: cfLink.sys.id,
    url: cfLink.fields.url[CONTENTFUL_LOCALE],
  };
}
async function getAllLinksCfLinks(client) {
  const { items: cfLinks } = await client.getEntries({
    content_type: LINK_ID,
    limit: 1000,
  });
  return cfLinks;
}

async function processSavedLinks(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: CATEGORY_DIR_ORIGINALS });
  const topics = [];
  const queue = [...files];
  const output = [];

  while (queue.length) {
    const file = queue.pop();
    const page = await fs.readJson(path.join(CATEGORY_DIR_ORIGINALS, file));
    page.forEach((topic) => topics.push(topic));
  }

  const cfLinks = await getAllLinksCfLinks(client);

  while (topics.length) {
    const topic = topics.pop();
    const result = await findLinkInContentful(client, topic, cfLinks);
    output.push(result);
  }

  await fs.ensureDir(LINKS_DIR_TRANSFORMED);
  await fs.writeJson(OUTPUT_DATA_PATH, output, { spaces: 2 });
}

module.exports = (client) =>
  new Observable((observer) =>
    processSavedLinks(client, observer).then(() => observer.complete())
  );

// (async () => {
//   const client = await require("./create-client")();
//   processSavedLinks(client).then(fin => console.log(fin.length));
// })();
