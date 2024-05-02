const fetch = require("node-fetch");
const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const { WP_API_URL } = require("../util");

const urlForCategories = (url = '', page = 1, perPage = 20, fields = []) => `${url}/categories?per_page=${perPage}&page=${page}${fields ? `&fields=${fields.join(',')}` : ``}`;

const categories = async (url, observer) => {
  let page = 1;
  let perPage = 100;
  let fields = ['id', 'name', 'slug', 'parent', 'count'];
  try {
    const response = await fetch(urlForCategories(url, page, perPage, fields));
    const { status } = response;
    if (status === 200) {
      const json = await response.json();
      const dest = path.join('dist/categories-original', 'categories.json');
      await fs.ensureDir('dist/categories-original');
      await fs.writeJson(dest, json, { spaces: 2 });
      observer.complete();
    } else {
      const json = await response.json();
      observer.error(json);
    }
  } catch (error) {
    observer.error(error);
  }
};

module.exports = () => new Observable(observer => categories(WP_API_URL, observer));