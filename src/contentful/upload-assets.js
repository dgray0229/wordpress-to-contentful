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
const API_DELAY_DUR = 5000;
const UPLOAD_TIMEOUT = 60000;
// out dests
const DONE_FILE_PATH = path.join(ASSET_DIR_LIST, "done.json");
const FAILED_FILE_PATH = path.join(ASSET_DIR_LIST, "failed.json");

const delay = (dur = API_DELAY_DUR) =>
  new Promise((resolve) => setTimeout(resolve, dur));

const uploadAssets = (client, assets, observer = MOCK_OBSERVER) =>
  new Promise(async (complete) => {
    const queue = [].concat(assets);
    const total = queue.length;
    const processing = new Set();
    const done = [];
    const failed = [];
    let count = 0;
    const defaultQueryParams = { skip: 0, limit: 1000 };

    const existingImageNames = await getAllContentfulImages();
    const existingAssetEntries = await getAllContentfulAssets();

    observer.next(
      `Preparing to upload ${queue.length} assets to ${client.name}`
    );

    async function getAllContentfulImages(queryParams = defaultQueryParams) {
      const existingImageMap = new Map();
      let { skip, limit } = queryParams;
      const query = { skip, limit };
      await delay();
      let queryResult = await client.getAssets(query);
      while (queryResult.items.length) {
        queryResult.items.forEach((asset) => {
          const { fileName, url } = asset.fields.file[CONTENTFUL_LOCALE];
          existingImageMap.set(fileName, { fileName, url });
        });
        query.skip = ++count * limit;
        await delay();
        queryResult = await client.getAssets(query);
      }
      return existingImageMap;
    }

    async function getAllContentfulAssets(queryParams = defaultQueryParams) {
      let count = 0;
      const existingAssetMap = new Map();
      let { skip, limit } = queryParams;
      const content_type = "asset";
      const query = { skip, limit, content_type };
      await delay();
      let queryResult = await client.getEntries(query);
      while (queryResult.items.length) {
        queryResult.items.forEach((item) => {
          const fileNameAsTitle = item.fields.title[CONTENTFUL_LOCALE];
          existingAssetMap.set(fileNameAsTitle, item);
        });
        query.skip = ++count * limit;
        await delay();
        queryResult = await client.getEntries(query);
      }
      return existingAssetMap;
    }

    // Get all asset content types in the space
    // const existingAssetEntries = await client.getContentType('asset');
    // const existingAssetEntries = await client.getEntries('asset');

    const proglog = () => {
      observer.next(
        `Processing: ${count} out of ${total} assets.  ${
          queue.length
        } remaining. (${processing.size} uploading, ${done.length} done, ${
          failed.length
        } failed)`
      );
    };

    const upload = async (asset) => {
      const identifier = asset.link;
      const handleContentfulImages = async () => {
        const fileName = trimUrlToFilename(identifier);
        let publishedImage = null;
        if (existingImageNames.has(fileName)) {
          observer.next(`Asset ${fileName} already exists, skipping upload`);
          publishedImage = existingImageNames.get(fileName);
        } else {
          observer.next(
            `Asset has not previously uploaded, continue uploading ${fileName}`
          );
          publishedImage = Promise.race([
            new Promise((_response, reject) =>
              setTimeout(reject, UPLOAD_TIMEOUT)
            ),
            new Promise(sendUploadRequest),
          ]);
        }
        return publishedImage;
      };

      const handleContentfulAssetEntries = async () => {
        const fileName = trimUrlToFilename(identifier);
        let publishedAsset = null;
        if (existingAssetEntries.has(fileName)) {
          observer.next(
            `Asset entry ${fileName} already exists, skipping creation`
          );
          publishedAsset = existingAssetEntries.get(fileName);
        } else {
          observer.next(
            `Asset entry has not been previously created, continue entry creation of ${fileName}`
          );
          publishedAsset = Promise.race([
            new Promise((_response, reject) =>
              setTimeout(reject, UPLOAD_TIMEOUT)
            ),
            new Promise((resolve) =>
              sendAssetEntryRequest(publishedImage, resolve)
            ),
          ]);
        }
        return publishedAsset;
      };

      const sendUploadRequest = async () => {
        processing.add(identifier);
        try {
          const created = await client.createAsset(transformForUpload(asset));
          await delay();
          const processed = await created.processForAllLocales();
          await delay();
          const publishedImage = await processed.publish();
          resolve(publishedImage);
        } catch (error) {
          failed.push({ asset, error });
          console.error(`An error has occured: ${error}`);
        }
      };
      const sendAssetEntryRequest = async (publishedImage, resolve) => {
        await delay();
        const assetEntry = await createAssetEntry(
          client,
          asset,
          publishedImage
        );
        await delay();
        resolve(assetEntry);
      };
      try {
        const publishedImage = await handleContentfulImages();
        const publishedAsset = await handleContentfulAssetEntries();
        const savedEntry = transformForSaving(
          asset,
          publishedAsset,
          publishedImage
        );
        done.push(savedEntry);
      } catch (error) {
        console.error(error);
        failed.push(asset);
      }
    };
    let queueLength = queue.length;
    while (queueLength) {
      proglog();
      const currentItem = queue.pop();
      queueLength = queue.length;
      if (queue.length) upload(currentItem);
      count += 1;
    }
    complete({ done, failed });
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
  const created = await client.entry.create("asset", {
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

function transformForSaving(wpAsset, cfAsset, cfImageFile) {
  console.log(wpAsset, cfAsset, cfImageFile);
  const assetInfo = {
    wordpress: wpAsset,
    contentful: {
      id: cfAsset.sys.id,
      title: cfAsset.fields.title[CONTENTFUL_LOCALE],
      altText: cfAsset.fields.altText[CONTENTFUL_LOCALE],
      url: cfImageFile.fields.file[CONTENTFUL_LOCALE].url,
      media: cfImageFile.fields.file[CONTENTFUL_LOCALE].fileName,
    },
  };
  return assetInfo;
}

async function uploadListOfAssets(client, observer) {
  const location = path.join(ASSET_DIR_LIST, "assets.json");
  const assets = await fs.readJson(location);
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
