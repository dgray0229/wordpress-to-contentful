const { Observable } = require("rxjs");
const {
  MOCK_OBSERVER,
  CONTENTFUL_USER_ID,
  ARTICLE_PAGE,
  AUTHOR,
  RELATED_TOPICS,
  RICH_TEXT_MARKDOWN,
  PUBLISH_DATE,
  MAIN_TITLE,
  SUMMARY,
  TITLE_IMAGE,
  BREADCRUMBS,
  delay,
  deleteExistingContentTypes,
} = require("../util");

async function processEntryRemoval(client, observer = MOCK_OBSERVER) {
  const entriesToRemove = [
    ARTICLE_PAGE,
    AUTHOR,
    BREADCRUMBS,
    MAIN_TITLE,
    PUBLISH_DATE,
    RELATED_TOPICS,
    RICH_TEXT_MARKDOWN,
    SUMMARY,
    TITLE_IMAGE,
  ];
  for (const entry of entriesToRemove) {
    try {
      await deleteExistingContentTypes(
        client,
        observer,
        entry,
        CONTENTFUL_USER_ID
      );
    } catch (error) {
      const message = `Error in deleting ${entry}: ${error}`;
      observer.error(message);
      throw message;
    }
  }
}

module.exports = (client) =>
  new Observable((observer) => {
    processEntryRemoval(client, observer);
  });

// (async () => {
//   const client = await require("./create-client")();
//   processEntryRemoval(client).then(fin => console.log(fin.length));
// })();
