const fetch = require("node-fetch");
const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const { WP_API_URL } = require("../util");

const urlForCategories = (url) => `${url}/categories`;

const categories = async (url, observer) => {
  const response = await fetch(urlForCategories(url));
  const { status } = response;

  if (status === 200) {
    const json = await response.json();
    const dest = path.join('dist/categories-original', 'categories.json');
    await fs.ensureDir('dist/categories-original');
    await fs.writeJson(dest, json);
    observer.complete();
  } else {
    throw new Error(response);
  }
};

module.exports = () => new Observable(observer => categories(WP_API_URL, observer));