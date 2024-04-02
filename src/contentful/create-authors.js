const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  findByGlob,
  CONTENTFUL_LOCALE,
  USER_DIR_TRANSFORMED,
  USER_DIR_ORIGINALS,
  MOCK_OBSERVER,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");
const CF_USER_TYPE = "author";

const createAuthorEntry = async (client, author) => {
  const result = await client.createEntry(CF_USER_TYPE, {
    fields: {
      name: {
        [CONTENTFUL_LOCALE]: author.name,
      },
    },
  });
  return result;
};
const createAuthorsInContentful = async (client, author) => {
  let entry = author?.contentful;
  if (!entry) {
    entry = await createAuthorEntry(client, author);
  }
  const result = { ...author, contentful: entry };
  return result;
};

async function processBlogAuthors(client, observer = MOCK_OBSERVER) {
  // Remove the unnecessary 'async' keyword
  const files = await findByGlob("*.json", { cwd: USER_DIR_ORIGINALS });
  const queue = [...files];
  let done = [];

  for (const file of queue) {
    observer.next(`Processing ${file}`);
    const authors = await fs.readJson(path.join(USER_DIR_ORIGINALS, file));
    observer.next("Processing authors");
    for (const author of authors) {
      const contentfulAuthor = await createAuthorsInContentful(client, author);
      done.push(contentfulAuthor);
    }
  }
  observer.next("Processing authors complete");
  observer.next("Writing authors to file");
  await fs.ensureDir(USER_DIR_TRANSFORMED);
  await fs.writeJson(OUTPUT_DATA_PATH, done, { spaces: 2 });
}
module.exports = (client) =>
  new Observable((observer) =>
    processBlogAuthors(client, observer).then(() => observer.complete())
  );
