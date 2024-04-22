const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  ASSET_DIR_LIST,
  urlToMimeType,
  trimUrlToFilename,
} = require("../util");

// Do not exceed ten, delay is an important factor too
// 8 processes and 1s delay seem to make sense, for 10p/s
const PROCESSES = 8;
// add delays to try and avoid API request limits in
// the parallel processes
const API_DELAY_DUR = 1000;
const UPLOAD_TIMEOUT = 60000;
// out dests
const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");
const FAILED_FILE_PATH = path.join(ASSET_DIR_LIST, "failed.json");

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

const uploadAssets = (client, assets, observer = MOCK_OBSERVER) =>
  new Promise(async (complete) => {
    const queue = [].concat(assets);
    const processing = new Set();
    const done = [];
    const failed = [];
    const existingImages = await getExistingImages(client);
    const existingAssets = await getExistingAssets(client);

    const proglog = () => {
      observer.next(
        `Remaining: ${queue.length} (${processing.size} uploading, ${
          done.length
        } done, ${failed.length} failed)`
      );
    };

    const upload = (asset) => {
      const identifier = asset.link;
      const handleContentfulImageEntry = async () => {
        const fileName = trimUrlToFilename(identifier);
        let publishedImage = null;
        if (existingImages.has(fileName)) {
          observer.next(
            `Found existing image: ${fileName}. Skipping upload...`
          );
          publishedImage = existingImages.get(fileName);
        } else {
          publishedImage = await createImageEntry(client, asset);
        }
        return publishedImage;
      };
      const handleContentfulAssetEntry = async (asset, publishedImage) => {
        const title = asset.title;
        let publishedAsset = null;
        if (existingAssets.has(title)) {
          observer.next(`Found existing asset: ${title}. Skipping upload...`);
          publishedAsset = existingAssets.get(title);
        } else {
          publishedAsset = await createAssetEntry(
            client,
            asset,
            publishedImage
          );
        }
        return publishedAsset;
      };

      // If the asset has already been uploaded, skip it
      return (
        Promise.race([
          new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
          new Promise(async (resolve) => {
            processing.add(identifier);
            proglog();
            const publishedImage = await handleContentfulImageEntry();
            resolve(publishedImage);
          }),
        ])
          .then((publishedImage) => {
            return Promice.race([
              new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
              new Promise(async (resolve, _reject) => {
                const publishedAsset = await handleContentfulAssetEntry(
                  asset,
                  publishedImage
                );
                const transformForSavingResponse = [
                  asset,
                  publishedAsset,
                  publishedImage,
                ];
                resolve(transformForSavingResponse);
              }),
            ]);
          })
          // happy path
          .then((result) => {
            done.push(transformForSaving(...result));
          })
          // badness
          .catch((error) => {
            // TODO: retry failed
            failed.push({ asset, error });
          })
          // either
          .finally(() => {
            processing.delete(identifier);
            proglog();
            // more in queue case
            if (queue.length) upload(queue.pop());
            // no more in queue, but at lesat one parallel
            // process is in progress
            else if (processing.size) return;
            else complete({ done, failed });
          })
      );
    };
    // safely handle cases where there are less total
    // items than the amount of parallel processes
    let count = 0;
    while (queue.length && count < PROCESSES) {
      const currentItem = queue.pop();
      upload(currentItem);
      count += 1;
    }
  });
async function getExistingImages(client) {
  try {
    const images = new Map();
    let total = Infinity;
    let skip = 0;
    while (skip < total) {
      await delay();
      const response = await client.getAssets({
        skip: skip,
        limit: 1000,
      });
      response.items.forEach((image, index) => {
        skip = index + 1;
        images.set(image.fields.file[CONTENTFUL_LOCALE].fileName, image);
      });
      total = response.total;
    }
    return images;
  } catch (error) {
    throw `Error in getting existing images: ${error}`;
  }
}

// Get all assets in the space
async function getExistingAssets(client) {
  try {
    const assets = new Map();
    let total = Infinity;
    let skip = 0;
    while (skip < total) {
      await delay();
      const response = await client.getAssets({
        skip: skip,
        limit: 1000,
      });
      total = response.total;
      response.items.forEach((asset, index) => {
        skip = index + 1;
        assets.set(asset.fields.title[CONTENTFUL_LOCALE], asset);
      });
    }
    return assets;
  } catch (error) {
    throw `Error in getting existing assets: ${error}`;
  }
}

function transformForUpload(asset) {
  return {
    fields: {
      title: {
        [CONTENTFUL_LOCALE]: asset.title,
      },
      description: {
        [CONTENTFUL_LOCALE]: asset.description,
      },
      file: {
        [CONTENTFUL_LOCALE]: {
          contentType: urlToMimeType(asset.link),
          fileName: trimUrlToFilename(asset.link),
          upload: encodeURI(asset.link),
        },
      },
    },
  };
}
async function createImageEntry(client, asset) {
  try {
    const created = await client.createAsset(transformForUpload(asset));
    await delay();
    const processed = await created.processForAllLocales();
    await delay();
    const published = await processed.publish();
    await delay();
    return published;
  } catch (error) {
    throw `Error in image entry creation: ${error}`;
  }
}
async function createAssetEntry(client, wp, cfImage) {
  try {
    const created = await client.createEntry("asset", {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: wp.title,
        },
        altText: {
          [CONTENTFUL_LOCALE]: wp.description,
        },
        media: {
          [CONTENTFUL_LOCALE]: {
            sys: {
              type: "Link",
              linkType: "Asset",
              id: cfImage.sys.id,
            },
          },
        },
        url: {
          [CONTENTFUL_LOCALE]: cf.fields.file[CONTENTFUL_LOCALE].url,
        },
      },
    });
    await delay();
    const published = await created.publish();
    await delay();
    return published;
  } catch (error) {
    throw `Error in asset entry creation: ${error}`;
  }
}

function transformForSaving(wp, cf, image) {
  const assetInfo = {
    wordpress: wp,
    contentful: {
      id: cf.sys.id,
      title: cf.fields.title[CONTENTFUL_LOCALE],
      altText: cf.fields.altText[CONTENTFUL_LOCALE],
      url: image.fields.file[CONTENTFUL_LOCALE].url,
      media: image.fields.file[CONTENTFUL_LOCALE].fileName,
    },
  };
  return assetInfo;
}

async function uploadListOfAssets(client, observer) {
  const loc = path.join(ASSET_DIR_LIST, "assets.json");
  const assets = await fs.readJson(loc);
  const { done, failed } = await uploadAssets(client, assets, observer);
  await uploadAssets(client, assets, observer);
  await Promise.all([
    fs.writeJson(DONE_FILE_PATH, done, { spaces: 2 }),
    fs.writeJson(FAILED_FILE_PATH, failed, { spaces: 2 }),
  ]);
}

module.exports = (client) =>
  new Observable((observer) =>
    uploadListOfAssets(client, observer).then(() => observer.complete())
  );
