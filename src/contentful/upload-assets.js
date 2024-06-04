const path = require("path");
const fs = require("fs-extra");
const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_LOCALE,
  ASSET_DIR_LIST,
  urlToMimeType,
  trimUrlToFilename,
  delay,
} = require("../util");

// Do not exceed ten, delay is an important factor too
// 8 processes and 1s delay seem to make sense, for 10p/s
const PROCESSES = 8;
// add delays to try and avoid API request limits in
// the parallel processes
const UPLOAD_TIMEOUT = 60000;
// out dests
const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");
const FAILED_FILE_PATH = path.join(ASSET_DIR_LIST, "failed.json");
const ASSET_ID = "asset";

const uploadAssets = (client, assets, observer = MOCK_OBSERVER) =>
  new Promise(async (complete) => {
    const queue = [].concat(assets);
    const processing = new Set();
    const done = [];
    const skipped = [];
    const failed = [];
    const existingImages = await getExistingImages(client);
    const existingAssets = await getExistingAssets(client);

    const proglog = () => {
      observer.next(
        `Remaining: ${queue.length} (${processing.size} uploading, ${
          done.length
        } done, ${failed.length} failed), skipped: ${skipped.length}.`
      );
    };

    const upload = (asset) => {
      const identifier = asset.link;
      const handleContentfulImageEntry = async () => {
        try {
          const fileName = trimUrlToFilename(identifier);
          let publishedImage = null;
          if (existingImages.has(fileName)) {
            publishedImage = existingImages.get(fileName);
          } else {
            publishedImage = await createImageEntry(client, asset);
          }
          if (!publishedImage) throw "Error in image entry creation: no image.";
          return publishedImage;
        } catch (error) {
          throw `Error in image entry creation: ${error}`;
        }
      };
      const handleContentfulAssetEntry = async (asset, publishedImage) => {
        try {
          const { title } = asset;
          let publishedAsset = null;
          const processed = existingAssets.has(title);
          publishedAsset = processed
            ? { result: existingAssets.get(title), processed: true }
            : {
                result: await createAssetEntry(client, asset, publishedImage),
                processed,
              };
          return publishedAsset;
        } catch (error) {
          throw `Error in asset entry creation: ${error}`;
        }
      };

      // If the asset has already been uploaded, skip it
      return (
        Promise.race([
          new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
          new Promise(async (resolve) => {
            proglog();
            processing.add(identifier);
            const publishedImage = await handleContentfulImageEntry();
            if (!publishedImage)
              reject("Error in image entry production: no image.");
            resolve(publishedImage);
          }),
        ])
          .then((publishedImage) =>
            Promise.race([
              new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
              new Promise(async (resolve, reject) => {
                const response = await handleContentfulAssetEntry(
                  asset,
                  publishedImage
                );
                if (!response) return reject("No response from asset entry.");
                const { result: publishedAsset, processed } = response;
                if (!publishedAsset)
                  throw "Error in asset entry production: no asset.";
                const transformForSavingResponse = [
                  asset,
                  publishedAsset,
                  publishedImage,
                ];
                resolve({ result: transformForSavingResponse, processed });
              }).catch((error) => {
                throw `Error in asset entry production: ${error}`;
              }),
            ])
          )
          // happy path
          .then(({ result, processed }) => {
            const assetMetadata = transformForSaving(...result);
            if (processed) return skipped.push(assetMetadata);
            return done.push(assetMetadata);
          })
          .catch((error) => {
            // TODO: retry failed
            failed.push({ asset, error: error.message });
          })
          // either
          .finally(() => {
            processing.delete(identifier);
            // more in queue case
            if (queue.length) upload(queue.pop());
            // no more in queue, but at lesat one parallel
            // process is in progress
            else if (processing.size) return;
            else complete({ done, failed, skipped });
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
      const response = await client.getEntries({
        content_type: ASSET_ID,
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
async function createAssetEntry(client, wpAsset, cfImage) {
  try {
    const created = await client.createEntry("asset", {
      fields: {
        title: {
          [CONTENTFUL_LOCALE]: wpAsset.title,
        },
        altText: {
          [CONTENTFUL_LOCALE]: wpAsset.description,
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
          [CONTENTFUL_LOCALE]: cfImage?.fields.file[CONTENTFUL_LOCALE].url,
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

function transformForSaving(wpAsset, cfAsset, cfImage) {
  try {
    const assetInfo = {
      wordpress: wpAsset,
      contentful: {
        id: cfAsset?.sys.id,
        title: cfAsset?.fields.title[CONTENTFUL_LOCALE],
        altText: wpAsset?.description,
        url: cfImage?.fields.file[CONTENTFUL_LOCALE].url,
        media: cfImage?.fields.file[CONTENTFUL_LOCALE].fileName,
      },
    };
    return assetInfo;
  } catch (error) {
    throw `Error in transforming for saving: ${error}`;
  }
}

async function uploadListOfAssets(client, observer) {
  const loc = path.join(ASSET_DIR_LIST, "assets.json");
  const assets = await fs.readJson(loc);
  const { done, failed, skipped } = await uploadAssets(
    client,
    assets,
    observer
  );
  await uploadAssets(client, assets, observer);
  await Promise.all([
    fs.writeJson(DONE_FILE_PATH, [...done, ...skipped], { spaces: 2 }),
    fs.writeJson(FAILED_FILE_PATH, failed, { spaces: 2 }),
  ]);
}

module.exports = (client) =>
  new Observable((observer) =>
    uploadListOfAssets(client, observer).then(() => observer.complete())
  );
