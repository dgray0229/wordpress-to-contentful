const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  USER_DIR_ORIGINALS,
  USER_DIR_TRANSFORMED,
  AUTHOR,
  findByGlob,
  getExistingContentType,
} = require("../util");
const OUTPUT_DATA_PATH = path.join(USER_DIR_TRANSFORMED, "authors.json");

const sanitizeName = (s) => s.toLowerCase().replace(/\ /gi, "");

async function findUserInContentful(wpUser, cfUsers) {
  const found = cfUsers.has(sanitizeName(wpUser.name)) ? cfUsers.get(sanitizeName(wpUser.name)) : null;

  return {
    wordpress: {
      id: wpUser.id,
      name: wpUser.name,
    },
    contentful: found || null,
  };
}

async function processSavedUsers(client, observer = MOCK_OBSERVER) {
  const files = await findByGlob("*.json", { cwd: USER_DIR_ORIGINALS });
  const users = [];
  const queue = [...files];
  const output = [];

  while (queue.length) {
    const file = queue.pop();
    const page = await fs.readJson(path.join(USER_DIR_ORIGINALS, file));
    page.forEach((user) => users.push(user));
  }

  const cfUsers = await getExistingContentType(
    client,
    observer,
    AUTHOR,
    {},
    "name"
  );

  while (users.length) {
    const user = users.pop();
    const result = await findUserInContentful(user, cfUsers);
    output.push(result);
  }

  await fs.ensureDir(USER_DIR_TRANSFORMED);
  await fs.writeJson(OUTPUT_DATA_PATH, output, { spaces: 2 });
  return output;
}

module.exports = (client) =>
  new Observable((observer) =>
    processSavedUsers(client, observer).then(() => observer.complete())
  );

// (async () => {
//   const client = await require("./create-client")();
//   processSavedUsers(client).then(fin => console.log(fin.length));
// })();
