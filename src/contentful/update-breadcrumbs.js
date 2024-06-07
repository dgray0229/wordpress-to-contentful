const { Observable } = require("rxjs");
const {
  BREADCRUMBS,
  CONTENTFUL_LOCALE,
  BLOG_PAGE_ENTRY_ID,
  MOCK_OBSERVER,
  delay,
} = require("../util");

async function updateBreadcrumbs(client, observer = MOCK_OBSERVER) {
  observer.next("Getting breadcrumb entries...");
  const breadcrumbs = await client.getEntries({
    content_type: BREADCRUMBS,
    skip: 0,
    limit: 1000,
  });
  const logProgress = (index) => {
    const itemCount = breadcrumbs.items.length;
    observer.next(
      `Updating: ${index} of ${itemCount} breadcrumbs.`
    );
  };
  let count = 0;
  for (const breadcrumb of breadcrumbs.items) {
    logProgress(++count);
    breadcrumb.fields.modules[CONTENTFUL_LOCALE][0] = {
      sys: {
        type: "Link",
        linkType: "Entry",
        id: BLOG_PAGE_ENTRY_ID,
      },
    };
    if (Object.hasOwn(breadcrumb, "update")) {
        try {
            await breadcrumb.update();
            await delay();
        } catch (error) {
            observer.error(`Error in updating breadcrumb: ${error}`);
            throw error;
        }
      await delay();
    }
    observer.next("Breadcrumbs updated.");}
  }

module.exports = (client) =>
  new Observable((observer) =>
    updateBreadcrumbs(client, observer).then(() => observer.complete())
  );

// debug
// (async () => {
//   const client = await require("./create-client")();
//   updateBreadcrumbs(client).then(console.log);
// })();
