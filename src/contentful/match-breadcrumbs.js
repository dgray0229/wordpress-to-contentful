const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CATEGORY_DIR_ORIGINALS,
  LINKS_DIR_TRANSFORMED,
  CONTENTFUL_LOCALE,
  findByGlob,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(LINKS_DIR_TRANSFORMED, "breadcrumbs.json");

const LINK_ID = "breadcrumb";

const createBreadcrumbs = (post, client) => {
  const { schema } = post.yoast_head_json;
  const breadcrumbs = schema.find((item) => item["@type"] === "BreadcrumbList"));
  const breadcrumbList = breadcrumbs.itemListElement.map((item) => {
    return {
      sys: {
        type: "Link",
        linkType: "Entry",
        id: item.item,
      },
    };
  });
};

async function findBreadcrumbInContentful(client, wpBreadcrumb, cfBreadcrumbs) {
  let found = cfBreadcrumbs
    .map(transformCfBreadcrumb)
    .find(({ url = "" }) => url.includes(wpBreadcrumb.slug));

  if (!found) {
    try {
      const breadcrumbEntry = await client.createEntry("breadcrumbs", {
        fields: {
          title: {
            [CONTENTFUL_LOCALE]: `BreadCrumbs: ${post.title}`,
          },
          id: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          titleOverride: {
            [CONTENTFUL_LOCALE]: post.title,
          },
          breadcrumbs: {
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
                  id: post.categories[0],
                },
              },
            ],
          },
        },
    });
    } catch(error) {
      throw Error(`BreadCrumbs Entry not created for ${post.slug}`);

    }
    found = transformCfBreadcrumb(breadcrumbEntry);
  }

  return {
    wordpress: {
      id: wpBreadcrumb.id,
      name: wpBreadcrumb.name,
      slug: wpBreadcrumb.slug,
    },
    contentful: found || null,
  };
}
function transformCfBreadcrumb(cfBreadcrumb) {
  return {
    id: cfBreadcrumb.sys.id,
    url: cfBreadcrumb.fields.url[CONTENTFUL_LOCALE],
  };
}
async function getAllBreadcrumbsCfBreadcrumbs(client) {
  const { items: cfBreadcrumbs } = await client.getEntries({
    content_type: LINK_ID,
    limit: 1000,
  });
  return cfBreadcrumbs;
}

async function processSavedBreadcrumbs(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: CATEGORY_DIR_ORIGINALS });
  const topics = [];
  const queue = [...files];
  const output = [];

  while (queue.length) {
    const file = queue.pop();
    const page = await fs.readJson(path.join(CATEGORY_DIR_ORIGINALS, file));
    page.forEach((topic) => topics.push(topic));
  }

  const cfBreadcrumbs = await getAllBreadcrumbsCfBreadcrumbs(client);

  while (topics.length) {
    const topic = topics.pop();
    const result = await findBreadcrumbInContentful(client, topic, cfBreadcrumbs);
    output.push(result);
  }

  await fs.ensureDir(LINKS_DIR_TRANSFORMED);
  await fs.writeJson(OUTPUT_DATA_PATH, output, { spaces: 2 });
}

module.exports = (client) =>
  new Observable((observer) =>
    processSavedBreadcrumbs(client, observer).then(() => observer.complete())
  );

// (async () => {
//   const client = await require("./create-client")();
//   processSavedBreadcrumbs(client).then(fin => console.log(fin.length));
// })();
