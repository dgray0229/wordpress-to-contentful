const fetch = require("node-fetch");
const fs = require("fs-extra");
const path = require("path");
const { Observable } = require("rxjs");
const { WP_API_URL, CATEGORY_DIR_ORIGINALS } = require("../util");

const OUTPUT_DATA_PATH = path.join(CATEGORY_DIR_ORIGINALS, "categories.json");
const urlForCategories = (url = "", page = 1, perPage = 20, fields = []) =>
  `${url}/categories?per_page=${perPage}&page=${page}${
    fields ? `&_fields=${fields.join(",")}` : ``
  }`;

const categories = async (url, observer) => {
  let page = 1;
  let perPage = 100;
  let fields = ["id", "name", "slug", "parent", "count"];

  function findParentDetails(categories) {
    const categoryMap = {};
    try {
      const result = categories.map((category, index) => {
        categoryMap[category.id] = { ...category, index };
        return category;
      });
      result.forEach((category) => {
        const parentID = category.parent;
        if (parentID !== 0) {
          const parentCategorySlug = categoryMap[parentID].slug;
          category.slug = `${parentCategorySlug}/${category.slug}`;
        };
      });
      return result;
    } catch (error) {
      observer.error(`Error in findParentDetails: ${error}`);
    }
  }

  // Usage:
  // let categories = [ ... ]; // Your JSON data
  // console.log(findParentDetails(categories));
  try {
    const response = await fetch(urlForCategories(url, page, perPage, fields));
    const { status } = response;
    if (status === 200) {
      const json = await response.json();
      const categories = findParentDetails(json);
      await fs.ensureDir(CATEGORY_DIR_ORIGINALS);
      await fs.writeJson(OUTPUT_DATA_PATH, categories, { spaces: 2 });
      observer.complete();
    } else {
      const json = await response.json();
      throw Error(
        `Error code of ${status} with JSON: ${JSON.stringify(json, null, 2)})`
      );
    }
  } catch (error) {
    observer.error(error.message);
  }
};

module.exports = () =>
  new Observable((observer) => categories(WP_API_URL, observer));
