const contentful = require("contentful-management");
const {
  CONTENTFUL_CMA_TOKEN,
  CONTENTFUL_ENV_NAME,
  CONTENTFUL_SPACE_ID,
} = require("../util");

const get = async ({ accessToken, spaceId, environmentId } = {}) => {
  const client = contentful.createClient(
    {
      accessToken,
    },
    {
      // type: "plain",
      // defaults: {
      //   spaceId,
      //   environmentId,
      // },
      logHandler: (level, data) => console.log(`${level} | ${data}`),
    }
  );
  const space = await client.getSpace(spaceId);
  const env = await space.getEnvironment(environmentId);
  return env;
};

module.exports = () =>
  get({
    accessToken: CONTENTFUL_CMA_TOKEN,
    spaceId: CONTENTFUL_SPACE_ID,
    environmentId: CONTENTFUL_ENV_NAME,
  });
