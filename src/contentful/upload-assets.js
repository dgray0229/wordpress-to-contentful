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

    observer.next(
      `Preparing to upload ${queue.length} assets to ${client.name}`
    );

    // Get all assets in the space
    const existingAssets = await client.getAssets();
    const existingAssetNames = new Set(
      existingAssets.items.map(
        (asset) => asset.fields.file[CONTENTFUL_LOCALE].fileName
      )
    );

    const proglog = () => {
      observer.next(
        `Remaining: ${queue.length} (${processing.size} uploading, ${
          done.length
        } done, ${failed.length} failed)`
      );
    };

    const upload = (asset) => {
      const identifier = asset.link;
      let image = null;
      const assetExists = () => {
        const fileName = trimUrlToFilename(identifier);
        const fileNameExists = existingAssetNames.has(fileName);
        if (fileNameExists) {
          observer.next(`Asset ${fileName} already exists, skipping upload`);
          return true;
        }
        observer.next(
          `Asset has not previously uploaded, continue uploading ${fileName}`
        );
        return false;
      };

      // If the asset has already been uploaded, skip it
      return (
        Promise.race([
          new Promise((_, reject) => setTimeout(reject, UPLOAD_TIMEOUT)),
          new Promise(async (resolve) => {
            processing.add(identifier);
            proglog();
            await delay();
            const created = await client.createAsset(transformForUpload(asset));
            await delay();
            const processed = await created.processForAllLocales();
            await delay();
            const published = await processed.publish();
            await delay();
            resolve(published);
          }),
        ])
          .then((published) => {
            publishedImage = published;
            return new Promise(async (resolve, _reject) => {
              const assetEntry = await createAssetEntry(
                client,
                asset,
                publishedImage
              );
              resolve(assetEntry);
            });
          })
          // happy path
          .then((published) => {
            done.push(transformForSaving(asset, published, publishedImage));
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

async function createAssetEntry(client, wp, cf) {
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
            id: cf.sys.id,
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
