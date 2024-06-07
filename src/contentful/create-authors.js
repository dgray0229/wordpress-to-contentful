const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  findByGlob,
  CONTENTFUL_LOCALE,
  USER_DIR_TRANSFORMED,
  USER_DIR_ORIGINALS,
  MOCK_OBSERVER,
  getExistingContentType,
  delay,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const CF_USER_TYPE = "author";

const createAuthorEntry = async (client, observer, author) => {
  try {
    const result = await client.createEntry(CF_USER_TYPE, {
      fields: {
        name: {
          [CONTENTFUL_LOCALE]: author.name,
        },
        slug: {
          [CONTENTFUL_LOCALE]: author.slug,
        },
        id: {
          [CONTENTFUL_LOCALE]: author.slug,
        },
      },
    });
    return result;
  } catch (error) {
    observer.error(error);
  }
};
const createAuthorsInContentful = async (client, observer, author) => {
  let entry = author?.contentful;
  if (!entry) {
    entry = await createAuthorEntry(client, observer, author);
    await delay();
  }
  const result = { ...author, contentful: entry };
  return result;
};

async function processBlogAuthors(client, observer = MOCK_OBSERVER) {
  // Remove the unnecessary 'async' keyword
  const files = await findByGlob("*.json", { cwd: USER_DIR_ORIGINALS });
  const queue = [...files];
  let done = [];
  const cfUsers = await getExistingContentType(client, observer, CF_USER_TYPE, {}, "name");
  try {
    for (const file of queue) {
      observer.next(`Processing ${file}`);
      const authors = await fs.readJson(path.join(USER_DIR_ORIGINALS, file));
      observer.next("Processing authors");
      for (const author of authors) {
        let contentfulAuthor = null;
        if (cfUsers.has(author.name)) {
          contentfulAuthor = cfUsers.get(author.name);
        } else {
          contentfulAuthor = await createAuthorsInContentful(client, observer, author);
          await delay();
        }
        done.push(contentfulAuthor);
      }
    }
    observer.next("Processing authors complete. Writing authors to file");
    await fs.ensureDir(USER_DIR_TRANSFORMED);
    await fs.writeJson(OUTPUT_DATA_PATH, done, { spaces: 2 });
  } catch (error) {
    observer.error(error);
    throw error;
  }
}
module.exports = (client) =>
  new Observable((observer) =>
    processBlogAuthors(client, observer).then(() => observer.complete())
  );
